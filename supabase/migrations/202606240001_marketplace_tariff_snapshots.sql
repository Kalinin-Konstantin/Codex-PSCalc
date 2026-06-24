create table if not exists public.marketplace_tariff_snapshots (
  marketplace text not null check (length(trim(marketplace)) > 0),
  snapshot_date date not null,
  status text not null default 'success' check (status in ('success', 'error')),
  source text,
  data jsonb not null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (marketplace, snapshot_date)
);

create index if not exists marketplace_tariff_snapshots_latest_idx
on public.marketplace_tariff_snapshots (marketplace, status, snapshot_date desc);

drop trigger if exists marketplace_tariff_snapshots_touch_updated_at on public.marketplace_tariff_snapshots;
create trigger marketplace_tariff_snapshots_touch_updated_at
before update on public.marketplace_tariff_snapshots
for each row execute function public.touch_updated_at();

alter table public.marketplace_tariff_snapshots enable row level security;

grant select on public.marketplace_tariff_snapshots to authenticated;

drop policy if exists "marketplace_tariff_snapshots_select_approved" on public.marketplace_tariff_snapshots;
create policy "marketplace_tariff_snapshots_select_approved"
on public.marketplace_tariff_snapshots
for select
to authenticated
using (public.is_approved_user() or public.is_approved_admin());
