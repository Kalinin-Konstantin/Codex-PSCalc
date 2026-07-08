import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mpstatsRequest } from "../src/lib/mpstats/requestCore.ts";
import { resolveMarketplaceInput } from "../src/lib/mpstats/resolveInput.ts";
import type { Marketplace, MpstatsRequestMethod, MpstatsRequestOptions } from "../src/lib/mpstats/types.ts";

type SupportEndpoint = {
  title: string;
  marketplace: Marketplace;
  method: MpstatsRequestMethod;
  path: string;
  query: Record<string, string>;
  body?: unknown;
  sourceInput: string;
};

type ResolvedSeller = {
  marketplace: Marketplace;
  productId: string;
  itemFullPath: string;
  itemFullStatus: number;
  sellerId: string;
  sellerName: string;
};

type RawDiagnostic = {
  endpoint: SupportEndpoint;
  requestUrl: string;
  queryString: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  status: number;
  responseHeaders: Record<string, string>;
  diagnosticIds: Record<string, string>;
  responseBody: string;
};

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(PROJECT_ROOT, "docs/mpstats-support-diagnostics.md");
const MASKED_TOKEN = "**************";
const REPORT_POST_BODY = {
  startRow: 0,
  endRow: 100,
  filterModel: {},
  sortModel: []
};

const SUPPORT_INPUTS = {
  wb: "https://www.wildberries.ru/catalog/898788449/detail.aspx",
  ozon: "https://www.ozon.ru/product/stiralnaya-mashina-hotpoint-nss-6015-k-v-ru-uzkaya-s-parom-6-kg-glubina-42-5-sm-1000-ob-min-16-4655965383/"
};

loadDotEnvLocal();

const token = requireToken();

const period = lastThirtyDaysPeriod();
const wbSeller = await resolveSeller(SUPPORT_INPUTS.wb, "wb");
const ozonSeller = await resolveSeller(SUPPORT_INPUTS.ozon, "ozon");

const endpoints: SupportEndpoint[] = [
  {
    title: "WB seller/warehouses",
    marketplace: "wb",
    method: "POST",
    path: "seller/warehouses",
    query: { path: wbSeller.sellerId, d1: period.from, d2: period.to, fbs: "1" },
    sourceInput: SUPPORT_INPUTS.wb
  },
  {
    title: "WB seller/subjects",
    marketplace: "wb",
    method: "POST",
    path: "seller/subjects",
    query: { path: wbSeller.sellerId, d1: period.from, d2: period.to, fbs: "1" },
    sourceInput: SUPPORT_INPUTS.wb
  },
  {
    title: "Ozon seller/niches",
    marketplace: "ozon",
    method: "POST",
    path: "seller/niches",
    query: { path: ozonSeller.sellerId, d1: period.from, d2: period.to, fbs: "1" },
    body: REPORT_POST_BODY,
    sourceInput: SUPPORT_INPUTS.ozon
  }
];

const diagnostics: RawDiagnostic[] = [];
for (const endpoint of endpoints) {
  diagnostics.push(await runRawDiagnostic(endpoint));
}

const markdown = buildMarkdown({
  generatedAt: new Date().toISOString(),
  period,
  sellers: {
    wb: wbSeller,
    ozon: ozonSeller
  },
  diagnostics
});

assertNoSecretLeak(markdown, token);
writeFileSync(OUTPUT_PATH, markdown, "utf-8");
console.log(`MPStats support diagnostics written to ${OUTPUT_PATH}`);

async function resolveSeller(input: string, expectedMarketplace: Marketplace): Promise<ResolvedSeller> {
  const parsed = resolveMarketplaceInput({ input, marketplace: expectedMarketplace });
  if (!parsed.ok) {
    throw new Error(`Could not parse ${expectedMarketplace} input: ${parsed.error.code}`);
  }

  const itemFullPath = `items/${parsed.data.productId}/full`;
  const itemFull = await mpstatsRequest<unknown>({
    marketplace: parsed.data.marketplace,
    method: "GET",
    path: itemFullPath,
    timeoutMs: 20000
  });

  if (!itemFull.ok) {
    throw new Error(`GET ${itemFullPath} failed for ${expectedMarketplace}: ${itemFull.error.code}`);
  }

  const root = unwrapPayload(itemFull.data);
  const seller = readObject(root.seller) ?? readObject(root.supplier);
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

  if (!sellerId) {
    throw new Error(`GET ${itemFullPath} did not return seller.id for ${expectedMarketplace}.`);
  }

  return {
    marketplace: expectedMarketplace,
    productId: parsed.data.productId,
    itemFullPath,
    itemFullStatus: 200,
    sellerId,
    sellerName: sellerName ?? "<seller name not present>"
  };
}

