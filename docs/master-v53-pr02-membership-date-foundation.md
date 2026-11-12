# MASTER v5.3 PR02 — membership and selected-date foundation

Status: design foundation for review. No runtime switch, database deployment, backfill, or Production write is included.

## Scope and verified baseline

- Target branch: `main`.
- Verified baseline: `1fef4c01ec59d72f450e8f21314217fb12b19650`.
- Product sources: approved MASTER v5.3 audit, PR02 specification, Dates v3.7 reference, and the earlier-agreements register supplied in the PR02 hand-off package.
- Approved invariant: `participants.left_at is null` is active membership and occupies one seat. A date vote is availability, not membership and not a payment obligation.
- Approved exception: after final date selection, only members whose selected-option response is `maybe`, `unavailable`, or missing need an explicit decision. An `available` response needs no universal reconfirmation.
- Unresolved and deliberately excluded: a decision deadline, automatic removal, waitlist behavior, replacement transfer, former-member finance portal, and any change to refund or payment calculation.

This PR adds only pure, unused domain helpers and tests. It does not change an action, query, component, RLS policy, migration, financial calculation, or permission.

## Dependency audit

The inventory was generated from the current baseline with repository-wide searches for `attendance_status`, `left_at`, date-selection state, confirmed-participant counts, join/capacity actions, finance/refund snapshots, RLS and date triggers.

### Application and domain dependencies

| Source | Current behavior and coupling | Migration implication |
| --- | --- | --- |
| `src/lib/projectDateSelection.ts:5-17, 340-418` | Defines the six legacy attendance statuses. Finalization maps availability into attendance; `isFinanceEligible`, confirmed counts, readiness and late-confirm capacity all require `confirmed`. | Keep these APIs during expand. Introduce active-seat and selected-date-decision APIs beside them, then migrate callers one domain at a time. |
| `src/lib/projectDateService.ts:1-82, 84-163` | Supplies the default 48-hour confirmation deadline and invokes the two date-selection RPCs. | The 48-hour value is legacy compatibility only. It must not become a MASTER v5.3 policy default. |
| `src/lib/projectDateService.ts:165-346` | Sends availability/confirmation reminders. At deadline it rewrites `awaiting_confirmation` to `unconfirmed`, completes tasks and closes confirmation. | Move selected-date reminders to the new decision model only after a deadline policy is approved. Do not auto-set `left_at`. |
| `src/lib/projectDateService.ts:365-493` | Loads only active members, then derives confirmed/awaiting/cannot-attend counts from attendance. | Keep date tallies; replace seat/member totals with active membership when consumers migrate. |
| `src/app/project/[id]/actions.ts:221-390` | `startCollecting` and Extra distribution filter active participants to `attendance_status='confirmed'`. | Finance eligibility is a separate migration. Never replace this filter with active membership without a reviewed financial rule and snapshot tests. |
| `src/app/project/[id]/actions.ts:593-650` | Leaving is blocked while managed-finance refunds are incomplete, then sets `left_at`. | Conflicts with the final UX but remains unchanged. Leave/refund and former-member finance access require their own PR. |
| `src/app/project/[id]/actions.ts:2118-2254` | Public/direct join performs non-atomic `count -> insert/reactivate`; for a fixed selected-date project the count filters `confirmed`. | Replace with the project-locked reservation transaction described below. Pending private requests must remain non-seats. |
| `src/app/project/[id]/actions.ts:2436-2560` | Approval repeats the non-atomic capacity check and can insert/reactivate before late-join finance work. | Approval must use the same reservation primitive and transaction/lock order as direct join. Finance effects need an explicit transaction or outbox boundary. |
| `src/app/project/[id]/actions.ts:3868-4031` | Confirmation and late confirmation use confirmed-count capacity checks, mutate attendance, clean transport and may create late-join transfers. | Do not reuse these actions as membership operations. Selected-date response and active membership must be separate commands. |
| `src/app/project/[id]/page.tsx:647-692` | Loads active members and falls back to `confirmed` when the attendance column is missing. | Preserve legacy read compatibility throughout expand. |
| `src/app/project/[id]/page.tsx:947-973` | `financialParticipants`, pricing count and fixed-date capacity are derived from `confirmed`; selecting projects use all active members for capacity. | This split is the primary UI/server inconsistency. Seat capacity moves first; finance/pricing stays legacy until separately approved. |
| `src/app/project/[id]/page.tsx:1048-1205` | Base obligations, late join, settled counts and payment progress depend on `financialParticipants`. | Immutable counted-payment snapshots and recipient snapshots are the compatibility boundary; no retroactive recalculation. |
| `src/app/project/[id]/page.tsx:1551-1570` | Overview success-path counts and tasks consume confirmed attendance and date confirmation status. | Migrate presentation after the new selected-date decision read model exists. |
| `src/components/Project/ProjectDateFinder.tsx:407-448` | Final-date UI displays confirmed counts and treats them as capacity. | Later UI PR must show active seats separately from selected-date decisions. No UI change here. |
| `src/app/api/projects/[id]/membership/route.ts:10-25` | Active membership check correctly uses `left_at is null` only. | Reuse this meaning for membership authorization; do not add attendance filtering. |
| `src/lib/projectNotifications.ts:255-299` | Notification upsert is deduplicated; join-request recipients are active authorized managers. | Preserve dedupe keys and authorization when adding decision notifications. |
| `src/app/project/[id]/transportActions.ts:22-42` and `src/lib/projectTransportServer.ts:97-160` | Transport requires active membership and excludes `cannot_attend`/`observer`. | Transport eligibility is not seat occupancy. Migrate only after selected-date semantics are explicit. |
| `src/lib/extraPayments.ts:49-61` | Extra due rows ignore inactive Extra memberships. | Extra membership and project membership are different lifecycles; do not infer a project seat from Extra participation. |
| `src/lib/projectSuccessPath.ts`, `src/lib/projectInvite.ts`, `src/lib/projectNotifications.ts` | Success-path actions, invite/rejoin state and notifications depend on the existing membership/date split. | Keep private-invite approval and former-member re-request boundaries unchanged. |

