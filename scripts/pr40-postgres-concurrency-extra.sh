#!/bin/bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD=pr40_test_only
psql -X -v ON_ERROR_STOP=1 -f scripts/pr40-postgres-concurrency-extra.sql >/dev/null

# Two separate managed approvals contend for exactly one remaining place.
psql -XAt -v ON_ERROR_STOP=1 -c \
 "select public.pr40_approve_managed_membership_atomic('44444444-4444-4444-8444-444444444444','44444444-0000-4000-8000-000000000002','44444444-0000-4000-8000-000000000001','[]'::jsonb)->>'outcome'" >/tmp/pr40-managed-a &
pid_a=$!
psql -XAt -v ON_ERROR_STOP=1 -c \
 "select public.pr40_approve_managed_membership_atomic('44444444-4444-4444-8444-444444444444','44444444-0000-4000-8000-000000000003','44444444-0000-4000-8000-000000000001','[]'::jsonb)->>'outcome'" >/tmp/pr40-managed-b &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
sort /tmp/pr40-managed-a /tmp/pr40-managed-b >/tmp/pr40-managed-results
printf 'full\nreserved\n' | diff -u - /tmp/pr40-managed-results

psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.participants WHERE project_id='44444444-4444-4444-8444-444444444444' AND left_at IS NULL)<>2 THEN
   RAISE EXCEPTION 'Managed race oversubscribed';
 END IF;
 IF (SELECT count(*) FROM public.join_requests WHERE project_id='44444444-4444-4444-8444-444444444444' AND status='approved')<>1
 OR (SELECT count(*) FROM public.join_requests WHERE project_id='44444444-4444-4444-8444-444444444444' AND status='pending')<>1 THEN
   RAISE EXCEPTION 'Managed request states corrupted';
 END IF;
 IF (SELECT count(*) FROM public.late_join_transfers WHERE project_id='44444444-4444-4444-8444-444444444444')<>1
 OR (SELECT count(*) FROM public.activity_logs WHERE project_id='44444444-4444-4444-8444-444444444444')<>2 THEN
   RAISE EXCEPTION 'Managed race financial/activity side-effects incorrect';
 END IF;
END $test$;
SQL

# Separate psql client signals AFTER the SELECT FOR UPDATE acquired the lock.
rm -f /tmp/pr40-cancel-lock-acquired
# A dedicated connection holds the project row lock and cancels on commit.
psql -X -v ON_ERROR_STOP=1 <<'SQL' >/tmp/pr40-cancel-session.log 2>&1 &
BEGIN;
SELECT id FROM public.projects
 WHERE id='55555555-5555-4555-8555-555555555555' FOR UPDATE;
\! touch /tmp/pr40-cancel-lock-acquired
SELECT pg_sleep(3);
UPDATE public.projects SET canceled_at=clock_timestamp(),status='canceled'
 WHERE id='55555555-5555-4555-8555-555555555555';
COMMIT;
SQL
cancel_pid=$!

# Bounded synchronization: avoid flaky ordering based on sleep durations.
for i in $(seq 1 100); do
 if [[ -f /tmp/pr40-cancel-lock-acquired ]]; then break; fi
 sleep 0.05
done
if [[ ! -f /tmp/pr40-cancel-lock-acquired ]]; then
 echo 'Cancellation lock handshake did not complete'
 wait "$cancel_pid" || true
 exit 1
fi

# Approval must block on the project lock, then fail closed after cancellation.
if psql -X -v ON_ERROR_STOP=1 -c \
 "select public.pr40_approve_managed_membership_atomic('55555555-5555-4555-8555-555555555555','55555555-0000-4000-8000-000000000002','55555555-0000-4000-8000-000000000001','[]'::jsonb)" \
 >/tmp/pr40-cancel-approval.log 2>&1; then
 echo 'Expected cancellation to prevent approval'
 exit 1
fi
wait "$cancel_pid"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.participants WHERE project_id='55555555-5555-4555-8555-555555555555')<>1
 OR (SELECT status FROM public.join_requests WHERE id='55555555-0000-4000-8000-000000000002')<>'pending'
 OR (SELECT count(*) FROM public.activity_logs WHERE project_id='55555555-5555-4555-8555-555555555555')<>0
 OR (SELECT count(*) FROM public.late_join_transfers WHERE project_id='55555555-5555-4555-8555-555555555555')<>0 THEN
 RAISE EXCEPTION 'Cancellation race left partial changes'; END IF;
END $test$;
SQL
echo 'PR40 concurrent managed approval and cancellation PASS'
