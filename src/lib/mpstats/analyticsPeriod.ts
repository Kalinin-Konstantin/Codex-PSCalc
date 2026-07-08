import type { Marketplace, SellerReport } from "./types";

export type AnalyticsPeriodSource = "estimated_data_period" | "fallback";

export type AnalyticsPeriod = SellerReport["period"];

export const DEFAULT_MPSTATS_DATA_LAG_DAYS = 13;

const DEFAULT_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 5000;
const ESTIMATED_PERIOD_CACHE_TTL_MS = 60 * 60 * 1000;
const ESTIMATED_PERIOD_PATH = "analytics/v1/public/wb/estimated_data_period";

type EstimatedDataPeriodResponse = {
  date_period_start?: unknown;
  date_period_end?: unknown;
};

type CachedPeriod = {
  period: AnalyticsPeriod;
  expiresAt: number;
};

type GetAnalyticsPeriodOptions = {
  marketplace: Marketplace;
  today?: Date;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

let wbEstimatedPeriodCache: CachedPeriod | null = null;

export async function getAnalyticsPeriod(options: GetAnalyticsPeriodOptions): Promise<AnalyticsPeriod> {
  assertNonBrowserRuntime();

  if (options.marketplace !== "wb") {
    return buildRelativePeriod(options.today ?? new Date(), 1, "fallback");
  }

  const nowMs = options.nowMs ?? Date.now();
  if (wbEstimatedPeriodCache && wbEstimatedPeriodCache.expiresAt > nowMs) {
    return wbEstimatedPeriodCache.period;
  }

  const estimatedPeriod = await fetchWbEstimatedDataPeriod(options);
  if (estimatedPeriod) {
    wbEstimatedPeriodCache = {
      period: estimatedPeriod,
      expiresAt: nowMs + ESTIMATED_PERIOD_CACHE_TTL_MS
    };
    return estimatedPeriod;
  }

  return buildRelativePeriod(options.today ?? new Date(), DEFAULT_MPSTATS_DATA_LAG_DAYS, "fallback");
}

export function clearAnalyticsPeriodCacheForTests() {
  wbEstimatedPeriodCache = null;
}

export function countInclusiveDays(from: string, to: string) {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((toDate.getTime() - fromDate.getTime()) / dayMs) + 1;
}

function assertNonBrowserRuntime() {
  if (typeof window !== "undefined") {
    throw new Error("MPStats analytics period helper is server-side only.");
  }
}

async function fetchWbEstimatedDataPeriod(options: GetAnalyticsPeriodOptions): Promise<AnalyticsPeriod | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(buildEstimatedPeriodUrl(), {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) return null;

    const body = await response.json() as EstimatedDataPeriodResponse;
    if (typeof body.date_period_end !== "string" || !isDateString(body.date_period_end)) return null;

    return buildPeriodFromEndDate(body.date_period_end, "estimated_data_period");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildEstimatedPeriodUrl() {
  const baseUrl = (process.env.MPSTATS_BASE_URL || "https://mpstats.io/api").replace(/\/+$/, "");
  return `${baseUrl}/${ESTIMATED_PERIOD_PATH}`;
}

function buildRelativePeriod(today: Date, lagDays: number, source: AnalyticsPeriodSource): AnalyticsPeriod {
  const to = startOfUtcDay(today);
  to.setUTCDate(to.getUTCDate() - lagDays);

  return buildPeriodFromEndDate(formatDate(to), source);
}

function buildPeriodFromEndDate(toDate: string, source: AnalyticsPeriodSource): AnalyticsPeriod {
  const to = parseDate(toDate);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (DEFAULT_DAYS - 1));

  return {
    from: formatDate(from),
    to: toDate,
    days: DEFAULT_DAYS,
    source
  };
}

function isDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDate(value).getTime());
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
