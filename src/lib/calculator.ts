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
  WarehouseTariffs
} from "./types.ts";

const SCHEMES: Scheme[] = ["fbo", "fbs", "dbs"];
const VAT_RATE = 0.22;
const WB_FAST_HANDOVER_DISCOUNT = 0.015;

type DraftBreakdownItem = Omit<CostBreakdownItem, "amountWithoutVatRub" | "amountWithVatRub" | "vatNote">;
type CommissionDiscount = { value: number };
type CommissionCost = {
  amountRub: number;
  rate: number;
  originalRate: number;
  discount: CommissionDiscount | null;
};
type CostParts = { baseRub: number; additionalRub: number; totalRub: number };
type MiddleMileCostParts = CostParts & {
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
  return {
    wildberries: {
      fbo: calculateMarketplaceScheme("wildberries", "fbo", sku, settings, tariffs),
      fbs: calculateMarketplaceScheme("wildberries", "fbs", sku, settings, tariffs),
      dbs: calculateMarketplaceScheme("wildberries", "dbs", sku, settings, tariffs)
    },
    ozon: {
      fbo: calculateMarketplaceScheme("ozon", "fbo", sku, settings, tariffs),
      fbs: calculateMarketplaceScheme("ozon", "fbs", sku, settings, tariffs),
      dbs: calculateMarketplaceScheme("ozon", "dbs", sku, settings, tariffs)
    }
  };
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
  if (firstMile == null) {
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
      source: "pim",
      vatMode: "without_vat",
      calculationNote: lastMileNote(sku, settings, tariffs.logistics, lastMile)
    });
  }

  const commercialBreakdown = breakdown.map((item) => applyPimCommercialMarkup(item, settings));
  const roundedBreakdown = normalizeBreakdownForVat(commercialBreakdown, settings.vatDisplayMode);
  const totalRub = money(roundedBreakdown.reduce((sum, item) => sum + item.amountRub, 0));
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
      settings.presentationMode === "internal" || markup.profitRub === 0
        ? item.calculationNote
        : `${item.calculationNote ?? "Тариф PIM.Seller."} Коммерческие условия учтены в итоговой ставке.`
  };
}

function pimProfitCenter(key: string): PimProfitCenter | null {
  if (key === "firstMile") return "firstMile";
  if (key === "middleMile") return "middleMile";
  if (key === "lastMile") return "lastMile";
  if (key.startsWith("pimFulfillmentExtra:")) return "warehouse";
  if (key === "pimReceiving" || key === "pimStorageSorting" || key === "pimStorage" || key === "pimFulfillment" || key === "pimLabeling") return "warehouse";
  return null;
}

function pimMarkup(
  item: DraftBreakdownItem,
  profitCenter: PimProfitCenter,
  settings: CalculatorSettings
): { profitRub: number; note: string } {
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
      note: noteParts.join(", ")
    };
  }

  if (profitCenter === "lastMile") {
    const base = item.pimBaseCostWithoutVatRub ?? item.amountRub;
    const additional = item.pimAdditionalCostWithoutVatRub ?? 0;
    const baseProfit = base * (settings.lastMileBaseMarkupPercent / 100);
    const additionalProfit = additional * (settings.lastMileAdditionalKgMarkupPercent / 100);
    return {
      profitRub: baseProfit + additionalProfit,
      note: `до 3 кг ${formatDecimal(settings.lastMileBaseMarkupPercent)}%, сверх 3 кг ${formatDecimal(settings.lastMileAdditionalKgMarkupPercent)}%`
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
  if (group === "receiving" && item.pimWarehouseOperationKey) {
    return settings.warehouseReceivingMarkupPercents[item.pimWarehouseOperationKey] ?? settings.warehouseOperationMarkupPercents.receiving ?? 20;
  }
  if (group === "storage" && item.pimWarehouseOperationKey) {
    return settings.warehouseStorageMarkupPercents[item.pimWarehouseOperationKey] ?? defaultWarehouseStorageMarkupPercent(item.pimWarehouseOperationKey);
  }
  return settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
}

function defaultWarehouseStorageMarkupPercent(operationKey: string): number {
  return operationKey.toLowerCase() === "хранение товара" ? 30 : 20;
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
  const bySubject = entries.find((entry) => entry.subject === sku.wbSubject);
  if (bySubject) return bySubject.commission;
  const byCategory = entries.find((entry) => entry.category === sku.wbCategory);
  if (byCategory) return byCategory.commission;
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
  const byProductType = entries.filter((item) => item.productType === sku.ozonProductType);
  if (byProductType.length) {
    return (
      byProductType.find((item) => item.category === sku.ozonCategory) ??
      byProductType.find((item) => !item.category.startsWith("Благотворительность")) ??
      byProductType[0]
    );
  }
  return entries.find((item) => item.category === sku.ozonCategory) ?? null;
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
  const outbound = outboundCost(sku.weightKg, selected);
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
      amountRub: outbound,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "fulfillment",
      calculationNote: `Комплектация по фактическому весу ${formatDecimal(sku.weightKg)} кг.`
    },
    {
      key: "pimLabeling",
      label: "Маркировка PIM.Seller",
      amountRub: selected.labeling ?? 0,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "fulfillment",
      calculationNote: `Фиксированный тариф маркировки: ${formatDecimal(selected.labeling ?? 0)} ₽/SKU.`
    },
    ...fulfillmentExtras
  ];
  return operations.filter((item) => {
    const group = item.pimWarehouseGroup;
    return group ? settings.warehouseOperationGroups[group] !== false : true;
  });
}

