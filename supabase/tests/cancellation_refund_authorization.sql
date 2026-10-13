\set ON_ERROR_STOP on

-- Synthetic rows only. The IDs correspond to rls_lockdown_fixture.sql.
insert into public.participant_refund_requests (
  id, project_id, participant_id, collector_participant_id, requested_by_participant_id,
  base_amount_cents, extras_amount_cents, late_transfer_amount_cents, total_amount_cents, status
) values
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005',
   '20000000-0000-0000-0000-000000000002', 1000, 200, 0, 1200, 'pending'),
  ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000002', 0, 0, 300, 300, 'pending')
on conflict (id) do nothing;

create schema if not exists test;

create or replace function test.assert_refund_read_denied()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  begin
    perform 1 from public.participant_refund_requests;
    raise exception 'refund read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

create or replace function test.assert_refund_write_denied()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  begin
    insert into public.participant_refund_requests (
      project_id, participant_id, collector_participant_id, requested_by_participant_id,
      base_amount_cents, extras_amount_cents, late_transfer_amount_cents, total_amount_cents
    ) values (
      '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002',
      1, 0, 0, 1
    );
    raise exception 'refund insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.participant_refund_requests set status = 'completed';
    raise exception 'refund update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.participant_refund_requests;
    raise exception 'refund delete unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on function test.assert_refund_read_denied() to anon, authenticated, service_role;
grant execute on function test.assert_refund_write_denied() to anon, authenticated, service_role;

set role anon;
select test.assert_refund_read_denied();
select test.assert_refund_write_denied();
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$
begin
  if (select count(*) from public.participant_refund_requests) <> 0 then
    raise exception 'unrelated authenticated user read refund rows';
  end if;
end;
$$;
select test.assert_refund_write_denied();

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$
begin
  if (select count(*) from public.participant_refund_requests) <> 0 then
    raise exception 'former member read refund rows';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(*) from public.participant_refund_requests) <> 2 then
    raise exception 'active member could not read project refund rows';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$
begin
  if (select count(*) from public.participant_refund_requests) <> 2 then
    raise exception 'organizer could not read project refund rows';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
do $$
begin
  if (select count(*) from public.participant_refund_requests) <> 2 then
    raise exception 'collector could not read project refund rows';
  end if;
end;
$$;
select test.assert_refund_write_denied();
reset role;

set role service_role;
insert into public.participant_refund_requests (
  id, project_id, participant_id, collector_participant_id, requested_by_participant_id,
  base_amount_cents, extras_amount_cents, late_transfer_amount_cents, total_amount_cents, status
) values (
  'c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000002', 0, 50, 0, 50, 'completed'
);
update public.participant_refund_requests
set updated_at = now()
where id = 'c0000000-0000-0000-0000-000000000003';
delete from public.participant_refund_requests
where id = 'c0000000-0000-0000-0000-000000000003';
reset role;

do $$
begin
  if (select count(*) from public.participant_refund_requests) <> 2 then
    raise exception 'service-role round trip changed retained fixture rows';
  end if;
end;
$$;

-- Separate recipients are valid; a duplicate open obligation for one recipient is not.
do $$
begin
  begin
    insert into public.participant_refund_requests (
      project_id, participant_id, collector_participant_id, requested_by_participant_id,
      base_amount_cents, extras_amount_cents, late_transfer_amount_cents, total_amount_cents
    ) values (
      '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002',
      1200, 0, 0, 1200
    );
    raise exception 'duplicate open recipient obligation unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Every foreign key retains financial history.
do $$
declare
  definition text;
begin
  for definition in
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.participant_refund_requests'::regclass and contype = 'f'
  loop
    if definition not like '%ON DELETE RESTRICT%' and definition not like '%ON DELETE SET NULL%' then
      raise exception 'unsafe refund foreign key: %', definition;
    end if;
  end loop;
end;
$$;
