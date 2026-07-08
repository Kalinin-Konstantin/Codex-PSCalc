import { readFileSync } from "node:fs";
import { mpstatsRequest } from "../src/lib/mpstats/requestCore.ts";
import { getAnalyticsPeriod } from "../src/lib/mpstats/analyticsPeriod.ts";
import { normalizeWarehouseStocks } from "../src/lib/mpstats/normalizers.ts";
import { buildSellerReportFromResponses } from "../src/lib/mpstats/sellerReportBuilder.ts";
import { resolveMarketplaceInput } from "../src/lib/mpstats/resolveInput.ts";

type RawWarehouseRow = Record<string, unknown>;

const DEFAULT_SOURCE_INPUT = "https://www.wildberries.ru/catalog/898788449/detail.aspx";
const TARGET_WAREHOUSES = [
  "id 50147328",
  "Краснодар WB СГТ",
  "Красный Бор (Питер) WB СГТ",
  "Софрино WB СГТ",
  "Новосибирск WB СГТ"
];

const APP_WAREHOUSES_BODY = {
  startRow: 0,
  endRow: 100,
  filterModel: {},
  sortModel: []
};

const BODY_VARIANTS = [
  { label: "app-body-endRow-100", body: APP_WAREHOUSES_BODY },
  { label: "no-body", body: undefined },
  { label: "endRow-500", body: { ...APP_WAREHOUSES_BODY, endRow: 500 } },
  { label: "endRow-100-sort-balance-desc", body: { ...APP_WAREHOUSES_BODY, sortModel: [{ colId: "balance", sort: "desc" }] } },
  { label: "endRow-100-sort-items-desc", body: { ...APP_WAREHOUSES_BODY, sortModel: [{ colId: "items", sort: "desc" }] } }
];

loadDotEnvLocal();

const token = process.env.MPSTATS_TOKEN;
if (!token) {
  throw new Error("MPSTATS_TOKEN is missing in .env.local.");
}
const mpstatsToken = token;

const sourceInput = process.argv[2] ?? DEFAULT_SOURCE_INPUT;
const resolvedInput = resolveMarketplaceInput({ input: sourceInput, marketplace: "wb" });
if (!resolvedInput.ok) {
  console.log(JSON.stringify({ ok: false, step: "resolve-input", error: resolvedInput.error }, null, 2));
  process.exit(1);
}

const productId = resolvedInput.data.productId;
const period = await getAnalyticsPeriod({ marketplace: "wb" });
const today = new Date().toISOString().slice(0, 10);
const item = await mpstatsRequest<unknown>({
  marketplace: "wb",
  method: "GET",
  path: `items/${productId}/full`
});

if (!item.ok) {
  console.log(JSON.stringify({ ok: false, step: "item-full", error: item.error }, null, 2));
  process.exit(1);
}

const itemRoot = unwrapRoot(item.data);
const seller = asRecord(itemRoot.seller) ?? asRecord(itemRoot.supplier);
const sellerId = stringFromUnknown(seller?.id)
  ?? stringFromUnknown(itemRoot.seller_id)
  ?? stringFromUnknown(itemRoot.sellerId)
  ?? stringFromUnknown(itemRoot.supplier_id)
  ?? stringFromUnknown(itemRoot.supplierId);
const sellerName = stringFromUnknown(seller?.name) ?? stringFromUnknown(itemRoot.seller);

if (!sellerId) {
  throw new Error("Seller ID was not found in item/full response.");
}
const resolvedSellerId = sellerId;

const appQuery = {
  path: resolvedSellerId,
  d1: period.from,
  d2: period.to
};

const queryVariants = [
  { label: "app-period-no-fbs", query: appQuery },
  { label: "app-period-fbs-0", query: { ...appQuery, fbs: "0" } },
  { label: "app-period-fbs-1", query: { ...appQuery, fbs: "1" } },
  { label: "today-d2-no-fbs", query: { ...appQuery, d2: today } },
  { label: "today-d2-fbs-1", query: { ...appQuery, d2: today, fbs: "1" } }
];

const appResult = await runWarehouseTrace("app-current", appQuery, APP_WAREHOUSES_BODY);
const variantResults = [];
for (const queryVariant of queryVariants) {
  for (const bodyVariant of BODY_VARIANTS) {
    variantResults.push(await requestRawWarehouses(
      `${queryVariant.label} / ${bodyVariant.label}`,
      queryVariant.query,
      bodyVariant.body
    ));
  }
}

