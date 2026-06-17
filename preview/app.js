const schemes = ["fbo", "fbs", "dbs"];
const columns = [
  ["wildberries", "fbo"],
  ["wildberries", "fbs"],
  ["wildberries", "dbs"],
  ["ozon", "fbo"],
  ["ozon", "fbs"],
  ["ozon", "dbs"]
];

let skus = structuredClone(window.__PIM_DATA__.defaultSkus);
let settings = structuredClone(window.__PIM_DATA__.defaultSettings);
let originCityQuery = settings.originCity;
let isAdminOpen = false;
let isFulfillmentExtrasOpen = false;

const $ = (id) => document.getElementById(id);
const cityCollator = new Intl.Collator("ru");
const sortedOriginCities = [...window.__PIM_DATA__.originCities].sort(cityCollator.compare);
const formatRub = (value) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const formatPercent = (value) => new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 }).format(value);
const formatNumber = (value) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const formatMoneyInput = (value) => money(value).toFixed(2);
const parseInputNumber = (value) => Number(String(value).replace(",", ".")) || 0;
const percentInput = (value) => Math.round((value + Number.EPSILON) * 10000) / 10000;
const safeDivide = (a, b) => (b > 0 ? a / b : 0);
const VAT_RATE = 0.22;
const WB_FAST_HANDOVER_DISCOUNT = 0.015;
const wbTariffInfo = window.__PIM_DATA__.logistics.wildberriesLogistics;
const warehouseGroupOrder = ["receiving", "storage", "fulfillment", "shipping"];
const warehouseGroupDetails = {
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
const warehouseSupplyTypeOptions = [
  { value: "mono_pallet", label: "Монопаллета" },
  { value: "mix_pallet", label: "Микспаллета" },
  { value: "boxes", label: "Короба" }
];
settings.warehouseSupplyType = settings.warehouseSupplyType ?? "mono_pallet";
settings.warehouseOperationGroups = settings.warehouseOperationGroups ?? {
  receiving: true,
  storage: true,
  fulfillment: true,
  shipping: true
};
settings.warehouseOperationMarkupPercents = settings.warehouseOperationMarkupPercents ?? {
  receiving: settings.warehouseMarkupPercent ?? 20,
  storage: settings.warehouseMarkupPercent ?? 20,
  fulfillment: settings.warehouseMarkupPercent ?? 20,
  shipping: settings.warehouseMarkupPercent ?? 20
};
settings.warehouseReceivingMarkupPercents = settings.warehouseReceivingMarkupPercents ?? {};
settings.warehouseStorageMarkupPercents = settings.warehouseStorageMarkupPercents ?? {};
settings.warehouseFulfillmentExtraOperations = settings.warehouseFulfillmentExtraOperations ?? {};

function init() {
  initOriginCityCombobox();
  fillSelect("first-mile-city", window.__PIM_DATA__.destinationCities, settings.firstMileCity);
  renderWbWarehouseSelect();
  $("last-mile-zone").value = settings.lastMileZone;
  $("wb-supply-type").value = settings.wbSupplyType;
  $("ozon-delivery-mode").value = settings.ozonDeliveryMode;
  renderOzonDeliveryClusterSelect();
  $("storage-days").value = settings.storageDays;
  $("fast-handover").checked = settings.fastHandover;
  $("ozon-fast-handover-type").value = settings.ozonFastHandoverType;
  $("ozon-fast-handover-type").disabled = !settings.fastHandover;
  $("vat-display-mode").value = settings.vatDisplayMode;
  syncMarkupInputs();
  $("localization-index").value = settings.localizationIndex;
  $("sales-distribution-index").value = settings.salesDistributionIndex;
  fillDatalist("wb-subjects", window.__PIM_DATA__.wbSubjects);
  fillDatalist("ozon-product-types", window.__PIM_DATA__.ozonProductTypes);

  $("first-mile-city").addEventListener("change", (event) => {
    settings.firstMileCity = event.target.value;
    const nextWarehouses = wbWarehousesForDestination(settings.firstMileCity);
    settings.wbWarehouse = nextWarehouses[0] ?? "";
    renderWbWarehouseSelect();
    render();
  });
  $("last-mile-zone").addEventListener("change", (event) => {
    settings.lastMileZone = event.target.value;
    render();
  });
  $("wb-warehouse").addEventListener("change", (event) => {
    settings.wbWarehouse = event.target.value;
    render();
  });
  $("wb-supply-type").addEventListener("change", (event) => {
    settings.wbSupplyType = event.target.value;
    render();
  });
  $("ozon-delivery-mode").addEventListener("change", (event) => {
    settings.ozonDeliveryMode = event.target.value;
    renderOzonDeliveryClusterSelect();
    render();
  });
  $("ozon-delivery-cluster").addEventListener("change", (event) => {
    settings.ozonDeliveryCluster = event.target.value;
    render();
  });
  $("storage-days").addEventListener("input", (event) => {
    settings.storageDays = Number(event.target.value) || 0;
    render();
  });
  $("fast-handover").addEventListener("change", (event) => {
    settings.fastHandover = event.target.checked;
    $("ozon-fast-handover-type").disabled = !settings.fastHandover;
    render();
  });
  $("ozon-fast-handover-type").addEventListener("change", (event) => {
    settings.ozonFastHandoverType = event.target.value;
    render();
  });
  $("vat-display-mode").addEventListener("change", (event) => {
    settings.vatDisplayMode = event.target.value;
    render();
  });
  $("admin-trigger").addEventListener("click", () => {
    isAdminOpen = true;
    render();
  });
  $("admin-close").addEventListener("click", () => {
    isAdminOpen = false;
    render();
  });
  $("warehouse-price-list-open").addEventListener("click", () => {
    openWarehousePriceList();
  });
  [
    ["first-mile-markup-percent", "firstMileMarkupPercent"],
    ["middle-mile-first-liter-markup-percent", "middleMileFirstLiterMarkupPercent"],
    ["middle-mile-additional-liter-markup-percent", "middleMileAdditionalLiterMarkupPercent"],
    ["middle-mile-over-190-liter-markup-percent", "middleMileOver190LiterMarkupPercent"],
    ["middle-mile-from-351-markup-percent", "middleMileFrom351To1000MarkupPercent"],
    ["middle-mile-from-1001-markup-percent", "middleMileFrom1001MarkupPercent"],
    ["last-mile-base-markup-percent", "lastMileBaseMarkupPercent"],
    ["last-mile-additional-kg-markup-percent", "lastMileAdditionalKgMarkupPercent"]
  ].forEach(([id, field]) => {
    $(id).addEventListener("input", (event) => {
      settings[field] = parseInputNumber(event.target.value);
      render();
    });
    $(id).addEventListener("blur", () => {
      syncMarkupInputs();
    });
  });
  [
    ["first-mile-markup-rub", "firstMileMarkupPercent", "firstMilePalletRub"],
    ["middle-mile-first-liter-markup-rub", "middleMileFirstLiterMarkupPercent", "middleMileFirstLiterRub"],
    ["middle-mile-additional-liter-markup-rub", "middleMileAdditionalLiterMarkupPercent", "middleMileAdditionalLiterRub"],
    ["middle-mile-over-190-liter-markup-rub", "middleMileOver190LiterMarkupPercent", "middleMileOver190LiterRub"],
    ["middle-mile-from-351-markup-rub", "middleMileFrom351To1000MarkupPercent", "middleMileFrom351To1000Rub"],
    ["middle-mile-from-1001-markup-rub", "middleMileFrom1001MarkupPercent", "middleMileFrom1001Rub"],
    ["last-mile-base-markup-rub", "lastMileBaseMarkupPercent", "lastMileBaseRub"],
    ["last-mile-additional-kg-markup-rub", "lastMileAdditionalKgMarkupPercent", "lastMileAdditionalKgRub"]
  ].forEach(([id, field, baseKey]) => {
    $(id).addEventListener("input", (event) => {
      const base = markupReferenceBases()[baseKey] ?? 0;
      settings[field] = base > 0 ? percentInput((parseInputNumber(event.target.value) / base) * 100) : 0;
      render();
    });
    $(id).addEventListener("blur", () => {
      syncMarkupInputs();
    });
  });
  $("localization-index").addEventListener("input", (event) => {
    settings.localizationIndex = Number(event.target.value) || 0;
    render();
  });
  $("sales-distribution-index").addEventListener("input", (event) => {
    settings.salesDistributionIndex = Number(event.target.value) || 0;
    render();
  });
  $("add-sku").addEventListener("click", () => {
    const next = structuredClone(skus[skus.length - 1]);
    next.id = crypto.randomUUID();
    next.name = `SKU ${skus.length + 1}`;
    skus.push(next);
    render();
  });
  render();
}

function fillSelect(id, values, selected) {
  $(id).innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  $(id).value = selected;
}

function fillDatalist(id, values) {
  $(id).innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function initOriginCityCombobox() {
  const input = $("origin-city");
  input.value = settings.originCity;
  renderOriginCityOptions();
  input.addEventListener("focus", () => {
    showOriginCityMenu();
  });
  input.addEventListener("input", (event) => {
    originCityQuery = event.target.value;
    renderOriginCityOptions();
    showOriginCityMenu();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitClosestOriginCity();
    }
    if (event.key === "Escape") {
      originCityQuery = settings.originCity;
      input.value = settings.originCity;
      hideOriginCityMenu();
    }
  });
  input.addEventListener("blur", () => {
    commitClosestOriginCity();
  });
}

function filteredOriginCities() {
  const needle = originCityQuery.trim().toLocaleLowerCase("ru");
  if (!needle) return sortedOriginCities;
  return sortedOriginCities.filter((city) => city.toLocaleLowerCase("ru").includes(needle));
}

function renderOriginCityOptions() {
  const menu = $("origin-city-menu");
  const cities = filteredOriginCities();
  menu.innerHTML = cities.length
    ? cities
        .map(
          (city) =>
            `<button type="button" class="combo-option" role="option" aria-selected="${city === settings.originCity}" data-origin-city="${escapeHtml(city)}">${escapeHtml(city)}</button>`
        )
        .join("")
    : `<div class="combo-empty">Город не найден</div>`;
  menu.querySelectorAll("[data-origin-city]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      chooseOriginCity(event.currentTarget.dataset.originCity);
    });
  });
}

function showOriginCityMenu() {
  const input = $("origin-city");
  const menu = $("origin-city-menu");
  input.setAttribute("aria-expanded", "true");
  menu.hidden = false;
}

function hideOriginCityMenu() {
  const input = $("origin-city");
  const menu = $("origin-city-menu");
  input.setAttribute("aria-expanded", "false");
  menu.hidden = true;
}

function chooseOriginCity(city) {
  if (!city) return;
  settings.originCity = city;
  originCityQuery = city;
  $("origin-city").value = city;
  renderOriginCityOptions();
  hideOriginCityMenu();
}

function commitClosestOriginCity() {
  const normalizedQuery = originCityQuery.trim().toLocaleLowerCase("ru");
  const exactMatch = sortedOriginCities.find((city) => city.toLocaleLowerCase("ru") === normalizedQuery);
  const closestCity = exactMatch ?? filteredOriginCities()[0];
  if (closestCity) {
    chooseOriginCity(closestCity);
    return;
  }
  originCityQuery = settings.originCity;
  $("origin-city").value = settings.originCity;
  hideOriginCityMenu();
}

