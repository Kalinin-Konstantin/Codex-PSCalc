import logisticsAssumptions from "../data/generated/logistics-assumptions.json";
import middleMileTariffs from "../data/generated/middle-mile-tariffs.json";
import ozonCommissions from "../data/generated/ozon-commissions.json";
import routeCities from "../data/generated/route-cities.json";
import warehouseTariffs from "../data/generated/warehouse-tariffs.json";
import wildberriesCommissions from "../data/generated/wildberries-commissions.json";
import type {
  CalculatorSettings,
  LogisticsAssumptions,
  MiddleMileTariffs,
  OzonCommissionEntry,
  SkuInput,
  TariffData,
  WarehouseTariffs,
  WbCommissionEntry
} from "./types";

export const tariffData: TariffData = {
  wildberriesCommissions: wildberriesCommissions.entries as WbCommissionEntry[],
  ozonCommissions: ozonCommissions.entries as OzonCommissionEntry[],
  warehouse: warehouseTariffs as WarehouseTariffs,
  middleMile: middleMileTariffs as MiddleMileTariffs,
  logistics: logisticsAssumptions as LogisticsAssumptions
};

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

const allWbWarehouses = tariffData.logistics.wildberriesLogistics.warehouses.map((item) => item.name);

export function wbWarehousesForDestination(destinationCity: string): string[] {
  const aliases = destinationWarehouseAliases[destinationCity] ?? [destinationCity];
  return aliases.filter((warehouse) => allWbWarehouses.includes(warehouse));
}

export const defaultSettings: CalculatorSettings = {
  originCity: "Москва",
  firstMileCity: "Москва",
  lastMileZone: "city",
  wbWarehouse: wbWarehousesForDestination("Москва")[0] ?? "",
  wbSupplyType: tariffData.logistics.wildberriesLogistics.defaultSupplyType ?? "box",
  localizationIndex: 1.2,
  salesDistributionIndex: 0.02,
  ozonDeliveryMode: "local",
  ozonDeliveryCluster: "Москва, МО и Дальние регионы",
  storageDays: 30,
  fastHandover: false,
  ozonFastHandoverType: "sc_courier_under_12",
  vatDisplayMode: "without_vat",
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

export const defaultSkus: SkuInput[] = [
  {
    id: "hanger",
    name: "Вешалки",
    price: 4050,
    wbCategory: "Мебель корпусная и мебель для хранения",
    wbSubject: "Вешалки настенные",
    ozonCategory: "Вешалки для одежды",
    ozonProductType: "Вешалка настенная",
    weightKg: 3.9,
    lengthCm: 107,
    widthCm: 8,
    heightCm: 49,
    itemsPerPallet: 30
  },
  {
    id: "cabinet",
    name: "Тумбочка",
    price: 4000,
    wbCategory: "Мебель корпусная и мебель для хранения",
    wbSubject: "Тумбы",
    ozonCategory: "Комоды, тумбы и туалетные столики",
    ozonProductType: "Тумба",
    weightKg: 13,
    lengthCm: 55,
    widthCm: 15,
    heightCm: 43,
    itemsPerPallet: 40
  },
  {
    id: "table",
    name: "Столик",
    price: 14500,
    wbCategory: "Мебель малых форм",
    wbSubject: "Столы журнальные",
    ozonCategory: "Столы",
    ozonProductType: "Стол обеденный",
    weightKg: 21.1,
    lengthCm: 105,
    widthCm: 11,
    heightCm: 105,
    itemsPerPallet: 16
  }
];

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
}

export const wbSubjects = uniqueSorted(tariffData.wildberriesCommissions.map((item) => item.subject));
export const ozonProductTypes = uniqueSorted(tariffData.ozonCommissions.map((item) => item.productType));
export const originCities = routeCities.originCities;
export const destinationCities = routeCities.destinationCities;
export const ozonDeliveryClusters = tariffData.logistics.ozonLogistics.deliveryClusters;
