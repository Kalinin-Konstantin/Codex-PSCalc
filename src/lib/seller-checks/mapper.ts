import type { UserProfile } from "../auth/types";
import type { SellerCheckSaveRequest, ExternalSellerInsert, SellerCheckInsert } from "./types.ts";
import {
  SELLER_CHECK_ANALYTICS_SOURCE,
  SELLER_CHECK_REPORT_SCHEMA_VERSION
} from "./types.ts";

export function buildExternalSellerInsert(input: SellerCheckSaveRequest, profile: UserProfile): ExternalSellerInsert {
  const seller = input.report.seller;
  const sellerId = seller.sellerId.trim();

  return {
    marketplace: seller.marketplace,
    external_seller_id: sellerId,
    external_seller_name: seller.sellerName?.trim() || null,
    normalized_seller_key: sellerId,
    first_source: SELLER_CHECK_ANALYTICS_SOURCE,
    created_by: profile.id
  };
}

export function buildSellerCheckInsert(input: {
  request: SellerCheckSaveRequest;
  profile: UserProfile;
  externalSellerId: string;
}): SellerCheckInsert {
  const { request, profile, externalSellerId } = input;
  const { report } = request;

  return {
    external_seller_ref: externalSellerId,
    checked_by: profile.id,
    analytics_source: SELLER_CHECK_ANALYTICS_SOURCE,
    source_report_version: SELLER_CHECK_REPORT_SCHEMA_VERSION,
    marketplace: report.seller.marketplace,
    marketplace_seller_id: report.seller.sellerId,
    seller_name: report.seller.sellerName ?? null,
    source_product_id: report.seller.sourceProductId,
    source_product_url: sourceProductUrl(request.sourceInput),
    product_name: report.seller.productName ?? null,
    brand: report.seller.brand ?? null,
    period_from: report.period.from,
    period_to: report.period.to,
    period_days: report.period.days,
    fulfillment_mode: report.fulfillmentMode,
    revenue: report.summary.revenue,
    sales: report.summary.sales,
    avg_check: report.summary.avgCheck,
    items_count: report.summary.items,
    items_with_sales_count: report.summary.itemsWithSales,
    decision_status: request.decisionStatus,
    comment: request.comment?.trim() || null,
    normalized_report: report,
    summary_snapshot: report.summary,
    price_segments_snapshot: report.priceSegments,
    warehouses_snapshot: report.warehouses,
    subjects_snapshot: report.subjects,
    warnings: report.warnings,
    data_quality: {
      hasSummary: hasAnySummaryMetric(report.summary),
      hasPriceSegments: report.priceSegments.length > 0,
      hasWarehouses: report.warehouses.length > 0,
      hasSubjects: report.subjects.length > 0,
      warningCodes: report.warnings.map((warning) => warning.code)
    }
  };
}

function sourceProductUrl(sourceInput: string | undefined) {
  if (!sourceInput) return null;

  try {
    const url = new URL(sourceInput);
    return url.protocol === "http:" || url.protocol === "https:" ? sourceInput : null;
  } catch {
    return null;
  }
}

function hasAnySummaryMetric(summary: SellerCheckSaveRequest["report"]["summary"]) {
  return (
    summary.revenue != null
    || summary.sales != null
    || summary.items != null
    || summary.itemsWithSales != null
    || summary.avgCheck != null
  );
}
