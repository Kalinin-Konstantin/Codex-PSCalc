import type { SkuInput, TariffData } from "./types";

export type SkuImportResult = {
  skus: SkuInput[];
  warnings: string[];
};

type RawImportRow = Record<string, string | number | null>;
type ZipEntry = {
  name: string;
  data: Uint8Array;
};

const IMPORT_SHEET_NAME = "ВГХ";
const IMPORT_HEADER_ROW = 2;
const IMPORT_FIRST_DATA_ROW = 3;
const TEMPLATE_HEADERS = [
  "Наименование",
  "Цена с НДС",
  "Ссылка на товар WB",
  "Ссылка на товар OZON",
  "WB предмет",
  "Тип товара Ozon",
  "вес",
  "длина",
  "высота",
  "ширина",
  "штук на паллете"
] as const;

export async function importSkusFromXlsxFile(file: File, tariffs: TariffData): Promise<SkuImportResult> {
  const workbook = await readXlsxWorkbook(await file.arrayBuffer());
  return buildSkusFromImportRows(workbook.rows, tariffs);
}

export function buildSkusFromImportRows(rows: RawImportRow[], tariffs: TariffData): SkuImportResult {
  const warnings: string[] = [];
  const skus: SkuInput[] = [];

  rows.forEach((row, index) => {
    const rowNumber = IMPORT_FIRST_DATA_ROW + index;
    if (isBlankImportRow(row)) return;

    const name = stringCell(row, ["Наименование"]);
    const price = numberCell(row, ["Цена с НДС", "Цена"]);
    const wbSubject = stringCell(row, ["WB предмет", "WB пердмет"]);
    const ozonProductType = stringCell(row, ["Тип товара Ozon", "Ozon тип товара", "Тип товара OZON"]);
    const weightKg = numberCell(row, ["вес", "Вес"]);
    const lengthCm = numberCell(row, ["длина", "Длина"]);
    const heightCm = numberCell(row, ["высота", "Высота"]);
    const widthCm = numberCell(row, ["ширина", "Ширина"]);
    const itemsPerPallet = numberCell(row, ["штук на паллете", "Штук на паллете", "Количество на паллете"]);

    const missing = [
      [name, "Наименование"],
      [price, "Цена с НДС"],
      [wbSubject, "WB предмет"],
      [ozonProductType, "Тип товара Ozon"],
      [weightKg, "вес"],
      [lengthCm, "длина"],
      [heightCm, "высота"],
      [widthCm, "ширина"],
      [itemsPerPallet, "штук на паллете"]
    ]
      .filter(([value]) => value == null || value === "")
      .map(([, label]) => label);

    if (missing.length) {
      warnings.push(`Строка ${rowNumber}: не заполнены обязательные поля: ${missing.join(", ")}.`);
      return;
    }

    const wbCategory = resolveWbCategory(String(wbSubject), stringCell(row, ["WB категория"]), tariffs);
    if (!wbCategory.value) {
      warnings.push(`Строка ${rowNumber}: ${wbCategory.error}`);
      return;
    }

    const ozonCategory = resolveOzonCategory(String(ozonProductType), stringCell(row, ["Ozon категория", "OZON категория"]), tariffs);
    if (!ozonCategory.value) {
      warnings.push(`Строка ${rowNumber}: ${ozonCategory.error}`);
      return;
    }

    skus.push({
      id: `import-${rowNumber}-${skus.length + 1}`,
      name: String(name),
      price: Number(price),
      wbCategory: wbCategory.value,
      wbSubject: canonicalLookupValue(String(wbSubject), tariffs.wildberriesCommissions.map((item) => item.subject)),
      ozonCategory: ozonCategory.value,
      ozonProductType: canonicalLookupValue(String(ozonProductType), tariffs.ozonCommissions.map((item) => item.productType)),
      weightKg: Number(weightKg),
      lengthCm: Number(lengthCm),
      widthCm: Number(widthCm),
      heightCm: Number(heightCm),
      itemsPerPallet: Number(itemsPerPallet)
    });
  });

  if (!skus.length && !warnings.length) {
    warnings.push("В файле не найдено строк SKU для загрузки.");
  }

  return { skus, warnings };
}

