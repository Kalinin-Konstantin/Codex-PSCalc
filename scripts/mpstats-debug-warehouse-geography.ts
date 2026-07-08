import { readFileSync } from "node:fs";
import { resolveMarketplaceInput } from "../src/lib/mpstats/resolveInput.ts";
import { mpstatsRequest } from "../src/lib/mpstats/requestCore.ts";
import type { Marketplace, MpstatsRequestMethod, MpstatsRequestOptions, MpstatsResult } from "../src/lib/mpstats/types.ts";

type RequestVariant = {
  label: string;
  marketplace: Marketplace;
  method: MpstatsRequestMethod;
  path: string;
  query?: MpstatsRequestOptions["query"];
  body?: unknown;
};

type ResolvedItem = {
  marketplace: Marketplace;
  productId: string;
  sellerId: string | null;
  sellerName: string | null;
  sellerPath: string | null;
  itemFields: string[];
  categoryHints: SanitizedHint[];
};

type SanitizedHint = {
  key: string;
  valueType: string;
  value?: string | number | boolean | null;
  fields?: string[];
};

type DiagnosticResponse = {
  label: string;
  endpoint: string;
  method: MpstatsRequestMethod;
  request: {
    query?: MpstatsRequestOptions["query"];
    bodyShape?: unknown;
  };
  ok: boolean;
  status: number;
  error?: {
    code: string;
    message: string;
    retryAfterSeconds?: number;
  };
  topLevelFields: string[];
  dataShape: {
    rootType: string;
    arrayLength?: number;
    firstRowFields?: string[];
    namedArrays?: Record<string, number>;
    rowCount?: number;
  };
  usableData: boolean;
  usableReason: string;
};

const DEFAULT_INPUTS = [
  "https://www.wildberries.ru/catalog/949100852/detail.aspx?targetUrl=MI",
  "https://www.wildberries.ru/catalog/203928338/detail.aspx?targetUrl=MI",
  "https://www.wildberries.ru/catalog/717183366/detail.aspx?targetUrl=MI",
  "https://www.ozon.ru/product/xiaomi-smartfon-poco-c85-rostest-eac-6-128-gb-nano-sim-chernyy-2802485119/?__rr=1&at=99trX6NDji2WwyrwHrMGO1YcxJgvGVTQmOyQptLwGmkw",
  "https://www.ozon.ru/product/weissgauff-aerogril-waf-515-gb-air-cook-master-moshchnost-1500-vt-obem-chashi-5-5-litrov-3031871315/?at=Y7tjqvpwXf1GQBA7hkkAyzPSDGKgz5sr1v0wOfWqERE1",
  "https://www.ozon.ru/product/postelnoe-bele-evro-strayp-satin-dvuspalnyy-komplekt-mr-mrs-home-1720548001/?at=lRt683PjlC94MEx4uyNO5GkILjJOV5sggVvOAfJ9R8jN"
];

const REPORT_POST_BODY = {
  startRow: 0,
  endRow: 100,
  filterModel: {},
  sortModel: []
};

loadDotEnvLocal();

const inputs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_INPUTS;
const period = lastThirtyDaysPeriod();

const resolvedItems: ResolvedItem[] = [];
const diagnostics: Array<ResolvedItem & { responses: DiagnosticResponse[] }> = [];

for (const input of inputs) {
  const resolved = resolveMarketplaceInput({ input, marketplace: "auto" });
  if (!resolved.ok) {
    diagnostics.push({
      marketplace: "wb",
      productId: "[unresolved]",
      sellerId: null,
      sellerName: null,
      sellerPath: null,
      itemFields: [],
      categoryHints: [],
      responses: [{
        label: "resolve-input",
        endpoint: "local parser",
        method: "GET",
        request: {},
        ok: false,
        status: resolved.error.status ?? 400,
        error: {
          code: resolved.error.code,
          message: resolved.error.message
        },
        topLevelFields: [],
        dataShape: { rootType: "none" },
        usableData: false,
        usableReason: "Input parser did not resolve marketplace/productId."
      }]
    });
    continue;
  }

  const itemFull = await mpstatsRequest<unknown>({
    marketplace: resolved.data.marketplace,
    method: "GET",
    path: `items/${resolved.data.productId}/full`
  });

  const item = summarizeItemFull(resolved.data.marketplace, resolved.data.productId, itemFull);
  resolvedItems.push(item);

  const variants = buildVariants(item);
  const responses: DiagnosticResponse[] = [];
  for (const variant of variants) {
    const result = await mpstatsRequest<unknown>({
      marketplace: variant.marketplace,
      method: variant.method,
      path: variant.path,
      query: variant.query,
      body: variant.body,
      timeoutMs: 20000
    });
    responses.push(summarizeResponse(variant, result));
  }

  diagnostics.push({ ...item, responses });
}

