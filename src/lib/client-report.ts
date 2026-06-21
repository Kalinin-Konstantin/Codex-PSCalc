import {
  breakdownItemsForDisplay,
  calculateAllSchemes,
  calculateSkuMetrics,
  classifySkuDimensions,
  flattenResults,
  labelForMarketplace,
  labelForScheme,
  labelForWbSupplyType
} from "./calculator.ts";
import type { CalculationResult, CalculatorSettings, CostBreakdownItem, SchemeResult, SkuInput, TariffData } from "./types";

type ZipEntry = {
  name: string;
  data: Uint8Array;
};

type CellValue = string | number | null;
type WorkbookCell = CellValue | { value?: CellValue; formula?: string; style?: number };
type WorksheetDefinition = {
  name: string;
  rows: WorkbookCell[][];
  columnWidths?: number[];
  freezeRow?: number;
  merges?: string[];
};

type DetailTotalRef = {
  totalCell: string;
  percentCell: string;
};

const REPORT_SHEETS = ["Итоги", "Детализация", "Исходные данные", "Применённые тарифы"] as const;
const RESULT_COLUMNS = [
  ["wildberries", "fbo"],
  ["wildberries", "fbs"],
  ["wildberries", "dbs"],
  ["ozon", "fbo"],
  ["ozon", "fbs"],
  ["ozon", "dbs"]
] as const;

const STYLE = {
  title: 1,
  section: 2,
  header: 3,
  money: 4,
  percent: 5,
  bestMoney: 6,
  note: 7,
  totalMoney: 8,
  totalPercent: 9,
  muted: 10
} as const;

