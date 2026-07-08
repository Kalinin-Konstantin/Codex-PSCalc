# MPStats seller check integration

Status: MPStats seller analytics MVP is implemented. Do not change calculator formulas from this document alone.

## Goal

Add a separate MPStats section for a manager's one-time seller evaluation.

The main unit-economics calculator remains the primary screen and must not be filled with MPStats analytics. MPStats data is shown in its own application tab/section and is used for initial seller assessment, not for changing existing calculation business logic.

MVP flow:

1. Manager opens the MPStats section.
2. Manager pastes a WB/Ozon product link or SKU.
3. Backend resolves marketplace, SKU, seller, and the last 30 days period.
4. Manager chooses mode: `FBO` or `FBO + FBS`.
5. Backend requests MPStats through server-side routes only.
6. UI shows tabs: `Сводка`, `Цены`, `Склады / география`, `Предметы WB / Ниши Ozon`.
7. Manager manually selects status: `интересный селлер`, `неинтересный селлер`, or `ручная проверка`.
8. Manager clicks `Сохранить проверку`.

No cron, scheduled auto-refresh, or user-facing `Обновить данные` button is planned for MVP. Any cache is only an internal technical optimization to save MPStats limits.

## Sources inspected

- `MPStats.docx` in the project root.
- Installed MPStats skill at `/Users/konstantin/.agents/skills/mpstats/SKILL.md`.
- MPStats skill references:
  - `references/auth.md`
  - `references/wb-categories.md`
  - `references/wb-brands-sellers.md`
  - `references/wb-similar-sku.md`
  - `references/ozon-brands-sellers-sku.md`
- MPStats skill scripts:
  - `scripts/wb/wb-seller.sh`
  - `scripts/wb/wb-sku.sh`
  - `scripts/ozon/ozon-seller.sh`
  - `scripts/ozon/ozon-sku.sh`
- Current project files:
  - `src/app/api/mpstats/route.ts`
  - `src/app/api/tariffs/route.ts`
  - `src/app/api/cron/wb-tariffs/route.ts`
  - `src/lib/auth/session.ts`
  - `src/app/page.tsx`
  - `src/app/admin/page.tsx`
  - `src/components/calculator-app.tsx`
  - `.env.example`
  - `README.md`
  - `tests/calculator.test.ts`

## Current state

The project already has a server-side MPStats proxy:

- `POST /api/mpstats`
- implemented in `src/app/api/mpstats/route.ts`
- checks `canUseCalculator(profile)`
- reads `process.env.MPSTATS_TOKEN` server-side
- sends `X-Mpstats-TOKEN` to MPStats
- rejects invalid marketplace, method, path, query, bad JSON, missing token, and upstream failures

Security grep result:

- no frontend code uses `MPSTATS_TOKEN`
- no frontend code uses `NEXT_PUBLIC_MPSTATS_TOKEN`
- no frontend code uses `VITE_MPSTATS_TOKEN`
- no frontend code calls `mpstats.io` directly
- existing frontend fetch found for tariffs is `fetch("/api/tariffs")`

## MPStats auth and limits

MPStats base URL:

```text
https://mpstats.io/api/
```

Required request headers:

```text
X-Mpstats-TOKEN: <server-side token>
Content-Type: application/json
```

Relevant response codes:

- `200`: success
- `202`: request accepted, retry later
- `401`: invalid or missing token
- `429`: rate limit exceeded, use `Retry-After`
- `500`: MPStats internal error

Quota endpoint from the skill:

```text
GET user/report_api_limit
```

Use it before heavy development checks and later as an internal diagnostic. Do not expose raw quota details as an MVP user feature unless product asks for it.

## FBO / FBO + FBS semantics

MPStats skill references describe the query parameter as:

```text
fbs: Include FBS (1 = yes)
```

The product note in `MPStats.docx` says the MPStats cabinet switch behaves as:

- switch off: FBO only
- switch on: FBO + FBS

MVP interpretation:

- UI mode `FBO` means omit `fbs` or send `fbs=0`.
- UI mode `FBO + FBS` means send `fbs=1`.

Live check on 2026-07-03:

