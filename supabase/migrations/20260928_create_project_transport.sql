-- Project-scoped transport coordination. Transport history is retained when
-- the feature is disabled, rides are canceled, or passengers leave.

alter table public.projects
  add column if not exists transport_enabled boolean not null default false;

comment on column public.projects.transport_enabled is
  'Enables project-scoped transport coordination. Disabling retains transport history.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'participants_project_id_id_unique'
      and conrelid = 'public.participants'::regclass
  ) then
    alter table public.participants
      add constraint participants_project_id_id_unique unique (project_id, id);
  end if;
end
$$;

create table if not exists public.project_transport_offers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  direction text not null check (direction in ('to_event', 'from_event')),
  driver_participant_id uuid not null,
  location_text text not null check (length(btrim(location_text)) between 1 and 300),
  departure_at timestamptz not null,
  seat_capacity integer not null check (seat_capacity between 1 and 20),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz,
  constraint project_transport_offers_project_driver_fkey
    foreign key (project_id, driver_participant_id)
    references public.participants (project_id, id)
    on delete cascade,
  constraint project_transport_offers_project_id_id_direction_unique
    unique (project_id, id, direction)
);

create unique index if not exists project_transport_offers_active_driver_direction_idx
  on public.project_transport_offers (project_id, driver_participant_id, direction)
  where canceled_at is null;
create index if not exists project_transport_offers_project_direction_departure_idx
  on public.project_transport_offers (project_id, direction, departure_at, created_at)
  where canceled_at is null;
create index if not exists project_transport_offers_driver_idx
  on public.project_transport_offers (driver_participant_id);

comment on column public.project_transport_offers.location_text is
  'Driver-entered non-event endpoint: origin for to_event, destination for from_event.';
comment on column public.project_transport_offers.seat_capacity is
  'Maximum active passengers the driver is offering; remaining seats are derived from active assignments.';

create table if not exists public.project_transport_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  direction text not null check (direction in ('to_event', 'from_event')),
  offer_id uuid not null,
  participant_id uuid not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  constraint project_transport_assignments_offer_fkey
    foreign key (project_id, offer_id, direction)
    references public.project_transport_offers (project_id, id, direction)
    on delete cascade,
  constraint project_transport_assignments_participant_fkey
    foreign key (project_id, participant_id)
    references public.participants (project_id, id)
    on delete cascade
);

create unique index if not exists project_transport_assignments_active_participant_direction_idx
  on public.project_transport_assignments (project_id, participant_id, direction)
  where left_at is null;
create unique index if not exists project_transport_assignments_active_offer_participant_idx
  on public.project_transport_assignments (offer_id, participant_id)
  where left_at is null;
create index if not exists project_transport_assignments_active_offer_idx
  on public.project_transport_assignments (offer_id, joined_at)
  where left_at is null;
create index if not exists project_transport_assignments_participant_idx
  on public.project_transport_assignments (participant_id);

create table if not exists public.project_transport_intents (
  project_id uuid not null references public.projects (id) on delete cascade,
  participant_id uuid not null,
  direction text not null check (direction in ('to_event', 'from_event')),
  intent text not null check (intent in ('needs_ride', 'own_arrangement')),
  updated_at timestamptz not null default now(),
  primary key (project_id, participant_id, direction),
  constraint project_transport_intents_participant_fkey
    foreign key (project_id, participant_id)
    references public.participants (project_id, id)
    on delete cascade
);

create index if not exists project_transport_intents_participant_idx
  on public.project_transport_intents (participant_id);

alter table public.project_transport_offers enable row level security;
alter table public.project_transport_assignments enable row level security;
alter table public.project_transport_intents enable row level security;

create policy "project_transport_offers_select_active_members"
on public.project_transport_offers for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = project_transport_offers.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));

create policy "project_transport_assignments_select_active_members"
on public.project_transport_assignments for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = project_transport_assignments.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));

create policy "project_transport_intents_select_active_members"
on public.project_transport_intents for select to authenticated
using (exists (
  select 1 from public.participants participant
  where participant.project_id = project_transport_intents.project_id
    and participant.user_id = (select auth.uid())
    and participant.left_at is null
));

