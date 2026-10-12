# Cancellation and refund deployment

## Behavior

- Canceling a pending or collecting project stops new project activity and keeps participants, payment signals, confirmed payments, extras, late transfers, and activity history.
- Pending commitments that were never confirmed do not become refund obligations.
- Every confirmed base payment, extra payment, and received late-join transfer is grouped by its actual recipient. One participant can therefore have several manual refund requests.
- The actual recipient approves a request and marks it sent. The payer confirms receipt. No action moves money or infers that a real refund completed.
- A participant leaves only after every current obligation has a matching completed request. Repeated cancellation and refund transition calls are idempotent.

## Production discrepancy

Repository migration `20260307_create_participant_refund_requests.sql` is not present in the Production migration history, and the table is absent from the live Production schema. Do not repair or rewrite migration history. Apply only the new forward migration `20261012145129_cancellation_refund_workflow.sql` after approval.

The older migration must not be applied to Production: it grants direct client writes, uses cascade deletion for financial history, ignores late-join transfers, and permits only one open request per participant even when obligations have different recipients.

## Deployment gate

1. Record the approved PR exact head and the migration SHA-256 checksum.
2. Confirm a current restorable Supabase backup/PITR point and name the recovery operator.
3. Export timestamped schema, policy, grant, function, and migration-history metadata. Do not export customer rows into test fixtures.
4. Confirm no newer Production migration conflicts with this filename or table.
5. Apply the single forward migration through the approved Supabase SQL mechanism. Do not use `supabase db push` or migration repair.
6. Verify the table, five foreign keys, amount/status checks, recipient-scoped open-request index, active-member SELECT policy, authenticated SELECT-only grant, and service-role access.
7. Deploy the exact-head application and wait for Vercel Production READY.
8. With disposable accounts, verify: organizer cancellation with and without financial history; collector cannot cancel; canceled-project refund request; actual recipient approval and sent transition; payer confirmation; retry idempotency; former-member denial; desktop and 390px layouts.
9. Confirm payment and activity row counts are unchanged by cancellation and no automatic transfer/refund is reported.

## Recovery

The recovery operator should prefer an application forward fix. If private refund state must be contained immediately, apply `supabase/rollback/20261012145129_cancellation_refund_workflow.rollback.sql`. It removes authenticated Data API visibility while retaining the table, constraints, service-role access, and all financial history. Reapplying the forward migration restores the reviewed active-member read policy.

Do not drop the table or late-transfer column. Do not restore the older permissive insert/update policies. If the migration transaction fails, PostgreSQL rolls it back atomically; capture the error and schema metadata before retrying.
