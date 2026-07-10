import logisticsAssumptions from "../data/generated/logistics-assumptions.json";
import middleMileTariffs from "../data/generated/middle-mile-tariffs.json";
import ozonCommissions from "../data/generated/ozon-commissions.json";
import warehouseTariffs from "../data/generated/warehouse-tariffs.json";
import wildberriesCommissions from "../data/generated/wildberries-commissions.json";
import {
  buildClientDefaultSettings,
  uniqueSorted,
  wbWarehousesForDestinationWithTariffs,
  ozonClusterForCityWithLookups,
  buildCalculatorLookupData
} from "./calculator-lookups";
import { defaultSkus } from "./default-skus";
import type {
  CalculatorSettings,
  LogisticsAssumptions,
  MiddleMileTariffs,
  OzonCommissionEntry,
  TariffData,
  WarehouseTariffs,
  WbCommissionEntry
} from "./types";

export { buildCalculatorLookupData, defaultSkus, uniqueSorted, wbWarehousesForDestinationWithTariffs };

export const tariffData: TariffData = {
  wildberriesCommissions: wildberriesCommissions.entries as WbCommissionEntry[],
  ozonCommissions: ozonCommissions.entries as OzonCommissionEntry[],
  warehouse: warehouseTariffs as WarehouseTariffs,
  middleMile: middleMileTariffs as MiddleMileTariffs,
  logistics: logisticsAssumptions as LogisticsAssumptions
};

export function wbWarehousesForDestination(destinationCity: string): string[] {
  return wbWarehousesForDestinationWithTariffs(tariffData, destinationCity);
}

export function ozonClusterForCityWithTariffs(tariffs: TariffData, city: string): string {
  return tariffs.logistics.ozonLogistics.cityToCluster[city] ?? tariffs.logistics.ozonLogistics.originClusters[0] ?? "";
}

export function buildDefaultSettings(tariffs: TariffData = tariffData): CalculatorSettings {
  return {
    ...buildClientDefaultSettings(buildCalculatorLookupData(tariffs)),
    wbSupplyType: tariffs.logistics.wildberriesLogistics.defaultSupplyType ?? "box"
  };
}

export const defaultSettings: CalculatorSettings = buildDefaultSettings(tariffData);

export const wbCategories = uniqueSorted(tariffData.wildberriesCommissions.map((item) => item.category));
export const wbSubjects = uniqueSorted(tariffData.wildberriesCommissions.map((item) => item.subject));
export const wbSubjectsByCategory = Object.fromEntries(
  wbCategories.map((category) => [
    category,
    uniqueSorted(tariffData.wildberriesCommissions.filter((item) => item.category === category).map((item) => item.subject))
  ])
) as Record<string, string[]>;
export const ozonCategories = uniqueSorted(tariffData.ozonCommissions.map((item) => item.category));
export const ozonProductTypes = uniqueSorted(tariffData.ozonCommissions.map((item) => item.productType));
export const ozonProductTypesByCategory = Object.fromEntries(
  ozonCategories.map((category) => [
    category,
    uniqueSorted(tariffData.ozonCommissions.filter((item) => item.category === category).map((item) => item.productType))
  ])
) as Record<string, string[]>;
export const originCities = buildCalculatorLookupData(tariffData).originCities;
export const destinationCities = buildCalculatorLookupData(tariffData).destinationCities;
export const ozonOriginClusters = tariffData.logistics.ozonLogistics.originClusters;
export const ozonDeliveryClusters = tariffData.logistics.ozonLogistics.deliveryClusters;

export function ozonClusterForCity(city: string): string {
  return ozonClusterForCityWithLookups(buildCalculatorLookupData(tariffData), city);
}
