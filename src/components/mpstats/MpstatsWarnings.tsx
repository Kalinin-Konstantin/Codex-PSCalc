import type { SellerReportWarning } from "../../lib/mpstats/types";

type Props = {
  warnings: SellerReportWarning[];
};

const warningLabels: Record<string, string> = {
  OZON_WAREHOUSES_MISSING:
    "География Ozon временно недоступна: MPStats не вернул пригодные storage_data.",
  WAREHOUSES_UNAVAILABLE:
    "Данные по складам / географии временно недоступны: MPStats не вернул этот блок.",
  SUBJECTS_UNAVAILABLE: "Данные по предметам / нишам временно недоступны: MPStats не вернул этот блок.",
  PRICE_SEGMENTS_UNAVAILABLE: "Ценовая сегментация временно недоступна.",
  SUMMARY_UNAVAILABLE: "Сводка по селлеру временно недоступна.",
  MPSTATS_RATE_LIMIT: "MPStats ограничил количество запросов. Повторите попытку позже.",
  PARTIAL_REPORT: "Отчет собран частично: часть блоков MPStats не вернула пригодные данные."
};

export function MpstatsWarnings({ warnings }: Props) {
  if (!warnings.length) return null;

  return (
    <section className="mpstats-warnings" aria-label="Предупреждения MPStats">
      {warnings.map((warning, index) => (
        <div key={`${warning.code}-${index}`} className="mpstats-warning">
          <strong>{warningLabels[warning.code] ?? warning.message}</strong>
          {warningLabels[warning.code] && warning.message ? <span>{warning.message}</span> : null}
        </div>
      ))}
    </section>
  );
}
