import "server-only";

import { mpstatsRequest } from "./client";
import { resolveMarketplaceInput } from "./resolveInput";
import type { SellerResolveData, SellerResolveInput, SellerResolveResult } from "./types";

export async function resolveMpstatsSeller(input: SellerResolveInput): Promise<SellerResolveResult> {
  const resolvedInput = resolveMarketplaceInput(input);
  if (!resolvedInput.ok) return resolvedInput;

  const itemFull = await mpstatsRequest<unknown>({
    marketplace: resolvedInput.data.marketplace,
    method: "GET",
    path: `items/${resolvedInput.data.productId}/full`
  });

  if (!itemFull.ok) return itemFull;

  const normalized = normalizeSellerItemFull(itemFull.data);
  if (!normalized.sellerId && !normalized.sellerName) {
    return {
      ok: false,
      error: {
        code: "seller_not_found",
        message: "MPStats response did not contain seller information.",
        status: 502
      }
    };
  }

  return {
    ok: true,
    data: {
      marketplace: resolvedInput.data.marketplace,
      productId: resolvedInput.data.productId,
      sku: resolvedInput.data.sku,
      inputType: resolvedInput.data.inputType,
      ...normalized
    }
  };
}

function normalizeSellerItemFull(payload: unknown): Omit<SellerResolveData, "marketplace" | "productId" | "sku" | "inputType"> {
  const root = unwrapPayload(payload);
  const seller = getObject(root, "seller") ?? getObject(root, "supplier");

  // MPStats item/full responses vary by marketplace and category, so extraction stays intentionally tolerant.
  const sellerId =
    stringFromUnknown(getValue(seller, "id"))
    ?? stringFromUnknown(getValue(root, "seller_id"))
    ?? stringFromUnknown(getValue(root, "sellerId"))
    ?? stringFromUnknown(getValue(root, "supplier_id"))
    ?? stringFromUnknown(getValue(root, "supplierId"));

  const sellerName =
    stringFromUnknown(getValue(seller, "name"))
    ?? stringFromUnknown(getValue(root, "seller_name"))
    ?? stringFromUnknown(getValue(root, "sellerName"))
    ?? (typeof getValue(root, "seller") === "string" ? stringFromUnknown(getValue(root, "seller")) : null)
    ?? stringFromUnknown(getValue(root, "supplier_name"))
    ?? stringFromUnknown(getValue(root, "supplierName"));

  return {
    sellerId,
    sellerName,
    productName:
      stringFromUnknown(getValue(root, "name"))
      ?? stringFromUnknown(getValue(root, "title"))
      ?? stringFromUnknown(getValue(root, "product_name"))
      ?? stringFromUnknown(getValue(root, "productName")),
    brand: normalizeBrand(root),
    deliveryScheme:
      stringFromUnknown(getValue(root, "delivery_scheme"))
      ?? stringFromUnknown(getValue(root, "deliveryScheme"))
      ?? stringFromUnknown(getValue(root, "scheme"))
      ?? inferDeliveryScheme(root)
  };
}

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.data)) return payload.data;
  if (Array.isArray(payload.data) && isRecord(payload.data[0])) return payload.data[0];
  return payload;
}

function normalizeBrand(root: Record<string, unknown>) {
  const brand = getValue(root, "brand");
  if (typeof brand === "string" || typeof brand === "number") return stringFromUnknown(brand);
  if (isRecord(brand)) return stringFromUnknown(brand.name) ?? stringFromUnknown(brand.title);
  return stringFromUnknown(getValue(root, "brand_name")) ?? stringFromUnknown(getValue(root, "brandName"));
}

function inferDeliveryScheme(root: Record<string, unknown>) {
  const isFbs = getValue(root, "is_fbs");
  if (typeof isFbs === "boolean") return isFbs ? "FBS" : "FBO";

  const scheme = getValue(root, "delivery_type") ?? getValue(root, "deliveryType");
  if (typeof scheme === "string") return scheme;

  return null;
}

function getObject(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return isRecord(value) ? value : null;
}

function getValue(source: Record<string, unknown> | null, key: string): unknown {
  return source?.[key];
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