### Database, trigger, RLS and financial dependencies

| Source | Current behavior and coupling | Compatibility requirement |
| --- | --- | --- |
| `supabase/migrations/20260912_create_project_date_selection.sql:1-198` | Adds date fields, attendance columns, options, responses, tasks and notifications. | Do not drop/rename anything during expand. |
| `...20260912...sql:245-298` | Participant insert/reactivation assigns attendance from `date_mode`, creates date tasks and notifications. | Future seat reservation must lock the project before insert/reactivation; existing trigger lock is then re-entrant in the same transaction. |
| `...20260912...sql:341-399` | Response RPC locks the project and accepts only active members. | Preserve the project-row lock as the first shared lock. |
| `...20260912...sql:404-490` | Finalization rewrites every active member's attendance, updates project state, tasks and notifications. | Replace only after dual-read/write evidence; never let a decision row set `left_at`. |
| `supabase/migrations/20260925_make_early_date_finalization_atomic.sql:6-32` | Participant initialization locks the project row. | All membership reservation paths must use the same project-first lock order. |
| `...20260925...sql:37-176` | Date option/response triggers and early finalization serialize on `projects FOR UPDATE`; finalization checks every active member/active option response. | A join committed before finalization is included; a concurrent join waits and observes the post-finalization state. Do not introduce participant-first locks. |
| `supabase/migrations/20260928_create_project_transport.sql:107-183, 505-580` | Transport RLS requires active membership. Attendance transition to `cannot_attend`/`observer` or `left_at` cleanup removes transport state. | Selected-date decision rows must not directly fire transport cleanup. |
| `supabase/migrations/20261011075702_rls_lockdown.sql:1-208` | Private helper functions and select policies gate project, participant, message, finance, late-join and Extra data by active membership. | A former member must not regain private project content through the new table. |
| `...20261011075702...sql:281-346` | Join requests are self/active-organizer readable; user payment options are owner-scoped. | Atomic approval remains organizer-authorized server work. |
| `supabase/migrations/20260109_create_chat_reads.sql`, `20260109_create_polls.sql`, `20260210_create_extras.sql`, `20260211_create_activity_logs.sql`, `20260212_create_extra_payments.sql`, `20260301*_project_base_itinerary_items.sql` | Each read/write policy uses active membership (`left_at is null`). | These are private-content consumers; no attendance-based access should be added. |
| `supabase/migrations/20261012145129_cancellation_refund_workflow.sql:1-109` | Refund rows snapshot recipient and component amounts; authenticated access is read-only and active-project scoped. | No rewrite/backfill. Former-member settlement access needs a separate least-privilege design. |
| `supabase/migrations/20261014113000_snapshot_base_payment_obligations.sql:1-86` | Counted payment amount/collector snapshots are protected from later mutation. | New membership/date work must never update these columns or recompute historical obligations. |

### Tests coupled to the legacy model

