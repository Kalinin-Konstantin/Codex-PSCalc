import type {
  OzonGeographyItem,
  PriceSegment,
  SellerSummary,
  SubjectDistributionItem,
  WarehouseStockItem
} from "./types";

type RecordValue = Record<string, unknown>;

const REVENUE_KEYS = ["revenue", "revenueRub", "sum", "amount", "turnover", "ordered_rub", "orders_sum"];
const SALES_KEYS = ["sales", "orders", "ordersCount", "salesCount", "quantity", "qty", "count", "sold"];
const ITEM_KEYS = ["items", "products", "sku", "skus", "skuCount", "items_count", "products_count"];
const ITEMS_WITH_SALES_KEYS = [
  "itemsWithSales",
  "skuWithSales",
  "items_with_sales",
  "sku_with_sales",
  "items_with_sells",
  "sku_with_sells"
];
const STOCK_KEYS = ["stock", "balance", "stocks", "stockQty", "balanceQty"];

export function normalizeSellerSummary(payload: unknown): SellerSummary {
  const root = unwrapRoot(payload);
  const rows = extractRows(root);
  const direct = isRecord(root) ? root : null;

  const revenue = directNumber(direct, REVENUE_KEYS) ?? sumRows(rows, REVENUE_KEYS);
  const sales = directNumber(direct, SALES_KEYS) ?? sumRows(rows, SALES_KEYS);
  const items = directNumber(direct, ITEM_KEYS) ?? maxRows(rows, ITEM_KEYS);
  const itemsWithSales = directNumber(direct, ITEMS_WITH_SALES_KEYS) ?? maxRows(rows, ITEMS_WITH_SALES_KEYS);

  return {
    revenue,
    sales,
    items,
    itemsWithSales,
    avgCheck: revenue != null && sales != null && sales > 0 ? roundMetric(revenue / sales) : null
  };
}

export function normalizePriceSegments(payload: unknown): PriceSegment[] {
  const rows = extractRows(unwrapRoot(payload));
  const segments = rows
    .map((row) => {
      const minPrice = pickNumber(row, ["minPrice", "min_price", "min_range_price", "from", "price_from", "priceFrom", "min"]);
      const maxPrice = pickNumber(row, ["maxPrice", "max_price", "max_range_price", "to", "price_to", "priceTo", "max"]);
      return {
        label: pickString(row, ["label", "name", "range", "price_range", "priceRange"]) ?? formatRange(minPrice, maxPrice),
        minPrice,
        maxPrice,
        sales: pickNumber(row, SALES_KEYS),
        revenue: pickNumber(row, REVENUE_KEYS),
        items: pickNumber(row, ITEM_KEYS),
        salesShare: pickNumber(row, ["salesShare", "sales_share"]),
        revenueShare: pickNumber(row, ["revenueShare", "revenue_share", "share"])
      };
    })
    .filter((segment) => segment.label || segment.minPrice != null || segment.maxPrice != null);

  const withShares = calculateShares(segments, "sales", "salesShare", "revenue", "revenueShare");
  return withShares.sort((left, right) => compareNullableNumbers(left.minPrice, right.minPrice));
}

export function normalizeWarehouseStocks(payload: unknown): WarehouseStockItem[] {
  const rows = extractRows(unwrapRoot(payload));
  return rows
    .map((row) => ({
      name: pickString(row, ["name", "warehouse", "warehouseName", "store", "storeName", "store_name", "region", "regionName"]) ?? "",
      skuCount: pickNumber(row, ["skuCount", "sku_count", "items", "items_count", "skus", "sku"]),
      stock: pickNumber(row, STOCK_KEYS)
    }))
    .filter((warehouse) => (
      warehouse.name
      && warehouse.skuCount != null
      && warehouse.stock != null
    ))
    .sort(compareWarehouseStockRows);
}

export function normalizeOzonGeography(payload: unknown): OzonGeographyItem[] {
  const root = unwrapRoot(payload);
  const rows = isRecord(root) && Array.isArray(root.storage_data)
    ? root.storage_data.filter(isRecord)
    : extractRows(root);

  return rows
    .map((row) => ({
      name: pickString(row, ["name", "warehouse", "warehouseName", "store", "storeName", "store_name"]) ?? "",
      region: pickString(row, ["region", "regionName"]) ?? null,
      sales: pickNumber(row, ["sales"]),
      count: pickNumber(row, ["count"]),
      revenue: pickNumber(row, ["revenue"]),
      salesShare: pickNumber(row, ["sales_percent"]),
      countShare: pickNumber(row, ["count_percent"]),
      revenueShare: pickNumber(row, ["revenue_percent"])
    }))
    .filter((item) => item.name);
}

