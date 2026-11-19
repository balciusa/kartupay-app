# PR40 atomic membership acceptance checks

The deployable migration is
`supabase/migrations/20261116205555_atomic_membership_and_managed_approval.sql`.
The obsolete review-only SQL candidates were removed, and both runtime join
paths now call the service-only atomic functions.

## Executed PostgreSQL 17 matrix

`scripts/pr40-postgres-full-chain.sh` builds a disposable database from the
pre-chain core baseline and applies every repository migration in order. It
then verifies:

1. Two independent direct joins for one seat produce one `reserved` and one
   `full`, with no oversubscription.
2. Two independent managed approvals for one seat approve exactly one request;
   the other remains pending without financial or activity side effects.
3. Raw participant writers and reactivation share the same capacity trigger.
4. Cancellation and approval serialize on the project row; the canceled
   project retains its pending request and no new member.
5. Managed membership, canonical option copies, two EUR 20 late transfers,
   request state, notification resolution and three activity events commit in
   one transaction; retry adds nothing.
6. A forced payment-option failure rolls back membership, request, notification,
   transfers and activity.
7. Foreign and stale payment-source snapshots and an unauthorized actor fail
   without writes. TypeScript remains the only destination-format validator.
8. Existing date, transport and collector triggers coexist with the capacity
   trigger. Active-member RLS boundaries remain intact.
9. `PUBLIC`, `anon` and `authenticated` cannot execute either RPC;
   `service_role` can.
10. Synthetic pre-chain counted payment, transfer and audit rows plus completed
    extra/refund history remain exactly unchanged.

Production migration and deployment remain separate, explicitly authorized
steps. These tests do not authorize either operation.