function wbWarehousesForDestination(destinationCity) {
  return window.__PIM_DATA__.wbWarehousesByDestination[destinationCity] ?? [];
}

function renderWbWarehouseSelect() {
  const warehouses = wbWarehousesForDestination(settings.firstMileCity);
  const select = $("wb-warehouse");
  select.disabled = warehouses.length === 0;
  select.innerHTML = warehouses.length
    ? warehouses.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")
    : `<option value="">Нет склада WB для города</option>`;
  select.value = warehouses.includes(settings.wbWarehouse) ? settings.wbWarehouse : "";
}

function renderOzonDeliveryClusterSelect() {
  const select = $("ozon-delivery-cluster");
  if (settings.ozonDeliveryMode === "local") {
    select.disabled = true;
    select.innerHTML = `<option value="">—</option>`;
    select.value = "";
    return;
  }
  select.disabled = false;
  fillSelect("ozon-delivery-cluster", window.__PIM_DATA__.ozonDeliveryClusters, settings.ozonDeliveryCluster);
}

function render() {
  settings.presentationMode = isAdminOpen ? "internal" : "client";
  document.querySelector(".vat-badge").textContent = settings.vatDisplayMode === "with_vat" ? "Суммы с НДС 22%" : "Суммы без НДС";
  $("admin-panel").hidden = !isAdminOpen;
  syncMarkupInputs();
  renderSkuEditor();
  renderResults();
}

function syncMarkupInputs() {
  const bases = markupReferenceBases();
  const warehouseBase = referenceWarehouseGroupBases();
  $("first-mile-base-label").textContent = formatRub(bases.firstMilePalletRub);
  syncInputValue("first-mile-markup-percent", settings.firstMileMarkupPercent);
  syncInputValue("first-mile-markup-rub", formatMoneyInput(bases.firstMilePalletRub * (settings.firstMileMarkupPercent / 100)));
  renderWarehouseMarkupLines(warehouseBase);
  syncMiddleMileMarkupRows();
  $("middle-mile-first-liter-base-label").textContent = formatRub(bases.middleMileFirstLiterRub);
  syncInputValue("middle-mile-first-liter-markup-percent", settings.middleMileFirstLiterMarkupPercent);
  syncInputValue("middle-mile-first-liter-markup-rub", formatMoneyInput(bases.middleMileFirstLiterRub * (settings.middleMileFirstLiterMarkupPercent / 100)));
  $("middle-mile-additional-liter-base-label").textContent = formatRub(bases.middleMileAdditionalLiterRub);
  syncInputValue("middle-mile-additional-liter-markup-percent", settings.middleMileAdditionalLiterMarkupPercent);
  syncInputValue("middle-mile-additional-liter-markup-rub", formatMoneyInput(bases.middleMileAdditionalLiterRub * (settings.middleMileAdditionalLiterMarkupPercent / 100)));
  $("middle-mile-over-190-liter-base-label").textContent = formatRub(bases.middleMileOver190LiterRub);
  syncInputValue("middle-mile-over-190-liter-markup-percent", settings.middleMileOver190LiterMarkupPercent);
  syncInputValue("middle-mile-over-190-liter-markup-rub", formatMoneyInput(bases.middleMileOver190LiterRub * (settings.middleMileOver190LiterMarkupPercent / 100)));
  $("middle-mile-from-351-base-label").textContent = formatRub(bases.middleMileFrom351To1000Rub);
  syncInputValue("middle-mile-from-351-markup-percent", settings.middleMileFrom351To1000MarkupPercent);
  syncInputValue("middle-mile-from-351-markup-rub", formatMoneyInput(bases.middleMileFrom351To1000Rub * (settings.middleMileFrom351To1000MarkupPercent / 100)));
  $("middle-mile-from-1001-base-label").textContent = formatRub(bases.middleMileFrom1001Rub);
  syncInputValue("middle-mile-from-1001-markup-percent", settings.middleMileFrom1001MarkupPercent);
  syncInputValue("middle-mile-from-1001-markup-rub", formatMoneyInput(bases.middleMileFrom1001Rub * (settings.middleMileFrom1001MarkupPercent / 100)));
  $("last-mile-base-markup-label").textContent = `До ${formatNumber(bases.lastMileIncludedKg)} кг`;
  $("last-mile-base-label").textContent = formatRub(bases.lastMileBaseRub);
  syncInputValue("last-mile-base-markup-percent", settings.lastMileBaseMarkupPercent);
  syncInputValue("last-mile-base-markup-rub", formatMoneyInput(bases.lastMileBaseRub * (settings.lastMileBaseMarkupPercent / 100)));
  $("last-mile-additional-kg-base-label").textContent = formatRub(bases.lastMileAdditionalKgRub);
  syncInputValue("last-mile-additional-kg-markup-percent", settings.lastMileAdditionalKgMarkupPercent);
  syncInputValue("last-mile-additional-kg-markup-rub", formatMoneyInput(bases.lastMileAdditionalKgRub * (settings.lastMileAdditionalKgMarkupPercent / 100)));
}

function syncInputValue(id, value) {
  if (document.activeElement?.id === id) return;
  $(id).value = value;
}

