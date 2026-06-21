import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const GENERATED = new URL("src/data/generated/", ROOT);
const TOKEN_FILE = "/Users/konstantin/.codex/automations/wildberries/wb_api_token.txt";
const CACHE_DIR = process.env.WB_TARIFFS_CACHE_DIR || "";
const BOX_TYPE_IDS = {
  box: 2,
  pallet: 5,
  supersafe: 6
};

const currentMoscowDate = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const date = process.env.WB_TARIFF_DATE || currentMoscowDate();

const parseRub = (value) => {
  if (value == null || value === "" || value === "-") return null;
  const normalized = String(value).replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value) => (value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, ROOT), "utf8"));
}

async function readToken() {
  const fromEnv = process.env.WB_API_TOKEN || process.env.WILDBERRIES_API_TOKEN;
  if (fromEnv) return fromEnv.trim();
  return (await readFile(TOKEN_FILE, "utf8")).trim();
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WB API ${response.status} for ${url}: ${body.slice(0, 500)}`);
  }
  return response.json();
}

async function loadApiJson(cacheName, url, token) {
  if (CACHE_DIR) {
    try {
      return JSON.parse(await readFile(`${CACHE_DIR}/${cacheName}_${date}.json`, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return fetchJson(url, token);
}

function byWarehouse(rows) {
  return new Map(rows.map((row) => [row.warehouseName, row]));
}

function normalizeBox(row) {
  if (!row) return null;
  return {
    deliveryBaseRub: parseRub(row.boxDeliveryBase),
    deliveryAdditionalLiterRub: parseRub(row.boxDeliveryLiter),
    deliveryCoefPercent: parseRub(row.boxDeliveryCoefExpr),
    marketplaceDeliveryBaseRub: parseRub(row.boxDeliveryMarketplaceBase),
    marketplaceDeliveryAdditionalLiterRub: parseRub(row.boxDeliveryMarketplaceLiter),
    marketplaceDeliveryCoefPercent: parseRub(row.boxDeliveryMarketplaceCoefExpr),
    storageBaseRub: parseRub(row.boxStorageBase),
    storageAdditionalLiterRub: parseRub(row.boxStorageLiter),
    storageCoefPercent: parseRub(row.boxStorageCoefExpr),
    geoName: row.geoName || ""
  };
}

function normalizePallet(row) {
  if (!row) return null;
  return {
    deliveryBaseRub: parseRub(row.palletDeliveryValueBase),
    deliveryAdditionalLiterRub: parseRub(row.palletDeliveryValueLiter),
    deliveryCoefPercent: parseRub(row.palletDeliveryExpr),
    storagePalletDayRub: parseRub(row.palletStorageValueExpr),
    storageCoefPercent: parseRub(row.palletStorageExpr)
  };
}

function normalizeAcceptance(row) {
  if (!row) return null;
  return {
    date: row.date,
    warehouseID: row.warehouseID,
    allowUnload: Boolean(row.allowUnload),
    coefficient: row.coefficient,
    boxTypeID: row.boxTypeID,
    storageCoefPercent: parseRub(row.storageCoef),
    deliveryCoefPercent: parseRub(row.deliveryCoef),
    deliveryBaseLiterRub: parseRub(row.deliveryBaseLiter),
    deliveryAdditionalLiterRub: parseRub(row.deliveryAdditionalLiter),
    storageBaseLiterRub: parseRub(row.storageBaseLiter),
    storageAdditionalLiterRub: parseRub(row.storageAdditionalLiter),
    isSortingCenter: Boolean(row.isSortingCenter)
  };
}

function pickAcceptance(rows, warehouseName, boxTypeID) {
  return rows.find((row) => row.warehouseName === warehouseName && row.boxTypeID === boxTypeID && row.date?.startsWith(date)) ?? null;
}

const token = await readToken();
const [boxResponse, palletResponse, acceptanceRows, logistics] = await Promise.all([
  loadApiJson("wb_box", `https://common-api.wildberries.ru/api/v1/tariffs/box?date=${date}`, token),
  loadApiJson("wb_pallet", `https://common-api.wildberries.ru/api/v1/tariffs/pallet?date=${date}`, token),
  loadApiJson("wb_acceptance", "https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients", token),
  readJson("src/data/generated/logistics-assumptions.json")
]);

