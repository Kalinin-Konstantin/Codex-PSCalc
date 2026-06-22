import type {
  CalculationResult,
  CalculatorSettings,
  CostVatMode,
  CostBreakdownItem,
  LogisticsAssumptions,
  Marketplace,
  MiddleMileTariffs,
  OzonCommissionEntry,
  PimProfitCenter,
  Scheme,
  SchemeResult,
  SkuDimensionClasses,
  SkuInput,
  SkuMetrics,
  TariffData,
  VatDisplayMode,
  WbCommissionEntry,
  WarehouseOperationGroup,
  WarehouseSupplyType,
  WarehouseTariffs
} from "./types.ts";

const SCHEMES: Scheme[] = ["fbo", "fbs", "dbs"];
const VAT_RATE = 0.22;
const WB_FAST_HANDOVER_DISCOUNT = 0.015;
const WAREHOUSE_OPERATIONS_DISPLAY_KEY = "warehouseOperations";
const DISPLAY_BREAKDOWN_ORDER: Record<Marketplace, Record<Scheme, string[]>> = {
  wildberries: {
    fbo: ["firstMile", "commission", "wbAcceptance", "wbStorage", "wbLastMile"],
    fbs: ["firstMile", "commission", WAREHOUSE_OPERATIONS_DISPLAY_KEY, "middleMile", "wbFbsLastMile"],
    dbs: ["firstMile", "commission", WAREHOUSE_OPERATIONS_DISPLAY_KEY, "lastMile"]
  },
  ozon: {
    fbo: ["firstMile", "commission", "ozonFboNonlocalMarkup", "ozonFboStorage", "ozonFboLogisticsTariff", "ozonPickupPoint"],
    fbs: ["firstMile", "commission", WAREHOUSE_OPERATIONS_DISPLAY_KEY, "middleMile", "ozonFbsAcceptance", "ozonFbsLogistics", "ozonPickupPoint"],
    dbs: ["firstMile", "commission", WAREHOUSE_OPERATIONS_DISPLAY_KEY, "lastMile"]
  }
};
const DISPLAY_LABELS: Record<string, string> = {
  firstMile: "Первая миля",
  middleMile: "Средняя миля",
  lastMile: "Последняя миля",
  wbAcceptance: "Приёмка WB",
  wbStorage: "Хранение WB",
  wbLastMile: "Логистика WB до покупателя",
  wbFbsLastMile: "Логистика WB FBS",
  ozonFboLogisticsTariff: "Логистика Ozon",
  ozonFboNonlocalMarkup: "Наценка за нелокальную продажу",
  ozonFboStorage: "Хранение Ozon",
  ozonPickupPoint: "Доставка до ПВЗ",
  ozonFbsAcceptance: "Приёмка отправления",
  ozonFbsLogistics: "Логистика Ozon"
};

type DraftBreakdownItem = Omit<CostBreakdownItem, "amountWithoutVatRub" | "amountWithVatRub" | "vatNote">;
type CommissionDiscount = { value: number };
type CommissionCost = {
  amountRub: number;
  rate: number;
  originalRate: number;
  discount: CommissionDiscount | null;
};
type CostParts = { baseRub: number; additionalRub: number; totalRub: number };
type LastMileCostParts = CostParts & {
  city: string;
  zoneLabel: string;
  includedKg: number;
  chargeableKg: number;
  extraKg: number;
  baseRateRub: number;
  extraRateRubPerKg: number;
};
type MiddleMileCostParts = CostParts & {
  volumeLiters: number;
  additionalTo190Liters: number;
  additional191To350Liters: number;
  firstLiterRub: number;
  additionalTo190Rub: number;
  additional191To350Rub: number;
  fixed351To1000Rub: number;
  fixedFrom1001Rub: number;
};

export function calculateSkuMetrics(sku: Pick<SkuInput, "lengthCm" | "widthCm" | "heightCm" | "weightKg">): SkuMetrics {
  const volumeLiters = (sku.lengthCm * sku.widthCm * sku.heightCm) / 1000;
  const volumetricWeightKg = (sku.lengthCm * sku.widthCm * sku.heightCm) / 5000;
  return {
    volumeLiters,
    volumetricWeightKg,
    chargeableKg: Math.max(sku.weightKg, volumetricWeightKg)
  };
}

export function classifySkuDimensions(sku: Pick<SkuInput, "lengthCm" | "widthCm" | "heightCm" | "weightKg">): SkuDimensionClasses {
  const sides = [sku.lengthCm, sku.widthCm, sku.heightCm].sort((left, right) => right - left);
  const [longestSide = 0, middleSide = 0, shortestSide = 0] = sides;
  const sidesSum = longestSide + middleSide + shortestSide;
  const isWbMgt = sku.weightKg < 25 && longestSide <= 120 && sidesSum <= 200;
  const isWbKgtPlus = sku.weightKg < 25 && longestSide <= 200 && sidesSum <= 280 && (longestSide >= 121 || sidesSum >= 201);
  const isOzonStandard = sku.weightKg <= 25 && longestSide <= 120 && middleSide <= 80 && shortestSide <= 60;

  return {
    wildberries: isWbMgt ? "mgt" : isWbKgtPlus ? "kgt_plus" : "sgt",
    ozon: isOzonStandard ? "standard" : "kgt"
  };
}

export function calculateAllSchemes(sku: SkuInput, settings: CalculatorSettings, tariffs: TariffData): CalculationResult {
  const normalizedSettings = normalizeCalculatorSettings(settings);
  return {
    wildberries: {
      fbo: calculateMarketplaceScheme("wildberries", "fbo", sku, normalizedSettings, tariffs),
      fbs: calculateMarketplaceScheme("wildberries", "fbs", sku, normalizedSettings, tariffs),
      dbs: calculateMarketplaceScheme("wildberries", "dbs", sku, normalizedSettings, tariffs)
    },
    ozon: {
      fbo: calculateMarketplaceScheme("ozon", "fbo", sku, normalizedSettings, tariffs),
      fbs: calculateMarketplaceScheme("ozon", "fbs", sku, normalizedSettings, tariffs),
      dbs: calculateMarketplaceScheme("ozon", "dbs", sku, normalizedSettings, tariffs)
    }
  };
}

function normalizeCalculatorSettings(settings: CalculatorSettings): CalculatorSettings {
  const warehouseSupplyType = normalizeWarehouseSupplyType((settings as { warehouseSupplyType?: unknown }).warehouseSupplyType);
  return warehouseSupplyType === settings.warehouseSupplyType ? settings : { ...settings, warehouseSupplyType };
}

function normalizeWarehouseSupplyType(value: unknown): WarehouseSupplyType {
  if (value === "box" || value === "boxes") return "boxes";
  if (value === "mix_pallet") return "mix_pallet";
  return "mono_pallet";
}

export function flattenResults(result: CalculationResult): SchemeResult[] {
  return [
    result.wildberries.fbo,
    result.wildberries.fbs,
    result.wildberries.dbs,
    result.ozon.fbo,
    result.ozon.fbs,
    result.ozon.dbs
  ];
}

export function findBestResult(result: CalculationResult): SchemeResult {
  const complete = flattenResults(result).filter((item) => item.isComplete);
  const comparable = complete.length ? complete : flattenResults(result);
  return comparable.reduce((best, current) => (current.totalRub < best.totalRub ? current : best));
}

export function breakdownItemsForDisplay(result: SchemeResult): CostBreakdownItem[] {
  const warehouseItems = result.breakdown.filter((item) => item.pimProfitCenter === "warehouse");
  const itemByKey = new Map(result.breakdown.filter((item) => item.pimProfitCenter !== "warehouse").map((item) => [item.key, item]));
  const warehouseOperations = warehouseItems.length ? aggregateWarehouseOperations(warehouseItems) : null;
  const usedKeys = new Set<string>();

  const orderedItems = DISPLAY_BREAKDOWN_ORDER[result.marketplace][result.scheme]
    .map((key) => {
      if (key === WAREHOUSE_OPERATIONS_DISPLAY_KEY) return warehouseOperations;
      const item = itemByKey.get(key);
      if (item) usedKeys.add(key);
      return item ? withDisplayLabel(item) : null;
    })
    .filter((item): item is CostBreakdownItem => item != null);

  const restItems = result.breakdown
    .filter((item) => item.pimProfitCenter !== "warehouse" && !usedKeys.has(item.key))
    .map(withDisplayLabel);

  return [...orderedItems, ...restItems];
}

function withDisplayLabel(item: CostBreakdownItem): CostBreakdownItem {
  const displayLabel = DISPLAY_LABELS[item.key] ?? item.label;
  const label = item.isReferenceOnly ? `${displayLabel} (справочно)` : displayLabel;
  return label !== item.label ? { ...item, label } : item;
}

function aggregateWarehouseOperations(items: CostBreakdownItem[]): CostBreakdownItem {
  const firstItem = items[0];
  const amountRub = money(sumBreakdown(items, "amountRub"));
  const amountWithoutVatRub = money(sumBreakdown(items, "amountWithoutVatRub"));
  const amountWithVatRub = money(sumBreakdown(items, "amountWithVatRub"));
  const pimCostWithoutVatRub = money(items.reduce((sum, item) => sum + (item.pimCostWithoutVatRub ?? item.amountWithoutVatRub), 0));
  const pimProfitWithoutVatRub = money(sumBreakdownOptional(items, "pimProfitWithoutVatRub"));
  const pimProfitWithVatRub = money(sumBreakdownOptional(items, "pimProfitWithVatRub"));
  const operationDetails = items.map((item) => `${item.label}: ${formatDecimal(item.amountRub)} ₽`).join("; ");

  return {
    ...firstItem,
    key: WAREHOUSE_OPERATIONS_DISPLAY_KEY,
    label: "Операции PIM.Seller",
    amountRub,
    amountWithoutVatRub,
    amountWithVatRub,
    calculationNote: `Состав статьи: ${operationDetails}. Итого: ${formatDecimal(amountRub)} ₽ ${firstItem.vatNote}.`,
    internalNote: undefined,
    pimWarehouseGroup: undefined,
    pimWarehouseOperationKey: undefined,
    pimCostWithoutVatRub,
    pimProfitWithoutVatRub,
    pimProfitWithVatRub
  };
}

function sumBreakdown(items: CostBreakdownItem[], key: "amountRub" | "amountWithoutVatRub" | "amountWithVatRub"): number {
  return items.reduce((sum, item) => sum + item[key], 0);
}

function sumBreakdownOptional(items: CostBreakdownItem[], key: "pimProfitWithoutVatRub" | "pimProfitWithVatRub"): number {
  return items.reduce((sum, item) => sum + (item[key] ?? 0), 0);
}

