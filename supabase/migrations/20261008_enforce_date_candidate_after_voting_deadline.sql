-- Duration-backed Date Finder candidates are calendar dates. Serialize both
-- option writes and deadline changes on the parent project row so concurrent
-- operations cannot validate against stale project state.

do $$
begin
  if exists (
    select 1
    from public.project_date_options option
    join public.projects project on project.id = option.project_id
    where project.date_mode = 'selecting'
      and project.event_duration_nights is not null
      and project.date_voting_deadline_at is not null
      and (option.starts_at at time zone 'UTC')::date
        <= (project.date_voting_deadline_at at time zone 'UTC')::date
  ) then
    raise exception using
      errcode = '23514',
      message = 'Existing date option violates voting deadline date';
  end if;
end
$$;

create or replace function public.enforce_project_date_option_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project record;
  v_start_midnight timestamptz;
  v_expected_end timestamptz;
begin
  select
      project.date_mode,
      project.event_duration_nights,
      project.date_voting_deadline_at
    into v_project
    from public.projects project
    where project.id = new.project_id
    for update;

  if not found then
    raise exception 'Project not found';
  end if;

  -- NULL duration is the explicit legacy compatibility mode.
  if v_project.event_duration_nights is null then
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

  if v_project.date_mode = 'selecting'
     and v_project.date_voting_deadline_at is not null
     and (new.starts_at at time zone 'UTC')::date
       <= (v_project.date_voting_deadline_at at time zone 'UTC')::date then
    raise exception using
      errcode = '23514',
      message = 'Date option must start after voting deadline date';
  end if;

  if v_project.event_duration_nights = 0 then
    if new.ends_at is not null then
      raise exception using
        errcode = '23514',
        message = 'Date option does not match project event duration';
    end if;
  else
    v_expected_end := (
      (
        (new.starts_at at time zone 'UTC')::date
        + v_project.event_duration_nights
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

create or replace function public.guard_project_date_candidate_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The UPDATE already holds the parent row lock used by option validation.
  -- Any concurrent option INSERT/UPDATE must wait and then see this new value.
  if new.date_mode = 'selecting'
     and new.event_duration_nights is not null
     and new.date_voting_deadline_at is not null
     and exists (
       select 1
       from public.project_date_options option
       where option.project_id = new.id
         and (option.starts_at at time zone 'UTC')::date
           <= (new.date_voting_deadline_at at time zone 'UTC')::date
     ) then
    raise exception using
      errcode = '23514',
      message = 'Date option must start after voting deadline date';
  end if;

  return new;
end
$$;

revoke all on function public.guard_project_date_candidate_deadline()
  from public, anon, authenticated;

drop trigger if exists projects_guard_date_candidate_deadline
  on public.projects;
create trigger projects_guard_date_candidate_deadline
before update of date_voting_deadline_at, date_mode, event_duration_nights
on public.projects
for each row
when (
  old.date_voting_deadline_at is distinct from new.date_voting_deadline_at
  or old.date_mode is distinct from new.date_mode
  or old.event_duration_nights is distinct from new.event_duration_nights
)
execute function public.guard_project_date_candidate_deadline();