async function runRawDiagnostic(endpoint: SupportEndpoint): Promise<RawDiagnostic> {
  const url = buildUrl(endpoint.marketplace, endpoint.path, endpoint.query);
  const requestHeaders = {
    "X-Mpstats-TOKEN": MASKED_TOKEN,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*"
  };
  const body = endpoint.method === "POST" && endpoint.body !== undefined
    ? JSON.stringify(endpoint.body)
    : undefined;

  const response = await fetch(url, {
    method: endpoint.method,
    headers: {
      "X-Mpstats-TOKEN": token,
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*"
    },
    body,
    cache: "no-store"
  });

  const responseText = await response.text();
  const responseHeaders = sanitizeHeaders(response.headers);

  return {
    endpoint,
    requestUrl: url.toString(),
    queryString: url.searchParams.toString(),
    requestHeaders,
    requestBody: body ? prettyJson(body) : "<no request body>",
    status: response.status,
    responseHeaders,
    diagnosticIds: extractDiagnosticIds(responseHeaders, responseText),
    responseBody: formatResponseBody(responseText)
  };
}

function buildMarkdown(input: {
  generatedAt: string;
  period: { from: string; to: string };
  sellers: Record<Marketplace, ResolvedSeller>;
  diagnostics: RawDiagnostic[];
}) {
  const sections = input.diagnostics.map((diagnostic) => {
    const seller = input.sellers[diagnostic.endpoint.marketplace];
    return [
      `## ${diagnostic.endpoint.title}`,
      "",
      "### Successful chain before failing endpoint",
      "",
      "```text",
      `GET ${seller.itemFullPath}`,
      "↓",
      `HTTP ${seller.itemFullStatus}`,
      "↓",
      `seller.id = ${seller.sellerId}`,
      "↓",
      `seller.name = ${seller.sellerName}`,
      "↓",
      `${diagnostic.endpoint.method} ${diagnostic.endpoint.path}`,
      "↓",
      `HTTP ${diagnostic.status}`,
      "```",
      "",
      "### Request",
      "",
      `- HTTP Method: \`${diagnostic.endpoint.method}\``,
      `- Endpoint: \`${endpointPath(diagnostic.endpoint.marketplace, diagnostic.endpoint.path)}\``,
      `- Full Request URL: \`${diagnostic.requestUrl}\``,
      `- Full Query String: \`${diagnostic.queryString || "<empty query string>"}\``,
      "",
      "Request Headers:",
      "",
      "```json",
      JSON.stringify(diagnostic.requestHeaders, null, 2),
      "```",
      "",
      "Request Body:",
      "",
      "```json",
      diagnostic.requestBody,
      "```",
      "",
      "### Response",
      "",
      `- HTTP Status: \`${diagnostic.status}\``,
      "",
      "Response Headers:",
      "",
      "```json",
      JSON.stringify(diagnostic.responseHeaders, null, 2),
      "```",
      "",
      "Diagnostic IDs:",
      "",
      "```json",
      JSON.stringify(diagnostic.diagnosticIds, null, 2),
      "```",
      "",
      "Response Body:",
      "",
      responseFence(diagnostic.responseBody),
      ""
    ].join("\n");
  });

  return [
    "# MPStats Support Diagnostics",
    "",
    `Generated at: \`${input.generatedAt}\``,
    `Report period: \`${input.period.from}\` – \`${input.period.to}\``,
    "",
    "## Summary",
    "",
    "Works:",
    "",
    "- WB seller/by_date",
    "- WB seller/price_segmentation",
    "- Ozon seller/by_date",
    "- Ozon seller/price_segmentation",
    "- Ozon seller/geography",
    "",
    "Does not work:",
    "",
    "- WB seller/warehouses (422)",
    "- WB seller/subjects (422)",
    "- Ozon seller/niches (422)",
    "",
    "## Source Products",
    "",
    "| Marketplace | Product ID | Seller ID | Seller Name |",
    "| --- | ---: | ---: | --- |",
    `| WB | ${input.sellers.wb.productId} | ${input.sellers.wb.sellerId} | ${escapeTable(input.sellers.wb.sellerName)} |`,
    `| Ozon | ${input.sellers.ozon.productId} | ${input.sellers.ozon.sellerId} | ${escapeTable(input.sellers.ozon.sellerName)} |`,
    "",
    ...sections,
    "## Security Check",
    "",
    "- MPStats token value is masked as `**************`.",
    "- No bearer-style auth header is included.",
    "- No cookie header is included.",
    ""
  ].join("\n");
}

