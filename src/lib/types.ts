export type Marketplace = "wildberries" | "ozon";
export type Scheme = "fbo" | "fbs" | "dbs";
export type LastMileZone = "city" | "region";
export type WbSupplyType = "box" | "pallet";
export type VatDisplayMode = "without_vat" | "with_vat";
export type CostVatMode = "without_vat" | "with_vat" | "no_vat";
export type OzonFastHandoverType = "sc_courier_under_12" | "sc_courier_12_24" | "pvz_ppz_recommended_slot";
export type PresentationMode = "client" | "internal";
export type PimProfitCenter = "firstMile" | "warehouse" | "middleMile" | "lastMile";
export type WarehouseOperationGroup = "receiving" | "storage" | "fulfillment" | "shipping";
export type WarehouseSupplyType = "mono_pallet" | "mix_pallet" | "boxes";
export type WbDimensionClass = "mgt" | "kgt_plus" | "sgt";
export type OzonDimensionClass = "standard" | "kgt";

export type SkuDimensionClasses = {
  wildberries: WbDimensionClass;
  ozon: OzonDimensionClass;
};

export type SkuInput = {
  id: string;
  name: string;
  price: number;
  wbCategory: string;
  wbSubject: string;
  ozonCategory: string;
  ozonProductType: string;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  itemsPerPallet: number;
};

export type CalculatorSettings = {
  originCity: string;
  firstMileCity: string;
  lastMileZone: LastMileZone;
  wbWarehouse: string;
  wbSupplyType: WbSupplyType;
  localizationIndex: number;
  salesDistributionIndex: number;
  ozonDeliveryMode: "local" | "cluster";
  ozonDeliveryCluster: string;
  storageDays: number;
  fastHandover: boolean;
  ozonFastHandoverType: OzonFastHandoverType;
  vatDisplayMode: VatDisplayMode;
  presentationMode: PresentationMode;
  firstMileMarkupPercent: number;
  warehouseMarkupPercent: number;
  warehouseSupplyType: WarehouseSupplyType;
  warehouseOperationGroups: Record<WarehouseOperationGroup, boolean>;
  warehouseOperationMarkupPercents: Record<WarehouseOperationGroup, number>;
  warehouseReceivingMarkupPercents: Record<string, number>;
  warehouseStorageMarkupPercents: Record<string, number>;
  warehouseFulfillmentExtraOperations: Record<string, boolean>;
  middleMileFirstLiterMarkupPercent: number;
  middleMileAdditionalLiterMarkupPercent: number;
  middleMileOver190LiterMarkupPercent: number;
  middleMileFrom351To1000MarkupPercent: number;
  middleMileFrom1001MarkupPercent: number;
  lastMileBaseMarkupPercent: number;
  lastMileAdditionalKgMarkupPercent: number;
};

export type CostBreakdownItem = {
  key: string;
  label: string;
  amountRub: number;
  amountWithoutVatRub: number;
  amountWithVatRub: number;
  source: "pim" | "marketplace" | "assumption";
  vatMode: CostVatMode;
  vatNote: string;
  calculationNote?: string;
  internalNote?: string;
  pimProfitCenter?: PimProfitCenter;
  pimCostWithoutVatRub?: number;
  pimProfitWithoutVatRub?: number;
  pimProfitWithVatRub?: number;
  pimWarehouseGroup?: WarehouseOperationGroup;
  pimWarehouseOperationKey?: string;
  pimBaseCostWithoutVatRub?: number;
  pimAdditionalCostWithoutVatRub?: number;
  pimMiddleMileFirstLiterCostWithoutVatRub?: number;
  pimMiddleMileAdditionalTo190CostWithoutVatRub?: number;
  pimMiddleMileAdditional191To350CostWithoutVatRub?: number;
  pimMiddleMileFixed351To1000CostWithoutVatRub?: number;
  pimMiddleMileFixedFrom1001CostWithoutVatRub?: number;
};

export type SchemeResult = {
  marketplace: Marketplace;
  scheme: Scheme;
  isComplete: boolean;
  totalRub: number;
  percentOfPrice: number;
  priceBasisRub: number;
  vatDisplayMode: VatDisplayMode;
  breakdown: CostBreakdownItem[];
  warnings: string[];
};

export type CalculationResult = {
  wildberries: Record<Scheme, SchemeResult>;
  ozon: Record<Scheme, SchemeResult>;
};

export type WbCommissionEntry = {
  category: string;
  subject: string;
  parentID?: number;
  subjectID?: number;
  commission: Record<Scheme, number>;
};

export type OzonCommissionEntry = {
  category: string;
  productType: string;
  commissionBands: Record<Scheme, Record<string, number>>;
};

export type WarehouseTariffs = {
  selectedMapping?: Record<string, string>;
  calculationRules?: Record<string, string>;
  legacyFurnitureCaseValues?: Record<string, unknown>;
  selected: Record<string, number>;
  operations?: Array<{
    name: string;
    unit: string;
    priceRub: number;
  }>;
};

export type MiddleMileTariffs = {
  tiers: Array<{ name: string; priceRub: number }>;
};

