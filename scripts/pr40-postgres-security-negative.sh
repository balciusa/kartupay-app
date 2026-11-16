#!/bin/bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD=pr40_test_only
psql -X -v ON_ERROR_STOP=1 -f scripts/pr40-postgres-security-fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
DECLARE answer jsonb;
  failed boolean;
BEGIN
 -- Direct membership may only be self join on public, finance-none.
 failed:=false;
 BEGIN
  PERFORM public.reserve_project_membership_atomic('b1111111-1111-4111-8111-111111111111',
     'b1111111-0000-4000-8000-000000000002','b1111111-0000-4000-8000-000000000002',null);
 EXCEPTION WHEN insufficient_privilege THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Private project permitted direct join'; END IF;
 failed:=false;
 BEGIN
  PERFORM public.reserve_project_membership_atomic('b2222222-2222-4222-8222-222222222222',
     'b2222222-0000-4000-8000-000000000002','b2222222-0000-4000-8000-000000000003',null);
 EXCEPTION WHEN insufficient_privilege THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Direct join impersonation permitted'; END IF;

 -- Cross-project request ID must not be accepted.
 failed:=false;
 BEGIN
  PERFORM public.reserve_project_membership_atomic('b1111111-1111-4111-8111-111111111111',
     'b1111111-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000002',
     'b3333333-0000-4000-8000-000000000002');
 EXCEPTION WHEN no_data_found THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Cross-project request accepted'; END IF;

 -- Approval cannot be performed by an unauthorized actor.
 failed:=false;
 BEGIN
  PERFORM public.reserve_project_membership_atomic('b1111111-1111-4111-8111-111111111111',
     'b1111111-0000-4000-8000-000000000099','b1111111-0000-4000-8000-000000000002',
     'b1111111-0000-4000-8000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Unauthorized approval accepted'; END IF;
 answer:=public.reserve_project_membership_atomic('b1111111-1111-4111-8111-111111111111',
     'b1111111-0000-4000-8000-000000000001','b1111111-0000-4000-8000-000000000003',
     'b1111111-0000-4000-8000-000000000003');
 IF answer->>'outcome'<>'request_not_pending' THEN RAISE EXCEPTION 'Rejected request improperly approved: %',answer; END IF;

 -- Managed approval rejects unauthorized organizer and rejected requests.
 failed:=false;
 BEGIN
  PERFORM public.pr40_approve_managed_membership_atomic('b3333333-3333-4333-8333-333333333333',
    'b3333333-0000-4000-8000-000000000002','b3333333-0000-4000-8000-000000000099','[]'::jsonb);
 EXCEPTION WHEN insufficient_privilege THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Managed unauthorized approval accepted'; END IF;
 answer:=public.pr40_approve_managed_membership_atomic('b3333333-3333-4333-8333-333333333333',
    'b3333333-0000-4000-8000-000000000003','b3333333-0000-4000-8000-000000000001','[]'::jsonb);
 IF answer->>'outcome'<>'request_not_pending' THEN RAISE EXCEPTION 'Managed rejected request approved'; END IF;
 failed:=false;
 BEGIN
  PERFORM public.pr40_approve_managed_membership_atomic('b1111111-1111-4111-8111-111111111111',
    'b1111111-0000-4000-8000-000000000002','b1111111-0000-4000-8000-000000000001','[]'::jsonb);
 EXCEPTION WHEN invalid_parameter_value THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Managed RPC accepted finance-none project'; END IF;

 IF EXISTS(SELECT 1 FROM public.participants WHERE project_id IN
 ('b1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222',
  'b3333333-3333-4333-8333-333333333333') AND role='member' AND left_at IS NULL) THEN
  RAISE EXCEPTION 'Negative cases created an active member';
 END IF;
 IF (SELECT count(*) FROM public.join_requests WHERE project_id IN
 ('b1111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333')
 AND status='pending')<>2 THEN RAISE EXCEPTION 'Negative cases changed pending request states'; END IF;
 IF EXISTS(SELECT 1 FROM public.activity_logs WHERE project_id IN
 ('b1111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333'))
 THEN RAISE EXCEPTION 'Negative cases wrote activity'; END IF;
END $test$;
SQL
echo 'PR40 negative authorization and request-state checks PASS'


# Source-ownership and staleness checks are transaction-local. None of these
# rejected submissions may create membership or financial activity.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.projects(id,status,finance_mode,is_public,max_participants,total_cents,total_is_per_person)
VALUES ('c1111111-1111-4111-8111-111111111111','pending','managed',false,3,10000,false);
INSERT INTO public.participants(id,project_id,user_id,role)
VALUES ('c1111111-0000-4000-8000-000000000001','c1111111-1111-4111-8111-111111111111','c1111111-0000-4000-8000-000000000001','organizer');
INSERT INTO public.join_requests(id,project_id,requester_user_id,status)
VALUES ('c1111111-0000-4000-8000-000000000002','c1111111-1111-4111-8111-111111111111','c1111111-0000-4000-8000-000000000002','pending');
INSERT INTO public.user_payment_options(id,user_id,type,label,value,priority,is_active) VALUES
('c1111111-0000-4000-8000-000000000010','c1111111-0000-4000-8000-000000000002','revolut','Recipient','@owner',1,true),
('c1111111-0000-4000-8000-000000000011','c1111111-0000-4000-8000-000000000002','revolut','Inactive','@inactive',1,false),
('c1111111-0000-4000-8000-000000000012','c1111111-0000-4000-8000-000000000099','revolut','Foreign','@foreign',1,true);

DO $test$
DECLARE option_payload jsonb; source_id uuid; source_val text;
BEGIN
 FOR source_id,source_val IN
  SELECT x.id,x.val FROM (VALUES
   ('c1111111-0000-4000-8000-000000000010'::uuid,'@tampered'::text),
   ('c1111111-0000-4000-8000-000000000011'::uuid,'@inactive'::text),
   ('c1111111-0000-4000-8000-000000000012'::uuid,'@foreign'::text)
  ) AS x(id,val)
 LOOP
  SELECT jsonb_build_array(jsonb_build_object(
   'type','revolut','label',u.label,
   'value','https://revolut.me/example','priority',1,
   'source_option_id',u.id,'source_value',source_val,
   'source_label',u.label,'source_priority',u.priority))
   INTO option_payload FROM public.user_payment_options u WHERE u.id=source_id;
  BEGIN
   PERFORM public.pr40_approve_managed_membership_atomic(
    'c1111111-1111-4111-8111-111111111111',
    'c1111111-0000-4000-8000-000000000002',
    'c1111111-0000-4000-8000-000000000001',option_payload);
   RAISE EXCEPTION 'Invalid payment provenance was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
   NULL; -- expected from provenance validation
  END;
 END LOOP;
 IF EXISTS (SELECT 1 FROM public.participants
   WHERE project_id='c1111111-1111-4111-8111-111111111111' AND role='member')
 OR EXISTS (SELECT 1 FROM public.activity_logs
   WHERE project_id='c1111111-1111-4111-8111-111111111111') THEN
  RAISE EXCEPTION 'Rejected option provenance left partial records';
 END IF;
END $test$;
SQL
echo 'PR40 payment option source ownership / staleness PASS'


# Positive control: an unchanged active option owned by the requester should
# pass the same provenance check, otherwise all negative cases are meaningless.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
DECLARE payload jsonb; approved jsonb;
BEGIN
 payload:=jsonb_build_array(jsonb_build_object(
  'type','revolut','label','Recipient',
  'value','https://revolut.me/owner','priority',1,
  'source_option_id','c1111111-0000-4000-8000-000000000010',
  'source_value','@owner','source_label','Recipient','source_priority',1));
 approved:=public.pr40_approve_managed_membership_atomic(
   'c1111111-1111-4111-8111-111111111111',
   'c1111111-0000-4000-8000-000000000002',
   'c1111111-0000-4000-8000-000000000001',payload);
 IF approved->>'outcome'<>'reserved' OR
 (SELECT count(*) FROM public.payment_options po
    JOIN public.participants p ON po.participant_id=p.id
    WHERE p.user_id='c1111111-0000-4000-8000-000000000002'
      AND po.value='https://revolut.me/owner')<>1 THEN
   RAISE EXCEPTION 'Valid source was not accepted with canonicalized destination';
 END IF;
END $test$;
SQL
echo 'PR40 source ownership positive control PASS'
