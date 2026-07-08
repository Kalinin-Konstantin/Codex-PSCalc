import {
  normalizeOzonGeography,
  normalizePriceSegments,
  normalizeSellerSummary,
  normalizeSubjects,
  normalizeWarehouseStocks
} from "./normalizers.ts";
import type {
  FulfillmentMode,
  MpstatsError,
  SellerReport,
  SellerReportWarning
} from "./types.ts";

export type ReportBlockKey = "summary" | "priceSegments" | "warehouses" | "subjects";

export type ReportBlockResponse = {
  key: ReportBlockKey;
  ok: boolean;
  data?: unknown;
  error?: MpstatsError;
};

export function buildSellerReportFromResponses(input: {
  seller: SellerReport["seller"];
  period: SellerReport["period"];
  fulfillmentMode: FulfillmentMode;
  responses: ReportBlockResponse[];
}): SellerReport {
  const responseByKey = new Map(input.responses.map((response) => [response.key, response]));
  const warnings: SellerReportWarning[] = [];

  const summaryResponse = responseByKey.get("summary");
  const summary = summaryResponse?.ok
    ? normalizeSellerSummary(summaryResponse.data)
    : emptySummary();
  if (!summaryResponse?.ok) warnings.push(warningForBlock("SUMMARY_UNAVAILABLE", summaryResponse?.error));

  const priceResponse = responseByKey.get("priceSegments");
  const priceSegments = priceResponse?.ok ? normalizePriceSegments(priceResponse.data) : [];
  if (!priceResponse?.ok) warnings.push(warningForBlock("PRICE_SEGMENTS_UNAVAILABLE", priceResponse?.error));

  const warehousesResponse = responseByKey.get("warehouses");
  const warehouses = input.seller.marketplace === "wb" && warehousesResponse?.ok
    ? normalizeWarehouseStocks(warehousesResponse.data)
    : [];
  const ozonGeography = input.seller.marketplace === "ozon" && warehousesResponse?.ok
    ? normalizeOzonGeography(warehousesResponse.data)
    : [];
  if (!warehousesResponse?.ok) {
    warnings.push(input.seller.marketplace === "ozon"
      ? {
        code: "OZON_WAREHOUSES_MISSING",
        message: "Ozon seller geography did not return a usable seller-level warehouse/geography distribution.",
        details: warehousesResponse?.error?.code
      }
      : warningForBlock("WAREHOUSES_UNAVAILABLE", warehousesResponse?.error));
  } else if (input.seller.marketplace === "ozon" && ozonGeography.length === 0) {
    warnings.push({
      code: "OZON_WAREHOUSES_MISSING",
      message: "Ozon seller geography did not return a usable seller-level warehouse/geography distribution.",
      details: "seller/geography returned no usable storage_data rows."
    });
  }

  const subjectsResponse = responseByKey.get("subjects");
  const subjects = subjectsResponse?.ok ? normalizeSubjects(subjectsResponse.data) : [];
  if (!subjectsResponse?.ok) warnings.push(warningForBlock("SUBJECTS_UNAVAILABLE", subjectsResponse?.error));

  return {
    seller: input.seller,
    period: input.period,
    fulfillmentMode: input.fulfillmentMode,
    summary,
    priceSegments,
    warehouses,
    ozonGeography,
    subjects,
    warnings
  };
}

function emptySummary() {
  return {
    revenue: null,
    sales: null,
    items: null,
    itemsWithSales: null,
    avgCheck: null
  };
}

function warningForBlock(code: SellerReportWarning["code"], error: MpstatsError | undefined): SellerReportWarning {
  return {
    code,
    message: error?.message ?? "MPStats report block is unavailable.",
    details: error?.code
  };
}
