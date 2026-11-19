# PR #40 — verified Production preflight and implementation decision (2026-11-13)

**Read-only audit only.** This note does not authorize applying SQL, enabling a feature, or changing runtime.

## Verified deployed facts

- `public.projects` exposes `id`, `status`, `canceled_at`, `max_participants`, `is_public`, `finance_mode`, `selected_date_option_id`; **no `aborted_at` column** in the inspected catalog. Avoid referencing absent columns in static SQL.
- `public.participants` has UNIQUE `(project_id,user_id)`, UNIQUE `(project_id,id)`; `left_at` nullable. `role` CHECK is `organizer | member`.
- `public.join_requests` has `id`, `project_id`, `requester_user_id`, `status`, `approved_by`, `approved_at`, `participant_id`; only primary key and project FK were returned by the constraint inspection. **Do not assume request-user uniqueness without an explicit index catalog check.**
- Participant triggers: `participants_initialize_date_state` (BEFORE INSERT or UPDATE of left_at), `participants_create_project_date_task` (AFTER), `participants_cleanup_project_transport` (AFTER), and `trg_clear_collector_on_leave` (AFTER).
- The pre-existing initialization trigger acquires `projects FOR UPDATE`, reinforcing project-first lock order.
- `getProjectJoinStrategy` allows *direct membership only when public AND finance_mode='none'*; all managed-finance joins require approval.
- Existing approval creates/reactivates membership **before** cloning payment options, computing/upserting late-join transfers, and marking the request approved. These are separate Supabase calls; there is no cross-call transaction.
- Late-join calculations use counted payments, attended participants, pricing bundles, chosen collector and project finalization status. A naive SQL port risks changing financial obligations and protected historical snapshots.

## Implementation decision

**Do not switch either runtime path until approval and finance are atomic.** Even a perfectly serialized seat count is insufficient for managed approval if payment setup fails after membership is committed.

Implement via an internal, service-only transactional RPC with explicit idempotent output. Three possible approaches:

1. Preferred: port the *minimal* critical managed-finance setup into the same Postgres transaction, matching existing pricing and recipient semantics, with parity tests.
2. Alternative: durable outbox written in the reservation transaction + pending-effect lifecycle + idempotent recovery worker; no success response until the workflow contract is satisfied.
3. Reject: RPC reserving membership followed by independent payment and approval writes and claiming the P1 resolved.

The service-only RPC must enforce project-first lock, owner/organizer authorization for approval, join strategy, canceled project denial, request status, real active-seat count, unique participant membership and idempotent retries. A non-public project may not use direct join even via service_role. Client must never call a privileged RPC with an unverified user ID.

## Required test matrix before runtime integration

| Scenario | Expected result |
| --- | --- |
| Two direct joins for one seat | one commit, one full; no oversubscription |
| Two approvals for one seat | exactly one approved, loser remains pending |
| Direct vs approval and reactivation vs new join | same single seat arbitration |
| Duplicate same-user retries | already-active; no duplicate financial or activity events |
| Cancellation while joining | serialized and canceled rejected |
| Join vs date finalization | project-first locking; no lost date task |
| Private join / unauthorized manager | denied without membership mutation |
| Managed finance setup throws at every stage | transaction rolled back or durable pending with recovery; no silent partial-success |
| All counted and legacy snapshots | unchanged byte-for-byte |
| RLS/grants | PUBLIC, anon, authenticated cannot execute privileged RPC |
| Exact-head CI | focused, unit, lint, build, E2E and isolated multi-session PostgreSQL concurrency |

## Next coding checkpoint

Start with repository-side atomic RPC and DB integration harness in a reviewable migration **only after** mapping and parity-testing `clonePaymentOptionsForParticipant`, `createLateJoinTransfers`, `recordProjectActivity` and notification dedupe. This remains a Draft gate, not approval to migrate Production.