const boxRows = boxResponse.response?.data?.warehouseList ?? [];
const palletRows = palletResponse.response?.data?.warehouseList ?? [];
const boxMap = byWarehouse(boxRows);
const palletMap = byWarehouse(palletRows);
const warehouseNames = Array.from(new Set([...boxMap.keys(), ...palletMap.keys()])).sort((a, b) => a.localeCompare(b, "ru"));

logistics.wildberriesLogistics = {
  source: "WB API: /api/v1/tariffs/box, /api/v1/tariffs/pallet, /api/tariffs/v1/acceptance/coefficients",
  commissionSource: "сomission.xlsx; WB API kgvpPickup is not mapped to FBO",
  status: "official WB API import",
  calculationDate: date,
  importedAt: new Date().toISOString(),
  dtTillMax: boxResponse.response?.data?.dtTillMax ?? palletResponse.response?.data?.dtTillMax ?? null,
  boxTypeIds: BOX_TYPE_IDS,
  defaultSupplyType: "box",
  defaultLocalizationIndex: 1,
  defaultSalesDistributionIndex: 0,
  smallVolumeBands: [
    { minLiter: 0.001, maxLiter: 0.2, rub: 23 },
    { minLiter: 0.201, maxLiter: 0.4, rub: 26 },
    { minLiter: 0.401, maxLiter: 0.6, rub: 29 },
    { minLiter: 0.601, maxLiter: 0.8, rub: 30 },
    { minLiter: 0.801, maxLiter: 1, rub: 32 }
  ],
  firstLiterRub: 46,
  extraLiterRub: 14,
  storagePalletDayRub: 23,
  defaultKtr: 1,
  calculationRules: {
    fboLogistics: "deliveryTariff(volumeLiters, wbSupplyType) * localizationIndex + price * salesDistributionIndex",
    fboAcceptanceBox: "if coefficient is 0 or 1 and allowUnload=true: 1.7 * volumeLiters * coefficient; otherwise warn that supply is unavailable",
    fboAcceptancePallet: "if coefficient is 0 or 1 and allowUnload=true: 500 * coefficient / itemsPerPallet; otherwise warn that supply is unavailable",
    fboStorageBox: "(storageBaseRub + max(0, volumeLiters - 1) * storageAdditionalLiterRub) * storageDays",
    fboStoragePallet: "acceptance.storageBaseLiterRub * storageDays / itemsPerPallet; fallback to pallet.storagePalletDayRub only if acceptance storage is unavailable",
    fbsLogistics: "marketplaceDeliveryTariff(volumeLiters) from WB box tariffs",
    dbs: "no WB marketplace logistics in current model"
  },
  warehouses: warehouseNames.map((name) => {
    const box = normalizeBox(boxMap.get(name));
    const pallet = normalizePallet(palletMap.get(name));
    return {
      name,
      geoName: box?.geoName ?? "",
      warehouseCoeff: (box?.deliveryCoefPercent ?? pallet?.deliveryCoefPercent ?? 100) / 100,
      fbsCoeff: (box?.marketplaceDeliveryCoefPercent ?? box?.deliveryCoefPercent ?? 100) / 100,
      box,
      pallet,
      acceptance: {
        box: normalizeAcceptance(pickAcceptance(acceptanceRows, name, BOX_TYPE_IDS.box)),
        pallet: normalizeAcceptance(pickAcceptance(acceptanceRows, name, BOX_TYPE_IDS.pallet)),
        supersafe: normalizeAcceptance(pickAcceptance(acceptanceRows, name, BOX_TYPE_IDS.supersafe))
      }
    };
  })
};

await writeFile(new URL("logistics-assumptions.json", GENERATED), `${JSON.stringify(logistics, null, 2)}\n`, "utf8");

console.log(`Imported WB logistics for ${date}: ${warehouseNames.length} warehouses. WB commissions remain sourced from сomission.xlsx`);
