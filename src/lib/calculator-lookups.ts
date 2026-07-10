import routeCities from "../data/generated/route-cities.json";
import type { CalculatorSettings, TariffData } from "./types";

const destinationWarehouseAliases: Record<string, string[]> = {
  "Москва": ["Коледино"],
  "Краснодар": ["Краснодар", "Краснодар СГТ"],
  "Казань": ["Казань", "Казань СГТ"],
  "Красноярск": [],
  "Самара": ["Самара (Новосемейкино)"],
  "Нижний Новгород": ["СЦ Нижний Новгород Ларина"],
  "Санкт-Петербург": ["Санкт-Петербург Уткина Заводь", "Санкт-Петербург СГТ", "СПБ Шушары"],
  "Екатеринбург": ["Екатеринбург - Испытателей 14г", "Екатеринбург - Перспективная 14", "Екатеринбург 2 СГТ", "Екатеринбург СГТ"],
  "Новосибирск": ["Новосибирск", "Новосибирск СГТ"],
  "Уссурийск": [],
  "Хабаровск": ["Хабаровск", "СЦ Хабаровск"]
};

export type CalculatorLookupData = {
  originCities: string[];
  destinationCities: string[];
  wbCategories: string[];
  wbSubjects: string[];
  wbSubjectsByCategory: Record<string, string[]>;
  wbCategoriesBySubject: Record<string, string[]>;
  wbWarehousesByDestination: Record<string, string[]>;
  ozonCategories: string[];
  ozonProductTypes: string[];
  ozonProductTypesByCategory: Record<string, string[]>;
  ozonCategoriesByProductType: Record<string, string[]>;
  ozonCityToCluster: Record<string, string>;
  ozonOriginClusters: string[];
  ozonDeliveryClusters: string[];
};

export function buildCalculatorLookupData(tariffs: TariffData): CalculatorLookupData {
  const wbCategories = uniqueSorted(tariffs.wildberriesCommissions.map((item) => item.category));
  const wbSubjects = uniqueSorted(tariffs.wildberriesCommissions.map((item) => item.subject));
  const ozonCategories = uniqueSorted(tariffs.ozonCommissions.map((item) => item.category));
  const ozonProductTypes = uniqueSorted(tariffs.ozonCommissions.map((item) => item.productType));

  return {
    originCities: routeCities.originCities,
    destinationCities: routeCities.destinationCities,
    wbCategories,
    wbSubjects,
    wbSubjectsByCategory: Object.fromEntries(
      wbCategories.map((category) => [
        category,
        uniqueSorted(tariffs.wildberriesCommissions.filter((item) => item.category === category).map((item) => item.subject))
      ])
    ),
    wbCategoriesBySubject: groupValuesByKey(
      tariffs.wildberriesCommissions.map((item) => [item.subject, item.category] as const)
    ),
    wbWarehousesByDestination: Object.fromEntries(
      routeCities.destinationCities.map((city) => [city, wbWarehousesForDestinationWithTariffs(tariffs, city)])
    ),
    ozonCategories,
    ozonProductTypes,
    ozonProductTypesByCategory: Object.fromEntries(
      ozonCategories.map((category) => [
        category,
        uniqueSorted(tariffs.ozonCommissions.filter((item) => item.category === category).map((item) => item.productType))
      ])
    ),
    ozonCategoriesByProductType: groupValuesByKey(
      tariffs.ozonCommissions.map((item) => [item.productType, item.category] as const)
    ),
    ozonCityToCluster: tariffs.logistics.ozonLogistics.cityToCluster,
    ozonOriginClusters: tariffs.logistics.ozonLogistics.originClusters,
    ozonDeliveryClusters: tariffs.logistics.ozonLogistics.deliveryClusters
  };
}

export function buildClientDefaultSettings(lookups: CalculatorLookupData): CalculatorSettings {
  const defaultCity = "Москва";
  const defaultOzonCluster = lookups.ozonCityToCluster[defaultCity] ?? lookups.ozonOriginClusters[0] ?? "";

  return {
    originCity: defaultCity,
    firstMileCity: defaultCity,
    lastMileZone: "city",
    wbWarehouse: lookups.wbWarehousesByDestination[defaultCity]?.[0] ?? "",
    wbSupplyType: "box",
    localizationIndex: 1.2,
    salesDistributionIndex: 0.02,
    ozonOriginCluster: defaultOzonCluster,
    ozonDeliveryCluster: defaultOzonCluster,
    storageDays: 30,
    fastHandover: false,
    ozonFastHandoverType: "sc_courier_under_12",
    vatDisplayMode: "with_vat",
    presentationMode: "client",
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
}

export function wbWarehousesForDestinationWithTariffs(tariffs: TariffData, destinationCity: string): string[] {
  const allWbWarehouses = tariffs.logistics.wildberriesLogistics.warehouses.map((item) => item.name);
  const aliases = destinationWarehouseAliases[destinationCity] ?? [destinationCity];
  return aliases.filter((warehouse) => allWbWarehouses.includes(warehouse));
}

export function ozonClusterForCityWithLookups(lookups: CalculatorLookupData, city: string): string {
  return lookups.ozonCityToCluster[city] ?? lookups.ozonOriginClusters[0] ?? "";
}

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
}

function groupValuesByKey(entries: Array<readonly [string, string]>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const [key, value] of entries) {
    groups[key] = groups[key] ? [...groups[key], value] : [value];
  }
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, uniqueSorted(values)]));
}