function renderWarehouseMarkupLines(bases) {
  $("warehouse-markup-lines").innerHTML = warehouseGroupOrder
    .filter((group) => settings.warehouseOperationGroups[group])
    .map((group) => {
      const percent = settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
      const baseRub = bases[group] ?? 0;
      return `
        <div class="markup-line">
          <span>${escapeHtml(warehouseGroupDetails[group].label)}</span>
          <strong>${formatRub(baseRub)}</strong>
          <label><input data-warehouse-group="${group}" aria-label="${escapeHtml(warehouseGroupDetails[group].label)}: процент наценки" min="0" step="1" type="number" value="${percent}" /></label>
          <label><input data-warehouse-group-rub="${group}" aria-label="${escapeHtml(warehouseGroupDetails[group].label)}: наценка, ₽" min="0" step="0.01" type="number" value="${formatMoneyInput(baseRub * (percent / 100))}" /></label>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-warehouse-group]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const group = event.target.dataset.warehouseGroup;
      settings.warehouseOperationMarkupPercents[group] = parseInputNumber(event.target.value);
      renderResults();
    });
  });
  document.querySelectorAll("[data-warehouse-group-rub]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const group = event.target.dataset.warehouseGroupRub;
      const baseRub = referenceWarehouseGroupBases()[group] ?? 0;
      settings.warehouseOperationMarkupPercents[group] = baseRub > 0 ? percentInput((parseInputNumber(event.target.value) / baseRub) * 100) : 0;
      renderResults();
    });
  });
}

function markupReferenceBases() {
  const route = window.__PIM_DATA__.logistics.firstMile.routes?.find(
    (item) => item.originCity === settings.originCity && item.destinationCity === settings.firstMileCity
  );
  const middlePrices = window.__PIM_DATA__.middleMile.tiers.map((tier) => tier.priceRub);
  const lastMileTariff = window.__PIM_DATA__.logistics.pimLastMile;
  const lastMileRow = lastMileTariff.sellerTariffRows?.find((row) => row.city === settings.firstMileCity);
  const lastMileBaseSellerRub = settings.lastMileZone === "region" ? lastMileRow?.regionBaseRub : lastMileRow?.cityBaseRub;
  const lastMileAdditionalSellerRub = settings.lastMileZone === "region" ? lastMileRow?.regionExtraRubPerKg : lastMileRow?.cityExtraRubPerKg;

  return {
    firstMilePalletRub: route?.rubPerPallet ?? 0,
    middleMileFirstLiterRub: middlePrices[0] ?? 17.39,
    middleMileAdditionalLiterRub: middlePrices[1] ?? 2.83,
    middleMileOver190LiterRub: middlePrices[3] ?? 3.26,
    middleMileFrom351To1000Rub: middlePrices[4] ?? 2826.09,
    middleMileFrom1001Rub: middlePrices[5] ?? 5434.78,
    lastMileIncludedKg: lastMileTariff.includedChargeableKg,
    lastMileBaseRub: (lastMileBaseSellerRub ?? lastMileTariff.baseRub) * lastMileTariff.costMultiplier,
    lastMileAdditionalKgRub: (lastMileAdditionalSellerRub ?? lastMileTariff.extraRubPerKg) * lastMileTariff.costMultiplier
  };
}

function syncMiddleMileMarkupRows() {
  const visibleIds = new Set(middleMileMarkupRowIds());
  [
    "middle-mile-first-liter-row",
    "middle-mile-additional-liter-row",
    "middle-mile-over-190-liter-row",
    "middle-mile-from-351-row",
    "middle-mile-from-1001-row"
  ].forEach((id) => {
    $(id).hidden = !visibleIds.has(id);
  });
}

function middleMileMarkupRowIds() {
  const ids = [];
  const add = (id) => {
    if (!ids.includes(id)) ids.push(id);
  };
  const volumes = skus.map((sku) => skuMetrics(sku).volumeLiters).sort((left, right) => left - right);

  for (const liters of volumes) {
    if (liters <= 350) add("middle-mile-first-liter-row");
    if (liters > 1 && liters <= 350) add("middle-mile-additional-liter-row");
    if (liters > 190 && liters <= 350) add("middle-mile-over-190-liter-row");
    if (liters > 350 && liters <= 1000) add("middle-mile-from-351-row");
    if (liters > 1000) add("middle-mile-from-1001-row");
  }

  if (!ids.length) add("middle-mile-first-liter-row");
  return ids;
}

function referenceWarehouseGroupBases() {
  const bases = Object.fromEntries(warehouseGroupOrder.map((group) => [group, 0]));
  const firstSku = skus[0];
  if (!firstSku) return bases;
  const fbs = calculateAllSchemes(firstSku).wildberries.fbs;
  fbs.breakdown.forEach((item) => {
    if (item.pimProfitCenter !== "warehouse" || !item.pimWarehouseGroup) return;
    const costWithoutVat = item.pimCostWithoutVatRub ?? item.amountWithoutVatRub;
    bases[item.pimWarehouseGroup] += settings.vatDisplayMode === "with_vat" ? costWithoutVat * (1 + VAT_RATE) : costWithoutVat;
  });
  return Object.fromEntries(Object.entries(bases).map(([group, value]) => [group, money(value)]));
}

function openWarehousePriceList() {
  closeWarehousePriceList();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "warehouse-price-list-modal";
  backdrop.innerHTML = warehousePriceListHtml();
  document.body.append(backdrop);
  $("warehouse-price-list-close").addEventListener("click", closeWarehousePriceList);
  $("warehouse-supply-type")?.addEventListener("change", (event) => {
    settings.warehouseSupplyType = event.target.value;
    render();
    openWarehousePriceList();
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeWarehousePriceList();
  });
  document.querySelectorAll("[data-price-list-markup]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const group = event.target.dataset.priceListMarkup;
      settings.warehouseOperationMarkupPercents[group] = parseInputNumber(event.target.value);
      updateWarehousePriceListSaleValues(group);
      render();
    });
  });
  document.querySelectorAll("[data-price-list-receiving-markup]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const operationKey = event.target.dataset.priceListReceivingMarkup;
      settings.warehouseReceivingMarkupPercents[operationKey] = parseInputNumber(event.target.value);
      updateWarehousePriceListReceivingSaleValue(operationKey);
      render();
    });
  });
  document.querySelectorAll("[data-price-list-storage-markup]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const operationKey = event.target.dataset.priceListStorageMarkup;
      settings.warehouseStorageMarkupPercents[operationKey] = parseInputNumber(event.target.value);
      updateWarehousePriceListStorageSaleValue(operationKey);
      render();
    });
  });
  document.querySelectorAll("[data-price-list-fulfillment-extra]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const operationKey = event.target.dataset.priceListFulfillmentExtra;
      settings.warehouseFulfillmentExtraOperations[operationKey] = event.target.checked;
      render();
      openWarehousePriceList();
    });
  });
  $("fulfillment-extras-toggle")?.addEventListener("click", () => {
    isFulfillmentExtrasOpen = !isFulfillmentExtrasOpen;
    openWarehousePriceList();
  });
}

function closeWarehousePriceList() {
  const modal = $("warehouse-price-list-modal");
  if (modal) modal.remove();
}

function warehousePriceListHtml() {
  const costHeader = "Себестоимость";
  const vatLabel = settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС";
  const groups = warehousePriceListGroups();
  const operationCount = groups.reduce((sum, item) => sum + item.operations.length, 0);
  const rows = groups
    .map(({ group, operations }) =>
      operations
        .map((operation, index) => {
          const operationKey = warehouseOperationKey(operation);
          const percent =
            group === "receiving"
              ? settings.warehouseReceivingMarkupPercents[operationKey] ?? settings.warehouseOperationMarkupPercents.receiving ?? 20
              : group === "storage"
              ? settings.warehouseStorageMarkupPercents[operationKey] ?? defaultWarehouseStorageMarkupPercent(operationKey)
              : settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
          const costRub = displayWarehousePrice(operation.priceRub);
          const saleRub = money(costRub * (1 + percent / 100));
          const groupCell =
            index === 0
              ? `<td class="price-list-group" rowspan="${operations.length}">
                  <div class="price-list-group-title">
                    <strong>${escapeHtml(warehouseGroupDetails[group].label)}</strong>
                    <span class="help">
                      <button type="button" class="help-trigger" aria-label="Описание группы ${escapeHtml(warehouseGroupDetails[group].label)}">?</button>
                      <span class="help-card" role="tooltip">
                        <span class="help-text">${escapeHtml(warehouseGroupDetails[group].description)}</span>
                      </span>
                    </span>
                  </div>
                  ${
                    group === "receiving"
                      ? `<div class="receiving-supply-control">
                          <label>
                            <span>Тип поставки</span>
                            <select id="warehouse-supply-type">
                              ${warehouseSupplyTypeOptions
                                .map((option) => `<option value="${option.value}" ${settings.warehouseSupplyType === option.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
                                .join("")}
                            </select>
                          </label>
                        </div>`
                      : ""
                  }
                  ${
                    group === "fulfillment"
                      ? `<button class="link-button" id="fulfillment-extras-toggle" type="button">${isFulfillmentExtrasOpen ? "Скрыть доп. операции" : "Доп. операции"}</button>`
                      : ""
                  }
                </td>`
              : "";
          const markupCell =
            group === "receiving" || group === "storage"
              ? `<td class="numeric price-list-markup">
                  <input ${group === "receiving" ? "data-price-list-receiving-markup" : "data-price-list-storage-markup"}="${escapeHtml(operationKey)}" aria-label="${escapeHtml(displayWarehouseOperationName(operation.name))}: процент наценки" min="0" step="1" type="number" value="${percent}">
                </td>`
              : index === 0
              ? `<td class="numeric price-list-markup" rowspan="${operations.length}">
                  <input data-price-list-markup="${group}" aria-label="${escapeHtml(warehouseGroupDetails[group].label)}: процент наценки" min="0" step="1" type="number" value="${percent}">
                </td>`
              : "";
          return `
            <tr>
              ${groupCell}
              <td>
                <span class="operation-pick">
                  ${
                    isFulfillmentExtraOperation(operation.name)
                      ? `<input data-price-list-fulfillment-extra="${escapeHtml(operationKey)}" aria-label="${escapeHtml(displayWarehouseOperationName(operation.name))}: участвует в расчете" type="checkbox" ${settings.warehouseFulfillmentExtraOperations[operationKey] === true ? "checked" : ""}>`
                      : `<span class="${warehouseOperationSelected(group, operation.name, settings.warehouseSupplyType) ? "operation-check active" : "operation-check"}" aria-hidden="true">✓</span>`
                  }
                  <span>${escapeHtml(displayWarehouseOperationName(operation.name))}</span>
                </span>
              </td>
              <td>${escapeHtml(operation.unit)}</td>
              <td class="numeric">${formatRub(costRub)}</td>
              ${markupCell}
              <td class="numeric" data-price-list-sale="${group}" data-price-list-receiving-sale="${escapeHtml(operationKey)}" data-price-list-storage-sale="${escapeHtml(operationKey)}" data-cost-rub="${costRub}">${formatRub(saleRub)}</td>
            </tr>
          `;
        })
        .join("")
    )
    .join("");

  return `
    <section class="price-list-modal" role="dialog" aria-modal="true" aria-label="Прайс-лист складских операций">
      <div class="price-list-header">
        <div>
          <span>Складские операции · ${operationCount} ${pluralize(operationCount, "операция", "операции", "операций")} · ${vatLabel}</span>
          <strong>Прайс-лист PIM.Seller</strong>
        </div>
        <button class="icon-button" id="warehouse-price-list-close" type="button" aria-label="Закрыть прайс-лист">×</button>
      </div>
      <div class="price-list-table-wrap">
        <table class="price-list-table">
          <thead>
            <tr>
              <th>Группа</th>
              <th>Операция</th>
              <th>Ед.</th>
              <th>${costHeader}</th>
              <th>% наценки</th>
              <th>Реализация</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function updateWarehousePriceListSaleValues(group) {
  const percent = settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
  document.querySelectorAll(`[data-price-list-sale="${group}"]`).forEach((cell) => {
    const costRub = Number(cell.dataset.costRub) || 0;
    cell.textContent = formatRub(money(costRub * (1 + percent / 100)));
  });
}

function updateWarehousePriceListReceivingSaleValue(operationKey) {
  const percent = settings.warehouseReceivingMarkupPercents[operationKey] ?? settings.warehouseOperationMarkupPercents.receiving ?? 20;
  document.querySelectorAll("[data-price-list-receiving-sale]").forEach((cell) => {
    if (cell.dataset.priceListReceivingSale !== operationKey) return;
    const costRub = Number(cell.dataset.costRub) || 0;
    cell.textContent = formatRub(money(costRub * (1 + percent / 100)));
  });
}

function updateWarehousePriceListStorageSaleValue(operationKey) {
  const percent = settings.warehouseStorageMarkupPercents[operationKey] ?? defaultWarehouseStorageMarkupPercent(operationKey);
  document.querySelectorAll("[data-price-list-storage-sale]").forEach((cell) => {
    if (cell.dataset.priceListStorageSale !== operationKey) return;
    const costRub = Number(cell.dataset.costRub) || 0;
    cell.textContent = formatRub(money(costRub * (1 + percent / 100)));
  });
}

function warehousePriceListGroups() {
  const operations = window.__PIM_DATA__.warehouse.operations ?? [];
  return warehouseGroupOrder
    .map((group) => ({
      group,
      operations: operations
        .filter(
          (operation) => {
            if (warehouseGroupForOperation(operation.name) !== group || !isWarehouseOperationVisible(operation.name)) return false;
            if (group === "fulfillment" && isFulfillmentExtraOperation(operation.name)) {
              return isFulfillmentExtrasOpen || settings.warehouseFulfillmentExtraOperations[warehouseOperationKey(operation)] === true;
            }
            return warehouseOperationMatchesCurrentSkus(operation.name, group, settings.warehouseSupplyType);
          }
        )
        .sort((left, right) => warehouseOperationSortIndex(group, left.name) - warehouseOperationSortIndex(group, right.name))
    }))
    .filter((item) => item.operations.length > 0);
}

function warehouseOperationSortIndex(group, name) {
  if (group !== "storage") return 0;
  const normalized = name.toLowerCase();
  if (normalized.includes("сортировка по артикулам")) return 0;
  if (normalized === "хранение товара") return 1;
  return 2;
}

function isWarehouseOperationVisible(name) {
  const normalized = name.toLowerCase();
  return !normalized.includes("механизированная выгрузка/отгрузка паллеты, негабарит");
}

function displayWarehouseOperationName(name) {
  if (name.toLowerCase() === "хранение товара") return "Хранение товара в литрах";
  return name
    .replaceAll("выгрузка/отгрузка", "выгрузка")
    .replaceAll("Выгрузка/отгрузка", "Выгрузка")
    .replaceAll("/Расформирование заказа", "")
    .replaceAll("пакет с клеевым клапаном", "пакет с клапаном");
}

function defaultWarehouseStorageMarkupPercent(operationKey) {
  return operationKey.toLowerCase() === "хранение товара" ? 30 : 20;
}

function warehouseOperationKey(operation) {
  return isFulfillmentExtraOperation(operation.name) ? `${operation.name}::${operation.priceRub}` : operation.name;
}

function warehouseOperationMatchesCurrentSkus(name, group, supplyType) {
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

function warehouseWeightRange(name) {
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

function warehouseWeightRangeMatches(name, weightKg) {
  const range = warehouseWeightRange(name);
  if (!range) return false;
  return weightKg > range.minKg && weightKg <= range.maxKg;
}

function warehouseGroupForOperation(name) {
  const normalized = name.toLowerCase();
  if (normalized.includes("хранение")) return "storage";
  if (normalized.includes("сортировка по артикулам")) return "storage";
  if (normalized.includes("комплектация") || normalized.includes("расформирование")) return "fulfillment";
  if (normalized.includes("маркиров") || normalized.includes("стикер")) return "fulfillment";
  if (normalized.includes("выгрузка")) return "receiving";
  if (normalized.includes("отгрузка")) return "shipping";
  return "fulfillment";
}

function warehouseOperationSelected(group, operationName, supplyType) {
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
    if (isFulfillmentExtraOperation(operationName)) {
      return Object.entries(settings.warehouseFulfillmentExtraOperations).some(([key, value]) => value && key.startsWith(`${operationName}::`));
    }
    return normalized.includes("комплектация/расформирование заказа") || normalized.includes("маркировка ручная");
  }
  return false;
}

function isFulfillmentExtraOperation(name) {
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

function displayWarehousePrice(priceRubWithoutVat) {
  return money(settings.vatDisplayMode === "with_vat" ? priceRubWithoutVat * (1 + VAT_RATE) : priceRubWithoutVat);
}

function renderSkuEditor() {
  $("sku-body").innerHTML = skus
    .map(
      (sku) => `
        <tr>
          <td><input data-id="${sku.id}" data-field="name" value="${escapeHtml(sku.name)}"></td>
          <td><input data-id="${sku.id}" data-field="price" type="number" min="0" step="0.01" value="${sku.price}"></td>
          <td><input data-id="${sku.id}" data-field="wbSubject" list="wb-subjects" value="${escapeHtml(sku.wbSubject)}"></td>
          <td><input data-id="${sku.id}" data-field="ozonProductType" list="ozon-product-types" value="${escapeHtml(sku.ozonProductType)}"></td>
          <td><input data-id="${sku.id}" data-field="weightKg" type="number" min="0" step="0.01" value="${sku.weightKg}"></td>
          <td><input data-id="${sku.id}" data-field="lengthCm" type="number" min="0" step="0.01" value="${sku.lengthCm}"></td>
          <td><input data-id="${sku.id}" data-field="widthCm" type="number" min="0" step="0.01" value="${sku.widthCm}"></td>
          <td><input data-id="${sku.id}" data-field="heightCm" type="number" min="0" step="0.01" value="${sku.heightCm}"></td>
          <td><input data-id="${sku.id}" data-field="itemsPerPallet" type="number" min="0" step="1" value="${sku.itemsPerPallet}"></td>
          <td><button class="icon-button" data-remove="${sku.id}" type="button" title="Удалить SKU">×</button></td>
        </tr>
      `
    )
    .join("");

  $("sku-body").querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const { id, field } = event.target.dataset;
      const sku = skus.find((item) => item.id === id);
      if (!sku) return;
      sku[field] = event.target.type === "number" ? Number(event.target.value) || 0 : event.target.value;
      syncMarkupInputs();
      renderResults();
    });
  });

  $("sku-body").querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (skus.length <= 1) return;
      skus = skus.filter((sku) => sku.id !== event.target.dataset.remove);
      render();
    });
  });
}

function renderResults() {
  const rows = skus.map((sku) => ({ sku, result: calculateAllSchemes(sku), bestByMarketplace: null }));
  rows.forEach((row) => {
    row.bestByMarketplace = findBestResultsByMarketplace(row.result);
  });
  const flat = rows.flatMap((row) => flattenResults(row.result)).filter((item) => item.isComplete);
  const average = flat.length ? flat.reduce((sum, item) => sum + item.totalRub, 0) / flat.length : 0;
  const bestGlobal = flat.length ? flat.reduce((best, current) => (current.totalRub < best.totalRub ? current : best)) : null;

  $("metric-skus").textContent = String(skus.length);
  $("metric-average").textContent = formatRub(average);
  $("metric-best").textContent = bestGlobal ? `${marketplaceLabel(bestGlobal.marketplace)} ${bestGlobal.scheme.toUpperCase()}` : "—";
  $("metric-wb-tariffs").textContent = formatTariffFreshness(wbTariffInfo.calculationDate, wbTariffInfo.importedAt);
  if (isAdminOpen) renderAdminMargin(rows);

  $("result-body").innerHTML = rows
    .map(({ sku, result, bestByMarketplace }) => {
      const metrics = skuMetrics(sku);
      const dimensionBadges = dimensionBadgeHtml(classifySkuDimensions(sku));
      return `
        <tr>
          <th><div class="sku-title"><strong>${escapeHtml(sku.name)}</strong>${dimensionBadges}</div><span>${formatRub(displayPrice(sku.price))} цена ${settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС"}</span></th>
          <td><strong>${formatNumber(metrics.volumeLiters)} л</strong><span>${formatNumber(metrics.chargeableKg)} кг расч.</span></td>
          ${columns.map(([marketplace, scheme]) => resultCell(result[marketplace][scheme], bestByMarketplace)).join("")}
        </tr>
      `;
    })
    .join("");
}

function classifySkuDimensions(sku) {
  const [longest = 0, middle = 0, shortest = 0] = [sku.lengthCm, sku.widthCm, sku.heightCm].sort((left, right) => right - left);
  const sidesSum = longest + middle + shortest;
  const isWbMgt = sku.weightKg < 25 && longest <= 120 && sidesSum <= 200;
  const isWbKgtPlus = sku.weightKg < 25 && longest <= 200 && sidesSum <= 280 && (longest >= 121 || sidesSum >= 201);
  const isOzonStandard = sku.weightKg <= 25 && longest <= 120 && middle <= 80 && shortest <= 60;

  return {
    wildberries: isWbMgt ? "mgt" : isWbKgtPlus ? "kgt_plus" : "sgt",
    ozon: isOzonStandard ? "standard" : "kgt"
  };
}

function formatTariffFreshness(calculationDate, importedAt) {
  const date = formatDateRu(calculationDate);
  const imported = formatDateTimeRu(importedAt);
  if (date && imported) return `${date}, ${imported}`;
  return date ?? "не обновлены";
}

function formatDateRu(value) {
  if (!value) return null;
  const date = new Date(String(value).includes("T") ? value : `${value}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" }).format(date);
}

function formatDateTimeRu(value) {
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

function dimensionBadgeHtml(classes) {
  const badges = [];
  if (classes.wildberries === "kgt_plus") badges.push(`<span class="dimension-badge wb">WB КГТ+</span>`);
  if (classes.wildberries === "sgt") badges.push(`<span class="dimension-badge wb">WB СГТ</span>`);
  if (classes.ozon === "kgt") badges.push(`<span class="dimension-badge ozon">Ozon КГТ</span>`);
  return badges.length ? `<span class="dimension-badges" aria-label="Габаритные категории">${badges.join("")}</span>` : "";
}

function resultCell(result, bestByMarketplace) {
  const isBest = bestByMarketplace.some((best) => result.marketplace === best.marketplace && result.scheme === best.scheme);
  return `
    <td class="result-cell ${isBest ? "best" : ""} ${result.isComplete ? "" : "incomplete"}">
      <div class="result-main">
        <strong>${result.isComplete ? formatRub(result.totalRub) : "Тариф не найден"}</strong>
        <span>${result.isComplete ? `${formatPercent(result.percentOfPrice)} от цены` : "Проверьте категорию"}</span>
      </div>
      ${
        result.warnings.length
          ? `<div class="warning-list">${result.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>`
          : ""
      }
      <details>
        <summary>Статьи</summary>
        <ul class="breakdown-list">
          ${result.breakdown
            .map(
              (item) =>
                `<li><span class="breakdown-label"><span class="breakdown-title"><span class="breakdown-name">${escapeHtml(item.label)}</span></span><small>${escapeHtml(item.vatNote)}</small>${item.internalNote ? `<small>${escapeHtml(item.internalNote)}</small>` : ""}</span><span class="breakdown-value">${breakdownHelpHtml(item)}<strong>${formatRub(item.amountRub)}</strong></span></li>`
            )
            .join("")}
        </ul>
      </details>
    </td>
  `;
}

function breakdownHelpHtml(item) {
  const note = item.calculationNote ?? "Расчёт по выбранным параметрам SKU и тарифному справочнику.";
  return `
    <span class="help breakdown-help">
      <button type="button" class="help-trigger breakdown-help-trigger" aria-label="Как считается ${escapeHtml(item.label.toLowerCase())}?">?</button>
      <span class="help-card breakdown-help-card" role="tooltip">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="help-text">${escapeHtml(note)}</span>
        <span class="help-text help-total">Итого: ${formatRub(item.amountRub)} ${escapeHtml(item.vatNote)}.</span>
      </span>
    </span>
  `;
}

function renderAdminMargin(rows) {
  $("admin-margin-vat-label").textContent = `${settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС"}, по центрам прибыли`;
  $("admin-margin-body").innerHTML = rows
    .flatMap(({ sku, result }) => {
      const marketplaces = ["wildberries", "ozon"];
      return marketplaces.flatMap((marketplace, marketplaceIndex) =>
        ["fbs", "dbs"].map((scheme, schemeIndex) => {
          const margin = summarizePimMargin(result[marketplace][scheme]);
          return `
            <tr>
              ${
                marketplaceIndex === 0 && schemeIndex === 0
                  ? `<td class="admin-group-cell sku-cell" rowspan="4">${escapeHtml(sku.name)}</td>`
                  : ""
              }
              ${schemeIndex === 0 ? `<td class="admin-group-cell marketplace-cell" rowspan="2">${marketplaceLabel(marketplace)}</td>` : ""}
              <td>${scheme.toUpperCase()}</td>
              <td class="admin-value">${formatRub(margin.firstMile)}</td>
              <td class="admin-value">${formatRub(margin.warehouse)}</td>
              <td class="admin-value">${formatRub(margin.middleMile)}</td>
              <td class="admin-value">${formatRub(margin.lastMile)}</td>
              <td class="admin-value"><strong>${formatRub(margin.total)}</strong></td>
            </tr>
          `;
        })
      );
    })
    .join("");
}

function summarizePimMargin(result) {
  const margin = { firstMile: 0, warehouse: 0, middleMile: 0, lastMile: 0, total: 0 };
  for (const item of result.breakdown) {
    if (!item.pimProfitCenter) continue;
    const profit = settings.vatDisplayMode === "with_vat" ? item.pimProfitWithVatRub ?? 0 : item.pimProfitWithoutVatRub ?? 0;
    margin[item.pimProfitCenter] += profit;
    margin.total += profit;
  }
  return {
    firstMile: money(margin.firstMile),
    warehouse: money(margin.warehouse),
    middleMile: money(margin.middleMile),
    lastMile: money(margin.lastMile),
    total: money(margin.total)
  };
}

function calculateAllSchemes(sku) {
  return {
    wildberries: {
      fbo: calculateScheme("wildberries", "fbo", sku),
      fbs: calculateScheme("wildberries", "fbs", sku),
      dbs: calculateScheme("wildberries", "dbs", sku)
    },
    ozon: {
      fbo: calculateScheme("ozon", "fbo", sku),
      fbs: calculateScheme("ozon", "fbs", sku),
      dbs: calculateScheme("ozon", "dbs", sku)
    }
  };
}

function calculateScheme(marketplace, scheme, sku) {
  const warnings = [];
  const dimensionClasses = classifySkuDimensions(sku);
  addDimensionWarnings(marketplace, scheme, dimensionClasses, warnings);
  if (settings.fastHandover && marketplace === "wildberries" && scheme === "fbs" && dimensionClasses.wildberries === "sgt") {
    warnings.push("Предупреждение: для WB СГТ скидка за быструю сдачу не применяется.");
  }
  const commission = commissionCost(marketplace, scheme, sku);
  const firstMile = firstMileCost(sku);
  if (commission == null) {
    warnings.push(
      marketplace === "wildberries"
        ? `Не найдена комиссия WB для предмета "${sku.wbSubject}"`
        : `Не найдена комиссия Ozon для типа товара "${sku.ozonProductType}"`
    );
  }
  const breakdown = [
    {
      key: "firstMile",
      label: settings.presentationMode === "internal" ? firstMileLabel(sku) : "Первая миля",
      amountRub: firstMile ?? 0,
      source: "assumption",
      vatMode: "without_vat",
      calculationNote: firstMileNote(sku)
    },
    {
      key: "commission",
      label: commission == null ? "Комиссия маркетплейса" : `Комиссия маркетплейса ${formatCommissionRate(commission)}`,
      amountRub: commission?.amountRub ?? 0,
      source: "marketplace",
      vatMode: "with_vat",
      calculationNote: commission == null ? "Комиссия не найдена по категории/типу товара." : commissionCalculationNote(commission)
    }
  ];
  if (firstMile == null) warnings.push(`Не найден тариф первой мили PIM.Seller для маршрута "${settings.originCity} → ${settings.firstMileCity}"`);
  breakdown.push(...(marketplace === "wildberries" ? wildberriesCosts(scheme, sku, warnings) : ozonCosts(scheme, sku, warnings)));
  if (scheme === "fbs" || scheme === "dbs") breakdown.push(...pimWarehouseCosts(sku));
  if (scheme === "fbs") {
    const middleMile = middleMileCostParts(sku);
    breakdown.push({
      key: "middleMile",
      label: "Средняя миля PIM.Seller",
      amountRub: middleMile.totalRub,
      pimBaseCostWithoutVatRub: middleMile.baseRub,
      pimAdditionalCostWithoutVatRub: middleMile.additionalRub,
      pimMiddleMileFirstLiterCostWithoutVatRub: middleMile.firstLiterRub,
      pimMiddleMileAdditionalTo190CostWithoutVatRub: middleMile.additionalTo190Rub,
      pimMiddleMileAdditional191To350CostWithoutVatRub: middleMile.additional191To350Rub,
      pimMiddleMileFixed351To1000CostWithoutVatRub: middleMile.fixed351To1000Rub,
      pimMiddleMileFixedFrom1001CostWithoutVatRub: middleMile.fixedFrom1001Rub,
      source: "pim",
      vatMode: "without_vat",
      calculationNote: middleMileNote(sku, middleMile)
    });
  }
  if (scheme === "dbs") {
    const lastMile = pimLastMileCostParts(sku);
    if (lastMile == null) warnings.push(`Не найден тариф последней мили PIM.Seller для города "${settings.firstMileCity}"`);
    breakdown.push({
      key: "lastMile",
      label: "Последняя миля PIM.Seller",
      amountRub: lastMile?.totalRub ?? 0,
      pimBaseCostWithoutVatRub: lastMile?.baseRub ?? 0,
      pimAdditionalCostWithoutVatRub: lastMile?.additionalRub ?? 0,
      source: "pim",
      vatMode: "without_vat",
      calculationNote: lastMileNote(sku, lastMile)
    });
  }
  const rounded = normalizeBreakdownForVat(breakdown.map(applyPimCommercialMarkup));
  const totalRub = money(rounded.reduce((sum, item) => sum + item.amountRub, 0));
  const priceBasisRub = displayPrice(sku.price);
  return {
    marketplace,
    scheme,
    isComplete: !hasBlockingWarnings(warnings),
    totalRub,
    percentOfPrice: priceBasisRub > 0 ? totalRub / priceBasisRub : 0,
    priceBasisRub,
    vatDisplayMode: settings.vatDisplayMode,
    breakdown: rounded,
    warnings
  };
}

function normalizeBreakdownForVat(breakdown) {
  return breakdown.map((item) => {
    const withoutVat = amountWithoutVat(item.amountRub, item.vatMode);
    const withVat = amountWithVat(item.amountRub, item.vatMode);
    const amountRub = settings.vatDisplayMode === "with_vat" ? withVat : withoutVat;
    return {
      ...item,
      amountRub: money(amountRub),
      amountWithoutVatRub: money(withoutVat),
      amountWithVatRub: money(withVat),
      vatNote: vatNote(item.vatMode)
    };
  });
}

function applyPimCommercialMarkup(item) {
  const profitCenter = pimProfitCenter(item.key);
  if (!profitCenter) return item;
  const markup = pimMarkup(item, profitCenter);
  const amountRub = item.amountRub + markup.profitRub;
  return {
    ...item,
    amountRub,
    pimProfitCenter: profitCenter,
    pimCostWithoutVatRub: money(item.amountRub),
    pimProfitWithoutVatRub: money(markup.profitRub),
    pimProfitWithVatRub: money(markup.profitRub * (1 + VAT_RATE)),
    internalNote:
      settings.presentationMode === "internal" && markup.profitRub > 0
        ? `Себестоимость ${formatNumber(item.amountRub)} ₽ · наценка ${markup.note}`
        : undefined,
    calculationNote:
      settings.presentationMode === "internal" || markup.profitRub === 0
        ? item.calculationNote
        : `${item.calculationNote ?? "Тариф PIM.Seller."} Коммерческие условия учтены в итоговой ставке.`
  };
}

function pimProfitCenter(key) {
  if (key === "firstMile") return "firstMile";
  if (key === "middleMile") return "middleMile";
  if (key === "lastMile") return "lastMile";
  if (key.startsWith("pimFulfillmentExtra:")) return "warehouse";
  if (key === "pimReceiving" || key === "pimStorageSorting" || key === "pimStorage" || key === "pimFulfillment" || key === "pimLabeling") return "warehouse";
  return null;
}

function pimMarkup(item, profitCenter) {
  if (profitCenter === "middleMile") {
    const firstLiter = item.pimMiddleMileFirstLiterCostWithoutVatRub ?? item.pimBaseCostWithoutVatRub ?? item.amountRub;
    const additionalTo190 = item.pimMiddleMileAdditionalTo190CostWithoutVatRub ?? item.pimAdditionalCostWithoutVatRub ?? 0;
    const additional191To350 = item.pimMiddleMileAdditional191To350CostWithoutVatRub ?? 0;
    const fixed351To1000 = item.pimMiddleMileFixed351To1000CostWithoutVatRub ?? 0;
    const fixedFrom1001 = item.pimMiddleMileFixedFrom1001CostWithoutVatRub ?? 0;
    const firstLiterProfit = firstLiter * (settings.middleMileFirstLiterMarkupPercent / 100);
    const additionalTo190Profit = additionalTo190 * (settings.middleMileAdditionalLiterMarkupPercent / 100);
    const additional191To350Profit = additional191To350 * (settings.middleMileOver190LiterMarkupPercent / 100);
    const fixed351To1000Profit = fixed351To1000 * (settings.middleMileFrom351To1000MarkupPercent / 100);
    const fixedFrom1001Profit = fixedFrom1001 * (settings.middleMileFrom1001MarkupPercent / 100);
    const noteParts = [];
    if (firstLiter > 0) noteParts.push(`1-й литр ${formatNumber(settings.middleMileFirstLiterMarkupPercent)}%`);
    if (additionalTo190 > 0) noteParts.push(`2-190 л ${formatNumber(settings.middleMileAdditionalLiterMarkupPercent)}%`);
    if (additional191To350 > 0) noteParts.push(`191-350 л ${formatNumber(settings.middleMileOver190LiterMarkupPercent)}%`);
    if (fixed351To1000 > 0) noteParts.push(`351-1000 л ${formatNumber(settings.middleMileFrom351To1000MarkupPercent)}%`);
    if (fixedFrom1001 > 0) noteParts.push(`1001+ л ${formatNumber(settings.middleMileFrom1001MarkupPercent)}%`);
    return {
      profitRub: firstLiterProfit + additionalTo190Profit + additional191To350Profit + fixed351To1000Profit + fixedFrom1001Profit,
      note: noteParts.join(", ")
    };
  }
  if (profitCenter === "lastMile") {
    const base = item.pimBaseCostWithoutVatRub ?? item.amountRub;
    const additional = item.pimAdditionalCostWithoutVatRub ?? 0;
    const baseProfit = base * (settings.lastMileBaseMarkupPercent / 100);
    const additionalProfit = additional * (settings.lastMileAdditionalKgMarkupPercent / 100);
    return {
      profitRub: baseProfit + additionalProfit,
      note: `до 3 кг ${formatNumber(settings.lastMileBaseMarkupPercent)}%, сверх 3 кг ${formatNumber(settings.lastMileAdditionalKgMarkupPercent)}%`
    };
  }
  const markupPercent = profitCenter === "warehouse" ? warehouseMarkupPercent(item) : settings.firstMileMarkupPercent;
  return {
    profitRub: item.amountRub * (markupPercent / 100),
    note: `${formatNumber(markupPercent)}%`
  };
}

function warehouseMarkupPercent(item) {
  const group = item.pimWarehouseGroup ?? warehouseGroupForBreakdownKey(item.key);
  if (!group) return settings.warehouseMarkupPercent;
  if (group === "receiving" && item.pimWarehouseOperationKey) {
    return settings.warehouseReceivingMarkupPercents[item.pimWarehouseOperationKey] ?? settings.warehouseOperationMarkupPercents.receiving ?? 20;
  }
  if (group === "storage" && item.pimWarehouseOperationKey) {
    return settings.warehouseStorageMarkupPercents[item.pimWarehouseOperationKey] ?? defaultWarehouseStorageMarkupPercent(item.pimWarehouseOperationKey);
  }
  return settings.warehouseOperationMarkupPercents[group] ?? settings.warehouseMarkupPercent;
}

function amountWithoutVat(amountRub, vatMode) {
  if (vatMode === "with_vat") return amountRub / (1 + VAT_RATE);
  return amountRub;
}

function amountWithVat(amountRub, vatMode) {
  if (vatMode === "without_vat") return amountRub * (1 + VAT_RATE);
  return amountRub;
}

function displayPrice(priceRub) {
  return money(settings.vatDisplayMode === "with_vat" ? priceRub : priceRub / (1 + VAT_RATE));
}

function vatNote(vatMode) {
  if (vatMode === "no_vat") return "НДС не применяется";
  return settings.vatDisplayMode === "with_vat" ? "с НДС" : "без НДС";
}

function flattenResults(result) {
  return [result.wildberries.fbo, result.wildberries.fbs, result.wildberries.dbs, result.ozon.fbo, result.ozon.fbs, result.ozon.dbs];
}

function hasBlockingWarnings(warnings) {
  return warnings.some((warning) => !warning.startsWith("Поставка WB на ") && !warning.startsWith("Предупреждение:"));
}

function findBestResult(result) {
  const complete = flattenResults(result).filter((item) => item.isComplete);
  const comparable = complete.length ? complete : flattenResults(result);
  return comparable.reduce((best, current) => (current.totalRub < best.totalRub ? current : best));
}

function findBestResultsByMarketplace(result) {
  return [
    findBestMarketplaceResult([result.wildberries.fbo, result.wildberries.fbs, result.wildberries.dbs]),
    findBestMarketplaceResult([result.ozon.fbo, result.ozon.fbs, result.ozon.dbs])
  ];
}

function findBestMarketplaceResult(results) {
  const complete = results.filter((item) => item.isComplete);
  const comparable = complete.length ? complete : results;
  return comparable.reduce((best, current) => (current.totalRub < best.totalRub ? current : best));
}

function skuMetrics(sku) {
  const volumeLiters = (sku.lengthCm * sku.widthCm * sku.heightCm) / 1000;
  const volumetricWeightKg = (sku.lengthCm * sku.widthCm * sku.heightCm) / 5000;
  return { volumeLiters, volumetricWeightKg, chargeableKg: Math.max(sku.weightKg, volumetricWeightKg) };
}

function commissionCost(marketplace, scheme, sku) {
  if (marketplace === "wildberries") {
    const entry =
      window.__PIM_DATA__.wildberriesCommissions.find((item) => item.subject === sku.wbSubject) ??
      window.__PIM_DATA__.wildberriesCommissions.find((item) => item.category === sku.wbCategory);
    if (!entry) return null;
    const rate = entry.commission[scheme];
    return commissionWithDiscount(sku.price, rate, marketplace, scheme, sku);
  }
  const entry = findOzonCommissionEntry(sku);
  const bands = entry?.commissionBands?.[scheme];
  const rate = bands?.[priceBandKey(sku.price, scheme)] ?? bands?.over10000 ?? null;
  return rate == null ? null : commissionWithDiscount(sku.price, rate, marketplace, scheme, sku);
}

function commissionWithDiscount(price, rate, marketplace, scheme, sku) {
  const discount = commissionDiscount(marketplace, scheme, sku);
  const effectiveRate = applyCommissionDiscount(rate, discount);
  return { amountRub: price * effectiveRate, rate: effectiveRate, originalRate: rate, discount };
}

function commissionDiscount(marketplace, scheme, sku) {
  if (!settings.fastHandover || scheme !== "fbs") return null;
  if (marketplace === "wildberries") {
    return classifySkuDimensions(sku).wildberries === "sgt" ? null : { value: WB_FAST_HANDOVER_DISCOUNT };
  }
  return { value: ozonFastHandoverDiscount(settings.ozonFastHandoverType) };
}

function addDimensionWarnings(marketplace, scheme, classes, warnings) {
  if (marketplace === "wildberries" && classes.wildberries === "kgt_plus") {
    warnings.push("Предупреждение: WB КГТ+ — проверьте доступность выбранного склада и типа поставки.");
  }
  if (marketplace === "wildberries" && classes.wildberries === "sgt") {
    warnings.push("Предупреждение: WB СГТ — проверьте доступность выбранного склада и типа поставки.");
  }
  if (marketplace === "ozon" && classes.ozon === "kgt" && scheme === "dbs") {
    warnings.push(ozonKgtDbsWarning());
  }
}

function ozonKgtDbsWarning() {
  return "Предупреждение: Ozon КГТ DBS/RFBS — комиссия берется из RFBS, доставка PIM.Seller считается по расчётному весу; маркетплейс-логистика Ozon в DBS не применяется.";
}

function ozonFastHandoverDiscount(type) {
  if (type === "sc_courier_under_12") return 0.03;
  return 0.02;
}

function applyCommissionDiscount(rate, discount) {
  if (!discount) return rate;
  return Math.max(0, rate - discount.value);
}

function findOzonCommissionEntry(sku) {
  const byProductType = window.__PIM_DATA__.ozonCommissions.filter((item) => item.productType === sku.ozonProductType);
  if (byProductType.length) {
    return (
      byProductType.find((item) => item.category === sku.ozonCategory) ??
      byProductType.find((item) => !item.category.startsWith("Благотворительность")) ??
      byProductType[0]
    );
  }
  return window.__PIM_DATA__.ozonCommissions.find((item) => item.category === sku.ozonCategory) ?? null;
}

function formatRate(rate) {
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : money(percent)}%`;
}

function formatCommissionRate(commission) {
  if (!commission.discount) return formatRate(commission.rate);
  return `${formatRate(commission.rate)} (${formatRate(commission.originalRate)}-${formatRate(commission.discount.value)})`;
}

function commissionCalculationNote(commission) {
  const base = `Цена товара × ставка комиссии ${formatCommissionRate(commission)}.`;
  if (!commission.discount) return base;
  return `${base} Снижение ${formatRate(commission.discount.value)} применяется за Быструю сдачу.`;
}

function priceBandKey(price, scheme) {
  if (scheme === "dbs") {
    if (price <= 1500) return "300to1500";
    if (price <= 5000) return "1500to5000";
    if (price <= 10000) return "5000to10000";
    return "over10000";
  }
  if (price <= 100) return "to100";
  if (price <= 300) return "100to300";
  if (price <= 1500) return "300to1500";
  if (price <= 5000) return "1500to5000";
  if (price <= 10000) return "5000to10000";
  return "over10000";
}

function firstMileCost(sku) {
  const route = window.__PIM_DATA__.logistics.firstMile.routes?.find((item) => item.originCity === settings.originCity && item.destinationCity === settings.firstMileCity);
  const rubPerPallet = route?.rubPerPallet ?? null;
  if (rubPerPallet == null) return null;
  return safeDivide(rubPerPallet, sku.itemsPerPallet);
}

function firstMileLabel(sku) {
  const route = window.__PIM_DATA__.logistics.firstMile.routes?.find((item) => item.originCity === settings.originCity && item.destinationCity === settings.firstMileCity);
  if (route?.rubPerPallet == null) return "Первая миля";
  return `Первая миля (${formatNumber(route.rubPerPallet)} ₽/паллет / ${formatNumber(sku.itemsPerPallet)} шт.)`;
}

function firstMileNote(sku) {
  const route = window.__PIM_DATA__.logistics.firstMile.routes?.find((item) => item.originCity === settings.originCity && item.destinationCity === settings.firstMileCity);
  if (route?.rubPerPallet == null) return `Маршрут ${settings.originCity} → ${settings.firstMileCity}: тариф не найден.`;
  return `Маршрут ${settings.originCity} → ${settings.firstMileCity}: ${formatNumber(route.rubPerPallet)} ₽/паллет / ${formatNumber(sku.itemsPerPallet)} SKU.`;
}

function pimWarehouseCosts(sku) {
  const selected = window.__PIM_DATA__.warehouse.selected;
  const receiving = receivingCost(sku);
  const storage = storageCost(sku);
  const storageSorting = storageSortingCost(sku);
  const fulfillmentExtras = fulfillmentExtraCosts(sku);
  const operations = [
    {
      key: "pimReceiving",
      label: receiving.label,
      amountRub: receiving.amountRub,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "receiving",
      pimWarehouseOperationKey: receiving.operationKey,
      calculationNote: receiving.note
    },
    ...(storageSorting
      ? [
          {
            key: "pimStorageSorting",
            label: storageSorting.label,
            amountRub: storageSorting.amountRub,
            source: "pim",
            vatMode: "without_vat",
            pimWarehouseGroup: "storage",
            pimWarehouseOperationKey: storageSorting.operationKey,
            calculationNote: storageSorting.note
          }
        ]
      : []),
    {
      key: "pimStorage",
      label: storage.label,
      amountRub: storage.amountRub,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "storage",
      pimWarehouseOperationKey: storage.operationKey,
      calculationNote: storage.note
    },
    {
      key: "pimFulfillment",
      label: "Комплектация PIM.Seller",
      amountRub: outboundCost(sku.weightKg, selected),
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "fulfillment",
      calculationNote: `Комплектация по фактическому весу ${formatNumber(sku.weightKg)} кг.`
    },
    {
      key: "pimLabeling",
      label: "Маркировка PIM.Seller",
      amountRub: selected.labeling ?? 0,
      source: "pim",
      vatMode: "without_vat",
      pimWarehouseGroup: "fulfillment",
      calculationNote: `Фиксированный тариф маркировки: ${formatNumber(selected.labeling ?? 0)} ₽/SKU.`
    },
    ...fulfillmentExtras
  ];
  return operations.filter((item) => settings.warehouseOperationGroups[item.pimWarehouseGroup] !== false);
}

function warehouseGroupForBreakdownKey(key) {
  if (key === "pimReceiving") return "receiving";
  if (key === "pimStorage" || key === "pimStorageSorting") return "storage";
  if (key.startsWith("pimFulfillmentExtra:")) return "fulfillment";
  if (key === "pimFulfillment" || key === "pimLabeling") return "fulfillment";
  return null;
}

function fulfillmentExtraCosts(sku) {
  return fulfillmentExtraOperations(window.__PIM_DATA__.warehouse.operations ?? [])
    .filter((operation) => settings.warehouseFulfillmentExtraOperations[fulfillmentExtraOperationKey(operation)])
    .map((operation) => {
      const operationKey = fulfillmentExtraOperationKey(operation);
      const amountRub = warehouseOperationUnitCost(operation, sku);
      return {
        key: `pimFulfillmentExtra:${operationKey}`,
        label: displayWarehouseOperationName(operation.name),
        amountRub,
        source: "pim",
        vatMode: "without_vat",
        pimWarehouseGroup: "fulfillment",
        pimWarehouseOperationKey: operationKey,
        calculationNote: `${operation.name}: ${formatNumber(operation.priceRub)} ₽/${operation.unit}${operation.unit.toLowerCase().includes("паллет") ? ` / ${formatNumber(sku.itemsPerPallet)} SKU` : ""}.`
      };
    });
}

function fulfillmentExtraOperations(operations) {
  return operations.filter((operation) => isFulfillmentExtraOperation(operation.name));
}

function fulfillmentExtraOperationKey(operation) {
  return `${operation.name}::${operation.priceRub}`;
}

function warehouseOperationUnitCost(operation, sku) {
  const unit = operation.unit.toLowerCase();
  if (unit.includes("паллет") || unit.includes("поддон")) return safeDivide(operation.priceRub, sku.itemsPerPallet);
  return operation.priceRub;
}

function storageCost(sku) {
  if (settings.warehouseSupplyType === "mono_pallet") {
    const operationKey = window.__PIM_DATA__.warehouse.selectedMapping?.storagePalletHeight180 ?? window.__PIM_DATA__.warehouse.selectedMapping?.storagePalletHeight150 ?? "Хранение EUR паллет (800х1200 вес до 1000 кг), высота до 1,8 м";
    const rate = window.__PIM_DATA__.warehouse.selected.storagePalletHeight180 ?? window.__PIM_DATA__.warehouse.selected.storagePalletHeight150 ?? 0;
    return {
      amountRub: safeDivide(rate * settings.storageDays, sku.itemsPerPallet),
      label: "Хранение PIM.Seller (паллеты)",
      note: `${formatNumber(rate)} ₽/паллетоместо/сутки × ${formatNumber(settings.storageDays)} дн. / ${formatNumber(sku.itemsPerPallet)} SKU.`,
      operationKey
    };
  }

  const operation = window.__PIM_DATA__.warehouse.operations?.find((item) => item.name.toLowerCase() === "хранение товара");
  const rate = operation?.priceRub ?? 0;
  const { volumeLiters } = skuMetrics(sku);
  return {
    amountRub: volumeLiters * settings.storageDays * rate,
    label: "Хранение PIM.Seller (литры)",
    note: `${formatNumber(volumeLiters)} л × ${formatNumber(settings.storageDays)} дн. × ${formatNumber(rate)} ₽/л/сутки.`,
    operationKey: operation?.name ?? "Хранение товара"
  };
}

function storageSortingCost(sku) {
  if (settings.warehouseSupplyType === "mono_pallet") return null;
  const rows = (window.__PIM_DATA__.warehouse.operations ?? []).filter((operation) => operation.name.toLowerCase().includes("сортировка по артикулам"));
  const row = rows.find((operation) => manualWeightRangeMatches(operation.name, sku.weightKg));
  return {
    amountRub: row?.priceRub ?? 0,
    label: "Сортировка по артикулам PIM.Seller",
    note: row?.name
      ? `${row.name}: фактический вес ${formatNumber(sku.weightKg)} кг. Выполняется перед литровым хранением для коробов и микспаллет.`
      : `Сортировка по артикулам: тариф по весу ${formatNumber(sku.weightKg)} кг не найден.`,
    operationKey: row?.name ?? ""
  };
}

function receivingCost(sku) {
  if (settings.warehouseSupplyType === "boxes") {
    const manual = manualReceivingCost(sku.weightKg);
    return {
      amountRub: manual.priceRub,
      operationKey: manual.name,
      label: "Приёмка на склад PIM.Seller (короба)",
      note: manual.name
        ? `Поставка коробами: ${displayWarehouseOperationName(manual.name)}, фактический вес ${formatNumber(sku.weightKg)} кг.`
        : `Поставка коробами: ручной тариф по весу ${formatNumber(sku.weightKg)} кг не найден.`
    };
  }
  const palletRate = window.__PIM_DATA__.warehouse.selected.receivingPallet ?? 0;
  const supplyLabel = settings.warehouseSupplyType === "mix_pallet" ? "микспаллета" : "монопаллета";
  const mixPalletNote =
    settings.warehouseSupplyType === "mix_pallet"
      ? " В Приёмке микспаллета считается по тому же принципу, что и монопаллета."
      : "";
  return {
    amountRub: safeDivide(palletRate, sku.itemsPerPallet),
    operationKey: window.__PIM_DATA__.warehouse.selectedMapping?.receivingPallet ?? "Механизированная выгрузка/отгрузка паллеты",
    label: `Приёмка на склад PIM.Seller (${supplyLabel})`,
    note: `Механизированная выгрузка паллеты / количество SKU: ${formatNumber(palletRate)} ₽ / ${formatNumber(sku.itemsPerPallet)}.${mixPalletNote}`
  };
}

function manualReceivingCost(weightKg) {
  const rows = (window.__PIM_DATA__.warehouse.operations ?? []).filter((operation) => operation.name.toLowerCase().includes("ручная выгрузка/отгрузка"));
  const row = rows.find((operation) => manualWeightRangeMatches(operation.name, weightKg));
  return {
    name: row?.name ?? "",
    priceRub: row?.priceRub ?? 0
  };
}

function manualWeightRangeMatches(name, weightKg) {
  const normalized = name.replace(/\s/g, "").replace(",", ".");
  if (normalized.includes("до1кг")) return weightKg <= 1;
  if (normalized.includes("до5кг")) return weightKg <= 5;
  if (normalized.includes("5.01-10кг")) return weightKg > 5 && weightKg <= 10;
  if (normalized.includes("10.01-25кг")) return weightKg > 10 && weightKg <= 25;
  if (normalized.includes("25.01-50кг")) return weightKg > 25 && weightKg <= 50;
  if (normalized.includes("50.01-70кг")) return weightKg > 50 && weightKg <= 70;
  if (normalized.includes("70.01-110кг")) return weightKg > 70 && weightKg <= 110;
  return false;
}

function outboundCost(weightKg, selected) {
  if (weightKg <= 5) return selected.outboundUpTo5Kg ?? 0;
  if (weightKg <= 10) return selected.outbound5To10Kg ?? 0;
  if (weightKg <= 25) return selected.outbound10To25Kg ?? 0;
  return selected.outbound25To50Kg ?? 0;
}

function wildberriesCosts(scheme, sku, warnings) {
  const logistics = window.__PIM_DATA__.logistics.wildberriesLogistics;
  const metrics = skuMetrics(sku);
  const warehouse = logistics.warehouses.find((item) => item.name === settings.wbWarehouse);
  if (scheme === "fbo") {
    const tariff = settings.wbSupplyType === "pallet" ? warehouse?.pallet : warehouse?.box;
    const delivery = wbFboDeliveryCost(metrics.volumeLiters, warehouse, settings.wbSupplyType, logistics, tariff);
    const storage = wbFboStorageCost(metrics.volumeLiters, sku.itemsPerPallet, settings.storageDays, warehouse, settings.wbSupplyType, tariff);
    const acceptance = wbAcceptanceCost(sku, metrics.volumeLiters, warehouse, settings.wbSupplyType, warnings);
    if (delivery == null) warnings.push(`Не найден тариф логистики WB для склада "${settings.wbWarehouse}" и типа поставки "${wbSupplyLabel(settings.wbSupplyType)}"`);
    if (storage == null) warnings.push(`Не найден тариф хранения WB для склада "${settings.wbWarehouse}" и типа поставки "${wbSupplyLabel(settings.wbSupplyType)}"`);
    return [
      {
        key: "wbLastMile",
        label: "Логистика WB до покупателя",
        amountRub: (delivery ?? 0) * settings.localizationIndex + sku.price * settings.salesDistributionIndex,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Тариф WB по объёму ${formatNumber(metrics.volumeLiters)} л × индекс ${formatNumber(settings.localizationIndex)} + цена × ${formatRate(settings.salesDistributionIndex)}.`
      },
      {
        key: "wbAcceptance",
        label: "Приёмка WB",
        amountRub: acceptance ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          settings.wbSupplyType === "pallet"
            ? `Монопаллета: 500 ₽ × коэффициент / ${formatNumber(sku.itemsPerPallet)} SKU.`
            : `Короб: 1,70 ₽ × ${formatNumber(metrics.volumeLiters)} л × коэффициент приёмки.`
      },
      {
        key: "wbStorage",
        label: "Хранение WB",
        amountRub: storage ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          settings.wbSupplyType === "pallet"
            ? `Паллетное хранение × ${formatNumber(settings.storageDays)} дн. / ${formatNumber(sku.itemsPerPallet)} SKU.`
            : `Тариф хранения WB по ${formatNumber(metrics.volumeLiters)} л × ${formatNumber(settings.storageDays)} дн.`
      }
    ];
  }
  if (scheme === "fbs") {
    const isSgt = classifySkuDimensions(sku).wildberries === "sgt";
    const marketplaceWarehouse = findWbFbsMarketplaceWarehouse(warehouse, logistics, isSgt);
    const delivery = wbMarketplaceDeliveryCost(metrics.volumeLiters, marketplaceWarehouse?.box, logistics);
    const isSgtRowApplied = isSgt && marketplaceWarehouse?.name === wbFbsMarketplaceWarehouseName(warehouse, true);
    if (delivery == null) warnings.push(`Не найден тариф логистики WB FBS для федерального округа склада "${settings.wbWarehouse}"`);
    if (isSgt && !isSgtRowApplied) {
      warnings.push(`Предупреждение: WB СГТ — не найдена СГТ-строка тарифа для федерального округа склада "${settings.wbWarehouse}", применена обычная FBS-строка.`);
    }
    return [
      {
        key: "wbFbsLastMile",
        label: isSgtRowApplied ? "Логистика WB FBS СГТ" : "Логистика WB FBS",
        amountRub: delivery ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `${marketplaceWarehouse?.name ?? "Строка WB FBS"}: тариф по объёму ${formatNumber(metrics.volumeLiters)} л.`
      }
    ];
  }
  return [];
}

