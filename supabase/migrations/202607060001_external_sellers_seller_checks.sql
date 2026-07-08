create table if not exists public.external_sellers (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null check (marketplace in ('wb', 'ozon', 'ym')),
  external_seller_id text,
  external_seller_name text,
  normalized_seller_key text not null check (length(trim(normalized_seller_key)) > 0),
  first_source text not null default 'mpstats' check (length(trim(first_source)) > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_sellers_marketplace_key_unique unique (marketplace, normalized_seller_key)
);

-- Supports marketplace-level filters and future marketplace-specific admin views.
create index if not exists external_sellers_marketplace_idx
on public.external_sellers (marketplace);

-- Supports looking up registry entries initially created by a manager.
create index if not exists external_sellers_created_by_idx
on public.external_sellers (created_by);

drop trigger if exists external_sellers_touch_updated_at on public.external_sellers;
create trigger external_sellers_touch_updated_at
before update on public.external_sellers
for each row execute function public.touch_updated_at();

create table if not exists public.seller_checks (
  id uuid primary key default gen_random_uuid(),
  external_seller_ref uuid not null references public.external_sellers(id) on delete restrict,
  checked_by uuid not null references public.profiles(id) on delete restrict,
  analytics_source text not null default 'mpstats' check (length(trim(analytics_source)) > 0),
  source_report_version text not null default '1' check (length(trim(source_report_version)) > 0),
  marketplace text not null check (marketplace in ('wb', 'ozon', 'ym')),
  marketplace_seller_id text,
  seller_name text,
  source_product_id text not null check (length(trim(source_product_id)) > 0),
  source_product_url text,
  product_name text,
  brand text,
  period_from date not null,
  period_to date not null,
  period_days integer not null default 30 check (period_days > 0),
  fulfillment_mode text not null check (fulfillment_mode in ('FBO', 'FBO_PLUS_FBS')),
  revenue numeric check (revenue is null or revenue >= 0),
  sales numeric check (sales is null or sales >= 0),
  avg_check numeric check (avg_check is null or avg_check >= 0),
  items_count integer check (items_count is null or items_count >= 0),
  items_with_sales_count integer check (items_with_sales_count is null or items_with_sales_count >= 0),
  decision_status text not null check (decision_status in ('interesting', 'not_interesting', 'manual_review')),
  comment text check (comment is null or char_length(comment) <= 1500),
  normalized_report jsonb not null check (jsonb_typeof(normalized_report) = 'object'),
  summary_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(summary_snapshot) = 'object'),
  price_segments_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(price_segments_snapshot) = 'array'),
  warehouses_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(warehouses_snapshot) = 'array'),
  subjects_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(subjects_snapshot) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  data_quality jsonb not null default '{}'::jsonb check (jsonb_typeof(data_quality) = 'object'),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_checks_period_consistent check (
    period_to >= period_from
    and ((period_to - period_from) + 1) = period_days
  )
);

-- Supports the manager's own saved-checks list ordered by newest checks first.
create index if not exists seller_checks_checked_by_checked_at_idx
on public.seller_checks (checked_by, checked_at desc);

-- Supports history views for repeated checks of the same external seller.
create index if not exists seller_checks_external_seller_ref_checked_at_idx
on public.seller_checks (external_seller_ref, checked_at desc);

-- Supports admin filters by marketplace and manual decision status.
create index if not exists seller_checks_marketplace_decision_checked_at_idx
on public.seller_checks (marketplace, decision_status, checked_at desc);

-- Supports sales/admin reports that rank checks by captured revenue.
create index if not exists seller_checks_revenue_desc_idx
on public.seller_checks (revenue desc)
where revenue is not null;

drop trigger if exists seller_checks_touch_updated_at on public.seller_checks;
create trigger seller_checks_touch_updated_at
before update on public.seller_checks
for each row execute function public.touch_updated_at();

alter table public.external_sellers enable row level security;
alter table public.seller_checks enable row level security;

grant select, insert on public.external_sellers to authenticated;
grant select, insert on public.seller_checks to authenticated;

drop policy if exists "external_sellers_select_approved" on public.external_sellers;
create policy "external_sellers_select_approved"
on public.external_sellers
for select
to authenticated
using (public.is_approved_user() or public.is_approved_admin());

drop policy if exists "external_sellers_insert_own_approved" on public.external_sellers;
create policy "external_sellers_insert_own_approved"
on public.external_sellers
for insert
to authenticated
with check (created_by = auth.uid() and public.is_approved_user());

drop policy if exists "seller_checks_select_own_or_admin" on public.seller_checks;
create policy "seller_checks_select_own_or_admin"
on public.seller_checks
for select
to authenticated
using (checked_by = auth.uid() or public.is_approved_admin());

drop policy if exists "seller_checks_insert_own_approved" on public.seller_checks;
create policy "seller_checks_insert_own_approved"
on public.seller_checks
for insert
to authenticated
with check (
  checked_by = auth.uid()
  and public.is_approved_user()
  and exists (
    select 1
    from public.external_sellers
    where external_sellers.id = seller_checks.external_seller_ref
      and external_sellers.marketplace = seller_checks.marketplace
  )
);
