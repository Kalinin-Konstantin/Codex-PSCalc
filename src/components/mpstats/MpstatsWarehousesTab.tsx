import type { Marketplace, OzonGeographyItem, SellerReportWarning, WarehouseStockItem } from "../../lib/mpstats/types";
import { formatCurrency, formatNumber, formatPercent } from "./formatters";

type Props = {
  marketplace: Marketplace;
  warehouses: WarehouseStockItem[];
  ozonGeography: OzonGeographyItem[];
  warnings: SellerReportWarning[];
};

export function MpstatsWarehousesTab({ marketplace, warehouses, ozonGeography, warnings }: Props) {
  if (marketplace === "ozon") {
    return <OzonGeographyTable geography={ozonGeography} warnings={warnings} />;
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

function OzonGeographyTable({ geography, warnings }: { geography: OzonGeographyItem[]; warnings: SellerReportWarning[] }) {
  if (!geography.length) {
    const hasWarehouseWarning = warnings.some((warning) => warning.code === "OZON_WAREHOUSES_MISSING");

    if (hasWarehouseWarning) {
      return <p className="mpstats-empty">География Ozon временно недоступна.</p>;
    }

    return <p className="mpstats-empty">Данные по географии Ozon для этого селлера пока недоступны.</p>;
  }

  return (
    <div className="mpstats-table-wrap">
      <table className="mpstats-table">
        <thead>
          <tr>
            <th>Регион / склад</th>
            <th>Продажи</th>
            <th>Выручка</th>
            <th>Доля продаж</th>
            <th>Доля выручки</th>
          </tr>
        </thead>
        <tbody>
          {geography.map((item, index) => (
            <tr key={`${item.region ?? "unknown"}-${item.name}-${index}`}>
              <td>
                <strong>{formatRegionWarehouse(item)}</strong>
              </td>
              <td>{formatNumber(item.sales)}</td>
              <td>{formatCurrency(item.revenue)}</td>
              <td>{formatPercent(item.salesShare)}</td>
              <td>{formatPercent(item.revenueShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatRegionWarehouse(item: OzonGeographyItem) {
  return item.region ? `${item.region} / ${item.name}` : item.name;
}