function calculateMarketplaceScheme(
  marketplace: Marketplace,
  scheme: Scheme,
  sku: SkuInput,
  settings: CalculatorSettings,
  tariffs: TariffData
): SchemeResult {
  const warnings: string[] = [];
  const dimensionClasses = classifySkuDimensions(sku);
  addDimensionWarnings(marketplace, scheme, dimensionClasses, warnings);
  if (settings.fastHandover && marketplace === "wildberries" && scheme === "fbs" && dimensionClasses.wildberries === "sgt") {
    warnings.push("Предупреждение: для WB СГТ скидка за быструю сдачу не применяется.");
  }
  const commission = commissionCost(marketplace, scheme, sku, settings, tariffs);
  const firstMile = firstMileCost(settings.originCity, settings.firstMileCity, sku.itemsPerPallet, tariffs.logistics);
  if (commission == null) {
    warnings.push(
      marketplace === "wildberries"
        ? `Не найдена комиссия WB для предмета "${sku.wbSubject}"`
        : `Не найдена комиссия Ozon для типа товара "${sku.ozonProductType}"`
    );
  }

  const breakdown: DraftBreakdownItem[] = [
    {
      key: "firstMile",
      label:
        settings.presentationMode === "internal"
          ? firstMileLabel(settings.originCity, settings.firstMileCity, sku.itemsPerPallet, tariffs.logistics)
          : "Первая миля",
      amountRub: firstMile ?? 0,
      source: "assumption",
      vatMode: "without_vat",
      isReferenceOnly: scheme === "fbo",
      calculationNote: firstMileNote(settings.originCity, settings.firstMileCity, sku.itemsPerPallet, tariffs.logistics)
    },
    {
      key: "commission",
      label: commission == null ? "Комиссия маркетплейса" : `Комиссия маркетплейса ${formatCommissionRate(commission)}`,
      amountRub: commission?.amountRub ?? 0,
      source: "marketplace",
      vatMode: "with_vat",
      calculationNote:
        commission == null
          ? "Комиссия не найдена по категории/типу товара."
          : commissionCalculationNote(commission)
    }
  ];
  if (firstMile == null && scheme === "fbo") {
    warnings.push(`Предупреждение: не найден справочный тариф первой мили PIM.Seller для маршрута "${settings.originCity} → ${settings.firstMileCity}"`);
  } else if (firstMile == null) {
    warnings.push(`Не найден тариф первой мили PIM.Seller для маршрута "${settings.originCity} → ${settings.firstMileCity}"`);
  }

  if (marketplace === "wildberries") {
    breakdown.push(...wildberriesMarketplaceCosts(scheme, sku, settings, tariffs.logistics, warnings));
  } else {
    breakdown.push(...ozonMarketplaceCosts(scheme, sku, settings, tariffs.logistics, warnings));
  }

  if (scheme === "fbs" || scheme === "dbs") {
    breakdown.push(...pimWarehouseCosts(sku, settings.storageDays, tariffs.warehouse, settings));
  }

  if (scheme === "fbs") {
    const middleMile = middleMileCostParts(sku, tariffs.middleMile);
    breakdown.push({
      key: "middleMile",
      label: "Средняя миля PIM.Seller",
      amountRub: middleMile.totalRub,
      pimBaseCostWithoutVatRub: middleMile.baseRub,
      pimAdditionalCostWithoutVatRub: middleMile.additionalRub,
      pimMiddleMileFirstLiterCostWithoutVatRub: middleMile.firstLiterRub,
      pimMiddleMileAdditionalTo190CostWithoutVatRub: middleMile.additionalTo190Rub,
      pimMiddleMileAdditional191To350CostWithoutVatRub: middleMile.additional191To350Rub,
      pimMiddleMileFixed351To1000CostWithoutVatRub: middleMile.fixed351To1000Rub,
      pimMiddleMileFixedFrom1001CostWithoutVatRub: middleMile.fixedFrom1001Rub,
      pimMiddleMileCalculation: {
        volumeLiters: middleMile.volumeLiters,
        additionalTo190Liters: middleMile.additionalTo190Liters,
        additional191To350Liters: middleMile.additional191To350Liters
      },
      source: "pim",
      vatMode: "without_vat",
      calculationNote: middleMileNote(sku, middleMile)
    });
  }

  if (scheme === "dbs") {
    const lastMile = pimLastMileCostParts(sku, settings, tariffs.logistics);
    if (lastMile == null) {
      warnings.push(`Не найден тариф последней мили PIM.Seller для города "${settings.firstMileCity}"`);
    }
    breakdown.push({
      key: "lastMile",
      label: "Последняя миля PIM.Seller",
      amountRub: lastMile?.totalRub ?? 0,
      pimBaseCostWithoutVatRub: lastMile?.baseRub ?? 0,
      pimAdditionalCostWithoutVatRub: lastMile?.additionalRub ?? 0,
      pimLastMileCalculation: lastMile
        ? {
            city: lastMile.city,
            zoneLabel: lastMile.zoneLabel,
            includedKg: lastMile.includedKg,
            chargeableKg: lastMile.chargeableKg,
            extraKg: lastMile.extraKg,
            baseRateRub: lastMile.baseRateRub,
            extraRateRubPerKg: lastMile.extraRateRubPerKg
          }
        : undefined,
      source: "pim",
      vatMode: "without_vat",
      calculationNote: lastMileNote(sku, settings, tariffs.logistics, lastMile)
    });
  }

  const commercialBreakdown = breakdown.map((item) => applyPimCommercialMarkup(item, settings));
  const roundedBreakdown = normalizeBreakdownForVat(commercialBreakdown, settings.vatDisplayMode);
  const totalRub = money(roundedBreakdown.reduce((sum, item) => sum + (item.isReferenceOnly ? 0 : item.amountRub), 0));
  const priceBasisRub = displayPrice(sku.price, settings.vatDisplayMode);
  return {
    marketplace,
    scheme,
    isComplete: !hasBlockingWarnings(warnings),
    totalRub,
    percentOfPrice: priceBasisRub > 0 ? totalRub / priceBasisRub : 0,
    priceBasisRub,
    vatDisplayMode: settings.vatDisplayMode,
    breakdown: roundedBreakdown,
    warnings
  };
}

function normalizeBreakdownForVat(breakdown: DraftBreakdownItem[], displayMode: VatDisplayMode): CostBreakdownItem[] {
  return breakdown.map((item) => {
    const withoutVat = amountWithoutVat(item.amountRub, item.vatMode);
    const withVat = amountWithVat(item.amountRub, item.vatMode);
    const amountRub = displayMode === "with_vat" ? withVat : withoutVat;
    return {
      ...item,
      amountRub: money(amountRub),
      amountWithoutVatRub: money(withoutVat),
      amountWithVatRub: money(withVat),
      vatNote: vatNote(item.vatMode, displayMode)
    };
  });
}

function applyPimCommercialMarkup(item: DraftBreakdownItem, settings: CalculatorSettings): DraftBreakdownItem {
  if (item.isReferenceOnly) return item;
  const profitCenter = pimProfitCenter(item.key);
  if (!profitCenter) return item;

  const markup = pimMarkup(item, profitCenter, settings);
  const amountRub = item.amountRub + markup.profitRub;
  return {
    ...item,
    amountRub,
    pimProfitCenter: profitCenter,
    pimCostWithoutVatRub: money(item.amountRub),
    pimProfitWithoutVatRub: money(markup.profitRub),
    pimProfitWithVatRub: money(markup.profitRub * (1 + VAT_RATE)),
    internalNote:
      settings.presentationMode === "internal" && markup.profitRub > 0
        ? `Себестоимость ${formatDecimal(item.amountRub)} ₽ · наценка ${markup.note}`
        : undefined,
    calculationNote:
      settings.presentationMode === "internal"
        ? item.calculationNote
        : clientPimCalculationNote(item, profitCenter, markup)
  };
}

function clientPimCalculationNote(
  item: DraftBreakdownItem,
  profitCenter: PimProfitCenter,
  markup: {
    profitRub: number;
    note: string;
    firstLiterProfitRub?: number;
    additionalTo190ProfitRub?: number;
    additional191To350ProfitRub?: number;
    fixed351To1000ProfitRub?: number;
    fixedFrom1001ProfitRub?: number;
    baseProfitRub?: number;
    additionalProfitRub?: number;
  }
): string | undefined {
  if (profitCenter === "middleMile" && item.pimMiddleMileCalculation) {
    const parts: MiddleMileCostParts = {
      baseRub: (item.pimBaseCostWithoutVatRub ?? 0) + markup.profitRub,
      additionalRub: (item.pimAdditionalCostWithoutVatRub ?? 0) + (markup.additionalTo190ProfitRub ?? 0) + (markup.additional191To350ProfitRub ?? 0) + (markup.fixed351To1000ProfitRub ?? 0) + (markup.fixedFrom1001ProfitRub ?? 0),
      totalRub: item.amountRub + markup.profitRub,
      volumeLiters: item.pimMiddleMileCalculation.volumeLiters,
      additionalTo190Liters: item.pimMiddleMileCalculation.additionalTo190Liters,
      additional191To350Liters: item.pimMiddleMileCalculation.additional191To350Liters,
      firstLiterRub: (item.pimMiddleMileFirstLiterCostWithoutVatRub ?? 0) + (markup.firstLiterProfitRub ?? 0),
      additionalTo190Rub: (item.pimMiddleMileAdditionalTo190CostWithoutVatRub ?? 0) + (markup.additionalTo190ProfitRub ?? 0),
      additional191To350Rub: (item.pimMiddleMileAdditional191To350CostWithoutVatRub ?? 0) + (markup.additional191To350ProfitRub ?? 0),
      fixed351To1000Rub: (item.pimMiddleMileFixed351To1000CostWithoutVatRub ?? 0) + (markup.fixed351To1000ProfitRub ?? 0),
      fixedFrom1001Rub: (item.pimMiddleMileFixedFrom1001CostWithoutVatRub ?? 0) + (markup.fixedFrom1001ProfitRub ?? 0)
    };
    return middleMileCalculationText(parts);
  }
  if (profitCenter === "lastMile" && item.pimLastMileCalculation) {
    const details = item.pimLastMileCalculation;
    const baseRateRub = (item.pimBaseCostWithoutVatRub ?? details.baseRateRub) + (markup.baseProfitRub ?? 0);
    const extraRateRubPerKg =
      details.extraKg > 0
        ? ((item.pimAdditionalCostWithoutVatRub ?? 0) + (markup.additionalProfitRub ?? 0)) / details.extraKg
        : details.extraRateRubPerKg + (markup.additionalProfitRub ?? 0);
    return lastMileCalculationText(details, baseRateRub, extraRateRubPerKg);
  }
  return item.calculationNote;
}

