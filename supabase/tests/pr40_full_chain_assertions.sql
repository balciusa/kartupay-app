\set ON_ERROR_STOP on

do $test$
declare result jsonb;
begin
  if has_function_privilege('anon','public.reserve_project_membership_atomic(uuid,uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.approve_managed_membership_atomic(uuid,uuid,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.get_membership_approval_context(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.get_membership_approval_context(uuid,uuid)','EXECUTE') then
    raise exception 'Browser role can execute membership RPC';
  end if;
  if not has_function_privilege('service_role','public.approve_managed_membership_atomic(uuid,uuid,uuid,jsonb)','EXECUTE') then
    raise exception 'Service role cannot execute managed RPC';
  end if;
  if not has_function_privilege('service_role','public.get_membership_approval_context(uuid,uuid)','EXECUTE') then
    raise exception 'Service role cannot execute approval context RPC';
  end if;

  result := public.get_membership_approval_context(
    '14000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'
  );
  if result->>'project_id' <> '11000000-0000-4000-8000-000000000002'
    or result->>'requester_user_id' <> '10000000-0000-4000-8000-000000000005'
    or result->>'finance_mode' <> 'managed'
    or result->>'status' <> 'pending' then
    raise exception 'Approval context mismatch: %', result;
  end if;
  begin
    perform public.get_membership_approval_context(
      '14000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'
    );
    raise exception 'Unauthorized actor received approval context';
  exception when insufficient_privilege then
    null;
  end;

  result := public.approve_managed_membership_atomic(
    '11000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    '[{"type":"revolut","label":"Newcomer","value":"https://revolut.me/newcomer","priority":1,"source_option_id":"15000000-0000-4000-8000-000000000001","source_value":"@newcomer","source_label":"Newcomer","source_priority":1}]'::jsonb
  );
  if result->>'outcome' <> 'reserved' or result->>'options_written' <> '1' or result->>'transfers_written' <> '2' then
    raise exception 'Managed approval result mismatch: %', result;
  end if;
  if (select sum(expected_cents) from public.late_join_transfers where project_id='11000000-0000-4000-8000-000000000002') <> 4000
     or (select count(*) from public.late_join_transfers where project_id='11000000-0000-4000-8000-000000000002' and expected_cents=2000) <> 2 then
    raise exception 'Expected exactly two EUR 20 obligations';
  end if;
  if exists (select 1 from public.payments payment join public.participants participant on participant.id=payment.participant_id where participant.user_id='10000000-0000-4000-8000-000000000005') then
    raise exception 'Newcomer received a second base obligation';
  end if;
  if (select read_at is null from public.project_notifications where id='17000000-0000-4000-8000-000000000001') then
    raise exception 'Managed notification not resolved atomically';
  end if;
  if (select count(*) from public.activity_logs where join_request_id='14000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Managed activity parity mismatch';
  end if;

  result := public.approve_managed_membership_atomic(
    '11000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','[]'::jsonb
  );
  if result->>'outcome' <> 'request_not_pending'
     or (select count(*) from public.activity_logs where join_request_id='14000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Managed retry duplicated state: %', result;
  end if;

  result := public.approve_managed_membership_atomic(
    '11000000-0000-4000-8000-000000000004','14000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','[]'::jsonb
  );
  if result->>'outcome' <> 'reserved'
    or (select left_at from public.participants where id='12000000-0000-4000-8000-000000000006') is not null
    or (select count(*) from public.payment_options where participant_id='12000000-0000-4000-8000-000000000006') <> 1
    or (select read_at is null from public.project_notifications where id='17000000-0000-4000-8000-000000000002') then
    raise exception 'Reactivation parity failed: %', result;
  end if;

  -- Exact pre-chain legacy identities and financial values are unchanged.
  if (select count(*) from public.payments where id='00000000-3000-4000-8000-000000000001' and is_counted and amount_cents is null and collector_participant_id is null) <> 1
    or (select count(*) from public.late_join_transfers where id='00000000-3200-4000-8000-000000000001' and expected_cents=4000 and received_at is null and sender_marked_at is null) <> 1
    or (select count(*) from public.extra_payments where id='18000000-2000-4000-8000-000000000001' and amount_cents=1000 and confirmed_at='2025-02-05') <> 1
    or (select count(*) from public.participant_refund_requests where id='18000000-3000-4000-8000-000000000001' and total_amount_cents=9000 and status='completed') <> 1
    or (select count(*) from public.audit_logs where id='00000000-3300-4000-8000-000000000001' and details='{"immutable":true}'::jsonb) <> 1 then
    raise exception 'Historical financial row changed';
  end if;
end
$test$;

-- RLS remains project-scoped and browser roles cannot mutate participants.
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $test$ begin
  if (select count(*) from public.projects where id='11000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'Active member cannot read own project';
  end if;
  if (select count(*) from public.projects where id='11000000-0000-4000-8000-000000000005') <> 0 then
    raise exception 'Member can read unrelated private project';
  end if;
  if has_table_privilege('authenticated','public.participants','INSERT')
    or has_table_privilege('authenticated','public.participants','UPDATE') then
    raise exception 'Authenticated participant write privilege restored';
  end if;
end $test$;
reset role;
