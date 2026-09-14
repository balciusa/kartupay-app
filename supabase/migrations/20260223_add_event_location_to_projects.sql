alter table public.projects
  add column if not exists event_location_label text,
  add column if not exists event_location_address text,
  add column if not exists event_location_lat double precision,
  add column if not exists event_location_lng double precision,
  add column if not exists event_location_place_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_event_location_lat_range_check'
  ) then
    alter table public.projects
      add constraint projects_event_location_lat_range_check
      check (event_location_lat is null or (event_location_lat >= -90 and event_location_lat <= 90));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_event_location_lng_range_check'
  ) then
    alter table public.projects
      add constraint projects_event_location_lng_range_check
      check (event_location_lng is null or (event_location_lng >= -180 and event_location_lng <= 180));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_event_location_lat_lng_pair_check'
  ) then
    alter table public.projects
      add constraint projects_event_location_lat_lng_pair_check
      check ((event_location_lat is null) = (event_location_lng is null));
  end if;
end
$$;
