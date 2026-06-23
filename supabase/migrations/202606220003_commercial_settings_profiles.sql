create table if not exists public.commercial_settings_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  settings jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create unique index if not exists commercial_settings_profiles_default_idx
on public.commercial_settings_profiles (is_default)
where is_default;

drop trigger if exists commercial_settings_profiles_touch_updated_at on public.commercial_settings_profiles;
create trigger commercial_settings_profiles_touch_updated_at
before update on public.commercial_settings_profiles
for each row execute function public.touch_updated_at();

alter table public.commercial_settings_profiles enable row level security;

grant select, insert, update, delete on public.commercial_settings_profiles to authenticated;

drop policy if exists "commercial_settings_profiles_select_default_or_admin" on public.commercial_settings_profiles;
create policy "commercial_settings_profiles_select_default_or_admin"
on public.commercial_settings_profiles
for select
to authenticated
using ((is_default and public.is_approved_user()) or public.is_approved_admin());

drop policy if exists "commercial_settings_profiles_insert_admin" on public.commercial_settings_profiles;
create policy "commercial_settings_profiles_insert_admin"
on public.commercial_settings_profiles
for insert
to authenticated
with check (public.is_approved_admin());

drop policy if exists "commercial_settings_profiles_update_admin" on public.commercial_settings_profiles;
create policy "commercial_settings_profiles_update_admin"
on public.commercial_settings_profiles
for update
to authenticated
using (public.is_approved_admin())
with check (public.is_approved_admin());

drop policy if exists "commercial_settings_profiles_delete_admin" on public.commercial_settings_profiles;
create policy "commercial_settings_profiles_delete_admin"
on public.commercial_settings_profiles
for delete
to authenticated
using (public.is_approved_admin());

insert into public.commercial_settings_profiles (name, settings, is_default)
values (
  'Базовые коммерческие настройки',
  '{
    "firstMileMarkupPercent": 10,
    "warehouseMarkupPercent": 20,
    "warehouseSupplyType": "mono_pallet",
    "warehouseOperationGroups": {
      "receiving": true,
      "storage": true,
      "fulfillment": true,
      "shipping": true
    },
    "warehouseOperationMarkupPercents": {
      "receiving": 20,
      "storage": 20,
      "fulfillment": 20,
      "shipping": 20
    },
    "warehouseOperationRowMarkupPercents": {},
    "warehouseReceivingMarkupPercents": {},
    "warehouseStorageMarkupPercents": {},
    "warehouseFulfillmentExtraOperations": {},
    "middleMileFirstLiterMarkupPercent": 20,
    "middleMileAdditionalLiterMarkupPercent": 30,
    "middleMileOver190LiterMarkupPercent": 30,
    "middleMileFrom351To1000MarkupPercent": 20,
    "middleMileFrom1001MarkupPercent": 20,
    "lastMileBaseMarkupPercent": 30,
    "lastMileAdditionalKgMarkupPercent": 30
  }'::jsonb,
  true
)
on conflict do nothing;