function pimProfitCenter(key: string): PimProfitCenter | null {
  if (key === "firstMile") return "firstMile";
  if (key === "middleMile") return "middleMile";
  if (key === "lastMile") return "lastMile";
  if (key.startsWith("pimFulfillmentExtra:")) return "warehouse";
  if (key === "pimReceiving" || key === "pimStorageSorting" || key === "pimStorage" || key === "pimFulfillment" || key === "pimLabeling" || key === "pimShipping") return "warehouse";
  return null;
}

function pimMarkup(
  item: DraftBreakdownItem,
  profitCenter: PimProfitCenter,
  settings: CalculatorSettings
): {
  profitRub: number;
  note: string;
  firstLiterProfitRub?: number;
  additionalTo190ProfitRub?: number;
  additional191To350ProfitRub?: number;
  fixed351To1000ProfitRub?: number;
  fixedFrom1001ProfitRub?: number;
  baseProfitRub?: number;
  additionalProfitRub?: number;
} {
  if (profitCenter === "middleMile") {
    const firstLiter = item.pimMiddleMileFirstLiterCostWithoutVatRub ?? item.pimBaseCostWithoutVatRub ?? item.amountRub;
    const additionalTo190 = item.pimMiddleMileAdditionalTo190CostWithoutVatRub ?? item.pimAdditionalCostWithoutVatRub ?? 0;
    const additional191To350 = item.pimMiddleMileAdditional191To350CostWithoutVatRub ?? 0;
    const fixed351To1000 = item.pimMiddleMileFixed351To1000CostWithoutVatRub ?? 0;
    const fixedFrom1001 = item.pimMiddleMileFixedFrom1001CostWithoutVatRub ?? 0;
    const firstLiterProfit = firstLiter * (settings.middleMileFirstLiterMarkupPercent / 100);
    const additionalTo190Profit = additionalTo190 * (settings.middleMileAdditionalLiterMarkupPercent / 100);
    const additional191To350Profit = additional191To350 * (settings.middleMileOver190LiterMarkupPercent / 100);
    const fixed351To1000Profit = fixed351To1000 * (settings.middleMileFrom351To1000MarkupPercent / 100);
    const fixedFrom1001Profit = fixedFrom1001 * (settings.middleMileFrom1001MarkupPercent / 100);
    const noteParts: string[] = [];
    if (firstLiter > 0) noteParts.push(`1-й литр ${formatDecimal(settings.middleMileFirstLiterMarkupPercent)}%`);
    if (additionalTo190 > 0) noteParts.push(`2-190 л ${formatDecimal(settings.middleMileAdditionalLiterMarkupPercent)}%`);
    if (additional191To350 > 0) noteParts.push(`191-350 л ${formatDecimal(settings.middleMileOver190LiterMarkupPercent)}%`);
    if (fixed351To1000 > 0) noteParts.push(`351-1000 л ${formatDecimal(settings.middleMileFrom351To1000MarkupPercent)}%`);
    if (fixedFrom1001 > 0) noteParts.push(`1001+ л ${formatDecimal(settings.middleMileFrom1001MarkupPercent)}%`);
    return {
      profitRub: firstLiterProfit + additionalTo190Profit + additional191To350Profit + fixed351To1000Profit + fixedFrom1001Profit,
      note: noteParts.join(", "),
      firstLiterProfitRub: firstLiterProfit,
      additionalTo190ProfitRub: additionalTo190Profit,
      additional191To350ProfitRub: additional191To350Profit,
      fixed351To1000ProfitRub: fixed351To1000Profit,
      fixedFrom1001ProfitRub: fixedFrom1001Profit
    };
  }

  if (profitCenter === "lastMile") {
    const base = item.pimBaseCostWithoutVatRub ?? item.amountRub;
    const additional = item.pimAdditionalCostWithoutVatRub ?? 0;
    const baseProfit = base * (settings.lastMileBaseMarkupPercent / 100);
    const additionalProfit = additional * (settings.lastMileAdditionalKgMarkupPercent / 100);
    return {
      profitRub: baseProfit + additionalProfit,
      note: `до 3 кг ${formatDecimal(settings.lastMileBaseMarkupPercent)}%, сверх 3 кг ${formatDecimal(settings.lastMileAdditionalKgMarkupPercent)}%`,
      baseProfitRub: baseProfit,
      additionalProfitRub: additionalProfit
    };
  }

  const markupPercent = profitCenter === "warehouse" ? warehouseMarkupPercent(item, settings) : settings.firstMileMarkupPercent;
  return {
    profitRub: item.amountRub * (markupPercent / 100),
    note: `${formatDecimal(markupPercent)}%`
  };
}

function warehouseMarkupPercent(item: DraftBreakdownItem, settings: CalculatorSettings): number {
  const group = item.pimWarehouseGroup ?? warehouseGroupForBreakdownKey(item.key);
  if (!group) return settings.warehouseMarkupPercent;
  if (item.pimWarehouseOperationKey) {
    return (
      settings.warehouseOperationRowMarkupPercents[item.pimWarehouseOperationKey] ??
      defaultWarehouseOperationRowMarkupPercent(settings, group, item.pimWarehouseOperationKey) ??
      settings.warehouseMarkupPercent ??
      20
    );
  }
  return settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
}

function defaultWarehouseOperationRowMarkupPercent(settings: CalculatorSettings, group: WarehouseOperationGroup, operationKey: string): number {
  const groupPercent = settings.warehouseOperationMarkupPercents[group];
  if (group === "storage" && operationKey.toLowerCase() === "хранение товара" && groupPercent === 20) return 30;
  return groupPercent ?? 20;
}

function amountWithoutVat(amountRub: number, vatMode: CostVatMode): number {
  if (vatMode === "with_vat") return amountRub / (1 + VAT_RATE);
  return amountRub;
}

function amountWithVat(amountRub: number, vatMode: CostVatMode): number {
  if (vatMode === "without_vat") return amountRub * (1 + VAT_RATE);
  return amountRub;
}

function displayPrice(priceRub: number, displayMode: VatDisplayMode): number {
  return money(displayMode === "with_vat" ? priceRub : priceRub / (1 + VAT_RATE));
}

function vatNote(vatMode: CostVatMode, displayMode: VatDisplayMode): string {
  if (vatMode === "no_vat") return "НДС не применяется";
  return displayMode === "with_vat" ? "с НДС" : "без НДС";
}

function hasBlockingWarnings(warnings: string[]): boolean {
  return warnings.some((warning) => !warning.startsWith("Поставка WB на ") && !warning.startsWith("Предупреждение:"));
}

function commissionCost(
  marketplace: Marketplace,
  scheme: Scheme,
  sku: SkuInput,
  settings: CalculatorSettings,
  tariffs: TariffData
): CommissionCost | null {
  const rate =
    marketplace === "wildberries"
      ? findWbCommission(sku, tariffs.wildberriesCommissions)?.[scheme]
      : findOzonCommission(sku, scheme, tariffs.ozonCommissions);
  if (rate == null) return null;
  const discount = commissionDiscount(marketplace, scheme, settings, sku);
  const effectiveRate = applyCommissionDiscount(rate, discount);
  return { amountRub: sku.price * effectiveRate, rate: effectiveRate, originalRate: rate, discount };
}

function commissionDiscount(marketplace: Marketplace, scheme: Scheme, settings: CalculatorSettings, sku: SkuInput): CommissionDiscount | null {
  if (!settings.fastHandover || scheme !== "fbs") return null;
  if (marketplace === "wildberries") {
    return classifySkuDimensions(sku).wildberries === "sgt" ? null : { value: WB_FAST_HANDOVER_DISCOUNT };
  }
  return { value: ozonFastHandoverDiscount(settings.ozonFastHandoverType) };
}

function addDimensionWarnings(marketplace: Marketplace, scheme: Scheme, classes: SkuDimensionClasses, warnings: string[]): void {
  if (marketplace === "wildberries" && classes.wildberries === "kgt_plus") {
    warnings.push("Предупреждение: WB КГТ+ — проверьте доступность выбранного склада и типа поставки.");
  }
  if (marketplace === "wildberries" && classes.wildberries === "sgt") {
    warnings.push("Предупреждение: WB СГТ — проверьте доступность выбранного склада и типа поставки.");
  }
  if (marketplace === "ozon" && classes.ozon === "kgt" && scheme === "dbs") {
    warnings.push(ozonKgtDbsWarning());
  }
}

function ozonKgtDbsWarning(): string {
  return "Предупреждение: Ozon КГТ DBS/RFBS — комиссия берется из RFBS, доставка PIM.Seller считается по расчётному весу; маркетплейс-логистика Ozon в DBS не применяется.";
}

function ozonFastHandoverDiscount(type: CalculatorSettings["ozonFastHandoverType"]): number {
  if (type === "sc_courier_under_12") return 0.03;
  return 0.02;
}

function applyCommissionDiscount(rate: number, discount: CommissionDiscount | null): number {
  if (!discount) return rate;
  return Math.max(0, rate - discount.value);
}

