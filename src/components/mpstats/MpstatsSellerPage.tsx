"use client";

import { useState } from "react";
import type { FulfillmentMode, MarketplaceInput, SellerReport } from "../../lib/mpstats/types";
import type { SellerCheckDecisionStatus } from "../../lib/seller-checks/types";
import { MpstatsManualDecision } from "./MpstatsManualDecision";
import { MpstatsSellerSearch } from "./MpstatsSellerSearch";
import { MpstatsSellerSummary } from "./MpstatsSellerSummary";
import { MpstatsSellerTabs } from "./MpstatsSellerTabs";
import { MpstatsWarnings } from "./MpstatsWarnings";

type ApiSuccess = {
  ok: true;
  data: SellerReport;
};

type ApiError = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
  };
};

type ApiResponse = ApiSuccess | ApiError;

type SaveApiSuccess = {
  ok: true;
  data: {
    checkId: string;
    externalSellerId: string;
    createdAt: string;
  };
};

type SaveApiResponse = SaveApiSuccess | ApiError;

export function MpstatsSellerPage() {
  const [input, setInput] = useState("");
  const [marketplace, setMarketplace] = useState<MarketplaceInput>("auto");
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>("FBO_PLUS_FBS");
  const [report, setReport] = useState<SellerReport | null>(null);
  const [decision, setDecision] = useState<SellerCheckDecisionStatus>("manual_review");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function runSellerReport() {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      setError("Вставьте ссылку на товар WB/Ozon или SKU.");
      setReport(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const response = await fetch("/api/mpstats/seller/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmedInput,
          marketplace,
          fulfillmentMode
        })
      });

      const payload = await readJson(response);
      if (!payload.ok) {
        setReport(null);
        setError(toUserError(payload.error?.code, payload.error?.message));
        return;
      }

      if (!response.ok) {
        setReport(null);
        setError("Backend MPStats вернул ошибку. Попробуйте повторить запрос позже.");
        return;
      }

      setReport(payload.data);
      setDecision("manual_review");
      setComment("");
    } catch {
      setReport(null);
      setError("MPStats не ответил. Проверьте соединение и повторите запрос позже.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSellerCheck() {
    if (!report) {
      setSaveError("Сначала получите данные MPStats.");
      setSaveMessage(null);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const response = await fetch("/api/seller-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceInput: input.trim(),
          decisionStatus: decision,
          comment,
          report
        })
      });

      const payload = await readSaveJson(response);
      if (!payload.ok) {
        setSaveError(toSaveError(payload.error?.code, payload.error?.message));
        return;
      }

      setSaveMessage("Проверка сохранена.");
    } catch {
      setSaveError("Не удалось сохранить проверку. Проверьте соединение и повторите попытку.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mpstats-workspace" aria-label="Оценка селлера по MPStats">
      <MpstatsSellerSearch
        input={input}
        marketplace={marketplace}
        fulfillmentMode={fulfillmentMode}
        isLoading={isLoading}
        error={error}
        onInputChange={setInput}
        onMarketplaceChange={setMarketplace}
        onFulfillmentModeChange={setFulfillmentMode}
        onSubmit={runSellerReport}
      />

      {isLoading ? (
        <div className="mpstats-loading" role="status">
          Получаем данные MPStats и собираем отчет за последние 30 дней…
        </div>
      ) : null}

      {report ? (
        <div className="mpstats-report">
          <MpstatsSellerSummary report={report} />
          <MpstatsWarnings warnings={report.warnings} />
          <MpstatsSellerTabs report={report} />
          <MpstatsManualDecision
            decision={decision}
            comment={comment}
            isSaving={isSaving}
            saveMessage={saveMessage}
            saveError={saveError}
            onDecisionChange={(value) => {
              setDecision(value);
              setSaveMessage(null);
              setSaveError(null);
            }}
            onCommentChange={(value) => {
              setComment(value);
              setSaveMessage(null);
              setSaveError(null);
            }}
            onSave={saveSellerCheck}
          />
        </div>
      ) : null}
    </section>
  );
}

async function readJson(response: Response): Promise<ApiResponse> {
  try {
    return (await response.json()) as ApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: "Backend вернул некорректный ответ."
      }
    };
  }
}

async function readSaveJson(response: Response): Promise<SaveApiResponse> {
  try {
    return (await response.json()) as SaveApiResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: "Backend вернул некорректный ответ."
      }
    };
  }
}

function toUserError(code?: string, message?: string) {
  if (code === "invalid_input" || code === "marketplace_required" || code === "sku_not_found") {
    return "Не удалось распознать ссылку или SKU. Для ручного SKU выберите WB или Ozon.";
  }

  if (code === "mpstats_rate_limited") {
    return "MPStats временно ограничил количество запросов. Повторите попытку позже.";
  }

  if (code === "mpstats_timeout" || code === "mpstats_request_failed" || code === "mpstats_server_error") {
    return "MPStats не ответил или вернул ошибку. Попробуйте повторить запрос позже.";
  }

  if (code === "mpstats_unauthorized") {
    return "MPStats не принял серверный ключ. Проверьте настройку backend-доступа.";
  }

  return message || "Не удалось получить данные MPStats.";
}

function toSaveError(code?: string, message?: string) {
  if (code === "forbidden" || code === "database_forbidden") {
    return "У вас нет доступа к сохранению проверок.";
  }

  if (code === "validation_error" || code === "invalid_json" || code === "database_constraint_error") {
    return message || "Не удалось сохранить: данные проверки некорректны.";
  }

  if (code === "external_seller_conflict") {
    return "Не удалось сохранить из-за конфликта записи селлера. Повторите попытку.";
  }

  return message || "Не удалось сохранить проверку.";
}