function findWbFbsMarketplaceWarehouse(warehouse, logistics, isSgt = false) {
  if (!warehouse?.geoName) return warehouse;
  const sgtWarehouseName = wbFbsMarketplaceWarehouseName(warehouse, true);
  const defaultWarehouseName = wbFbsMarketplaceWarehouseName(warehouse, false);
  return (
    (isSgt ? logistics.warehouses.find((item) => item.name === sgtWarehouseName) : undefined) ??
    logistics.warehouses.find((item) => item.name === defaultWarehouseName) ??
    warehouse
  );
}

function wbFbsMarketplaceWarehouseName(warehouse, isSgt) {
  if (!warehouse?.geoName) return null;
  return `Маркетплейс: ${warehouse.geoName}${isSgt ? " СГТ" : ""}`;
}

function wbDeliveryCost(volumeLiters, tariff, logistics, supplyType) {
  if (!tariff) return null;
  return wbVolumeTariff(volumeLiters, tariff.deliveryBaseRub, tariff.deliveryAdditionalLiterRub, supplyType === "box" ? tariff.deliveryCoefPercent : null, logistics);
}

function wbFboDeliveryCost(volumeLiters, warehouse, supplyType, logistics, fallbackTariff) {
  const acceptance = warehouse?.acceptance?.[supplyType];
  const fromAcceptance = wbVolumeTariff(
    volumeLiters,
    acceptance?.deliveryBaseLiterRub ?? null,
    acceptance?.deliveryAdditionalLiterRub ?? null,
    acceptance?.deliveryCoefPercent ?? null,
    logistics
  );
  return fromAcceptance ?? wbDeliveryCost(volumeLiters, fallbackTariff, logistics, supplyType);
}

