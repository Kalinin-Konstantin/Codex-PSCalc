"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  breakdownItemsForDisplay,
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
  ozonCategories,
  ozonDeliveryClusters,
  ozonOriginClusters,
  ozonClusterForCity,
  ozonProductTypes,
  ozonProductTypesByCategory,
  tariffData,
  wbCategories,
  wbWarehousesForDestination,
  wbSubjects,
  wbSubjectsByCategory,
} from "../lib/tariffs";
import { createClientReportBlob } from "../lib/client-report";
import { createSkuImportTemplateBlob, importSkusFromXlsxFile } from "../lib/sku-import";
import { createSellerAction, saveCalculationAction } from "../app/calculations/actions";
import type { CalculatorWorkspace } from "../lib/saved-calculations";
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

type CalculatorAppProps = {
  workspace?: CalculatorWorkspace;
};

const workspaceMessages: Record<string, string> = {
  seller_created: "Селлер создан.",
  missing_seller_name: "Введите название селлера.",
  seller_error: "Не удалось создать селлера.",
  saved: "Расчёт сохранён.",
  save_missing_data: "Выберите селлера перед сохранением.",
  save_bad_snapshot: "Не удалось сохранить: данные расчёта повреждены.",
  save_forbidden: "Не удалось сохранить: расчёт или селлер недоступны для текущего пользователя.",
  save_error: "Не удалось сохранить расчёт."
};