function formatRate(rate: number): string {
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : money(percent)}%`;
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function formatCommissionRate(commission: CommissionCost): string {
  if (!commission.discount) return formatRate(commission.rate);
  return `${formatRate(commission.rate)} (${formatRate(commission.originalRate)}-${formatRate(commission.discount.value)})`;
}

function commissionCalculationNote(commission: CommissionCost): string {
  const base = `Цена товара × ставка комиссии ${formatCommissionRate(commission)}.`;
  if (!commission.discount) return base;
  return `${base} Снижение ${formatRate(commission.discount.value)} применяется за Быструю сдачу.`;
}

export function findWbCommission(sku: Pick<SkuInput, "wbSubject" | "wbCategory">, entries: WbCommissionEntry[]): Record<Scheme, number> | null {
  if (!normalizeLookupText(sku.wbSubject)) return null;
  const bySubject = entries.find((entry) => sameLookupText(entry.subject, sku.wbSubject));
  if (bySubject) return bySubject.commission;
  return null;
}

export function findOzonCommission(
  sku: Pick<SkuInput, "price" | "ozonProductType" | "ozonCategory">,
  scheme: Scheme,
  entries: OzonCommissionEntry[]
): number | null {
  const entry = findOzonCommissionEntry(sku, entries);
  if (!entry) return null;
  const bands = entry.commissionBands[scheme];
  const key = priceBandKey(sku.price, scheme);
  return bands[key] ?? bands.over10000 ?? Object.values(bands)[0] ?? null;
}

function findOzonCommissionEntry(
  sku: Pick<SkuInput, "ozonProductType" | "ozonCategory">,
  entries: OzonCommissionEntry[]
): OzonCommissionEntry | null {
  if (!normalizeLookupText(sku.ozonProductType)) return null;
  const byProductType = entries.filter((item) => sameLookupText(item.productType, sku.ozonProductType));
  if (byProductType.length) {
    return (
      byProductType.find((item) => sameLookupText(item.category, sku.ozonCategory)) ??
      byProductType.find((item) => !item.category.startsWith("Благотворительность")) ??
      byProductType[0]
    );
  }
  return null;
}

function sameLookupText(left: string, right: string): boolean {
  return normalizeLookupText(left) === normalizeLookupText(right);
}

function normalizeLookupText(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/ё/g, "е").replace(/Ё/g, "Е").toLocaleLowerCase("ru-RU");
}

function priceBandKey(price: number, scheme: Scheme): string {
  if (scheme === "dbs") {
    if (price <= 1500) return "300to1500";
    if (price <= 5000) return "1500to5000";
    if (price <= 10000) return "5000to10000";
    return "over10000";
  }
  if (price <= 100) return "to100";
  if (price <= 300) return "100to300";
  if (price <= 1500) return "300to1500";
  if (price <= 5000) return "1500to5000";
  if (price <= 10000) return "5000to10000";
  return "over10000";
}

function firstMileCost(originCity: string, destinationCity: string, itemsPerPallet: number, logistics: LogisticsAssumptions): number | null {
  const route = logistics.firstMile.routes?.find((item) => item.originCity === originCity && item.destinationCity === destinationCity);
  const rubPerPallet = route?.rubPerPallet ?? null;
  if (rubPerPallet == null) return null;
  return safeDivide(rubPerPallet, itemsPerPallet);
}

function firstMileLabel(originCity: string, destinationCity: string, itemsPerPallet: number, logistics: LogisticsAssumptions): string {
  const route = logistics.firstMile.routes?.find((item) => item.originCity === originCity && item.destinationCity === destinationCity);
  if (route?.rubPerPallet == null) return "Первая миля";
  return `Первая миля (${formatDecimal(route.rubPerPallet)} ₽/паллет / ${formatDecimal(itemsPerPallet)} шт.)`;
}

function firstMileNote(originCity: string, destinationCity: string, itemsPerPallet: number, logistics: LogisticsAssumptions): string {
  const route = logistics.firstMile.routes?.find((item) => item.originCity === originCity && item.destinationCity === destinationCity);
  if (route?.rubPerPallet == null) return `Маршрут ${originCity} → ${destinationCity}: тариф не найден.`;
  return `Маршрут ${originCity} → ${destinationCity}: ${formatDecimal(route.rubPerPallet)} ₽/паллет / ${formatDecimal(itemsPerPallet)} SKU.`;
}

function pimWarehouseCosts(
  sku: SkuInput,
  storageDays: number,
  warehouse: WarehouseTariffs,
  settings: CalculatorSettings
): DraftBreakdownItem[] {
  const selected = warehouse.selected;
  const receiving = receivingCost(sku, warehouse, settings);
  const storage = storageCost(sku, storageDays, warehouse, settings);
  const storageSorting = storageSortingCost(sku, warehouse, settings);
  const outbound = outboundCost(sku.weightKg, warehouse);
  const shipping = shippingCost(sku, warehouse);
  const fulfillmentExtras = fulfillmentExtraCosts(sku, warehouse, settings);
  const operations: DraftBreakdownItem[] = [
    {
      key: "pimReceiving",
      label: receiving.label,
      amountRub: receiving.amountRub,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "receiving",
      pimWarehouseOperationKey: receiving.operationKey,
      calculationNote: receiving.note
    },
    ...(storageSorting
      ? [
          {
            key: "pimStorageSorting",
            label: storageSorting.label,
            amountRub: storageSorting.amountRub,
            source: "pim" as const,
            vatMode: "without_vat" as const,
            pimWarehouseGroup: "storage" as const,
            pimWarehouseOperationKey: storageSorting.operationKey,
            calculationNote: storageSorting.note
          }
        ]
      : []),
    {
      key: "pimStorage",
      label: storage.label,
      amountRub: storage.amountRub,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "storage",
      pimWarehouseOperationKey: storage.operationKey,
      calculationNote: storage.note
    },
    {
      key: "pimFulfillment",
      label: "Комплектация PIM.Seller",
      amountRub: outbound.amountRub,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "fulfillment",
      pimWarehouseOperationKey: outbound.operationKey,
      calculationNote: `${outbound.operationName}: фактический вес ${formatDecimal(sku.weightKg)} кг.`
    },
    {
      key: "pimLabeling",
      label: "Маркировка PIM.Seller",
      amountRub: selected.labeling ?? 0,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "fulfillment",
      pimWarehouseOperationKey: warehouse.selectedMapping?.labeling ?? "Маркировка ручная",
      calculationNote: `Фиксированный тариф маркировки: ${formatDecimal(selected.labeling ?? 0)} ₽/SKU.`
    },
    ...fulfillmentExtras,
    {
      key: "pimShipping",
      label: "Отгрузка со склада PIM.Seller",
      amountRub: shipping.amountRub,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "shipping",
      pimWarehouseOperationKey: shipping.operationKey,
      calculationNote: shipping.note
    }
  ];
  return operations.filter((item) => {
    const group = item.pimWarehouseGroup;
    return group ? settings.warehouseOperationGroups[group] !== false : true;
  });
}

function fulfillmentExtraCosts(sku: SkuInput, warehouse: WarehouseTariffs, settings: CalculatorSettings): DraftBreakdownItem[] {
  return fulfillmentExtraOperations(warehouse.operations ?? [])
    .filter((operation) => fulfillmentExtraOperationMatchesSku(operation.name, sku))
    .filter((operation) => settings.warehouseFulfillmentExtraOperations[fulfillmentExtraOperationKey(operation)])
    .map((operation) => {
      const amountRub = warehouseOperationUnitCost(operation, sku);
      const operationKey = fulfillmentExtraOperationKey(operation);
      return {
        key: `pimFulfillmentExtra:${operationKey}`,
        label: fulfillmentOperationDisplayName(operation.name),
        amountRub,
        source: "pim",
        vatMode: "without_vat",
        pimWarehouseGroup: "fulfillment",
        pimWarehouseOperationKey: operationKey,
        calculationNote: `${operation.name}: ${formatDecimal(operation.priceRub)} ₽/${operation.unit}${operation.unit.toLowerCase().includes("паллет") ? ` / ${formatDecimal(sku.itemsPerPallet)} SKU` : ""}.`
      };
    });
}

function fulfillmentExtraOperations(operations: NonNullable<WarehouseTariffs["operations"]>): NonNullable<WarehouseTariffs["operations"]> {
  return operations.filter((operation) => isFulfillmentExtraOperationName(operation.name));
}

function fulfillmentExtraOperationKey(operation: NonNullable<WarehouseTariffs["operations"]>[number]): string {
  return `${operation.name}::${operation.priceRub}`;
}

function isFulfillmentExtraOperationName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("упаковка в пузырчатую пленку") ||
    normalized.includes("упаковка в термоусадочную пленку") ||
    normalized === "упаковка в пакет с клеевым клапаном" ||
    normalized === "упаковка в стрейч-пленку" ||
    normalized === "сканирование чз" ||
    normalized === "сканирование серийного номера"
  );
}

function fulfillmentExtraOperationMatchesSku(name: string, sku: SkuInput): boolean {
  const range = fulfillmentExtraOperationVolumeRange(name);
  if (!range) return true;
  const { volumeLiters } = calculateSkuMetrics(sku);
  return volumeLiters > range.minLiter && volumeLiters < range.maxLiter;
}

function fulfillmentExtraOperationVolumeRange(name: string): { minLiter: number; maxLiter: number } | null {
  const normalized = normalizeWarehouseOperationName(name);
  if (normalized.includes("объем<2литров")) return { minLiter: Number.NEGATIVE_INFINITY, maxLiter: 2 };
  if (normalized.includes("объем>2-хлитров<5литров") || normalized.includes("объем>2литров<5литров")) return { minLiter: 2, maxLiter: Number.POSITIVE_INFINITY };
  return null;
}

function normalizeWarehouseOperationName(name: string): string {
  return name.toLowerCase().replaceAll("ё", "е").replace(/\s/g, "");
}

function warehouseOperationUnitCost(operation: NonNullable<WarehouseTariffs["operations"]>[number], sku: SkuInput): number {
  const unit = operation.unit.toLowerCase();
  if (unit.includes("паллет") || unit.includes("поддон")) return safeDivide(operation.priceRub, sku.itemsPerPallet);
  return operation.priceRub;
}

function warehouseGroupForBreakdownKey(key: string): WarehouseOperationGroup | null {
  if (key === "pimReceiving") return "receiving";
  if (key === "pimStorage" || key === "pimStorageSorting") return "storage";
  if (key.startsWith("pimFulfillmentExtra:")) return "fulfillment";
  if (key === "pimFulfillment" || key === "pimLabeling") return "fulfillment";
  if (key === "pimShipping") return "shipping";
  return null;
}

function storageCost(
  sku: SkuInput,
  storageDays: number,
  warehouse: WarehouseTariffs,
  settings: CalculatorSettings
): { amountRub: number; label: string; note: string; operationKey: string } {
  if (settings.warehouseSupplyType === "mono_pallet") {
    const operationKey = warehouse.selectedMapping?.storagePalletHeight180 ?? warehouse.selectedMapping?.storagePalletHeight150 ?? "Хранение EUR паллет (800х1200 вес до 1000 кг), высота до 1,8 м";
    const rate = warehouse.selected.storagePalletHeight180 ?? warehouse.selected.storagePalletHeight150 ?? 0;
    return {
      amountRub: safeDivide(rate * storageDays, sku.itemsPerPallet),
      label: "Хранение PIM.Seller (паллеты)",
      note: `${formatDecimal(rate)} ₽/паллетоместо/сутки × ${formatDecimal(storageDays)} дн. / ${formatDecimal(sku.itemsPerPallet)} SKU.`,
      operationKey
    };
  }

  const operation = warehouse.operations?.find((item) => item.name.toLowerCase() === "хранение товара");
  const rate = operation?.priceRub ?? 0;
  const { volumeLiters } = calculateSkuMetrics(sku);
  return {
    amountRub: volumeLiters * storageDays * rate,
    label: "Хранение PIM.Seller (литры)",
    note: `${formatDecimal(volumeLiters)} л × ${formatDecimal(storageDays)} дн. × ${formatDecimal(rate)} ₽/л/сутки.`,
    operationKey: operation?.name ?? "Хранение товара"
  };
}

function storageSortingCost(
  sku: SkuInput,
  warehouse: WarehouseTariffs,
  settings: CalculatorSettings
): { amountRub: number; label: string; note: string; operationKey: string } | null {
  if (settings.warehouseSupplyType === "mono_pallet") return null;
  const rows = (warehouse.operations ?? []).filter((operation) => operation.name.toLowerCase().includes("сортировка по артикулам"));
  const row = rows.find((operation) => manualWeightRangeMatches(operation.name, sku.weightKg));
  return {
    amountRub: row?.priceRub ?? 0,
    label: "Сортировка по артикулам PIM.Seller",
    note: row?.name
      ? `${row.name}: фактический вес ${formatDecimal(sku.weightKg)} кг. Выполняется перед литровым хранением для коробов и микспаллет.`
      : `Сортировка по артикулам: тариф по весу ${formatDecimal(sku.weightKg)} кг не найден.`,
    operationKey: row?.name ?? ""
  };
}

function receivingCost(
  sku: SkuInput,
  warehouse: WarehouseTariffs,
  settings: CalculatorSettings
): { amountRub: number; label: string; note: string; operationKey: string } {
  if (settings.warehouseSupplyType === "boxes") {
    const manual = manualReceivingCost(sku.weightKg, warehouse.operations ?? []);
    return {
      amountRub: manual.priceRub,
      label: "Приёмка на склад PIM.Seller (короба)",
      note: manual.name
        ? `Поставка коробами: ${receivingOperationDisplayName(manual.name)}, фактический вес ${formatDecimal(sku.weightKg)} кг.`
        : `Поставка коробами: ручной тариф по весу ${formatDecimal(sku.weightKg)} кг не найден.`,
      operationKey: manual.name
    };
  }

  const palletRate = warehouse.selected.receivingPallet ?? 0;
  const supplyLabel = settings.warehouseSupplyType === "mix_pallet" ? "микспаллета" : "монопаллета";
  const mixPalletNote =
    settings.warehouseSupplyType === "mix_pallet"
      ? " В Приёмке микспаллета считается по тому же принципу, что и монопаллета."
      : "";
  return {
    amountRub: safeDivide(palletRate, sku.itemsPerPallet),
    label: `Приёмка на склад PIM.Seller (${supplyLabel})`,
    note: `Механизированная выгрузка паллеты / количество SKU: ${formatDecimal(palletRate)} ₽ / ${formatDecimal(sku.itemsPerPallet)}.${mixPalletNote}`,
    operationKey: warehouse.selectedMapping?.receivingPallet ?? "Механизированная выгрузка/отгрузка паллеты"
  };
}

function receivingOperationDisplayName(name: string): string {
  return name.replaceAll("выгрузка/отгрузка", "выгрузка").replaceAll("Выгрузка/отгрузка", "Выгрузка");
}

function shippingCost(sku: SkuInput, warehouse: WarehouseTariffs): { amountRub: number; note: string; operationKey: string } {
  const manual = manualReceivingCost(sku.weightKg, warehouse.operations ?? []);
  return {
    amountRub: manual.priceRub,
    note: manual.name
      ? `${shippingOperationDisplayName(manual.name)}: фактический вес ${formatDecimal(sku.weightKg)} кг.`
      : `Ручная отгрузка: тариф по весу ${formatDecimal(sku.weightKg)} кг не найден.`,
    operationKey: manual.name ? shippingOperationKey(manual.name) : ""
  };
}

function shippingOperationKey(name: string): string {
  return `shipping:${name}`;
}

function shippingOperationDisplayName(name: string): string {
  return name.replaceAll("Ручная выгрузка/отгрузка", "Ручная отгрузка").replaceAll("ручная выгрузка/отгрузка", "ручная отгрузка");
}

function fulfillmentOperationDisplayName(name: string): string {
  return name
    .replaceAll("/Расформирование заказа", "")
    .replaceAll("пакет с клеевым клапаном", "пакет с клапаном")
    .replaceAll(", объем > 2-х литров < 5 литров", ", объем > 2 литров");
}

function manualReceivingCost(weightKg: number, operations: NonNullable<WarehouseTariffs["operations"]>): { name: string; priceRub: number } {
  const rows = operations.filter((operation) => operation.name.toLowerCase().includes("ручная выгрузка/отгрузка"));
  const row = rows.find((operation) => manualWeightRangeMatches(operation.name, weightKg));
  return {
    name: row?.name ?? "",
    priceRub: row?.priceRub ?? 0
  };
}

function manualWeightRangeMatches(name: string, weightKg: number): boolean {
  const normalized = name.replace(/\s/g, "").replace(",", ".");
  if (normalized.includes("до1кг")) return weightKg <= 1;
  if (normalized.includes("до5кг")) return weightKg <= 5;
  if (normalized.includes("5.01-10кг")) return weightKg > 5 && weightKg <= 10;
  if (normalized.includes("10.01-25кг")) return weightKg > 10 && weightKg <= 25;
  if (normalized.includes("25.01-50кг")) return weightKg > 25 && weightKg <= 50;
  if (normalized.includes("50.01-70кг")) return weightKg > 50 && weightKg <= 70;
  if (normalized.includes("70.01-110кг")) return weightKg > 70 && weightKg <= 110;
  return false;
}

function outboundCost(weightKg: number, warehouse: WarehouseTariffs): { amountRub: number; operationKey: string; operationName: string } {
  const key = weightKg <= 5 ? "outboundUpTo5Kg" : weightKg <= 10 ? "outbound5To10Kg" : weightKg <= 25 ? "outbound10To25Kg" : "outbound25To50Kg";
  const fallbackKey = key === "outbound5To10Kg" ? "outboundUpTo5Kg" : key === "outbound10To25Kg" ? "outbound5To10Kg" : key === "outbound25To50Kg" ? "outbound10To25Kg" : key;
  const operationName = warehouse.selectedMapping?.[key] ?? warehouse.selectedMapping?.[fallbackKey] ?? "Комплектация/Расформирование заказа, до 5 кг";
  return {
    amountRub: warehouse.selected[key] ?? warehouse.selected[fallbackKey] ?? 0,
    operationKey: operationName,
    operationName
  };
}

function wildberriesMarketplaceCosts(
  scheme: Scheme,
  sku: SkuInput,
  settings: CalculatorSettings,
  logistics: LogisticsAssumptions,
  warnings: string[]
): DraftBreakdownItem[] {
  const metrics = calculateSkuMetrics(sku);
  const wbLogistics = logistics.wildberriesLogistics;
  const warehouse = wbLogistics.warehouses.find((item) => item.name === settings.wbWarehouse);

  if (scheme === "fbo") {
    const supplyType = settings.wbSupplyType;
    const tariff = supplyType === "pallet" ? warehouse?.pallet : warehouse?.box;
    const delivery = wbFboDeliveryCost(metrics.volumeLiters, warehouse, supplyType, wbLogistics, tariff);
    const storage = wbFboStorageCost(metrics.volumeLiters, sku.itemsPerPallet, settings.storageDays, warehouse, supplyType, tariff);
    const acceptance = wbAcceptanceCost(sku, metrics.volumeLiters, warehouse, supplyType, warnings);
    const deliverySource = wbFboDeliveryTariffSource(warehouse, supplyType, tariff);

    if (delivery == null) {
      warnings.push(`Не найден тариф логистики WB для склада "${settings.wbWarehouse}" и типа поставки "${labelForWbSupplyType(supplyType)}"`);
    }
    if (storage == null) {
      warnings.push(`Не найден тариф хранения WB для склада "${settings.wbWarehouse}" и типа поставки "${labelForWbSupplyType(supplyType)}"`);
    }

    return [
      {
        key: "wbLastMile",
        label: "Логистика WB до покупателя",
        amountRub: (delivery ?? 0) * settings.localizationIndex + sku.price * settings.salesDistributionIndex,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: wbFboDeliveryNote(
          metrics.volumeLiters,
          sku.price,
          settings.localizationIndex,
          settings.salesDistributionIndex,
          delivery,
          deliverySource
        )
      },
      {
        key: "wbAcceptance",
        label: "Приёмка WB",
        amountRub: acceptance ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: wbAcceptanceNote(sku, metrics.volumeLiters, warehouse, supplyType, acceptance)
      },
      {
        key: "wbStorage",
        label: "Хранение WB",
        amountRub: storage ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: wbFboStorageNote(metrics.volumeLiters, sku.itemsPerPallet, settings.storageDays, warehouse, supplyType, tariff, storage)
      }
    ];
  }

  if (scheme === "fbs") {
    const isSgt = classifySkuDimensions(sku).wildberries === "sgt";
    const marketplaceWarehouse = findWbFbsMarketplaceWarehouse(warehouse, wbLogistics, isSgt);
    const delivery = wbMarketplaceDeliveryCost(metrics.volumeLiters, marketplaceWarehouse?.box, wbLogistics);
    const isSgtRowApplied = isSgt && marketplaceWarehouse?.name === wbFbsMarketplaceWarehouseName(warehouse, true);
    if (delivery == null) {
      warnings.push(`Не найден тариф логистики WB FBS для федерального округа склада "${settings.wbWarehouse}"`);
    }
    if (isSgt && !isSgtRowApplied) {
      warnings.push(`Предупреждение: WB СГТ — не найдена СГТ-строка тарифа для федерального округа склада "${settings.wbWarehouse}", применена обычная FBS-строка.`);
    }
    return [
      {
        key: "wbFbsLastMile",
        label: isSgtRowApplied ? "Логистика WB FBS СГТ" : "Логистика WB FBS",
        amountRub: delivery ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: wbFbsDeliveryNote(metrics.volumeLiters, marketplaceWarehouse, delivery)
      }
    ];
  }

  return [];
}

function findWbFbsMarketplaceWarehouse(
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  logistics: LogisticsAssumptions["wildberriesLogistics"],
  isSgt = false
): LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined {
  if (!warehouse?.geoName) return warehouse;
  const sgtWarehouseName = wbFbsMarketplaceWarehouseName(warehouse, true);
  const defaultWarehouseName = wbFbsMarketplaceWarehouseName(warehouse, false);
  return (
    (isSgt ? logistics.warehouses.find((item) => item.name === sgtWarehouseName) : undefined) ??
    logistics.warehouses.find((item) => item.name === defaultWarehouseName) ??
    warehouse
  );
}

function wbFbsMarketplaceWarehouseName(
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  isSgt: boolean
): string | null {
  if (!warehouse?.geoName) return null;
  return `Маркетплейс: ${warehouse.geoName}${isSgt ? " СГТ" : ""}`;
}

function wbDeliveryCost(
  volumeLiters: number,
  tariff: { deliveryBaseRub: number | null; deliveryAdditionalLiterRub: number | null; deliveryCoefPercent: number | null } | null | undefined,
  logistics: LogisticsAssumptions["wildberriesLogistics"],
  supplyType: "box" | "pallet"
): number | null {
  if (!tariff) return null;
  return wbVolumeTariff(
    volumeLiters,
    tariff.deliveryBaseRub,
    tariff.deliveryAdditionalLiterRub,
    supplyType === "box" ? tariff.deliveryCoefPercent : null,
    logistics
  );
}

function wbFboDeliveryCost(
  volumeLiters: number,
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  supplyType: "box" | "pallet",
  logistics: LogisticsAssumptions["wildberriesLogistics"],
  fallbackTariff: { deliveryBaseRub: number | null; deliveryAdditionalLiterRub: number | null; deliveryCoefPercent: number | null } | null | undefined
): number | null {
  const acceptance = warehouse?.acceptance?.[supplyType];
  const fromAcceptance = wbVolumeTariff(
    volumeLiters,
    acceptance?.deliveryBaseLiterRub ?? null,
    acceptance?.deliveryAdditionalLiterRub ?? null,
    acceptance?.deliveryCoefPercent ?? null,
    logistics
  );
  return fromAcceptance ?? wbDeliveryCost(volumeLiters, fallbackTariff, logistics, supplyType);
}

function wbFboDeliveryTariffSource(
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  supplyType: "box" | "pallet",
  fallbackTariff: { deliveryBaseRub: number | null; deliveryAdditionalLiterRub: number | null; deliveryCoefPercent: number | null } | null | undefined
): { name: string; firstLiterRub: number | null; additionalLiterRub: number | null; coefficientPercent: number | null } | null {
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (acceptance?.deliveryBaseLiterRub != null && acceptance.deliveryAdditionalLiterRub != null) {
    return {
      name: `${warehouse?.name ?? "склад WB"}, ${labelForWbSupplyType(supplyType).toLowerCase()}`,
      firstLiterRub: acceptance.deliveryBaseLiterRub,
      additionalLiterRub: acceptance.deliveryAdditionalLiterRub,
      coefficientPercent: acceptance.deliveryCoefPercent
    };
  }
  if (!fallbackTariff) return null;
  return {
    name: `${warehouse?.name ?? "склад WB"}, ${labelForWbSupplyType(supplyType).toLowerCase()}`,
    firstLiterRub: fallbackTariff.deliveryBaseRub,
    additionalLiterRub: fallbackTariff.deliveryAdditionalLiterRub,
    coefficientPercent: fallbackTariff.deliveryCoefPercent
  };
}

function wbMarketplaceDeliveryCost(
  volumeLiters: number,
  tariff: {
    marketplaceDeliveryBaseRub: number | null;
    marketplaceDeliveryAdditionalLiterRub: number | null;
    marketplaceDeliveryCoefPercent: number | null;
  } | null | undefined,
  logistics: LogisticsAssumptions["wildberriesLogistics"]
): number | null {
  if (!tariff) return null;
  return wbVolumeTariff(
    volumeLiters,
    tariff.marketplaceDeliveryBaseRub,
    tariff.marketplaceDeliveryAdditionalLiterRub,
    tariff.marketplaceDeliveryCoefPercent,
    logistics
  );
}

function wbVolumeTariff(
  volumeLiters: number,
  firstLiterRub: number | null,
  additionalLiterRub: number | null,
  coefficientPercent: number | null,
  logistics: LogisticsAssumptions["wildberriesLogistics"]
): number | null {
  if (volumeLiters <= 1) {
    const band = logistics.smallVolumeBands?.find((item) => volumeLiters >= item.minLiter && volumeLiters <= item.maxLiter);
    if (!band) return firstLiterRub;
    const coefficient = coefficientPercent == null ? safeDivide(firstLiterRub ?? logistics.firstLiterRub, logistics.firstLiterRub) : coefficientPercent / 100;
    return band.rub * coefficient;
  }
  if (firstLiterRub == null || additionalLiterRub == null) return null;
  return firstLiterRub + Math.max(0, volumeLiters - 1) * additionalLiterRub;
}

function wbStorageCost(
  volumeLiters: number,
  itemsPerPallet: number,
  storageDays: number,
  tariff:
    | { storageBaseRub: number | null; storageAdditionalLiterRub: number | null }
    | { storagePalletDayRub: number | null }
    | null
    | undefined,
  supplyType: "box" | "pallet"
): number | null {
  if (!tariff) return null;
  if (supplyType === "pallet") {
    const palletTariff = tariff as { storagePalletDayRub: number | null };
    return palletTariff.storagePalletDayRub == null ? null : safeDivide(palletTariff.storagePalletDayRub * storageDays, itemsPerPallet);
  }
  const boxTariff = tariff as { storageBaseRub: number | null; storageAdditionalLiterRub: number | null };
  if (boxTariff.storageBaseRub == null || boxTariff.storageAdditionalLiterRub == null) return null;
  return (boxTariff.storageBaseRub + Math.max(0, volumeLiters - 1) * boxTariff.storageAdditionalLiterRub) * storageDays;
}

function wbFboStorageCost(
  volumeLiters: number,
  itemsPerPallet: number,
  storageDays: number,
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  supplyType: "box" | "pallet",
  fallbackTariff:
    | { storageBaseRub: number | null; storageAdditionalLiterRub: number | null }
    | { storagePalletDayRub: number | null }
    | null
    | undefined
): number | null {
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (supplyType === "pallet" && acceptance?.storageBaseLiterRub != null) {
    return safeDivide(acceptance.storageBaseLiterRub * storageDays, itemsPerPallet);
  }
  if (supplyType === "box" && acceptance?.storageBaseLiterRub != null && acceptance.storageAdditionalLiterRub != null) {
    return (acceptance.storageBaseLiterRub + Math.max(0, volumeLiters - 1) * acceptance.storageAdditionalLiterRub) * storageDays;
  }
  return wbStorageCost(volumeLiters, itemsPerPallet, storageDays, fallbackTariff, supplyType);
}

function wbAcceptanceCost(
  sku: SkuInput,
  volumeLiters: number,
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  supplyType: "box" | "pallet",
  warnings: string[]
): number | null {
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (!acceptance) {
    warnings.push(`Не найден тариф приёмки WB для склада "${warehouse?.name ?? "не выбран"}" и типа поставки "${labelForWbSupplyType(supplyType)}"`);
    return null;
  }
  if (!acceptance.allowUnload) {
    warnings.push(`Поставка WB на "${warehouse?.name}" типом "${labelForWbSupplyType(supplyType)}" недоступна на дату ${acceptance.date.slice(0, 10)}`);
    return null;
  }
  if (acceptance.coefficient <= 0) return 0;
  if (supplyType === "pallet") return safeDivide(500 * acceptance.coefficient, sku.itemsPerPallet);
  return 1.7 * volumeLiters * acceptance.coefficient;
}

function wbFboDeliveryNote(
  volumeLiters: number,
  priceRub: number,
  localizationIndex: number,
  salesDistributionIndex: number,
  deliveryRub: number | null,
  source: ReturnType<typeof wbFboDeliveryTariffSource>
): string {
  if (deliveryRub == null || !source) return "Тариф логистики WB не найден.";
  const localizedRub = money(deliveryRub * localizationIndex);
  const salesDistributionRub = money(priceRub * salesDistributionIndex);
  const totalRub = money(localizedRub + salesDistributionRub);
  return `${source.name}: ${wbVolumeTariffFormula(volumeLiters, source.firstLiterRub, source.additionalLiterRub, source.coefficientPercent, deliveryRub)} Индекс локализации: ${formatDecimal(deliveryRub)} ₽ × ${formatDecimal(localizationIndex)} = ${formatDecimal(localizedRub)} ₽. Индекс распределения продаж: ${formatDecimal(priceRub)} ₽ × ${formatRate(salesDistributionIndex)} = ${formatDecimal(salesDistributionRub)} ₽. Итого: ${formatDecimal(totalRub)} ₽ с НДС.`;
}

function wbFbsDeliveryNote(
  volumeLiters: number,
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  deliveryRub: number | null
): string {
  if (deliveryRub == null || !warehouse?.box) return `${warehouse?.name ?? "Строка WB FBS"}: тариф логистики WB FBS не найден.`;
  return `${warehouse.name}: ${wbVolumeTariffFormula(
    volumeLiters,
    warehouse.box.marketplaceDeliveryBaseRub,
    warehouse.box.marketplaceDeliveryAdditionalLiterRub,
    warehouse.box.marketplaceDeliveryCoefPercent,
    deliveryRub
  )}`;
}

function wbAcceptanceNote(
  sku: SkuInput,
  volumeLiters: number,
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  supplyType: "box" | "pallet",
  amountRub: number | null
): string {
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (!acceptance) return `Не найден тариф приёмки WB для склада "${warehouse?.name ?? "не выбран"}" и типа поставки "${labelForWbSupplyType(supplyType)}".`;
  if (!acceptance.allowUnload) return `На дату ${acceptance.date.slice(0, 10)} приёмка WB для склада "${warehouse?.name ?? "не выбран"}" и типа поставки "${labelForWbSupplyType(supplyType)}" недоступна.`;
  if (acceptance.coefficient <= 0) {
    return `Приёмка WB бесплатна на дату ${acceptance.date.slice(0, 10)} для склада "${warehouse?.name ?? "не выбран"}" и типа поставки "${labelForWbSupplyType(supplyType)}". Итого: ${formatDecimal(amountRub ?? 0)} ₽.`;
  }
  if (supplyType === "pallet") {
    return `Платная приёмка WB, монопаллета: 500 ₽ × коэффициент приёмки ${formatDecimal(acceptance.coefficient)} / ${formatDecimal(sku.itemsPerPallet)} SKU = ${formatDecimal(amountRub ?? 0)} ₽ с НДС.`;
  }
  return `Платная приёмка WB, короб: 1,70 ₽ × ${formatDecimal(volumeLiters)} л × коэффициент приёмки ${formatDecimal(acceptance.coefficient)} = ${formatDecimal(amountRub ?? 0)} ₽ с НДС.`;
}

function wbFboStorageNote(
  volumeLiters: number,
  itemsPerPallet: number,
  storageDays: number,
  warehouse: LogisticsAssumptions["wildberriesLogistics"]["warehouses"][number] | undefined,
  supplyType: "box" | "pallet",
  fallbackTariff:
    | { storageBaseRub: number | null; storageAdditionalLiterRub: number | null; storageCoefPercent?: number | null }
    | { storagePalletDayRub: number | null; storageCoefPercent?: number | null }
    | null
    | undefined,
  amountRub: number | null
): string {
  if (amountRub == null) return `Тариф хранения WB для склада "${warehouse?.name ?? "не выбран"}" не найден.`;
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (supplyType === "pallet") {
    const appliedRate = acceptance?.storageBaseLiterRub ?? ((fallbackTariff as { storagePalletDayRub?: number | null } | null | undefined)?.storagePalletDayRub ?? null);
    const coefficientPercent = acceptance?.storageCoefPercent ?? (fallbackTariff as { storageCoefPercent?: number | null } | null | undefined)?.storageCoefPercent ?? null;
    const baseRate = rateBeforeCoefficient(appliedRate, coefficientPercent);
    return `Монопаллета, склад ${warehouse?.name ?? "WB"}: ставка ${formatNullableDecimal(appliedRate)} ₽/паллету/дн.${coefficientText(coefficientPercent, baseRate)} ${formatNullableDecimal(appliedRate)} ₽ × ${formatDecimal(storageDays)} дн. / ${formatDecimal(itemsPerPallet)} SKU = ${formatDecimal(amountRub)} ₽ с НДС.`;
  }
  const baseApplied =
    acceptance?.storageBaseLiterRub ??
    ((fallbackTariff as { storageBaseRub?: number | null } | null | undefined)?.storageBaseRub ?? null);
  const additionalApplied =
    acceptance?.storageAdditionalLiterRub ??
    ((fallbackTariff as { storageAdditionalLiterRub?: number | null } | null | undefined)?.storageAdditionalLiterRub ?? null);
  const coefficientPercent = acceptance?.storageCoefPercent ?? (fallbackTariff as { storageCoefPercent?: number | null } | null | undefined)?.storageCoefPercent ?? null;
  const baseBefore = rateBeforeCoefficient(baseApplied, coefficientPercent);
  const additionalBefore = rateBeforeCoefficient(additionalApplied, coefficientPercent);
  const additionalLiters = Math.max(0, volumeLiters - 1);
  return `Короб, склад ${warehouse?.name ?? "WB"}: базовая ставка ${formatNullableDecimal(baseBefore)} ₽/л/дн. за 1-й л и ${formatNullableDecimal(additionalBefore)} ₽/л/дн. за доп. литр × коэффициент склада ${formatRate((coefficientPercent ?? 100) / 100)} = ${formatNullableDecimal(baseApplied)} ₽ и ${formatNullableDecimal(additionalApplied)} ₽ после коэффициента. Объём ${formatFormulaDecimal(volumeLiters)} л: (${formatNullableDecimal(baseApplied)} ₽ + ${formatFormulaDecimal(additionalLiters)} доп. л × ${formatNullableDecimal(additionalApplied)} ₽) × ${formatDecimal(storageDays)} дн. = ${formatDecimal(amountRub)} ₽ с НДС.`;
}

function wbVolumeTariffFormula(
  volumeLiters: number,
  firstLiterRub: number | null,
  additionalLiterRub: number | null,
  coefficientPercent: number | null,
  resultRub: number
): string {
  const additionalLiters = Math.max(0, volumeLiters - 1);
  const firstBefore = rateBeforeCoefficient(firstLiterRub, coefficientPercent);
  const additionalBefore = rateBeforeCoefficient(additionalLiterRub, coefficientPercent);
  if (volumeLiters <= 1) {
    return `объём ${formatDecimal(volumeLiters)} л, тариф ${formatDecimal(resultRub)} ₽ с НДС.`;
  }
  return `(${formatNullableDecimal(firstBefore)} ₽ за 1-й л + ${formatFormulaDecimal(additionalLiters)} доп. л × ${formatNullableDecimal(additionalBefore)} ₽/л) × коэффициент склада ${formatRate((coefficientPercent ?? 100) / 100)} = ${formatDecimal(resultRub)} ₽ с НДС. Ставки после коэффициента: ${formatNullableDecimal(firstLiterRub)} ₽ за 1-й л и ${formatNullableDecimal(additionalLiterRub)} ₽/доп. л.`;
}

function rateBeforeCoefficient(rateRub: number | null | undefined, coefficientPercent: number | null | undefined): number | null {
  if (rateRub == null) return null;
  if (coefficientPercent == null || coefficientPercent === 0) return rateRub;
  return rateRub / (coefficientPercent / 100);
}

function coefficientText(coefficientPercent: number | null | undefined, baseRateRub: number | null): string {
  if (coefficientPercent == null || baseRateRub == null) return "";
  return ` (база ${formatDecimal(baseRateRub)} ₽ × коэффициент склада ${formatRate(coefficientPercent / 100)})`;
}

function formatNullableDecimal(value: number | null | undefined): string {
  return value == null ? "0" : formatDecimal(value);
}

function formatFormulaDecimal(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value);
}

function ozonMarketplaceCosts(
  scheme: Scheme,
  sku: SkuInput,
  settings: CalculatorSettings,
  logistics: LogisticsAssumptions,
  warnings: string[]
): DraftBreakdownItem[] {
  const metrics = calculateSkuMetrics(sku);
  const originCluster = settings.ozonOriginCluster || logistics.ozonLogistics.cityToCluster[settings.firstMileCity] || settings.firstMileCity;
  const deliveryCluster = settings.ozonDeliveryCluster || originCluster;
  const tariffRow = findOzonLogisticsTariff(metrics.volumeLiters, sku.price, originCluster, deliveryCluster, logistics);
  const nonlocalMarkupPercent =
    scheme !== "fbo" || originCluster === deliveryCluster
      ? 0
      : logistics.ozonLogistics.nonlocalMarkups.find((item) => item.deliveryCluster === deliveryCluster)?.percent;

  if (scheme !== "dbs" && !tariffRow) {
    warnings.push(`Не найден тариф логистики Ozon для направления "${originCluster}" -> "${deliveryCluster}"`);
  }
  if (scheme === "fbo" && nonlocalMarkupPercent == null) {
    warnings.push(`Не найдена наценка Ozon за нелокальную продажу для кластера "${deliveryCluster}"`);
  }

  const baseDelivery = tariffRow?.rub ?? 0;
  const nonlocalMarkup = sku.price * (nonlocalMarkupPercent ?? 0);

  if (scheme === "fbo") {
    const storage = ozonFboStorageCost(sku, metrics.volumeLiters, settings.storageDays, logistics);
    if (storage == null) {
      warnings.push(`Не найден срок бесплатного хранения Ozon для типа товара "${sku.ozonProductType}"`);
    }
    return [
      {
        key: "ozonFboLogisticsTariff",
        label: "Логистика Ozon FBO",
        amountRub: baseDelivery,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: ozonLogisticsNote(tariffRow, metrics.volumeLiters, sku.price, originCluster, deliveryCluster)
      },
      {
        key: "ozonFboNonlocalMarkup",
        label: `Наценка Ozon за нелокальную продажу ${formatRate(nonlocalMarkupPercent ?? 0)}`,
        amountRub: nonlocalMarkup,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          originCluster === deliveryCluster
            ? `Локальная продажа: ${originCluster} = ${deliveryCluster}, наценка 0 ₽.`
            : `${formatDecimal(sku.price)} ₽ × ${formatRate(nonlocalMarkupPercent ?? 0)} = ${formatDecimal(nonlocalMarkup)} ₽ с НДС.`
      },
      {
        key: "ozonFboStorage",
        label: storage == null ? "Хранение Ozon FBO" : `Хранение Ozon FBO (${storage.freeDays} дн. бесплатно)`,
        amountRub: storage?.amountRub ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          storage == null
            ? "Тариф хранения Ozon не найден."
            : `Срок хранения ${formatDecimal(settings.storageDays)} дн. - бесплатный период ${formatDecimal(storage.freeDays)} дн. = ${formatDecimal(storage.paidDays)} платн. дн.; ${formatDecimal(storage.paidDays)} × ${formatDecimal(metrics.volumeLiters)} л × ${formatDecimal(storage.rubPerLiterDay)} ₽/л/дн. = ${formatDecimal(storage.amountRub)} ₽ с НДС.`
      },
      {
        key: "ozonPickupPoint",
        label: "Доставка до ПВЗ Ozon",
        amountRub: logistics.ozonLogistics.pickupPointRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon до ПВЗ: ${formatDecimal(logistics.ozonLogistics.pickupPointRub)} ₽ с НДС.`
      }
    ];
  }

  if (scheme === "fbs") {
    return [
      {
        key: "ozonFbsAcceptance",
        label: "Приёмка отправления Ozon",
        amountRub: logistics.ozonLogistics.fbsAcceptanceRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная приёмка отправления Ozon FBS: ${formatDecimal(logistics.ozonLogistics.fbsAcceptanceRub)} ₽ с НДС.`
      },
      {
        key: "ozonFbsLogistics",
        label: "Логистика Ozon FBS",
        amountRub: baseDelivery,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: ozonLogisticsNote(tariffRow, metrics.volumeLiters, sku.price, originCluster, deliveryCluster)
      },
      {
        key: "ozonPickupPoint",
        label: "Доставка до ПВЗ Ozon",
        amountRub: logistics.ozonLogistics.pickupPointRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon до ПВЗ: ${formatDecimal(logistics.ozonLogistics.pickupPointRub)} ₽ с НДС.`
      }
    ];
  }

  return [];
}

