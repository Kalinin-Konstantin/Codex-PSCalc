import "server-only";

import { getAnalyticsPeriod } from "./analyticsPeriod";
import { mpstatsRequest } from "./client";
import { buildSellerReportFromResponses, type ReportBlockResponse } from "./sellerReportBuilder";
import { resolveMpstatsSeller } from "./sellerResolve";
import type {
  FulfillmentMode,
  Marketplace,
  MpstatsError,
  MpstatsResult,
  SellerReport,
  SellerReportParams,
  SellerReportWarning
} from "./types";

const REPORT_POST_BODY = {
  startRow: 0,
  endRow: 5000,
  filterModel: {},
  sortModel: []
};

const WAREHOUSES_POST_BODY = {
  ...REPORT_POST_BODY,
  endRow: 100
};

const OZON_NICHES_POST_BODY = {
  ...REPORT_POST_BODY,
  endRow: 500
};

export async function getSellerReport(params: SellerReportParams): Promise<SellerReport> {
  const result = await getSellerReportResult(params);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

export async function getSellerReportResult(params: SellerReportParams): Promise<MpstatsResult<SellerReport>> {
  const resolved = await resolveMpstatsSeller({ input: params.input, marketplace: params.marketplace ?? "auto" });
  if (!resolved.ok) return resolved;

  const sellerPath = resolved.data.sellerId ?? resolved.data.sellerName;
  if (!sellerPath) {
    return {
      ok: false,
      error: {
        code: "seller_not_found",
        message: "Seller ID or name is required to request MPStats seller report.",
        status: 502
      }
    };
  }

  const period = await getAnalyticsPeriod({ marketplace: resolved.data.marketplace });
  const endpointMap = buildEndpointMap(resolved.data.marketplace, params.fulfillmentMode, sellerPath, period);
  const responses = await Promise.all(
    endpointMap.map(async (endpoint): Promise<ReportBlockResponse> => {
      const result = await mpstatsRequest({
        marketplace: resolved.data.marketplace,
        method: endpoint.method,
        path: endpoint.path,
        query: endpoint.query,
        body: endpoint.body
      });

      return result.ok
        ? { key: endpoint.key, ok: true, data: result.data }
        : { key: endpoint.key, ok: false, error: result.error };
    })
  );

  return {
    ok: true,
    data: buildSellerReportFromResponses({
      seller: {
        marketplace: resolved.data.marketplace,
        sellerId: sellerPath,
        sellerName: resolved.data.sellerName ?? undefined,
        sourceProductId: resolved.data.productId,
        productName: resolved.data.productName ?? undefined,
        brand: resolved.data.brand ?? undefined
      },
      period,
      fulfillmentMode: params.fulfillmentMode,
      responses
    })
  };
}

function buildEndpointMap(
  marketplace: Marketplace,
  fulfillmentMode: FulfillmentMode,
  sellerPath: string,
  period: SellerReport["period"]
) {
  const baseQuery: Record<string, string> = {
    d1: period.from,
    d2: period.to,
    path: sellerPath
  };
  const fbsQuery = fulfillmentMode === "FBO_PLUS_FBS" ? "1" : "0";

  if (marketplace === "wb") {
    return [
      { key: "summary" as const, method: "POST" as const, path: "seller/by_date", query: { ...baseQuery, fbs: fbsQuery }, body: REPORT_POST_BODY },
      { key: "priceSegments" as const, method: "POST" as const, path: "seller/price_segmentation", query: { ...baseQuery, fbs: fbsQuery }, body: REPORT_POST_BODY },
      { key: "warehouses" as const, method: "POST" as const, path: "seller/warehouses", query: { ...baseQuery }, body: WAREHOUSES_POST_BODY },
      { key: "subjects" as const, method: "POST" as const, path: "seller/subjects", query: { ...baseQuery, fbs: fbsQuery } }
    ];
  }

  return [
    { key: "summary" as const, method: "POST" as const, path: "seller/by_date", query: { ...baseQuery, fbs: fbsQuery }, body: REPORT_POST_BODY },
    { key: "priceSegments" as const, method: "POST" as const, path: "seller/price_segmentation", query: { ...baseQuery, fbs: fbsQuery }, body: REPORT_POST_BODY },
    { key: "warehouses" as const, method: "GET" as const, path: "seller/geography", query: { path: sellerPath, date: period.from.slice(0, 7) } },
    { key: "subjects" as const, method: "POST" as const, path: "seller/niches", query: { ...baseQuery, fbs: fbsQuery }, body: OZON_NICHES_POST_BODY }
  ];
}