const output = {
  generatedAt: new Date().toISOString(),
  period,
  tokenConfigured: Boolean(process.env.MPSTATS_TOKEN),
  inputsChecked: inputs.length,
  resolvedItems: resolvedItems.map((item) => ({
    marketplace: item.marketplace,
    productId: item.productId,
    sellerId: maskIdentifier(item.sellerId),
    sellerName: maskName(item.sellerName),
    sellerPathSource: item.sellerId ? "sellerId" : item.sellerName ? "sellerName" : null,
    itemFields: item.itemFields,
    categoryHints: item.categoryHints
  })),
  diagnostics: diagnostics.map((entry) => ({
    marketplace: entry.marketplace,
    productId: entry.productId,
    sellerId: maskIdentifier(entry.sellerId),
    sellerName: maskName(entry.sellerName),
    sellerPathSource: entry.sellerId ? "sellerId" : entry.sellerName ? "sellerName" : null,
    responses: entry.responses
  }))
};

console.log(JSON.stringify(output, null, 2));

function buildVariants(item: ResolvedItem): RequestVariant[] {
  if (!item.sellerPath) return [];

  const pathHints = [
    item.sellerPath,
    ...item.categoryHints
      .map((hint) => hint.value)
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
      .map(String)
  ];
  const uniquePathHints = [...new Set(pathHints)].slice(0, 8);

  if (item.marketplace === "wb") {
    return [
      ...buildWbEndpointVariants("seller/warehouses", "wb-warehouses", item.sellerPath, uniquePathHints),
      ...buildWbEndpointVariants("seller/subjects", "wb-subjects", item.sellerPath, uniquePathHints)
    ];
  }

  return [
    {
      label: "ozon-geography-get-date-seller-path",
      marketplace: "ozon",
      method: "GET",
      path: "seller/geography",
      query: { path: item.sellerPath, date: period.month }
    },
    {
      label: "ozon-geography-post-docs-grid-body",
      marketplace: "ozon",
      method: "POST",
      path: "seller/geography",
      query: { path: item.sellerPath, d1: period.from, d2: period.to, fbs: "0" },
      body: REPORT_POST_BODY
    },
    {
      label: "ozon-geography-post-docs-grid-body-fbs",
      marketplace: "ozon",
      method: "POST",
      path: "seller/geography",
      query: { path: item.sellerPath, d1: period.from, d2: period.to, fbs: "1" },
      body: REPORT_POST_BODY
    },
    ...buildOzonNicheVariants(item.sellerPath)
  ];
}

