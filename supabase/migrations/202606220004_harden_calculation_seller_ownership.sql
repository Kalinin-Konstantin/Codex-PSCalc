create or replace function public.calculation_seller_matches_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.sellers
    where sellers.id = new.seller_id
      and sellers.owner_id = new.owner_id
  ) then
    raise exception 'calculation seller must belong to calculation owner';
  end if;

  return new;
end;
$$;

drop trigger if exists calculations_seller_owner_guard on public.calculations;
create trigger calculations_seller_owner_guard
before insert or update of seller_id, owner_id on public.calculations
for each row execute function public.calculation_seller_matches_owner();

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
      and sellers.owner_id = calculations.owner_id
  )
);

drop policy if exists "calculations_update_own_or_admin" on public.calculations;
create policy "calculations_update_own_or_admin"
on public.calculations
for update
to authenticated
using (owner_id = auth.uid() or public.is_approved_admin())
with check (
  (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.sellers
      where sellers.id = calculations.seller_id
        and sellers.owner_id = calculations.owner_id
    )
  )
  or public.is_approved_admin()
);