function wbMarketplaceDeliveryCost(volumeLiters, tariff, logistics) {
  if (!tariff) return null;
  return wbVolumeTariff(volumeLiters, tariff.marketplaceDeliveryBaseRub, tariff.marketplaceDeliveryAdditionalLiterRub, tariff.marketplaceDeliveryCoefPercent, logistics);
}

function wbVolumeTariff(volumeLiters, firstLiterRub, additionalLiterRub, coefficientPercent, logistics) {
  if (volumeLiters <= 1) {
    const band = logistics.smallVolumeBands?.find((item) => volumeLiters >= item.minLiter && volumeLiters <= item.maxLiter);
    if (!band) return firstLiterRub;
    const coefficient = coefficientPercent == null ? safeDivide(firstLiterRub ?? logistics.firstLiterRub, logistics.firstLiterRub) : coefficientPercent / 100;
    return band.rub * coefficient;
  }
  if (firstLiterRub == null || additionalLiterRub == null) return null;
  return firstLiterRub + Math.max(0, volumeLiters - 1) * additionalLiterRub;
}

function wbStorageCost(volumeLiters, itemsPerPallet, storageDays, tariff, supplyType) {
  if (!tariff) return null;
  if (supplyType === "pallet") return tariff.storagePalletDayRub == null ? null : safeDivide(tariff.storagePalletDayRub * storageDays, itemsPerPallet);
  if (tariff.storageBaseRub == null || tariff.storageAdditionalLiterRub == null) return null;
  return (tariff.storageBaseRub + Math.max(0, volumeLiters - 1) * tariff.storageAdditionalLiterRub) * storageDays;
}