function buildWbEndpointVariants(
  path: string,
  prefix: string,
  sellerPath: string,
  pathHints: string[]
): RequestVariant[] {
  const variants: RequestVariant[] = [
    {
      label: `${prefix}-query-path-no-body`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { path: sellerPath, d1: period.from, d2: period.to }
    },
    {
      label: `${prefix}-query-path-grid-body`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { path: sellerPath, d1: period.from, d2: period.to },
      body: REPORT_POST_BODY
    },
    {
      label: `${prefix}-query-path-grid-body-fbs`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { path: sellerPath, d1: period.from, d2: period.to, fbs: "1" },
      body: REPORT_POST_BODY
    },
    {
      label: `${prefix}-body-seller`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { d1: period.from, d2: period.to },
      body: { seller: sellerPath, d1: period.from, d2: period.to }
    },
    {
      label: `${prefix}-body-seller-id`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { d1: period.from, d2: period.to },
      body: { sellerId: sellerPath, d1: period.from, d2: period.to }
    },
    {
      label: `${prefix}-body-id`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { d1: period.from, d2: period.to },
      body: { id: sellerPath, d1: period.from, d2: period.to }
    },
    {
      label: `${prefix}-query-date-body-seller`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { date: period.month },
      body: { seller: sellerPath }
    },
    {
      label: `${prefix}-query-date-body-seller-id`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { date: period.month },
      body: { sellerId: sellerPath }
    },
    {
      label: `${prefix}-body-supplier`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { d1: period.from, d2: period.to },
      body: { supplier: sellerPath, d1: period.from, d2: period.to }
    },
    {
      label: `${prefix}-body-supplier-id`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { d1: period.from, d2: period.to },
      body: { supplierId: sellerPath, d1: period.from, d2: period.to }
    }
  ];

  for (const hint of pathHints) {
    variants.push({
      label: `${prefix}-query-path-hint-${hashLabel(hint)}`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { path: hint, d1: period.from, d2: period.to },
      body: REPORT_POST_BODY
    });
    variants.push({
      label: `${prefix}-body-path-hint-${hashLabel(hint)}`,
      marketplace: "wb",
      method: "POST",
      path,
      query: { d1: period.from, d2: period.to },
      body: { path: hint, d1: period.from, d2: period.to, ...REPORT_POST_BODY }
    });
  }

  return variants;
}

function buildOzonNicheVariants(sellerPath: string): RequestVariant[] {
  return [
    {
      label: "ozon-niches-post-docs-grid-body",
      marketplace: "ozon",
      method: "POST",
      path: "seller/niches",
      query: { path: sellerPath, d1: period.from, d2: period.to, fbs: "0" },
      body: REPORT_POST_BODY
    },
    {
      label: "ozon-niches-post-docs-grid-body-fbs",
      marketplace: "ozon",
      method: "POST",
      path: "seller/niches",
      query: { path: sellerPath, d1: period.from, d2: period.to, fbs: "1" },
      body: REPORT_POST_BODY
    },
    {
      label: "ozon-niches-post-docs-no-body-fbs",
      marketplace: "ozon",
      method: "POST",
      path: "seller/niches",
      query: { path: sellerPath, d1: period.from, d2: period.to, fbs: "1" }
    },
    {
      label: "ozon-niches-post-docs-grid-body-fbs-true",
      marketplace: "ozon",
      method: "POST",
      path: "seller/niches",
      query: { path: sellerPath, d1: period.from, d2: period.to, fbs: "true" },
      body: REPORT_POST_BODY
    },
    {
      label: "ozon-niches-post-current-empty-body",
      marketplace: "ozon",
      method: "POST",
      path: "seller/niches",
      query: { path: sellerPath, d1: period.from, d2: period.to, fbs: "0" },
      body: {}
    },
    {
      label: "ozon-niches-post-path-date-grid-body",
      marketplace: "ozon",
      method: "POST",
      path: "seller/niches",
      query: { path: sellerPath, date: period.month },
      body: REPORT_POST_BODY
    },
    {
      label: "ozon-niches-get-path-date",
      marketplace: "ozon",
      method: "GET",
      path: "seller/niches",
      query: { path: sellerPath, date: period.month }
    },
    {
      label: "ozon-niches-get-path-period",
      marketplace: "ozon",
      method: "GET",
      path: "seller/niches",
      query: { path: sellerPath, d1: period.from, d2: period.to }
    },
    {
      label: "ozon-niches-get-path-date-seller",
      marketplace: "ozon",
      method: "GET",
      path: "seller/niches",
      query: { path: sellerPath, date: period.month, seller: sellerPath }
    },
    {
      label: "ozon-niches-get-path-date-seller-id",
      marketplace: "ozon",
      method: "GET",
      path: "seller/niches",
      query: { path: sellerPath, date: period.month, sellerId: sellerPath }
    }
  ];
}

