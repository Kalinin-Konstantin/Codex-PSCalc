const reportResultColumns = [
  ["wildberries", "fbo"],
  ["wildberries", "fbs"],
  ["wildberries", "dbs"],
  ["ozon", "fbo"],
  ["ozon", "fbs"],
  ["ozon", "dbs"]
];

const reportStyle = {
  title: 1,
  section: 2,
  header: 3,
  money: 4,
  percent: 5,
  bestMoney: 6,
  note: 7,
  totalMoney: 8,
  totalPercent: 9
};

const reportButton = $("download-client-report");
if (reportButton) {
  reportButton.addEventListener("click", downloadClientReport);
}

function downloadClientReport() {
  const previousPresentationMode = settings.presentationMode;
  settings.presentationMode = "client";
  try {
    const url = URL.createObjectURL(createClientReportBlob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `Расчёт PIM.Seller для клиента ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    settings.presentationMode = previousPresentationMode;
  }
}

function createClientReportBlob() {
  return new Blob([createClientReportXlsx()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function createClientReportXlsx() {
  const worksheets = buildClientReportWorksheets();
  const entries = [
    xmlEntry("[Content_Types].xml", reportContentTypesXml(worksheets.length)),
    xmlEntry("_rels/.rels", rootRelsXml()),
    xmlEntry("xl/workbook.xml", reportWorkbookXml(worksheets)),
    xmlEntry("xl/_rels/workbook.xml.rels", reportWorkbookRelsXml(worksheets.length)),
    xmlEntry("xl/styles.xml", reportStylesXml()),
    ...worksheets.map((worksheet, index) => xmlEntry(`xl/worksheets/sheet${index + 1}.xml`, reportWorksheetXml(worksheet)))
  ];
  return writeZip(entries);
}

function buildClientReportWorksheets() {
  const reportRows = skus.map((sku) => {
    const result = calculateAllSchemes(sku);
    return {
      sku,
      result,
      metrics: skuMetrics(sku),
      dimensions: classifySkuDimensions(sku),
      bestByMarketplace: reportFindBestMarketplaceResults(result)
    };
  });
  const detail = buildClientReportDetailSheet(reportRows);
  return [
    buildClientReportSummarySheet(reportRows, detail.totalRefs),
    detail.sheet,
    buildClientReportInputsSheet(reportRows),
    buildClientReportTariffsSheet(reportRows)
  ];
}

function buildClientReportSummarySheet(reportRows, totalRefs) {
  const rows = [
    [reportStyled("Клиентский расчёт PIM.Seller", reportStyle.title)],
    [
      reportStyled(
        `${settings.vatDisplayMode === "with_vat" ? "Суммы с НДС 22%" : "Суммы без НДС"} · маршрут ${settings.originCity} → ${settings.firstMileCity} · склад WB ${settings.wbWarehouse || "не выбран"}`,
        reportStyle.note
      )
    ],
    [],
    [
      reportStyled("SKU", reportStyle.header),
      reportStyled("Цена", reportStyle.header),
      reportStyled("Объём, л", reportStyle.header),
      reportStyled("Расч. вес, кг", reportStyle.header),
      reportStyled("WB габарит", reportStyle.header),
      reportStyled("Ozon габарит", reportStyle.header),
      ...reportResultColumns.flatMap(([marketplace, scheme]) => [
        reportStyled(`${marketplaceLabel(marketplace)} ${scheme.toUpperCase()}, ₽`, reportStyle.header),
        reportStyled("% цены", reportStyle.header)
      ]),
      reportStyled("Лучший WB", reportStyle.header),
      reportStyled("Лучший Ozon", reportStyle.header),
      reportStyled("Комментарий", reportStyle.header)
    ]
  ];

  reportRows.forEach(({ sku, metrics, dimensions, bestByMarketplace }) => {
    rows.push([
      sku.name,
      reportStyled(sku.price, reportStyle.money),
      money(metrics.volumeLiters),
      money(metrics.chargeableKg),
      reportWbDimensionLabel(dimensions.wildberries),
      reportOzonDimensionLabel(dimensions.ozon),
      ...reportResultColumns.flatMap(([marketplace, scheme]) => {
        const ref = totalRefs.get(reportResultKey(sku.id, marketplace, scheme));
        const isBest = bestByMarketplace[marketplace].scheme === scheme;
        return [
          reportFormula(ref ? `'Детализация'!${ref.totalCell}` : "0", isBest ? reportStyle.bestMoney : reportStyle.money),
          reportFormula(ref ? `'Детализация'!${ref.percentCell}` : "0", reportStyle.percent)
        ];
      }),
      bestByMarketplace.wildberries.scheme.toUpperCase(),
      bestByMarketplace.ozon.scheme.toUpperCase(),
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

function reportFindBestMarketplaceResults(result) {
  return {
    wildberries: reportFindBestSchemeResult([result.wildberries.fbo, result.wildberries.fbs, result.wildberries.dbs]),
    ozon: reportFindBestSchemeResult([result.ozon.fbo, result.ozon.fbs, result.ozon.dbs])
  };
}

function reportFindBestSchemeResult(results) {
  const complete = results.filter((item) => item.isComplete);
  const comparable = complete.length ? complete : results;
  return comparable.reduce((best, current) => (current.totalRub < best.totalRub ? current : best));
}

function buildClientReportDetailSheet(reportRows) {
  const rows = [
    [reportStyled("Детализация расчёта", reportStyle.title)],
    [reportStyled("Каждый блок показывает клиентские статьи затрат. Итоговые строки связаны с листом «Итоги» формулами.", reportStyle.note)],
    [],
    [
      reportStyled("SKU", reportStyle.header),
      reportStyled("Маркетплейс", reportStyle.header),
      reportStyled("Схема", reportStyle.header),
      reportStyled("Статья", reportStyle.header),
      reportStyled("Сумма, ₽", reportStyle.header),
      reportStyled("% цены", reportStyle.header),
      reportStyled("НДС", reportStyle.header),
      reportStyled("Формула / логика", reportStyle.header),
      reportStyled("Предупреждения", reportStyle.header)
    ]
  ];
  const totalRefs = new Map();

  reportRows.forEach(({ sku, result }) => {
    flattenResults(result).forEach((schemeResult) => {
      const startRow = rows.length + 1;
      const warnings = schemeResult.warnings.join("; ");
      breakdownItemsForDisplay(schemeResult).forEach((item) => {
        const rowNumber = rows.length + 1;
        rows.push([
          sku.name,
          marketplaceLabel(schemeResult.marketplace),
          schemeResult.scheme.toUpperCase(),
          item.label,
          reportStyled(item.amountRub, reportStyle.money),
          reportFormula(`IFERROR(E${rowNumber}/${schemeResult.priceBasisRub},0)`, reportStyle.percent),
          item.vatNote,
          item.calculationNote || reportArticleFormulaText(sku, item, schemeResult),
          warnings
        ]);
      });
      const totalRow = rows.length + 1;
      rows.push([
        reportStyled(sku.name, reportStyle.section),
        reportStyled(marketplaceLabel(schemeResult.marketplace), reportStyle.section),
        reportStyled(schemeResult.scheme.toUpperCase(), reportStyle.section),
        reportStyled("Итого", reportStyle.section),
        reportFormula(`SUM(E${startRow}:E${totalRow - 1})`, reportStyle.totalMoney),
        reportFormula(`IFERROR(E${totalRow}/${schemeResult.priceBasisRub},0)`, reportStyle.totalPercent),
        schemeResult.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС",
        "Итог по статьям выше",
        schemeResult.isComplete ? "" : "Схема неполная: проверьте предупреждения"
      ]);
      totalRefs.set(reportResultKey(sku.id, schemeResult.marketplace, schemeResult.scheme), {
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

function buildClientReportInputsSheet(reportRows) {
  const rows = [
    [reportStyled("Исходные данные", reportStyle.title)],
    [reportStyled("Параметры, которые повлияли на расчёт", reportStyle.note)],
    [],
    [reportStyled("Параметр", reportStyle.header), reportStyled("Значение", reportStyle.header)],
    ["Откуда", settings.originCity],
    ["Куда / город склада PIM.Seller", settings.firstMileCity],
    ["Зона доставки по DBS", settings.lastMileZone === "region" ? "Область / регион" : "Город"],
    ["Склад WB", settings.wbWarehouse],
    ["Тип поставки WB", wbSupplyLabel(settings.wbSupplyType)],
    ["Индекс локализации WB", settings.localizationIndex],
    ["Индекс распределения продаж WB", settings.salesDistributionIndex],
    ["Кластер доставки Ozon", settings.ozonDeliveryMode === "local" ? "Локальный кластер" : settings.ozonDeliveryCluster],
    ["Дней хранения", settings.storageDays],
    ["Быстрая сдача", settings.fastHandover ? "Да" : "Нет"],
    ["Режим НДС", settings.vatDisplayMode === "with_vat" ? "с НДС 22%" : "без НДС"],
    ["Источник комиссий WB", window.__PIM_DATA__.logistics.wildberriesLogistics.commissionSource || "сomission.xlsx"],
    ["Источник тарифов Ozon", window.__PIM_DATA__.logistics.ozonLogistics.source || "Тарифные справочники Ozon"],
    [],
    [
      reportStyled("SKU", reportStyle.header),
      reportStyled("Цена", reportStyle.header),
      reportStyled("WB категория", reportStyle.header),
      reportStyled("WB предмет", reportStyle.header),
      reportStyled("Ozon категория", reportStyle.header),
      reportStyled("Ozon тип товара", reportStyle.header),
      reportStyled("Вес, кг", reportStyle.header),
      reportStyled("Длина", reportStyle.header),
      reportStyled("Ширина", reportStyle.header),
      reportStyled("Высота", reportStyle.header),
      reportStyled("На паллете", reportStyle.header),
      reportStyled("Объём, л", reportStyle.header),
      reportStyled("Объёмный вес", reportStyle.header),
      reportStyled("Расч. вес", reportStyle.header),
      reportStyled("WB габарит", reportStyle.header),
      reportStyled("Ozon габарит", reportStyle.header)
    ]
  ];

  reportRows.forEach(({ sku, metrics, dimensions }) => {
    rows.push([
      sku.name,
      reportStyled(sku.price, reportStyle.money),
      sku.wbCategory,
      sku.wbSubject,
      sku.ozonCategory,
      sku.ozonProductType,
      sku.weightKg,
      sku.lengthCm,
      sku.widthCm,
      sku.heightCm,
      sku.itemsPerPallet,
      money(metrics.volumeLiters),
      money(metrics.volumetricWeightKg),
      money(metrics.chargeableKg),
      reportWbDimensionLabel(dimensions.wildberries),
      reportOzonDimensionLabel(dimensions.ozon)
    ]);
  });

  return {
    name: "Исходные данные",
    rows,
    freezeRow: 19,
    columnWidths: [24, 16, 30, 28, 30, 28, 10, 9, 9, 9, 12, 12, 15, 12, 14, 14]
  };
}

function buildClientReportTariffsSheet(reportRows) {
  const rows = [
    [reportStyled("Применённые тарифы", reportStyle.title)],
    [reportStyled("Показываем только ставки и правила, реально использованные в расчёте. Внутренние коммерческие настройки PIM.Seller не выводятся.", reportStyle.note)],
    [],
    [
      reportStyled("SKU", reportStyle.header),
      reportStyled("Маркетплейс", reportStyle.header),
      reportStyled("Схема", reportStyle.header),
      reportStyled("Статья", reportStyle.header),
      reportStyled("Сумма, ₽", reportStyle.header),
      reportStyled("НДС", reportStyle.header),
      reportStyled("Расшифровка", reportStyle.header)
    ]
  ];

  reportRows.forEach(({ sku, result }) => {
    flattenResults(result).forEach((schemeResult) => {
      breakdownItemsForDisplay(schemeResult).forEach((item) => {
        rows.push([
          sku.name,
          marketplaceLabel(schemeResult.marketplace),
          schemeResult.scheme.toUpperCase(),
          item.label,
          reportStyled(item.amountRub, reportStyle.money),
          item.vatNote,
          item.calculationNote || reportArticleFormulaText(sku, item, schemeResult)
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

function reportArticleFormulaText(sku, item, result) {
  if (item.key === "commission") return `Цена ${formatNumber(sku.price)} × комиссия маркетплейса`;
  if (item.key === "firstMile") return `Тариф первой мили по маршруту / ${sku.itemsPerPallet} SKU на паллете`;
  if (item.key === "middleMile") return "Тариф средней мили по литражу SKU";
  if (item.key === "lastMile") return "Тариф последней мили по зоне DBS и расчётному весу";
  if (item.key === "warehouseOperations") return "Сумма складских операций PIM.Seller";
  return `${marketplaceLabel(result.marketplace)} ${result.scheme.toUpperCase()}: ${item.label}`;
}

function reportResultKey(skuId, marketplace, scheme) {
  return `${skuId}:${marketplace}:${scheme}`;
}

function reportWbDimensionLabel(value) {
  if (value === "kgt_plus") return "КГТ+";
  if (value === "sgt") return "СГТ";
  return "МГТ";
}

function reportOzonDimensionLabel(value) {
  return value === "kgt" ? "КГТ" : "Стандарт";
}

function reportStyled(value, style) {
  return { value, style };
}

function reportFormula(formula, style) {
  return { formula, style };
}

function reportContentTypesXml(sheetCount) {
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

function reportWorkbookXml(worksheets) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${worksheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`;
}

function reportWorkbookRelsXml(sheetCount) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function reportWorksheetXml(sheet) {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row.map((cell, cellIndex) => reportCellXml(reportNormalizeCell(cell), `${columnNumberToName(cellIndex + 1)}${rowNumber}`)).join("");
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

function reportNormalizeCell(cell) {
  if (cell && typeof cell === "object" && !Array.isArray(cell)) return cell;
  return { value: cell };
}

function reportCellXml(cell, reference) {
  const style = cell.style ? ` s="${cell.style}"` : "";
  if (cell.formula) return `<c r="${reference}"${style}><f>${escapeXml(cell.formula)}</f></c>`;
  if (cell.value == null || cell.value === "") return `<c r="${reference}"${style}/>`;
  if (typeof cell.value === "number") return `<c r="${reference}"${style}><v>${cell.value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(cell.value)}</t></is></c>`;
}

function reportStylesXml() {
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
  <cellXfs count="10">
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
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