- `src/lib/projectDateSelection.test.ts`, `projectDateService.test.ts`, `projectSuccessPath.test.ts` assert legacy attendance mapping, deadlines, tasks, readiness and late confirmation.
- `src/lib/projectActions.test.ts` covers join/approval, financial eligibility, late-join and refund behavior.
- `src/lib/projectTransport.test.ts` and `projectTransportServer.test.ts` assert attendance-triggered transport eligibility and cleanup.
- `src/lib/projectInvite.test.ts`, `projectNotifications.test.ts` and invite-capability tests protect private membership and notification boundaries.
- `basePaymentSnapshotMigration.test.ts`, `cancellationRefundMigration.test.ts`, `projectRefund.test.ts`, `projectFinance.test.ts` protect historical financial state.
- SQL fixtures in `supabase/tests/` cover refund authorization and RLS. They need new role-boundary and concurrency cases before any behavior switch.

## Read-only Production compatibility snapshot

Read-only evidence was collected on 2026-11-12 from Supabase project `cqklvbwmaocztrfwqeig`. Only catalog/ledger `SELECT` queries and the migration-list API were used.

| Check | Production result | Consequence |
| --- | --- | --- |
| Database | PostgreSQL 17.6.1.054, active/healthy | Design and tests must target PostgreSQL 17 semantics. |
| Active participant statuses | 98 `confirmed`, 17 `pending_date_selection`, 4 `unconfirmed` | 119 active seats exist under the approved membership definition; never normalize them blindly. |
| Inactive participant statuses | 6 `confirmed`, 1 `pending_date_selection` | `attendance_status` is not an activity flag. |
| Counted payments | 36 rows across 27 projects | Production has grown since the earlier 28-row smoke baseline. |
| Legacy counted snapshots | Exactly 28 rows have null `amount_cents` and null `collector_participant_id` | These are the historical protected rows; no backfill or recipient/amount rewrite. |
| Selected-date decision object | No matching table | Expand is required before any new read/write path. |
| Date triggers | Participant initialization/task creation; option/response locking/task refresh; transport cleanup | A new capacity transaction must share project-first locking. |
| RLS | Relevant project, participant, date, message, payment, refund and join-request tables have RLS enabled | New public-schema objects require explicit RLS and grants. |
| Function privileges | Date mutation RPCs are service-role only; one trigger function still has legacy `PUBLIC/anon/authenticated` execute grants | Do not copy the legacy broad grant into new functions; separately review it before cleanup. |
| Ledger | Date selection is recorded as `20260912`; RLS/refund/snapshot entries use later ledger versions than repository filenames | Never infer deployment from a filename alone or repair history in this PR. |

Supabase now does not automatically expose new public tables to the Data API. A future migration must therefore make exposure intentional: enable RLS first, revoke `anon`/`authenticated` by default, and grant only the minimum reviewed privileges. This PR creates no table and changes no grant.

## Recommended data model (future expand migration)

Prefer a separate `public.participant_selected_date_decisions` table over another nullable column on `participants`:

- identity: `id`, `project_id`, `participant_id`, `selected_date_option_id`;
- immutable requirement snapshot: `required_reason` in `maybe | unavailable | missing`;
- explicit response: nullable `response` in `attending | undecided | leaving`;
- timestamps: `requested_at`, `responded_at`, `updated_at`;
- unique `(project_id, participant_id, selected_date_option_id)`;
- composite foreign keys keep participant and date option in the same project;
- no deadline column until policy is approved;
- no trigger that changes `participants.left_at`, attendance, payments, refunds or transport;
- RLS enabled immediately; expand grants only `service_role`; later self/organizer policies require dedicated cross-project tests;
- no backfill. Rows are created only by the new finalization path for affected active members.

An `available` vote creates no required decision. Membership remains active for every decision state until an explicit, separately authorized leave workflow succeeds.

## Atomic capacity strategy

The current count-then-insert/update sequences are race-prone. The future reservation RPC must:

1. Be `SECURITY DEFINER`, use `SET search_path = ''`, live outside client authority, revoke execute from `PUBLIC`, `anon` and `authenticated`, and grant only `service_role`.
2. Resolve the project id, then acquire `SELECT ... FROM public.projects WHERE id = ... FOR UPDATE` as the first lock.
3. Re-read cancellation, join strategy and `max_participants` under the lock.
4. Check whether the user already has an active participant row; return an idempotent `already_active` result before capacity rejection.
5. Count only `participants.left_at is null`. Never filter by `attendance_status`.
6. Insert or reactivate the participant while retaining the project lock. The existing date-state trigger may acquire the same project lock in the same transaction.
7. For private approval, lock order is `projects -> join_requests -> participants`; re-check request status and organizer authorization, then approve exactly once.
8. Commit membership, request state, required date task/decision initialization and an idempotent activity/outbox record together. Late-join finance creation must either join that transaction or consume the outbox idempotently; a half-joined member with missing financial setup is unacceptable.