function wbFboStorageCost(volumeLiters, itemsPerPallet, storageDays, warehouse, supplyType, fallbackTariff) {
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (supplyType === "pallet" && acceptance?.storageBaseLiterRub != null) return safeDivide(acceptance.storageBaseLiterRub * storageDays, itemsPerPallet);
  if (supplyType === "box" && acceptance?.storageBaseLiterRub != null && acceptance.storageAdditionalLiterRub != null) {
    return (acceptance.storageBaseLiterRub + Math.max(0, volumeLiters - 1) * acceptance.storageAdditionalLiterRub) * storageDays;
  }
  return wbStorageCost(volumeLiters, itemsPerPallet, storageDays, fallbackTariff, supplyType);
}

function wbAcceptanceCost(sku, volumeLiters, warehouse, supplyType, warnings) {
  const acceptance = warehouse?.acceptance?.[supplyType];
  if (!acceptance) {
    warnings.push(`Не найден тариф приёмки WB для склада "${warehouse?.name ?? "не выбран"}" и типа поставки "${wbSupplyLabel(supplyType)}"`);
    return null;
  }
  if (!acceptance.allowUnload || (acceptance.coefficient !== 0 && acceptance.coefficient !== 1)) {
    warnings.push(`Поставка WB на "${warehouse?.name}" типом "${wbSupplyLabel(supplyType)}" недоступна на дату ${acceptance.date.slice(0, 10)}`);
    return null;
  }
  if (supplyType === "pallet") return safeDivide(500 * acceptance.coefficient, sku.itemsPerPallet);
  return 1.7 * volumeLiters * acceptance.coefficient;
}

