import { readFile, writeFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const wb = await readJson("../src/data/generated/wildberries-commissions.json");
const ozon = await readJson("../src/data/generated/ozon-commissions.json");
const warehouse = await readJson("../src/data/generated/warehouse-tariffs.json");
const middleMile = await readJson("../src/data/generated/middle-mile-tariffs.json");
const logistics = await readJson("../src/data/generated/logistics-assumptions.json");
const routeCities = await readJson("../src/data/generated/route-cities.json");

const uniqueSorted = (values) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
const destinationWarehouseAliases = {
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
const wbWarehouses = logistics.wildberriesLogistics.warehouses.map((item) => item.name);
const wbWarehousesByDestination = Object.fromEntries(
  routeCities.destinationCities.map((city) => [
    city,
    (destinationWarehouseAliases[city] ?? [city]).filter((warehouse) => wbWarehouses.includes(warehouse))
  ])
);

const data = {
  wildberriesCommissions: wb.entries,
  ozonCommissions: ozon.entries,
  warehouse,
  middleMile,
  logistics,
  originCities: routeCities.originCities,
  destinationCities: routeCities.destinationCities,
  wbWarehousesByDestination,
  ozonDeliveryClusters: logistics.ozonLogistics.deliveryClusters,
  wbSubjects: uniqueSorted(wb.entries.map((item) => item.subject)),
  ozonProductTypes: uniqueSorted(ozon.entries.map((item) => item.productType)),
  defaultSettings: {
    originCity: "Москва",
    firstMileCity: "Москва",
    lastMileZone: "city",
    wbWarehouse: wbWarehousesByDestination["Москва"]?.[0] ?? "",
    wbSupplyType: logistics.wildberriesLogistics.defaultSupplyType ?? "box",
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
  },
  defaultSkus: [
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
  ]
};

await writeFile(new URL("../preview/data.js", import.meta.url), `window.__PIM_DATA__ = ${JSON.stringify(data)};\n`, "utf8");
console.log("wrote preview/data.js");