function findOzonLogisticsTariff(
  volumeLiters: number,
  price: number,
  originCluster: string,
  deliveryCluster: string,
  logistics: LogisticsAssumptions
): { rub: number; volumeLabel: string; priceBandLabel: string; sourceLabel: string } | null {
  const matchesVolume = (item: { minLiter: number; maxLiter: number | null }) =>
    volumeLiters >= item.minLiter && (item.maxLiter === null || volumeLiters <= item.maxLiter);
  const tariff =
    logistics.ozonLogistics.tariffs.find(
      (item) => item.originCluster === originCluster && item.deliveryCluster === deliveryCluster && matchesVolume(item)
    ) ?? null;
  const defaultTariff = tariff ? null : logistics.ozonLogistics.defaultTariffs.find(matchesVolume) ?? null;
  const row = tariff ?? defaultTariff;
  if (!row) return null;
  return {
    rub: price <= 300 ? row.priceTo300Rub : row.priceOver300Rub,
    volumeLabel: row.volumeLabel,
    priceBandLabel: price <= 300 ? "цена товара до 300 ₽" : "цена товара свыше 300 ₽",
    sourceLabel: tariff ? `${originCluster} → ${deliveryCluster}` : "резервная тарифная строка Ozon"
  };
}

function ozonLogisticsNote(
  tariffRow: ReturnType<typeof findOzonLogisticsTariff>,
  volumeLiters: number,
  priceRub: number,
  originCluster: string,
  deliveryCluster: string
): string {
  if (!tariffRow) return `Тариф Ozon для направления ${originCluster} → ${deliveryCluster}, объёма ${formatDecimal(volumeLiters)} л и цены ${formatDecimal(priceRub)} ₽ не найден.`;
  return `${tariffRow.sourceLabel}: объём ${formatDecimal(volumeLiters)} л попадает в диапазон "${tariffRow.volumeLabel}", ${tariffRow.priceBandLabel}; тариф = ${formatDecimal(tariffRow.rub)} ₽ с НДС.`;
}

