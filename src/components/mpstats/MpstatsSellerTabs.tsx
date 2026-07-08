"use client";

import { useState } from "react";
import type { SellerReport } from "../../lib/mpstats/types";
import { MpstatsPriceSegmentsTab } from "./MpstatsPriceSegmentsTab";
import { MpstatsSubjectsTab } from "./MpstatsSubjectsTab";
import { MpstatsWarehousesTab } from "./MpstatsWarehousesTab";
import { formatCurrency, formatNumber } from "./formatters";

type Props = {
  report: SellerReport;
};

type TabId = "summary" | "prices" | "warehouses" | "subjects";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "summary", label: "Сводка" },
  { id: "prices", label: "Цены" },
  { id: "warehouses", label: "Склады / география" },
  { id: "subjects", label: "Предметы / Ниши" }
];

export function MpstatsSellerTabs({ report }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");

  return (
    <section className="mpstats-panel mpstats-tabs-panel">
      <div className="mpstats-tabs" role="tablist" aria-label="Детализация отчета MPStats">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "mpstats-tab active" : "mpstats-tab"}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" ? (
        <div className="mpstats-tab-body">
          <div className="mpstats-summary-line">
            <span>Выручка</span>
            <strong>{formatCurrency(report.summary.revenue)}</strong>
          </div>
          <div className="mpstats-summary-line">
            <span>Продажи / заказы</span>
            <strong>{formatNumber(report.summary.sales)}</strong>
          </div>
          <div className="mpstats-summary-line">
            <span>Средний чек</span>
            <strong>{formatCurrency(report.summary.avgCheck)}</strong>
          </div>
        </div>
      ) : null}

      {activeTab === "prices" ? <MpstatsPriceSegmentsTab segments={report.priceSegments} /> : null}
      {activeTab === "warehouses" ? (
        <MpstatsWarehousesTab
          marketplace={report.seller.marketplace}
          warehouses={report.warehouses}
          ozonGeography={report.ozonGeography}
          warnings={report.warnings}
        />
      ) : null}
      {activeTab === "subjects" ? (
        <MpstatsSubjectsTab marketplace={report.seller.marketplace} subjects={report.subjects} warnings={report.warnings} />
      ) : null}
    </section>
  );
}
