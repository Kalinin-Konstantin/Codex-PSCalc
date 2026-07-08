import type { Marketplace, MpstatsRequestOptions, MpstatsResult } from "./types";

const DEFAULT_TIMEOUT_MS = 15000;

const MARKETPLACE_BASE_PATHS: Record<Marketplace, string> = {
  wb: "analytics/v1/wb",
  ozon: "analytics/v1/oz"
};

export async function mpstatsRequest<T = unknown>(options: MpstatsRequestOptions): Promise<MpstatsResult<T>> {
  assertNonBrowserRuntime();

  const token = process.env.MPSTATS_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: {
        code: "mpstats_token_missing",
        message: "MPSTATS_TOKEN is not configured.",
        status: 500
      }
    };
  }

  const pathValidation = normalizeMpstatsPath(options.path);
  if (!pathValidation.ok) return pathValidation;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(buildMpstatsUrl(options.marketplace, pathValidation.data, options.query), {
      method: options.method ?? "GET",
      headers: {
        "X-Mpstats-TOKEN": token,
        "Content-Type": "application/json"
      },
      body: (options.method ?? "GET") === "POST" && options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
      signal: controller.signal,
      cache: "no-store"
    });

    return await parseMpstatsResponse<T>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        error: {
          code: "mpstats_timeout",
          message: "MPStats API request timed out.",
          status: 504
        }
      };
    }

    return {
      ok: false,
      error: {
        code: "mpstats_request_failed",
        message: "MPStats API request failed.",
        status: 502
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertNonBrowserRuntime() {
  // This module may be imported by API routes and CLI diagnostics only. If it
  // reaches a browser bundle by mistake, fail before reading env or token data.
  if (typeof window !== "undefined") {
    throw new Error("MPStats request core is server-side only.");
  }
}

function buildMpstatsUrl(
  marketplace: Marketplace,
  normalizedPath: string,
  query: MpstatsRequestOptions["query"]
) {
  const baseUrl = (process.env.MPSTATS_BASE_URL || "https://mpstats.io/api").replace(/\/+$/, "");
  const url = new URL(`${baseUrl}/${MARKETPLACE_BASE_PATHS[marketplace]}/${normalizedPath}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }

  return url;
}

function normalizeMpstatsPath(path: string): MpstatsResult<string> {
  const normalized = path.replace(/^\/+/, "");
  if (
    normalized.length === 0
    || normalized.length > 180
    || normalized.includes("..")
    || normalized.includes("//")
    || /^https?:/i.test(normalized)
    || !/^[A-Za-z0-9_./-]+$/.test(normalized)
  ) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "Invalid MPStats API path.",
        status: 400
      }
    };
  }

  return { ok: true, data: normalized };
}

async function parseMpstatsResponse<T>(response: Response): Promise<MpstatsResult<T>> {
  const text = await response.text();
  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));

  if (response.status === 202) {
    return {
      ok: false,
      error: {
        code: "mpstats_accepted",
        message: "MPStats API accepted the request but the result is not ready yet.",
        status: 202,
        retryAfterSeconds
      }
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      error: {
        code: "mpstats_unauthorized",
        message: "MPStats API authorization failed.",
        status: 401
      }
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      error: {
        code: "mpstats_not_found",
        message: "MPStats item was not found.",
        status: 404
      }
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      error: {
        code: "mpstats_rate_limited",
        message: "MPStats API rate limit exceeded.",
        status: 429,
        retryAfterSeconds
      }
    };
  }

  if (response.status >= 500) {
    return {
      ok: false,
      error: {
        code: "mpstats_server_error",
        message: "MPStats API returned a server error.",
        status: response.status,
        retryAfterSeconds
      }
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: "mpstats_request_failed",
        message: "MPStats API request failed.",
        status: response.status,
        retryAfterSeconds
      }
    };
  }

  if (!text) {
    return { ok: true, data: null as T };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      error: {
        code: "mpstats_invalid_json",
        message: "MPStats API returned invalid JSON.",
        status: response.status
      }
    };
  }
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