function responseFence(body: string) {
  const fence = body.includes("```") ? "````" : "```";
  const language = looksLikeJson(body) || body === "<empty response body>" ? "json" : "";
  return [`${fence}${language}`, body, fence].join("\n");
}

function endpointPath(marketplace: Marketplace, path: string) {
  return `${baseUrl()}/${marketplaceBasePath(marketplace)}/${path}`;
}

function buildUrl(marketplace: Marketplace, path: string, query: MpstatsRequestOptions["query"]) {
  const url = new URL(endpointPath(marketplace, path));
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function baseUrl() {
  return (process.env.MPSTATS_BASE_URL || "https://mpstats.io/api").replace(/\/+$/, "");
}

function marketplaceBasePath(marketplace: Marketplace) {
  return marketplace === "wb" ? "analytics/v1/wb" : "analytics/v1/oz";
}

function sanitizeHeaders(headers: Headers) {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower === "cookie" || lower === "authorization") continue;
    result[key] = value;
  }
  return result;
}

function extractDiagnosticIds(headers: Record<string, string>, responseText: string) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/trace[-_]?id|request[-_]?id|correlation[-_]?id/i.test(key)) {
      result[key] = value;
    }
  }

  try {
    const parsed = JSON.parse(responseText) as unknown;
    collectDiagnosticIds(parsed, result);
  } catch {
    // The full text response is printed separately.
  }

  return result;
}

function collectDiagnosticIds(value: unknown, result: Record<string, string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectDiagnosticIds(item, result);
    return;
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (/traceId|trace_id|requestId|request_id|correlationId|correlation_id/i.test(key)) {
      result[key] = String(fieldValue);
    }
    if (fieldValue && typeof fieldValue === "object") {
      collectDiagnosticIds(fieldValue, result);
    }
  }
}

function formatResponseBody(text: string) {
  if (!text) return "<empty response body>";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function prettyJson(rawJson: string) {
  return JSON.stringify(JSON.parse(rawJson), null, 2);
}

function looksLikeJson(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function lastThirtyDaysPeriod() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    from: toDate(from),
    to: toDate(to)
  };
}

function toDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  if (Array.isArray(record.data) && record.data[0] && typeof record.data[0] === "object") {
    return record.data[0] as Record<string, unknown>;
  }
  return record;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function escapeTable(value: string) {
  return value.replace(/\|/g, "\\|");
}

function loadDotEnvLocal() {
  const path = resolve(PROJECT_ROOT, ".env.local");
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function requireToken() {
  const value = process.env.MPSTATS_TOKEN;
  if (!value) {
    throw new Error("MPStats token is not configured in .env.local or environment.");
  }
  return value;
}

function assertNoSecretLeak(markdown: string, secret: string) {
  if (secret && markdown.includes(secret)) {
    throw new Error("Refusing to write diagnostics: MPStats token leaked into markdown.");
  }
  if (/^authorization\s*:/im.test(markdown)) {
    throw new Error("Refusing to write diagnostics: authorization header leaked into markdown.");
  }
  if (/^cookie\s*:/im.test(markdown) || /^set-cookie\s*:/im.test(markdown)) {
    throw new Error("Refusing to write diagnostics: cookie header leaked into markdown.");
  }
}
