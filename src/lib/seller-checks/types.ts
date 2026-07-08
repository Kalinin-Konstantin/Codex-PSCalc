import type { SellerReport } from "../mpstats/types.ts";

export const SELLER_CHECK_ANALYTICS_SOURCE = "mpstats";
export const SELLER_CHECK_REPORT_SCHEMA_VERSION = "1";

export type SellerCheckDecisionStatus = "interesting" | "not_interesting" | "manual_review";

export type SellerCheckSaveRequest = {
  sourceInput?: string;
  decisionStatus: SellerCheckDecisionStatus;
  comment?: string;
  report: SellerReport;
};

export type SellerCheckSaveResponse = {
  checkId: string;
  externalSellerId: string;
  createdAt: string;
};

export type SellerCheckErrorCode =
  | "invalid_json"
  | "validation_error"
  | "forbidden"
  | "external_seller_conflict"
  | "database_forbidden"
  | "database_constraint_error"
  | "database_error";

export type SellerCheckError = {
  code: SellerCheckErrorCode;
  message: string;
};

export type SellerCheckResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SellerCheckError };

export type ExternalSellerInsert = {
  marketplace: SellerReport["seller"]["marketplace"];
  external_seller_id: string;
  external_seller_name: string | null;
  normalized_seller_key: string;
  first_source: typeof SELLER_CHECK_ANALYTICS_SOURCE;
  created_by: string;
};

export type SellerCheckInsert = {
  external_seller_ref: string;
  checked_by: string;
  analytics_source: typeof SELLER_CHECK_ANALYTICS_SOURCE;
  source_report_version: typeof SELLER_CHECK_REPORT_SCHEMA_VERSION;
  marketplace: SellerReport["seller"]["marketplace"];
  marketplace_seller_id: string;
  seller_name: string | null;
  source_product_id: string;
  source_product_url: string | null;
  product_name: string | null;
  brand: string | null;
  period_from: string;
  period_to: string;
  period_days: number;
  fulfillment_mode: SellerReport["fulfillmentMode"];
  revenue: number | null;
  sales: number | null;
  avg_check: number | null;
  items_count: number | null;
  items_with_sales_count: number | null;
  decision_status: SellerCheckDecisionStatus;
  comment: string | null;
  normalized_report: SellerReport;
  summary_snapshot: SellerReport["summary"];
  price_segments_snapshot: SellerReport["priceSegments"];
  warehouses_snapshot: SellerReport["warehouses"];
  subjects_snapshot: SellerReport["subjects"];
  warnings: SellerReport["warnings"];
  data_quality: {
    hasSummary: boolean;
    hasPriceSegments: boolean;
    hasWarehouses: boolean;
    hasSubjects: boolean;
    warningCodes: string[];
  };
};
