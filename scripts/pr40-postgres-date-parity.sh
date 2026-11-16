#!/bin/bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD=pr40_test_only
psql -X -v ON_ERROR_STOP=1 -f scripts/pr40-postgres-date-parity.sql >/dev/null

# Newly joined participants inherit selected date availability state.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.participants(project_id,user_id,role)
VALUES('99999999-9999-4999-8999-999999999999','99999999-0000-4000-8000-000000000002','member');
DO $test$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.participants WHERE user_id='99999999-0000-4000-8000-000000000002' AND attendance_status='pending_date_selection' AND attendance_updated_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Selecting project date state not initialized';
 END IF;
END $test$;
SQL

# Project row acquired by date finalization first; join cannot slip through.
# Use an explicit lock-acquired marker rather than a guessed sleep alone.
rm -f /tmp/pr40-finalize-locked
psql -X -v ON_ERROR_STOP=1 <<'SQL' >/tmp/pr40-finalize.log 2>&1 &
BEGIN;
SELECT id FROM public.projects
 WHERE id='aaaa9999-9999-4999-8999-999999999999' FOR UPDATE;
\! touch /tmp/pr40-finalize-locked
SELECT pg_sleep(2);
UPDATE public.projects SET date_mode='fixed'
 WHERE id='aaaa9999-9999-4999-8999-999999999999';
COMMIT;
SQL
fin_pid=$!
for i in $(seq 1 100); do
 [[ -f /tmp/pr40-finalize-locked ]] && break
 sleep 0.05
done
if [[ ! -f /tmp/pr40-finalize-locked ]]; then
 echo 'Date lock handshake failed'; wait "$fin_pid" || true; exit 1
fi
psql -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO public.participants(project_id,user_id,role)
VALUES('aaaa9999-9999-4999-8999-999999999999','aaaa9999-0000-4000-8000-000000000002','member');
SQL
wait "$fin_pid"
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.participants
  WHERE user_id='aaaa9999-0000-4000-8000-000000000002' AND attendance_status='confirmed' AND attendance_updated_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Join was not ordered after date finalization';
 END IF;
 IF (SELECT count(*) FROM public.participants
  WHERE project_id='aaaa9999-9999-4999-8999-999999999999' AND left_at IS NULL)<>2 THEN
  RAISE EXCEPTION 'Date join capacity mismatch';
 END IF;
END $test$;
SQL

# Remaining seat used: the third join must be blocked by the capacity guard.
if psql -X -v ON_ERROR_STOP=1 -c \
 "INSERT INTO public.participants(project_id,user_id,role) VALUES('aaaa9999-9999-4999-8999-999999999999','aaaa9999-0000-4000-8000-000000000003','member')" >/tmp/pr40-date-full 2>&1; then
 echo 'Date finalization allowed an extra seat'; exit 1
fi
echo 'PR40 date-state trigger and project-lock parity PASS'