This order matches Date Finder's project-first lock and avoids participant/project inversion.

## Expand–migrate–contract rollout

### 1. Expand

- Add the decision table and service-only privileges in a reviewed forward migration.
- Add the project-locked reservation RPC and immutable activity/outbox key.
- Keep all legacy columns, triggers, status values and reads.
- Deploy schema only after catalog preflight proves expected columns, constraints, triggers and ledger state.

### 2. Migrate behavior behind explicit gates

- Route direct join, approval and reactivation through the same reservation RPC.
- Change seat counts to active membership in server actions and UI, with concurrency tests first.
- At finalization, while holding the existing project lock, create decision rows only for affected active members. A member who joined before finalization is included because joining and finalization serialize on the project row.
- Continue legacy attendance writes temporarily only for consumers not yet migrated; mark them compatibility writes and compare outputs.
- Migrate notifications/tasks to the decision table after the deadline policy is approved.
- Migrate transport and finance eligibility in separate reviewed PRs. Active membership alone must not create an Extra or new financial obligation.

### 3. Contract

- Remove attendance-based capacity, membership and navigation decisions only after repository search and Production telemetry show no consumers.
- Remove legacy confirmation tasks/triggers and eventually `attendance_status` only in a dedicated destructive migration.
- Do not contract while legacy projects, reminders, finance or transport still read the field.

### Recovery and rollback

- Runtime rollback switches readers/writers back to legacy paths; additive tables/functions remain inert.
- Do not drop decision rows or rewrite attendance/payment/refund history during rollback.
- If a schema preflight differs, stop the migration and review catalog state. Do not patch Production interactively or rewrite the ledger.

## Required tests before a behavior switch

1. Two direct joins race for one final seat: exactly one `reserve`, one `full`, active count equals the limit.
2. Two approval transactions race for one seat: exactly one request is approved; the other remains reviewable/rejected with a capacity result.
3. Direct join races approval; reactivation races a new join; duplicate retries return one active membership and one activity event.
4. Join and date finalization race using the same project lock: no member is omitted from the finalization scope and no deadlock occurs.
5. Pending private join request never changes active-seat count.
6. Available selected-option vote creates no decision; maybe/unavailable/missing creates one deduplicated decision without changing membership.
7. No deadline silently sets `left_at`; no decision transition mutates payment/refund/transport rows.
8. RLS: self versus organizer permissions, former member denial, unrelated project denial, and no private chat/plan leakage.
9. Financial invariant: the 28 legacy counted rows and all non-null counted snapshots are byte-for-byte unchanged; late-join and Extras obligations do not duplicate.
10. Date reminder/task dedupe and Date Finder project-lock ordering remain intact.

The pure tests in `src/lib/membershipDateFoundation.test.ts` cover the approved deterministic rules now. Database concurrency and authorization tests are intentionally gated on the future schema/RPC migration; pretending to run them before that API exists would provide false evidence.

## Open decisions and risk register

| Risk / decision | Status | Gate |
| --- | --- | --- |
| Current direct join/approval capacity race | Confirmed legacy P1 risk; unchanged by this foundation | Atomic RPC plus concurrent integration tests before behavior rollout. |
| Attendance drives finance/pricing | Confirmed high-risk coupling | Separate finance eligibility design and snapshot regression suite. |
| Decision deadline / automatic removal / waitlist | Not approved | Product decision; no column, cron or automatic `left_at` before approval. |
| Leave blocked by refund workflow | Known contract conflict | Separate leave/refund/former-member portal PR. |
| Former-member settlement visibility | Not implemented | Least-privilege personal finance portal design; never reopen project content. |
| Legacy trigger execute grants | Catalog drift to review | Separate security cleanup with compatibility evidence; no opportunistic grant change here. |
| Migration ledger/file naming mismatch | Confirmed | Catalog preflight and forward-only migration; never rewrite history. |

## PR acceptance checklist

- [x] Baseline verified against current `main`.
- [x] Code, SQL, RLS, finance/refund and notification dependencies mapped.
- [x] Production compatibility checked read-only.
- [x] Project-first atomic capacity and lock-order strategy documented.
- [x] Expand–migrate–contract and recovery plan documented.
- [x] Pure membership/selected-date rules added with no runtime consumer.
- [x] No schema migration, backfill, Production write, deployment or merge.
- [ ] Human approval of schema, RLS, lock order, transaction boundary and open product decisions before a migration PR.
