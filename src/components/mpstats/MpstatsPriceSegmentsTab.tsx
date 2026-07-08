import type { PriceSegment } from "../../lib/mpstats/types";
import { formatCurrency, formatNumber, formatPercent } from "./formatters";

type Props = {
  segments: PriceSegment[];
};

export function MpstatsPriceSegmentsTab({ segments }: Props) {
  if (!segments.length) {
    return <p className="mpstats-empty">Ценовые диапазоны для этого селлера пока недоступны.</p>;
  }

  return (
    <div className="mpstats-table-wrap">
      <table className="mpstats-table">
        <thead>
          <tr>
            <th>Ценовой диапазон</th>
            <th>Продажи</th>
            <th>Выручка</th>
            <th>SKU</th>
            <th>Доля продаж</th>
            <th>Доля выручки</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment) => (
            <tr key={`${segment.label}-${segment.minPrice}-${segment.maxPrice}`}>
              <td>{segment.label}</td>
              <td>{formatNumber(segment.sales)}</td>
              <td>{formatCurrency(segment.revenue)}</td>
              <td>{formatNumber(segment.items)}</td>
              <td>{formatPercent(segment.salesShare)}</td>
              <td>{formatPercent(segment.revenueShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
