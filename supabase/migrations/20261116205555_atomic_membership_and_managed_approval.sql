begin;

-- Cross-writer protection: every INSERT or reactivation, including service-role
-- writes outside the RPCs below, serializes on the project row and counts active
-- seats by the one product rule: participants.left_at IS NULL.
create or replace function public.kartupay_enforce_active_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_project public.projects%rowtype;
  active_count bigint;
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Participant project reassignment is not supported'
      using errcode = '22023';
  end if;

  if new.left_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.left_at is null then
    return new;
  end if;

  select * into locked_project
  from public.projects
  where id = new.project_id
  for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(locked_project.status, ''))) in ('canceled', 'cancelled')
     or locked_project.canceled_at is not null then
    raise exception 'Cannot join a canceled project' using errcode = 'P0001';
  end if;

  select count(*) into active_count
  from public.participants
  where project_id = new.project_id and left_at is null;

  if locked_project.max_participants is not null
     and active_count >= locked_project.max_participants then
    raise exception 'Project capacity has been reached' using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists kartupay_participants_capacity_guard on public.participants;
create trigger kartupay_participants_capacity_guard
before insert or update of left_at, project_id on public.participants
for each row execute function public.kartupay_enforce_active_capacity();

revoke all on function public.kartupay_enforce_active_capacity()
  from public, anon, authenticated;