revoke all on table public.project_transport_offers from anon, authenticated;
revoke all on table public.project_transport_assignments from anon, authenticated;
revoke all on table public.project_transport_intents from anon, authenticated;
grant select on table public.project_transport_offers to authenticated;
grant select on table public.project_transport_assignments to authenticated;
grant select on table public.project_transport_intents to authenticated;

create or replace function public.assert_project_transport_mutation_ready(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  select * into v_project
  from public.projects project
  where project.id = p_project_id
  for update;

  if not found then raise exception 'Project not found'; end if;
  if not v_project.transport_enabled then raise exception 'Transport coordination is disabled'; end if;
  if v_project.date_mode <> 'fixed' or v_project.event_start_at is null then
    raise exception 'A final event date has not been selected';
  end if;
  if lower(trim(coalesce(v_project.status, ''))) in ('canceled', 'cancelled')
     or nullif(to_jsonb(v_project) ->> 'canceled_at', '') is not null
     or nullif(to_jsonb(v_project) ->> 'aborted_at', '') is not null then
    raise exception 'Transport changes are disabled for canceled projects';
  end if;
end
$$;

create or replace function public.project_transport_participant_is_eligible(
  p_project_id uuid,
  p_participant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants participant
    where participant.project_id = p_project_id
      and participant.id = p_participant_id
      and participant.left_at is null
      and coalesce(participant.attendance_status, '') not in ('cannot_attend', 'observer')
  );
$$;

create or replace function public.create_project_transport_offer(
  p_project_id uuid,
  p_driver_participant_id uuid,
  p_direction text,
  p_location_text text,
  p_departure_at timestamptz,
  p_seat_capacity integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_id uuid;
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  if p_direction not in ('to_event', 'from_event') then raise exception 'Invalid transport direction'; end if;
  if length(btrim(coalesce(p_location_text, ''))) not between 1 and 300 then raise exception 'Location is required'; end if;
  if p_departure_at is null then raise exception 'Departure is required'; end if;
  if p_seat_capacity not between 1 and 20 then raise exception 'Available passenger seats must be between 1 and 20'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note must be 500 characters or fewer'; end if;
  if not public.project_transport_participant_is_eligible(p_project_id, p_driver_participant_id) then
    raise exception 'Only eligible active participants can offer rides';
  end if;
  if exists (
    select 1 from public.project_transport_assignments assignment
    where assignment.project_id = p_project_id
      and assignment.participant_id = p_driver_participant_id
      and assignment.direction = p_direction
      and assignment.left_at is null
  ) then raise exception 'Leave your current ride before offering one'; end if;

  insert into public.project_transport_offers (
    project_id, direction, driver_participant_id, location_text,
    departure_at, seat_capacity, note
  ) values (
    p_project_id, p_direction, p_driver_participant_id, btrim(p_location_text),
    p_departure_at, p_seat_capacity, nullif(btrim(coalesce(p_note, '')), '')
  ) returning id into v_offer_id;

  delete from public.project_transport_intents intent
  where intent.project_id = p_project_id
    and intent.participant_id = p_driver_participant_id
    and intent.direction = p_direction;
  return v_offer_id;
end
$$;

create or replace function public.update_project_transport_offer(
  p_project_id uuid,
  p_offer_id uuid,
  p_driver_participant_id uuid,
  p_location_text text,
  p_departure_at timestamptz,
  p_seat_capacity integer,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.project_transport_offers%rowtype;
  v_passenger_count integer;
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  select * into v_offer from public.project_transport_offers offer
  where offer.id = p_offer_id and offer.project_id = p_project_id
  for update;
  if not found or v_offer.canceled_at is not null then raise exception 'Active ride not found'; end if;
  if v_offer.driver_participant_id <> p_driver_participant_id then raise exception 'Only the driver can edit this ride'; end if;
  if not public.project_transport_participant_is_eligible(p_project_id, p_driver_participant_id) then
    raise exception 'Only eligible active participants can edit rides';
  end if;
  if length(btrim(coalesce(p_location_text, ''))) not between 1 and 300 then raise exception 'Location is required'; end if;
  if p_departure_at is null then raise exception 'Departure is required'; end if;
  if p_seat_capacity not between 1 and 20 then raise exception 'Available passenger seats must be between 1 and 20'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note must be 500 characters or fewer'; end if;

  select count(*)::integer into v_passenger_count
  from public.project_transport_assignments assignment
  where assignment.offer_id = p_offer_id and assignment.left_at is null;
  if p_seat_capacity < v_passenger_count then raise exception 'Seat capacity cannot be below assigned passengers'; end if;
  if v_passenger_count > 0 and (
    btrim(p_location_text) is distinct from v_offer.location_text
    or p_departure_at is distinct from v_offer.departure_at
  ) then raise exception 'Cancel and recreate the ride to change route or departure while passengers are assigned'; end if;

  update public.project_transport_offers
  set location_text = btrim(p_location_text), departure_at = p_departure_at,
      seat_capacity = p_seat_capacity, note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = p_offer_id;
end
$$;

create or replace function public.join_project_transport_offer(
  p_project_id uuid,
  p_offer_id uuid,
  p_participant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.project_transport_offers%rowtype;
  v_active_count integer;
  v_assignment_id uuid;
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  select * into v_offer from public.project_transport_offers offer
  where offer.id = p_offer_id and offer.project_id = p_project_id
  for update;
  if not found or v_offer.canceled_at is not null then raise exception 'Active ride not found'; end if;
  if not public.project_transport_participant_is_eligible(p_project_id, p_participant_id) then
    raise exception 'Only eligible active participants can join rides';
  end if;
  if v_offer.driver_participant_id = p_participant_id then raise exception 'A driver cannot join their own ride'; end if;
  if exists (
    select 1 from public.project_transport_offers own_offer
    where own_offer.project_id = p_project_id
      and own_offer.driver_participant_id = p_participant_id
      and own_offer.direction = v_offer.direction
      and own_offer.canceled_at is null
  ) then raise exception 'A driver cannot join another ride in the same direction'; end if;
  if exists (
    select 1 from public.project_transport_assignments assignment
    where assignment.project_id = p_project_id
      and assignment.participant_id = p_participant_id
      and assignment.direction = v_offer.direction
      and assignment.left_at is null
  ) then raise exception 'You already have a ride in this direction'; end if;

  select count(*)::integer into v_active_count
  from public.project_transport_assignments assignment
  where assignment.offer_id = p_offer_id and assignment.left_at is null;
  if v_active_count >= v_offer.seat_capacity then raise exception 'This ride is full'; end if;

  delete from public.project_transport_intents intent
  where intent.project_id = p_project_id
    and intent.participant_id = p_participant_id
    and intent.direction = v_offer.direction;
  insert into public.project_transport_assignments (
    project_id, direction, offer_id, participant_id
  ) values (
    p_project_id, v_offer.direction, p_offer_id, p_participant_id
  ) returning id into v_assignment_id;
  return v_assignment_id;
end
$$;

create or replace function public.leave_project_transport_offer(
  p_project_id uuid,
  p_participant_id uuid,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  if p_direction not in ('to_event', 'from_event') then raise exception 'Invalid transport direction'; end if;
  if not public.project_transport_participant_is_eligible(p_project_id, p_participant_id) then
    raise exception 'Only eligible active participants can leave rides';
  end if;
  update public.project_transport_assignments assignment
  set left_at = now()
  where assignment.project_id = p_project_id
    and assignment.participant_id = p_participant_id
    and assignment.direction = p_direction
    and assignment.left_at is null;
  if not found then raise exception 'Active ride assignment not found'; end if;
end
$$;

create or replace function public.remove_project_transport_passenger(
  p_project_id uuid,
  p_offer_id uuid,
  p_driver_participant_id uuid,
  p_passenger_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.project_transport_offers%rowtype;
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  select * into v_offer from public.project_transport_offers offer
  where offer.id = p_offer_id and offer.project_id = p_project_id
  for update;
  if not found or v_offer.canceled_at is not null then raise exception 'Active ride not found'; end if;
  if v_offer.driver_participant_id <> p_driver_participant_id then raise exception 'Only the driver can remove passengers'; end if;
  update public.project_transport_assignments assignment
  set left_at = now()
  where assignment.offer_id = p_offer_id
    and assignment.participant_id = p_passenger_participant_id
    and assignment.left_at is null;
  if not found then raise exception 'Active passenger assignment not found'; end if;
  if public.project_transport_participant_is_eligible(p_project_id, p_passenger_participant_id) then
    insert into public.project_transport_intents (project_id, participant_id, direction, intent, updated_at)
    values (p_project_id, p_passenger_participant_id, v_offer.direction, 'needs_ride', now())
    on conflict (project_id, participant_id, direction) do update
      set intent = 'needs_ride', updated_at = now();
  end if;
end
$$;

create or replace function public.cancel_project_transport_offer(
  p_project_id uuid,
  p_offer_id uuid,
  p_driver_participant_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer public.project_transport_offers%rowtype;
  v_affected integer;
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  select * into v_offer from public.project_transport_offers offer
  where offer.id = p_offer_id and offer.project_id = p_project_id
  for update;
  if not found or v_offer.canceled_at is not null then raise exception 'Active ride not found'; end if;
  if v_offer.driver_participant_id <> p_driver_participant_id then raise exception 'Only the driver can cancel this ride'; end if;

  update public.project_transport_offers set canceled_at = now(), updated_at = now()
  where id = p_offer_id;
  with affected as (
    update public.project_transport_assignments assignment
    set left_at = now()
    where assignment.offer_id = p_offer_id and assignment.left_at is null
    returning assignment.participant_id
  ), restored as (
    insert into public.project_transport_intents (project_id, participant_id, direction, intent, updated_at)
    select p_project_id, affected.participant_id, v_offer.direction, 'needs_ride', now()
    from affected
    where public.project_transport_participant_is_eligible(p_project_id, affected.participant_id)
    on conflict (project_id, participant_id, direction) do update
      set intent = 'needs_ride', updated_at = now()
    returning participant_id
  )
  select count(*)::integer into v_affected from restored;
  return v_affected;
end
$$;

create or replace function public.set_project_transport_intent(
  p_project_id uuid,
  p_participant_id uuid,
  p_direction text,
  p_intent text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  if p_direction not in ('to_event', 'from_event') then raise exception 'Invalid transport direction'; end if;
  if p_intent not in ('needs_ride', 'own_arrangement') then raise exception 'Invalid transport status'; end if;
  if not public.project_transport_participant_is_eligible(p_project_id, p_participant_id) then
    raise exception 'Only eligible active participants can set transport status';
  end if;
  if exists (
    select 1 from public.project_transport_offers offer
    where offer.project_id = p_project_id and offer.driver_participant_id = p_participant_id
      and offer.direction = p_direction and offer.canceled_at is null
  ) or exists (
    select 1 from public.project_transport_assignments assignment
    where assignment.project_id = p_project_id and assignment.participant_id = p_participant_id
      and assignment.direction = p_direction and assignment.left_at is null
  ) then raise exception 'Leave or cancel the active ride before changing transport status'; end if;
  insert into public.project_transport_intents (project_id, participant_id, direction, intent, updated_at)
  values (p_project_id, p_participant_id, p_direction, p_intent, now())
  on conflict (project_id, participant_id, direction) do update
    set intent = excluded.intent, updated_at = now();
end
$$;

create or replace function public.clear_project_transport_intent(
  p_project_id uuid,
  p_participant_id uuid,
  p_direction text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_project_transport_mutation_ready(p_project_id);
  if p_direction not in ('to_event', 'from_event') then raise exception 'Invalid transport direction'; end if;
  if not public.project_transport_participant_is_eligible(p_project_id, p_participant_id) then
    raise exception 'Only eligible active participants can clear transport status';
  end if;
  delete from public.project_transport_intents intent
  where intent.project_id = p_project_id
    and intent.participant_id = p_participant_id
    and intent.direction = p_direction;
end
$$;

-- Reusable cleanup deliberately does not require the feature toggle, final date,
-- or active attendance. It is used when membership/attendance becomes ineligible.
create or replace function public.cleanup_project_transport_participant(
  p_project_id uuid,
  p_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer record;
begin
  if not exists (
    select 1 from public.participants participant
    where participant.project_id = p_project_id and participant.id = p_participant_id
  ) then raise exception 'Participant does not belong to project'; end if;

  perform 1 from public.projects project where project.id = p_project_id for update;
  for v_offer in
    select offer.id, offer.direction
    from public.project_transport_offers offer
    where offer.project_id = p_project_id
      and offer.driver_participant_id = p_participant_id
      and offer.canceled_at is null
    order by offer.id
    for update
  loop
    update public.project_transport_offers set canceled_at = now(), updated_at = now()
    where id = v_offer.id;
    with affected as (
      update public.project_transport_assignments assignment
      set left_at = now()
      where assignment.offer_id = v_offer.id and assignment.left_at is null
      returning assignment.participant_id
    )
    insert into public.project_transport_intents (project_id, participant_id, direction, intent, updated_at)
    select p_project_id, affected.participant_id, v_offer.direction, 'needs_ride', now()
    from affected
    where affected.participant_id <> p_participant_id
      and public.project_transport_participant_is_eligible(p_project_id, affected.participant_id)
    on conflict (project_id, participant_id, direction) do update
      set intent = 'needs_ride', updated_at = now();
  end loop;

  update public.project_transport_assignments assignment
  set left_at = now()
  where assignment.project_id = p_project_id
    and assignment.participant_id = p_participant_id
    and assignment.left_at is null;
  delete from public.project_transport_intents intent
  where intent.project_id = p_project_id and intent.participant_id = p_participant_id;
end
$$;

create or replace function public.cleanup_project_transport_after_participant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.left_at is null and new.left_at is not null)
     or (
       coalesce(old.attendance_status, '') not in ('cannot_attend', 'observer')
       and coalesce(new.attendance_status, '') in ('cannot_attend', 'observer')
     ) then
    perform public.cleanup_project_transport_participant(new.project_id, new.id);
  end if;
  return new;
end
$$;

drop trigger if exists participants_cleanup_project_transport on public.participants;
create trigger participants_cleanup_project_transport
after update of left_at, attendance_status on public.participants
for each row execute function public.cleanup_project_transport_after_participant_change();

revoke all on function public.assert_project_transport_mutation_ready(uuid) from public, anon, authenticated;
revoke all on function public.project_transport_participant_is_eligible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_project_transport_offer(uuid, uuid, text, text, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.update_project_transport_offer(uuid, uuid, uuid, text, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.join_project_transport_offer(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_project_transport_offer(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.remove_project_transport_passenger(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_project_transport_offer(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_project_transport_intent(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.clear_project_transport_intent(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cleanup_project_transport_participant(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cleanup_project_transport_after_participant_change() from public, anon, authenticated;

grant execute on function public.create_project_transport_offer(uuid, uuid, text, text, timestamptz, integer, text) to service_role;
grant execute on function public.update_project_transport_offer(uuid, uuid, uuid, text, timestamptz, integer, text) to service_role;
grant execute on function public.join_project_transport_offer(uuid, uuid, uuid) to service_role;
grant execute on function public.leave_project_transport_offer(uuid, uuid, text) to service_role;
grant execute on function public.remove_project_transport_passenger(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_project_transport_offer(uuid, uuid, uuid) to service_role;
grant execute on function public.set_project_transport_intent(uuid, uuid, text, text) to service_role;
grant execute on function public.clear_project_transport_intent(uuid, uuid, text) to service_role;
grant execute on function public.cleanup_project_transport_participant(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