export function CalculatorApp({ workspace }: CalculatorAppProps) {
  const [skus, setSkus] = useState<SkuInput[]>(workspace?.loadedCalculation?.snapshot.skus ?? defaultSkus);
  const [settings, setSettings] = useState<CalculatorSettings>(
    workspace?.loadedCalculation?.snapshot.settings ?? workspace?.defaultSettings ?? defaultSettings
  );
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [skuImportStatus, setSkuImportStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [calculationName, setCalculationName] = useState(
    workspace?.loadedCalculation?.name ?? `Расчёт ${new Date().toLocaleDateString("ru-RU")}`
  );
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

  const snapshotJson = useMemo(
    () =>
      JSON.stringify({
        version: 1,
        skus,
        settings
      }),
    [settings, skus]
  );

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

  async function handleSkuImport(file: File | null) {
    if (!file) return;
    try {
      const result = await importSkusFromXlsxFile(file, tariffData);
      if (!result.skus.length) {
        setSkuImportStatus({ kind: "error", message: result.warnings.join(" ") || "Не удалось загрузить SKU из файла." });
        return;
      }
      setSkus(result.skus);
      setSkuImportStatus({
        kind: result.warnings.length ? "error" : "success",
        message: result.warnings.length
          ? `Загружено SKU: ${result.skus.length}. Есть замечания: ${result.warnings.join(" ")}`
          : `Загружено SKU: ${result.skus.length}.`
      });
    } catch (error) {
      setSkuImportStatus({ kind: "error", message: error instanceof Error ? error.message : "Не удалось прочитать Excel-файл." });
    }
  }

  function downloadSkuTemplate() {
    const url = URL.createObjectURL(createSkuImportTemplateBlob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "Шаблон загрузки SKU PIM.Seller.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadClientReport() {
    const url = URL.createObjectURL(createClientReportBlob(skus, settings, tariffData));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Расчёт PIM.Seller для клиента ${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function updateDestinationCity(destinationCity: string) {
    const nextWarehouses = wbWarehousesForDestination(destinationCity);
    const nextOzonCluster = ozonClusterForCity(destinationCity);
    setSettings({
      ...settings,
      firstMileCity: destinationCity,
      wbWarehouse: nextWarehouses[0] ?? "",
      ozonOriginCluster: nextOzonCluster,
      ozonDeliveryCluster: nextOzonCluster
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

      {workspace ? (
        <WorkspacePanel
          workspace={workspace}
          calculationName={calculationName}
          snapshotJson={snapshotJson}
          onCalculationNameChange={setCalculationName}
        />
      ) : null}

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
              <span>Кластер отправки</span>
              <select
                value={settings.ozonOriginCluster}
                onChange={(event) => setSettings({ ...settings, ozonOriginCluster: event.target.value })}
              >
                {ozonOriginClusters.map((cluster) => (
                  <option key={cluster} value={cluster}>
                    {cluster}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Кластер доставки</span>
              <select
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
        <div className="section-heading sku-heading">
          <h2>SKU</h2>
          <div className="section-actions sku-actions">
            <div className="sku-action-group" aria-label="Импорт и экспорт SKU">
              <label className="file-button tool-button">
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    void handleSkuImport(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
                <span className="action-symbol" aria-hidden="true">↑</span>
                <span>Загрузить Excel</span>
              </label>
              <button className="link-button subtle tool-button" type="button" onClick={downloadSkuTemplate}>
                <span className="action-symbol" aria-hidden="true">↓</span>
                <span>Образец</span>
              </button>
              <button className="link-button subtle tool-button" type="button" onClick={downloadClientReport}>
                <span className="action-symbol" aria-hidden="true">↓</span>
                <span>Расчёт</span>
              </button>
            </div>
            <button className="primary-action" type="button" onClick={addSku}>
              <span className="action-symbol" aria-hidden="true">+</span>
              <span>Добавить SKU</span>
            </button>
          </div>
        </div>
        {skuImportStatus ? <p className={`import-status ${skuImportStatus.kind}`}>{skuImportStatus.message}</p> : null}
        <div className="sku-table-wrap">
          <table className="sku-table">
            <colgroup>
              <col className="sku-col-name" />
              <col className="sku-col-price" />
              <col className="sku-col-wb-category" />
              <col className="sku-col-wb-subject" />
              <col className="sku-col-ozon-category" />
              <col className="sku-col-ozon-type" />
              <col className="sku-col-weight" />
              <col className="sku-col-length" />
              <col className="sku-col-width" />
              <col className="sku-col-height" />
              <col className="sku-col-pallet" />
              <col className="sku-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Название</th>
                <th>Цена с НДС</th>
                <th>WB категория</th>
                <th>WB предмет</th>
                <th>Ozon категория</th>
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
                    <input title={sku.name} value={sku.name} onChange={(event) => updateSku(sku.id, { name: event.target.value })} />
                  </td>
                  <td>
                    <NumberInput value={sku.price} onChange={(value) => updateSkuNumber(sku.id, "price", value)} />
                  </td>
                  <td>
                    <input
                      list="wb-categories"
                      title={sku.wbCategory}
                      value={sku.wbCategory}
                      onChange={(event) => {
                        const wbCategory = canonicalLookupValue(event.target.value, wbCategories);
                        const categorySubjects = subjectsForWbCategory(wbCategory);
                        updateSku(sku.id, {
                          wbCategory,
                          wbSubject: hasLookupValue(categorySubjects, sku.wbSubject) ? canonicalLookupValue(sku.wbSubject, categorySubjects) : ""
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      list={`wb-subjects-${sku.id}`}
                      title={sku.wbSubject}
                      value={sku.wbSubject}
                      onChange={(event) => {
                        const wbSubject = canonicalLookupValue(event.target.value, subjectsForWbCategory(sku.wbCategory));
                        updateSku(sku.id, {
                          wbSubject,
                          wbCategory: categoryForWbSubject(wbSubject, sku.wbCategory) ?? sku.wbCategory
                        });
                      }}
                    />
                    <datalist id={`wb-subjects-${sku.id}`}>
                      {lookupDatalistValues(subjectsForWbCategory(sku.wbCategory)).map((subject) => (
                        <option key={subject} value={subject} />
                      ))}
                    </datalist>
                  </td>
                  <td>
                    <input
                      list="ozon-categories"
                      title={sku.ozonCategory}
                      value={sku.ozonCategory}
                      onChange={(event) => {
                        const ozonCategory = canonicalLookupValue(event.target.value, ozonCategories);
                        const categoryTypes = productTypesForOzonCategory(ozonCategory);
                        updateSku(sku.id, {
                          ozonCategory,
                          ozonProductType: hasLookupValue(categoryTypes, sku.ozonProductType) ? canonicalLookupValue(sku.ozonProductType, categoryTypes) : ""
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      list={`ozon-product-types-${sku.id}`}
                      title={sku.ozonProductType}
                      value={sku.ozonProductType}
                      onChange={(event) => {
                        const ozonProductType = canonicalLookupValue(event.target.value, productTypesForOzonCategory(sku.ozonCategory));
                        updateSku(sku.id, {
                          ozonProductType,
                          ozonCategory: categoryForOzonProductType(ozonProductType, sku.ozonCategory) ?? sku.ozonCategory
                        });
                      }}
                    />
                    <datalist id={`ozon-product-types-${sku.id}`}>
                      {lookupDatalistValues(productTypesForOzonCategory(sku.ozonCategory)).map((type) => (
                        <option key={type} value={type} />
                      ))}
                    </datalist>
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
        <datalist id="wb-categories">
          {lookupDatalistValues(wbCategories).map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <datalist id="ozon-categories">
          {lookupDatalistValues(ozonCategories).map((category) => (
            <option key={category} value={category} />
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

function WorkspacePanel({
  calculationName,
  onCalculationNameChange,
  snapshotJson,
  workspace
}: {
  calculationName: string;
  onCalculationNameChange: (value: string) => void;
  snapshotJson: string;
  workspace: CalculatorWorkspace;
}) {
  const hasSeller = Boolean(workspace.selectedSellerId);
  const ownerParam = workspace.canEdit ? "" : `owner=${encodeURIComponent(workspace.ownerId)}&`;
  const sellerUrl = (sellerId: string) => `/?${ownerParam}seller=${encodeURIComponent(sellerId)}`;
  const calculationUrl = (sellerId: string, calculationId: string) =>
    `/?${ownerParam}seller=${encodeURIComponent(sellerId)}&calculation=${encodeURIComponent(calculationId)}`;

  return (
    <section className="workspace-band" aria-label="Сохранение расчёта">
      <div className="workspace-main">
        <div className="settings-title">
          <span>Рабочее пространство</span>
          <strong>Селлер и сохранённые расчёты</strong>
          {!workspace.canEdit && workspace.ownerEmail ? <small>Просмотр расчётов пользователя {workspace.ownerEmail}</small> : null}
        </div>

        <div className="workspace-controls">
          <label>
            <span>Селлер</span>
            <select
              value={workspace.selectedSellerId}
              onChange={(event) => {
                if (event.target.value) window.location.href = sellerUrl(event.target.value);
              }}
              disabled={workspace.sellers.length === 0}
            >
              {workspace.sellers.length ? (
                workspace.sellers.map((seller) => (
                  <option key={seller.id} value={seller.id}>
                    {seller.name}
                  </option>
                ))
              ) : (
                <option value="">Сначала создайте селлера</option>
              )}
            </select>
          </label>

          <label>
            <span>Сохранённый расчёт</span>
            <select
              value={workspace.selectedCalculationId}
              onChange={(event) => {
                if (!event.target.value) {
                  window.location.href = sellerUrl(workspace.selectedSellerId);
                  return;
                }
                window.location.href = calculationUrl(workspace.selectedSellerId, event.target.value);
              }}
              disabled={!hasSeller || workspace.calculations.length === 0}
            >
              <option value="">Новый расчёт</option>
              {workspace.calculations.map((calculation) => (
                <option key={calculation.id} value={calculation.id}>
                  {calculation.name} · {formatDateTimeRu(calculation.updatedAt)}
                </option>
              ))}
            </select>
          </label>

          {workspace.canEdit ? (
            <form className="workspace-save-form" action={saveCalculationAction}>
              <input type="hidden" name="sellerId" value={workspace.selectedSellerId} />
              <input type="hidden" name="calculationId" value={workspace.selectedCalculationId} />
              <input type="hidden" name="snapshot" value={snapshotJson} readOnly />
              <label>
                <span>Название расчёта</span>
                <input
                  name="calculationName"
                  value={calculationName}
                  onChange={(event) => onCalculationNameChange(event.target.value)}
                  disabled={!hasSeller}
                  required
                />
              </label>
              <button type="submit" disabled={!hasSeller}>
                {workspace.selectedCalculationId ? "Сохранить изменения" : "Сохранить расчёт"}
              </button>
            </form>
          ) : (
            <div className="workspace-save-form readonly-save">
              <span>Название расчёта</span>
              <strong>{calculationName}</strong>
            </div>
          )}
        </div>

        {workspace.notice ? <p className="workspace-notice">{workspaceMessages[workspace.notice] ?? "Действие выполнено."}</p> : null}
      </div>

      {workspace.canEdit ? (
        <form className="workspace-create-seller" action={createSellerAction}>
          <label>
            <span>Новый селлер</span>
            <input name="sellerName" placeholder="Например, ООО Ромашка" required />
          </label>
          <button className="secondary-button" type="submit">Создать</button>
        </form>
      ) : (
        <div className="workspace-create-seller readonly-workspace">
          <span>Режим просмотра</span>
          <strong>Сохранение отключено</strong>
        </div>
      )}
    </section>
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
  const middleMileRows = middleMileMarkupRows(calculations);
  const updateOperationRowMarkup = (operationKey: string, value: number) =>
    onSettingsChange({
      warehouseOperationRowMarkupPercents: {
        ...settings.warehouseOperationRowMarkupPercents,
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
          <section className="markup-card">
            <div className="markup-card-title">
              <strong>Складские операции</strong>
              <div className="markup-card-actions">
                <button className="link-button" type="button" onClick={() => setIsWarehousePriceListOpen(true)}>
                  Прайс-лист
                </button>
              </div>
            </div>
          </section>
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
          onOperationRowMarkupChange={updateOperationRowMarkup}
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
            <colgroup>
              <col className="admin-col-sku" />
              <col className="admin-col-scheme" />
              {Array.from({ length: 5 }).flatMap((_, index) => [
                <col key={`cost-${index}`} className="admin-col-cost" />,
                <col key={`margin-${index}`} className="admin-col-margin" />
              ])}
            </colgroup>
            <thead>
              <tr>
                <th className="admin-dimension-head" rowSpan={2}>SKU</th>
                <th className="admin-dimension-head admin-scheme-head" rowSpan={2}>Схема</th>
                <th className="admin-profit-group" colSpan={2}>Первая миля</th>
                <th className="admin-profit-group" colSpan={2}>Складские операции</th>
                <th className="admin-profit-group" colSpan={2}>Средняя миля</th>
                <th className="admin-profit-group" colSpan={2}>Последняя миля</th>
                <th className="admin-profit-group admin-profit-total" colSpan={2}>Итого</th>
              </tr>
              <tr>
                <th className="admin-cost-cell">
                  <span className="admin-subhead">
                    Стоимость <small>итого</small>
                  </span>
                </th>
                <th className="admin-margin-cell">в т.ч. Маржа</th>
                <th className="admin-cost-cell">
                  <span className="admin-subhead">
                    Стоимость <small>итого</small>
                  </span>
                </th>
                <th className="admin-margin-cell">в т.ч. Маржа</th>
                <th className="admin-cost-cell">
                  <span className="admin-subhead">
                    Стоимость <small>итого</small>
                  </span>
                </th>
                <th className="admin-margin-cell">в т.ч. Маржа</th>
                <th className="admin-cost-cell">
                  <span className="admin-subhead">
                    Стоимость <small>итого</small>
                  </span>
                </th>
                <th className="admin-margin-cell">в т.ч. Маржа</th>
                <th className="admin-cost-cell admin-total-cell">
                  <span className="admin-subhead">
                    Стоимость <small>итого</small>
                  </span>
                </th>
                <th className="admin-margin-cell admin-total-cell">в т.ч. Маржа</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) =>
                group.rows.map((row, rowIndex) => (
                  <tr key={`${group.skuId}-${row.scheme}`}>
                    {rowIndex === 0 ? (
                      <td className="admin-group-cell sku-cell" rowSpan={group.rows.length}>
                        {group.skuName}
                      </td>
                    ) : null}
                    <td className="admin-scheme-cell">{labelForScheme(row.scheme)}</td>
                    <td className="admin-value admin-cost-cell">{formatRub(row.summary.firstMile.total)}</td>
                    <td className="admin-value admin-margin-cell">{formatRub(row.summary.firstMile.margin)}</td>
                    <td className="admin-value admin-cost-cell">{formatRub(row.summary.warehouse.total)}</td>
                    <td className="admin-value admin-margin-cell">{formatRub(row.summary.warehouse.margin)}</td>
                    <td className="admin-value admin-cost-cell">{formatRub(row.summary.middleMile.total)}</td>
                    <td className="admin-value admin-margin-cell">{formatRub(row.summary.middleMile.margin)}</td>
                    <td className="admin-value admin-cost-cell">{formatRub(row.summary.lastMile.total)}</td>
                    <td className="admin-value admin-margin-cell">{formatRub(row.summary.lastMile.margin)}</td>
                    <td className="admin-value admin-cost-cell admin-total-cell"><strong>{formatRub(row.summary.total.total)}</strong></td>
                    <td className="admin-value admin-margin-cell admin-total-cell"><strong>{formatRub(row.summary.total.margin)}</strong></td>
                  </tr>
                ))
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
    const rows = (["fbs", "dbs"] as const).map((scheme) => ({
      scheme,
      summary: summarizePimMargin(result.wildberries[scheme], vatDisplayMode)
    }));
    return {
      skuId: sku.id,
      skuName: sku.name,
      rows
    };
  });
}

type MarginSummary = Record<PimProfitCenter | "total", { total: number; margin: number }>;

function summarizePimMargin(result: SchemeResult, vatDisplayMode: CalculatorSettings["vatDisplayMode"]): MarginSummary {
  const summary: MarginSummary = {
    firstMile: { total: 0, margin: 0 },
    warehouse: { total: 0, margin: 0 },
    middleMile: { total: 0, margin: 0 },
    lastMile: { total: 0, margin: 0 },
    total: { total: 0, margin: 0 }
  };

  for (const item of result.breakdown) {
    if (!item.pimProfitCenter) continue;
    const costWithoutVat = item.pimCostWithoutVatRub ?? item.amountWithoutVatRub;
    const cost = vatDisplayMode === "with_vat" ? costWithoutVat * 1.22 : costWithoutVat;
    const profit = vatDisplayMode === "with_vat" ? item.pimProfitWithVatRub ?? 0 : item.pimProfitWithoutVatRub ?? 0;
    summary[item.pimProfitCenter].total += cost + profit;
    summary[item.pimProfitCenter].margin += profit;
    summary.total.total += cost + profit;
    summary.total.margin += profit;
  }

  return {
    firstMile: { total: roundRub(summary.firstMile.total), margin: roundRub(summary.firstMile.margin) },
    warehouse: { total: roundRub(summary.warehouse.total), margin: roundRub(summary.warehouse.margin) },
    middleMile: { total: roundRub(summary.middleMile.total), margin: roundRub(summary.middleMile.margin) },
    lastMile: { total: roundRub(summary.lastMile.total), margin: roundRub(summary.lastMile.margin) },
    total: { total: roundRub(summary.total.total), margin: roundRub(summary.total.margin) }
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
  onOperationRowMarkupChange,
  onSupplyTypeChange,
  skus,
  settings
}: {
  isFulfillmentExtrasOpen: boolean;
  onClose: () => void;
  onFulfillmentExtraChange: (operationKey: string, isSelected: boolean) => void;
  onFulfillmentExtrasToggle: () => void;
  onOperationRowMarkupChange: (operationKey: string, value: number) => void;
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
                  const operationKey = warehouseOperationKey(operation, group);
                  const markupPercent = warehouseOperationMarkupPercent(settings, group, operationKey);
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
                              aria-label={`${displayWarehouseOperationName(operation.name, group)}: участвует в расчете`}
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
                          <span className="operation-name-with-help">
                            <span>{displayWarehouseOperationName(operation.name, group)}</span>
                            {operation.description ? (
                              <span className="help operation-help">
                                <button type="button" className="help-trigger" aria-label={`Описание операции ${displayWarehouseOperationName(operation.name, group)}`}>
                                  ?
                                </button>
                                <span className="help-card" role="tooltip">
                                  <span className="help-text">{operation.description}</span>
                                </span>
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td>{operation.unit}</td>
                      <td className="numeric">{formatRub(costRub)}</td>
                      <td className="numeric price-list-markup">
                        <input
                          aria-label={`${displayWarehouseOperationName(operation.name, group)}: процент наценки`}
                          min="0"
                          step="1"
                          type="number"
                          value={markupPercent}
                          onChange={(event) => onOperationRowMarkupChange(operationKey, parseInputNumber(event.target.value))}
                        />
                      </td>
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

function warehousePriceListGroups(skus: SkuInput[], settings: CalculatorSettings, isFulfillmentExtrasOpen: boolean) {
  const operations = tariffData.warehouse.operations ?? [];
  return warehouseGroupOrder
    .map((group) => ({
      group,
      operations: operations
        .filter(
          (operation) => {
            if (!warehouseOperationBelongsToGroup(operation.name, group) || !isWarehouseOperationVisible(operation.name)) return false;
            if (group === "fulfillment" && isFulfillmentExtraOperation(operation.name)) {
              if (!warehouseExtraOperationMatchesCurrentSkus(operation.name, skus)) return false;
              return isFulfillmentExtrasOpen || settings.warehouseFulfillmentExtraOperations[warehouseOperationKey(operation, group)] === true;
            }
            return warehouseOperationMatchesCurrentSkus(operation.name, group, settings.warehouseSupplyType, skus);
          }
        )
        .sort((left, right) => warehouseOperationSortIndex(group, left.name) - warehouseOperationSortIndex(group, right.name))
    }))
    .filter((item) => item.operations.length > 0);
}

function warehouseOperationSortIndex(group: WarehouseOperationGroup, name: string): number {
  const normalized = name.toLowerCase();
  if (group === "fulfillment") {
    if (normalized.includes("комплектация/расформирование заказа")) return 0;
    if (normalized.includes("маркировка ручная")) return 1;
    if (normalized === "сканирование чз") return 2;
    if (normalized === "сканирование серийного номера") return 3;
    if (normalized === "упаковка в пакет с клеевым клапаном") return 4;
    if (normalized === "упаковка в стрейч-пленку") return 5;
    if (normalized.includes("упаковка в пузырчатую пленку")) return 6;
    if (normalized.includes("упаковка в термоусадочную пленку")) return 7;
    return 99;
  }
  if (group !== "storage") return 0;
  if (normalized.includes("сортировка по артикулам")) return 0;
  if (normalized === "хранение товара") return 1;
  return 2;
}

function isWarehouseOperationVisible(name: string): boolean {
  const normalized = name.toLowerCase();
  return !normalized.includes("механизированная выгрузка/отгрузка паллеты, негабарит");
}

function displayWarehouseOperationName(name: string, group?: WarehouseOperationGroup): string {
  if (group === "shipping") {
    return name
      .replaceAll("Ручная выгрузка/отгрузка", "Ручная отгрузка")
      .replaceAll("ручная выгрузка/отгрузка", "ручная отгрузка");
  }
  if (name.toLowerCase() === "хранение товара") return "Хранение товара в литрах";
  return name
    .replaceAll("выгрузка/отгрузка", "выгрузка")
    .replaceAll("Выгрузка/отгрузка", "Выгрузка")
    .replaceAll("/Расформирование заказа", "")
    .replaceAll("пакет с клеевым клапаном", "пакет с клапаном")
    .replaceAll(", объем > 2-х литров < 5 литров", ", объем > 2 литров");
}

function warehouseOperationMarkupPercent(settings: CalculatorSettings, group: WarehouseOperationGroup, operationKey: string): number {
  return (
    settings.warehouseOperationRowMarkupPercents[operationKey] ??
    defaultWarehouseOperationRowMarkupPercent(settings, group, operationKey) ??
    settings.warehouseMarkupPercent ??
    20
  );
}

function defaultWarehouseOperationRowMarkupPercent(settings: CalculatorSettings, group: WarehouseOperationGroup, operationKey: string): number {
  const groupPercent = settings.warehouseOperationMarkupPercents[group];
  if (group === "storage" && operationKey.toLowerCase() === "хранение товара" && groupPercent === 20) return 30;
  return groupPercent ?? 20;
}

function warehouseOperationKey(operation: { name: string; priceRub: number }, group?: WarehouseOperationGroup): string {
  if (group === "shipping") return `shipping:${operation.name}`;
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
  if (group === "shipping") {
    return normalized.includes("ручная выгрузка/отгрузка") && skus.some((sku) => warehouseWeightRangeMatches(name, sku.weightKg));
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

function warehouseExtraOperationMatchesCurrentSkus(name: string, skus: SkuInput[]): boolean {
  const range = warehouseOperationVolumeRange(name);
  if (!range) return true;
  return skus.some((sku) => {
    const { volumeLiters } = calculateSkuMetrics(sku);
    return volumeLiters > range.minLiter && volumeLiters < range.maxLiter;
  });
}

function warehouseOperationVolumeRange(name: string): { minLiter: number; maxLiter: number } | null {
  const normalized = normalizeWarehouseOperationName(name);
  if (normalized.includes("объем<2литров")) return { minLiter: Number.NEGATIVE_INFINITY, maxLiter: 2 };
  if (normalized.includes("объем>2-хлитров<5литров") || normalized.includes("объем>2литров<5литров")) return { minLiter: 2, maxLiter: Number.POSITIVE_INFINITY };
  return null;
}

function normalizeWarehouseOperationName(name: string): string {
  return name.toLowerCase().replaceAll("ё", "е").replace(/\s/g, "");
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

function warehouseOperationBelongsToGroup(name: string, group: WarehouseOperationGroup): boolean {
  const normalized = name.toLowerCase();
  if (group === "receiving" && normalized.includes("ручная выгрузка/отгрузка")) return true;
  if (group === "shipping" && normalized.includes("ручная выгрузка/отгрузка")) return true;
  return warehouseGroupForOperation(name) === group;
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
  if (group === "shipping") return normalized.includes("ручная выгрузка/отгрузка");
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

function canonicalLookupValue(value: string, options: string[]): string {
  const normalized = normalizeLookupValue(value);
  return options.find((option) => normalizeLookupValue(option) === normalized) ?? value;
}

function hasLookupValue(options: string[], value: string): boolean {
  const normalized = normalizeLookupValue(value);
  return options.some((option) => normalizeLookupValue(option) === normalized);
}

function lookupDatalistValues(options: string[]): string[] {
  return Array.from(
    new Set(
      options.flatMap((option) => {
        const lowerOption = normalizeLookupValue(option);
        return lowerOption === option ? [option] : [option, lowerOption];
      })
    )
  );
}

function normalizeLookupValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/ё/g, "е").replace(/Ё/g, "Е").toLocaleLowerCase("ru-RU");
}

function subjectsForWbCategory(category: string): string[] {
  const exactCategory = canonicalLookupValue(category, wbCategories);
  return wbSubjectsByCategory[exactCategory] ?? wbSubjects;
}

function productTypesForOzonCategory(category: string): string[] {
  const exactCategory = canonicalLookupValue(category, ozonCategories);
  return ozonProductTypesByCategory[exactCategory] ?? ozonProductTypes;
}

function categoryForWbSubject(subject: string, currentCategory: string): string | null {
  const entries = tariffData.wildberriesCommissions.filter((item) => normalizeLookupValue(item.subject) === normalizeLookupValue(subject));
  if (!entries.length) return null;
  return entries.find((item) => normalizeLookupValue(item.category) === normalizeLookupValue(currentCategory))?.category ?? entries[0].category;
}

function categoryForOzonProductType(productType: string, currentCategory: string): string | null {
  const entries = tariffData.ozonCommissions.filter((item) => normalizeLookupValue(item.productType) === normalizeLookupValue(productType));
  if (!entries.length) return null;
  return entries.find((item) => normalizeLookupValue(item.category) === normalizeLookupValue(currentCategory))?.category ?? entries[0].category;
}

function ResultCell({ result, isBest }: { result: SchemeResult; isBest: boolean }) {
  const displayBreakdown = breakdownItemsForDisplay(result);

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
          {displayBreakdown.map((item) => (
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
          {item.isReferenceOnly ? "Справочно" : "Итого"}: {formatRub(item.amountRub)} {item.vatNote}.
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
