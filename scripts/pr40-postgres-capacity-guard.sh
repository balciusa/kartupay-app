#!/bin/bash
set -euo pipefail
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGPASSWORD=pr40_test_only
psql -X -v ON_ERROR_STOP=1 -f docs/sql/pr40_capacity_guard_candidate.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f scripts/pr40-postgres-capacity-guard-fixture.sql >/dev/null

# Raw inserts must not evade capacity by bypassing the RPC.
psql -XAt -v ON_ERROR_STOP=1 -c \
 "insert into public.participants(project_id,user_id,role) values('66666666-6666-4666-8666-666666666666','66666666-0000-4000-8000-000000000002','member') returning id" >/tmp/pr40-raw-a &
a=$!
psql -XAt -v ON_ERROR_STOP=1 -c \
 "insert into public.participants(project_id,user_id,role) values('66666666-6666-4666-8666-666666666666','66666666-0000-4000-8000-000000000003','member') returning id" >/tmp/pr40-raw-b 2>/tmp/pr40-raw-b-err &
b=$!
if wait "$a"; then ra=0; else ra=$?; fi
if wait "$b"; then rb=0; else rb=$?; fi
if [[ "$ra" == "$rb" ]]; then echo "Expected one successful raw writer, got $ra $rb"; exit 1; fi

# A full project must reject an independent raw insert, and reactivation.
if psql -X -v ON_ERROR_STOP=1 -c \
 "insert into public.participants(project_id,user_id,role) values('77777777-7777-4777-8777-777777777777','77777777-0000-4000-8000-000000000002','member')" >/tmp/pr40-full-out 2>&1; then
 echo 'Raw insert bypassed the capacity guard'; exit 1
fi
psql -X -v ON_ERROR_STOP=1 -c \
 "insert into public.participants(project_id,user_id,role) values('88888888-8888-4888-8888-888888888888','88888888-0000-4000-8000-000000000003','member')" >/dev/null
if psql -X -v ON_ERROR_STOP=1 -c \
 "update public.participants set left_at=null where id='88888888-0000-4000-8000-000000000002'" >/tmp/pr40-reactivation-out 2>&1; then
 echo 'Reactivation bypassed the capacity guard'; exit 1
fi
# Canceled project always rejects a new active member, even when unlimited.
psql -X -v ON_ERROR_STOP=1 -c \
 "update public.projects set canceled_at=clock_timestamp(),status='canceled',max_participants=null where id='77777777-7777-4777-8777-777777777777'" >/dev/null
if psql -X -v ON_ERROR_STOP=1 -c \
 "insert into public.participants(project_id,user_id,role) values('77777777-7777-4777-8777-777777777777','77777777-0000-4000-8000-000000000003','member')" >/tmp/pr40-canceled-out 2>&1; then
 echo 'Canceled project bypassed capacity guard'; exit 1
fi
psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.participants WHERE project_id='66666666-6666-4666-8666-666666666666' AND left_at IS NULL)<>2 THEN
  RAISE EXCEPTION 'Raw concurrent writers oversubscribed';
 END IF;
 IF (SELECT count(*) FROM public.participants WHERE project_id='88888888-8888-4888-8888-888888888888' AND left_at IS NULL)<>2 THEN
  RAISE EXCEPTION 'Reactivation changed membership despite full project';
 END IF;
END $test$;
SQL
echo "PR40 cross-writer capacity guard PASS"
