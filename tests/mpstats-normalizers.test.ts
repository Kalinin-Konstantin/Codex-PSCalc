import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  calculateShares,
  normalizeOzonGeography,
  normalizePriceSegments,
  normalizeSellerSummary,
  normalizeSubjects,
  normalizeWarehouseStocks,
  safeNumber
} from "../src/lib/mpstats/normalizers.ts";
import { buildSellerReportFromResponses } from "../src/lib/mpstats/sellerReportBuilder.ts";

const readFixture = (name: string) => JSON.parse(
  readFileSync(new URL(`./fixtures/mpstats/${name}`, import.meta.url), "utf-8")
);

test("MPStats summary aggregates revenue, sales and avgCheck", () => {
  const summary = normalizeSellerSummary(readFixture("wb-seller-by-date.sample.json"));

  assert.equal(summary.revenue, 150000);
  assert.equal(summary.sales, 30);
  assert.equal(summary.items, 12);
  assert.equal(summary.itemsWithSales, 9);
  assert.equal(summary.avgCheck, 5000);
});

test("MPStats safeNumber accepts formatted numeric strings", () => {
  assert.equal(safeNumber("12 500,50 ₽"), 12500.5);
  assert.equal(safeNumber("bad"), null);
});

test("MPStats price segments calculate shares and sort by minPrice", () => {
  const segments = normalizePriceSegments(readFixture("wb-seller-price-segmentation.sample.json"));

  assert.equal(segments[0].label, "0-5000");
  assert.equal(segments[0].salesShare, 0.6667);
  assert.equal(segments[0].revenueShare, 0.5333);
  assert.equal(segments[1].label, "5000-10000");
});

test("MPStats calculateShares fills missing sales and revenue shares", () => {
  const rows = calculateShares(
    [
      { sales: 1, salesShare: null, revenue: 30, revenueShare: null },
      { sales: 3, salesShare: null, revenue: 70, revenueShare: null }
    ],
    "sales",
    "salesShare",
    "revenue",
    "revenueShare"
  );

  assert.equal(rows[0].salesShare, 0.25);
  assert.equal(rows[1].revenueShare, 0.7);
});

test("MPStats warehouse stocks normalize store, SKU count and stock", () => {
  const warehouses = normalizeWarehouseStocks(readFixture("wb-seller-warehouses.sample.json"));

  assert.equal(warehouses[0].name, "Электросталь WB");
  assert.equal(warehouses[0].skuCount, 93);
  assert.equal(warehouses[0].stock, 2668);
  assert.equal(warehouses[1].name, "Коледино WB");
});

test("MPStats warehouse stocks sort by stock desc", () => {
  const warehouses = normalizeWarehouseStocks([
    { store_name: "Электросталь", balance: 1121438, items: 11579 },
    { store_name: "Коледино", balance: 728755, items: 11617 }
  ]);

  const koledino = warehouses.find((warehouse) => warehouse.name === "Коледино");
  const elektrostal = warehouses.find((warehouse) => warehouse.name === "Электросталь");

  assert.equal(koledino?.stock, 728755);
  assert.equal(koledino?.skuCount, 11617);
  assert.equal(elektrostal?.stock, 1121438);
  assert.equal(warehouses[0].name, "Электросталь");
});

test("MPStats subjects and niches sort by revenue desc", () => {
  const wbSubjects = normalizeSubjects(readFixture("wb-seller-subjects.sample.json"));
  const ozonNiches = normalizeSubjects(readFixture("ozon-seller-niches.sample.json"));

  assert.equal(wbSubjects[0].name, "Столы журнальные");
  assert.equal(wbSubjects[0].revenueShare, 0.6667);
  assert.equal(ozonNiches[0].name, "Дом и сад/Мебель");
});

