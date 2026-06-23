import type { CalculatorSettings, WarehouseOperationGroup, WarehouseSupplyType } from "./types.ts";

export type CommercialSettings = Pick<
  CalculatorSettings,
  | "firstMileMarkupPercent"
  | "warehouseMarkupPercent"
  | "warehouseSupplyType"
  | "warehouseOperationGroups"
  | "warehouseOperationMarkupPercents"
  | "warehouseOperationRowMarkupPercents"
  | "warehouseReceivingMarkupPercents"
  | "warehouseStorageMarkupPercents"
  | "warehouseFulfillmentExtraOperations"
  | "middleMileFirstLiterMarkupPercent"
  | "middleMileAdditionalLiterMarkupPercent"
  | "middleMileOver190LiterMarkupPercent"
  | "middleMileFrom351To1000MarkupPercent"
  | "middleMileFrom1001MarkupPercent"
  | "lastMileBaseMarkupPercent"
  | "lastMileAdditionalKgMarkupPercent"
>;

export type CommercialSettingsProfile = {
  id: string;
  name: string;
  settings: CommercialSettings;
  updatedAt?: string;
};

const warehouseGroups: WarehouseOperationGroup[] = ["receiving", "storage", "fulfillment", "shipping"];
const warehouseSupplyTypes: WarehouseSupplyType[] = ["mono_pallet", "mix_pallet", "boxes"];

export const defaultCommercialSettings: CommercialSettings = {
  firstMileMarkupPercent: 10,
  warehouseMarkupPercent: 20,
  warehouseSupplyType: "mono_pallet",
  warehouseOperationGroups: {
    receiving: true,
    storage: true,
    fulfillment: true,
    shipping: true
  },
  warehouseOperationMarkupPercents: {
    receiving: 20,
    storage: 20,
    fulfillment: 20,
    shipping: 20
  },
  warehouseOperationRowMarkupPercents: {},
  warehouseReceivingMarkupPercents: {},
  warehouseStorageMarkupPercents: {},
  warehouseFulfillmentExtraOperations: {},
  middleMileFirstLiterMarkupPercent: 20,
  middleMileAdditionalLiterMarkupPercent: 30,
  middleMileOver190LiterMarkupPercent: 30,
  middleMileFrom351To1000MarkupPercent: 20,
  middleMileFrom1001MarkupPercent: 20,
  lastMileBaseMarkupPercent: 30,
  lastMileAdditionalKgMarkupPercent: 30
};

export function extractCommercialSettings(settings: CalculatorSettings): CommercialSettings {
  return {
    firstMileMarkupPercent: settings.firstMileMarkupPercent,
    warehouseMarkupPercent: settings.warehouseMarkupPercent,
    warehouseSupplyType: settings.warehouseSupplyType,
    warehouseOperationGroups: { ...settings.warehouseOperationGroups },
    warehouseOperationMarkupPercents: { ...settings.warehouseOperationMarkupPercents },
    warehouseOperationRowMarkupPercents: { ...settings.warehouseOperationRowMarkupPercents },
    warehouseReceivingMarkupPercents: { ...settings.warehouseReceivingMarkupPercents },
    warehouseStorageMarkupPercents: { ...settings.warehouseStorageMarkupPercents },
    warehouseFulfillmentExtraOperations: { ...settings.warehouseFulfillmentExtraOperations },
    middleMileFirstLiterMarkupPercent: settings.middleMileFirstLiterMarkupPercent,
    middleMileAdditionalLiterMarkupPercent: settings.middleMileAdditionalLiterMarkupPercent,
    middleMileOver190LiterMarkupPercent: settings.middleMileOver190LiterMarkupPercent,
    middleMileFrom351To1000MarkupPercent: settings.middleMileFrom351To1000MarkupPercent,
    middleMileFrom1001MarkupPercent: settings.middleMileFrom1001MarkupPercent,
    lastMileBaseMarkupPercent: settings.lastMileBaseMarkupPercent,
    lastMileAdditionalKgMarkupPercent: settings.lastMileAdditionalKgMarkupPercent
  };
}

