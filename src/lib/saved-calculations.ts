import type { CalculatorSettings, SkuInput } from "./types";

export type SellerRecord = {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail?: string;
};

export type SavedCalculationRecord = {
  id: string;
  sellerId: string;
  name: string;
  updatedAt: string;
};

export type CalculationSnapshot = {
  version: 1;
  skus: SkuInput[];
  settings: CalculatorSettings;
};

export type LoadedCalculation = SavedCalculationRecord & {
  snapshot: CalculationSnapshot;
};

export type CalculatorWorkspace = {
  sellers: SellerRecord[];
  calculations: SavedCalculationRecord[];
  defaultSettings: CalculatorSettings;
  ownerId: string;
  ownerEmail?: string;
  canEdit: boolean;
  selectedSellerId: string;
  selectedCalculationId: string;
  loadedCalculation: LoadedCalculation | null;
  notice?: string;
};

export function isCalculationSnapshot(value: unknown): value is CalculationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<CalculationSnapshot>;
  return snapshot.version === 1 && Array.isArray(snapshot.skus) && Boolean(snapshot.settings);
}

export function hydrateCalculatorSettings(baseSettings: CalculatorSettings, value: unknown): CalculatorSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return baseSettings;
  const settings = withoutUndefined(value as Partial<CalculatorSettings>);

  return {
    ...baseSettings,
    ...settings,
    warehouseOperationGroups: mergeRecord(baseSettings.warehouseOperationGroups, settings.warehouseOperationGroups),
    warehouseOperationMarkupPercents: mergeRecord(baseSettings.warehouseOperationMarkupPercents, settings.warehouseOperationMarkupPercents),
    warehouseOperationRowMarkupPercents: mergeRecord(baseSettings.warehouseOperationRowMarkupPercents, settings.warehouseOperationRowMarkupPercents),
    warehouseReceivingMarkupPercents: mergeRecord(baseSettings.warehouseReceivingMarkupPercents, settings.warehouseReceivingMarkupPercents),
    warehouseStorageMarkupPercents: mergeRecord(baseSettings.warehouseStorageMarkupPercents, settings.warehouseStorageMarkupPercents),
    warehouseFulfillmentExtraOperations: mergeRecord(baseSettings.warehouseFulfillmentExtraOperations, settings.warehouseFulfillmentExtraOperations)
  };
}

function mergeRecord<T extends Record<string, unknown>>(base: T, value: unknown): T {
  return {
    ...base,
    ...recordOrEmpty(value)
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? withoutUndefined(value as Record<string, unknown>) : {};
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as Partial<T>;
}