function ozonFboStorageCost(
  sku: SkuInput,
  volumeLiters: number,
  storageDays: number,
  logistics: LogisticsAssumptions
): { amountRub: number; freeDays: number; paidDays: number; rubPerLiterDay: number } | null {
  const dimensionClass = classifySkuDimensions(sku).ozon;
  const freeDaysRow = findOzonStorageFreeDays(sku, logistics.ozonLogistics.storageFreeDays ?? []);
  const freeDays = dimensionClass === "kgt" ? freeDaysRow?.kgtDays : freeDaysRow?.standardDays;
  const rubPerLiterDay =
    dimensionClass === "kgt" ? logistics.ozonLogistics.storageRates?.kgtRubPerLiterDay : logistics.ozonLogistics.storageRates?.standardRubPerLiterDay;
  if (freeDays == null || rubPerLiterDay == null) return null;
  const paidDays = Math.max(0, storageDays - freeDays);
  return {
    amountRub: paidDays * volumeLiters * rubPerLiterDay,
    freeDays,
    paidDays,
    rubPerLiterDay
  };
}

function findOzonStorageFreeDays(
  sku: Pick<SkuInput, "ozonProductType" | "ozonCategory">,
  entries: NonNullable<LogisticsAssumptions["ozonLogistics"]["storageFreeDays"]>
): NonNullable<LogisticsAssumptions["ozonLogistics"]["storageFreeDays"]>[number] | null {
  const byProductType = entries.filter((item) => sameLookupText(item.productType, sku.ozonProductType));
  if (byProductType.length) {
    return (
      byProductType.find((item) => sameLookupText(item.category, sku.ozonCategory)) ??
      byProductType.find((item) => !item.category.startsWith("Благотворительность")) ??
      byProductType[0]
    );
  }
  return entries.find((item) => sameLookupText(item.category, sku.ozonCategory)) ?? null;
}