test("MPStats partial seller report returns warnings without dropping successful blocks", () => {
  const report = buildSellerReportFromResponses({
    seller: {
      marketplace: "ozon",
      sellerId: "seller-1",
      sellerName: "Synthetic Seller",
      sourceProductId: "sku-1"
    },
    period: {
      from: "2026-06-03",
      to: "2026-07-03",
      days: 30,
      source: "fallback"
    },
    fulfillmentMode: "FBO_PLUS_FBS",
    responses: [
      { key: "summary", ok: true, data: readFixture("ozon-seller-by-date.sample.json") },
      { key: "priceSegments", ok: true, data: readFixture("ozon-seller-price-segmentation.sample.json") },
      { key: "warehouses", ok: true, data: { data: [] } },
      { key: "subjects", ok: false, error: { code: "mpstats_server_error", message: "Synthetic upstream error" } }
    ]
  });

  assert.equal(report.summary.revenue, 100000);
  assert.equal(report.priceSegments.length, 2);
  assert.equal(report.warehouses.length, 0);
  assert.equal(report.ozonGeography.length, 0);
  assert.ok(report.warnings.some((warning) => warning.code === "OZON_WAREHOUSES_MISSING"));
  assert.ok(report.warnings.some((warning) => warning.code === "SUBJECTS_UNAVAILABLE"));
});

test("MPStats sanitized live by-date fixtures normalize real items_with_sells fields", () => {
  const wbSummary = normalizeSellerSummary(readFixture("live/wb-seller-by-date.live.sample.json"));
  const ozonSummary = normalizeSellerSummary(readFixture("live/ozon-seller-by-date.live.sample.json"));

  assert.ok((wbSummary.itemsWithSales ?? 0) > 0);
  assert.ok((ozonSummary.itemsWithSales ?? 0) > 0);
  assert.ok((wbSummary.avgCheck ?? 0) > 0);
  assert.ok((ozonSummary.avgCheck ?? 0) > 0);
});

test("MPStats sanitized live price fixtures use MPStats min_range_price fields", () => {
  const wbSegments = normalizePriceSegments(readFixture("live/wb-seller-price-segmentation.live.sample.json"));
  const ozonSegments = normalizePriceSegments(readFixture("live/ozon-seller-price-segmentation.live.sample.json"));

  assert.ok(wbSegments.length > 0);
  assert.ok(ozonSegments.length > 0);
  assert.ok((wbSegments[0].minPrice ?? -1) >= 0);
  assert.ok((ozonSegments[0].minPrice ?? -1) >= 0);
});

test("MPStats Ozon geography does not become warehouse stock without stock fields", () => {
  const warehouses = normalizeWarehouseStocks(readFixture("live/ozon-seller-geography.live.sample.json"));

  assert.equal(warehouses.length, 0);
});

test("MPStats Ozon geography normalizes storage_data without stock fields", () => {
  const geography = normalizeOzonGeography(readFixture("live/ozon-seller-geography.live.sample.json"));

  assert.equal(geography.length, 8);
  assert.equal(geography[0].name, "Sample Product");
  assert.equal(geography[0].region, "Санкт-Петербург и СЗО");
  assert.equal(geography[0].sales, 60);
  assert.equal(geography[0].count, 170);
  assert.equal(geography[0].revenue, 397000);
  assert.equal(geography[0].salesShare, 20);
  assert.equal(geography[0].countShare, 70);
  assert.equal(geography[0].revenueShare, 8.57);
});

test("MPStats Ozon seller report keeps geography separate from WB warehouse stocks", () => {
  const report = buildSellerReportFromResponses({
    seller: {
      marketplace: "ozon",
      sellerId: "seller-1",
      sellerName: "Synthetic Seller",
      sourceProductId: "sku-1"
    },
    period: {
      from: "2026-06-03",
      to: "2026-07-02",
      days: 30,
      source: "fallback"
    },
    fulfillmentMode: "FBO_PLUS_FBS",
    responses: [
      { key: "summary", ok: true, data: readFixture("ozon-seller-by-date.sample.json") },
      { key: "priceSegments", ok: true, data: readFixture("ozon-seller-price-segmentation.sample.json") },
      { key: "warehouses", ok: true, data: readFixture("live/ozon-seller-geography.live.sample.json") },
      { key: "subjects", ok: true, data: readFixture("ozon-seller-niches.sample.json") }
    ]
  });

  assert.equal(report.warehouses.length, 0);
  assert.equal(report.ozonGeography.length, 8);
  assert.equal(report.ozonGeography[0].region, "Санкт-Петербург и СЗО");
  assert.equal(report.warnings.some((warning) => warning.code === "OZON_WAREHOUSES_MISSING"), false);
});