export type LogisticsAssumptions = {
  firstMile: {
    defaultCity: string;
    source?: string;
    formula?: string;
    officialPekWorkbook?: {
      source: string;
      sheet: string;
      currentDefaultOrigin: string;
      controlRow: string;
      conversionDecision: string;
      defaultPallet: Record<string, number>;
      controlTotalsPerPalletRub: Array<{ city: string; rub: number }>;
    };
    legacyFurnitureCaseRates?: {
      source: string;
      formula: string;
      cities: Array<{ city: string; rubPerUnit: number }>;
    };
    cities: Array<{ city: string; rubPerPallet: number }>;
    routes?: Array<{ originCity: string; destinationCity: string; rubPerPallet: number }>;
  };
  pimLastMile: {
    source?: string;
    sourceUrl?: string;
    vat?: string;
    sourcePriceType?: string;
    costRule?: string;
    currentScope?: string;
    calculationRule?: string;
    weightRule?: string;
    zoneRule?: string;
    baseRub: number;
    includedChargeableKg: number;
    extraRubPerKg: number;
    costMultiplier: number;
    sellerTariffRows?: Array<{
      city: string;
      warehouse: string;
      cityRegion: string;
      regionName: string;
      cityBaseRub: number;
      cityExtraRubPerKg: number;
      regionBaseRub: number;
      regionExtraRubPerKg: number;
    }>;
  };
  wildberriesLogistics: {
    source?: string;
    commissionSource?: string;
    status?: string;
    backlogIds?: string[];
    calculationDate?: string;
    importedAt?: string;
    dtTillMax?: string | null;
    boxTypeIds?: Record<string, number>;
    defaultSupplyType?: WbSupplyType;
    defaultLocalizationIndex?: number;
    defaultSalesDistributionIndex?: number;
    smallVolumeBands?: Array<{ minLiter: number; maxLiter: number; rub: number }>;
    calculationRules?: Record<string, string>;
    firstLiterRub: number;
    extraLiterRub: number;
    storagePalletDayRub: number;
    defaultKtr: number;
    warehouses: Array<{
      name: string;
      geoName?: string;
      warehouseCoeff: number;
      fbsCoeff: number;
      box?: {
        deliveryBaseRub: number | null;
        deliveryAdditionalLiterRub: number | null;
        deliveryCoefPercent: number | null;
        marketplaceDeliveryBaseRub: number | null;
        marketplaceDeliveryAdditionalLiterRub: number | null;
        marketplaceDeliveryCoefPercent: number | null;
        storageBaseRub: number | null;
        storageAdditionalLiterRub: number | null;
        storageCoefPercent: number | null;
        geoName?: string;
      } | null;
      pallet?: {
        deliveryBaseRub: number | null;
        deliveryAdditionalLiterRub: number | null;
        deliveryCoefPercent: number | null;
        storagePalletDayRub: number | null;
        storageCoefPercent: number | null;
      } | null;
      acceptance?: Record<string, {
        date: string;
        warehouseID: number;
        allowUnload: boolean;
        coefficient: number;
        boxTypeID: number;
        storageCoefPercent: number | null;
        deliveryCoefPercent: number | null;
        deliveryBaseLiterRub: number | null;
        deliveryAdditionalLiterRub: number | null;
        storageBaseLiterRub: number | null;
        storageAdditionalLiterRub: number | null;
        isSortingCenter: boolean;
      } | null>;
    }>;
  };
  ozonLogistics: {
    source?: string;
    status?: string;
    backlogIds?: string[];
    calculationRules?: Record<string, string>;
    pickupPointRub: number;
    fbsAcceptanceRub: number;
    tariffSource?: string;
    nonlocalMarkupSource?: string;
    storageFreeDaysSource?: string;
    storageRates?: {
      standardRubPerLiterDay: number;
      kgtRubPerLiterDay: number;
    };
    cityToCluster: Record<string, string>;
    originClusters: string[];
    deliveryClusters: string[];
    volumeRanges: Array<{ label: string; minLiter: number; maxLiter: number | null }>;
    tariffs: Array<{
      volumeLabel: string;
      minLiter: number;
      maxLiter: number | null;
      originCluster: string;
      deliveryCluster: string;
      priceTo300Rub: number;
      priceOver300Rub: number;
    }>;
    defaultTariffs: Array<{
      volumeLabel: string;
      minLiter: number;
      maxLiter: number | null;
      priceTo300Rub: number;
      priceOver300Rub: number;
    }>;
    nonlocalMarkups: Array<{ deliveryCluster: string; percent: number }>;
    storageFreeDays?: Array<{
      category: string;
      productType: string;
      standardDays: number | null;
      kgtDays: number | null;
      fireHazardDays: number | null;
      kazakhstanDays: number | null;
      specialTariffNote: string | null;
    }>;
  };
};

export type TariffData = {
  wildberriesCommissions: WbCommissionEntry[];
  ozonCommissions: OzonCommissionEntry[];
  warehouse: WarehouseTariffs;
  middleMile: MiddleMileTariffs;
  logistics: LogisticsAssumptions;
};

export type SkuMetrics = {
  volumeLiters: number;
  volumetricWeightKg: number;
  chargeableKg: number;
};