export function normalizeSubjects(payload: unknown): SubjectDistributionItem[] {
  const rows = extractRows(unwrapRoot(payload));
  const subjects = rows
    .map((row) => ({
      name: pickString(row, ["name", "subject", "subjectName", "niche", "nicheName", "category", "categoryName"]) ?? "",
      sales: pickNumber(row, SALES_KEYS),
      revenue: pickNumber(row, REVENUE_KEYS),
      stock: pickNumber(row, STOCK_KEYS),
      revenueShare: pickNumber(row, ["revenueShare", "revenue_share", "share"])
    }))
    .filter((subject) => subject.name);

  const totalRevenue = sumValues(subjects.map((subject) => subject.revenue));
  return subjects
    .map((subject) => ({
      ...subject,
      revenueShare: subject.revenueShare ?? shareOf(subject.revenue, totalRevenue)
    }))
    .sort(compareDistributionRows);
}

export function calculateShares<
  T extends Record<string, unknown>,
  SalesKey extends keyof T,
  SalesShareKey extends keyof T,
  RevenueKey extends keyof T,
  RevenueShareKey extends keyof T
>(
  rows: T[],
  salesKey: SalesKey,
  salesShareKey: SalesShareKey,
  revenueKey: RevenueKey,
  revenueShareKey: RevenueShareKey
): T[] {
  const totalSales = sumValues(rows.map((row) => safeNumber(row[salesKey])));
  const totalRevenue = sumValues(rows.map((row) => safeNumber(row[revenueKey])));

  return rows.map((row) => ({
    ...row,
    [salesShareKey]: safeNumber(row[salesShareKey]) ?? shareOf(safeNumber(row[salesKey]), totalSales),
    [revenueShareKey]: safeNumber(row[revenueShareKey]) ?? shareOf(safeNumber(row[revenueKey]), totalRevenue)
  }));
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value
      .replace(/\s+/g, "")
      .replace("%", "")
      .replace("₽", "")
      .replace(",", ".");
    if (!normalized) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function unwrapRoot(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if ("data" in payload) return payload.data;
  return payload;
}

function extractRows(payload: unknown): RecordValue[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of ["items", "rows", "data", "result", "results", "values", "table", "storage_data", "region_data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [payload];
}

function directNumber(source: RecordValue | null, keys: string[]) {
  return source ? pickNumber(source, keys) : null;
}

function sumRows(rows: RecordValue[], keys: string[]) {
  return sumValues(rows.map((row) => pickNumber(row, keys)));
}

function maxRows(rows: RecordValue[], keys: string[]) {
  const values = rows.map((row) => pickNumber(row, keys)).filter((value): value is number => value != null);
  return values.length ? Math.max(...values) : null;
}

function sumValues(values: Array<number | null>) {
  const numeric = values.filter((value): value is number => value != null);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0);
}

function pickNumber(source: RecordValue, keys: string[]) {
  for (const key of keys) {
    const value = safeNumber(source[key]);
    if (value != null) return value;
  }
  return null;
}

function pickString(source: RecordValue, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function shareOf(value: number | null, total: number | null) {
  if (value == null || total == null || total <= 0) return null;
  return roundMetric(value / total);
}

function formatRange(minPrice: number | null, maxPrice: number | null) {
  if (minPrice != null && maxPrice != null) return `${minPrice}-${maxPrice}`;
  if (minPrice != null) return `от ${minPrice}`;
  if (maxPrice != null) return `до ${maxPrice}`;
  return "Без диапазона";
}

function compareNullableNumbers(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function compareDistributionRows(left: { revenue?: number | null; sales?: number | null }, right: { revenue?: number | null; sales?: number | null }) {
  const revenueDiff = (right.revenue ?? -1) - (left.revenue ?? -1);
  if (revenueDiff !== 0) return revenueDiff;
  return (right.sales ?? -1) - (left.sales ?? -1);
}

function compareWarehouseStockRows(left: WarehouseStockItem, right: WarehouseStockItem) {
  const stockDiff = (right.stock ?? -1) - (left.stock ?? -1);
  if (stockDiff !== 0) return stockDiff;
  const skuDiff = (right.skuCount ?? -1) - (left.skuCount ?? -1);
  if (skuDiff !== 0) return skuDiff;
  return left.name.localeCompare(right.name, "ru");
}

function roundMetric(value: number) {
  return Math.round(value * 10000) / 10000;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
