-- Keep early Date Finder finalization inside one project-scoped transaction.
-- Scope-expanding participant/option mutations and response writes share the
-- same project row lock, so the completion cross-product cannot change between
-- validation and the existing selected-date lifecycle mutation.

create or replace function public.initialize_project_participant_date_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date_mode text;
begin
  if new.left_at is null and (
    tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.left_at is not null)
  ) then
    select p.date_mode
      into v_date_mode
      from public.projects p
      where p.id = new.project_id
      for update;

    new.attendance_status := case
      when v_date_mode = 'selecting' then 'pending_date_selection'
      else 'confirmed'
    end;
    new.attendance_updated_at := clock_timestamp();
  end if;
  return new;
end
$$;

-- This trigger is intentionally project-scoped rather than a broad table lock.
-- It covers option inserts/status changes and all response writes, including
-- direct RLS-authorized writes outside the application RPC.
create or replace function public.lock_open_project_date_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  select *
    into v_project
    from public.projects p
    where p.id = new.project_id
    for update;

  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.date_mode <> 'selecting'
     or v_project.date_selection_status <> 'open'
     or v_project.selected_date_option_id is not null
     or v_project.date_voting_deadline_at is null
     or v_project.date_voting_deadline_at <= clock_timestamp() then
    raise exception 'Date voting is closed';
  end if;

  return new;
end
$$;

drop trigger if exists project_date_options_lock_open_scope on public.project_date_options;
create trigger project_date_options_lock_open_scope
before insert or update of status on public.project_date_options
for each row execute function public.lock_open_project_date_scope();

drop trigger if exists project_date_responses_lock_open_scope on public.project_date_responses;
create trigger project_date_responses_lock_open_scope
before insert or update on public.project_date_responses
for each row execute function public.lock_open_project_date_scope();

create or replace function public.select_project_date_early(
  p_project_id uuid,
  p_option_id uuid,
  p_confirmation_deadline timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_checked_at timestamptz;
begin
  select *
    into v_project
    from public.projects p
    where p.id = p_project_id
    for update;

  if not found then
    raise exception 'Project not found';
  end if;

  -- Use wall-clock time after acquiring the serialization lock. Transaction or
  -- statement timestamps can predate time spent waiting for that lock.
  v_checked_at := clock_timestamp();

  if v_project.date_mode <> 'selecting'
     or v_project.date_selection_status <> 'open'
     or v_project.selected_date_option_id is not null then
    raise exception 'Date voting is no longer open';
  end if;

  if lower(trim(coalesce(v_project.status, ''))) in ('canceled', 'cancelled')
     or nullif(to_jsonb(v_project) ->> 'canceled_at', '') is not null
     or nullif(to_jsonb(v_project) ->> 'aborted_at', '') is not null then
    raise exception 'Date selection is disabled for canceled projects';
  end if;

  if v_project.date_voting_deadline_at is null
     or v_project.date_voting_deadline_at <= v_checked_at then
    raise exception 'The voting deadline has passed';
  end if;

  if p_confirmation_deadline is null
     or p_confirmation_deadline <= v_checked_at then
    raise exception 'Confirmation deadline must be in the future';
  end if;

  if not exists (
    select 1
    from public.project_date_options o
    where o.project_id = p_project_id
      and o.status = 'active'
  ) then
    raise exception 'No active date options are available';
  end if;

  if not exists (
    select 1
    from public.project_date_options o
    where o.project_id = p_project_id
      and o.id = p_option_id
      and o.status = 'active'
  ) then
    raise exception 'Choose an active date option from this project';
  end if;

  if exists (
    select 1
    from public.participants participant
    cross join public.project_date_options option
    where participant.project_id = p_project_id
      and participant.left_at is null
      and option.project_id = p_project_id
      and option.status = 'active'
      and not exists (
        select 1
        from public.project_date_responses response
        where response.project_id = p_project_id
          and response.date_option_id = option.id
          and response.user_id = participant.user_id
      )
  ) then
    raise exception 'Every active participant must respond to every active date option first';
  end if;

  -- Nested function calls remain in this transaction and retain the project
  -- lock. This preserves all established attendance/task/notification effects.
  perform public.apply_project_date_selection(
    p_project_id,
    p_option_id,
    p_confirmation_deadline
  );
end
$$;

revoke all on function public.select_project_date_early(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.select_project_date_early(uuid, uuid, timestamptz)
  to service_role;

revoke all on function public.lock_open_project_date_scope()
  from public, anon, authenticated;
grant execute on function public.lock_open_project_date_scope()
  to service_role;
