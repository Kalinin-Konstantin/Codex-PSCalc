"use client";

import { useMemo, useState } from "react";
import type { Marketplace, OzonGeographyItem, SellerReportWarning, WarehouseStockItem } from "../../lib/mpstats/types";
import { formatCurrency, formatNumber, formatPercent } from "./formatters";

type Props = {
  marketplace: Marketplace;
  warehouses: WarehouseStockItem[];
  ozonGeography: OzonGeographyItem[];
  warnings: SellerReportWarning[];
};

type OzonGeographyTab = "storages" | "clusters";

export function MpstatsWarehousesTab({ marketplace, warehouses, ozonGeography, warnings }: Props) {
  if (marketplace === "ozon") {
    return <OzonGeographyTables geography={ozonGeography} warnings={warnings} />;
  }

  if (!warehouses.length) {
    const hasWarehouseWarning = warnings.some((warning) =>
      ["WAREHOUSES_UNAVAILABLE", "OZON_WAREHOUSES_MISSING"].includes(warning.code)
    );

    if (marketplace === "wb" && hasWarehouseWarning) {
      return (
        <p className="mpstats-empty">
          Данные по складским остаткам WB временно недоступны.
        </p>
      );
    }

    return <p className="mpstats-empty">Данные по складам / географии для этого селлера пока недоступны.</p>;
  }

  return (
    <div className="mpstats-table-wrap">
      <table className="mpstats-table">
        <thead>
          <tr>
            <th>Склад</th>
            <th>SKU</th>
            <th>Остаток</th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((warehouse) => (
            <tr key={warehouse.name}>
              <td>
                <strong>{warehouse.name}</strong>
              </td>
              <td>{formatNumber(warehouse.skuCount)}</td>
              <td>{formatNumber(warehouse.stock)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OzonGeographyTables({ geography, warnings }: { geography: OzonGeographyItem[]; warnings: SellerReportWarning[] }) {
  const [activeTab, setActiveTab] = useState<OzonGeographyTab>("storages");
  const storageRows = useMemo(() => geography.filter(isUsableStorageRow), [geography]);
  const clusterRows = useMemo(() => buildClusterRows(geography), [geography]);

  if (!geography.length) {
    const hasWarehouseWarning = warnings.some((warning) => warning.code === "OZON_WAREHOUSES_MISSING");

    if (hasWarehouseWarning) {
      return <p className="mpstats-empty">География Ozon временно недоступна.</p>;
    }

    return <p className="mpstats-empty">Данные по географии Ozon для этого селлера пока недоступны.</p>;
  }

  return (
    <div className="mpstats-ozon-geo">
      <div className="mpstats-subtabs" role="tablist" aria-label="География Ozon">
        <button
          type="button"
          className={activeTab === "storages" ? "mpstats-subtab active" : "mpstats-subtab"}
          onClick={() => setActiveTab("storages")}
          role="tab"
          aria-selected={activeTab === "storages"}
        >
          Склады
        </button>
        <button
          type="button"
          className={activeTab === "clusters" ? "mpstats-subtab active" : "mpstats-subtab"}
          onClick={() => setActiveTab("clusters")}
          role="tab"
          aria-selected={activeTab === "clusters"}
        >
          Кластеры
        </button>
      </div>

      {activeTab === "storages" ? <OzonStoragesTable rows={storageRows} /> : null}
      {activeTab === "clusters" ? <OzonClustersTable rows={clusterRows} /> : null}
    </div>
  );
}

type OzonStorageRow = OzonGeographyItem & {
  name: string;
  region: string;
  revenue: number;
  revenueShare: number;
};

function OzonStoragesTable({ rows }: { rows: OzonStorageRow[] }) {
  if (!rows.length) {
    return <p className="mpstats-empty">MPStats не вернул пригодные строки по складам Ozon.</p>;
  }

  return (
    <>
      <p className="mpstats-table-note">
        Склады, с которых товары доставлялись покупателям, и кластеры, в которые они доставлялись.
      </p>
      <div className="mpstats-table-wrap">
        <table className="mpstats-table">
          <thead>
            <tr>
              <th>Склад</th>
              <th>Кластер</th>
              <th>Доля в сумме продаж</th>
              <th>Продажи, ₽</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.region}-${item.name}-${index}`}>
                <td>
                  <strong>{item.name}</strong>
                </td>
                <td>{item.region}</td>
                <td>{formatPercent(item.revenueShare)}</td>
                <td>{formatCurrency(item.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OzonClustersTable({ rows }: { rows: OzonClusterRow[] }) {
  if (!rows.length) {
    return <p className="mpstats-empty">MPStats не вернул пригодные строки по кластерам Ozon.</p>;
  }

  return (
    <>
      <p className="mpstats-table-note">Кластеры — регионы, из которых покупатели оформляли заказы.</p>
      <div className="mpstats-table-wrap">
        <table className="mpstats-table">
          <thead>
            <tr>
              <th>Кластер</th>
              <th>Доля в сумме продаж</th>
              <th>Продажи, ₽</th>
              <th>Заказы, шт.</th>
              <th>Доля в заказах</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.region}>
                <td>
                  <strong>{item.region}</strong>
                </td>
                <td>{formatPercent(item.revenueShare)}</td>
                <td>{formatCurrency(item.revenue)}</td>
                <td>{formatNumber(item.count)}</td>
                <td>{formatPercent(item.countShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type OzonClusterRow = {
  region: string;
  revenue: number;
  revenueShare: number;
  count: number;
  countShare: number;
};

function buildClusterRows(geography: OzonGeographyItem[]): OzonClusterRow[] {
  const byRegion = new Map<string, OzonClusterRow>();

  for (const item of geography) {
    if (!isUsableClusterSourceRow(item)) continue;

    const current = byRegion.get(item.region) ?? {
      region: item.region,
      revenue: 0,
      revenueShare: 0,
      count: 0,
      countShare: 0
    };

    current.revenue += item.revenue;
    current.revenueShare += item.revenueShare;
    current.count += item.count;
    current.countShare += item.countShare;
    byRegion.set(item.region, current);
  }

  return [...byRegion.values()].sort((left, right) => right.revenue - left.revenue);
}

function isUsableStorageRow(item: OzonGeographyItem): item is OzonStorageRow {
  return Boolean(
    item.name
    && item.region
    && isFiniteNumber(item.revenue)
    && isFiniteNumber(item.revenueShare)
  );
}

function isUsableClusterSourceRow(
  item: OzonGeographyItem
): item is OzonGeographyItem & { region: string; revenue: number; revenueShare: number; count: number; countShare: number } {
  return Boolean(
    item.region
    && isFiniteNumber(item.revenue)
    && isFiniteNumber(item.revenueShare)
    && isFiniteNumber(item.count)
    && isFiniteNumber(item.countShare)
  );
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
