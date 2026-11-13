# PR40 managed-finance parity audit — 2026-11-13

Status: read-only Production catalog review + source-code trace. No migration or runtime deployment.

## Existing approval sequence (source: src/app/project/[id]/actions.ts)

1. Service-role reads `join_requests` and authorizes via `requireActiveJoinRequestManager`.
2. Reads participant; if inactive/missing, checks non-atomic capacity and inserts/reactivates participant.
3. If `finance_mode='managed'`, runs `clonePaymentOptionsForParticipant(participantId,userId)`.
4. If managed, invokes `createLateJoinTransfers` -> `runLateJoinTransferUpsert`.
5. Updates request `status='approved'`.
6. Resolves notifications and adds join/approval/late-transfer activity logs.

Each step above is a separate remote DB operation. A partial failure at 3–5 can strand membership and leave request pending.

## Payment-option copy contract

`clonePaymentOptionsForParticipant` currently:
- loads user-owned active `user_payment_options` (type, label, value, priority, is_active);
- loads *all* participant `payment_options` (type, value, participant_id);
- excludes existing `type::value` pairs;
- applies `validatedPaymentOptionsForStorage` to the remaining inputs, mapping `recipientName` from the option label;
- inserts valid rows with participant_id, type, label, value, priority fallback to 1, is_active=true.

**Do not directly `INSERT ... SELECT` all user options**: the JS validation can change canonical format, filter invalid recipients, or enforce constraints differently. Porting to SQL needs parity fixtures for every supported payment type and recipient-name case.

Production catalog: `payment_options` has only PK(id) and non-unique participant index; **no unique index on (participant_id,type,value)**. Replaying a clone can duplicate options. Require deterministic in-transaction dedupe and a reviewed uniqueness mechanism (including legacy duplicate preflight) or idempotent work-item ledger.

## Late-join transfer contract

`runLateJoinTransferUpsert`:
- reads newcomer joined_at, project total / total_is_per_person / bundle_size / bundle_pay_for / finalized_at / status / collector;
- runs only when collecting or finalized;
- chooses pre-join confirmed and active participants, bounded by joined_at/finalized_at where available;
- finalized: includes eligible recipients, collecting: restricts recipients to those with counted payments;
- calculates per-person pricing using `calculateProjectPricing` for N and N+1 participants;
- creates transfers in either direction based on pricing difference and active collector;
- uses upsert `onConflict: 'project_id,from_participant_id,to_participant_id'` with ignoreDuplicates.
- Existing SQL unique index `ux_late_join_unique` supports this conflict key.

**High-risk parity**: price rounding, bundle boundaries, considered recipient set, collector resolution, repeated requests, reactivation. Do not recreate historical obligations or overwrite confirmed transfers.

## Catalog findings: non-constraint indexes

- `join_requests` has two partial unique indexes on `(project_id,requester_user_id)` **only where status='pending'**. Not a global uniqueness guarantee for historical requests.
- `payment_options` has no key on `(participant_id,type,value)`; idempotence cannot be assumed from `ON CONFLICT`.
- `activity_logs` only has PK(id) and lookup indexes: no event idempotency key. Repeated requests can duplicate activity without a separate ledger or transactional dedupe.
- `late_join_transfers` has unique `(project_id,from_participant_id,to_participant_id)`, requiring explicit care not to mutate historical rows.

## Proposed resolution before switching managed-finance approval

Prefer **single-transaction approach**, but keep SQL calculation identical to the reviewed JS algorithm using parity fixtures before release. If parity is too risky, implement a durable outbox and explicit `pending_finance` state with recovery; merely moving the membership insert into a transaction while leaving finance async is not acceptable.

Before implementation, obtain:
1. Table/trigger/index preflight including all optional columns and unique indexes, plus duplicate-option counts without reading sensitive payment values.
2. Golden parity fixtures for payment destination validation and `calculateProjectPricing` (bundles, total_is_per_person, rounding, reactivation, finalized/collecting).
3. Failure injection on option-copy, recipient resolution, transfer upsert and request-state change, asserting rollback or durable retry.
4. Cross-request and same-request concurrency tests; ensure a rejected request never becomes approved due to a separate request's approval.
5. Event idempotency: exactly one participant_joined and join_request_approved per newly successful approval; no duplicates on retries.
6. Production protected historical financial snapshots and refund records unchanged.

## Important correction for the current candidate

The existing *review-only* `docs/sql/pr40_atomic_capacity_candidate.sql` deliberately rejects managed finance approval. It must **not** be promoted as a general-purpose RPC yet. As written, it also does not insert activity events or perform a comprehensive check for other membership-writer bypasses. Its `request_not_pending` response is intentional and must not be interpreted as an approved request. An already-active member awaiting approval needs specific product/finance acceptance tests.

**Gate: no migration; no runtime cutover; no merge until all this passes.**
