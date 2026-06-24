import { tariffData } from "./tariffs";
import type { LogisticsAssumptions } from "./types";

const BOX_TYPE_IDS = {
  box: 2,
  pallet: 5,
  supersafe: 6
};

type WbApiRow = Record<string, unknown>;

export function currentMoscowDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export async function fetchWildberriesLogisticsSnapshot(options: {
  date?: string;
  token: string;
}): Promise<LogisticsAssumptions["wildberriesLogistics"]> {
  const date = options.date || currentMoscowDate();
  const [boxResponse, palletResponse, acceptanceRows] = await Promise.all([
    fetchWbJson(`https://common-api.wildberries.ru/api/v1/tariffs/box?date=${date}`, options.token),
    fetchWbJson(`https://common-api.wildberries.ru/api/v1/tariffs/pallet?date=${date}`, options.token),
    fetchWbJson("https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients", options.token)
  ]);

  return buildWildberriesLogisticsSnapshot({
    date,
    boxResponse,
    palletResponse,
    acceptanceRows: Array.isArray(acceptanceRows) ? acceptanceRows.filter(isRow) : []
  });
}

export function buildWildberriesLogisticsSnapshot(options: {
  date: string;
  boxResponse: unknown;
  palletResponse: unknown;
  acceptanceRows: WbApiRow[];
}): LogisticsAssumptions["wildberriesLogistics"] {
  const boxRows = responseWarehouseList(options.boxResponse);
  const palletRows = responseWarehouseList(options.palletResponse);
  const boxMap = byWarehouse(boxRows);
  const palletMap = byWarehouse(palletRows);
  const warehouseNames = Array.from(new Set([...boxMap.keys(), ...palletMap.keys()]))
    .filter(isSupportedWarehouseName)
    .sort((a, b) => a.localeCompare(b, "ru"));

  return {
    source: "WB API: /api/v1/tariffs/box, /api/v1/tariffs/pallet, /api/tariffs/v1/acceptance/coefficients",
    commissionSource: "сomission.xlsx; WB API kgvpPickup is not mapped to FBO",
    status: "official WB API import",
    calculationDate: options.date,
    importedAt: new Date().toISOString(),
    dtTillMax: responseDataValue(options.boxResponse, "dtTillMax") ?? responseDataValue(options.palletResponse, "dtTillMax"),
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
    calculationRules: tariffData.logistics.wildberriesLogistics.calculationRules,
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
          box: normalizeAcceptance(pickAcceptance(options.acceptanceRows, name, BOX_TYPE_IDS.box, options.date)),
          pallet: normalizeAcceptance(pickAcceptance(options.acceptanceRows, name, BOX_TYPE_IDS.pallet, options.date)),
          supersafe: normalizeAcceptance(pickAcceptance(options.acceptanceRows, name, BOX_TYPE_IDS.supersafe, options.date))
        }
      };
    })
  };
}

async function fetchWbJson(url: string, token: string): Promise<unknown> {
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

function responseWarehouseList(value: unknown): WbApiRow[] {
  if (!isRow(value)) return [];
  const response = value.response;
  if (!isRow(response)) return [];
  const data = response.data;
  if (!isRow(data) || !Array.isArray(data.warehouseList)) return [];
  return data.warehouseList.filter(isRow);
}

function responseDataValue(value: unknown, key: string): string | null {
  if (!isRow(value) || !isRow(value.response) || !isRow(value.response.data)) return null;
  const next = value.response.data[key];
  return typeof next === "string" ? next : null;
}

function byWarehouse(rows: WbApiRow[]) {
  return new Map(rows.map((row) => [stringValue(row.warehouseName), row]).filter(([name]) => Boolean(name)) as Array<[string, WbApiRow]>);
}

function normalizeBox(row?: WbApiRow) {
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
    geoName: stringValue(row.geoName)
  };
}

function normalizePallet(row?: WbApiRow) {
  if (!row) return null;
  return {
    deliveryBaseRub: parseRub(row.palletDeliveryValueBase),
    deliveryAdditionalLiterRub: parseRub(row.palletDeliveryValueLiter),
    deliveryCoefPercent: parseRub(row.palletDeliveryExpr),
    storagePalletDayRub: parseRub(row.palletStorageValueExpr),
    storageCoefPercent: parseRub(row.palletStorageExpr)
  };
}

function normalizeAcceptance(row: WbApiRow | null) {
  if (!row) return null;
  return {
    date: stringValue(row.date),
    warehouseID: numberValue(row.warehouseID) ?? 0,
    allowUnload: Boolean(row.allowUnload),
    coefficient: numberValue(row.coefficient) ?? 0,
    boxTypeID: numberValue(row.boxTypeID) ?? 0,
    storageCoefPercent: parseRub(row.storageCoef),
    deliveryCoefPercent: parseRub(row.deliveryCoef),
    deliveryBaseLiterRub: parseRub(row.deliveryBaseLiter),
    deliveryAdditionalLiterRub: parseRub(row.deliveryAdditionalLiter),
    storageBaseLiterRub: parseRub(row.storageBaseLiter),
    storageAdditionalLiterRub: parseRub(row.storageAdditionalLiter),
    isSortingCenter: Boolean(row.isSortingCenter)
  };
}

function isSupportedWarehouseName(warehouseName: string) {
  return !warehouseName.includes(": Питание");
}

function isGenericWarehouseAlias(rowWarehouseName: unknown, warehouseName: string) {
  return stringValue(rowWarehouseName).startsWith(`${warehouseName} (`) && !stringValue(rowWarehouseName).includes(":");
}

function pickAcceptance(rows: WbApiRow[], warehouseName: string, boxTypeID: number, date: string) {
  const matchesTypeDate = (row: WbApiRow) => numberValue(row.boxTypeID) === boxTypeID && stringValue(row.date).startsWith(date);

  return (
    rows.find((row) => stringValue(row.warehouseName) === warehouseName && matchesTypeDate(row)) ??
    rows.find((row) => isGenericWarehouseAlias(row.warehouseName, warehouseName) && matchesTypeDate(row)) ??
    null
  );
}

function parseRub(value: unknown): number | null {
  if (value == null || value === "" || value === "-") return null;
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : parseRub(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRow(value: unknown): value is WbApiRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