- WB test SKU `898788449`: `fbs=1` changed seller `by_date` totals versus `fbs=0`; revenue was about 73% higher, sales about 28% higher, and `items_with_sells` was higher. This supports the interpretation that `fbs=1` adds FBS data to FBO data for this checked seller.
- Ozon test SKU `4655965383`: `fbs=1` changed seller `by_date` totals versus `fbs=0`; revenue was about 650% higher, sales about 219% higher, and `items_with_sells` was higher. This supports the interpretation that `fbs=1` adds FBS data to FBO data for this checked seller.
- This is the implemented MVP interpretation for both marketplaces.

## Marketplace period strategy

Wildberries and Ozon intentionally use different period sources.

Wildberries:

- MPStats UI uses `GET /api/analytics/v1/public/wb/estimated_data_period`.
- The endpoint returns `date_period_end`, the latest day fully processed by MPStats.
- The backend uses `date_period_end` as `d2` and calculates `d1 = d2 - 29 days`.
- If the endpoint fails, the backend falls back to a 13-day data lag and marks `period.source = "fallback"`.

Ozon:

- MPStats support confirmed there is no direct analogue of `/api/analytics/v1/public/wb/estimated_data_period` for Ozon.
- No further hidden Ozon period endpoint discovery is planned for this integration.
- The backend uses the last fully completed calendar day as `d2` and calculates `d1 = d2 - 29 days`.
- This is the final MVP architecture for Ozon unless MPStats publishes an official Ozon period endpoint later.

## Endpoint map: Wildberries

Base:

```text
https://mpstats.io/api/analytics/v1/wb/
```

### Item by SKU / item full

Confirmed by installed skill reference `references/wb-similar-sku.md` and wrapper:

```text
scripts/wb/wb-sku.sh <sku> full
scripts/wb/wb-sku.sh <sku> by_period
scripts/wb/wb-sku.sh <sku> balance_stores
scripts/wb/wb-sku.sh <sku> sales_stores
```

Expected API paths from the skill wrapper:

```text
GET items/{id}
GET items/{id}/full
GET items/{id}/by_period
GET items/{id}/balance/stores
GET items/{id}/sales/stores
GET items/{id}/stores
```

Data to use for seller resolution:

- `supplier_id`
- `seller`
- product `id`
- product `url`

Implementation note: `items/{id}/full` responses vary by marketplace and category, so seller/product extraction is intentionally tolerant and covered by recorded fixtures.

### Seller info

Confirmed:

```text
GET seller/{id}
GET seller/list
```

Use:

- seller name
- seller ID verification

Implementation note: response fields are handled through tolerant extraction because MPStats item/seller payloads are not fully uniform across categories.

### Seller items

Confirmed:

```text
POST seller/items?d1={from}&d2={to}&path={supplierId}&fbs={0|1}
```

`path` is the WB seller/supplier ID.

Response is documented as the same product fields as `category/items`. Useful fields:

- `id`
- `name`
- `seller`
- `supplier_id`
- `balance`
- `balance_fbs`
- `final_price`
- `basic_price`
- `client_price`
- `sales`
- `revenue`
- `days_in_stock`
- `days_with_sales`
- `is_fbs`
- `subject_id`
- `subject`
- `graph`
- `stocks_graph`
- `price_graph`

MVP use:

- SKU count in sale: count returned items with available stock/sales presence after sanity checks
- SKU with sales: count `sales > 0`, if available
- revenue: sum `revenue`
- orders/sales: sum `sales`
- average check: `revenue / sales`
- top SKU for diagnostics

### Seller summary / by date

Confirmed:

```text
POST seller/by_date?d1={from}&d2={to}&path={supplierId}&fbs={0|1}
POST seller/compare?d1={from}&d2={to}&path={supplierId}&fbs={0|1}
```

MVP use:

- prefer `seller/by_date` for daily series
- use `seller/compare` only if summary totals are unavailable from `seller/items` or `seller/by_date`

Implementation note: live checks confirmed usable summary payloads; normalizers keep multiple field aliases to protect against minor MPStats response-shape drift.

### Seller price segmentation

Confirmed:

```text
POST seller/price_segmentation?d1={from}&d2={to}&path={supplierId}&fbs={0|1}
```

MVP tab `Цены`:

