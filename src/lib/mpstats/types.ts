export type Marketplace = "wb" | "ozon";

export type MarketplaceInput = Marketplace | "auto";

export type MpstatsInputType = "url" | "sku";

export type FulfillmentMode = "FBO" | "FBO_PLUS_FBS";

export type SellerResolveInput = {
  input: string;
  marketplace?: MarketplaceInput;
};

export type ResolvedMarketplaceInput = {
  marketplace: Marketplace;
  productId: string;
  sku: string;
  rawInput: string;
  inputType: MpstatsInputType;
};

export type MpstatsErrorCode =
  | "invalid_input"
  | "unsupported_marketplace"
  | "marketplace_required"
  | "sku_not_found"
  | "mpstats_token_missing"
  | "mpstats_accepted"
  | "mpstats_unauthorized"
  | "mpstats_not_found"
  | "mpstats_rate_limited"
  | "mpstats_server_error"
  | "mpstats_timeout"
  | "mpstats_invalid_json"
  | "mpstats_request_failed"
  | "seller_not_found";

export type MpstatsError = {
  code: MpstatsErrorCode;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
};

export type MpstatsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MpstatsError };

export type MpstatsRequestMethod = "GET" | "POST";

export type MpstatsRequestOptions = {
  marketplace: Marketplace;
  method?: MpstatsRequestMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  timeoutMs?: number;
};

export type SellerResolveData = {
  marketplace: Marketplace;
  productId: string;
  sku: string;
  inputType: MpstatsInputType;
  sellerId: string | null;
  sellerName: string | null;
  productName: string | null;
  brand: string | null;
  deliveryScheme: string | null;
};

export type SellerResolveResult = MpstatsResult<SellerResolveData>;

export type SellerReportParams = {
  input: string;
  marketplace?: MarketplaceInput;
  fulfillmentMode: FulfillmentMode;
};

export type SellerSummary = {
  revenue: number | null;
  sales: number | null;
  items: number | null;
  itemsWithSales: number | null;
  avgCheck: number | null;
};

export type PriceSegment = {
  label: string;
  minPrice: number | null;
  maxPrice: number | null;
  sales: number | null;
  revenue: number | null;
  items: number | null;
  salesShare: number | null;
  revenueShare: number | null;
};

export type WarehouseStockItem = {
  name: string;
  skuCount: number | null;
  stock: number | null;
};

export type OzonGeographyItem = {
  name: string;
  region: string | null;
  sales: number | null;
  count: number | null;
  revenue: number | null;
  salesShare: number | null;
  countShare: number | null;
  revenueShare: number | null;
};

export type SubjectDistributionItem = {
  name: string;
  sales: number | null;
  revenue: number | null;
  stock?: number | null;
  revenueShare: number | null;
};

export type SellerReportWarningCode =
  | "SUMMARY_UNAVAILABLE"
  | "PRICE_SEGMENTS_UNAVAILABLE"
  | "WAREHOUSES_UNAVAILABLE"
  | "OZON_WAREHOUSES_MISSING"
  | "SUBJECTS_UNAVAILABLE";

export type SellerReportWarning = {
  code: SellerReportWarningCode;
  message: string;
  details?: string;
};

export type SellerReport = {
  seller: {
    marketplace: Marketplace;
    sellerId: string;
    sellerName?: string;
    sourceProductId: string;
    productName?: string;
    brand?: string;
  };
  period: {
    from: string;
    to: string;
    days: 30;
    source: "estimated_data_period" | "fallback";
  };
  fulfillmentMode: FulfillmentMode;
  summary: SellerSummary;
  priceSegments: PriceSegment[];
  warehouses: WarehouseStockItem[];
  ozonGeography: OzonGeographyItem[];
  subjects: SubjectDistributionItem[];
  warnings: SellerReportWarning[];
};
