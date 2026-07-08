import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildExternalSellerInsert, buildSellerCheckInsert } from "../src/lib/seller-checks/mapper.ts";
import { saveSellerCheck, type SellerChecksDatabase } from "../src/lib/seller-checks/repository.ts";
import { SELLER_CHECK_ANALYTICS_SOURCE, SELLER_CHECK_REPORT_SCHEMA_VERSION } from "../src/lib/seller-checks/types.ts";
import { validateSellerCheckPayload } from "../src/lib/seller-checks/validation.ts";
import type { UserProfile } from "../src/lib/auth/types.ts";
import type { SellerReport } from "../src/lib/mpstats/types.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const profile: UserProfile = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "manager@example.com",
  role: "user",
  status: "approved",
  created_at: "2026-07-06T00:00:00.000Z",
  approved_at: "2026-07-06T00:00:00.000Z",
  approved_by: null
};

const report: SellerReport = {
  seller: {
    marketplace: "wb",
    sellerId: "4345380",
    sellerName: "Sample Seller",
    sourceProductId: "898788449",
    productName: "Sample Product",
    brand: "Sample Brand"
  },
  period: {
    from: "2026-06-06",
    to: "2026-07-05",
    days: 30,
    source: "fallback"
  },
  fulfillmentMode: "FBO_PLUS_FBS",
  summary: {
    revenue: 7500000,
    sales: 1200,
    items: 93,
    itemsWithSales: 48,
    avgCheck: 6250
  },
  priceSegments: [],
  warehouses: [{ name: "Электросталь WB", skuCount: 93, stock: 2668 }],
  ozonGeography: [],
  subjects: [],
  warnings: []
};

test("seller check payload validates without accepting analyticsSource from frontend", () => {
  const result = validateSellerCheckPayload({
    analyticsSource: "moneyplace",
    sourceInput: "https://www.wildberries.ru/catalog/898788449/detail.aspx",
    decisionStatus: "interesting",
    comment: "  Good seller  ",
    report
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("analyticsSource" in result.data, false);
  assert.equal(result.data.comment, "Good seller");
});

test("seller check validation rejects invalid decision, long comment and bad period", () => {
  assert.equal(validateSellerCheckPayload({ decisionStatus: "bad", report }).ok, false);
  assert.equal(validateSellerCheckPayload({ decisionStatus: "interesting", comment: "x".repeat(1501), report }).ok, false);
  assert.equal(validateSellerCheckPayload({
    decisionStatus: "interesting",
    report: {
      ...report,
      period: { from: "2026-06-07", to: "2026-07-05", days: 30, source: "fallback" }
    }
  }).ok, false);
});

test("seller check mapper creates external seller and check rows from normalized report", () => {
  const request = {
    sourceInput: "https://www.wildberries.ru/catalog/898788449/detail.aspx",
    decisionStatus: "interesting" as const,
    comment: "Good seller",
    report
  };
  const externalSeller = buildExternalSellerInsert(request, profile);
  const sellerCheck = buildSellerCheckInsert({
    request,
    profile,
    externalSellerId: "22222222-2222-2222-2222-222222222222"
  });

  assert.equal(externalSeller.first_source, SELLER_CHECK_ANALYTICS_SOURCE);
  assert.equal(externalSeller.normalized_seller_key, report.seller.sellerId);
  assert.equal(sellerCheck.analytics_source, SELLER_CHECK_ANALYTICS_SOURCE);
  assert.equal(sellerCheck.source_report_version, SELLER_CHECK_REPORT_SCHEMA_VERSION);
  assert.equal(sellerCheck.revenue, report.summary.revenue);
  assert.equal(sellerCheck.warehouses_snapshot, report.warehouses);
});

test("seller check repository inserts check for existing external seller", async () => {
  const inserts: string[] = [];
  const database: SellerChecksDatabase = {
    async findExternalSeller() {
      return { data: { id: "external-1" }, error: null };
    },
    async insertExternalSeller() {
      inserts.push("external");
      return { data: { id: "external-1" }, error: null };
    },
    async insertSellerCheck() {
      inserts.push("check");
      return {
        data: { id: "check-1", external_seller_ref: "external-1", created_at: "2026-07-06T12:00:00.000Z" },
        error: null
      };
    }
  };

  const result = await saveSellerCheck({
    database,
    request: { decisionStatus: "manual_review", report },
    profile
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(inserts, ["check"]);
  assert.equal(result.data.checkId, "check-1");
  assert.equal(result.data.externalSellerId, "external-1");
  assert.equal(result.data.createdAt, "2026-07-06T12:00:00.000Z");
});

test("seller check repository recovers from external seller unique conflict", async () => {
  let lookupCount = 0;
  const database: SellerChecksDatabase = {
    async findExternalSeller() {
      lookupCount += 1;
      return lookupCount === 1
        ? { data: null, error: null }
        : { data: { id: "external-after-conflict" }, error: null };
    },
    async insertExternalSeller() {
      return { data: null, error: { code: "23505", message: "duplicate" } };
    },
    async insertSellerCheck() {
      return {
        data: {
          id: "check-after-conflict",
          external_seller_ref: "external-after-conflict",
          created_at: "2026-07-06T12:00:00.000Z"
        },
        error: null
      };
    }
  };

  const result = await saveSellerCheck({
    database,
    request: { decisionStatus: "interesting", report },
    profile
  });

  assert.equal(result.ok, true);
  assert.equal(lookupCount, 2);
});

test("MPStats seller run route does not write seller checks", () => {
  const route = readFileSync(join(projectRoot, "src/app/api/mpstats/seller/run/route.ts"), "utf-8");

  assert.equal(route.includes("seller_checks"), false);
  assert.equal(route.includes("external_sellers"), false);
});
