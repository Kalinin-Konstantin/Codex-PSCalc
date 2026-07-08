import type { Marketplace, SellerReportWarning, SubjectDistributionItem } from "../../lib/mpstats/types";
import { formatCurrency, formatNumber, formatPercent } from "./formatters";

type Props = {
  marketplace: Marketplace;
  subjects: SubjectDistributionItem[];
  warnings: SellerReportWarning[];
};

export function MpstatsSubjectsTab({ marketplace, subjects, warnings }: Props) {
  if (!subjects.length) {
    const hasSubjectsWarning = warnings.some((warning) =>
      ["SUBJECTS_UNAVAILABLE", "NICHES_UNAVAILABLE"].includes(warning.code)
    );
    const subjectLabel = marketplace === "wb" ? "предметам" : "нишам";

    if (hasSubjectsWarning) {
      return (
        <p className="mpstats-empty">
          Данные по {subjectLabel} временно недоступны: MPStats не вернул этот блок.
        </p>
      );
    }

    return <p className="mpstats-empty">Данные по предметам / нишам временно недоступны.</p>;
  }

  return (
    <div className="mpstats-table-wrap">
      <table className="mpstats-table">
        <thead>
          <tr>
            <th>{marketplace === "wb" ? "Предмет" : "Ниша"}</th>
            <th>Продажи</th>
            <th>Выручка</th>
            <th>Остаток</th>
            <th>Доля выручки</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((subject) => (
            <tr key={subject.name}>
              <td>{subject.name}</td>
              <td>{formatNumber(subject.sales)}</td>
              <td>{formatCurrency(subject.revenue)}</td>
              <td>{formatNumber(subject.stock)}</td>
              <td>{formatPercent(subject.revenueShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