- price range label / bounds
- sales/orders in range
- revenue in range
- revenue share

Implementation note: live checks confirmed usable price segmentation payloads; normalizers keep multiple field aliases to protect against minor MPStats response-shape drift.

### Seller warehouses / geography

Confirmed:

```text
POST seller/warehouses?path={supplierId}&d1={from}&d2={to}&fbs={0|1}
```

Official source found on 2026-07-05:

```text
https://mpstats.io/integrations/analytics-wb
https://mpstats.io/integrations/redocusaurus/plugin-redoc-1.yaml
```

Official query params:

- `path`: integer, required, WB seller/supplier ID
- `d1`: string, optional, `YYYY-MM-DD`
- `d2`: string, optional, `YYYY-MM-DD`
- `fbs`: boolean, optional, include FBS data
- `currency`: string, optional
- `currency_rate`: integer, optional
- `filters`: array, optional

Official response sample contains stock-style rows:

- `store_name`
- `balance`
- `items`

For MVP this means WB seller warehouses are likely useful primarily for stock/store distribution. Sales and revenue are not present in the official sample for this endpoint.

Potential fallback endpoints:

```text
POST subject/geography?path={subjectId}&fbs={0|1}
POST subject/warehouses?d1={from}&d2={to}&path={subjectId}
```

MVP tab `Склады / география` for WB:

- warehouse name
- SKU count on warehouse
- stock balance

The WB warehouse endpoint is stock-oriented. It does not provide sales, revenue, or revenue share for this tab, so the UI intentionally does not display those columns for WB.

### Seller subjects

Confirmed:

```text
POST seller/subjects?path={supplierId}&d1={from}&d2={to}&fbs={0|1}
```

Official source found on 2026-07-05:

```text
https://mpstats.io/integrations/analytics-wb
https://mpstats.io/integrations/redocusaurus/plugin-redoc-1.yaml
```

Official query params:

- `path`: integer, required, WB seller/supplier ID
- `d1`: string, optional, `YYYY-MM-DD`
- `d2`: string, optional, `YYYY-MM-DD`
- `fbs`: boolean, optional, include FBS data
- `currency`: string, optional
- `currency_rate`: integer, optional
- `filters`: array, optional

Official response sample contains subject/niche rows with:

- `id`
- `name`
- `sales`
- `revenue`
- `items`
- `items_with_sells`
- `balance`
- `revenue_percent`
- commission/logistics fields such as `commision_fbo`, `commision_fbs`, `basic_logistics`, `storage_price`, `acceptance_price`

MVP tab `Предметы WB / Ниши Ozon`:

- subject
- sales
- revenue
- share of seller revenue

Implementation note: live checks confirmed usable subject payloads; the `fbs` parameter follows the shared `FBO` / `FBO + FBS` interpretation.

## Endpoint map: Ozon

Base:

```text
https://mpstats.io/api/analytics/v1/oz/
```

### Item by SKU / item full

Confirmed:

```text
GET items/{id}/full
GET items/{id}/sales?d1={from}&d2={to}&fbs={0|1}
GET items/{id}/by_period?d1={from}&d2={to}
GET items/{id}/balance?date={date}&fbs={0|1}
GET items/{id}/stores
```

Real check already performed on `GET items/1252420260/full`:

- response contained `id`, `name`, `link`, `niche`, `brand`, `seller`, `price`, `discount`, `balance`, `delivery_scheme`, `rating`, `comments`, `period_stats`, `photo`, `sku_first_date`, `note`, `updated`, `adv_stats`
- no VGH fields were present (`weight`, `height`, `width`, `length`, `dimensions`, `attributes`, `characteristics`)

Use for seller resolution:

- `seller.id`
- `seller.name`
- `delivery_scheme`
- product name/link/price

### Seller info

Confirmed:

```text
GET seller/{id}
POST seller/list
```

Implementation note: `items/{id}/full` responses vary by category, so seller/product extraction is intentionally tolerant and covered by recorded fixtures.

### Seller items

Confirmed:

```text
POST seller/items?d1={from}&d2={to}&path={sellerIdOrName}&fbs={0|1}
```

`path` can be seller ID or seller name.

MVP use:

