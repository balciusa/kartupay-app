#!/usr/bin/env bash
set -euo pipefail
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-pr40_test_only}"
database=pr40_full_chain
dropdb --if-exists "$database"
createdb "$database"
export PGDATABASE="$database"

psql -X -v ON_ERROR_STOP=1 -f supabase/tests/pr40_prechain_core_schema.sql >/dev/null
while IFS= read -r migration; do
  echo "Applying $(basename "$migration")"
  psql -X -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort)
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/pr40_full_chain_fixture.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/pr40_full_chain_assertions.sql >/dev/null

# Direct joins race for one seat through independent database sessions.
psql -XAt -v ON_ERROR_STOP=1 -c "select public.reserve_project_membership_atomic('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',null)->>'outcome'" >/tmp/pr40-direct-a &
direct_a=$!
psql -XAt -v ON_ERROR_STOP=1 -c "select public.reserve_project_membership_atomic('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',null)->>'outcome'" >/tmp/pr40-direct-b &
direct_b=$!
wait "$direct_a"; wait "$direct_b"
sort /tmp/pr40-direct-a /tmp/pr40-direct-b | diff -u <(printf 'full\nreserved\n') -

# Managed approvals race for one seat; one request and every side effect stay pending/absent.
psql -XAt -v ON_ERROR_STOP=1 -c "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','[]'::jsonb)->>'outcome'" >/tmp/pr40-managed-a &
managed_a=$!
psql -XAt -v ON_ERROR_STOP=1 -c "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','[]'::jsonb)->>'outcome'" >/tmp/pr40-managed-b &
managed_b=$!
wait "$managed_a"; wait "$managed_b"
sort /tmp/pr40-managed-a /tmp/pr40-managed-b | diff -u <(printf 'full\nreserved\n') -

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $test$ begin
 if (select count(*) from public.participants where project_id='11000000-0000-4000-8000-000000000001' and left_at is null) <> 2 then raise exception 'Direct join oversubscribed'; end if;
 if (select count(*) from public.participants where project_id='11000000-0000-4000-8000-000000000003' and left_at is null) <> 2 then raise exception 'Managed join oversubscribed'; end if;
 if (select count(*) from public.join_requests where project_id='11000000-0000-4000-8000-000000000003' and status='approved') <> 1
   or (select count(*) from public.join_requests where project_id='11000000-0000-4000-8000-000000000003' and status='pending') <> 1 then raise exception 'Managed request race mismatch'; end if;
end $test$;
SQL

# Cross-writer guard also rejects a raw service-role insert after capacity is full.
if psql -X -v ON_ERROR_STOP=1 -c "insert into public.participants(project_id,user_id,role) values('11000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006','member')" >/tmp/pr40-raw-writer 2>&1; then
  echo 'Raw membership writer bypassed capacity'; exit 1
fi
grep -q 'Project capacity has been reached' /tmp/pr40-raw-writer

# DB provenance rejects a foreign source, a stale raw snapshot, and an
# unauthorized actor without creating any partial membership state.
for rejected_call in \
  "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','[{\"type\":\"revolut\",\"label\":\"Newcomer\",\"value\":\"https://revolut.me/newcomer\",\"priority\":1,\"source_option_id\":\"15000000-0000-4000-8000-000000000001\",\"source_value\":\"@newcomer\",\"source_label\":\"Newcomer\",\"source_priority\":1}]'::jsonb)" \
  "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','[{\"type\":\"revolut\",\"label\":\"BOOM\",\"value\":\"https://revolut.me/fault-user\",\"priority\":1,\"source_option_id\":\"15000000-0000-4000-8000-000000000003\",\"source_value\":\"@stale-value\",\"source_label\":\"BOOM\",\"source_priority\":1}]'::jsonb)" \
  "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','[]'::jsonb)"
do
  if psql -X -v ON_ERROR_STOP=1 -c "$rejected_call" >/tmp/pr40-rejected-call 2>&1; then
    echo 'Unsafe managed approval call succeeded'; exit 1
  fi
done
psql -XAt -v ON_ERROR_STOP=1 -c "select count(*)=0 from public.participants where project_id='11000000-0000-4000-8000-000000000005' and user_id='10000000-0000-4000-8000-000000000009'; select status='pending' from public.join_requests where id='14000000-0000-4000-8000-000000000005'" | diff -u <(printf 't\nt\n') -

# Cancellation and approval serialize on the same project row. Approval sees
# the committed cancellation and leaves the pending request untouched.
rm -f /tmp/pr40-cancel-locked
psql -X -v ON_ERROR_STOP=1 <<'SQL' >/tmp/pr40-cancel-session 2>&1 &
begin;
select id from public.projects where id='11000000-0000-4000-8000-000000000006' for update;
\! touch /tmp/pr40-cancel-locked
select pg_sleep(1);
update public.projects set status='canceled', canceled_at=clock_timestamp() where id='11000000-0000-4000-8000-000000000006';
commit;
SQL
cancel_pid=$!
for _ in $(seq 1 100); do [[ -f /tmp/pr40-cancel-locked ]] && break; sleep 0.05; done
if [[ ! -f /tmp/pr40-cancel-locked ]]; then echo 'Cancellation lock handshake failed'; wait "$cancel_pid" || true; exit 1; fi
if psql -X -v ON_ERROR_STOP=1 -c "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000006','14000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','[]'::jsonb)" >/tmp/pr40-cancel-approval 2>&1; then
  echo 'Approval succeeded after cancellation'; exit 1
fi
wait "$cancel_pid"
psql -XAt -v ON_ERROR_STOP=1 -c "select count(*)=0 from public.participants where project_id='11000000-0000-4000-8000-000000000006' and user_id='10000000-0000-4000-8000-000000000006'; select status='pending' from public.join_requests where id='14000000-0000-4000-8000-000000000006'" | diff -u <(printf 't\nt\n') -

# An injected payment-option failure rolls back membership, request, notification,
# financial rows and activity as one transaction.
psql -X -v ON_ERROR_STOP=1 <<'SQL'
create function public.pr40_fail_option() returns trigger language plpgsql as $$
begin if new.label='BOOM' then raise exception 'intentional failure'; end if; return new; end $$;
create trigger pr40_fail_option before insert on public.payment_options for each row execute function public.pr40_fail_option();
SQL
if psql -X -v ON_ERROR_STOP=1 -c "select public.approve_managed_membership_atomic('11000000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','[{\"type\":\"revolut\",\"label\":\"BOOM\",\"value\":\"https://revolut.me/fault-user\",\"priority\":1,\"source_option_id\":\"15000000-0000-4000-8000-000000000003\",\"source_value\":\"@fault-user\",\"source_label\":\"BOOM\",\"source_priority\":1}]'::jsonb)" >/tmp/pr40-fault 2>&1; then
  echo 'Injected failure was not raised'; exit 1
fi
grep -q 'intentional failure' /tmp/pr40-fault
psql -XAt -v ON_ERROR_STOP=1 -c "select count(*)=0 from public.participants where project_id='11000000-0000-4000-8000-000000000005' and user_id='10000000-0000-4000-8000-000000000009'; select status='pending' from public.join_requests where id='14000000-0000-4000-8000-000000000005'; select count(*)=0 from public.activity_logs where join_request_id='14000000-0000-4000-8000-000000000005'" | diff -u <(printf 't\nt\nt\n') -

echo 'PR40 complete migration chain, RLS, triggers, history, concurrency and rollback PASS'