function wbSupplyLabel(supplyType) {
  return supplyType === "box" ? "Короб" : "Монопаллета";
}

function ozonCosts(scheme, sku, warnings) {
  const logistics = window.__PIM_DATA__.logistics.ozonLogistics;
  const metrics = skuMetrics(sku);
  const originCluster = logistics.cityToCluster[settings.firstMileCity] ?? settings.firstMileCity;
  const deliveryCluster = settings.ozonDeliveryMode === "local" ? originCluster : settings.ozonDeliveryCluster;
  const tariffRow = findOzonLogisticsTariff(metrics.volumeLiters, sku.price, originCluster, deliveryCluster, logistics);
  const nonlocalMarkupPercent =
    scheme !== "fbo" || originCluster === deliveryCluster ? 0 : logistics.nonlocalMarkups.find((item) => item.deliveryCluster === deliveryCluster)?.percent;
  if (scheme !== "dbs" && !tariffRow) warnings.push(`Не найден тариф логистики Ozon для направления "${originCluster}" -> "${deliveryCluster}"`);
  if (scheme === "fbo" && nonlocalMarkupPercent == null) warnings.push(`Не найдена наценка Ozon за нелокальную продажу для кластера "${deliveryCluster}"`);
  const baseDelivery = tariffRow?.rub ?? 0;
  const nonlocalMarkup = sku.price * (nonlocalMarkupPercent ?? 0);
  if (scheme === "fbo") {
    const storage = ozonFboStorageCost(sku, metrics.volumeLiters, settings.storageDays, logistics);
    if (storage == null) warnings.push(`Не найден срок бесплатного хранения Ozon для типа товара "${sku.ozonProductType}"`);
    return [
      {
        key: "ozonFboLogisticsTariff",
        label: "Логистика Ozon FBO",
        amountRub: baseDelivery,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `${originCluster} → ${deliveryCluster}: тариф Ozon по объёму ${formatNumber(metrics.volumeLiters)} л и цене товара.`
      },
      {
        key: "ozonFboNonlocalMarkup",
        label: `Наценка Ozon за нелокальную продажу ${formatRate(nonlocalMarkupPercent ?? 0)}`,
        amountRub: nonlocalMarkup,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: originCluster === deliveryCluster ? "Локальная продажа: наценка не применяется." : `Цена товара × ${formatRate(nonlocalMarkupPercent ?? 0)}.`
      },
      {
        key: "ozonFboStorage",
        label: storage == null ? "Хранение Ozon FBO" : `Хранение Ozon FBO (${storage.freeDays} дн. бесплатно)`,
        amountRub: storage?.amountRub ?? 0,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote:
          storage == null
            ? "Тариф хранения Ozon не найден."
            : `${formatNumber(storage.paidDays)} платн. дн. × ${formatNumber(metrics.volumeLiters)} л × ${formatNumber(storage.rubPerLiterDay)} ₽.`
      },
      {
        key: "ozonPickupPoint",
        label: "Доставка до ПВЗ Ozon",
        amountRub: logistics.pickupPointRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon: ${formatNumber(logistics.pickupPointRub)} ₽.`
      }
    ];
  }
  if (scheme === "fbs") {
    return [
      {
        key: "ozonFbsAcceptance",
        label: "Приёмка отправления Ozon",
        amountRub: logistics.fbsAcceptanceRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon FBS: ${formatNumber(logistics.fbsAcceptanceRub)} ₽.`
      },
      {
        key: "ozonFbsLogistics",
        label: "Логистика Ozon FBS",
        amountRub: baseDelivery,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `${originCluster} → ${deliveryCluster}: тариф Ozon по объёму ${formatNumber(metrics.volumeLiters)} л и цене товара.`
      },
      {
        key: "ozonPickupPoint",
        label: "Доставка до ПВЗ Ozon",
        amountRub: logistics.pickupPointRub,
        source: "marketplace",
        vatMode: "with_vat",
        calculationNote: `Фиксированная ставка Ozon: ${formatNumber(logistics.pickupPointRub)} ₽.`
      }
    ];
  }
  return [];
}

