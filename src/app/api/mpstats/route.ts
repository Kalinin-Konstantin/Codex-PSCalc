import { NextResponse } from "next/server";
import { canUseCalculator, getCurrentProfile } from "../../../lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MpstatsMarketplace = "wb" | "ozon";
type MpstatsMethod = "GET" | "POST";

type MpstatsProxyRequest = {
  marketplace?: unknown;
  method?: unknown;
  path?: unknown;
  query?: unknown;
  body?: unknown;
};

const MARKETPLACE_BASE_PATHS: Record<MpstatsMarketplace, string> = {
  wb: "analytics/v1/wb",
  ozon: "analytics/v1/oz"
};

const DEFAULT_TIMEOUT_MS = 15000;

export async function POST(request: Request) {
  const { profile } = await getCurrentProfile();

  if (!canUseCalculator(profile)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const token = process.env.MPSTATS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "MPSTATS_TOKEN is not configured" }, { status: 500 });
  }

  let payload: MpstatsProxyRequest;
  try {
    payload = (await request.json()) as MpstatsProxyRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateProxyRequest(payload);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
  }

  const url = buildMpstatsUrl(validation.marketplace, validation.path, validation.query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(url, {
      method: validation.method,
      headers: {
        "X-Mpstats-TOKEN": token,
        "Content-Type": "application/json"
      },
      body: validation.method === "POST" ? JSON.stringify(validation.body ?? defaultMpstatsPostBody()) : undefined,
      signal: controller.signal,
      cache: "no-store"
    });

    const upstreamPayload = await readUpstreamPayload(upstreamResponse);

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "MPStats API request failed",
          upstreamStatus: upstreamResponse.status,
          details: upstreamPayload
        },
        { status: upstreamResponse.status === 401 ? 502 : upstreamResponse.status }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        marketplace: validation.marketplace,
        path: validation.path,
        data: upstreamPayload
      },
      {
        headers: {
          "Cache-Control": "private, max-age=300"
        }
      }
    );
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "MPStats API request timed out"
      : "MPStats API request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

function validateProxyRequest(payload: MpstatsProxyRequest):
  | { ok: true; marketplace: MpstatsMarketplace; method: MpstatsMethod; path: string; query: Record<string, string>; body: unknown }
  | { ok: false; error: string } {
  const marketplace = normalizeMarketplace(payload.marketplace);
  if (!marketplace) return { ok: false, error: "Invalid marketplace. Use wb or ozon." };

  const method = normalizeMethod(payload.method);
  if (!method) return { ok: false, error: "Invalid method. Use GET or POST." };

  if (typeof payload.path !== "string" || !isSafeMpstatsPath(payload.path)) {
    return { ok: false, error: "Invalid MPStats path." };
  }

  const query = normalizeQuery(payload.query);
  if (!query.ok) return query;

  return {
    ok: true,
    marketplace,
    method,
    path: payload.path.replace(/^\/+/, ""),
    query: query.value,
    body: payload.body
  };
}

function normalizeMarketplace(value: unknown): MpstatsMarketplace | null {
  if (value === "wb" || value === "wildberries") return "wb";
  if (value === "ozon" || value === "oz") return "ozon";
  return null;
}

function normalizeMethod(value: unknown): MpstatsMethod | null {
  if (value == null) return "GET";
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper === "GET" || upper === "POST" ? upper : null;
}

function isSafeMpstatsPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return (
    normalized.length > 0
    && normalized.length <= 180
    && !normalized.includes("..")
    && !normalized.includes("//")
    && !/^https?:/i.test(normalized)
    && /^[A-Za-z0-9_./-]+$/.test(normalized)
  );
}

function normalizeQuery(value: unknown):
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: string } {
  if (value == null) return { ok: true, value: {} };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Invalid query. Use an object with scalar values." };
  }

  const query: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      return { ok: false, error: `Invalid query parameter: ${key}` };
    }
    if (rawValue == null) continue;
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
      return { ok: false, error: `Invalid value for query parameter: ${key}` };
    }
    query[key] = String(rawValue);
  }

  return { ok: true, value: query };
}

function buildMpstatsUrl(marketplace: MpstatsMarketplace, path: string, query: Record<string, string>) {
  const baseUrl = (process.env.MPSTATS_BASE_URL || "https://mpstats.io/api").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/${MARKETPLACE_BASE_PATHS[marketplace]}/${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function defaultMpstatsPostBody() {
  return {
    startRow: 0,
    endRow: 100,
    filterModel: {},
    sortModel: []
  };
}

async function readUpstreamPayload(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 1000);
  }
}
