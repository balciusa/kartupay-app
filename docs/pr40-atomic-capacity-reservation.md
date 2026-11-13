# PR #40 — Atomic Capacity Reservation (implementation gate)

Status: design and implementation handoff. NO runtime switch or Production migration authorized by this file.
Baseline: main at 235ce5d62f464c711509c984e5374366e9d66443 (PR #39).

## Confirmed P1
- Direct join in `src/app/project/[id]/actions.ts:2118+`: count active participants, conditionally filter by `attendance_status='confirmed'`, then insert/reactivate in a separate request.
- Organizer approval in the same file at `:2436+`: repeats non-atomic count, insert/reactivate, then creates payment options, late-join transfers, request approval, notifications and activity in separate operations.
- Concurrent transactions can both observe one remaining seat; a failure after membership writes can leave partial financial/request state.
- Seat occupancy MUST be `participants.left_at is null` (not attendance) according to MASTER v5.3.

## Planned atomic boundary (implementation not yet deployed)
1. Review exact deployed catalog, foreign keys, triggers, unique constraints, role grants, finance and notification side effects. Never assume migration filename equals deployed ledger.
2. Implement project-first transactional reservation behind a service-only Postgres RPC. Acquire `projects FOR UPDATE` before the active-seat count and participant mutation. Keep `SECURITY DEFINER` with empty search_path, explicit fully-qualified identifiers, and revoke default PUBLIC/anon/authenticated EXECUTE. Validate caller authorization server-side and, where appropriate, inside the function.
3. In the same transaction, re-check project cancellation and the intended join strategy, distinguish direct join from pending private approval, and re-check request status and organizer eligibility for approval. Order locks projects -> join_requests -> participants. Idempotent already-active handling must not consume a new seat or duplicate side effects.
4. Count only active participants; `max_participants IS NULL` means unlimited. Reject full projects without any mutation.
5. Preserve existing participant/date initialization triggers and never silently rewrite attendance, selected-date votes, payment/refund snapshots, extras or transport.
6. Finance atomicity must be solved before approval runtime cutover: either perform critical payment-option and late-join setup in the same DB transaction, or write a durable idempotent outbox event with a tested retry/recovery and explicit pending-settlement state; do not consider a partial join successful.
7. Design activity and notification deduplication. Existing post-transaction effects should be safe under retry and avoid duplicates.

## Required verification before merge/runtime cutover
- DB integration: 2 direct joins for one remaining seat => exactly one admitted.
- 2 organizer approvals for one seat => only one approved; losing request remains actionable.
- Direct join vs organizer approval; reactivation vs new join; duplicate retries => no oversubscription or duplicate membership/events.
- Join racing date finalization => serialized project-first, no missed member or deadlock.
- Private pending request => does not reserve a seat; wrong organizer and canceled project => no writes.
- Cross-project/unauthorized/anonymous/former-member RPC invocation denied; deliberate grants and RLS checked.
- Financial fault injection after membership action => no stranded paid membership, duplicate late_join_transfers, or changed immutable snapshots.
- Legacy 28 counted payment rows remain untouched; current non-null snapshot values unchanged.
- Read-only Production preflight, migration checksum, forward-only migration review; apply only with separate authorization.
- Run focused tests, full unit, lint, Next build, concurrency/Postgres tests, Playwright and exact-head Vercel Preview.

## Release controls
- PR remains Draft while designing/implementing and testing.
- No automatic Production migration, no direct Production SQL writes, no merge or runtime cutover from this checkpoint.
- Existing join paths remain unchanged until transaction and finance contracts are proven.
