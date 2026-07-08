import type { FulfillmentMode, MarketplaceInput } from "../../lib/mpstats/types";

type Props = {
  input: string;
  marketplace: MarketplaceInput;
  fulfillmentMode: FulfillmentMode;
  isLoading: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onMarketplaceChange: (value: MarketplaceInput) => void;
  onFulfillmentModeChange: (value: FulfillmentMode) => void;
  onSubmit: () => void;
};

export function MpstatsSellerSearch({
  input,
  marketplace,
  fulfillmentMode,
  isLoading,
  error,
  onInputChange,
  onMarketplaceChange,
  onFulfillmentModeChange,
  onSubmit
}: Props) {
  return (
    <section className="mpstats-search" aria-label="Поиск селлера MPStats">
      <label className="mpstats-search-input">
        <span>Ссылка на товар или SKU</span>
        <input
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="https://www.wildberries.ru/catalog/123456/detail.aspx"
          disabled={isLoading}
        />
      </label>

      <label>
        <span>Маркетплейс</span>
        <select
          value={marketplace}
          onChange={(event) => onMarketplaceChange(event.target.value as MarketplaceInput)}
          disabled={isLoading}
        >
          <option value="auto">Auto</option>
          <option value="wb">WB</option>
          <option value="ozon">Ozon</option>
        </select>
      </label>

      <label>
        <span>Схема</span>
        <select
          value={fulfillmentMode}
          onChange={(event) => onFulfillmentModeChange(event.target.value as FulfillmentMode)}
          disabled={isLoading}
        >
          <option value="FBO">FBO</option>
          <option value="FBO_PLUS_FBS">FBO + FBS</option>
        </select>
      </label>

      <button type="button" disabled={isLoading} onClick={onSubmit}>
        {isLoading ? "Получаем…" : "Получить данные"}
      </button>

      {error ? <p className="mpstats-form-error">{error}</p> : null}
    </section>
  );
}
