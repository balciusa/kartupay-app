alter table public.projects
  add column if not exists event_duration_nights integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_event_duration_nights_range'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_event_duration_nights_range
      check (event_duration_nights >= 0 and event_duration_nights <= 365);
  end if;
end
$$;

comment on column public.projects.event_duration_nights is
  'Organizer-defined event duration in calendar nights. NULL retains legacy project date semantics.';
