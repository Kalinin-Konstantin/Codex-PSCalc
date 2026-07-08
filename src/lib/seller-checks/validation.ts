import type { FulfillmentMode, Marketplace, SellerReport } from "../mpstats/types.ts";
import type {
  SellerCheckDecisionStatus,
  SellerCheckError,
  SellerCheckSaveRequest,
  SellerCheckResult
} from "./types.ts";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decisionStatuses: SellerCheckDecisionStatus[] = ["interesting", "not_interesting", "manual_review"];
const marketplaces: Marketplace[] = ["wb", "ozon"];
const fulfillmentModes: FulfillmentMode[] = ["FBO", "FBO_PLUS_FBS"];

export function validateSellerCheckPayload(payload: unknown): SellerCheckResult<SellerCheckSaveRequest> {
  if (!isRecord(payload)) return validationError("Request body must be an object.");

  const decisionStatus = payload.decisionStatus;
  if (!isDecisionStatus(decisionStatus)) return validationError("Decision status is invalid.");

  const commentResult = normalizeComment(payload.comment);
  if (!commentResult.ok) return commentResult;

  const sourceInputResult = normalizeSourceInput(payload.sourceInput);
  if (!sourceInputResult.ok) return sourceInputResult;

  const reportResult = validateSellerReport(payload.report);
  if (!reportResult.ok) return reportResult;

  return {
    ok: true,
    data: {
      decisionStatus,
      comment: commentResult.data,
      sourceInput: sourceInputResult.data,
      report: reportResult.data
    }
  };
}

export function validateSellerReport(value: unknown): SellerCheckResult<SellerReport> {
  if (!isRecord(value)) return validationError("Report must be an object.");

  const seller = value.seller;
  if (!isRecord(seller)) return validationError("Report seller is required.");
  if (!isMarketplace(seller.marketplace)) return validationError("Report marketplace is invalid.");
  if (!nonEmptyString(seller.sellerId)) return validationError("Report sellerId is required.");
  if (!nonEmptyString(seller.sourceProductId)) return validationError("Report sourceProductId is required.");

  const period = value.period;
  if (!isRecord(period)) return validationError("Report period is required.");
  if (!dateString(period.from) || !dateString(period.to)) return validationError("Report period dates are invalid.");
  if (typeof period.days !== "number" || period.days !== 30) return validationError("Report period days must be 30.");
  if (countInclusiveDays(period.from, period.to) !== period.days) {
    return validationError("Report period range does not match period days.");
  }

  if (!isFulfillmentMode(value.fulfillmentMode)) return validationError("Report fulfillmentMode is invalid.");
  if (!isRecord(value.summary)) return validationError("Report summary is required.");
  if (!Array.isArray(value.priceSegments)) return validationError("Report priceSegments must be an array.");
  if (!Array.isArray(value.warehouses)) return validationError("Report warehouses must be an array.");
  if (!Array.isArray(value.subjects)) return validationError("Report subjects must be an array.");
  if (!Array.isArray(value.warnings)) return validationError("Report warnings must be an array.");

  return { ok: true, data: value as SellerReport };
}

export function countInclusiveDays(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

function normalizeComment(value: unknown): SellerCheckResult<string | undefined> {
  if (value == null) return { ok: true, data: undefined };
  if (typeof value !== "string") return validationError("Comment must be a string.");

  const trimmed = value.trim();
  if (trimmed.length > 1500) return validationError("Comment must be 1500 characters or fewer.");
  return { ok: true, data: trimmed || undefined };
}

function normalizeSourceInput(value: unknown): SellerCheckResult<string | undefined> {
  if (value == null) return { ok: true, data: undefined };
  if (typeof value !== "string") return validationError("Source input must be a string.");

  const trimmed = value.trim();
  if (trimmed.length > 2048) return validationError("Source input is too long.");
  return { ok: true, data: trimmed || undefined };
}

function validationError(message: string): { ok: false; error: SellerCheckError } {
  return {
    ok: false,
    error: {
      code: "validation_error",
      message
    }
  };
}

function isDecisionStatus(value: unknown): value is SellerCheckDecisionStatus {
  return typeof value === "string" && decisionStatuses.includes(value as SellerCheckDecisionStatus);
}

function isMarketplace(value: unknown): value is Marketplace {
  return typeof value === "string" && marketplaces.includes(value as Marketplace);
}

function isFulfillmentMode(value: unknown): value is FulfillmentMode {
  return typeof value === "string" && fulfillmentModes.includes(value as FulfillmentMode);
}

function dateString(value: unknown): value is string {
  return typeof value === "string" && datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
