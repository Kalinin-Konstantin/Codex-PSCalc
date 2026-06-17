"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  calculateAllSchemes,
  calculateSkuMetrics,
  classifySkuDimensions,
  flattenResults,
  labelForMarketplace,
  labelForScheme,
  labelForWbSupplyType
} from "../lib/calculator.ts";
import {
  defaultSettings,
  defaultSkus,
  destinationCities,
  originCities,
  ozonDeliveryClusters,
  ozonProductTypes,
  tariffData,
  wbWarehousesForDestination,
  wbSubjects,
} from "../lib/tariffs";
import type { CalculationResult, CalculatorSettings, PimProfitCenter, SchemeResult, SkuInput, WarehouseOperationGroup } from "../lib/types";

type NumericSkuField = "price" | "weightKg" | "lengthCm" | "widthCm" | "heightCm" | "itemsPerPallet";

const resultColumns = [
  ["wildberries", "fbo"],
  ["wildberries", "fbs"],
  ["wildberries", "dbs"],
  ["ozon", "fbo"],
  ["ozon", "fbs"],
  ["ozon", "dbs"]
] as const;

const cityCollator = new Intl.Collator("ru");
const sortedOriginCities = [...originCities].sort(cityCollator.compare);
const wbTariffInfo = tariffData.logistics.wildberriesLogistics;
const fastHandoverRules = [
  ["WB", "FBS МГТ/КГТ+", "до 13 часов", "-1,5 п.п. к комиссии"],
  ["WB", "FBS МГТ/КГТ+", "13-18 часов", "базовая комиссия"],
  ["WB", "FBS СГТ", "любое время", "без изменений"],
  ["Ozon", "FBS, СЦ/курьер", "до 12 часов", "скидка 3%"],
  ["Ozon", "FBS, СЦ/курьер", "12-24 часа", "скидка 2%"],
  ["Ozon", "FBS, ПВЗ/ППЗ", "до рекомендованного слота", "скидка 2%"]
] as const;

const ozonFastHandoverOptions = [
  ["sc_courier_under_12", "Ozon FBS, СЦ/курьер: до 12 часов"],
  ["sc_courier_12_24", "Ozon FBS, СЦ/курьер: 12-24 часа"],
  ["pvz_ppz_recommended_slot", "Ozon FBS, ПВЗ/ППЗ: до рекомендованного слота"]
] as const;

const operationDescriptions = {
  firstMile:
    "Доставка товара от точки отправки селлера до выбранного города/склада PIM.Seller. В админке база берётся как тариф за паллету по маршруту, а в расчёте делится на количество штук на паллете.",
  warehouse:
    "Операции PIM.Seller на складе: приёмка, хранение, комплектация и отгрузка. Наценка применяется к соответствующим складским статьям в FBS и DBS.",
  middleMile:
    "Перемещение товара после обработки на складе PIM.Seller до канала дальнейшей доставки. Тариф зависит от литража SKU: отдельно первый литр, диапазоны до 350 л и фиксированные тарифы для больших объёмов.",
  lastMile:
    "Доставка заказа до покупателя в DBS-модели силами PIM.Seller. Считается по выбранному городу и зоне доставки, с базовым тарифом до лимита веса и доплатой за каждый следующий килограмм."
} as const;

const warehouseGroupOrder: WarehouseOperationGroup[] = ["receiving", "storage", "fulfillment", "shipping"];
const warehouseGroupDetails: Record<WarehouseOperationGroup, { label: string; description: string }> = {
  receiving: {
    label: "Приёмка",
    description:
      "Выберите тип входящей поставки. Монопаллета и микспаллета используют механизированную выгрузку паллеты и в блоке Приёмка считаются одинаково; короба используют ручную выгрузку по весу SKU. Микспаллеты влияют на следующие складские блоки."
  },
  storage: {
    label: "Хранение",
    description:
      "Если поставка монопаллетой, хранение считается по паллетоместу. Если поставка микспаллетой или коробами, сначала добавляется сортировка по артикулам по весу SKU, затем хранение считается в литрах за сутки."
  },
  fulfillment: {
    label: "Комплектация",
    description: "Комплектация, сборка, расформирование, маркировка и подготовка заказа перед дальнейшей доставкой."
  },
  shipping: {
    label: "Отгрузка",
    description: "Исходящая отгрузка со склада PIM.Seller. Логика этого блока еще не утверждена отдельно."
  }
};
const warehouseSupplyTypeOptions: Array<{ label: string; value: CalculatorSettings["warehouseSupplyType"] }> = [
  { value: "mono_pallet", label: "Монопаллета" },
  { value: "mix_pallet", label: "Микспаллета" },
  { value: "boxes", label: "Короба" }
];