function summarizeItemFull(marketplace: Marketplace, productId: string, result: MpstatsResult<unknown>): ResolvedItem {
  if (!result.ok) {
    return {
      marketplace,
      productId,
      sellerId: null,
      sellerName: null,
      sellerPath: null,
      itemFields: [],
      categoryHints: [{
        key: "itemFullError",
        valueType: "error",
        value: `${result.error.code}:${result.error.status ?? "unknown"}`
      }]
    };
  }

  const root = unwrapPayload(result.data);
  const seller = getRecord(root, "seller") ?? getRecord(root, "supplier");
  const sellerId = stringFromUnknown(
    seller?.id
    ?? root.seller_id
    ?? root.sellerId
    ?? root.supplier_id
    ?? root.supplierId
  );
  const sellerName = stringFromUnknown(
    seller?.name
    ?? root.seller_name
    ?? root.sellerName
    ?? root.supplier_name
    ?? root.supplierName
    ?? (typeof root.seller === "string" ? root.seller : null)
  );

  return {
    marketplace,
    productId,
    sellerId,
    sellerName,
    sellerPath: sellerId ?? sellerName,
    itemFields: Object.keys(root).sort(),
    categoryHints: extractCategoryHints(root)
  };
}

function summarizeResponse(variant: RequestVariant, result: MpstatsResult<unknown>): DiagnosticResponse {
  if (!result.ok) {
    return {
      label: variant.label,
      endpoint: variant.path,
      method: variant.method,
      request: sanitizeRequest(variant),
      ok: false,
      status: result.error.status ?? 0,
      error: {
        code: result.error.code,
        message: result.error.message,
        retryAfterSeconds: result.error.retryAfterSeconds
      },
      topLevelFields: [],
      dataShape: { rootType: "error" },
      usableData: false,
      usableReason: `MPStats returned ${result.error.status ?? result.error.code}.`
    };
  }

  const shape = summarizeShape(result.data);
  const usable = isUsableData(result.data);
  return {
    label: variant.label,
    endpoint: variant.path,
    method: variant.method,
    request: sanitizeRequest(variant),
    ok: true,
    status: 200,
    topLevelFields: topLevelFields(result.data),
    dataShape: shape,
    usableData: usable.ok,
    usableReason: usable.reason
  };
}

function sanitizeRequest(variant: RequestVariant): DiagnosticResponse["request"] {
  return {
    query: sanitizeQuery(variant.query),
    bodyShape: summarizeBodyShape(variant.body)
  };
}

function sanitizeQuery(query: MpstatsRequestOptions["query"]): MpstatsRequestOptions["query"] {
  if (!query) return undefined;
  const sanitized: NonNullable<MpstatsRequestOptions["query"]> = {};
  for (const [key, value] of Object.entries(query)) {
    sanitized[key] = shouldMaskQueryValue(key, value) ? maskIdentifier(String(value)) : value;
  }
  return sanitized;
}

function shouldMaskQueryValue(key: string, value: unknown) {
  if (value == null) return false;
  if (key === "path" || key === "seller" || key === "sellerId" || key === "supplier" || key === "supplierId") return true;
  return false;
}

function summarizeBodyShape(body: unknown): unknown {
  if (body == null) return undefined;
  if (Array.isArray(body)) return { type: "array", length: body.length };
  if (isRecord(body)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      result[key] = isRecord(value)
        ? { type: "object", fields: Object.keys(value).sort() }
        : Array.isArray(value)
          ? { type: "array", length: value.length }
          : typeof value;
    }
    return result;
  }
  return { type: typeof body };
}

function summarizeShape(payload: unknown): DiagnosticResponse["dataShape"] {
  if (Array.isArray(payload)) {
    return {
      rootType: "array",
      arrayLength: payload.length,
      firstRowFields: payload.find(isRecord) ? Object.keys(payload.find(isRecord) as Record<string, unknown>).sort() : undefined,
      rowCount: payload.filter(isRecord).length
    };
  }

  if (!isRecord(payload)) return { rootType: typeof payload };

  const namedArrays: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) namedArrays[key] = value.length;
  }

  const rows = extractRows(payload);
  return {
    rootType: "object",
    firstRowFields: rows[0] ? Object.keys(rows[0]).sort() : undefined,
    namedArrays,
    rowCount: rows.length
  };
}