function findOzonLogisticsTariff(volumeLiters, price, originCluster, deliveryCluster, logistics) {
  const matchesVolume = (item) => volumeLiters >= item.minLiter && (item.maxLiter === null || volumeLiters <= item.maxLiter);
  const tariff =
    logistics.tariffs.find((item) => item.originCluster === originCluster && item.deliveryCluster === deliveryCluster && matchesVolume(item)) ??
    null;
  const row = tariff ?? logistics.defaultTariffs.find(matchesVolume) ?? null;
  if (!row) return null;
  return { rub: price <= 300 ? row.priceTo300Rub : row.priceOver300Rub };
}

function ozonFboStorageCost(sku, volumeLiters, storageDays, logistics) {
  const dimensionClass = classifySkuDimensions(sku).ozon;
  const freeDaysRow = findOzonStorageFreeDays(sku, logistics.storageFreeDays ?? []);
  const freeDays = dimensionClass === "kgt" ? freeDaysRow?.kgtDays : freeDaysRow?.standardDays;
  const rubPerLiterDay = dimensionClass === "kgt" ? logistics.storageRates?.kgtRubPerLiterDay : logistics.storageRates?.standardRubPerLiterDay;
  if (freeDays == null || rubPerLiterDay == null) return null;
  const paidDays = Math.max(0, storageDays - freeDays);
  return {
    amountRub: paidDays * volumeLiters * rubPerLiterDay,
    freeDays,
    paidDays,
    rubPerLiterDay
  };
}

function findOzonStorageFreeDays(sku, entries) {
  const byProductType = entries.filter((item) => item.productType === sku.ozonProductType);
  if (byProductType.length) {
    return (
      byProductType.find((item) => item.category === sku.ozonCategory) ??
      byProductType.find((item) => !item.category.startsWith("Благотворительность")) ??
      byProductType[0]
    );
  }
  return entries.find((item) => item.category === sku.ozonCategory) ?? null;
}

function middleMileCostParts(sku) {
  const liters = skuMetrics(sku).volumeLiters;
  const prices = window.__PIM_DATA__.middleMile.tiers.map((tier) => tier.priceRub);
  const base = prices[0] ?? 17.39;
  const extraTo190 = prices[1] ?? 2.83;
  const extraTo350 = prices[3] ?? 3.26;
  const fixed351To1000 = prices[4] ?? 2826.09;
  const fixedFrom1001 = prices[5] ?? 5434.78;
  let firstLiterRub = base;
  let additionalTo190Rub = 0;
  let additional191To350Rub = 0;
  let fixed351To1000Rub = 0;
  let fixedFrom1001Rub = 0;
  let totalRub = base;

  if (liters > 1 && liters <= 190) {
    additionalTo190Rub = (liters - 1) * extraTo190;
    totalRub = firstLiterRub + additionalTo190Rub;
  }
  if (liters > 190 && liters <= 350) {
    additionalTo190Rub = 189 * extraTo190;
    additional191To350Rub = (liters - 190) * extraTo350;
    totalRub = firstLiterRub + additionalTo190Rub + additional191To350Rub;
  }
  if (liters > 350 && liters <= 1000) {
    firstLiterRub = 0;
    fixed351To1000Rub = fixed351To1000;
    totalRub = fixed351To1000Rub;
  }
  if (liters > 1000) {
    firstLiterRub = 0;
    fixedFrom1001Rub = fixedFrom1001;
    totalRub = fixedFrom1001Rub;
  }

  return {
    baseRub: money(firstLiterRub),
    additionalRub: money(additionalTo190Rub + additional191To350Rub + fixed351To1000Rub + fixedFrom1001Rub),
    firstLiterRub: money(firstLiterRub),
    additionalTo190Rub: money(additionalTo190Rub),
    additional191To350Rub: money(additional191To350Rub),
    fixed351To1000Rub: money(fixed351To1000Rub),
    fixedFrom1001Rub: money(fixedFrom1001Rub),
    totalRub
  };
}

function middleMileNote(sku, parts) {
  const liters = skuMetrics(sku).volumeLiters;
  if (parts.fixedFrom1001Rub > 0) return `Объём ${formatNumber(liters)} л: фиксированный тариф для 1001+ л.`;
  if (parts.fixed351To1000Rub > 0) return `Объём ${formatNumber(liters)} л: фиксированный тариф для 351-1000 л.`;
  if (parts.additional191To350Rub > 0) return `Объём ${formatNumber(liters)} л: 1-й литр + 189 л × тариф + сверх 190 л × тариф.`;
  if (parts.additionalTo190Rub > 0) return `Объём ${formatNumber(liters)} л: 1-й литр + сверх 1 л × тариф.`;
  return `Объём ${formatNumber(liters)} л: тариф до 1 литра.`;
}

function pimLastMileCostParts(sku) {
  const tariff = window.__PIM_DATA__.logistics.pimLastMile;
  const row = tariff.sellerTariffRows?.find((item) => item.city === settings.firstMileCity);
  if (!row) return null;
  const baseRub = settings.lastMileZone === "region" ? row.regionBaseRub : row.cityBaseRub;
  const extraRubPerKg = settings.lastMileZone === "region" ? row.regionExtraRubPerKg : row.cityExtraRubPerKg;
  const baseCostRub = baseRub * tariff.costMultiplier;
  const additionalCostRub = Math.max(0, skuMetrics(sku).chargeableKg - tariff.includedChargeableKg) * extraRubPerKg * tariff.costMultiplier;
  return { baseRub: baseCostRub, additionalRub: additionalCostRub, totalRub: baseCostRub + additionalCostRub };
}

function lastMileNote(sku, parts) {
  const tariff = window.__PIM_DATA__.logistics.pimLastMile;
  const row = tariff.sellerTariffRows?.find((item) => item.city === settings.firstMileCity);
  const zoneLabel = settings.lastMileZone === "region" ? "область/регион" : "город";
  if (!row || !parts) return `Город ${settings.firstMileCity}, зона ${zoneLabel}: тариф не найден.`;
  return `Город ${settings.firstMileCity}, зона ${zoneLabel}: до ${formatNumber(tariff.includedChargeableKg)} кг + сверх лимита по расчётному весу ${formatNumber(skuMetrics(sku).chargeableKg)} кг.`;
}

function marketplaceLabel(marketplace) {
  return marketplace === "wildberries" ? "WB" : "Ozon";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function pluralize(value, one, few, many) {
  const mod10 = Math.abs(value) % 10;
  const mod100 = Math.abs(value) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

init();
