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

create or replace function public.enforce_project_date_option_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duration_nights integer;
  v_start_midnight timestamptz;
  v_expected_end timestamptz;
begin
  -- Serialize with duration changes and with the existing Date Finder mutation
  -- lock. This closes the race between validating an option and changing its
  -- project's authoritative duration.
  select project.event_duration_nights
    into v_duration_nights
    from public.projects project
    where project.id = new.project_id
    for update;

  if not found then
    raise exception 'Project not found';
  end if;

  -- NULL is the explicit legacy compatibility mode. Existing projects and
  -- their arbitrary date ranges retain their original semantics unchanged.
  if v_duration_nights is null then
    return new;
  end if;

  v_start_midnight := (
    (new.starts_at at time zone 'UTC')::date::timestamp at time zone 'UTC'
  );

  if new.starts_at is null or new.starts_at <> v_start_midnight then
    raise exception using
      errcode = '23514',
      message = 'Date option does not match project event duration';
  end if;

  if v_duration_nights = 0 then
    if new.ends_at is not null then
      raise exception using
        errcode = '23514',
        message = 'Date option does not match project event duration';
    end if;
  else
    -- Adding an integer to a UTC calendar date is independent of the session
    -- timezone and DST. Convert back to timestamptz only at UTC midnight.
    v_expected_end := (
      (
        (new.starts_at at time zone 'UTC')::date + v_duration_nights
      )::timestamp at time zone 'UTC'
    );

    if new.ends_at is null or new.ends_at <> v_expected_end then
      raise exception using
        errcode = '23514',
        message = 'Date option does not match project event duration';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_project_date_option_duration()
  from public, anon, authenticated;

drop trigger if exists project_date_options_enforce_duration
  on public.project_date_options;
create trigger project_date_options_enforce_duration
before insert or update of project_id, starts_at, ends_at
on public.project_date_options
for each row execute function public.enforce_project_date_option_duration();

create or replace function public.guard_project_event_duration_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Any option history makes the duration immutable. This also prevents a
  -- legacy project with arbitrary ranges from being converted implicitly.
  if exists (
    select 1
    from public.project_date_options option
    where option.project_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Project event duration cannot change after date options exist';
  end if;

  return new;
end
$$;

revoke all on function public.guard_project_event_duration_change()
  from public, anon, authenticated;

drop trigger if exists projects_guard_event_duration_change
  on public.projects;
create trigger projects_guard_event_duration_change
before update of event_duration_nights
on public.projects
for each row
when (old.event_duration_nights is distinct from new.event_duration_nights)
execute function public.guard_project_event_duration_change();
