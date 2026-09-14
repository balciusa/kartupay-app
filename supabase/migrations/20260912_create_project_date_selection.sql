-- Collaborative project date selection. This is intentionally separate from the
-- generic availability polls so project lifecycle and financial eligibility stay explicit.

alter table if exists public.projects
  add column if not exists date_mode text not null default 'fixed',
  add column if not exists date_voting_deadline_at timestamptz,
  add column if not exists date_suggestions_close_at timestamptz,
  add column if not exists date_selection_status text not null default 'confirmed',
  add column if not exists selected_date_option_id uuid,
  add column if not exists confirmation_deadline_at timestamptz;

alter table if exists public.participants
  add column if not exists attendance_status text not null default 'confirmed',
  add column if not exists attendance_updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_date_mode_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_date_mode_check
      check (date_mode in ('fixed', 'selecting'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_date_selection_status_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_date_selection_status_check
      check (date_selection_status in (
        'open', 'awaiting_organizer_decision', 'date_selected', 'confirmation_open', 'confirmed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_date_deadlines_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_date_deadlines_check
      check (
        date_voting_deadline_at is null
        or date_suggestions_close_at is null
        or date_suggestions_close_at <= date_voting_deadline_at
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_selecting_date_state_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_selecting_date_state_check
      check (
        date_mode <> 'selecting'
        or (
          date_voting_deadline_at is not null
          and date_selection_status in ('open', 'awaiting_organizer_decision')
          and selected_date_option_id is null
          and event_start_at is null
          and event_end_at is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'participants_attendance_status_check'
      and conrelid = 'public.participants'::regclass
  ) then
    alter table public.participants add constraint participants_attendance_status_check
      check (attendance_status in (
        'pending_date_selection', 'confirmed', 'awaiting_confirmation',
        'cannot_attend', 'unconfirmed', 'observer'
      ));
  end if;
end
$$;

create table if not exists public.project_date_options (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'removed')),
  source text not null check (source in ('organizer', 'participant')),
  removed_at timestamptz,
  removed_by_user_id uuid references public.users (id) on delete set null,
  constraint project_date_options_end_after_start check (ends_at is null or ends_at > starts_at),
  constraint project_date_options_project_id_id_unique unique (project_id, id),
  constraint project_date_options_removed_state_check check (
    (status = 'active' and removed_at is null)
    or (status = 'removed' and removed_at is not null)
  )
);

create unique index if not exists project_date_options_exact_unique_idx
  on public.project_date_options (project_id, starts_at, ends_at) nulls not distinct;
create index if not exists project_date_options_project_active_start_idx
  on public.project_date_options (project_id, starts_at)
  where status = 'active';
create index if not exists project_date_options_creator_idx
  on public.project_date_options (created_by_user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_selected_date_option_id_fkey'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects add constraint projects_selected_date_option_id_fkey
      foreign key (id, selected_date_option_id)
      references public.project_date_options (project_id, id)
      on delete restrict;
  end if;
end
$$;

create index if not exists projects_selected_date_option_idx
  on public.projects (selected_date_option_id)
  where selected_date_option_id is not null;
create index if not exists projects_open_date_deadline_idx
  on public.projects (date_voting_deadline_at)
  where date_mode = 'selecting' and date_selection_status = 'open';

create table if not exists public.project_date_responses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  date_option_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  availability text not null check (availability in ('available', 'maybe', 'unavailable')),
  is_preferred boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint project_date_responses_option_project_fkey
    foreign key (project_id, date_option_id)
    references public.project_date_options (project_id, id)
    on delete cascade,
  constraint project_date_responses_option_user_unique unique (date_option_id, user_id),
  constraint project_date_responses_preferred_available_check
    check (not is_preferred or availability = 'available')
);

create unique index if not exists project_date_responses_one_preferred_idx
  on public.project_date_responses (project_id, user_id)
  where is_preferred;
create index if not exists project_date_responses_project_option_idx
  on public.project_date_responses (project_id, date_option_id);
create index if not exists project_date_responses_user_project_idx
  on public.project_date_responses (user_id, project_id);

create table if not exists public.project_priority_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  task_type text not null check (task_type in ('date_availability', 'date_confirmation')),
  status text not null default 'open' check (status in ('open', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint project_priority_tasks_project_user_type_unique unique (project_id, user_id, task_type),
  constraint project_priority_tasks_completion_check check (
    (status = 'open' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index if not exists project_priority_tasks_user_open_idx
  on public.project_priority_tasks (user_id, project_id)
  where status = 'open';

create table if not exists public.project_notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  notification_type text not null check (notification_type in (
    'date_selection_required', 'date_voting_reminder', 'date_selected_confirmation_required',
    'date_confirmation_24h', 'date_confirmation_2h', 'date_confirmation_manual'
  )),
  title text not null,
  body text not null,
  channel text not null default 'in_app',
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists project_notifications_recipient_unread_idx
  on public.project_notifications (recipient_user_id, created_at desc)
  where read_at is null;
create index if not exists project_notifications_project_created_idx
  on public.project_notifications (project_id, created_at desc);

create or replace function public.refresh_project_date_task(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_complete boolean;
begin
  select
    exists (
      select 1 from public.project_date_options o
      where o.project_id = p_project_id and o.status = 'active'
    )
    and not exists (
      select 1
      from public.project_date_options o
      where o.project_id = p_project_id
        and o.status = 'active'
        and not exists (
          select 1 from public.project_date_responses r
          where r.date_option_id = o.id and r.user_id = p_user_id
        )
    )
  into v_complete;

  insert into public.project_priority_tasks (project_id, user_id, task_type, status, completed_at, updated_at)
  values (
    p_project_id,
    p_user_id,
    'date_availability',
    case when v_complete then 'completed' else 'open' end,
    case when v_complete then now() else null end,
    now()
  )
  on conflict (project_id, user_id, task_type) do update
    set status = excluded.status,
        completed_at = excluded.completed_at,
        updated_at = now();
end
$$;

revoke all on function public.refresh_project_date_task(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refresh_project_date_task(uuid, uuid) to service_role;

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
    select p.date_mode into v_date_mode from public.projects p where p.id = new.project_id;
    new.attendance_status := case when v_date_mode = 'selecting' then 'pending_date_selection' else 'confirmed' end;
    new.attendance_updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists participants_initialize_date_state on public.participants;
create trigger participants_initialize_date_state
before insert or update of left_at on public.participants
for each row execute function public.initialize_project_participant_date_state();

create or replace function public.create_project_date_task_after_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.left_at is null and exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.date_mode = 'selecting'
  ) then
    perform public.refresh_project_date_task(new.project_id, new.user_id);
    insert into public.project_notifications (
      project_id, recipient_user_id, notification_type, title, body, dedupe_key
    ) values (
      new.project_id, new.user_id, 'date_selection_required',
      'Choose when you can attend',
      'Project date has not been decided yet. Choose the dates when you can participate.',
      'date-selection-required:' || new.project_id::text || ':' || new.user_id::text
    ) on conflict (dedupe_key) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists participants_create_project_date_task on public.participants;
create trigger participants_create_project_date_task
after insert or update of left_at on public.participants
for each row execute function public.create_project_date_task_after_join();

create or replace function public.refresh_project_date_tasks_after_option()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select p.user_id from public.participants p
    where p.project_id = new.project_id and p.left_at is null
  loop
    perform public.refresh_project_date_task(new.project_id, v_user_id);
  end loop;
  return new;
end
$$;

drop trigger if exists project_date_options_refresh_tasks on public.project_date_options;
create trigger project_date_options_refresh_tasks
after insert or update of status on public.project_date_options
for each row execute function public.refresh_project_date_tasks_after_option();

create or replace function public.refresh_project_date_task_after_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_project_date_task(new.project_id, new.user_id);
  return new;
end
$$;

drop trigger if exists project_date_responses_refresh_task on public.project_date_responses;
create trigger project_date_responses_refresh_task
after insert or update on public.project_date_responses
for each row execute function public.refresh_project_date_task_after_response();

create or replace function public.set_project_date_response(
  p_project_id uuid,
  p_option_id uuid,
  p_user_id uuid,
  p_availability text,
  p_is_preferred boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  if p_availability not in ('available', 'maybe', 'unavailable') then
    raise exception 'Invalid availability response';
  end if;
  if p_is_preferred and p_availability <> 'available' then
    raise exception 'Preferred date must also be available';
  end if;

  select * into v_project from public.projects where id = p_project_id for update;
  if v_project.date_mode <> 'selecting' or v_project.date_selection_status <> 'open' then
    raise exception 'Date voting is closed';
  end if;
  if v_project.date_voting_deadline_at is not null and v_project.date_voting_deadline_at <= now() then
    raise exception 'Date voting is closed';
  end if;
  if not exists (
    select 1 from public.participants p
    where p.project_id = p_project_id and p.user_id = p_user_id and p.left_at is null
  ) then
    raise exception 'Only active project participants can respond';
  end if;
  if not exists (
    select 1 from public.project_date_options o
    where o.id = p_option_id and o.project_id = p_project_id and o.status = 'active'
  ) then
    raise exception 'Date option not found';
  end if;

  if p_is_preferred then
    update public.project_date_responses
      set is_preferred = false, updated_at = now()
      where project_id = p_project_id and user_id = p_user_id and is_preferred;
  end if;

  insert into public.project_date_responses (
    project_id, date_option_id, user_id, availability, is_preferred, updated_at
  ) values (
    p_project_id, p_option_id, p_user_id, p_availability, p_is_preferred, now()
  )
  on conflict (date_option_id, user_id) do update
    set availability = excluded.availability,
        is_preferred = excluded.is_preferred,
        updated_at = now();
end
$$;

revoke all on function public.set_project_date_response(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_project_date_response(uuid, uuid, uuid, text, boolean) to service_role;

create or replace function public.apply_project_date_selection(
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
  v_option public.project_date_options%rowtype;
  v_project public.projects%rowtype;
  v_has_awaiting boolean;
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  if v_project.date_mode <> 'selecting'
     or v_project.date_selection_status not in ('open', 'awaiting_organizer_decision') then
    raise exception 'Project date has already been selected';
  end if;

  select * into v_option
  from public.project_date_options
  where id = p_option_id and project_id = p_project_id and status = 'active'
  for update;
  if not found then raise exception 'Date option not found'; end if;

  update public.participants p
  set attendance_status = case coalesce(r.availability, '')
        when 'available' then 'confirmed'
        when 'maybe' then 'awaiting_confirmation'
        when 'unavailable' then 'cannot_attend'
        else 'unconfirmed'
      end,
      attendance_updated_at = now()
  from (select p2.id, r2.availability
        from public.participants p2
        left join public.project_date_responses r2
          on r2.project_id = p_project_id
         and r2.date_option_id = p_option_id
         and r2.user_id = p2.user_id
        where p2.project_id = p_project_id and p2.left_at is null) r
  where p.id = r.id;

  select exists (
    select 1 from public.participants p
    where p.project_id = p_project_id and p.left_at is null
      and p.attendance_status = 'awaiting_confirmation'
  ) into v_has_awaiting;

  update public.projects
  set date_mode = 'fixed',
      selected_date_option_id = p_option_id,
      event_start_at = v_option.starts_at,
      event_end_at = v_option.ends_at,
      confirmation_deadline_at = case when v_has_awaiting then p_confirmation_deadline else null end,
      date_selection_status = case when v_has_awaiting then 'confirmation_open' else 'confirmed' end
  where id = p_project_id;

  update public.project_priority_tasks
    set status = 'completed', completed_at = now(), updated_at = now()
    where project_id = p_project_id and task_type = 'date_availability';

  insert into public.project_priority_tasks (
    project_id, user_id, task_type, status, completed_at, updated_at
  )
  select p.project_id, p.user_id, 'date_confirmation', 'open', null, now()
  from public.participants p
  where p.project_id = p_project_id and p.left_at is null
    and p.attendance_status = 'awaiting_confirmation'
  on conflict (project_id, user_id, task_type) do update
    set status = 'open', completed_at = null, updated_at = now();

  insert into public.project_notifications (
    project_id, recipient_user_id, notification_type, title, body, metadata, dedupe_key
  )
  select p.project_id, p.user_id, 'date_selected_confirmation_required',
    'Can you attend?',
    'A final project date was selected. Confirm whether you can attend.',
    jsonb_build_object('date_option_id', p_option_id, 'confirmation_deadline_at', p_confirmation_deadline),
    'date-selected-confirmation:' || p_project_id::text || ':' || p.user_id::text
  from public.participants p
  where p.project_id = p_project_id and p.left_at is null
    and p.attendance_status in ('awaiting_confirmation', 'unconfirmed')
  on conflict (dedupe_key) do nothing;
end
$$;

revoke all on function public.apply_project_date_selection(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_project_date_selection(uuid, uuid, timestamptz) to service_role;

alter table public.project_date_options enable row level security;
alter table public.project_date_responses enable row level security;
alter table public.project_priority_tasks enable row level security;
alter table public.project_notifications enable row level security;

create policy "project_date_options_select_members"
on public.project_date_options for select to authenticated
using (exists (
  select 1 from public.participants p
  where p.project_id = project_date_options.project_id
    and p.user_id = (select auth.uid()) and p.left_at is null
));

create policy "project_date_options_insert_members"
on public.project_date_options for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and status = 'active'
  and exists (
    select 1 from public.participants p
    join public.projects pr on pr.id = p.project_id
    where p.project_id = project_date_options.project_id
      and p.user_id = (select auth.uid()) and p.left_at is null
      and pr.date_mode = 'selecting' and pr.date_selection_status = 'open'
      and (pr.date_suggestions_close_at is null or pr.date_suggestions_close_at > now())
  )
);

create policy "project_date_responses_select_members"
on public.project_date_responses for select to authenticated
using (exists (
  select 1 from public.participants p
  where p.project_id = project_date_responses.project_id
    and p.user_id = (select auth.uid()) and p.left_at is null
));

create policy "project_date_responses_insert_own"
on public.project_date_responses for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.participants p
    join public.projects pr on pr.id = p.project_id
    where p.project_id = project_date_responses.project_id
      and p.user_id = (select auth.uid()) and p.left_at is null
      and pr.date_mode = 'selecting' and pr.date_selection_status = 'open'
      and (pr.date_voting_deadline_at is null or pr.date_voting_deadline_at > now())
  )
);

create policy "project_date_responses_update_own"
on public.project_date_responses for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.projects pr
    where pr.id = project_date_responses.project_id
      and pr.date_mode = 'selecting' and pr.date_selection_status = 'open'
      and (pr.date_voting_deadline_at is null or pr.date_voting_deadline_at > now())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.projects pr
    where pr.id = project_date_responses.project_id
      and pr.date_mode = 'selecting' and pr.date_selection_status = 'open'
      and (pr.date_voting_deadline_at is null or pr.date_voting_deadline_at > now())
  )
);

create policy "project_priority_tasks_select_own"
on public.project_priority_tasks for select to authenticated
using (user_id = (select auth.uid()));

create policy "project_notifications_select_own"
on public.project_notifications for select to authenticated
using (recipient_user_id = (select auth.uid()));

create policy "project_notifications_update_own"
on public.project_notifications for update to authenticated
using (recipient_user_id = (select auth.uid()))
with check (recipient_user_id = (select auth.uid()));

alter table if exists public.activity_logs
  drop constraint if exists activity_logs_entry_type_check;

alter table if exists public.activity_logs
  add constraint activity_logs_entry_type_check
  check (entry_type in (
    'project_created', 'project_updated', 'project_status_changed', 'collector_changed',
    'participant_joined', 'participant_left', 'join_request_submitted', 'join_request_approved',
    'join_request_rejected', 'join_request_canceled', 'payment_reported', 'payment_confirmed',
    'payment_unconfirmed', 'late_transfer_created', 'late_transfer_sender_marked',
    'late_transfer_collector_confirmed', 'poll_created', 'poll_updated', 'poll_deleted',
    'poll_vote_cast', 'poll_vote_changed', 'availability_poll_created',
    'availability_poll_deleted', 'availability_option_selected', 'extra_created',
    'extra_updated', 'extra_joined', 'extra_left', 'extra_collector_changed', 'extra_deleted',
    'refund_requested', 'refund_approved', 'refund_rejected', 'refund_sent', 'refund_completed',
    'date_option_suggested', 'date_option_removed', 'date_response_updated', 'project_date_selected',
    'date_confirmation_updated', 'date_reminder_sent'
  ));

notify pgrst, 'reload schema';
