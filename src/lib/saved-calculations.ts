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
