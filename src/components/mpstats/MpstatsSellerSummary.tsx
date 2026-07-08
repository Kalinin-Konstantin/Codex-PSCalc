import type { SellerReport } from "../../lib/mpstats/types";
import {
  formatCurrency,
  formatDate,
  formatFulfillmentMode,
  formatMarketplace,
  formatNumber,
  maskId
} from "./formatters";

type Props = {
  report: SellerReport;
};

export function MpstatsSellerSummary({ report }: Props) {
  return (
    <div className="mpstats-summary">
      <section className="mpstats-panel">
        <div className="mpstats-panel-head">
          <div>
            <p className="eyebrow">{formatMarketplace(report.seller.marketplace)}</p>
            <h2>{report.seller.sellerName || "Селлер без названия"}</h2>
          </div>
          <span className="mpstats-mode-pill">{formatFulfillmentMode(report.fulfillmentMode)}</span>
        </div>

        <dl className="mpstats-seller-meta">
          <div>
            <dt>ID селлера</dt>
            <dd title={report.seller.sellerId}>{maskId(report.seller.sellerId)}</dd>
          </div>
          <div>
            <dt>Источник</dt>
            <dd>{report.seller.sourceProductId}</dd>
          </div>
          <div>
            <dt>Товар</dt>
            <dd>{report.seller.productName || "—"}</dd>
          </div>
          <div>
            <dt>Бренд</dt>
            <dd>{report.seller.brand || "—"}</dd>
          </div>
          <div>
            <dt>Период</dt>
            <dd>
              {formatDate(report.period.from)} – {formatDate(report.period.to)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mpstats-panel">
        <div className="mpstats-panel-head">
          <div>
            <p className="eyebrow">Сводка</p>
            <h2>Последние {report.period.days} дней</h2>
          </div>
        </div>

        <div className="mpstats-metrics">
          <Metric label="Выручка" value={formatCurrency(report.summary.revenue)} />
          <Metric label="Продажи / заказы" value={formatNumber(report.summary.sales)} />
          <Metric label="SKU в продаже" value={formatNumber(report.summary.items)} />
          <Metric label="SKU с продажами" value={formatNumber(report.summary.itemsWithSales)} />
          <Metric label="Средний чек" value={formatCurrency(report.summary.avgCheck)} />
        </div>

        <div className="mpstats-guidance">
          <strong>Ориентиры ручной оценки</strong>
          <ul>
            <li>Выручка за 30 дней: не менее 5 млн рублей.</li>
            <li>Продажи / заказы за 30 дней: не менее 1000.</li>
            <li>Средний чек: не менее 3500 рублей.</li>
            <li>Мало складов или слабое распределение может означать потенциально интересного селлера.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mpstats-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
