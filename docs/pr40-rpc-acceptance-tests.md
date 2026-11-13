# PR40 RPC candidate acceptance checks

**Not yet executed**: this candidate is under `docs/sql/`, not `supabase/migrations/`, and has no runtime consumer. Never treat static review as PostgreSQL concurrency PASS.

## Isolated database integration matrix
1. Spin up two independent connections and a fixture with one seat left. Use a barrier to submit two distinct self-joins. Assert precisely one `reserved`, one `full`, no over-capacity row count.
2. Repeat with two pending organizer approvals; one `approved`, other remains `pending`.
3. Race direct and approval for a public/none project; both use the same project-row lock.
4. Race reactivation and new join; duplicate same-user retries return `already_active`.
5. Race join and selected-date finalization; ensure no missed date task or deadlock.
6. Cancel concurrently with join; ensure project row lock and consistent serialization.
7. Check direct self-only, private denial, canceled denial, wrong approver denial, cross-project request denial.
8. Check `has_function_privilege` denies PUBLIC, anon and authenticated, permits service_role; validate role grants from an independent session.
9. Assert missing required identities error without writes and no changes to historical payment/refund/extra/transport rows.
10. **Managed finance approval must reject with no mutation.** This is a temporary gate, not feature completion.
11. Check request already non-pending does not mint membership or activity.

## Before switching runtime
- Integrate finance cloning, late-join transfer calculation and activity/notification dedupe into transaction or proven idempotent outbox.
- Add simulated failure injection at every managed-finance step and assert recovery/parity with current pricing.
- Examine direct join's preexisting notification/activity behavior and preserve or explicitly change it.
- Validate no bypass via other participant insert/update routes; add DB-level protection if necessary.
- Conduct isolated Postgres tests and exact-head CI and Preview; do not migrate Production without approval.