const transformAudit = auditTransforms(appResult.rawRows);
const targetTrace = TARGET_WAREHOUSES.map((name) => traceWarehouse(name, appResult));

console.log(JSON.stringify({
  diagnostic: "mpstats-wb-warehouse-discrepancy",
  generatedAt: new Date().toISOString(),
  sourceInput,
  productId,
  seller: {
    sellerIdMasked: maskIdentifier(resolvedSellerId),
    sellerNamePresent: Boolean(sellerName)
  },
  currentApplicationRequest: appResult.request,
  stageCounts: {
    rawRows: appResult.rawRows.length,
    normalizedRows: appResult.normalizedRows.length,
    droppedRows: transformAudit.dropped.length,
    sellerReportRows: appResult.reportWarehouses.length,
    beforeReactRows: appResult.beforeReactRows.length
  },
  rawResponse: {
    status: appResult.status,
    rootShape: appResult.rootShape,
    first10: appResult.rawRows.slice(0, 10),
    last10: appResult.rawRows.slice(-10)
  },
  pagination: appResult.pagination,
  reportPostBody: appResult.request.body,
  normalization: {
    first10: appResult.normalizedRows.slice(0, 10),
    last10: appResult.normalizedRows.slice(-10)
  },
  droppedRows: transformAudit.dropped,
  sellerReport: {
    first10: appResult.reportWarehouses.slice(0, 10),
    last10: appResult.reportWarehouses.slice(-10)
  },
  reactInput: {
    note: "MpstatsSellerTabs passes report.warehouses directly into MpstatsWarehousesTab; MpstatsWarehousesTab maps rows without changing numeric fields.",
    first10: appResult.beforeReactRows.slice(0, 10)
  },
  targetWarehouses: targetTrace,
  variantMatrix: variantResults.map((result) => ({
    label: result.label,
    status: result.status,
    rowCount: result.rawRows.length,
    pagination: result.pagination,
    targets: TARGET_WAREHOUSES.map((name) => {
      const row = findRawWarehouse(result.rawRows, name);
      return {
        name,
        raw: row ? pickRawWarehouseFields(row) : null
      };
    })
  })),
  transformSummary: {
    sumsBalance: "No code path sums balance for WB warehouse stocks.",
    changesBalance: "normalizeWarehouseStocks only reads balance into stock.",
    changesItems: "normalizeWarehouseStocks only reads items into skuCount.",
    mergesWarehouses: "No merge/group operation found in runtime path.",
    removesWarehouses: "Rows are removed only when name, items or balance cannot be read.",
    sortsWarehouses: "normalizeWarehouseStocks sorts rows by stock desc, then skuCount desc, then name.",
    roundsValues: "No rounding is applied to warehouse stock values."
  }
}, null, 2));

async function runWarehouseTrace(label: string, query: Record<string, string>, body: unknown) {
  const raw = await requestRawWarehouses(label, query, body);
  const normalizedRows = normalizeWarehouseStocks(raw.data);
  const report = buildSellerReportFromResponses({
    seller: {
      marketplace: "wb",
      sellerId: resolvedSellerId,
      sellerName: sellerName ?? undefined,
      sourceProductId: productId
    },
    period,
    fulfillmentMode: "FBO_PLUS_FBS",
    responses: [
      { key: "summary", ok: true, data: [] },
      { key: "priceSegments", ok: true, data: [] },
      { key: "warehouses", ok: true, data: raw.data },
      { key: "subjects", ok: true, data: [] }
    ]
  });

  return {
    ...raw,
    normalizedRows,
    reportWarehouses: report.warehouses,
    beforeReactRows: report.warehouses
  };
}

async function requestRawWarehouses(label: string, query: Record<string, string>, body: unknown) {
  const url = buildUrl("https://mpstats.io/api/analytics/v1/wb/seller/warehouses", query);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Mpstats-TOKEN": mpstatsToken,
      "Content-Type": "application/json"
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = parseJson(text);
  const rawRows = extractRows(data);
  return {
    label,
    status: response.status,
    request: {
      method: "POST",
      url,
      query,
      body
    },
    data,
    rawRows,
    rootShape: describeShape(data),
    pagination: detectPagination(data)
  };
}

