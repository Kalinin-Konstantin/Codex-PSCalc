import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  calculateAllSchemes,
  calculateSkuMetrics,
  classifySkuDimensions,
  findBestResult,
  findOzonCommission,
  findWbCommission,
  flattenResults
} from "../src/lib/calculator.ts";
import type { CalculatorSettings, SkuInput, TariffData } from "../src/lib/types.ts";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));

const wbSource = readJson("../src/data/generated/wildberries-commissions.json");
const ozonSource = readJson("../src/data/generated/ozon-commissions.json");
const routeCities = readJson("../src/data/generated/route-cities.json");

const tariffs: TariffData = {
  wildberriesCommissions: wbSource.entries,
  ozonCommissions: ozonSource.entries,
  warehouse: readJson("../src/data/generated/warehouse-tariffs.json"),
  middleMile: readJson("../src/data/generated/middle-mile-tariffs.json"),
  logistics: readJson("../src/data/generated/logistics-assumptions.json")
};

const settings: CalculatorSettings = {
  originCity: "Воронеж",
  firstMileCity: "Москва",
  lastMileZone: "city",
  wbWarehouse: "Коледино",
  wbSupplyType: "box",
  localizationIndex: 1,
  salesDistributionIndex: 0,
  ozonDeliveryMode: "local",
  ozonDeliveryCluster: "Москва, МО и Дальние регионы",
  storageDays: 30,
  fastHandover: false,
  ozonFastHandoverType: "sc_courier_under_12",
  vatDisplayMode: "without_vat",
  presentationMode: "client",
  firstMileMarkupPercent: 0,
  warehouseMarkupPercent: 0,
  warehouseSupplyType: "mono_pallet",
  warehouseOperationGroups: {
    receiving: true,
    storage: true,
    fulfillment: true,
    shipping: true
  },
  warehouseOperationMarkupPercents: {
    receiving: 0,
    storage: 0,
    fulfillment: 0,
    shipping: 0
  },
  warehouseOperationRowMarkupPercents: {},
  warehouseReceivingMarkupPercents: {},
  warehouseStorageMarkupPercents: {
    "Хранение EUR паллет (800х1200 вес до 1000 кг), высота до 1,8 м": 0,
    "Хранение товара": 0,
    "Сортировка по артикулам, за штуку до 1 кг": 0,
    "Сортировка по артикулам до 5 кг": 0,
    "Сортировка по артикулам 5,01-10 кг": 0,
    "Сортировка по артикулам 10,01-25 кг": 0,
    "Сортировка по артикулам 25,01-50 кг": 0,
    "Сортировка по артикулам 50,01-70 кг": 0,
    "Сортировка по артикулам 70,01 -110 кг": 0
  },
  warehouseFulfillmentExtraOperations: {},
  middleMileFirstLiterMarkupPercent: 0,
  middleMileAdditionalLiterMarkupPercent: 0,
  middleMileOver190LiterMarkupPercent: 0,
  middleMileFrom351To1000MarkupPercent: 0,
  middleMileFrom1001MarkupPercent: 0,
  lastMileBaseMarkupPercent: 0,
  lastMileAdditionalKgMarkupPercent: 0
};