export function CalculatorApp() {
  const [skus, setSkus] = useState<SkuInput[]>(defaultSkus);
  const [settings, setSettings] = useState<CalculatorSettings>(defaultSettings);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const availableWbWarehouses = useMemo(() => wbWarehousesForDestination(settings.firstMileCity), [settings.firstMileCity]);
  const selectedWbWarehouse = availableWbWarehouses.includes(settings.wbWarehouse) ? settings.wbWarehouse : "";
  const calculationSettings = useMemo<CalculatorSettings>(
    () => ({ ...settings, presentationMode: isAdminOpen ? "internal" : "client" }),
    [isAdminOpen, settings]
  );

  const calculations = useMemo(
    () =>
      skus.map((sku) => {
        const result = calculateAllSchemes(sku, calculationSettings, tariffData);
        return { sku, result, bestByMarketplace: findBestResultsByMarketplace(result) };
      }),
    [calculationSettings, skus]
  );

  const totals = useMemo(() => {
    const rows = calculations.flatMap((item) => flattenResults(item.result)).filter((item) => item.isComplete);
    const average = rows.length ? rows.reduce((sum, item) => sum + item.totalRub, 0) / rows.length : 0;
    const min = rows.length ? rows.reduce((best, item) => (item.totalRub < best.totalRub ? item : best), rows[0]) : null;
    return { average, min };
  }, [calculations]);

  function updateSku(id: string, patch: Partial<SkuInput>) {
    setSkus((current) => current.map((sku) => (sku.id === id ? { ...sku, ...patch } : sku)));
  }

  function updateSkuNumber(id: string, field: NumericSkuField, value: string) {
    updateSku(id, { [field]: Number(value) || 0 } as Partial<SkuInput>);
  }

  function addSku() {
    const next = skus[skus.length - 1] ?? defaultSkus[0];
    setSkus((current) => [
      ...current,
      {
        ...next,
        id: crypto.randomUUID(),
        name: `SKU ${current.length + 1}`
      }
    ]);
  }

  function removeSku(id: string) {
    setSkus((current) => (current.length > 1 ? current.filter((sku) => sku.id !== id) : current));
  }

  function updateDestinationCity(destinationCity: string) {
    const nextWarehouses = wbWarehousesForDestination(destinationCity);
    setSettings({
      ...settings,
      firstMileCity: destinationCity,
      wbWarehouse: nextWarehouses[0] ?? ""
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src="/pim-seller-logo.png" alt="PIM.Seller" />
          <div>
            <p className="eyebrow">Прототип калькулятора</p>
            <h1>Калькулятор юнит-экономики</h1>
          </div>
        </div>
        <button className="admin-trigger" type="button" aria-label="Открыть админ-панель" onClick={() => setIsAdminOpen(true)}>
          •
        </button>
        <div className="status-strip" aria-label="Сводка">
          <Metric label="SKU" value={String(skus.length)} />
          <Metric label="Среднее" value={formatRub(totals.average)} />
          <Metric label="Лучший вариант" value={totals.min ? `${labelForMarketplace(totals.min.marketplace)} ${labelForScheme(totals.min.scheme)}` : "—"} />
          <Metric label="Тарифы WB" value={formatTariffFreshness(wbTariffInfo.calculationDate, wbTariffInfo.importedAt)} />
        </div>
      </header>

      <section className="settings-band" aria-label="Параметры расчёта">
        <div className="settings-group route-group">
          <div className="settings-title">
            <span>Маршрут</span>
            <strong>Откуда и куда везём</strong>
          </div>
          <div className="settings-controls two-columns">
            <label>
              <span>Откуда</span>
              <SearchableCitySelect
                value={settings.originCity}
                options={sortedOriginCities}
                onChange={(originCity) => setSettings({ ...settings, originCity })}
              />
            </label>
            <label>
              <span>Куда</span>
              <select value={settings.firstMileCity} onChange={(event) => updateDestinationCity(event.target.value)}>
                {destinationCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-title">
            <span>Маркетплейс</span>
            <strong>Wildberries</strong>
          </div>
          <div className="settings-controls">
            <label>
              <span>Склад WB</span>
              <select
                disabled={availableWbWarehouses.length === 0}
                value={selectedWbWarehouse}
                onChange={(event) => setSettings({ ...settings, wbWarehouse: event.target.value })}
              >
                {availableWbWarehouses.length > 0 ? (
                  availableWbWarehouses.map((warehouse) => (
                    <option key={warehouse} value={warehouse}>
                      {warehouse}
                    </option>
                  ))
                ) : (
                  <option value="">Нет склада WB для города</option>
                )}
              </select>
            </label>
            <label>
              <span>Тип поставки</span>
              <select value={settings.wbSupplyType} onChange={(event) => setSettings({ ...settings, wbSupplyType: event.target.value as CalculatorSettings["wbSupplyType"] })}>
                <option value="box">{labelForWbSupplyType("box")}</option>
                <option value="pallet">{labelForWbSupplyType("pallet")}</option>
              </select>
            </label>
            <label>
              <span>Индекс локализации</span>
              <input
                min="0"
                step="0.05"
                type="number"
                value={settings.localizationIndex}
                onChange={(event) => setSettings({ ...settings, localizationIndex: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              <span>Индекс распределения продаж</span>
              <input
                min="0"
                step="0.001"
                type="number"
                value={settings.salesDistributionIndex}
                onChange={(event) => setSettings({ ...settings, salesDistributionIndex: Number(event.target.value) || 0 })}
              />
            </label>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-title">
            <span>Маркетплейс</span>
            <strong>Ozon</strong>
          </div>
          <div className="settings-controls">
            <label>
              <span>Доставка Ozon</span>
              <select
                value={settings.ozonDeliveryMode}
                onChange={(event) => setSettings({ ...settings, ozonDeliveryMode: event.target.value as CalculatorSettings["ozonDeliveryMode"] })}
              >
                <option value="local">Локальный кластер</option>
                <option value="cluster">Выбрать кластер</option>
              </select>
            </label>
            <label>
              <span>Кластер доставки</span>
              <select
                disabled={settings.ozonDeliveryMode === "local"}
                value={settings.ozonDeliveryCluster}
                onChange={(event) => setSettings({ ...settings, ozonDeliveryCluster: event.target.value })}
              >
                {ozonDeliveryClusters.map((cluster) => (
                  <option key={cluster} value={cluster}>
                    {cluster}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="settings-group common-group">
          <div className="settings-title">
            <span>Общие</span>
            <strong>Расчёт</strong>
          </div>
          <div className="settings-controls">
            <label>
              <span>Дней хранения</span>
              <input
                min="0"
                type="number"
                value={settings.storageDays}
                onChange={(event) => setSettings({ ...settings, storageDays: Number(event.target.value) || 0 })}
              />
            </label>
            <label>
              <span>НДС</span>
              <select
                value={settings.vatDisplayMode}
                onChange={(event) => setSettings({ ...settings, vatDisplayMode: event.target.value as CalculatorSettings["vatDisplayMode"] })}
              >
                <option value="without_vat">Без НДС</option>
                <option value="with_vat">С НДС</option>
              </select>
            </label>
            <label>
              <span>Зона доставки по DBS</span>
              <select value={settings.lastMileZone} onChange={(event) => setSettings({ ...settings, lastMileZone: event.target.value as CalculatorSettings["lastMileZone"] })}>
                <option value="city">Город</option>
                <option value="region">Область / регион</option>
              </select>
            </label>
            <div className="toggle-field">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.fastHandover}
                  onChange={(event) => setSettings({ ...settings, fastHandover: event.target.checked })}
                />
                <span>Быстрая сдача</span>
              </label>
              <div className="help">
                <button type="button" className="help-trigger" aria-label="Что значит быстрая сдача?">
                  ?
                </button>
                <div className="help-card" role="tooltip">
                  <strong>Скидка к комиссии маркетплейса</strong>
                  <table>
                    <thead>
                      <tr>
                        <th>МП</th>
                        <th>Схема</th>
                        <th>Быстрая сдача</th>
                        <th>Эффект</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fastHandoverRules.map(([marketplace, scheme, time, value]) => (
                        <tr key={`${marketplace}-${scheme}-${time}`}>
                          <td>{marketplace}</td>
                          <td>{scheme}</td>
                          <td>{time}</td>
                          <td>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <label>
              <span>Условие Ozon FBS</span>
              <select
                disabled={!settings.fastHandover}
                value={settings.ozonFastHandoverType}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    ozonFastHandoverType: event.target.value as CalculatorSettings["ozonFastHandoverType"]
                  })
                }
              >
                {ozonFastHandoverOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="vat-badge">
              {settings.vatDisplayMode === "with_vat" ? "Суммы с НДС 22%" : "Суммы без НДС"}
            </div>
          </div>
        </div>
      </section>

      {isAdminOpen ? (
        <AdminPanel
          calculations={calculations}
          onClose={() => setIsAdminOpen(false)}
          onSettingsChange={(patch) => setSettings({ ...settings, ...patch })}
          settings={settings}
        />
      ) : null}

      <section className="sku-editor" aria-label="SKU">
        <div className="section-heading">
          <h2>SKU</h2>
          <button type="button" onClick={addSku}>
            Добавить SKU
          </button>
        </div>
        <div className="sku-table-wrap">
          <table className="sku-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Цена с НДС</th>
                <th>WB категория</th>
                <th>Ozon тип товара</th>
                <th>Вес</th>
                <th>Длина</th>
                <th>Ширина</th>
                <th>Высота</th>
                <th>На паллете</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {skus.map((sku) => (
                <tr key={sku.id}>
                  <td>
                    <input value={sku.name} onChange={(event) => updateSku(sku.id, { name: event.target.value })} />
                  </td>
                  <td>
                    <NumberInput value={sku.price} onChange={(value) => updateSkuNumber(sku.id, "price", value)} />
                  </td>
                  <td>
                    <input
                      list="wb-subjects"
                      value={sku.wbSubject}
                      onChange={(event) => updateSku(sku.id, { wbSubject: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      list="ozon-product-types"
                      value={sku.ozonProductType}
                      onChange={(event) => updateSku(sku.id, { ozonProductType: event.target.value })}
                    />
                  </td>
                  <td>
                    <NumberInput value={sku.weightKg} onChange={(value) => updateSkuNumber(sku.id, "weightKg", value)} />
                  </td>
                  <td>
                    <NumberInput value={sku.lengthCm} onChange={(value) => updateSkuNumber(sku.id, "lengthCm", value)} />
                  </td>
                  <td>
                    <NumberInput value={sku.widthCm} onChange={(value) => updateSkuNumber(sku.id, "widthCm", value)} />
                  </td>
                  <td>
                    <NumberInput value={sku.heightCm} onChange={(value) => updateSkuNumber(sku.id, "heightCm", value)} />
                  </td>
                  <td>
                    <NumberInput value={sku.itemsPerPallet} onChange={(value) => updateSkuNumber(sku.id, "itemsPerPallet", value)} />
                  </td>
                  <td>
                    <button type="button" className="icon-button" title="Удалить SKU" onClick={() => removeSku(sku.id)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="wb-subjects">
          {wbSubjects.map((subject) => (
            <option key={subject} value={subject} />
          ))}
        </datalist>
        <datalist id="ozon-product-types">
          {ozonProductTypes.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
      </section>

      <section className="results" aria-label="Результаты">
        <div className="section-heading">
          <h2>Сравнение схем</h2>
          <span>{resultColumns.length} вариантов на каждый SKU</span>
        </div>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Объём</th>
                {resultColumns.map(([marketplace, scheme]) => (
                  <th key={`${marketplace}-${scheme}`}>
                    {labelForMarketplace(marketplace)} {labelForScheme(scheme)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calculations.map(({ sku, result, bestByMarketplace }) => {
                const metrics = calculateSkuMetrics(sku);
                const dimensionClasses = classifySkuDimensions(sku);
                return (
                  <tr key={sku.id}>
                    <th>
                      <div className="sku-title">
                        <strong>{sku.name}</strong>
                        <DimensionBadges classes={dimensionClasses} />
                      </div>
                      <span>
                        {formatRub(displayPrice(sku.price, settings.vatDisplayMode))} цена {settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС"}
                      </span>
                    </th>
                    <td>
                      <strong>{formatNumber(metrics.volumeLiters)} л</strong>
                      <span>{formatNumber(metrics.chargeableKg)} кг расч.</span>
                    </td>
                    {resultColumns.map(([marketplace, scheme]) => {
                      const schemeResult = result[marketplace][scheme];
                      return (
                        <ResultCell
                          key={`${sku.id}-${marketplace}-${scheme}`}
                          result={schemeResult}
                          isBest={bestByMarketplace.some((best) => sameResult(schemeResult, best))}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTariffFreshness(calculationDate?: string, importedAt?: string): string {
  const date = formatDateRu(calculationDate);
  const imported = formatDateTimeRu(importedAt);
  if (date && imported) return `${date}, ${imported}`;
  return date ?? "не обновлены";
}

function formatDateRu(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" }).format(date);
}

function formatDateTimeRu(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Moscow",
    year: "numeric"
  }).format(date);
}

function DimensionBadges({ classes }: { classes: ReturnType<typeof classifySkuDimensions> }) {
  const badges: Array<{ className: string; label: string }> = [];
  if (classes.wildberries === "kgt_plus") badges.push({ className: "wb", label: "WB КГТ+" });
  if (classes.wildberries === "sgt") badges.push({ className: "wb", label: "WB СГТ" });
  if (classes.ozon === "kgt") badges.push({ className: "ozon", label: "Ozon КГТ" });
  if (!badges.length) return null;

  return (
    <span className="dimension-badges" aria-label="Габаритные категории">
      {badges.map((badge) => (
        <span key={badge.label} className={`dimension-badge ${badge.className}`}>
          {badge.label}
        </span>
      ))}
    </span>
  );
}

function SearchableCitySelect({
  value,
  options,
  onChange
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return options;
    return options.filter((city) => city.toLocaleLowerCase("ru").includes(needle));
  }, [options, query]);

  function chooseCity(city: string) {
    onChange(city);
    setQuery(city);
    setIsOpen(false);
  }

  function commitClosestCity() {
    const exactMatch = options.find((city) => city.toLocaleLowerCase("ru") === query.trim().toLocaleLowerCase("ru"));
    const closestCity = exactMatch ?? filteredOptions[0];
    if (closestCity) {
      chooseCity(closestCity);
      return;
    }
    setQuery(value);
    setIsOpen(false);
  }

  return (
    <div className="combo">
      <input
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        role="combobox"
        value={query}
        onBlur={commitClosestCity}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitClosestCity();
          }
          if (event.key === "Escape") {
            setQuery(value);
            setIsOpen(false);
          }
        }}
      />
      {isOpen ? (
        <div className="combo-menu" role="listbox">
          {filteredOptions.length ? (
            filteredOptions.map((city) => (
              <button
                key={city}
                type="button"
                className="combo-option"
                role="option"
                aria-selected={city === value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseCity(city);
                }}
              >
                {city}
              </button>
            ))
          ) : (
            <div className="combo-empty">Город не найден</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AdminPanel({
  calculations,
  onClose,
  onSettingsChange,
  settings
}: {
  calculations: Array<{ sku: SkuInput; result: CalculationResult }>;
  onClose: () => void;
  onSettingsChange: (patch: Partial<CalculatorSettings>) => void;
  settings: CalculatorSettings;
}) {
  const [isWarehousePriceListOpen, setIsWarehousePriceListOpen] = useState(false);
  const [isFulfillmentExtrasOpen, setIsFulfillmentExtrasOpen] = useState(false);
  const groups = marginGroups(calculations, settings.vatDisplayMode);
  const marginVatLabel = settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС";
  const markupBases = markupReferenceBases(settings);
  const warehouseGroupBases = referenceWarehouseGroupBases(calculations, settings.vatDisplayMode);
  const middleMileRows = middleMileMarkupRows(calculations);
  const updateWarehouseMarkup = (group: WarehouseOperationGroup, value: number) =>
    onSettingsChange({
      warehouseOperationMarkupPercents: {
        ...settings.warehouseOperationMarkupPercents,
        [group]: value
      }
    });
  const updateReceivingMarkup = (operationKey: string, value: number) =>
    onSettingsChange({
      warehouseReceivingMarkupPercents: {
        ...settings.warehouseReceivingMarkupPercents,
        [operationKey]: value
      }
    });
  const updateStorageMarkup = (operationKey: string, value: number) =>
    onSettingsChange({
      warehouseStorageMarkupPercents: {
        ...settings.warehouseStorageMarkupPercents,
        [operationKey]: value
      }
    });
  const updateFulfillmentExtra = (operationKey: string, isSelected: boolean) =>
    onSettingsChange({
      warehouseFulfillmentExtraOperations: {
        ...settings.warehouseFulfillmentExtraOperations,
        [operationKey]: isSelected
      }
    });

  return (
    <aside className="admin-panel" aria-label="Админ-панель">
      <div className="admin-panel-header">
        <div>
          <span>Внутренний режим</span>
          <strong>Коммерческие настройки</strong>
        </div>
        <button className="icon-button" type="button" aria-label="Закрыть админ-панель" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="internal-panel">
        <div className="admin-section-title compact">
          <strong>Наценка PIM.Seller</strong>
          <span>база тарифа, процент и рублевая наценка</span>
        </div>
        <div className="markup-cards">
          <MarkupCard description={operationDescriptions.firstMile} title="Первая миля">
            <MarkupPairInput
              label="Паллета"
              rubLabel="₽"
              baseLabel={`${formatRub(markupBases.firstMilePalletRub)}`}
              baseRub={markupBases.firstMilePalletRub}
              percent={settings.firstMileMarkupPercent}
              onPercentChange={(firstMileMarkupPercent) => onSettingsChange({ firstMileMarkupPercent })}
            />
          </MarkupCard>
          <MarkupCard
            action={
              <button className="link-button" type="button" onClick={() => setIsWarehousePriceListOpen(true)}>
                Прайс-лист
              </button>
            }
            description={operationDescriptions.warehouse}
            title="Складские операции"
          >
            {warehouseGroupOrder
              .filter((group) => settings.warehouseOperationGroups[group])
              .map((group) => (
                <MarkupPairInput
                  key={group}
                  label={warehouseGroupDetails[group].label}
                  rubLabel="₽"
                  baseLabel={`${formatRub(warehouseGroupBases[group] ?? 0)}`}
                  baseRub={warehouseGroupBases[group] ?? 0}
                  percent={settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent}
                  onPercentChange={(value) => updateWarehouseMarkup(group, value)}
                />
              ))}
          </MarkupCard>
          <MarkupCard description={operationDescriptions.middleMile} title="Средняя миля">
            {middleMileRows.map((row) => (
              <MarkupPairInput
                key={row.settingKey}
                label={row.label}
                rubLabel={row.rubLabel}
                baseLabel={`${formatRub(row.baseRub)}`}
                baseRub={row.baseRub}
                percent={settings[row.settingKey]}
                onPercentChange={(value) => onSettingsChange({ [row.settingKey]: value } as Partial<CalculatorSettings>)}
              />
            ))}
          </MarkupCard>
          <MarkupCard description={operationDescriptions.lastMile} title="Последняя миля">
            <MarkupPairInput
              label={`До ${formatNumber(markupBases.lastMileIncludedKg)} кг`}
              rubLabel="₽"
              baseLabel={`${formatRub(markupBases.lastMileBaseRub)}`}
              baseRub={markupBases.lastMileBaseRub}
              percent={settings.lastMileBaseMarkupPercent}
              onPercentChange={(lastMileBaseMarkupPercent) => onSettingsChange({ lastMileBaseMarkupPercent })}
            />
            <MarkupPairInput
              label="Сверх лимита"
              rubLabel="₽/кг"
              baseLabel={`${formatRub(markupBases.lastMileAdditionalKgRub)}`}
              baseRub={markupBases.lastMileAdditionalKgRub}
              percent={settings.lastMileAdditionalKgMarkupPercent}
              onPercentChange={(lastMileAdditionalKgMarkupPercent) => onSettingsChange({ lastMileAdditionalKgMarkupPercent })}
            />
          </MarkupCard>
        </div>
      </div>

      {isWarehousePriceListOpen ? (
        <WarehousePriceListModal
          skus={calculations.map(({ sku }) => sku)}
          settings={settings}
          isFulfillmentExtrasOpen={isFulfillmentExtrasOpen}
          onClose={() => setIsWarehousePriceListOpen(false)}
          onFulfillmentExtrasToggle={() => setIsFulfillmentExtrasOpen((value) => !value)}
          onFulfillmentExtraChange={updateFulfillmentExtra}
          onMarkupChange={updateWarehouseMarkup}
          onReceivingMarkupChange={updateReceivingMarkup}
          onStorageMarkupChange={updateStorageMarkup}
          onSupplyTypeChange={(warehouseSupplyType) => onSettingsChange({ warehouseSupplyType })}
        />
      ) : null}

      <div className="admin-margin">
        <div className="admin-section-title">
          <strong>Маржа на 1 SKU</strong>
          <span>{marginVatLabel}, по центрам прибыли</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Маркетплейс</th>
                <th>Схема</th>
                <th>Первая</th>
                <th>Склад</th>
                <th>Средняя</th>
                <th>Последняя</th>
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.marketplaces.map((marketplaceGroup, marketplaceIndex) =>
                  marketplaceGroup.rows.map((row, schemeIndex) => (
                    <tr key={`${group.skuId}-${marketplaceGroup.marketplace}-${row.scheme}`}>
                      {marketplaceIndex === 0 && schemeIndex === 0 ? (
                        <td className="admin-group-cell sku-cell" rowSpan={group.rowSpan}>
                          {group.skuName}
                        </td>
                      ) : null}
                      {schemeIndex === 0 ? (
                        <td className="admin-group-cell marketplace-cell" rowSpan={marketplaceGroup.rows.length}>
                          {labelForMarketplace(marketplaceGroup.marketplace)}
                        </td>
                      ) : null}
                      <td>{labelForScheme(row.scheme)}</td>
                      <td className="admin-value">{formatRub(row.margin.firstMile)}</td>
                      <td className="admin-value">{formatRub(row.margin.warehouse)}</td>
                      <td className="admin-value">{formatRub(row.margin.middleMile)}</td>
                      <td className="admin-value">{formatRub(row.margin.lastMile)}</td>
                      <td className="admin-value">
                        <strong>{formatRub(row.margin.total)}</strong>
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </aside>
  );
}

function marginGroups(calculations: Array<{ sku: SkuInput; result: CalculationResult }>, vatDisplayMode: CalculatorSettings["vatDisplayMode"]) {
  return calculations.map(({ sku, result }) => {
    const marketplaces = (["wildberries", "ozon"] as const).map((marketplace) => ({
      marketplace,
      rows: (["fbs", "dbs"] as const).map((scheme) => ({
        scheme,
        margin: summarizePimMargin(result[marketplace][scheme], vatDisplayMode)
      }))
    }));
    return {
      skuId: sku.id,
      skuName: sku.name,
      marketplaces,
      rowSpan: marketplaces.reduce((sum, item) => sum + item.rows.length, 0)
    };
  });
}

function summarizePimMargin(result: SchemeResult, vatDisplayMode: CalculatorSettings["vatDisplayMode"]): Record<PimProfitCenter | "total", number> {
  const margin: Record<PimProfitCenter | "total", number> = {
    firstMile: 0,
    warehouse: 0,
    middleMile: 0,
    lastMile: 0,
    total: 0
  };

  for (const item of result.breakdown) {
    if (!item.pimProfitCenter) continue;
    const profit = vatDisplayMode === "with_vat" ? item.pimProfitWithVatRub ?? 0 : item.pimProfitWithoutVatRub ?? 0;
    margin[item.pimProfitCenter] += profit;
    margin.total += profit;
  }

  return {
    firstMile: roundRub(margin.firstMile),
    warehouse: roundRub(margin.warehouse),
    middleMile: roundRub(margin.middleMile),
    lastMile: roundRub(margin.lastMile),
    total: roundRub(margin.total)
  };
}

function NumberInput({ value, onChange }: { value: number; onChange: (value: string) => void }) {
  return <input min="0" step="0.01" type="number" value={value} onChange={(event) => onChange(event.target.value)} />;
}

function WarehousePriceListModal({
  isFulfillmentExtrasOpen,
  onClose,
  onFulfillmentExtraChange,
  onFulfillmentExtrasToggle,
  onMarkupChange,
  onReceivingMarkupChange,
  onStorageMarkupChange,
  onSupplyTypeChange,
  skus,
  settings
}: {
  isFulfillmentExtrasOpen: boolean;
  onClose: () => void;
  onFulfillmentExtraChange: (operationKey: string, isSelected: boolean) => void;
  onFulfillmentExtrasToggle: () => void;
  onMarkupChange: (group: WarehouseOperationGroup, value: number) => void;
  onReceivingMarkupChange: (operationKey: string, value: number) => void;
  onStorageMarkupChange: (operationKey: string, value: number) => void;
  onSupplyTypeChange: (value: CalculatorSettings["warehouseSupplyType"]) => void;
  skus: SkuInput[];
  settings: CalculatorSettings;
}) {
  const costHeader = "Себестоимость";
  const vatLabel = settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС";
  const groupedOperations = warehousePriceListGroups(skus, settings, isFulfillmentExtrasOpen);
  const operationCount = groupedOperations.reduce((sum, item) => sum + item.operations.length, 0);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="price-list-modal" role="dialog" aria-modal="true" aria-label="Прайс-лист складских операций">
        <div className="price-list-header">
          <div>
            <span>
              Складские операции · {operationCount} {pluralize(operationCount, "операция", "операции", "операций")} · {vatLabel}
            </span>
            <strong>Прайс-лист PIM.Seller</strong>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть прайс-лист" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="price-list-table-wrap">
          <table className="price-list-table">
            <thead>
              <tr>
                <th>Группа</th>
                <th>Операция</th>
                <th>Ед.</th>
                <th>{costHeader}</th>
                <th>% наценки</th>
                <th>Реализация</th>
              </tr>
            </thead>
            <tbody>
              {groupedOperations.map(({ group, operations }) =>
                operations.map((operation, index) => {
                  const operationKey = warehouseOperationKey(operation);
                  const markupPercent =
                    group === "receiving"
                      ? settings.warehouseReceivingMarkupPercents[operationKey] ?? settings.warehouseOperationMarkupPercents.receiving ?? 20
                      : group === "storage"
                        ? settings.warehouseStorageMarkupPercents[operationKey] ?? defaultWarehouseStorageMarkupPercent(operationKey)
                      : settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
                  const costRub = displayWarehousePrice(operation.priceRub, settings.vatDisplayMode);
                  const saleRub = roundRub(costRub * (1 + markupPercent / 100));
                  return (
                    <tr key={`${group}-${operationKey}`}>
                      {index === 0 ? (
                        <td className="price-list-group" rowSpan={operations.length}>
                          <div className="price-list-group-title">
                            <strong>{warehouseGroupDetails[group].label}</strong>
                            <span className="help">
                              <button
                                type="button"
                                className="help-trigger"
                                aria-label={`Описание группы ${warehouseGroupDetails[group].label}`}
                              >
                                ?
                              </button>
                              <span className="help-card" role="tooltip">
                                <span className="help-text">{warehouseGroupDetails[group].description}</span>
                              </span>
                            </span>
                          </div>
                          {group === "fulfillment" ? (
                            <button className="link-button" type="button" onClick={onFulfillmentExtrasToggle}>
                              {isFulfillmentExtrasOpen ? "Скрыть доп. операции" : "Доп. операции"}
                            </button>
                          ) : null}
                          {group === "receiving" ? (
                            <div className="receiving-supply-control">
                              <label>
                                <span>Тип поставки</span>
                                <select
                                  value={settings.warehouseSupplyType}
                                  onChange={(event) => onSupplyTypeChange(event.target.value as CalculatorSettings["warehouseSupplyType"])}
                                >
                                  {warehouseSupplyTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                      <td>
                        <span className="operation-pick">
                          {isFulfillmentExtraOperation(operation.name) ? (
                            <input
                              aria-label={`${displayWarehouseOperationName(operation.name)}: участвует в расчете`}
                              checked={settings.warehouseFulfillmentExtraOperations[operationKey] === true}
                              type="checkbox"
                              onChange={(event) => onFulfillmentExtraChange(operationKey, event.target.checked)}
                            />
                          ) : (
                            <span
                              className={warehouseOperationSelected(group, operation.name, settings.warehouseSupplyType, settings) ? "operation-check active" : "operation-check"}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                          )}
                          <span>{displayWarehouseOperationName(operation.name)}</span>
                        </span>
                      </td>
                      <td>{operation.unit}</td>
                      <td className="numeric">{formatRub(costRub)}</td>
                      {group === "receiving" || group === "storage" ? (
                        <td className="numeric price-list-markup">
                          <input
                            aria-label={`${displayWarehouseOperationName(operation.name)}: процент наценки`}
                            min="0"
                            step="1"
                            type="number"
                            value={markupPercent}
                            onChange={(event) =>
                              group === "receiving"
                                ? onReceivingMarkupChange(operationKey, parseInputNumber(event.target.value))
                                : onStorageMarkupChange(operationKey, parseInputNumber(event.target.value))
                            }
                          />
                        </td>
                      ) : index === 0 ? (
                        <td className="numeric price-list-markup" rowSpan={operations.length}>
                          <input
                            aria-label={`${warehouseGroupDetails[group].label}: процент наценки`}
                            min="0"
                            step="1"
                            type="number"
                            value={markupPercent}
                            onChange={(event) => onMarkupChange(group, parseInputNumber(event.target.value))}
                          />
                        </td>
                      ) : null}
                      <td className="numeric">{formatRub(saleRub)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MarkupCard({
  action,
  children,
  description,
  title
}: {
  action?: ReactNode;
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="markup-card">
      <div className="markup-card-title">
        <strong>{title}</strong>
        <div className="markup-card-actions">
          {action}
          <div className="help">
            <button type="button" className="help-trigger" aria-label={`Что входит в ${title.toLowerCase()}?`}>
              ?
            </button>
            <div className="help-card" role="tooltip">
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="markup-head" aria-hidden="true">
        <span></span>
        <span>Тариф</span>
        <span>%</span>
        <span>Наценка</span>
      </div>
      <div className="markup-lines">{children}</div>
    </section>
  );
}

function MarkupInput({
  baseLabel,
  label,
  value,
  onChange
}: {
  baseLabel: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="markup-line">
      <span>{label}</span>
      <strong>{baseLabel}</strong>
      <label>
        <input
          aria-label={`${label}: процент наценки`}
          min="0"
          step="1"
          type="number"
          value={value}
          onChange={(event) => onChange(parseInputNumber(event.target.value))}
        />
      </label>
      <em>по статьям</em>
    </div>
  );
}

function MarkupPairInput({
  baseRub,
  baseLabel,
  label,
  onPercentChange,
  percent,
  rubLabel
}: {
  baseRub: number;
  baseLabel: string;
  label: string;
  onPercentChange: (value: number) => void;
  percent: number;
  rubLabel: string;
}) {
  const rubValue = roundRub(baseRub * (percent / 100));
  const formattedRubValue = formatMoneyInput(rubValue);
  const [rubDraft, setRubDraft] = useState(formattedRubValue);
  const [isRubFocused, setIsRubFocused] = useState(false);

  useEffect(() => {
    if (!isRubFocused) {
      setRubDraft(formattedRubValue);
    }
  }, [formattedRubValue, isRubFocused]);

  const setRub = (value: string) => {
    setRubDraft(value);
    const rub = parseInputNumber(value);
    onPercentChange(baseRub > 0 ? roundPercentInput((rub / baseRub) * 100) : 0);
  };

  return (
    <div className="markup-line">
      <span>{label}</span>
      <strong>{baseLabel}</strong>
      <label>
        <input
          aria-label={`${label}: процент наценки`}
          min="0"
          step="1"
          type="number"
          value={percent}
          onChange={(event) => onPercentChange(parseInputNumber(event.target.value))}
        />
      </label>
      <label>
        <input
          aria-label={`${label}: наценка, ${rubLabel}`}
          min="0"
          step="0.01"
          type="number"
          value={isRubFocused ? rubDraft : formattedRubValue}
          onBlur={() => {
            setIsRubFocused(false);
            setRubDraft(formatMoneyInput(roundRub(baseRub * (percent / 100))));
          }}
          onChange={(event) => setRub(event.target.value)}
          onFocus={() => {
            setIsRubFocused(true);
            setRubDraft(formattedRubValue);
          }}
        />
      </label>
    </div>
  );
}

function markupReferenceBases(settings: CalculatorSettings) {
  const firstMileRoute = tariffData.logistics.firstMile.routes?.find(
    (route) => route.originCity === settings.originCity && route.destinationCity === settings.firstMileCity
  );
  const middlePrices = tariffData.middleMile.tiers.map((tier) => tier.priceRub);
  const lastMileTariff = tariffData.logistics.pimLastMile;
  const lastMileRow = lastMileTariff.sellerTariffRows?.find((row) => row.city === settings.firstMileCity);
  const lastMileBaseSellerRub = settings.lastMileZone === "region" ? lastMileRow?.regionBaseRub : lastMileRow?.cityBaseRub;
  const lastMileAdditionalSellerRub = settings.lastMileZone === "region" ? lastMileRow?.regionExtraRubPerKg : lastMileRow?.cityExtraRubPerKg;

  return {
    firstMilePalletRub: firstMileRoute?.rubPerPallet ?? 0,
    middleMileFirstLiterRub: middlePrices[0] ?? 17.39,
    middleMileAdditionalLiterRub: middlePrices[1] ?? 2.83,
    lastMileIncludedKg: lastMileTariff.includedChargeableKg,
    lastMileBaseRub: (lastMileBaseSellerRub ?? lastMileTariff.baseRub) * lastMileTariff.costMultiplier,
    lastMileAdditionalKgRub: (lastMileAdditionalSellerRub ?? lastMileTariff.extraRubPerKg) * lastMileTariff.costMultiplier
  };
}

type MiddleMileMarkupSettingKey =
  | "middleMileFirstLiterMarkupPercent"
  | "middleMileAdditionalLiterMarkupPercent"
  | "middleMileOver190LiterMarkupPercent"
  | "middleMileFrom351To1000MarkupPercent"
  | "middleMileFrom1001MarkupPercent";

function middleMileMarkupRows(calculations: Array<{ sku: SkuInput }>): Array<{
  baseRub: number;
  label: string;
  rubLabel: string;
  settingKey: MiddleMileMarkupSettingKey;
}> {
  const prices = tariffData.middleMile.tiers.map((tier) => tier.priceRub);
  const rows: Array<{ baseRub: number; label: string; rubLabel: string; settingKey: MiddleMileMarkupSettingKey }> = [];
  const addRow = (row: { baseRub: number; label: string; rubLabel: string; settingKey: MiddleMileMarkupSettingKey }) => {
    if (!rows.some((item) => item.settingKey === row.settingKey)) rows.push(row);
  };

  const sortedVolumes = calculations.map(({ sku }) => calculateSkuMetrics(sku).volumeLiters).sort((left, right) => left - right);

  for (const volumeLiters of sortedVolumes) {
    if (volumeLiters <= 350) {
      addRow({
        label: "1 литр",
        rubLabel: "₽",
        baseRub: prices[0] ?? 17.39,
        settingKey: "middleMileFirstLiterMarkupPercent"
      });
    }

    if (volumeLiters > 1 && volumeLiters <= 350) {
      addRow({
        label: "2-190 л",
        rubLabel: "₽/л",
        baseRub: prices[1] ?? 2.83,
        settingKey: "middleMileAdditionalLiterMarkupPercent"
      });
    }

    if (volumeLiters > 190 && volumeLiters <= 350) {
      addRow({
        label: "191-350 л",
        rubLabel: "₽/л",
        baseRub: prices[3] ?? 3.26,
        settingKey: "middleMileOver190LiterMarkupPercent"
      });
    }

    if (volumeLiters > 350 && volumeLiters <= 1000) {
      addRow({
        label: "351-1000 л",
        rubLabel: "₽",
        baseRub: prices[4] ?? 2826.09,
        settingKey: "middleMileFrom351To1000MarkupPercent"
      });
    }

    if (volumeLiters > 1000) {
      addRow({
        label: "1001+ л",
        rubLabel: "₽",
        baseRub: prices[5] ?? 5434.78,
        settingKey: "middleMileFrom1001MarkupPercent"
      });
    }
  }

  if (!rows.length) {
    addRow({
      label: "1 литр",
      rubLabel: "₽",
      baseRub: prices[0] ?? 17.39,
      settingKey: "middleMileFirstLiterMarkupPercent"
    });
  }

  return rows;
}

function referenceWarehouseGroupBases(
  calculations: Array<{ sku: SkuInput; result: CalculationResult }>,
  vatDisplayMode: CalculatorSettings["vatDisplayMode"]
): Record<WarehouseOperationGroup, number> {
  const bases = Object.fromEntries(warehouseGroupOrder.map((group) => [group, 0])) as Record<WarehouseOperationGroup, number>;
  const firstFbs = calculations[0]?.result.wildberries.fbs;
  if (!firstFbs) return bases;

  for (const item of firstFbs.breakdown) {
    if (item.pimProfitCenter !== "warehouse" || !item.pimWarehouseGroup) continue;
    const costWithoutVat = item.pimCostWithoutVatRub ?? item.amountWithoutVatRub;
    bases[item.pimWarehouseGroup] += vatDisplayMode === "with_vat" ? costWithoutVat * 1.22 : costWithoutVat;
  }

  return Object.fromEntries(Object.entries(bases).map(([group, value]) => [group, roundRub(value)])) as Record<WarehouseOperationGroup, number>;
}

function warehousePriceListGroups(skus: SkuInput[], settings: CalculatorSettings, isFulfillmentExtrasOpen: boolean) {
  const operations = tariffData.warehouse.operations ?? [];
  return warehouseGroupOrder
    .map((group) => ({
      group,
      operations: operations
        .filter(
          (operation) => {
            if (warehouseGroupForOperation(operation.name) !== group || !isWarehouseOperationVisible(operation.name)) return false;
            if (group === "fulfillment" && isFulfillmentExtraOperation(operation.name)) {
              return isFulfillmentExtrasOpen || settings.warehouseFulfillmentExtraOperations[operation.name] === true;
            }
            return warehouseOperationMatchesCurrentSkus(operation.name, group, settings.warehouseSupplyType, skus);
          }
        )
        .sort((left, right) => warehouseOperationSortIndex(group, left.name) - warehouseOperationSortIndex(group, right.name))
    }))
    .filter((item) => item.operations.length > 0);
}

function warehouseOperationSortIndex(group: WarehouseOperationGroup, name: string): number {
  if (group !== "storage") return 0;
  const normalized = name.toLowerCase();
  if (normalized.includes("сортировка по артикулам")) return 0;
  if (normalized === "хранение товара") return 1;
  return 2;
}

function isWarehouseOperationVisible(name: string): boolean {
  const normalized = name.toLowerCase();
  return !normalized.includes("механизированная выгрузка/отгрузка паллеты, негабарит");
}

function displayWarehouseOperationName(name: string): string {
  if (name.toLowerCase() === "хранение товара") return "Хранение товара в литрах";
  return name
    .replaceAll("выгрузка/отгрузка", "выгрузка")
    .replaceAll("Выгрузка/отгрузка", "Выгрузка")
    .replaceAll("/Расформирование заказа", "")
    .replaceAll("пакет с клеевым клапаном", "пакет с клапаном");
}

function defaultWarehouseStorageMarkupPercent(operationKey: string): number {
  return operationKey.toLowerCase() === "хранение товара" ? 30 : 20;
}

function warehouseOperationKey(operation: { name: string; priceRub: number }): string {
  return isFulfillmentExtraOperation(operation.name) ? `${operation.name}::${operation.priceRub}` : operation.name;
}

function warehouseOperationMatchesCurrentSkus(
  name: string,
  group: WarehouseOperationGroup,
  supplyType: CalculatorSettings["warehouseSupplyType"],
  skus: SkuInput[]
): boolean {
  const normalized = name.toLowerCase();
  if (group === "receiving") {
    if (supplyType === "boxes") {
      return normalized.includes("ручная выгрузка/отгрузка") && skus.some((sku) => warehouseWeightRangeMatches(name, sku.weightKg));
    }
    return normalized === "механизированная выгрузка/отгрузка паллеты";
  }
  if (group === "storage") {
    if (supplyType === "mono_pallet") {
      return normalized === "хранение eur паллет (800х1200 вес до 1000 кг), высота до 1,8 м";
    }
    if (normalized === "хранение товара") return true;
    if (normalized.includes("сортировка по артикулам")) {
      return skus.some((sku) => warehouseWeightRangeMatches(name, sku.weightKg));
    }
    return false;
  }
  if (group === "fulfillment") {
    if (normalized.includes("комплектация/расформирование заказа")) {
      return skus.some((sku) => warehouseWeightRangeMatches(name, sku.weightKg));
    }
    return normalized.includes("маркировка ручная");
  }

  const weightRange = warehouseWeightRange(name);
  if (!weightRange) return true;
  return skus.some((sku) => sku.weightKg > weightRange.minKg && sku.weightKg <= weightRange.maxKg);
}

function warehouseWeightRange(name: string): { minKg: number; maxKg: number } | null {
  const normalized = name.replace(/\s/g, "").replaceAll(",", ".");
  if (normalized.includes("до1кг")) return { minKg: Number.NEGATIVE_INFINITY, maxKg: 1 };
  if (normalized.includes("до5кг")) return { minKg: Number.NEGATIVE_INFINITY, maxKg: 5 };
  if (normalized.includes("5.01-10кг")) return { minKg: 5, maxKg: 10 };
  if (normalized.includes("10.01-25кг")) return { minKg: 10, maxKg: 25 };
  if (normalized.includes("25.01-50кг")) return { minKg: 25, maxKg: 50 };
  if (normalized.includes("50.01-70кг")) return { minKg: 50, maxKg: 70 };
  if (normalized.includes("70.01-110кг")) return { minKg: 70, maxKg: 110 };
  return null;
}

function warehouseWeightRangeMatches(name: string, weightKg: number): boolean {
  const range = warehouseWeightRange(name);
  if (!range) return false;
  return weightKg > range.minKg && weightKg <= range.maxKg;
}

function warehouseGroupForOperation(name: string): WarehouseOperationGroup {
  const normalized = name.toLowerCase();
  if (normalized.includes("хранение")) return "storage";
  if (normalized.includes("сортировка по артикулам")) return "storage";
  if (normalized.includes("комплектация") || normalized.includes("расформирование")) return "fulfillment";
  if (normalized.includes("маркиров") || normalized.includes("стикер")) return "fulfillment";
  if (normalized.includes("выгрузка")) return "receiving";
  if (normalized.includes("отгрузка")) return "shipping";
  return "fulfillment";
}

function warehouseOperationSelected(
  group: WarehouseOperationGroup,
  operationName: string,
  supplyType: CalculatorSettings["warehouseSupplyType"],
  settings: CalculatorSettings
): boolean {
  const normalized = operationName.toLowerCase();
  if (group === "receiving") {
    if (supplyType === "boxes") return normalized.includes("ручная выгрузка/отгрузка");
    return normalized === "механизированная выгрузка/отгрузка паллеты";
  }
  if (group === "storage") {
    if (supplyType === "mono_pallet") {
      return normalized === "хранение eur паллет (800х1200 вес до 1000 кг), высота до 1,8 м";
    }
    return normalized === "хранение товара" || normalized.includes("сортировка по артикулам");
  }
  if (group === "fulfillment") {
    if (isFulfillmentExtraOperation(operationName)) return Object.entries(settings.warehouseFulfillmentExtraOperations).some(([key, value]) => value && key.startsWith(`${operationName}::`));
    return normalized.includes("комплектация/расформирование заказа") || normalized.includes("маркировка ручная");
  }
  return false;
}

function isFulfillmentExtraOperation(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("упаковка в пузырчатую пленку") ||
    normalized.includes("упаковка в термоусадочную пленку") ||
    normalized === "упаковка в пакет с клеевым клапаном" ||
    normalized === "упаковка в стрейч-пленку" ||
    normalized === "сканирование чз" ||
    normalized === "сканирование серийного номера"
  );
}

function displayWarehousePrice(priceRubWithoutVat: number, vatDisplayMode: CalculatorSettings["vatDisplayMode"]) {
  return roundRub(vatDisplayMode === "with_vat" ? priceRubWithoutVat * 1.22 : priceRubWithoutVat);
}

function ResultCell({ result, isBest }: { result: SchemeResult; isBest: boolean }) {
  return (
    <td className={[isBest ? "result-cell best" : "result-cell", result.isComplete ? "" : "incomplete"].join(" ")}>
      <div className="result-main">
        <strong>{result.isComplete ? formatRub(result.totalRub) : "Тариф не найден"}</strong>
        <span>{result.isComplete ? `${formatPercent(result.percentOfPrice)} от цены` : "Проверьте категорию"}</span>
      </div>
      {result.warnings.length > 0 ? (
        <div className="warning-list">
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <details>
        <summary>Статьи</summary>
        <ul className="breakdown-list">
          {result.breakdown.map((item) => (
            <li key={item.key}>
              <span className="breakdown-label">
                <span className="breakdown-title">
                  <span className="breakdown-name">{item.label}</span>
                </span>
                <small>{item.vatNote}</small>
                {item.internalNote ? <small>{item.internalNote}</small> : null}
              </span>
              <span className="breakdown-value">
                <BreakdownHelp item={item} />
                <strong>{formatRub(item.amountRub)}</strong>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </td>
  );
}

function BreakdownHelp({ item }: { item: SchemeResult["breakdown"][number] }) {
  const note = item.calculationNote ?? "Расчёт по выбранным параметрам SKU и тарифному справочнику.";
  return (
    <span className="help breakdown-help">
      <button type="button" className="help-trigger breakdown-help-trigger" aria-label={`Как считается ${item.label.toLowerCase()}?`}>
        ?
      </button>
      <span className="help-card breakdown-help-card" role="tooltip">
        <strong>{item.label}</strong>
        <span className="help-text">{note}</span>
        <span className="help-text help-total">
          Итого: {formatRub(item.amountRub)} {item.vatNote}.
        </span>
      </span>
    </span>
  );
}

function findBestResultsByMarketplace(result: CalculationResult) {
  return [findBestMarketplaceResult([result.wildberries.fbo, result.wildberries.fbs, result.wildberries.dbs]), findBestMarketplaceResult([result.ozon.fbo, result.ozon.fbs, result.ozon.dbs])];
}

function findBestMarketplaceResult(results: SchemeResult[]) {
  const complete = results.filter((item) => item.isComplete);
  const comparable = complete.length ? complete : results;
  return comparable.reduce((best, current) => (current.totalRub < best.totalRub ? current : best));
}

function sameResult(left: SchemeResult, right: SchemeResult) {
  return left.marketplace === right.marketplace && left.scheme === right.scheme;
}

function formatRub(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function pluralize(value: number, one: string, few: string, many: string) {
  const mod10 = Math.abs(value) % 10;
  const mod100 = Math.abs(value) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoneyInput(value: number) {
  return roundRub(value).toFixed(2);
}

function parseInputNumber(value: string) {
  return Number(value.replace(",", ".")) || 0;
}

function roundPercentInput(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function roundRub(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function displayPrice(priceRub: number, vatDisplayMode: CalculatorSettings["vatDisplayMode"]) {
  return vatDisplayMode === "with_vat" ? priceRub : priceRub / 1.22;
}