export function createClientReportBlob(skus: SkuInput[], settings: CalculatorSettings, tariffs: TariffData): Blob {
  return new Blob([createClientReportXlsx(skus, settings, tariffs)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

export function createClientReportXlsx(skus: SkuInput[], settings: CalculatorSettings, tariffs: TariffData): Uint8Array {
  const worksheets = buildClientReportWorksheets(skus, settings, tariffs);
  const entries = [
    xmlEntry("[Content_Types].xml", contentTypesXml(worksheets.length)),
    xmlEntry("_rels/.rels", rootRelsXml()),
    xmlEntry("xl/workbook.xml", workbookXml(worksheets)),
    xmlEntry("xl/_rels/workbook.xml.rels", workbookRelsXml(worksheets.length)),
    xmlEntry("xl/styles.xml", stylesXml()),
    ...worksheets.map((worksheet, index) => xmlEntry(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(worksheet)))
  ];
  return writeZip(entries);
}

export function buildClientReportWorksheets(skus: SkuInput[], settings: CalculatorSettings, tariffs: TariffData): WorksheetDefinition[] {
  const clientSettings: CalculatorSettings = { ...settings, presentationMode: "client" };
  const reportRows = skus.map((sku) => {
    const result = calculateAllSchemes(sku, clientSettings, tariffs);
    return {
      sku,
      result,
      metrics: calculateSkuMetrics(sku),
      dimensions: classifySkuDimensions(sku),
      bestByMarketplace: findBestMarketplaceResults(result)
    };
  });

  const detail = buildDetailSheet(reportRows);
  const summary = buildSummarySheet(reportRows, detail.totalRefs, clientSettings);
  const inputs = buildInputsSheet(reportRows, clientSettings, tariffs);
  const tariffsSheet = buildAppliedTariffsSheet(reportRows);
  return [summary, detail.sheet, inputs, tariffsSheet];
}

function buildSummarySheet(
  reportRows: Array<{
    sku: SkuInput;
    result: CalculationResult;
    metrics: ReturnType<typeof calculateSkuMetrics>;
    dimensions: ReturnType<typeof classifySkuDimensions>;
    bestByMarketplace: Record<"wildberries" | "ozon", SchemeResult>;
  }>,
  totalRefs: Map<string, DetailTotalRef>,
  settings: CalculatorSettings
): WorksheetDefinition {
  const rows: WorkbookCell[][] = [
    [styled("Клиентский расчёт PIM.Seller", STYLE.title)],
    [
      styled(
        `${settings.vatDisplayMode === "with_vat" ? "Суммы с НДС 22%" : "Суммы без НДС"} · маршрут ${settings.originCity} → ${settings.firstMileCity} · склад WB ${settings.wbWarehouse || "не выбран"}`,
        STYLE.note
      )
    ],
    [],
    [
      styled("SKU", STYLE.header),
      styled("Цена", STYLE.header),
      styled("Объём, л", STYLE.header),
      styled("Расч. вес, кг", STYLE.header),
      styled("WB габарит", STYLE.header),
      styled("Ozon габарит", STYLE.header),
      ...RESULT_COLUMNS.flatMap(([marketplace, scheme]) => [
        styled(`${labelForMarketplace(marketplace)} ${labelForScheme(scheme)}, ₽`, STYLE.header),
        styled("% цены", STYLE.header)
      ]),
      styled("Лучший WB", STYLE.header),
      styled("Лучший Ozon", STYLE.header),
      styled("Комментарий", STYLE.header)
    ]
  ];

  reportRows.forEach(({ sku, metrics, dimensions, bestByMarketplace }) => {
    rows.push([
      sku.name,
      styled(sku.price, STYLE.money),
      round(metrics.volumeLiters),
      round(metrics.chargeableKg),
      wbDimensionLabel(dimensions.wildberries),
      ozonDimensionLabel(dimensions.ozon),
      ...RESULT_COLUMNS.flatMap(([marketplace, scheme]) => {
        const key = resultKey(sku.id, marketplace, scheme);
        const ref = totalRefs.get(key);
        const isBest = bestByMarketplace[marketplace].scheme === scheme;
        return [
          styledFormula(ref ? `'Детализация'!${ref.totalCell}` : "0", isBest ? STYLE.bestMoney : STYLE.money),
          styledFormula(ref ? `'Детализация'!${ref.percentCell}` : "0", STYLE.percent)
        ];
      }),
      labelForScheme(bestByMarketplace.wildberries.scheme),
      labelForScheme(bestByMarketplace.ozon.scheme),
      ""
    ]);
  });

  return {
    name: "Итоги",
    rows,
    freezeRow: 4,
    merges: ["A1:U1", "A2:U2"],
    columnWidths: [24, 12, 11, 14, 13, 13, 13, 10, 13, 10, 13, 10, 13, 10, 13, 10, 13, 10, 18, 18, 32]
  };
}

function findBestMarketplaceResults(result: CalculationResult): Record<"wildberries" | "ozon", SchemeResult> {
  return {
    wildberries: findBestSchemeResult([result.wildberries.fbo, result.wildberries.fbs, result.wildberries.dbs]),
    ozon: findBestSchemeResult([result.ozon.fbo, result.ozon.fbs, result.ozon.dbs])
  };
}

function findBestSchemeResult(results: SchemeResult[]): SchemeResult {
  const complete = results.filter((item) => item.isComplete);
  const comparable = complete.length ? complete : results;
  return comparable.reduce((best, current) => (current.totalRub < best.totalRub ? current : best));
}

function buildDetailSheet(
  reportRows: Array<{
    sku: SkuInput;
    result: CalculationResult;
  }>
): { sheet: WorksheetDefinition; totalRefs: Map<string, DetailTotalRef> } {
  const rows: WorkbookCell[][] = [
    [styled("Детализация расчёта", STYLE.title)],
    [styled("Каждый блок показывает клиентские статьи затрат. Итоговые строки связаны с листом «Итоги» формулами.", STYLE.note)],
    [],
    [
      styled("SKU", STYLE.header),
      styled("Маркетплейс", STYLE.header),
      styled("Схема", STYLE.header),
      styled("Статья", STYLE.header),
      styled("Сумма, ₽", STYLE.header),
      styled("% цены", STYLE.header),
      styled("НДС", STYLE.header),
      styled("Формула / логика", STYLE.header),
      styled("Предупреждения", STYLE.header)
    ]
  ];
  const totalRefs = new Map<string, DetailTotalRef>();

  reportRows.forEach(({ sku, result }) => {
    flattenResults(result).forEach((schemeResult) => {
      const startRow = rows.length + 1;
      const warnings = schemeResult.warnings.join("; ");
      const displayItems = breakdownItemsForDisplay(schemeResult);
      displayItems.forEach((item) => {
        rows.push([
          sku.name,
          labelForMarketplace(schemeResult.marketplace),
          labelForScheme(schemeResult.scheme),
          item.label,
          styled(item.amountRub, STYLE.money),
          styledFormula(`IFERROR(E${rows.length + 1}/${schemeResult.priceBasisRub},0)`, STYLE.percent),
          item.vatNote,
          item.calculationNote ?? articleFormulaText(sku, item, schemeResult),
          warnings
        ]);
      });
      const totalRow = rows.length + 1;
      rows.push([
        styled(sku.name, STYLE.section),
        styled(labelForMarketplace(schemeResult.marketplace), STYLE.section),
        styled(labelForScheme(schemeResult.scheme), STYLE.section),
        styled("Итого", STYLE.section),
        styledFormula(`SUM(E${startRow}:E${totalRow - 1})`, STYLE.totalMoney),
        styledFormula(`IFERROR(E${totalRow}/${schemeResult.priceBasisRub},0)`, STYLE.totalPercent),
        schemeResult.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС",
        "Итог по статьям выше",
        schemeResult.isComplete ? "" : "Схема неполная: проверьте предупреждения"
      ]);
      totalRefs.set(resultKey(sku.id, schemeResult.marketplace, schemeResult.scheme), {
        totalCell: `E${totalRow}`,
        percentCell: `F${totalRow}`
      });
      rows.push([]);
    });
  });

  return {
    totalRefs,
    sheet: {
      name: "Детализация",
      rows,
      freezeRow: 4,
      columnWidths: [24, 16, 10, 28, 14, 10, 12, 74, 42]
    }
  };
}

function buildInputsSheet(
  reportRows: Array<{
    sku: SkuInput;
    metrics: ReturnType<typeof calculateSkuMetrics>;
    dimensions: ReturnType<typeof classifySkuDimensions>;
  }>,
  settings: CalculatorSettings,
  tariffs: TariffData
): WorksheetDefinition {
  const rows: WorkbookCell[][] = [
    [styled("Исходные данные", STYLE.title)],
    [styled("Параметры, которые повлияли на расчёт", STYLE.note)],
    [],
    [styled("Параметр", STYLE.header), styled("Значение", STYLE.header)],
    ["Откуда", settings.originCity],
    ["Куда / город склада PIM.Seller", settings.firstMileCity],
    ["Зона доставки по DBS", settings.lastMileZone === "region" ? "Область / регион" : "Город"],
    ["Склад WB", settings.wbWarehouse],
    ["Тип поставки WB", labelForWbSupplyType(settings.wbSupplyType)],
    ["Индекс локализации WB", settings.localizationIndex],
    ["Индекс распределения продаж WB", settings.salesDistributionIndex],
    ["Кластер доставки Ozon", settings.ozonDeliveryMode === "local" ? "Локальный кластер" : settings.ozonDeliveryCluster],
    ["Дней хранения", settings.storageDays],
    ["Быстрая сдача", settings.fastHandover ? "Да" : "Нет"],
    ["Режим НДС", settings.vatDisplayMode === "with_vat" ? "с НДС 22%" : "без НДС"],
    ["Источник комиссий WB", tariffs.logistics.wildberriesLogistics.commissionSource ?? "сomission.xlsx"],
    ["Источник тарифов Ozon", tariffs.logistics.ozonLogistics.source ?? "Тарифные справочники Ozon"],
    [],
    [
      styled("SKU", STYLE.header),
      styled("Цена", STYLE.header),
      styled("WB категория", STYLE.header),
      styled("WB предмет", STYLE.header),
      styled("Ozon категория", STYLE.header),
      styled("Ozon тип товара", STYLE.header),
      styled("Вес, кг", STYLE.header),
      styled("Длина", STYLE.header),
      styled("Ширина", STYLE.header),
      styled("Высота", STYLE.header),
      styled("На паллете", STYLE.header),
      styled("Объём, л", STYLE.header),
      styled("Объёмный вес", STYLE.header),
      styled("Расч. вес", STYLE.header),
      styled("WB габарит", STYLE.header),
      styled("Ozon габарит", STYLE.header)
    ]
  ];

  reportRows.forEach(({ sku, metrics, dimensions }) => {
    rows.push([
      sku.name,
      styled(sku.price, STYLE.money),
      sku.wbCategory,
      sku.wbSubject,
      sku.ozonCategory,
      sku.ozonProductType,
      sku.weightKg,
      sku.lengthCm,
      sku.widthCm,
      sku.heightCm,
      sku.itemsPerPallet,
      round(metrics.volumeLiters),
      round(metrics.volumetricWeightKg),
      round(metrics.chargeableKg),
      wbDimensionLabel(dimensions.wildberries),
      ozonDimensionLabel(dimensions.ozon)
    ]);
  });

  return {
    name: "Исходные данные",
    rows,
    freezeRow: 19,
    columnWidths: [24, 16, 30, 28, 30, 28, 10, 9, 9, 9, 12, 12, 15, 12, 14, 14]
  };
}

function buildAppliedTariffsSheet(
  reportRows: Array<{
    sku: SkuInput;
    result: CalculationResult;
  }>
): WorksheetDefinition {
  const rows: WorkbookCell[][] = [
    [styled("Применённые тарифы", STYLE.title)],
    [styled("Показываем только ставки и правила, реально использованные в расчёте. Внутренние коммерческие настройки PIM.Seller не выводятся.", STYLE.note)],
    [],
    [
      styled("SKU", STYLE.header),
      styled("Маркетплейс", STYLE.header),
      styled("Схема", STYLE.header),
      styled("Статья", STYLE.header),
      styled("Сумма, ₽", STYLE.header),
      styled("НДС", STYLE.header),
      styled("Расшифровка", STYLE.header)
    ]
  ];

  reportRows.forEach(({ sku, result }) => {
    flattenResults(result).forEach((schemeResult) => {
      breakdownItemsForDisplay(schemeResult).forEach((item) => {
        rows.push([
          sku.name,
          labelForMarketplace(schemeResult.marketplace),
          labelForScheme(schemeResult.scheme),
          item.label,
          styled(item.amountRub, STYLE.money),
          item.vatNote,
          item.calculationNote ?? articleFormulaText(sku, item, schemeResult)
        ]);
      });
    });
  });

  return {
    name: "Применённые тарифы",
    rows,
    freezeRow: 4,
    columnWidths: [24, 16, 10, 28, 14, 12, 86]
  };
}

function articleFormulaText(sku: SkuInput, item: CostBreakdownItem, result: SchemeResult): string {
  if (item.key === "commission") return `Цена ${formatNumber(sku.price)} × комиссия маркетплейса`;
  if (item.key === "firstMile") return `Тариф первой мили по маршруту / ${sku.itemsPerPallet} SKU на паллете`;
  if (item.key === "middleMile") return "Тариф средней мили по литражу SKU";
  if (item.key === "lastMile") return "Тариф последней мили по зоне DBS и расчётному весу";
  if (item.key === "warehouseOperations") return "Сумма складских операций PIM.Seller";
  return `${labelForMarketplace(result.marketplace)} ${labelForScheme(result.scheme)}: ${item.label}`;
}

function resultKey(skuId: string, marketplace: string, scheme: string): string {
  return `${skuId}:${marketplace}:${scheme}`;
}

function wbDimensionLabel(value: string): string {
  if (value === "kgt_plus") return "КГТ+";
  if (value === "sgt") return "СГТ";
  return "МГТ";
}

function ozonDimensionLabel(value: string): string {
  return value === "kgt" ? "КГТ" : "Стандарт";
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function styled(value: CellValue, style: number): WorkbookCell {
  return { value, style };
}

function styledFormula(formula: string, style: number): WorkbookCell {
  return { formula, style };
}

function xmlEntry(name: string, xml: string): ZipEntry {
  return { name, data: new TextEncoder().encode(xml) };
}

function contentTypesXml(sheetCount: number): string {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(worksheets: WorksheetDefinition[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${worksheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount: number): string {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function worksheetXml(sheet: WorksheetDefinition): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((cell, cellIndex) => cellXml(normalizeCell(cell), `${columnNumberToName(cellIndex + 1)}${rowNumber}`))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  const cols = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const sheetViews = sheet.freezeRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRow}" topLeftCell="A${sheet.freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  const dimension = `A1:${columnNumberToName(Math.max(...sheet.rows.map((row) => row.length), 1))}${Math.max(sheet.rows.length, 1)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  ${sheetViews}
  ${cols}
  <sheetData>${rows}</sheetData>
  ${merges}
</worksheet>`;
}

function normalizeCell(cell: WorkbookCell): { value?: CellValue; formula?: string; style?: number } {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) return cell;
  return { value: cell };
}

function cellXml(cell: { value?: CellValue; formula?: string; style?: number }, reference: string): string {
  const style = cell.style ? ` s="${cell.style}"` : "";
  if (cell.formula) return `<c r="${reference}"${style}><f>${escapeXml(cell.formula)}</f></c>`;
  if (cell.value == null || cell.value === "") return `<c r="${reference}"${style}/>`;
  if (typeof cell.value === "number") return `<c r="${reference}"${style}><v>${cell.value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(cell.value)}</t></is></c>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="# ##0.00 ₽"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
  </numFmts>
  <fonts count="5">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Arial"/></font>
    <font><b/><sz val="18"/><color rgb="FF064E3B"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF064E3B"/><name val="Arial"/></font>
    <font><sz val="10"/><color rgb="FF64748B"/><name val="Arial"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF064E3B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF7F2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF4CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD5DEE7"/></left><right style="thin"><color rgb="FFD5DEE7"/></right><top style="thin"><color rgb="FFD5DEE7"/></top><bottom style="thin"><color rgb="FFD5DEE7"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1"/></xf>
    <xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function columnNumberToName(value: number): string {
  let name = "";
  let current = value;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function escapeXml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const localHeader = new Uint8Array(30 + name.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + name.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, entry.data.length, true);
    central.setUint32(24, entry.data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + entry.data.length;
  });

  const centralDirectoryOffset = offset;
  const centralDirectory = concatBytes(centralParts);
  offset += centralDirectory.length;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, centralDirectoryOffset, true);

  return concatBytes([...localParts, centralDirectory, end]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});