export function applyCommercialSettings(
  baseSettings: CalculatorSettings,
  commercialSettings: Partial<CommercialSettings> | null | undefined
): CalculatorSettings {
  if (!commercialSettings) return baseSettings;

  return {
    ...baseSettings,
    ...sanitizeCommercialSettings(commercialSettings),
    warehouseOperationGroups: {
      ...baseSettings.warehouseOperationGroups,
      ...sanitizeBooleanRecord(commercialSettings.warehouseOperationGroups, warehouseGroups)
    },
    warehouseOperationMarkupPercents: {
      ...baseSettings.warehouseOperationMarkupPercents,
      ...sanitizeWarehouseGroupPercents(commercialSettings.warehouseOperationMarkupPercents)
    },
    warehouseOperationRowMarkupPercents: {
      ...baseSettings.warehouseOperationRowMarkupPercents,
      ...sanitizeNumberRecord(commercialSettings.warehouseOperationRowMarkupPercents)
    },
    warehouseReceivingMarkupPercents: {
      ...baseSettings.warehouseReceivingMarkupPercents,
      ...sanitizeNumberRecord(commercialSettings.warehouseReceivingMarkupPercents)
    },
    warehouseStorageMarkupPercents: {
      ...baseSettings.warehouseStorageMarkupPercents,
      ...sanitizeNumberRecord(commercialSettings.warehouseStorageMarkupPercents)
    },
    warehouseFulfillmentExtraOperations: {
      ...baseSettings.warehouseFulfillmentExtraOperations,
      ...sanitizeBooleanRecord(commercialSettings.warehouseFulfillmentExtraOperations)
    }
  };
}

export function parseCommercialSettings(value: unknown): CommercialSettings {
  if (!isRecord(value)) return defaultCommercialSettings;
  const sanitized = sanitizeCommercialSettings(value);

  return {
    ...defaultCommercialSettings,
    ...sanitized,
    warehouseOperationGroups: {
      ...defaultCommercialSettings.warehouseOperationGroups,
      ...sanitizeBooleanRecord(value.warehouseOperationGroups, warehouseGroups)
    },
    warehouseOperationMarkupPercents: {
      ...defaultCommercialSettings.warehouseOperationMarkupPercents,
      ...sanitizeWarehouseGroupPercents(value.warehouseOperationMarkupPercents)
    },
    warehouseOperationRowMarkupPercents: sanitizeNumberRecord(value.warehouseOperationRowMarkupPercents),
    warehouseReceivingMarkupPercents: sanitizeNumberRecord(value.warehouseReceivingMarkupPercents),
    warehouseStorageMarkupPercents: sanitizeNumberRecord(value.warehouseStorageMarkupPercents),
    warehouseFulfillmentExtraOperations: sanitizeBooleanRecord(value.warehouseFulfillmentExtraOperations)
  };
}

function sanitizeCommercialSettings(settings: Partial<CommercialSettings>): Partial<CommercialSettings> {
  return withoutUndefined({
    firstMileMarkupPercent: finiteOrUndefined(settings.firstMileMarkupPercent),
    warehouseMarkupPercent: finiteOrUndefined(settings.warehouseMarkupPercent),
    warehouseSupplyType: warehouseSupplyTypes.includes(settings.warehouseSupplyType as WarehouseSupplyType)
      ? settings.warehouseSupplyType
      : undefined,
    middleMileFirstLiterMarkupPercent: finiteOrUndefined(settings.middleMileFirstLiterMarkupPercent),
    middleMileAdditionalLiterMarkupPercent: finiteOrUndefined(settings.middleMileAdditionalLiterMarkupPercent),
    middleMileOver190LiterMarkupPercent: finiteOrUndefined(settings.middleMileOver190LiterMarkupPercent),
    middleMileFrom351To1000MarkupPercent: finiteOrUndefined(settings.middleMileFrom351To1000MarkupPercent),
    middleMileFrom1001MarkupPercent: finiteOrUndefined(settings.middleMileFrom1001MarkupPercent),
    lastMileBaseMarkupPercent: finiteOrUndefined(settings.lastMileBaseMarkupPercent),
    lastMileAdditionalKgMarkupPercent: finiteOrUndefined(settings.lastMileAdditionalKgMarkupPercent)
  });
}

function sanitizeWarehouseGroupPercents(value: unknown): Partial<Record<WarehouseOperationGroup, number>> {
  const record = sanitizeNumberRecord(value);
  return Object.fromEntries(
    warehouseGroups
      .map((group) => [group, record[group]] as const)
      .filter((entry): entry is [WarehouseOperationGroup, number] => typeof entry[1] === "number")
  );
}

function sanitizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, finiteOrUndefined(item)] as const)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}

function sanitizeBooleanRecord<T extends string>(value: unknown, allowedKeys: T[]): Partial<Record<T, boolean>>;
function sanitizeBooleanRecord(value: unknown): Record<string, boolean>;
function sanitizeBooleanRecord<T extends string = string>(value: unknown, allowedKeys?: T[]): Partial<Record<T, boolean>> | Record<string, boolean> {
  if (!isRecord(value)) return {};
  const allowed = allowedKeys ? new Set<string>(allowedKeys) : null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => (allowed ? allowed.has(key) : true) && typeof item === "boolean")
      .map(([key, item]) => [key, item])
  ) as Partial<Record<T, boolean>>;
}

function finiteOrUndefined(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as Partial<T>;
}