- SKU count in sale
- SKU with sales, if sales field exists
- revenue/orders aggregation, if response item fields expose them
- top SKU by revenue/sales for the Ozon warehouse fallback

Implementation note: seller item fields are handled through tolerant extraction because Ozon payloads are not fully uniform across categories.

### Seller summary / by date

Confirmed:

```text
POST seller/by_date?d1={from}&d2={to}&path={sellerIdOrName}&fbs={0|1}
POST seller/compare?d1={from}&d2={to}&path={sellerIdOrName}&fbs={0|1}
```

Product note says Ozon has no `Сводка` tab in MPStats cabinet; use period comparison if needed.

MVP summary source order:

1. Use `seller/by_date` totals if response has revenue and sales.
2. Else use `seller/compare` for summary totals.
3. Else sum `seller/items`.

Implementation note: live checks confirmed usable summary payloads; normalizers keep multiple field aliases to protect against minor MPStats response-shape drift.

### Seller price segmentation

Confirmed:

```text
POST seller/price_segmentation?d1={from}&d2={to}&path={sellerIdOrName}&fbs={0|1}
```

MVP tab `Цены`:

- range
- sales/orders
- revenue
- revenue share

Implementation note: live checks confirmed usable price segmentation payloads; normalizers keep multiple field aliases to protect against minor MPStats response-shape drift.

### Seller warehouses / geography

Confirmed from the reference as `POST`, but live check on 2026-07-03 matched the installed skill script behavior instead:

```text
GET seller/geography?path={sellerIdOrName}&date={YYYY-MM}
```

Not confirmed:

- `seller/warehouses` for Ozon is not listed in the skill reference.

Product note says Ozon has no general seller warehouse-stock distribution in the cabinet. Live checks confirmed that `seller/geography` returns seller-level geography/storage sales distribution with `region_data` and `storage_data`.

MVP tab `Склады / география` for Ozon uses a separate model, not the WB warehouse-stock model:

- region / storage name
- sales
- revenue
- sales share
- revenue share

Ozon geography is intentionally displayed as sales geography, not stock by warehouse.

### Seller niches

Confirmed:

```text
POST seller/niches?d1={from}&d2={to}&path={sellerIdOrName}&fbs={0|1}
```

Official source checked on 2026-07-05:

```text
https://mpstats.io/integrations/analytics-oz
https://mpstats.io/integrations/redocusaurus/plugin-redoc-0.yaml
https://mpstats.io/integrations/docs/body-parameters
```

Official contract:

- method: `POST`
- endpoint: `https://mpstats.io/api/analytics/v1/oz/seller/niches`
- `path`: integer seller ID
- `d1`: string, `YYYY-MM-DD`
- `d2`: string, `YYYY-MM-DD`
- `fbs`: boolean / `1`, include FBS data
- optional `currency`, `currency_rate`, `filters`
- table body:

```json
{
  "startRow": 0,
  "endRow": 500,
  "filterModel": {},
  "sortModel": []
}
```

Official response sample is an array of niche rows with fields including:

- `id`
- `name`
- `sales`
- `balance`
- `revenue`
- `items`
- `items_with_sells`
- `revenue_percent`

MVP tab `Предметы WB / Ниши Ozon`:

- niche
- sales
- revenue
- share of seller revenue

Implementation note: Ozon `seller/niches` requires `endRow <= 500`; larger grid windows return `422`. The backend uses a dedicated Ozon niches body with `endRow: 500`.

## Data required by MVP

Summary:

- `revenue30dRub`
- `sales30d`
- `skuCount`
- `skuWithSalesCount`, nullable if unavailable
- `averageCheckRub = revenue30dRub / sales30d`
- `mode = fbo | fbo_fbs`
- `period.from`, `period.to`

Period note:

For WB analytics, MPStats UI uses the authoritative public endpoint
`GET /api/analytics/v1/public/wb/estimated_data_period`. The response contains `date_period_end`, the latest day
processed by MPStats. The application must use that value as `period.to` / `d2` and calculate `period.from` as
`d2 - 29 days`, so all WB seller analytics blocks use the same 30-day processed period. If the endpoint is unavailable
or returns an invalid response, the server falls back to a 13-day MPStats data lag and marks `period.source` as
`fallback`; otherwise `period.source` is `estimated_data_period`.