const skus: SkuInput[] = [
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

test("volume and volumetric weight match the Excel case formulas", () => {
  const metrics = calculateSkuMetrics(skus[0]);
  assert.equal(metrics.volumeLiters, 41.944);
  assert.equal(metrics.volumetricWeightKg, 8.3888);
  assert.equal(metrics.chargeableKg, 8.3888);
});

test("SKU dimension classes are calculated separately for WB and Ozon", () => {
  assert.deepEqual(classifySkuDimensions({ lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 12 }), {
    wildberries: "mgt",
    ozon: "standard"
  });
  assert.deepEqual(classifySkuDimensions({ lengthCm: 150, widthCm: 5, heightCm: 5, weightKg: 2 }), {
    wildberries: "kgt_plus",
    ozon: "kgt"
  });
  assert.deepEqual(classifySkuDimensions({ lengthCm: 105, widthCm: 11, heightCm: 105, weightKg: 21.1 }), {
    wildberries: "kgt_plus",
    ozon: "kgt"
  });
  assert.deepEqual(classifySkuDimensions({ lengthCm: 90, widthCm: 60, heightCm: 50, weightKg: 25 }), {
    wildberries: "sgt",
    ozon: "standard"
  });
});

test("commission lookups use marketplace source files", () => {
  const wb = findWbCommission(skus[0], tariffs.wildberriesCommissions);
  assert.ok(wb.fbo > 0);
  assert.ok(wb.fbs > wb.fbo);

  const ozon = findOzonCommission(skus[0], "fbo", tariffs.ozonCommissions);
  assert.ok(ozon > 0);
});

test("wildberries commission columns are mapped to FBO/FBS/DBS schemes", () => {
  assert.equal(wbSource.columnMapping.fbo, "kgvpPickup");
  assert.equal(wbSource.columnMapping.fbs, "kgvpMarketplace");
  assert.equal(wbSource.columnMapping.dbs, "kgvpSupplier");

  const first = tariffs.wildberriesCommissions.find((entry) => entry.subject === "Вешалки настенные");
  assert.ok(first);
  assert.deepEqual(first.commission, { fbo: 0.17, fbs: 0.3, dbs: 0.25 });
});

test("ozon commission columns and price bands are mapped to scheme rates with RFBS as DBS", () => {
  assert.equal(ozonSource.columnMapping.fboColumns, "C:H");
  assert.equal(ozonSource.columnMapping.fbsColumns, "O:T");
  assert.equal(ozonSource.columnMapping.dbsUsesRfbsColumns, "U:X");

  const sample = tariffs.ozonCommissions.find((entry) => entry.productType === "3D-очки");
  assert.ok(sample);
  assert.equal(sample.commissionBands.fbo.to100, 0.14);
  assert.equal(sample.commissionBands.fbo.over10000, 0.44);
  assert.equal(sample.commissionBands.fbs["300to1500"], 0.49);
  assert.equal(sample.commissionBands.dbs["1500to5000"], 0.5);

  assert.equal(
    findOzonCommission({ price: 99, ozonProductType: "3D-очки", ozonCategory: "VR-устройства и аксессуары" }, "fbo", tariffs.ozonCommissions),
    0.14
  );
  assert.equal(
    findOzonCommission({ price: 5000, ozonProductType: "3D-очки", ozonCategory: "VR-устройства и аксессуары" }, "fbs", tariffs.ozonCommissions),
    0.5
  );
  assert.equal(
    findOzonCommission({ price: 5001, ozonProductType: "3D-очки", ozonCategory: "VR-устройства и аксессуары" }, "dbs", tariffs.ozonCommissions),
    0.5
  );
});

test("ozon commission lookup avoids charity duplicates for regular furniture SKUs", () => {
  const cabinet = calculateAllSchemes(skus[1], settings, tariffs);
  const table = calculateAllSchemes(skus[2], settings, tariffs);
  const cabinetFbsCommission = cabinet.ozon.fbs.breakdown.find((item) => item.key === "commission");
  const cabinetDbsCommission = cabinet.ozon.dbs.breakdown.find((item) => item.key === "commission");
  const tableFbsCommission = table.ozon.fbs.breakdown.find((item) => item.key === "commission");
  const tableDbsCommission = table.ozon.dbs.breakdown.find((item) => item.key === "commission");

  assert.equal(cabinetFbsCommission?.label, "Комиссия маркетплейса 48%");
  assert.equal(cabinetDbsCommission?.label, "Комиссия маркетплейса 48%");
  assert.equal(tableFbsCommission?.label, "Комиссия маркетплейса 41%");
  assert.equal(tableDbsCommission?.label, "Комиссия маркетплейса 41%");
});

test("missing marketplace commission creates an incomplete scheme instead of a silent fallback", () => {
  const unknownSku: SkuInput = {
    ...skus[0],
    id: "unknown",
    wbCategory: "Неизвестная категория WB",
    wbSubject: "Неизвестный предмет WB",
    ozonCategory: "Неизвестная категория Ozon",
    ozonProductType: "Неизвестный тип Ozon"
  };

  assert.equal(findWbCommission(unknownSku, tariffs.wildberriesCommissions), null);
  assert.equal(findOzonCommission(unknownSku, "fbo", tariffs.ozonCommissions), null);

  const result = calculateAllSchemes(unknownSku, settings, tariffs);
  for (const scheme of flattenResults(result)) {
    assert.equal(scheme.isComplete, false);
    assert.ok(scheme.warnings.some((warning) => warning.includes("Не найдена комиссия")));
    assert.equal(scheme.breakdown.find((item) => item.key === "commission")?.amountRub, 0);
  }
});

test("first mile uses PEK route totals divided by SKU items per pallet", () => {
  const firstMile = tariffs.logistics.firstMile;

  assert.equal(firstMile.source, "Google Sheets: Тарифы первой мили PIM.Seller, лист gid=1385583318");
  assert.equal(firstMile.formula, "rubPerUnit = routeRubPerPallet(originCity, destinationCity) / itemsPerPallet");
  assert.equal(firstMile.officialPekWorkbook?.source, "https://docs.google.com/spreadsheets/d/1mGJF_6WYtcsCIcM6vVu5af9SeH2A6qq5/edit?gid=1385583318#gid=1385583318");
  assert.equal(firstMile.officialPekWorkbook?.controlRow, "row 12: ИТОГО (за 1 паллет), generated for each origin city from C2 route formulas");
  assert.equal(firstMile.officialPekWorkbook?.conversionDecision, "approved: route rubPerPallet / itemsPerPallet");

  const rateByCity = Object.fromEntries(firstMile.cities.map((city) => [city.city, city.rubPerPallet]));
  const routeByKey = Object.fromEntries(firstMile.routes?.map((route) => [`${route.originCity}->${route.destinationCity}`, route.rubPerPallet]) ?? []);
  assert.deepEqual(
    {
      "Москва": rateByCity["Москва"],
      "Краснодар": rateByCity["Краснодар"],
      "Казань": rateByCity["Казань"],
      "Хабаровск": rateByCity["Хабаровск"]
    },
    {
      "Москва": 1675,
      "Краснодар": 15472,
      "Казань": 13582,
      "Хабаровск": 34624
    }
  );
  assert.equal(routeByKey["Москва->Москва"], 1675);
  assert.equal(routeByKey["Воронеж->Москва"], 9997);
  assert.equal(routeByKey["Воронеж->Казань"], 14092);

  const result = calculateAllSchemes(skus[0], settings, tariffs);
  assert.equal(
    result.wildberries.fbo.breakdown.find((item) => item.key === "firstMile")?.amountRub,
    333.23
  );

  const moscowToMoscowRoute = calculateAllSchemes(skus[0], { ...settings, originCity: "Москва", firstMileCity: "Москва" }, tariffs);
  assert.equal(
    moscowToMoscowRoute.wildberries.fbo.breakdown.find((item) => item.key === "firstMile")?.amountRub,
    55.83
  );
});

test("route city suggestions are generated from the PEK Google Sheet", () => {
  assert.equal(routeCities.originCitiesSource, "Калькулятор!C2 data validation -> Лист3!A3:A243");
  assert.equal(routeCities.originCities.length, 241);
  assert.ok(routeCities.originCities.includes("Воронеж"));
  assert.ok(routeCities.originCities.includes("Москва"));
  assert.deepEqual(routeCities.destinationCities, [
    "Москва",
    "Краснодар",
    "Казань",
    "Красноярск",
    "Самара",
    "Нижний Новгород",
    "Санкт-Петербург",
    "Екатеринбург",
    "Новосибирск",
    "Уссурийск",
    "Хабаровск"
  ]);
});

test("warehouse operations use selected DOCX tariff rows", () => {
  const selected = tariffs.warehouse.selected;

  assert.equal(tariffs.warehouse.selectedMapping?.receivingPallet, "Механизированная выгрузка/отгрузка паллеты");
  assert.equal(selected.receivingPallet, 222.3);
  assert.equal(selected.storagePalletHeight180, 35.82);
  assert.equal(selected.outboundUpTo5Kg, 16.65);
  assert.equal(selected.outbound5To10Kg, 18.45);
  assert.equal(selected.outbound10To25Kg, 29.25);
  assert.equal(selected.outbound25To50Kg, 60.03);
  assert.equal(selected.labeling, 8.73);
});

test("warehouse operations are calculated per item from DOCX rates and actual weight", () => {
  const result = calculateAllSchemes(skus[0], settings, tariffs).wildberries.fbs;
  const part = (key: string) => result.breakdown.find((item) => item.key === key)?.amountRub;
  const metrics = calculateSkuMetrics(skus[0]);

  assert.equal(skus[0].weightKg, 3.9);
  assert.equal(metrics.volumetricWeightKg, 8.3888);

  assert.equal(part("pimReceiving"), 7.41);
  assert.equal(part("pimStorage"), 35.82);
  assert.equal(part("pimFulfillment"), 16.65);
  assert.equal(part("pimLabeling"), 8.73);
  assert.equal(part("pimShipping"), 13.14);
});

test("middle mile uses current DOCX tier interpretation by SKU liters", () => {
  const middleMileForLiters = (liters: number) => {
    const sku: SkuInput = {
      ...skus[0],
      id: `liters-${liters}`,
      lengthCm: liters,
      widthCm: 10,
      heightCm: 100
    };
    const result = calculateAllSchemes(sku, settings, tariffs).wildberries.fbs;
    return result.breakdown.find((item) => item.key === "middleMile")?.amountRub;
  };

  assert.equal(tariffs.middleMile.tiers[0].name, "Доставка до 1 литра");
  assert.equal(tariffs.middleMile.tiers[0].priceRub, 17.39);
  assert.equal(middleMileForLiters(1), 17.39);
  assert.equal(middleMileForLiters(190), 552.26);
  assert.equal(middleMileForLiters(191), 555.52);
  assert.equal(middleMileForLiters(350), 1073.86);
  assert.equal(middleMileForLiters(351), 2826.09);
  assert.equal(middleMileForLiters(1001), 5434.78);
});

test("PIM last mile uses selected first mile city, zone and chargeable weight", () => {
  const cityResult = calculateAllSchemes(skus[0], { ...settings, firstMileCity: "Москва", lastMileZone: "city" }, tariffs).wildberries.dbs;
  const regionResult = calculateAllSchemes(skus[0], { ...settings, firstMileCity: "Москва", lastMileZone: "region" }, tariffs).wildberries.dbs;
  const missingResult = calculateAllSchemes(skus[0], { ...settings, firstMileCity: "Хабаровск", lastMileZone: "region" }, tariffs).wildberries.dbs;
  const part = (result: typeof cityResult, key: string) => result.breakdown.find((item) => item.key === key)?.amountRub;

  assert.equal(tariffs.logistics.pimLastMile.weightRule, "chargeableKg = max(actualKg, volumetricKg)");
  assert.equal(part(cityResult, "lastMile"), 434.37);
  assert.equal(part(regionResult, "lastMile"), 650.15);
  assert.equal(missingResult.isComplete, false);
  assert.ok(missingResult.warnings.some((warning) => warning.includes("Не найден тариф последней мили")));
});

test("VAT display mode keeps marketplace gross tariffs and adds VAT to PIM tariffs", () => {
  const withoutVat = calculateAllSchemes(skus[0], settings, tariffs).wildberries.fbs;
  const withVat = calculateAllSchemes(skus[0], { ...settings, vatDisplayMode: "with_vat" }, tariffs).wildberries.fbs;
  const part = (result: typeof withoutVat, key: string) => result.breakdown.find((item) => item.key === key);

  assert.equal(withoutVat.vatDisplayMode, "without_vat");
  assert.equal(withVat.vatDisplayMode, "with_vat");
  assert.equal(withoutVat.priceBasisRub, 3319.67);
  assert.equal(withVat.priceBasisRub, 4050);

  assert.equal(part(withoutVat, "commission")?.amountRub, 995.9);
  assert.equal(part(withVat, "commission")?.amountRub, 1215);
  assert.equal(part(withoutVat, "commission")?.label, "Комиссия маркетплейса 30%");
  assert.equal(part(withoutVat, "commission")?.vatNote, "без НДС");
  assert.equal(part(withVat, "commission")?.vatNote, "с НДС");

  assert.equal(part(withoutVat, "pimStorage")?.amountRub, 35.82);
  assert.equal(part(withVat, "pimStorage")?.amountRub, 43.7);
  assert.equal(part(withoutVat, "pimStorage")?.vatNote, "без НДС");
  assert.equal(part(withVat, "pimStorage")?.vatNote, "с НДС");
  assert.ok(withoutVat.breakdown.every((item) => item.vatNote === "без НДС"));
  assert.ok(withVat.breakdown.every((item) => item.vatNote === "с НДС"));
});

test("PIM commercial markups apply before VAT and stay hidden in client mode", () => {
  const markedSettings: CalculatorSettings = {
    ...settings,
    firstMileMarkupPercent: 10,
    warehouseMarkupPercent: 20,
    warehouseOperationMarkupPercents: {
      receiving: 20,
      storage: 20,
      fulfillment: 20,
      shipping: 20
    },
    middleMileFirstLiterMarkupPercent: 30,
    middleMileAdditionalLiterMarkupPercent: 30,
    middleMileOver190LiterMarkupPercent: 0,
    middleMileFrom351To1000MarkupPercent: 0,
    middleMileFrom1001MarkupPercent: 0,
    lastMileBaseMarkupPercent: 40,
    lastMileAdditionalKgMarkupPercent: 40
  };
  const fbs = calculateAllSchemes(skus[0], markedSettings, tariffs).wildberries.fbs;
  const dbs = calculateAllSchemes(skus[0], markedSettings, tariffs).wildberries.dbs;
  const withVat = calculateAllSchemes(skus[0], { ...markedSettings, vatDisplayMode: "with_vat" }, tariffs).wildberries.dbs;
  const internal = calculateAllSchemes(skus[0], { ...markedSettings, presentationMode: "internal" }, tariffs).wildberries.dbs;
  const part = (result: typeof fbs, key: string) => result.breakdown.find((item) => item.key === key);

  assert.equal(part(fbs, "firstMile")?.amountRub, 366.56);
  assert.equal(part(fbs, "pimReceiving")?.amountRub, 8.89);
  assert.equal(part(fbs, "pimStorage")?.amountRub, 42.98);
  assert.equal(part(fbs, "pimFulfillment")?.amountRub, 19.98);
  assert.equal(part(fbs, "pimLabeling")?.amountRub, 10.48);
  assert.equal(part(fbs, "middleMile")?.amountRub, 173.24);
  assert.equal(part(dbs, "lastMile")?.amountRub, 608.12);
  assert.equal(part(withVat, "lastMile")?.amountRub, 741.91);
  assert.equal(part(fbs, "commission")?.amountRub, 995.9);
  assert.equal(part(fbs, "firstMile")?.internalNote, undefined);
  assert.equal(part(fbs, "firstMile")?.pimProfitCenter, "firstMile");
  assert.equal(part(fbs, "firstMile")?.pimProfitWithoutVatRub, 33.32);
  assert.equal(part(fbs, "firstMile")?.pimProfitWithVatRub, 40.65);
  assert.equal(part(fbs, "pimReceiving")?.pimProfitCenter, "warehouse");
  assert.equal(part(fbs, "pimReceiving")?.pimProfitWithoutVatRub, 1.48);
  assert.equal(part(fbs, "pimReceiving")?.pimProfitWithVatRub, 1.81);
  assert.equal(part(fbs, "middleMile")?.pimProfitCenter, "middleMile");
  assert.equal(part(fbs, "middleMile")?.pimProfitWithoutVatRub, 39.98);
  assert.equal(part(fbs, "middleMile")?.pimProfitWithVatRub, 48.77);
  assert.equal(part(dbs, "lastMile")?.pimProfitCenter, "lastMile");
  assert.equal(part(dbs, "lastMile")?.pimProfitWithoutVatRub, 173.75);
  assert.equal(part(dbs, "lastMile")?.pimProfitWithVatRub, 211.97);
  assert.ok(part(internal, "firstMile")?.internalNote?.includes("наценка 10%"));
  assert.ok(part(internal, "lastMile")?.internalNote?.includes("до 3 кг 40%"));
  assert.ok(part(internal, "lastMile")?.internalNote?.includes("сверх 3 кг 40%"));
});

test("warehouse operation groups control included costs and group markups", () => {
  const customSettings: CalculatorSettings = {
    ...settings,
    warehouseOperationGroups: {
      receiving: false,
      storage: true,
      fulfillment: true,
      shipping: true
    },
    warehouseOperationMarkupPercents: {
      receiving: 20,
      storage: 50,
      fulfillment: 10,
      shipping: 0
    },
  };
  const fbs = calculateAllSchemes(skus[0], customSettings, tariffs).wildberries.fbs;
  const part = (key: string) => fbs.breakdown.find((item) => item.key === key);

  assert.equal(part("pimReceiving"), undefined);
  assert.equal(part("pimStorage")?.amountRub, 53.73);
  assert.equal(part("pimStorage")?.pimProfitWithoutVatRub, 17.91);
  assert.equal(part("pimFulfillment")?.amountRub, 18.31);
  assert.equal(part("pimFulfillment")?.pimProfitWithoutVatRub, 1.67);
  assert.equal(part("pimLabeling")?.amountRub, 9.6);
  assert.equal(part("pimLabeling")?.pimProfitWithoutVatRub, 0.87);
});

test("warehouse receiving switches between pallet and box supply types", () => {
  const receivingPart = (warehouseSupplyType: CalculatorSettings["warehouseSupplyType"]) =>
    calculateAllSchemes(skus[0], { ...settings, warehouseSupplyType }, tariffs).wildberries.fbs.breakdown.find((item) => item.key === "pimReceiving");

  const monoPallet = receivingPart("mono_pallet");
  const mixPallet = receivingPart("mix_pallet");
  const boxes = receivingPart("boxes");
  const legacyBox = calculateAllSchemes(skus[0], { ...settings, warehouseSupplyType: "box" as CalculatorSettings["warehouseSupplyType"] }, tariffs).wildberries.fbs.breakdown;

  assert.equal(monoPallet?.amountRub, 7.41);
  assert.equal(monoPallet?.label, "Приёмка на склад PIM.Seller (монопаллета)");
  assert.equal(mixPallet?.amountRub, 7.41);
  assert.ok(mixPallet?.calculationNote?.includes("считается по тому же принципу, что и монопаллета"));
  assert.equal(boxes?.amountRub, 13.14);
  assert.equal(boxes?.label, "Приёмка на склад PIM.Seller (короба)");
  assert.ok(boxes?.calculationNote?.includes("Ручная выгрузка до 5 кг"));
  assert.equal(legacyBox.find((item) => item.key === "pimReceiving")?.amountRub, boxes?.amountRub);
  assert.equal(legacyBox.find((item) => item.key === "pimReceiving")?.label, boxes?.label);
});

test("warehouse storage switches between pallet and liter storage by supply type", () => {
  const fbsPart = (warehouseSupplyType: CalculatorSettings["warehouseSupplyType"], key: string) =>
    calculateAllSchemes(skus[0], { ...settings, warehouseSupplyType }, tariffs).wildberries.fbs.breakdown.find((item) => item.key === key);

  const monoStorage = fbsPart("mono_pallet", "pimStorage");
  const mixSorting = fbsPart("mix_pallet", "pimStorageSorting");
  const mixStorage = fbsPart("mix_pallet", "pimStorage");
  const boxSorting = fbsPart("boxes", "pimStorageSorting");
  const boxStorage = fbsPart("boxes", "pimStorage");

  assert.equal(monoStorage?.amountRub, 35.82);
  assert.equal(monoStorage?.label, "Хранение PIM.Seller (паллеты)");
  assert.equal(monoStorage?.calculationNote, "35,82 ₽/паллетоместо/сутки × 30 дн. / 30 SKU.");

  assert.equal(mixSorting?.amountRub, 18.45);
  assert.equal(mixSorting?.label, "Сортировка по артикулам PIM.Seller");
  assert.ok(mixSorting?.calculationNote?.includes("перед литровым хранением"));
  assert.equal(mixStorage?.amountRub, 88.08);
  assert.equal(mixStorage?.label, "Хранение PIM.Seller (литры)");
  assert.equal(mixStorage?.calculationNote, "41,94 л × 30 дн. × 0,07 ₽/л/сутки.");

  assert.equal(boxSorting?.amountRub, 18.45);
  assert.equal(boxStorage?.amountRub, 88.08);
});

test("warehouse storage uses per-operation row markups", () => {
  const part = (warehouseSupplyType: CalculatorSettings["warehouseSupplyType"], key: string) =>
    calculateAllSchemes(
      skus[0],
      {
        ...settings,
        warehouseSupplyType,
        warehouseOperationMarkupPercents: {
          ...settings.warehouseOperationMarkupPercents,
          storage: 0
        },
        warehouseOperationRowMarkupPercents: {
          "Хранение EUR паллет (800х1200 вес до 1000 кг), высота до 1,8 м": 20,
          "Сортировка по артикулам до 5 кг": 20,
          "Хранение товара": 30
        }
      },
      tariffs
    ).wildberries.fbs.breakdown.find((item) => item.key === key);

  const monoStorage = part("mono_pallet", "pimStorage");
  const mixSorting = part("mix_pallet", "pimStorageSorting");
  const mixStorage = part("mix_pallet", "pimStorage");

  assert.equal(monoStorage?.amountRub, 42.98);
  assert.equal(monoStorage?.pimProfitWithoutVatRub, 7.16);
  assert.ok(monoStorage?.internalNote === undefined);

  assert.equal(mixSorting?.amountRub, 22.14);
  assert.equal(mixSorting?.pimProfitWithoutVatRub, 3.69);
  assert.equal(mixStorage?.amountRub, 114.51);
  assert.equal(mixStorage?.pimProfitWithoutVatRub, 26.42);
});

test("warehouse fulfillment extras are optional and included only after selection", () => {
  const defaultFbs = calculateAllSchemes(skus[0], settings, tariffs).wildberries.fbs;
  assert.equal(defaultFbs.breakdown.find((item) => item.key.startsWith("pimFulfillmentExtra:")), undefined);

  const selectedFbs = calculateAllSchemes(
    skus[0],
    {
      ...settings,
      warehouseFulfillmentExtraOperations: {
        "Упаковка в пакет с клеевым клапаном::17.97": true,
        "Сканирование ЧЗ::4.95": true
      }
    },
    tariffs
  ).wildberries.fbs;

  const valveBag = selectedFbs.breakdown.find((item) => item.key === "pimFulfillmentExtra:Упаковка в пакет с клеевым клапаном::17.97");
  const honestSignScan = selectedFbs.breakdown.find((item) => item.key === "pimFulfillmentExtra:Сканирование ЧЗ::4.95");

  assert.equal(valveBag?.amountRub, 17.97);
  assert.equal(valveBag?.label, "Упаковка в пакет с клапаном");
  assert.equal(honestSignScan?.amountRub, 4.95);
});

test("volume-banded fulfillment extras apply only to matching SKU volumes", () => {
  const smallBubbleWrapKey = "Упаковка в пузырчатую пленку объем < 2 литров::29.7";
  const largeBubbleWrapKey = "Упаковка в пузырчатую пленку, объем > 2-х литров < 5 литров::35.55";
  const smallShrinkWrapKey = "Упаковка в термоусадочную пленку объем < 2 литров::17.97";
  const largeShrinkWrapKey = "Упаковка в термоусадочную пленку, объем > 2-х литров < 5 литров::23.37";
  const largeFbs = calculateAllSchemes(
    skus[0],
    {
      ...settings,
      warehouseFulfillmentExtraOperations: {
        [smallBubbleWrapKey]: true,
        [largeBubbleWrapKey]: true,
        [smallShrinkWrapKey]: true,
        [largeShrinkWrapKey]: true
      }
    },
    tariffs
  ).wildberries.fbs;
  const smallSku: SkuInput = {
    ...skus[0],
    id: "small-bubble-wrap",
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    weightKg: 0.5
  };
  const smallFbs = calculateAllSchemes(
    smallSku,
    {
      ...settings,
      warehouseFulfillmentExtraOperations: {
        [smallBubbleWrapKey]: true,
        [largeBubbleWrapKey]: true,
        [smallShrinkWrapKey]: true,
        [largeShrinkWrapKey]: true
      }
    },
    tariffs
  ).wildberries.fbs;

  assert.equal(largeFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${smallBubbleWrapKey}`), undefined);
  assert.equal(largeFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${smallShrinkWrapKey}`), undefined);
  assert.equal(largeFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${largeBubbleWrapKey}`)?.amountRub, 35.55);
  assert.equal(largeFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${largeShrinkWrapKey}`)?.amountRub, 23.37);
  assert.equal(smallFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${smallBubbleWrapKey}`)?.amountRub, 29.7);
  assert.equal(smallFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${smallShrinkWrapKey}`)?.amountRub, 17.97);
  assert.equal(smallFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${largeBubbleWrapKey}`), undefined);
  assert.equal(smallFbs.breakdown.find((item) => item.key === `pimFulfillmentExtra:${largeShrinkWrapKey}`), undefined);
});

test("warehouse receiving markup can be set per visible operation row", () => {
  const boxes = calculateAllSchemes(
    skus[0],
    {
      ...settings,
      warehouseSupplyType: "boxes",
      warehouseOperationMarkupPercents: {
        ...settings.warehouseOperationMarkupPercents,
        receiving: 0
      },
      warehouseOperationRowMarkupPercents: {
        ...settings.warehouseOperationRowMarkupPercents,
        "Ручная выгрузка/отгрузка до 5 кг": 50
      }
    },
    tariffs
  ).wildberries.fbs.breakdown.find((item) => item.key === "pimReceiving");

  assert.equal(boxes?.pimCostWithoutVatRub, 13.14);
  assert.equal(boxes?.amountRub, 19.71);
  assert.equal(boxes?.pimProfitWithoutVatRub, 6.57);
});

test("middle mile markups split by volume tiers", () => {
  const markedSettings: CalculatorSettings = {
    ...settings,
    middleMileFirstLiterMarkupPercent: 10,
    middleMileAdditionalLiterMarkupPercent: 20,
    middleMileOver190LiterMarkupPercent: 30,
    middleMileFrom351To1000MarkupPercent: 40,
    middleMileFrom1001MarkupPercent: 50
  };
  const skuForLiters = (liters: number): SkuInput => ({
    ...skus[0],
    id: `liters-${liters}`,
    lengthCm: liters,
    widthCm: 10,
    heightCm: 100
  });
  const middleMilePart = (sku: SkuInput) =>
    calculateAllSchemes(sku, markedSettings, tariffs).wildberries.fbs.breakdown.find((item) => item.key === "middleMile");

  const to350 = middleMilePart(skuForLiters(200));
  assert.equal(to350?.pimMiddleMileFirstLiterCostWithoutVatRub, 17.39);
  assert.equal(to350?.pimMiddleMileAdditionalTo190CostWithoutVatRub, 534.87);
  assert.equal(to350?.pimMiddleMileAdditional191To350CostWithoutVatRub, 32.6);
  assert.equal(to350?.amountRub, 703.35);
  assert.equal(to350?.pimProfitWithoutVatRub, 118.49);

  const fixed351 = middleMilePart(skuForLiters(500));
  assert.equal(fixed351?.pimMiddleMileFirstLiterCostWithoutVatRub, 0);
  assert.equal(fixed351?.pimMiddleMileFixed351To1000CostWithoutVatRub, 2826.09);
  assert.equal(fixed351?.amountRub, 3956.53);
  assert.equal(fixed351?.pimProfitWithoutVatRub, 1130.44);

  const fixed1001 = middleMilePart(skuForLiters(1200));
  assert.equal(fixed1001?.pimMiddleMileFixedFrom1001CostWithoutVatRub, 5434.78);
  assert.equal(fixed1001?.amountRub, 8152.17);
  assert.equal(fixed1001?.pimProfitWithoutVatRub, 2717.39);
});

test("fast handover discounts apply only to FBS with marketplace-specific rules", () => {
  const withoutDiscount = calculateAllSchemes(skus[0], settings, tariffs);
  const withDiscount = calculateAllSchemes(skus[0], { ...settings, fastHandover: true }, tariffs);
  const ozonTwoPercent = calculateAllSchemes(
    skus[0],
    { ...settings, fastHandover: true, ozonFastHandoverType: "pvz_ppz_recommended_slot" },
    tariffs
  );
  const part = (result: typeof withDiscount.wildberries.fbs, key: string) => result.breakdown.find((item) => item.key === key);

  assert.equal(part(withoutDiscount.wildberries.fbo, "commission")?.label, "Комиссия маркетплейса 17%");
  assert.equal(part(withDiscount.wildberries.fbo, "commission")?.label, "Комиссия маркетплейса 17%");
  assert.equal(part(withDiscount.wildberries.fbs, "commission")?.label, "Комиссия маркетплейса 28.5% (30%-1.5%)");
  assert.equal(part(withDiscount.wildberries.fbs, "commission")?.amountRub, 946.11);
  assert.match(part(withDiscount.wildberries.fbs, "commission")?.calculationNote ?? "", /Снижение 1\.5% применяется за Быструю сдачу/);
  assert.equal(part(withDiscount.wildberries.dbs, "commission")?.label, "Комиссия маркетплейса 25%");
  assert.equal(part(withDiscount.wildberries.dbs, "fastHandoverDiscount"), undefined);

  assert.equal(part(withDiscount.ozon.fbo, "commission")?.label, "Комиссия маркетплейса 44%");
  assert.equal(part(withDiscount.ozon.fbs, "commission")?.label, "Комиссия маркетплейса 45% (48%-3%)");
  assert.equal(part(withDiscount.ozon.fbs, "commission")?.amountRub, 1493.85);
  assert.match(part(withDiscount.ozon.fbs, "commission")?.calculationNote ?? "", /Снижение 3% применяется за Быструю сдачу/);
  assert.equal(part(ozonTwoPercent.ozon.fbs, "commission")?.label, "Комиссия маркетплейса 46% (48%-2%)");
  assert.equal(part(ozonTwoPercent.ozon.fbs, "commission")?.amountRub, 1527.05);
  assert.equal(part(withDiscount.ozon.dbs, "commission")?.label, "Комиссия маркетплейса 48%");
  assert.equal(part(withDiscount.ozon.dbs, "fastHandoverDiscount"), undefined);
});

test("dimension warnings are non-blocking and WB SGT does not receive fast handover discount", () => {
  const sgtSku: SkuInput = {
    ...skus[0],
    id: "sgt",
    name: "СГТ товар",
    weightKg: 25,
    lengthCm: 90,
    widthCm: 90,
    heightCm: 20
  };
  const kgtPlusSku: SkuInput = {
    ...skus[0],
    id: "kgt-plus",
    name: "КГТ+ товар",
    weightKg: 2,
    lengthCm: 150,
    widthCm: 5,
    heightCm: 5
  };
  const standardSku: SkuInput = {
    ...skus[0],
    id: "standard",
    name: "МГТ товар",
    weightKg: 12,
    lengthCm: 50,
    widthCm: 40,
    heightCm: 30
  };
  const sgt = calculateAllSchemes(sgtSku, { ...settings, fastHandover: true }, tariffs);
  const kgtPlus = calculateAllSchemes(kgtPlusSku, { ...settings, fastHandover: true }, tariffs);
  const standard = calculateAllSchemes(standardSku, settings, tariffs);
  const commission = sgt.wildberries.fbs.breakdown.find((item) => item.key === "commission");

  assert.equal(sgt.wildberries.fbs.isComplete, true);
  assert.equal(commission?.label, "Комиссия маркетплейса 30%");
  assert.equal(commission?.amountRub, 995.9);
  assert.ok(sgt.wildberries.fbs.warnings.some((warning) => warning.includes("WB СГТ")));
  assert.ok(sgt.wildberries.fbs.warnings.some((warning) => warning.includes("скидка за быструю сдачу не применяется")));
  assert.deepEqual(sgt.ozon.fbs.warnings.filter((warning) => warning.includes("Ozon КГТ")), []);
  assert.equal(kgtPlus.wildberries.fbs.isComplete, true);
  assert.equal(
    kgtPlus.wildberries.fbs.breakdown.find((item) => item.key === "commission")?.label,
    "Комиссия маркетплейса 28.5% (30%-1.5%)"
  );
  assert.ok(kgtPlus.wildberries.fbs.warnings.some((warning) => warning.includes("WB КГТ+")));
  assert.deepEqual(kgtPlus.ozon.fbs.warnings.filter((warning) => warning.includes("Ozon КГТ")), []);
  assert.deepEqual(standard.wildberries.fbs.warnings.filter((warning) => warning.startsWith("Предупреждение:")), []);
  assert.deepEqual(standard.ozon.fbs.warnings.filter((warning) => warning.startsWith("Предупреждение:")), []);
});

test("Ozon KGT FBO/FBS delivery uses the same tariff matrix as standard goods", () => {
  const kgtSku: SkuInput = {
    ...skus[0],
    id: "ozon-kgt",
    name: "Ozon КГТ",
    weightKg: 2,
    lengthCm: 150,
    widthCm: 5,
    heightCm: 5
  };
  const result = calculateAllSchemes(kgtSku, settings, tariffs);

  assert.equal(classifySkuDimensions(kgtSku).ozon, "kgt");
  assert.ok(result.ozon.fbo.isComplete);
  assert.ok(result.ozon.fbs.isComplete);
  assert.ok(result.ozon.dbs.isComplete);
  assert.deepEqual(result.ozon.fbo.warnings.filter((warning) => warning.includes("Ozon КГТ")), []);
  assert.deepEqual(result.ozon.fbs.warnings.filter((warning) => warning.includes("Ozon КГТ")), []);
  assert.equal(result.ozon.fbo.breakdown.find((item) => item.key === "ozonFboLogisticsTariff")?.amountRub, 72.13);
  assert.equal(result.ozon.fbs.breakdown.find((item) => item.key === "ozonFbsLogistics")?.amountRub, 72.13);
  assert.ok(
    result.ozon.dbs.warnings.some(
      (warning) => warning.includes("Ozon КГТ DBS/RFBS") && warning.includes("доставка PIM.Seller считается по расчётному весу")
    )
  );
});

test("Wildberries marketplace logistics use the official WB API tariff model", () => {
  const result = calculateAllSchemes(skus[0], settings, tariffs);
  const fboPart = (key: string) => result.wildberries.fbo.breakdown.find((item) => item.key === key)?.amountRub;
  const fbsPart = (key: string) => result.wildberries.fbs.breakdown.find((item) => item.key === key)?.amountRub;
  const dbsKeys = result.wildberries.dbs.breakdown.map((item) => item.key);
  const wbLogistics = tariffs.logistics.wildberriesLogistics;

  assert.equal(wbLogistics.status, "official WB API import");
  assert.match(wbLogistics.calculationDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(wbLogistics.importedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(wbLogistics.firstLiterRub > 0);
  assert.ok(wbLogistics.extraLiterRub > 0);
  assert.ok(wbLogistics.storagePalletDayRub > 0);
  assert.ok(fboPart("wbLastMile")! > 0);
  assert.ok(fboPart("wbAcceptance")! >= 0);
  assert.ok(fboPart("wbStorage")! > 0);
  assert.ok(fbsPart("wbFbsLastMile")! > 0);
  assert.equal(result.wildberries.fbo.isComplete, true);
  assert.ok(result.wildberries.fbo.totalRub > 0);
  assert.equal(dbsKeys.includes("wbLastMile"), false);
  assert.equal(dbsKeys.includes("wbFbsLastMile"), false);
  assert.equal(dbsKeys.includes("wbStorage"), false);
});

test("Wildberries FBS logistics uses marketplace row for selected warehouse federal district", () => {
  const result = calculateAllSchemes(skus[0], settings, tariffs);
  const fbsPart = (key: string) => result.wildberries.fbs.breakdown.find((item) => item.key === key)?.amountRub;
  const warehouse = tariffs.logistics.wildberriesLogistics.warehouses.find((item) => item.name === "Коледино");
  const marketplace = tariffs.logistics.wildberriesLogistics.warehouses.find((item) => item.name === `Маркетплейс: ${warehouse?.geoName}`);

  assert.equal(warehouse?.geoName, "Центральный федеральный округ");
  assert.equal(marketplace?.box?.marketplaceDeliveryCoefPercent, 165);
  assert.equal(marketplace?.box?.marketplaceDeliveryBaseRub, 75.9);
  assert.equal(marketplace?.box?.marketplaceDeliveryAdditionalLiterRub, 23.1);
  assert.equal(fbsPart("wbFbsLastMile"), 837.46);
});

test("Wildberries FBS SGT logistics uses marketplace SGT row for selected warehouse federal district", () => {
  const sgtSku: SkuInput = {
    ...skus[0],
    id: "sgt-fbs",
    name: "СГТ FBS",
    weightKg: 25,
    lengthCm: 90,
    widthCm: 90,
    heightCm: 20
  };
  const result = calculateAllSchemes(sgtSku, settings, tariffs);
  const logisticsPart = result.wildberries.fbs.breakdown.find((item) => item.key === "wbFbsLastMile");
  const warehouse = tariffs.logistics.wildberriesLogistics.warehouses.find((item) => item.name === "Коледино");
  const marketplace = tariffs.logistics.wildberriesLogistics.warehouses.find((item) => item.name === `Маркетплейс: ${warehouse?.geoName} СГТ`);

  assert.equal(classifySkuDimensions(sgtSku).wildberries, "sgt");
  assert.equal(warehouse?.geoName, "Центральный федеральный округ");
  assert.equal(marketplace?.box?.marketplaceDeliveryCoefPercent, 75);
  assert.equal(marketplace?.box?.marketplaceDeliveryBaseRub, 34.5);
  assert.equal(marketplace?.box?.marketplaceDeliveryAdditionalLiterRub, 10.5);
  assert.equal(logisticsPart?.label, "Логистика WB FBS СГТ");
  assert.equal(logisticsPart?.amountRub, 1413.93);
  assert.ok(!result.wildberries.fbs.warnings.some((warning) => warning.includes("не найдена СГТ-строка тарифа")));
});

test("Wildberries FBO monopallet storage uses acceptance storage tariff", () => {
  const result = calculateAllSchemes(skus[0], { ...settings, wbSupplyType: "pallet" }, tariffs);
  const fboPart = (key: string) => result.wildberries.fbo.breakdown.find((item) => item.key === key)?.amountRub;
  const warehouse = tariffs.logistics.wildberriesLogistics.warehouses.find((item) => item.name === "Коледино");

  assert.equal(warehouse?.acceptance?.pallet?.deliveryCoefPercent, 200);
  assert.equal(warehouse?.acceptance?.pallet?.storageBaseLiterRub, 53.75);
  assert.equal(fboPart("wbLastMile"), 1015.11);
  assert.equal(fboPart("wbStorage"), 44.06);
});

test("Ozon marketplace logistics use the current FBO/FBS tariff matrix", () => {
  const result = calculateAllSchemes(skus[0], settings, tariffs);
  const fboPart = (key: string) => result.ozon.fbo.breakdown.find((item) => item.key === key)?.amountRub;
  const fbsPart = (key: string) => result.ozon.fbs.breakdown.find((item) => item.key === key)?.amountRub;
  const dbsKeys = result.ozon.dbs.breakdown.map((item) => item.key);
  const nonlocal = calculateAllSchemes(
    skus[0],
    { ...settings, ozonDeliveryMode: "cluster", ozonDeliveryCluster: "Казань" },
    tariffs
  );
  const nonlocalFbo = nonlocal.ozon.fbo;
  const nonlocalFbs = nonlocal.ozon.fbs;
  const nonlocalFboPart = (key: string) => nonlocalFbo.breakdown.find((item) => item.key === key)?.amountRub;
  const nonlocalFbsPart = (key: string) => nonlocalFbs.breakdown.find((item) => item.key === key)?.amountRub;

  assert.equal(tariffs.logistics.ozonLogistics.status, "business confirmed Ozon FBO/FBS logistics source");
  assert.equal(tariffs.logistics.ozonLogistics.cityToCluster["Москва"], "Москва, МО и Дальние регионы");
  assert.ok(tariffs.logistics.ozonLogistics.deliveryClusters.includes("Казань"));
  assert.equal(tariffs.logistics.ozonLogistics.pickupPointRub, 25);
  assert.equal(tariffs.logistics.ozonLogistics.fbsAcceptanceRub, 20);
  assert.equal(tariffs.logistics.ozonLogistics.storageFreeDaysSource, "Озон_Сроки_бесплатного_размещения_010626_1778767885.xlsx");
  assert.equal(tariffs.logistics.ozonLogistics.storageRates?.standardRubPerLiterDay, 2.5);
  assert.equal(tariffs.logistics.ozonLogistics.storageRates?.kgtRubPerLiterDay, 0.1);
  assert.equal(fboPart("ozonFboLogisticsTariff"), 202.46);
  assert.equal(fboPart("ozonFboNonlocalMarkup"), 0);
  assert.equal(fboPart("ozonFboStorage"), 0);
  assert.equal(fboPart("ozonPickupPoint"), 20.49);
  assert.equal(fbsPart("ozonFbsAcceptance"), 16.39);
  assert.equal(fbsPart("ozonFbsLogistics"), 202.46);
  assert.equal(fbsPart("ozonFbsNonlocalMarkup"), undefined);
  assert.equal(fbsPart("ozonFboStorage"), undefined);
  assert.equal(fbsPart("ozonPickupPoint"), 20.49);
  assert.equal(nonlocalFboPart("ozonFboLogisticsTariff"), 313.11);
  assert.equal(nonlocalFboPart("ozonFboNonlocalMarkup"), 265.57);
  assert.equal(nonlocalFbsPart("ozonFbsLogistics"), 313.11);
  assert.equal(nonlocalFbsPart("ozonFbsNonlocalMarkup"), undefined);
  assert.deepEqual(nonlocalFbo.warnings, []);
  assert.deepEqual(nonlocalFbs.warnings, []);
  assert.equal(dbsKeys.includes("ozonFboLogisticsTariff"), false);
  assert.equal(dbsKeys.includes("ozonFbsLogistics"), false);
  assert.equal(dbsKeys.includes("ozonFboStorage"), false);
  assert.equal(dbsKeys.includes("ozonPickupPoint"), false);
});

test("Ozon FBO storage uses free placement days by product type and Ozon dimension class", () => {
  const result = calculateAllSchemes(skus[2], { ...settings, storageDays: 60 }, tariffs);
  const storage = result.ozon.fbo.breakdown.find((item) => item.key === "ozonFboStorage");
  const fbsStorage = result.ozon.fbs.breakdown.find((item) => item.key === "ozonFboStorage");
  const dbsStorage = result.ozon.dbs.breakdown.find((item) => item.key === "ozonFboStorage");
  const tableFreeDays = tariffs.logistics.ozonLogistics.storageFreeDays?.find(
    (item) => item.category === "Столы" && item.productType === "Стол обеденный"
  );

  assert.equal(classifySkuDimensions(skus[2]).ozon, "kgt");
  assert.equal(tableFreeDays?.standardDays, 120);
  assert.equal(tableFreeDays?.kgtDays, 30);
  assert.equal(storage?.label, "Хранение Ozon FBO (30 дн. бесплатно)");
  assert.equal(storage?.amountWithVatRub, 363.83);
  assert.equal(storage?.amountWithoutVatRub, 298.22);
  assert.equal(storage?.amountRub, 298.22);
  assert.equal(fbsStorage, undefined);
  assert.equal(dbsStorage, undefined);
});

test("Ozon marketplace tariffs are treated as VAT-inclusive source amounts", () => {
  const result = calculateAllSchemes(
    skus[2],
    { ...settings, ozonDeliveryMode: "cluster", ozonDeliveryCluster: "Казань", storageDays: 60 },
    tariffs
  ).ozon;
  const fboPart = (key: string) => result.fbo.breakdown.find((item) => item.key === key);
  const fbsPart = (key: string) => result.fbs.breakdown.find((item) => item.key === key);
  const dbsPart = (key: string) => result.dbs.breakdown.find((item) => item.key === key);
  const ozonMarketplaceItems = [result.fbo, result.fbs, result.dbs].flatMap((scheme) =>
    scheme.breakdown.filter((item) => item.source === "marketplace")
  );

  assert.ok(ozonMarketplaceItems.every((item) => item.vatMode === "with_vat"));
  assert.ok(ozonMarketplaceItems.every((item) => item.vatNote === "без НДС"));
  assert.equal(fboPart("commission")?.amountWithVatRub, 5365);
  assert.equal(fboPart("commission")?.amountRub, 4397.54);
  assert.equal(fboPart("ozonFboLogisticsTariff")?.amountWithVatRub, 857);
  assert.equal(fboPart("ozonFboLogisticsTariff")?.amountRub, 702.46);
  assert.equal(fboPart("ozonFboNonlocalMarkup")?.amountWithVatRub, 1160);
  assert.equal(fboPart("ozonFboNonlocalMarkup")?.amountRub, 950.82);
  assert.equal(fboPart("ozonFboStorage")?.amountWithVatRub, 363.83);
  assert.equal(fboPart("ozonFboStorage")?.amountRub, 298.22);
  assert.equal(fboPart("ozonPickupPoint")?.amountWithVatRub, 25);
  assert.equal(fboPart("ozonPickupPoint")?.amountRub, 20.49);
  assert.equal(fbsPart("ozonFbsAcceptance")?.amountWithVatRub, 20);
  assert.equal(fbsPart("ozonFbsAcceptance")?.amountRub, 16.39);
  assert.equal(fbsPart("ozonFbsLogistics")?.amountWithVatRub, 857);
  assert.equal(fbsPart("ozonFbsLogistics")?.amountRub, 702.46);
  assert.equal(dbsPart("commission")?.amountWithVatRub, 5945);
  assert.equal(dbsPart("commission")?.amountRub, 4872.95);
});

test("every SKU returns all six marketplace and scheme combinations", () => {
  for (const sku of skus) {
    const result = calculateAllSchemes(sku, settings, tariffs);
    const flat = flattenResults(result);
    assert.equal(flat.length, 6);
    assert.deepEqual(
      flat.map((item) => `${item.marketplace}:${item.scheme}`),
      ["wildberries:fbo", "wildberries:fbs", "wildberries:dbs", "ozon:fbo", "ozon:fbs", "ozon:dbs"]
    );
    assert.ok(flat.every((item) => item.totalRub > 0));
    assert.ok(flat.every((item) => item.breakdown.some((part) => part.key === "firstMile")));
  }
});

test("scheme totals equal the rounded sum of their breakdown items", () => {
  const result = calculateAllSchemes(skus[1], settings, tariffs);
  for (const scheme of flattenResults(result)) {
    const sum = Math.round(scheme.breakdown.reduce((total, item) => total + item.amountRub, 0) * 100) / 100;
    assert.equal(scheme.totalRub, sum);
  }
});

test("golden furniture examples have stable best options", () => {
  const bestBySku = skus.map((sku) => {
    const best = findBestResult(calculateAllSchemes(sku, settings, tariffs));
    return `${sku.id}:${best.marketplace}:${best.scheme}`;
  });
  assert.deepEqual(bestBySku, ["hanger:wildberries:dbs", "cabinet:wildberries:dbs", "table:wildberries:dbs"]);
});