function auditTransforms(rows: RawWarehouseRow[]) {
  const dropped = [];
  for (const row of rows) {
    const name = pickString(row, ["name", "warehouse", "warehouseName", "store", "storeName", "store_name", "region", "regionName"]);
    const skuCount = pickNumber(row, ["skuCount", "sku_count", "items", "items_count", "skus", "sku"]);
    const stock = pickNumber(row, ["stock", "balance", "stocks", "stockQty", "balanceQty"]);
    const reasons = [];
    if (!name) reasons.push("missing store_name/name");
    if (skuCount == null) reasons.push("missing items/skuCount");
    if (stock == null) reasons.push("missing balance/stock");
    if (reasons.length) dropped.push({ row, reasons });
  }
  return { dropped };
}

function traceWarehouse(name: string, result: Awaited<ReturnType<typeof runWarehouseTrace>>) {
  const raw = findRawWarehouse(result.rawRows, name);
  const normalized = result.normalizedRows.find((row) => row.name === name) ?? null;
  const sellerReport = result.reportWarehouses.find((row) => row.name === name) ?? null;
  const beforeReact = result.beforeReactRows.find((row) => row.name === name) ?? null;
  return {
    name,
    rawMpstats: raw ? pickRawWarehouseFields(raw) : null,
    afterNormalize: normalized,
    afterSellerReport: sellerReport,
    beforeReact,
    uiDisplay: beforeReact ? {
      warehouse: beforeReact.name,
      sku: beforeReact.skuCount,
      stock: beforeReact.stock
    } : null
  };
}

function findRawWarehouse(rows: RawWarehouseRow[], name: string) {
  return rows.find((row) => pickString(row, ["store_name", "name", "warehouseName", "storeName"]) === name) ?? null;
}

function pickRawWarehouseFields(row: RawWarehouseRow) {
  return {
    store_name: row.store_name,
    balance: row.balance,
    items: row.items,
    keys: Object.keys(row)
  };
}

function detectPagination(data: unknown) {
  const root = asRecord(data);
  if (!root) {
    return {
      hasTotalRows: false,
      hasLastRow: false,
      hasCursor: false,
      hasNextPage: false
    };
  }
  return {
    hasTotalRows: "totalRows" in root || "total" in root || "total_rows" in root,
    totalRows: root.totalRows ?? root.total ?? root.total_rows,
    hasLastRow: "lastRow" in root || "last_row" in root,
    lastRow: root.lastRow ?? root.last_row,
    hasCursor: "cursor" in root || "nextCursor" in root || "next_cursor" in root,
    cursor: root.cursor ?? root.nextCursor ?? root.next_cursor,
    hasNextPage: "nextPage" in root || "next_page" in root || "hasNextPage" in root,
    nextPage: root.nextPage ?? root.next_page ?? root.hasNextPage
  };
}

function extractRows(data: unknown): RawWarehouseRow[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  const root = asRecord(data);
  if (!root) return [];
  for (const key of ["items", "rows", "data", "result", "results", "values", "table"]) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function describeShape(data: unknown) {
  if (Array.isArray(data)) {
    return {
      rootType: "array",
      length: data.length,
      firstRowFields: asRecord(data[0]) ? Object.keys(data[0]) : []
    };
  }
  const root = asRecord(data);
  if (root) {
    return {
      rootType: "object",
      fields: Object.keys(root)
    };
  }
  return {
    rootType: data == null ? "null" : typeof data
  };
}

function buildUrl(base: string, query: Record<string, string>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

function parseJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function unwrapRoot(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  if (!root) return {};
  if (asRecord(root.data)) return root.data as Record<string, unknown>;
  if (Array.isArray(root.data) && asRecord(root.data[0])) return root.data[0] as Record<string, unknown>;
  return root;
}

function pickString(row: RawWarehouseRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(row: RawWarehouseRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const number = Number(value.replace(/\s/g, "").replace(",", "."));
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function maskIdentifier(value: string) {
  return value.length <= 4 ? "***" : `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function loadDotEnvLocal() {
  const text = readFileSync(".env.local", "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    if (process.env[match[1]] == null) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}
