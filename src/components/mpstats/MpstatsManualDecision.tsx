"use client";

import type { SellerCheckDecisionStatus } from "../../lib/seller-checks/types";

const decisions: Array<{ value: SellerCheckDecisionStatus; label: string }> = [
  { value: "interesting", label: "интересный селлер" },
  { value: "not_interesting", label: "неинтересный селлер" },
  { value: "manual_review", label: "ручная проверка" }
];

type Props = {
  decision: SellerCheckDecisionStatus;
  comment: string;
  isSaving: boolean;
  saveMessage: string | null;
  saveError: string | null;
  onDecisionChange: (decision: SellerCheckDecisionStatus) => void;
  onCommentChange: (comment: string) => void;
  onSave: () => void;
};

export function MpstatsManualDecision({
  decision,
  comment,
  isSaving,
  saveMessage,
  saveError,
  onDecisionChange,
  onCommentChange,
  onSave
}: Props) {
  return (
    <section className="mpstats-panel mpstats-decision">
      <div>
        <p className="eyebrow">Статус оценки</p>
        <h2>Решение менеджера</h2>
        <p>Автооценка не применяется: менеджер выбирает статус вручную по данным отчета.</p>
      </div>

      <div className="mpstats-decision-options" role="radiogroup" aria-label="Статус оценки селлера">
        {decisions.map((item) => (
          <label key={item.value} className={decision === item.value ? "active" : ""}>
            <input
              type="radio"
              name="mpstats-decision"
              value={item.value}
              checked={decision === item.value}
              onChange={() => onDecisionChange(item.value)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      <label className="mpstats-comment-field">
        <span>Комментарий менеджера</span>
        <textarea
          value={comment}
          maxLength={1500}
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Коротко зафиксируйте, почему селлер интересен, неинтересен или требует ручной проверки."
        />
      </label>

      <div className="mpstats-save-row">
        <button type="button" disabled={isSaving} onClick={onSave}>
          {isSaving ? "Сохраняем…" : "Сохранить проверку"}
        </button>
        <span>{comment.length}/1500</span>
      </div>

      {saveMessage ? <p className="mpstats-save-message">{saveMessage}</p> : null}
      {saveError ? <p className="mpstats-form-error">{saveError}</p> : null}
    </section>
  );
}