export function createSkuImportTemplateBlob(): Blob {
  const rows: Array<Array<string | number>> = [
    ["Характеристики товаров"],
    TEMPLATE_HEADERS,
    [
      "Планетарный миксер",
      15034,
      "https://www.wildberries.ru/catalog/584775688/detail.aspx",
      "https://www.ozon.ru/product/planetarnyy-mikser-elektricheskiy-kuhonnyy-4-v-1-kitfort-kt-4419-3044450223/",
      "Миксеры",
      "Миксер кухонный",
      9.42,
      30.8,
      60,
      39.6,
      30
    ]
  ];

  const entries = [
    xmlEntry("[Content_Types].xml", contentTypesXml()),
    xmlEntry("_rels/.rels", rootRelsXml()),
    xmlEntry("xl/workbook.xml", workbookXml()),
    xmlEntry("xl/_rels/workbook.xml.rels", workbookRelsXml()),
    xmlEntry("xl/worksheets/sheet1.xml", worksheetXml(rows))
  ];

  return new Blob([writeZip(entries)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

async function readXlsxWorkbook(buffer: ArrayBuffer): Promise<{ rows: RawImportRow[] }> {
  const entries = await readZipEntries(buffer);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry.data]));
  const workbookXmlText = decodeXmlEntry(entryByName, "xl/workbook.xml");
  const workbookRelsXmlText = decodeXmlEntry(entryByName, "xl/_rels/workbook.xml.rels");
  const sharedStrings = parseSharedStrings(entryByName.get("xl/sharedStrings.xml"));
  const sheetPath = resolveWorksheetPath(workbookXmlText, workbookRelsXmlText);
  const sheetXmlText = decodeXmlEntry(entryByName, sheetPath);
  return { rows: parseSheetRows(sheetXmlText, sharedStrings) };
}

async function readZipEntries(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Некорректная структура XLSX: не найден central directory.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, fileNameLength));

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    entries.push({ name, data: await decompressZipData(compressed, method) });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("Не удалось прочитать XLSX: файл не похож на книгу Excel.");
}

