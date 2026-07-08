import { NextResponse } from "next/server";
import { canUseCalculator, getCurrentProfile } from "../../../../../lib/auth/session";
import { getSellerReportResult } from "../../../../../lib/mpstats/sellerReport";
import type { FulfillmentMode, MarketplaceInput, MpstatsError } from "../../../../../lib/mpstats/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SellerRunRouteRequest = {
  input?: unknown;
  marketplace?: unknown;
  fulfillmentMode?: unknown;
};

export async function POST(request: Request) {
  const { profile } = await getCurrentProfile();

  if (!canUseCalculator(profile)) {
    return NextResponse.json({ ok: false, error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });
  }

  let payload: SellerRunRouteRequest;
  try {
    payload = (await request.json()) as SellerRunRouteRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "Invalid JSON body." } },
      { status: 400 }
    );
  }

  if (typeof payload.input !== "string") {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "Input must be a string." } },
      { status: 400 }
    );
  }

  const marketplace = normalizeRouteMarketplace(payload.marketplace);
  if (!marketplace) {
    return NextResponse.json(
      { ok: false, error: { code: "unsupported_marketplace", message: "Marketplace must be auto, wb, or ozon." } },
      { status: 400 }
    );
  }

  const fulfillmentMode = normalizeFulfillmentMode(payload.fulfillmentMode);
  if (!fulfillmentMode) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "fulfillmentMode must be FBO or FBO_PLUS_FBS." } },
      { status: 400 }
    );
  }

  const result = await getSellerReportResult({ input: payload.input, marketplace, fulfillmentMode });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: publicError(result.error) }, { status: statusForError(result.error) });
  }

  return NextResponse.json({ ok: true, data: result.data });
}

function normalizeRouteMarketplace(value: unknown): MarketplaceInput | null {
  if (value == null || value === "auto") return "auto";
  if (value === "wb" || value === "wildberries") return "wb";
  if (value === "ozon" || value === "oz") return "ozon";
  return null;
}

function normalizeFulfillmentMode(value: unknown): FulfillmentMode | null {
  if (value === "FBO" || value == null) return "FBO";
  if (value === "FBO_PLUS_FBS") return "FBO_PLUS_FBS";
  return null;
}

function publicError(error: MpstatsError) {
  return {
    code: error.code,
    message: error.message,
    ...(error.retryAfterSeconds == null ? {} : { retryAfterSeconds: error.retryAfterSeconds })
  };
}

function statusForError(error: MpstatsError) {
  switch (error.code) {
    case "invalid_input":
    case "unsupported_marketplace":
    case "marketplace_required":
    case "sku_not_found":
      return 400;
    case "mpstats_token_missing":
      return 500;
    case "mpstats_rate_limited":
      return 429;
    case "mpstats_timeout":
      return 504;
    case "mpstats_not_found":
      return 404;
    default:
      return 502;
  }
}