Prices:

- `rangeLabel`
- `minPriceRub`
- `maxPriceRub`
- `sales`
- `revenueRub`
- `revenueShare`

WB warehouses:

- `name`
- `skuCount`
- `stock`

Ozon geography:

- `name`
- `region`
- `sales`
- `revenueRub`
- `salesShare`
- `revenueShare`

Subjects / niches:

- `name`
- `id`, nullable
- `sales`
- `revenueRub`
- `share`

Manual status:

- `interesting`
- `not_interesting`
- `manual_review`

Assessment guidance:

- revenue in last 30 days >= 5,000,000 RUB
- sales/orders in last 30 days >= 1,000
- average check >= 3,500 RUB
- weak warehouse distribution can make a seller interesting

## Proposed internal API routes

Keep the existing generic proxy as a low-level internal route:

```text
POST /api/mpstats
```

Current high-level application routes:

```text
POST /api/mpstats/seller/resolve
POST /api/mpstats/seller/run
POST /api/seller-checks
```

`resolve` input:

```json
{
  "input": "https://www.wildberries.ru/catalog/123/detail.aspx"
}
```

`run` input:

```json
{
  "marketplace": "wb",
  "sku": "123",
  "sellerId": "456",
  "mode": "fbo_fbs"
}
```

`run` output:

```json
{
  "ok": true,
  "source": "mpstats",
  "marketplace": "wb",
  "mode": "fbo_fbs",
  "period": {
    "from": "2026-06-03",
    "to": "2026-07-03",
    "label": "Последние 30 дней"
  },
  "seller": {
    "id": "456",
    "name": "Seller name",
    "sourceSku": "123",
    "sourceProductName": "Product name",
    "sourceProductUrl": "https://..."
  },
  "summary": {
    "revenue30dRub": 0,
    "sales30d": 0,
    "skuCount": 0,
    "skuWithSalesCount": null,
    "averageCheckRub": null
  },
  "prices": [],
  "warehouses": [],
  "subjectsOrNiches": [],
  "fallbacks": [],
  "warnings": [],
  "rawPayloadStored": false
}
```

`POST /api/seller-checks` input:

```json
{
  "sourceInput": "https://www.wildberries.ru/catalog/123/detail.aspx",
  "decisionStatus": "interesting",
  "comment": "Высокая выручка и слабое складское распределение.",
  "report": {
    "seller": {},
    "period": {},
    "fulfillmentMode": "FBO_PLUS_FBS",
    "summary": {},
    "priceSegments": [],
    "warehouses": [],
    "subjects": [],
    "warnings": []
  }
}
```

The frontend does not send `analyticsSource`. The backend sets:

```text
analytics_source = mpstats
first_source = mpstats
```

`POST /api/seller-checks` success response:

```json
{
  "ok": true,
  "data": {
    "checkId": "uuid",
    "externalSellerId": "uuid",
    "createdAt": "2026-07-06T12:00:00.000Z"
  }
}
```

## Persistence proposal

Current persistence model:

```text
external_sellers
seller_checks
```

`external_sellers` stores the neutral marketplace seller registry. `seller_checks` stores every explicit manager save action as a historical normalized snapshot.

`seller_checks.source_report_version` is the version of our internal normalized snapshot schema, not the MPStats API version. For the current MVP it is `1`.

MVP limitation:

- the client sends the full normalized `SellerReport` back to `POST /api/seller-checks`;
- the backend validates and maps this normalized report before saving;
- a later version should replace this with a server-side temporary report identifier, for example `reportId`, so the saved snapshot is loaded from a server-owned temporary report store instead of trusting a full client-returned report.

RLS:

- approved users can insert/select their own checks
- admins can select all checks
- no raw MPStats token, no request headers, and no secret payloads stored

## UI placement

Add a top-level application navigation/tab after login:

```text
Калькулятор | MPStats проверка селлера | Администрирование
```

Rules:

- `Калькулятор` remains the existing `CalculatorApp`.
- `MPStats проверка селлера` is a separate page or section, not embedded into the calculator table.
- Do not add MPStats panels into SKU rows, result columns, or the main calculation form.
- Use internal tabs inside MPStats section:
  - `Сводка`
  - `Цены`
  - `Склады / география`
  - `Предметы WB / Ниши Ozon`

Potential route:

```text
/mpstats
```

or query-tab layout:

```text
/?view=calculator
/?view=mpstats
```

Prefer `/mpstats` for cleaner ownership and lower risk of touching calculator state.

## Security constraints

- `MPSTATS_TOKEN` only in server environment.
- Never use `NEXT_PUBLIC_MPSTATS_TOKEN`.
- Never use `VITE_MPSTATS_TOKEN`.
- Never call `https://mpstats.io` from browser code.
- Frontend calls only internal routes under `/api/mpstats/...`.
- Server logs must not print token, headers, or full raw payloads unless explicitly redacted.
- Save normalized snapshots only.
- If caching is added, treat it as internal limit protection, not as user-visible refresh behavior.

## Live warehouse / geography / subjects investigation

Diagnostic scripts used during integration:

```text
scripts/mpstats-debug-warehouse-geography.ts
scripts/mpstats-support-diagnostics.ts
scripts/mpstats-warehouse-discrepancy-diagnostics.ts
```

Purpose:

- use `.env.local` / `MPSTATS_TOKEN` only server-side;
- resolve WB/Ozon product links through `items/{id}/full`;
- mask seller names and IDs in output;
- print only sanitized request params, response statuses, top-level response fields, response shapes, and usable-data flags;
- never print token, headers, or raw commercial payloads.

Final WB result:

- `items/{id}/full` resolves seller ID and seller name successfully;
- seller ID and seller name were available;
- `seller/by_date` matches the Summary tab;
- `seller/price_segmentation` matches the Prices tab;
- `seller/warehouses` works with `POST seller/warehouses?path={supplierId}&d1={from}&d2={to}` and returns stock-style rows with `store_name`, `balance`, and `items`;
- `seller/subjects` works with `POST seller/subjects?path={supplierId}&d1={from}&d2={to}&fbs={0|1}`;
- `FBO` and `FBO + FBS` modes are supported.

Final Ozon result:

- `items/{id}/full` resolves seller ID and seller name successfully;
- `seller/by_date` works for Summary;
- `seller/price_segmentation` matches the Prices tab;
- `seller/geography` works as `GET seller/geography?path={sellerId}&date=YYYY-MM` and returns seller-level geography/storage sales distribution;
- `seller/niches` works with `POST seller/niches?path={sellerId}&d1={from}&d2={to}&fbs={0|1}` and grid body `startRow: 0`, `endRow: 500`;
- `FBO` and `FBO + FBS` modes are supported for the analytics endpoints that accept `fbs`.

## Remaining non-blocking questions

1. Confirm how MPStats names orders vs sales and whether returns are included in each marketplace.
2. Continue sampling more sellers over time to detect response-shape drift early.
3. Revisit Ozon period logic only if MPStats publishes an official Ozon analogue of WB `estimated_data_period`; support currently confirmed that no direct analogue exists.

## Implemented modules

- Page: `/mpstats`
- Resolve route: `POST /api/mpstats/seller/resolve`
- Report route: `POST /api/mpstats/seller/run`
- Save route: `POST /api/seller-checks`
- Link parser: `src/lib/mpstats/resolveInput.ts`
- Server-only MPStats client: `src/lib/mpstats/client.ts`
- Shared request core for server/CLI diagnostics: `src/lib/mpstats/requestCore.ts`
- Authoritative WB period helper: `src/lib/mpstats/analyticsPeriod.ts`
- Report builder and normalizers:
  - `src/lib/mpstats/sellerResolve.ts`
  - `src/lib/mpstats/sellerReport.ts`
  - `src/lib/mpstats/sellerReportBuilder.ts`
  - `src/lib/mpstats/normalizers.ts`
- Seller check persistence:
  - `src/lib/seller-checks/types.ts`
  - `src/lib/seller-checks/validation.ts`
  - `supabase/migrations/202607060001_external_sellers_seller_checks.sql`
- Regression tests:
  - MPStats parsing, normalizers, period, security, and seller-check validation tests.
