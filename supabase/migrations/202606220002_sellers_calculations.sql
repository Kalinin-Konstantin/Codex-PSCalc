create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sellers_owner_id_idx on public.sellers(owner_id);

drop trigger if exists sellers_touch_updated_at on public.sellers;
create trigger sellers_touch_updated_at
before update on public.sellers
for each row execute function public.touch_updated_at();

create table if not exists public.calculations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calculations_owner_id_idx on public.calculations(owner_id);
create index if not exists calculations_seller_id_idx on public.calculations(seller_id);
create index if not exists calculations_updated_at_idx on public.calculations(updated_at desc);

drop trigger if exists calculations_touch_updated_at on public.calculations;
create trigger calculations_touch_updated_at
before update on public.calculations
for each row execute function public.touch_updated_at();

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'approved'
  );
$$;

alter table public.sellers enable row level security;
alter table public.calculations enable row level security;

grant select, insert, update, delete on public.sellers to authenticated;
grant select, insert, update, delete on public.calculations to authenticated;

drop policy if exists "sellers_select_own_or_admin" on public.sellers;
create policy "sellers_select_own_or_admin"
on public.sellers
for select
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin());

drop policy if exists "sellers_insert_own_approved" on public.sellers;
create policy "sellers_insert_own_approved"
on public.sellers
for insert
to authenticated
with check (owner_id = auth.uid() and public.is_approved_user());

drop policy if exists "sellers_update_own_or_admin" on public.sellers;
create policy "sellers_update_own_or_admin"
on public.sellers
for update
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin())
with check (owner_id = auth.uid() or public.is_approved_admin());

drop policy if exists "sellers_delete_own_or_admin" on public.sellers;
create policy "sellers_delete_own_or_admin"
on public.sellers
for delete
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin());

drop policy if exists "calculations_select_own_or_admin" on public.calculations;
create policy "calculations_select_own_or_admin"
on public.calculations
for select
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin());

drop policy if exists "calculations_insert_own_approved" on public.calculations;
create policy "calculations_insert_own_approved"
on public.calculations
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.is_approved_user()
  and exists (
    select 1
    from public.sellers
    where sellers.id = calculations.seller_id
      and sellers.owner_id = auth.uid()
  )
);

drop policy if exists "calculations_update_own_or_admin" on public.calculations;
create policy "calculations_update_own_or_admin"
on public.calculations
for update
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin())
with check (
  owner_id = auth.uid()
  or public.is_approved_admin()
);

drop policy if exists "calculations_delete_own_or_admin" on public.calculations;
create policy "calculations_delete_own_or_admin"
on public.calculations
for delete
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin());