create or replace function public.kartupay_price_per_person(
  p_total bigint,
  p_per_person boolean,
  p_count integer,
  p_bundle_size integer,
  p_bundle_pay_for integer
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $function$
declare
  participant_count integer := greatest(1, coalesce(p_count, 0));
  cents bigint := greatest(0, coalesce(p_total, 0));
  payable_units integer;
begin
  if not coalesce(p_per_person, false) then
    return floor(cents::numeric / participant_count)::bigint;
  end if;
  payable_units := case
    when p_bundle_size >= 2 and p_bundle_pay_for >= 1
      and p_bundle_pay_for < p_bundle_size
      then (participant_count / p_bundle_size) * p_bundle_pay_for
        + (participant_count % p_bundle_size)
    else participant_count
  end;
  return floor(cents::numeric * payable_units / participant_count)::bigint;
end
$function$;

-- Authorize before the service-role adapter reads requester payment data. The
-- write RPC independently repeats these checks under the project/request lock.
create or replace function public.get_membership_approval_context(
  p_request_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $function$
declare
  request_row public.join_requests%rowtype;
  locked_project public.projects%rowtype;
  actor public.participants%rowtype;
begin
  if p_request_id is null or p_actor_user_id is null then
    raise exception 'Approval identity missing' using errcode = '22023';
  end if;
  select * into request_row from public.join_requests where id = p_request_id;
  if not found then raise exception 'Join request not found' using errcode = 'P0002'; end if;
  select * into locked_project from public.projects where id = request_row.project_id;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if lower(trim(coalesce(locked_project.status, ''))) in ('canceled', 'cancelled')
     or locked_project.canceled_at is not null then
    raise exception 'This project is no longer active' using errcode = 'P0001';
  end if;
  select * into actor
  from public.participants
  where project_id = request_row.project_id
    and user_id = p_actor_user_id
    and left_at is null;
  if not found or not (
    actor.role = 'organizer'
    or (locked_project.is_public is true
        and actor.id = locked_project.collector_participant_id)
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'request_id', request_row.id,
    'project_id', request_row.project_id,
    'requester_user_id', request_row.requester_user_id,
    'status', request_row.status,
    'finance_mode', locked_project.finance_mode,
    'actor_user_id', p_actor_user_id
  );
end
$function$;

-- Atomic direct membership and finance-none request approval. The browser
-- roles cannot invoke it; actor identity is supplied only by authenticated
-- server code and is re-authorized while the project/request locks are held.
create or replace function public.reserve_project_membership_atomic(
  p_project_id uuid,
  p_actor_user_id uuid,
  p_user_id uuid,
  p_join_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_project public.projects%rowtype;
  request_row public.join_requests%rowtype;
  actor public.participants%rowtype;
  member public.participants%rowtype;
  active_count bigint;
  approval boolean := p_join_request_id is not null;
  membership_changed boolean := false;
begin
  if p_project_id is null or p_actor_user_id is null or p_user_id is null then
    raise exception 'Reservation identity missing' using errcode = '22023';
  end if;

  select * into locked_project
  from public.projects
  where id = p_project_id
  for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(locked_project.status, ''))) in ('canceled', 'cancelled')
     or locked_project.canceled_at is not null then
    raise exception 'Canceled project' using errcode = 'P0001';
  end if;
  if locked_project.finance_mode is distinct from 'none' then
    raise exception 'Finance-none membership required' using errcode = '22023';
  end if;

  if approval then
    select * into request_row
    from public.join_requests
    where id = p_join_request_id and project_id = p_project_id
    for update;
    if not found or request_row.requester_user_id is distinct from p_user_id then
      raise exception 'Join request not found for user' using errcode = 'P0002';
    end if;

    select * into actor
    from public.participants
    where project_id = p_project_id
      and user_id = p_actor_user_id
      and left_at is null;
    if not found or not (
      actor.role = 'organizer'
      or (locked_project.is_public is true
          and actor.id = locked_project.collector_participant_id)
    ) then
      raise exception 'Approval is not authorized' using errcode = '42501';
    end if;
    if request_row.status is distinct from 'pending' then
      return jsonb_build_object(
        'outcome', 'request_not_pending',
        'project_id', p_project_id,
        'request_id', request_row.id
      );
    end if;
  else
    if p_actor_user_id is distinct from p_user_id then
      raise exception 'Direct join must be self-only' using errcode = '42501';
    end if;
    if locked_project.is_public is distinct from true then
      raise exception 'Approval is required' using errcode = '42501';
    end if;
  end if;

  select * into member
  from public.participants
  where project_id = p_project_id and user_id = p_user_id
  for update;

  if not found or member.left_at is not null then
    select count(*) into active_count
    from public.participants
    where project_id = p_project_id and left_at is null;
    if locked_project.max_participants is not null
       and active_count >= locked_project.max_participants then
      return jsonb_build_object(
        'outcome', 'full',
        'project_id', p_project_id,
        'request_id', p_join_request_id
      );
    end if;

    membership_changed := true;
    if member.id is not null then
      update public.participants
      set left_at = null
      where id = member.id
      returning * into member;
    else
      insert into public.participants(project_id, user_id, role)
      values (p_project_id, p_user_id, 'member')
      returning * into member;
    end if;
  end if;

  if approval then
    update public.join_requests
    set status = 'approved',
        approved_by = p_actor_user_id,
        approved_at = clock_timestamp(),
        participant_id = member.id
    where id = request_row.id and status = 'pending';
    if not found then
      raise exception 'Request state changed' using errcode = '40001';
    end if;

    update public.project_notifications
    set read_at = clock_timestamp()
    where project_id = p_project_id
      and notification_type = 'join_request_pending'
      and metadata->>'join_request_id' = request_row.id::text
      and read_at is null;

    insert into public.activity_logs(
      project_id, entry_type, actor_user_id, actor_participant_id,
      target_user_id, target_participant_id, join_request_id, metadata
    ) values (
      p_project_id, 'join_request_approved', p_actor_user_id, actor.id,
      p_user_id, member.id, request_row.id, '{}'::jsonb
    );
  else
    update public.join_requests
    set status = 'approved',
        approved_by = p_actor_user_id,
        approved_at = clock_timestamp(),
        participant_id = member.id
    where project_id = p_project_id
      and requester_user_id = p_user_id
      and status = 'pending';

    update public.project_notifications notification
    set read_at = clock_timestamp()
    where notification.project_id = p_project_id
      and notification.notification_type = 'join_request_pending'
      and notification.read_at is null
      and exists (
        select 1 from public.join_requests request
        where request.project_id = p_project_id
          and request.requester_user_id = p_user_id
          and request.status = 'approved'
          and notification.metadata->>'join_request_id' = request.id::text
      );
  end if;

  if membership_changed then
    insert into public.activity_logs(
      project_id, entry_type, actor_user_id, actor_participant_id,
      target_user_id, target_participant_id, join_request_id, metadata
    ) values (
      p_project_id, 'participant_joined', p_actor_user_id,
      case when approval then actor.id else member.id end,
      p_user_id, member.id, case when approval then request_row.id else null end,
      case when approval
        then '{"via_join_request":true}'::jsonb
        else '{"direct_join":true,"finance_mode":"none"}'::jsonb
      end
    );
  end if;

  return jsonb_build_object(
    'outcome', case when membership_changed then 'reserved' else 'already_active' end,
    'project_id', p_project_id,
    'request_id', case when approval then request_row.id else null end,
    'participant_id', member.id,
    'membership_changed', membership_changed,
    'options_written', 0,
    'transfers_written', 0
  );
end
$function$;

-- Managed approval trusts exactly one recipient validator: paymentRecipient.ts.
-- This service-role-only RPC does not reimplement URL, IBAN or Unicode rules.
-- Instead it locks every active requester-owned source row and compares its raw
-- snapshot, making stale/foreign/client-substituted sources fail atomically.
create or replace function public.approve_managed_membership_atomic(
  p_project_id uuid,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_validated_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_project public.projects%rowtype;
  request_row public.join_requests%rowtype;
  actor public.participants%rowtype;
  member public.participants%rowtype;
  membership_changed boolean := false;
  active_count bigint;
  prior_count integer;
  candidates uuid[] := array[]::uuid[];
  recipients uuid[] := array[]::uuid[];
  recipient uuid;
  collector_id uuid;
  previous_share bigint;
  next_share bigint;
  share_difference bigint := 0;
  bundle_size integer;
  bundle_pay_for integer;
  is_finalized boolean;
  is_collecting boolean;
  options_written integer := 0;
  transfers_written integer := 0;
  inserted_count integer;
  option_row record;
  source_ok boolean;
begin
  if p_project_id is null or p_request_id is null or p_actor_user_id is null
     or jsonb_typeof(p_validated_options) is distinct from 'array' then
    raise exception 'Invalid managed approval inputs' using errcode = '22023';
  end if;

  select * into locked_project
  from public.projects
  where id = p_project_id
  for update;
  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  if lower(trim(coalesce(locked_project.status, ''))) in ('canceled', 'cancelled')
     or locked_project.canceled_at is not null then
    raise exception 'Canceled project' using errcode = 'P0001';
  end if;
  if locked_project.finance_mode is distinct from 'managed' then
    raise exception 'Managed finance required' using errcode = '22023';
  end if;

  select * into request_row
  from public.join_requests
  where id = p_request_id and project_id = p_project_id
  for update;
  if not found then
    raise exception 'Join request not found' using errcode = 'P0002';
  end if;

  select * into actor
  from public.participants
  where project_id = p_project_id
    and user_id = p_actor_user_id
    and left_at is null;
  if not found or not (
    actor.role = 'organizer'
    or (locked_project.is_public is true
        and actor.id = locked_project.collector_participant_id)
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if request_row.status is distinct from 'pending' then
    return jsonb_build_object(
      'outcome', 'request_not_pending',
      'project_id', p_project_id,
      'request_id', request_row.id
    );
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_validated_options) as option(
      type text, label text, value text, priority integer,
      source_option_id uuid, source_value text, source_label text,
      source_priority integer
    )
    where option.type is null
      or option.type not in ('iban', 'revolut', 'swedbank')
      or option.label is null
      or option.value is null
      or btrim(option.value) = ''
      or option.priority is null
      or option.priority < 0
      or option.source_option_id is null
      or option.source_value is null
  ) then
    raise exception 'Invalid payment option payload' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_validated_options) as option(source_option_id uuid)
    group by source_option_id having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_validated_options) as option(type text, value text)
    group by type, value having count(*) > 1
  ) then
    raise exception 'Duplicate payment option payload' using errcode = '22023';
  end if;

  for option_row in
    select * from jsonb_to_recordset(p_validated_options) as option(
      type text, label text, value text, priority integer,
      source_option_id uuid, source_value text, source_label text,
      source_priority integer
    )
  loop
    source_ok := false;
    select true into source_ok
    from public.user_payment_options source
    where source.id = option_row.source_option_id
      and source.user_id = request_row.requester_user_id
      and source.is_active is true
      and source.type = option_row.type
      and source.value = option_row.source_value
      and source.label is not distinct from option_row.source_label
      and source.priority is not distinct from option_row.source_priority
    for share;
    if not coalesce(source_ok, false) then
      raise exception 'Payment option source changed or is not owned by requester'
        using errcode = '22023';
    end if;
  end loop;

  select * into member
  from public.participants
  where project_id = p_project_id
    and user_id = request_row.requester_user_id
  for update;

  if not found or member.left_at is not null then
    select count(*) into active_count
    from public.participants
    where project_id = p_project_id and left_at is null;
    if locked_project.max_participants is not null
       and active_count >= locked_project.max_participants then
      return jsonb_build_object(
        'outcome', 'full',
        'project_id', p_project_id,
        'request_id', request_row.id
      );
    end if;

    membership_changed := true;
    if member.id is not null then
      update public.participants
      set left_at = null
      where id = member.id
      returning * into member;
    else
      insert into public.participants(project_id, user_id, role)
      values (p_project_id, request_row.requester_user_id, 'member')
      returning * into member;
    end if;
  end if;

  insert into public.payment_options(
    participant_id, type, label, value, priority, is_active
  )
  select member.id, option.type, option.label, option.value, option.priority, true
  from jsonb_to_recordset(p_validated_options) as option(
    type text, label text, value text, priority integer
  )
  where not exists (
    select 1 from public.payment_options existing
    where existing.participant_id = member.id
      and existing.type = option.type
      and existing.value = option.value
  );
  get diagnostics options_written = row_count;

  is_finalized := locked_project.finalized_at is not null
    or lower(coalesce(locked_project.status, '')) in ('closed', 'finalized');
  is_collecting := lower(coalesce(locked_project.status, '')) = 'collecting';

  if membership_changed and (is_finalized or is_collecting) then
    select count(*), coalesce(array_agg(participant.id order by participant.id), array[]::uuid[])
    into prior_count, candidates
    from public.participants participant
    where participant.project_id = p_project_id
      and participant.id <> member.id
      and participant.left_at is null
      and participant.attendance_status = 'confirmed'
      and (
        (is_finalized and (
          locked_project.finalized_at is null
          or participant.joined_at is null
          or participant.joined_at <= locked_project.finalized_at
        ))
        or (not is_finalized and (
          member.joined_at is null
          or participant.joined_at is null
          or participant.joined_at <= member.joined_at
        ))
      );

    recipients := candidates;
    if not is_finalized then
      select coalesce(array_agg(participant.id order by participant.id), array[]::uuid[])
      into recipients
      from public.participants participant
      where participant.id = any(candidates)
        and exists (
          select 1 from public.payments payment
          where payment.participant_id = participant.id
            and payment.is_counted is true
        );
    end if;

    if prior_count > 0 and coalesce(array_length(recipients, 1), 0) > 0 then
      bundle_size := nullif(to_jsonb(locked_project)->>'bundle_size', '')::integer;
      bundle_pay_for := nullif(to_jsonb(locked_project)->>'bundle_pay_for', '')::integer;
      previous_share := public.kartupay_price_per_person(
        coalesce(locked_project.total_cents, 0),
        locked_project.total_is_per_person,
        prior_count,
        bundle_size,
        bundle_pay_for
      );
      next_share := public.kartupay_price_per_person(
        coalesce(locked_project.total_cents, 0),
        locked_project.total_is_per_person,
        prior_count + 1,
        bundle_size,
        bundle_pay_for
      );
      share_difference := abs(previous_share - next_share);

      if share_difference > 0 then
        if previous_share >= next_share then
          foreach recipient in array recipients loop
            insert into public.late_join_transfers(
              project_id, from_participant_id, to_participant_id, expected_cents
            ) values (
              p_project_id, member.id, recipient, share_difference
            ) on conflict (project_id, from_participant_id, to_participant_id) do nothing;
            get diagnostics inserted_count = row_count;
            transfers_written := transfers_written + inserted_count;
          end loop;
        else
          select participant.id into collector_id
          from public.participants participant
          where participant.id = locked_project.collector_participant_id
            and participant.project_id = p_project_id
            and participant.left_at is null;
          if collector_id is null then
            select participant.id into collector_id
            from public.participants participant
            where participant.project_id = p_project_id
              and participant.role = 'organizer'
              and participant.left_at is null
            order by participant.id
            limit 1;
          end if;

          if collector_id is not null then
            foreach recipient in array recipients loop
              if recipient <> collector_id then
                insert into public.late_join_transfers(
                  project_id, from_participant_id, to_participant_id, expected_cents
                ) values (
                  p_project_id, recipient, collector_id, share_difference
                ) on conflict (project_id, from_participant_id, to_participant_id) do nothing;
                get diagnostics inserted_count = row_count;
                transfers_written := transfers_written + inserted_count;
              end if;
            end loop;
          end if;
        end if;
      end if;
    end if;
  end if;

  update public.join_requests
  set status = 'approved',
      approved_by = p_actor_user_id,
      approved_at = clock_timestamp(),
      participant_id = member.id
  where id = request_row.id and status = 'pending';
  if not found then
    raise exception 'Request state changed' using errcode = '40001';
  end if;

  update public.project_notifications
  set read_at = clock_timestamp()
  where project_id = p_project_id
    and notification_type = 'join_request_pending'
    and metadata->>'join_request_id' = request_row.id::text
    and read_at is null;

  insert into public.activity_logs(
    project_id, entry_type, actor_user_id, actor_participant_id,
    target_user_id, target_participant_id, join_request_id, metadata
  ) values (
    p_project_id, 'join_request_approved', p_actor_user_id, actor.id,
    request_row.requester_user_id, member.id, request_row.id, '{}'::jsonb
  );

  if membership_changed then
    insert into public.activity_logs(
      project_id, entry_type, actor_user_id, actor_participant_id,
      target_user_id, target_participant_id, join_request_id, metadata
    ) values (
      p_project_id, 'participant_joined', p_actor_user_id, actor.id,
      request_row.requester_user_id, member.id, request_row.id,
      '{"via_join_request":true}'::jsonb
    );
  end if;

  if transfers_written > 0 then
    insert into public.activity_logs(
      project_id, entry_type, actor_user_id, actor_participant_id,
      target_user_id, target_participant_id, join_request_id, metadata
    ) values (
      p_project_id, 'late_transfer_created', p_actor_user_id, actor.id,
      request_row.requester_user_id, member.id, request_row.id,
      jsonb_build_object(
        'recipients_count', coalesce(array_length(recipients, 1), 0),
        'per_person_cents', share_difference,
        'created_transfers_count', transfers_written
      )
    );
  end if;

  return jsonb_build_object(
    'outcome', case when membership_changed then 'reserved' else 'already_active' end,
    'project_id', p_project_id,
    'request_id', request_row.id,
    'participant_id', member.id,
    'membership_changed', membership_changed,
    'options_written', options_written,
    'transfers_written', transfers_written
  );
end
$function$;

revoke all on function public.kartupay_price_per_person(bigint, boolean, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.get_membership_approval_context(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_project_membership_atomic(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.approve_managed_membership_atomic(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.kartupay_price_per_person(bigint, boolean, integer, integer, integer)
  to service_role;
grant execute on function public.get_membership_approval_context(uuid, uuid)
  to service_role;
grant execute on function public.reserve_project_membership_atomic(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.approve_managed_membership_atomic(uuid, uuid, uuid, jsonb)
  to service_role;

comment on function public.reserve_project_membership_atomic(uuid, uuid, uuid, uuid) is
  'Atomically reserves/reactivates finance-none membership. Service-role server use only.';
comment on function public.approve_managed_membership_atomic(uuid, uuid, uuid, jsonb) is
  'Atomically approves managed membership using TypeScript-validated, source-bound payment recipients. Service-role server use only.';

commit;
