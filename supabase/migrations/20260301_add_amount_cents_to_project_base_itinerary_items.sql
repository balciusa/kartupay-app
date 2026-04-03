alter table if exists public.project_base_itinerary_items
  add column if not exists amount_cents integer not null default 0;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'project_base_itinerary_items'
  ) and not exists (
    select 1
    from pg_constraint
    where conname = 'project_base_itinerary_items_amount_cents_non_negative'
  ) then
    alter table public.project_base_itinerary_items
      add constraint project_base_itinerary_items_amount_cents_non_negative
      check (amount_cents >= 0);
  end if;
end
$$;