function isUsableData(payload: unknown): { ok: boolean; reason: string } {
  const rows = extractRows(payload);
  if (!rows.length) return { ok: false, reason: "No rows or named data arrays found." };

  const first = rows[0];
  const fields = new Set(Object.keys(first));
  const hasMetric = [
    "revenue",
    "sales",
    "orders",
    "count",
    "qty",
    "stock",
    "storage_data",
    "region_data",
    "name",
    "subject",
    "niche"
  ].some((field) => fields.has(field));

  return hasMetric
    ? { ok: true, reason: "Response contains rows with recognizable analytic fields." }
    : { ok: false, reason: "Rows found, but no known analytic fields were detected." };
}

function extractRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of ["data", "items", "rows", "result", "results", "values", "table", "storage_data", "region_data"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  const nestedRows = Object.values(payload)
    .filter(isRecord)
    .flatMap((value) => Object.values(value).filter(Array.isArray))
    .flatMap((value) => value.filter(isRecord));
  if (nestedRows.length) return nestedRows;

  return Object.keys(payload).length ? [payload] : [];
}

function topLevelFields(payload: unknown): string[] {
  if (Array.isArray(payload)) return ["[array]"];
  if (!isRecord(payload)) return [];
  return Object.keys(payload).sort();
}

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.data)) return payload.data;
  if (Array.isArray(payload.data) && isRecord(payload.data[0])) return payload.data[0];
  return payload;
}

function extractCategoryHints(root: Record<string, unknown>): SanitizedHint[] {
  const hintKeys = new Set([
    "path",
    "category",
    "categoryPath",
    "subject",
    "subjectId",
    "subjectPath",
    "parent",
    "kind",
    "niche",
    "root",
    "breadcrumbs",
    "categories",
    "category_id",
    "subject_id",
    "path_name",
    "path_id",
    "url"
  ]);
  const hints: SanitizedHint[] = [];

  function visit(value: unknown, parentKey: string, depth: number) {
    if (depth > 3 || hints.length >= 30) return;

    if (Array.isArray(value)) {
      if (hintKeys.has(parentKey)) {
        hints.push({
          key: parentKey,
          valueType: "array",
          fields: value.filter(isRecord).slice(0, 3).flatMap((item) => Object.keys(item)).sort()
        });
      }
      for (const item of value.slice(0, 5)) visit(item, parentKey, depth + 1);
      return;
    }

    if (!isRecord(value)) return;

    for (const [key, nested] of Object.entries(value)) {
      if (hintKeys.has(key)) hints.push(sanitizeHint(key, nested));
      if (isRecord(nested) || Array.isArray(nested)) visit(nested, key, depth + 1);
    }
  }

  visit(root, "root", 0);
  return hints;
}

function sanitizeHint(key: string, value: unknown): SanitizedHint {
  if (isRecord(value)) {
    return {
      key,
      valueType: "object",
      fields: Object.keys(value).sort()
    };
  }
  if (Array.isArray(value)) {
    return {
      key,
      valueType: "array",
      fields: value.filter(isRecord).slice(0, 3).flatMap((item) => Object.keys(item)).sort()
    };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return {
      key,
      valueType: "string",
      value: /^\d+$/.test(trimmed) ? trimmed : maskName(trimmed)
    };
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return {
      key,
      valueType: value == null ? "null" : typeof value,
      value
    };
  }
  return { key, valueType: typeof value };
}

function getRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return isRecord(value) ? value : null;
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function maskName(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 2 ? "**" : `${value.slice(0, 2)}***(${value.length})`;
}

function maskIdentifier(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function hashLabel(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function lastThirtyDaysPeriod() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);

  return {
    from: formatDate(from),
    to: formatDate(to),
    month: formatDate(from).slice(0, 7),
    days: 30
  };
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function loadDotEnvLocal() {
  try {
    const content = readFileSync(".env.local", "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] != null) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // The caller will see tokenConfigured=false in sanitized output.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