function middleMileCostParts(sku: SkuInput, middleMile: MiddleMileTariffs): MiddleMileCostParts {
  const { volumeLiters } = calculateSkuMetrics(sku);
  const prices = middleMile.tiers.map((tier) => tier.priceRub);
  const base = prices[0] ?? 17.39;
  const extraTo190 = prices[1] ?? 2.83;
  const extraTo350 = prices[3] ?? 3.26;
  const fixed351To1000 = prices[4] ?? 2826.09;
  const fixedFrom1001 = prices[5] ?? 5434.78;
  let firstLiterRub = base;
  let additionalTo190Rub = 0;
  let additional191To350Rub = 0;
  let fixed351To1000Rub = 0;
  let fixedFrom1001Rub = 0;
  let additionalTo190Liters = 0;
  let additional191To350Liters = 0;
  let totalRub = base;

  if (volumeLiters > 1 && volumeLiters <= 190) {
    additionalTo190Liters = volumeLiters - 1;
    additionalTo190Rub = additionalTo190Liters * extraTo190;
    totalRub = firstLiterRub + additionalTo190Rub;
  }

  if (volumeLiters > 190 && volumeLiters <= 350) {
    additionalTo190Liters = 189;
    additional191To350Liters = volumeLiters - 190;
    additionalTo190Rub = 189 * extraTo190;
    additional191To350Rub = additional191To350Liters * extraTo350;
    totalRub = firstLiterRub + additionalTo190Rub + additional191To350Rub;
  }

  if (volumeLiters > 350 && volumeLiters <= 1000) {
    firstLiterRub = 0;
    fixed351To1000Rub = fixed351To1000;
    totalRub = fixed351To1000Rub;
  }

  if (volumeLiters > 1000) {
    firstLiterRub = 0;
    fixedFrom1001Rub = fixedFrom1001;
    totalRub = fixedFrom1001Rub;
  }

  return {
    baseRub: money(firstLiterRub),
    additionalRub: money(additionalTo190Rub + additional191To350Rub + fixed351To1000Rub + fixedFrom1001Rub),
    volumeLiters,
    additionalTo190Liters,
    additional191To350Liters,
    firstLiterRub: money(firstLiterRub),
    additionalTo190Rub: money(additionalTo190Rub),
    additional191To350Rub: money(additional191To350Rub),
    fixed351To1000Rub: money(fixed351To1000Rub),
    fixedFrom1001Rub: money(fixedFrom1001Rub),
    totalRub
  };
}