function fulfillmentExtraCosts(sku: SkuInput, warehouse: WarehouseTariffs, settings: CalculatorSettings): DraftBreakdownItem[] {
  return fulfillmentExtraOperations(warehouse.operations ?? [])
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

function fulfillmentOperationDisplayName(name: string): string {
  return name.replaceAll("/Расформирование заказа", "").replaceAll("пакет с клеевым клапаном", "пакет с клапаном");
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

function outboundCost(weightKg: number, selected: Record<string, number>): number {
  if (weightKg <= 5) return selected.outboundUpTo5Kg ?? 0;
  if (weightKg <= 10) return selected.outbound5To10Kg ?? selected.outboundUpTo5Kg ?? 0;
  if (weightKg <= 25) return selected.outbound10To25Kg ?? selected.outbound5To10Kg ?? 0;
  return selected.outbound25To50Kg ?? selected.outbound10To25Kg ?? 0;
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
        calculationNote: `Тариф WB по объёму ${formatDecimal(metrics.volumeLiters)} л × индекс ${formatDecimal(settings.localizationIndex)} + цена × ${formatRate(settings.salesDistributionIndex)}.`
      },
      {
        key: "wbAcceptance",
        label: "Приёмка WB",
        amountRub: acceptance ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          supplyType === "pallet"
            ? `Монопаллета: 500 ₽ × коэффициент / ${formatDecimal(sku.itemsPerPallet)} SKU.`
            : `Короб: 1,70 ₽ × ${formatDecimal(metrics.volumeLiters)} л × коэффициент приёмки.`
      },
      {
        key: "wbStorage",
        label: "Хранение WB",
        amountRub: storage ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          supplyType === "pallet"
            ? `Паллетное хранение × ${formatDecimal(settings.storageDays)} дн. / ${formatDecimal(sku.itemsPerPallet)} SKU.`
            : `Тариф хранения WB по ${formatDecimal(metrics.volumeLiters)} л × ${formatDecimal(settings.storageDays)} дн.`
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
        calculationNote: `${marketplaceWarehouse?.name ?? "Строка WB FBS"}: тариф по объёму ${formatDecimal(metrics.volumeLiters)} л.`
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
  if (!acceptance.allowUnload || (acceptance.coefficient !== 0 && acceptance.coefficient !== 1)) {
    warnings.push(`Поставка WB на "${warehouse?.name}" типом "${labelForWbSupplyType(supplyType)}" недоступна на дату ${acceptance.date.slice(0, 10)}`);
    return null;
  }
  if (supplyType === "pallet") return safeDivide(500 * acceptance.coefficient, sku.itemsPerPallet);
  return 1.7 * volumeLiters * acceptance.coefficient;
}

function ozonMarketplaceCosts(
  scheme: Scheme,
  sku: SkuInput,
  settings: CalculatorSettings,
  logistics: LogisticsAssumptions,
  warnings: string[]
): DraftBreakdownItem[] {
  const metrics = calculateSkuMetrics(sku);
  const originCluster = logistics.ozonLogistics.cityToCluster[settings.firstMileCity] ?? settings.firstMileCity;
  const deliveryCluster = settings.ozonDeliveryMode === "local" ? originCluster : settings.ozonDeliveryCluster;
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
        calculationNote: `${originCluster} → ${deliveryCluster}: тариф Ozon по объёму ${formatDecimal(metrics.volumeLiters)} л и цене товара.`
      },
      {
        key: "ozonFboNonlocalMarkup",
        label: `Наценка Ozon за нелокальную продажу ${formatRate(nonlocalMarkupPercent ?? 0)}`,
        amountRub: nonlocalMarkup,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: originCluster === deliveryCluster ? "Локальная продажа: наценка не применяется." : `Цена товара × ${formatRate(nonlocalMarkupPercent ?? 0)}.`
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
            : `${formatDecimal(storage.paidDays)} платн. дн. × ${formatDecimal(metrics.volumeLiters)} л × ${formatDecimal(storage.rubPerLiterDay)} ₽.`
      },
      {
        key: "ozonPickupPoint",
        label: "Доставка до ПВЗ Ozon",
        amountRub: logistics.ozonLogistics.pickupPointRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon: ${formatDecimal(logistics.ozonLogistics.pickupPointRub)} ₽.`
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
        calculationNote: `Фиксированная ставка Ozon FBS: ${formatDecimal(logistics.ozonLogistics.fbsAcceptanceRub)} ₽.`
      },
      {
        key: "ozonFbsLogistics",
        label: "Логистика Ozon FBS",
        amountRub: baseDelivery,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `${originCluster} → ${deliveryCluster}: тариф Ozon по объёму ${formatDecimal(metrics.volumeLiters)} л и цене товара.`
      },
      {
        key: "ozonPickupPoint",
        label: "Доставка до ПВЗ Ozon",
        amountRub: logistics.ozonLogistics.pickupPointRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon: ${formatDecimal(logistics.ozonLogistics.pickupPointRub)} ₽.`
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
): { rub: number } | null {
  const matchesVolume = (item: { minLiter: number; maxLiter: number | null }) =>
    volumeLiters >= item.minLiter && (item.maxLiter === null || volumeLiters <= item.maxLiter);
  const tariff =
    logistics.ozonLogistics.tariffs.find(
      (item) => item.originCluster === originCluster && item.deliveryCluster === deliveryCluster && matchesVolume(item)
    ) ?? null;
  const defaultTariff = tariff ? null : logistics.ozonLogistics.defaultTariffs.find(matchesVolume) ?? null;
  const row = tariff ?? defaultTariff;
  if (!row) return null;
  return { rub: price <= 300 ? row.priceTo300Rub : row.priceOver300Rub };
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
  const byProductType = entries.filter((item) => item.productType === sku.ozonProductType);
  if (byProductType.length) {
    return (
      byProductType.find((item) => item.category === sku.ozonCategory) ??
      byProductType.find((item) => !item.category.startsWith("Благотворительность")) ??
      byProductType[0]
    );
  }
  return entries.find((item) => item.category === sku.ozonCategory) ?? null;
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
  let totalRub = base;

  if (volumeLiters > 1 && volumeLiters <= 190) {
    additionalTo190Rub = (volumeLiters - 1) * extraTo190;
    totalRub = firstLiterRub + additionalTo190Rub;
  }

  if (volumeLiters > 190 && volumeLiters <= 350) {
    additionalTo190Rub = 189 * extraTo190;
    additional191To350Rub = (volumeLiters - 190) * extraTo350;
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
    firstLiterRub: money(firstLiterRub),
    additionalTo190Rub: money(additionalTo190Rub),
    additional191To350Rub: money(additional191To350Rub),
    fixed351To1000Rub: money(fixed351To1000Rub),
    fixedFrom1001Rub: money(fixedFrom1001Rub),
    totalRub
  };
}

function middleMileNote(sku: SkuInput, parts: MiddleMileCostParts): string {
  const { volumeLiters } = calculateSkuMetrics(sku);
  if (parts.fixedFrom1001Rub > 0) return `Объём ${formatDecimal(volumeLiters)} л: фиксированный тариф для 1001+ л.`;
  if (parts.fixed351To1000Rub > 0) return `Объём ${formatDecimal(volumeLiters)} л: фиксированный тариф для 351-1000 л.`;
  if (parts.additional191To350Rub > 0) {
    return `Объём ${formatDecimal(volumeLiters)} л: 1-й литр + 189 л × тариф + сверх 190 л × тариф.`;
  }
  if (parts.additionalTo190Rub > 0) return `Объём ${formatDecimal(volumeLiters)} л: 1-й литр + сверх 1 л × тариф.`;
  return `Объём ${formatDecimal(volumeLiters)} л: тариф до 1 литра.`;
}

function pimLastMileCostParts(sku: SkuInput, settings: CalculatorSettings, logistics: LogisticsAssumptions): CostParts | null {
  const metrics = calculateSkuMetrics(sku);
  const tariff = logistics.pimLastMile;
  const row = tariff.sellerTariffRows?.find((item) => item.city === settings.firstMileCity);
  if (!row) return null;
  const baseRub = settings.lastMileZone === "region" ? row.regionBaseRub : row.cityBaseRub;
  const extraRubPerKg = settings.lastMileZone === "region" ? row.regionExtraRubPerKg : row.cityExtraRubPerKg;
  const baseCostRub = baseRub * tariff.costMultiplier;
  const additionalCostRub = Math.max(0, metrics.chargeableKg - tariff.includedChargeableKg) * extraRubPerKg * tariff.costMultiplier;
  return { baseRub: baseCostRub, additionalRub: additionalCostRub, totalRub: baseCostRub + additionalCostRub };
}

function lastMileNote(sku: SkuInput, settings: CalculatorSettings, logistics: LogisticsAssumptions, parts: CostParts | null): string {
  const metrics = calculateSkuMetrics(sku);
  const tariff = logistics.pimLastMile;
  const row = tariff.sellerTariffRows?.find((item) => item.city === settings.firstMileCity);
  const zoneLabel = settings.lastMileZone === "region" ? "область/регион" : "город";
  if (!row || !parts) return `Город ${settings.firstMileCity}, зона ${zoneLabel}: тариф не найден.`;
  return `Город ${settings.firstMileCity}, зона ${zoneLabel}: до ${formatDecimal(tariff.includedChargeableKg)} кг + сверх лимита по расчётному весу ${formatDecimal(metrics.chargeableKg)} кг.`;
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