async function decompressZipData(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) throw new Error(`XLSX использует неподдерживаемый метод сжатия ZIP: ${method}.`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Браузер не поддерживает чтение XLSX. Откройте прототип в актуальном Chrome или Edge.");
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeXmlEntry(entryByName: Map<string, Uint8Array>, name: string): string {
  const data = entryByName.get(name);
  if (!data) throw new Error(`В XLSX не найден файл ${name}.`);
  return new TextDecoder().decode(data);
}

function resolveWorksheetPath(workbookXmlText: string, workbookRelsXmlText: string): string {
  const workbookDoc = parseXml(workbookXmlText);
  const relsDoc = parseXml(workbookRelsXmlText);
  const sheets = Array.from(workbookDoc.getElementsByTagNameNS("*", "sheet"));
  const sheet = sheets.find((item) => item.getAttribute("name") === IMPORT_SHEET_NAME) ?? sheets[0];
  const relationId = sheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? sheet?.getAttribute("r:id");
  if (!relationId) throw new Error("В XLSX не найден рабочий лист с данными SKU.");

  const relation = Array.from(relsDoc.getElementsByTagNameNS("*", "Relationship")).find((item) => item.getAttribute("Id") === relationId);
  const target = relation?.getAttribute("Target");
  if (!target) throw new Error("В XLSX не найден путь к рабочему листу с данными SKU.");
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target}`.replace(/\/[^/]+\/\.\.\//g, "/");
}

function parseSharedStrings(data?: Uint8Array): string[] {
  if (!data) return [];
  const doc = parseXml(new TextDecoder().decode(data));
  return Array.from(doc.getElementsByTagNameNS("*", "si")).map((item) =>
    Array.from(item.getElementsByTagNameNS("*", "t"))
      .map((node) => node.textContent ?? "")
      .join("")
  );
}

function parseSheetRows(sheetXmlText: string, sharedStrings: string[]): RawImportRow[] {
  const doc = parseXml(sheetXmlText);
  const cellsByRow = new Map<number, Map<number, string | number | null>>();

  Array.from(doc.getElementsByTagNameNS("*", "c")).forEach((cell) => {
    const reference = cell.getAttribute("r");
    if (!reference) return;
    const { row, column } = cellReference(reference);
    const value = parseCellValue(cell, sharedStrings);
    if (!cellsByRow.has(row)) cellsByRow.set(row, new Map());
    cellsByRow.get(row)?.set(column, value);
  });

  const headerRow = cellsByRow.get(IMPORT_HEADER_ROW);
  if (!headerRow) throw new Error("В Excel не найдена строка заголовков. Ожидаем заголовки во 2-й строке.");
  const headers = new Map<number, string>();
  headerRow.forEach((value, column) => {
    if (value != null && String(value).trim()) headers.set(column, String(value).trim());
  });

  const maxRow = Math.max(...Array.from(cellsByRow.keys()));
  const rows: RawImportRow[] = [];
  for (let rowNumber = IMPORT_FIRST_DATA_ROW; rowNumber <= maxRow; rowNumber += 1) {
    const source = cellsByRow.get(rowNumber) ?? new Map();
    const row: RawImportRow = {};
    headers.forEach((header, column) => {
      row[header] = source.get(column) ?? null;
    });
    rows.push(row);
  }
  return rows;
}

function parseCellValue(cell: Element, sharedStrings: string[]): string | number | null {
  const type = cell.getAttribute("t");
  if (type === "s") {
    const index = Number(cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "");
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagNameNS("*", "t"))
      .map((node) => node.textContent ?? "")
      .join("");
  }
  const raw = cell.getElementsByTagNameNS("*", "v")[0]?.textContent;
  if (raw == null || raw === "") return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

function cellReference(reference: string): { row: number; column: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(reference);
  if (!match) throw new Error(`Некорректная ссылка на ячейку: ${reference}.`);
  return { column: columnNameToNumber(match[1]), row: Number(match[2]) };
}

function columnNameToNumber(name: string): number {
  return name.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Не удалось прочитать XML внутри XLSX.");
  return doc;
}

function resolveWbCategory(subject: string, preferredCategory: string | null, tariffs: TariffData): { value: string | null; error?: string } {
  const entries = tariffs.wildberriesCommissions.filter((item) => sameLookupText(item.subject, subject));
  if (!entries.length) return { value: null, error: `не найден WB предмет "${subject}" в справочнике комиссий.` };
  if (preferredCategory) {
    const match = entries.find((item) => sameLookupText(item.category, preferredCategory));
    if (match) return { value: match.category };
    return { value: null, error: `WB предмет "${subject}" найден, но категория "${preferredCategory}" не совпадает со справочником.` };
  }
  const categories = unique(entries.map((item) => item.category));
  if (categories.length === 1) return { value: categories[0] };
  return { value: null, error: `WB предмет "${subject}" найден в нескольких категориях: ${categories.join(", ")}. Добавьте колонку "WB категория".` };
}

function resolveOzonCategory(productType: string, preferredCategory: string | null, tariffs: TariffData): { value: string | null; error?: string } {
  const entries = tariffs.ozonCommissions.filter((item) => sameLookupText(item.productType, productType));
  if (!entries.length) return { value: null, error: `не найден Ozon тип товара "${productType}" в справочнике комиссий.` };
  if (preferredCategory) {
    const match = entries.find((item) => sameLookupText(item.category, preferredCategory));
    if (match) return { value: match.category };
    return { value: null, error: `Ozon тип товара "${productType}" найден, но категория "${preferredCategory}" не совпадает со справочником.` };
  }
  const categories = unique(entries.filter((item) => !item.category.startsWith("Благотворительность")).map((item) => item.category));
  if (categories.length === 1) return { value: categories[0] };
  return { value: null, error: `Ozon тип товара "${productType}" найден в нескольких категориях: ${categories.join(", ")}. Добавьте колонку "Ozon категория".` };
}

function stringCell(row: RawImportRow, names: string[]): string | null {
  for (const name of names) {
    const value = row[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function numberCell(row: RawImportRow, names: string[]): number | null {
  const value = stringCell(row, names);
  if (value == null) return null;
  const numeric = Number(String(value).replace(",", ".").replace(/\s+/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function isBlankImportRow(row: RawImportRow): boolean {
  return Object.values(row).every((value) => value == null || String(value).trim() === "");
}

function sameLookupText(left: string, right: string): boolean {
  return normalizeLookupText(left) === normalizeLookupText(right);
}

function canonicalLookupValue(value: string, options: string[]): string {
  const normalized = normalizeLookupText(value);
  return options.find((option) => normalizeLookupText(option) === normalized) ?? value;
}

function normalizeLookupText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function xmlEntry(name: string, xml: string): ZipEntry {
  return { name, data: new TextEncoder().encode(xml) };
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(IMPORT_SHEET_NAME)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function worksheetXml(rows: Array<Array<string | number>>): string {
  const rowXml = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const offset = rowIndex === 0 ? 2 : 2;
      const cells = row
        .map((value, cellIndex) => {
          const reference = `${columnNumberToName(offset + cellIndex)}${rowNumber}`;
          if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
          return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
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