function middleMileNote(sku: SkuInput, parts: MiddleMileCostParts): string {
  return middleMileCalculationText({ ...parts, volumeLiters: calculateSkuMetrics(sku).volumeLiters });
}

function middleMileCalculationText(parts: MiddleMileCostParts): string {
  if (parts.fixedFrom1001Rub > 0) {
    return `Объём ${formatDecimal(parts.volumeLiters)} л: фиксированный тариф 1001+ л = ${formatDecimal(parts.fixedFrom1001Rub)} ₽. Итого: ${formatDecimal(parts.fixedFrom1001Rub)} ₽ без НДС.`;
  }
  if (parts.fixed351To1000Rub > 0) {
    return `Объём ${formatDecimal(parts.volumeLiters)} л: фиксированный тариф 351-1000 л = ${formatDecimal(parts.fixed351To1000Rub)} ₽. Итого: ${formatDecimal(parts.fixed351To1000Rub)} ₽ без НДС.`;
  }

  const pieces: string[] = [`1-й литр = ${formatDecimal(parts.firstLiterRub)} ₽`];
  if (parts.additionalTo190Rub > 0) {
    const rate = parts.additionalTo190Liters > 0 ? parts.additionalTo190Rub / parts.additionalTo190Liters : 0;
    pieces.push(`2-190 л: ${formatDecimal(parts.additionalTo190Liters)} л × ${formatDecimal(rate)} ₽/л = ${formatDecimal(parts.additionalTo190Rub)} ₽`);
  }
  if (parts.additional191To350Rub > 0) {
    const rate = parts.additional191To350Liters > 0 ? parts.additional191To350Rub / parts.additional191To350Liters : 0;
    pieces.push(`191-350 л: ${formatDecimal(parts.additional191To350Liters)} л × ${formatDecimal(rate)} ₽/л = ${formatDecimal(parts.additional191To350Rub)} ₽`);
  }
  const totalRub = parts.firstLiterRub + parts.additionalTo190Rub + parts.additional191To350Rub;
  return `Объём ${formatDecimal(parts.volumeLiters)} л: ${pieces.join("; ")}. Итого: ${formatDecimal(totalRub)} ₽ без НДС.`;
}

function pimLastMileCostParts(sku: SkuInput, settings: CalculatorSettings, logistics: LogisticsAssumptions): LastMileCostParts | null {
  const metrics = calculateSkuMetrics(sku);
  const tariff = logistics.pimLastMile;
  const row = tariff.sellerTariffRows?.find((item) => item.city === settings.firstMileCity);
  if (!row) return null;
  const baseRub = settings.lastMileZone === "region" ? row.regionBaseRub : row.cityBaseRub;
  const extraRubPerKg = settings.lastMileZone === "region" ? row.regionExtraRubPerKg : row.cityExtraRubPerKg;
  const zoneLabel = settings.lastMileZone === "region" ? "область/регион" : "город";
  const extraKg = Math.max(0, metrics.chargeableKg - tariff.includedChargeableKg);
  const baseCostRub = baseRub * tariff.costMultiplier;
  const extraCostRubPerKg = extraRubPerKg * tariff.costMultiplier;
  const additionalCostRub = extraKg * extraCostRubPerKg;
  return {
    baseRub: baseCostRub,
    additionalRub: additionalCostRub,
    totalRub: baseCostRub + additionalCostRub,
    city: settings.firstMileCity,
    zoneLabel,
    includedKg: tariff.includedChargeableKg,
    chargeableKg: metrics.chargeableKg,
    extraKg,
    baseRateRub: baseCostRub,
    extraRateRubPerKg: extraCostRubPerKg
  };
}

function lastMileNote(_sku: SkuInput, settings: CalculatorSettings, logistics: LogisticsAssumptions, parts: LastMileCostParts | null): string {
  const tariff = logistics.pimLastMile;
  const row = tariff.sellerTariffRows?.find((item) => item.city === settings.firstMileCity);
  const zoneLabel = settings.lastMileZone === "region" ? "область/регион" : "город";
  if (!row || !parts) return `Город ${settings.firstMileCity}, зона ${zoneLabel}: тариф не найден.`;
  return lastMileCalculationText(parts, parts.baseRateRub, parts.extraRateRubPerKg);
}

function lastMileCalculationText(
  details: Pick<LastMileCostParts, "city" | "zoneLabel" | "includedKg" | "chargeableKg" | "extraKg">,
  baseRateRub: number,
  extraRateRubPerKg: number
): string {
  const additionalRub = details.extraKg * extraRateRubPerKg;
  const totalRub = baseRateRub + additionalRub;
  return `Город ${details.city}, зона ${details.zoneLabel}: до ${formatDecimal(details.includedKg)} кг = ${formatDecimal(baseRateRub)} ₽; расчётный вес ${formatDecimal(details.chargeableKg)} кг, сверх лимита ${formatDecimal(details.extraKg)} кг × ${formatDecimal(extraRateRubPerKg)} ₽/кг = ${formatDecimal(additionalRub)} ₽. Итого: ${formatDecimal(totalRub)} ₽ без НДС.`;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function labelForScheme(scheme: Scheme): string {
  return scheme.toUpperCase();
}

export function labelForWbSupplyType(supplyType: "box" | "pallet"): string {
  return supplyType === "box" ? "Короб" : "Монопаллета";
}

export function labelForMarketplace(marketplace: Marketplace): string {
  return marketplace === "wildberries" ? "WB" : "Ozon";
}

export { SCHEMES };
