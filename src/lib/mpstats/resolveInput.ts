import type { Marketplace, MarketplaceInput, MpstatsResult, ResolvedMarketplaceInput, SellerResolveInput } from "./types";

const NUMERIC_SKU_RE = /^\d+$/;

export function resolveMarketplaceInput(input: SellerResolveInput): MpstatsResult<ResolvedMarketplaceInput> {
  const rawInput = typeof input.input === "string" ? input.input.trim() : "";
  if (!rawInput) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "Введите ссылку на товар WB/Ozon или SKU."
      }
    };
  }

  const requestedMarketplace = normalizeMarketplaceInput(input.marketplace ?? "auto");
  if (!requestedMarketplace) {
    return {
      ok: false,
      error: {
        code: "unsupported_marketplace",
        message: "Маркетплейс должен быть auto, wb или ozon."
      }
    };
  }

  const parsedUrl = parseMarketplaceUrl(rawInput);
  if (parsedUrl.ok) {
    if (requestedMarketplace !== "auto" && parsedUrl.data.marketplace !== requestedMarketplace) {
      return {
        ok: false,
        error: {
          code: "unsupported_marketplace",
          message: "Ссылка относится к другому маркетплейсу."
        }
      };
    }
    return { ok: true, data: parsedUrl.data };
  }
  if (looksLikeUrl(rawInput)) return parsedUrl;

  if (NUMERIC_SKU_RE.test(rawInput)) {
    if (requestedMarketplace === "auto") {
      return {
        ok: false,
        error: {
          code: "marketplace_required",
          message: "Для ручного SKU укажите marketplace: wb или ozon."
        }
      };
    }

    return {
      ok: true,
      data: {
        marketplace: requestedMarketplace,
        productId: rawInput,
        sku: rawInput,
        rawInput,
        inputType: "sku"
      }
    };
  }

  return {
    ok: false,
    error: {
      code: "sku_not_found",
      message: "Не удалось определить маркетплейс или SKU из введенного значения."
    }
  };
}

export function normalizeMarketplaceInput(value: unknown): MarketplaceInput | null {
  if (value == null || value === "auto") return "auto";
  if (value === "wb" || value === "wildberries") return "wb";
  if (value === "ozon" || value === "oz") return "ozon";
  return null;
}

function parseMarketplaceUrl(rawInput: string): MpstatsResult<ResolvedMarketplaceInput> {
  const url = parseUrl(rawInput);
  if (!url) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "Введенное значение не похоже на поддерживаемую ссылку."
      }
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = decodeURIComponent(url.pathname);

  if (hostname === "wildberries.ru" || hostname === "wb.ru") {
    return resolveUrlSku("wb", rawInput, pathname, /\/catalog\/(\d+)\/detail\.aspx\/?$/i);
  }

  if (hostname === "ozon.ru") {
    const contextDetail = resolveUrlSku("ozon", rawInput, pathname, /\/context\/detail\/id\/(\d+)\/?$/i);
    if (contextDetail.ok) return contextDetail;

    return resolveUrlSku("ozon", rawInput, pathname, /\/product\/[^/?#]*-(\d+)\/?$/i);
  }

  return {
    ok: false,
    error: {
      code: "unsupported_marketplace",
      message: "Поддерживаются ссылки только Wildberries и Ozon."
    }
  };
}

function resolveUrlSku(
  marketplace: Marketplace,
  rawInput: string,
  pathname: string,
  pattern: RegExp
): MpstatsResult<ResolvedMarketplaceInput> {
  const match = pathname.match(pattern);
  const productId = match?.[1];
  if (!productId) {
    return {
      ok: false,
      error: {
        code: "sku_not_found",
        message: "Не удалось извлечь SKU из ссылки."
      }
    };
  }

  return {
    ok: true,
    data: {
      marketplace,
      productId,
      sku: productId,
      rawInput,
      inputType: "url"
    }
  };
}

function parseUrl(rawInput: string): URL | null {
  if (/^https?:\/\//i.test(rawInput)) {
    return safeUrl(rawInput);
  }

  if (/^(www\.)?(wildberries\.ru|wb\.ru|ozon\.ru)\//i.test(rawInput)) {
    return safeUrl(`https://${rawInput}`);
  }

  return null;
}

function looksLikeUrl(rawInput: string) {
  return /^https?:\/\//i.test(rawInput) || /^(www\.)?[A-Za-z0-9.-]+\//.test(rawInput);
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
