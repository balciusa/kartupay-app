#!/bin/bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD=pr40_test_only
psql -X -v ON_ERROR_STOP=1 -f scripts/pr40-postgres-fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f docs/sql/pr40_atomic_capacity_candidate.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f docs/sql/pr40_managed_approval_candidate.sql >/dev/null

# Two independent postgres connections race one open seat.
psql -XAt -v ON_ERROR_STOP=1 -c "select public.reserve_project_membership_atomic('11111111-1111-4111-8111-111111111111','11111111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',null)->>'outcome'" >/tmp/pr40-a &
pid_a=$!
psql -XAt -v ON_ERROR_STOP=1 -c "select public.reserve_project_membership_atomic('11111111-1111-4111-8111-111111111111','11111111-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000002',null)->>'outcome'" >/tmp/pr40-b &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
sort /tmp/pr40-a /tmp/pr40-b > /tmp/pr40-results
printf 'full\nreserved\n' | diff -u - /tmp/pr40-results

psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $t$
DECLARE result jsonb;
BEGIN
 IF (SELECT count(*) FROM public.participants WHERE project_id='11111111-1111-4111-8111-111111111111' AND left_at IS NULL)<>2 THEN RAISE EXCEPTION 'Oversubscription'; END IF;
 IF has_function_privilege('anon','public.reserve_project_membership_atomic(uuid,uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.pr40_approve_managed_membership_atomic(uuid,uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe function grant'; END IF;
 result:=public.pr40_approve_managed_membership_atomic('22222222-2222-4222-8222-222222222222','22222222-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','[]'::jsonb);
 IF result->>'outcome'<>'reserved' THEN RAISE EXCEPTION 'Managed join unexpected result: %',result; END IF;
 IF (SELECT count(*) FROM public.late_join_transfers WHERE project_id='22222222-2222-4222-8222-222222222222' AND expected_cents=5000)<>1 THEN RAISE EXCEPTION 'Managed late transfer missing'; END IF;
 IF (SELECT status FROM public.join_requests WHERE id='22222222-0000-4000-8000-000000000001')<>'approved' THEN RAISE EXCEPTION 'Request not approved'; END IF;
 IF (SELECT count(*) FROM public.activity_logs WHERE project_id='22222222-2222-4222-8222-222222222222')<>2 THEN RAISE EXCEPTION 'Activity missing'; END IF;
 result:=public.pr40_approve_managed_membership_atomic('22222222-2222-4222-8222-222222222222','22222222-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','[]'::jsonb);
 IF result->>'outcome'<>'request_not_pending' OR (SELECT count(*) FROM public.activity_logs WHERE project_id='22222222-2222-4222-8222-222222222222')<>2 THEN RAISE EXCEPTION 'Retry duplicated effects'; END IF;
END $t$;
CREATE FUNCTION public.pr40_fail_option() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN IF NEW.label='BOOM' THEN RAISE EXCEPTION 'intentional failure'; END IF; RETURN NEW; END $f$;
CREATE TRIGGER pr40_fail_option BEFORE INSERT ON public.payment_options FOR EACH ROW EXECUTE FUNCTION public.pr40_fail_option();
SQL

if psql -X -v ON_ERROR_STOP=1 -c "select public.pr40_approve_managed_membership_atomic('33333333-3333-4333-8333-333333333333','33333333-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc','[{\"type\":\"revolut\",\"label\":\"BOOM\",\"value\":\"https://revolut.me/example\",\"priority\":1}]'::jsonb)" >/tmp/pr40-injected.out 2>&1; then
 echo 'ERROR: failure injection was not triggered'
 exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $t$ BEGIN
 IF (SELECT count(*) FROM public.participants WHERE project_id='33333333-3333-4333-8333-333333333333')<>1 OR (SELECT status FROM public.join_requests WHERE id='33333333-0000-4000-8000-000000000001')<>'pending' OR (SELECT count(*) FROM public.activity_logs WHERE project_id='33333333-3333-4333-8333-333333333333')<>0 THEN RAISE EXCEPTION 'Partial financial state after failed transaction'; END IF;
END $t$;
SQL
echo 'PR40 isolated PostgreSQL smoke PASS'
