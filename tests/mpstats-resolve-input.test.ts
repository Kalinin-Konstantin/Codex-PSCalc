import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMarketplaceInput } from "../src/lib/mpstats/resolveInput.ts";

test("resolves WB canonical URL", () => {
  const result = resolveMarketplaceInput({
    input: "https://www.wildberries.ru/catalog/123456/detail.aspx",
    marketplace: "auto"
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      marketplace: "wb",
      productId: "123456",
      sku: "123456",
      rawInput: "https://www.wildberries.ru/catalog/123456/detail.aspx",
      inputType: "url"
    }
  });
});

test("resolves WB URL with query params", () => {
  const result = resolveMarketplaceInput({
    input: "https://wildberries.ru/catalog/987654/detail.aspx?targetUrl=EX",
    marketplace: "auto"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.marketplace, "wb");
    assert.equal(result.data.productId, "987654");
  }
});

test("resolves WB short domain", () => {
  const result = resolveMarketplaceInput({
    input: "https://wb.ru/catalog/555777/detail.aspx",
    marketplace: "auto"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.marketplace, "wb");
    assert.equal(result.data.productId, "555777");
  }
});

test("resolves Ozon product URL", () => {
  const result = resolveMarketplaceInput({
    input: "https://www.ozon.ru/product/kreslo-ofisnoe-1252420260/",
    marketplace: "auto"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.marketplace, "ozon");
    assert.equal(result.data.productId, "1252420260");
  }
});

test("resolves Ozon context detail URL", () => {
  const result = resolveMarketplaceInput({
    input: "https://www.ozon.ru/context/detail/id/1252420260/",
    marketplace: "auto"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.marketplace, "ozon");
    assert.equal(result.data.productId, "1252420260");
  }
});

test("resolves Ozon URL with query params", () => {
  const result = resolveMarketplaceInput({
    input: "https://ozon.ru/product/tovar-777888999/?asb=abc&from_sku=777888999",
    marketplace: "auto"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.marketplace, "ozon");
    assert.equal(result.data.productId, "777888999");
  }
});

test("resolves manual SKU when marketplace is explicit", () => {
  const result = resolveMarketplaceInput({
    input: "123456789",
    marketplace: "ozon"
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      marketplace: "ozon",
      productId: "123456789",
      sku: "123456789",
      rawInput: "123456789",
      inputType: "sku"
    }
  });
});

test("returns typed error for unknown link", () => {
  const result = resolveMarketplaceInput({
    input: "https://example.com/product/123",
    marketplace: "auto"
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unsupported_marketplace");
  }
});

test("returns typed error for SKU without marketplace", () => {
  const result = resolveMarketplaceInput({
    input: "123456789",
    marketplace: "auto"
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "marketplace_required");
  }
});

test("does not require MPStats token for link parsing", () => {
  const previousToken = process.env.MPSTATS_TOKEN;
  delete process.env.MPSTATS_TOKEN;

  try {
    const result = resolveMarketplaceInput({
      input: "https://www.wildberries.ru/catalog/123456/detail.aspx",
      marketplace: "auto"
    });

    assert.equal(result.ok, true);
  } finally {
    if (previousToken == null) {
      delete process.env.MPSTATS_TOKEN;
    } else {
      process.env.MPSTATS_TOKEN = previousToken;
    }
  }
});
