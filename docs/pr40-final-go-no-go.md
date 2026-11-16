# PR40 final GO / NO-GO gate

Date: 2026-11-16  
PR: #40 (`codex/pr40-atomic-capacity-reservation`)  
Base inspected: `235ce5d62f464c711509c984e5374366e9d66443`  
Starting head inspected: `45acfe13f6a743ee01571a2c524995efad880a88`

## Decision

**NO-GO for merge and NO-GO for Production deployment.**

The review-only SQL proves useful lock and rollback properties in an isolated PostgreSQL 17 fixture, but the application still uses the old non-transactional membership paths. There is no migration, no deployed RPC/capacity guard, and no runtime cutover. The SQL payment verifier also deliberately differs from `paymentRecipient.ts`, and the isolated fixture does not reproduce the complete Production schema, RLS and trigger set. Shipping the current candidate would therefore leave both the last-seat race and managed-finance partial-write risk unresolved.

This decision is independent of deployment authorization. Nothing in this PR authorizes a merge, migration, Vercel Production deployment or Production write.

## Findings

| Priority | Status | Finding | Evidence / disposition |
| --- | --- | --- | --- |
| P0 | Fixed in this PR | Exported `addMeAsOrganizerWithPayment` used the service role to create an anonymous auth user, add it as organizer to an arbitrary managed project, and attach a payment option without manager authorization. | Removed the action and its anonymous-user bootstrap. `pr40ParticipantWriterAudit.test.ts` prevents its return. |
| P0 | Fixed in this PR | Unused exported `joinProjectSafe` server action directly inserted an authenticated user into any project through the service role, bypassing privacy, join strategy, cancellation and capacity. | Deleted the server action. Regression test verifies it is absent. |
| P1 | Fixed in this PR | Direct join and join-request approval counted only `attendance_status = 'confirmed'` after a fixed date was selected, allowing active non-attendees to disappear from the seat count. | Both checks now count exactly `participants.left_at IS NULL`; two runtime regression tests cover `cannot_attend`. |
| P1 | Open — merge blocker | Direct join and approval still perform count-then-insert/reactivate through separate Data API calls. Two callers can take the final seat concurrently. | Candidate RPC/guard tests exist, but neither candidate is a migration or runtime dependency. |
| P1 | Open — merge blocker | Managed approval still writes membership, payment options, late-join transfers, request state, activity and notifications in separate requests. A later failure can leave partial state. | Atomic managed SQL candidate is dormant; `pr40ManagedApprovalServer.ts` intentionally never invokes it. |
| P1 | Open — merge blocker | PostgreSQL payment verification is not equivalent to the supported TypeScript contract. It rejects a valid percent-encoded Revolut path and accepts IBAN shape without country length/checksum verification; URL and Unicode NFC behavior also differ. | Golden TypeScript matrix plus isolated SQL characterization. Runtime cutover must not silently drop supported destinations or trust a stale/substituted destination. |
| P1 | Open — merge blocker | The PostgreSQL fixture is intentionally reduced and does not reproduce all Production participant/date/transport triggers, complete RLS, notification behavior or legacy financial constraints. | Read-only catalog comparison below. A representative full-schema integration run is still required before a migration can be approved. |
| P1 | Open — merge blocker | Candidate managed approval does not yet demonstrate complete runtime parity for notification resolution and all existing already-active/reactivation cases on the real schema. | Current action and candidate differ; no cutover was made. |
| P2 | Open | Production has two equivalent partial unique indexes for pending join requests. | `join_requests_project_requester_unique` and `uq_join_requests_pending`; harmless for correctness but adds maintenance overhead. |
| P2 | Open | Supabase security advisor reports four existing functions with mutable `search_path` and broad GraphQL object grants. | Not introduced by PR40; RLS still applies. Review separately before changing existing functions or grants. |
| P2 | Open | GitHub Actions use mutable action tags rather than immutable commit SHAs. | Supply-chain hardening; not the reason for the PR40 NO-GO. |

No unresolved P0 was found after the fixes above. The open P1 items are sufficient for NO-GO.

## Production schema compatibility (read-only)

Project `cqklvbwmaocztrfwqeig` was inspected through read-only catalog and aggregate queries. No DDL, migration or data write was executed.

- PostgreSQL is 17.x. Production has the expected `projects`, `participants`, `join_requests`, `user_payment_options`, `payment_options`, `payments`, `late_join_transfers`, `activity_logs` and `project_notifications` columns used by the candidates. Required UUID/timestamp/status defaults are present.
- Production has no `pr40%` functions and no PR40 capacity trigger. The candidate therefore cannot be called by the application.
- Active membership is represented by `participants.left_at IS NULL`; the participant uniqueness constraint is `(project_id, user_id)`.
- The late-transfer unique index is `(project_id, from_participant_id, to_participant_id)`. There were no duplicate late-transfer groups at inspection time.
- Production participant triggers include date-state initialization, date-task creation, collector cleanup and transport cleanup. The reduced fixture does not reproduce every trigger.
- Relevant tables have RLS enabled. Core financial/member rows are selected through authenticated active-project policies; user payment options have own-user CRUD policies. Candidate functions revoke default execution and grant only `service_role`, which is the required direction, but those grants have not been exercised on a full Production-equivalent schema.
- Snapshot at inspection: 76 projects; 119 active and 7 inactive participants; 0 over-capacity and 1 exactly-at-capacity project; 2 pending join requests with 0 duplicate pending groups; 36 counted payment rows across 27 projects; 14 late-join transfers with 0 duplicate groups; 0 duplicate active project payment-option groups.
- These current aggregate counts supersede earlier audit snapshots. They are evidence only; this task did not change any Production row.

Important fixture differences:

1. The fixture models only the columns, constraints, grants and triggers needed by the candidate tests; it is not a schema dump.
2. Production date, transport and collector triggers can run on participant changes and require a full-schema compatibility run.
3. Production RLS policy expressions were not installed in the isolated fixture; negative RPC role/grant tests are useful but not a complete Data API/RLS test.
4. Production contains legacy financial rows and a `NOT VALID` counted-payment snapshot constraint. Candidate tests use synthetic records and cannot prove every legacy row shape.

## Payment and financial correctness

The shared TypeScript validator remains authoritative. The golden matrix covers Revolut handles and URLs, percent encoding, provider hostnames, HTTPS, credentials, ports, fragments and queries; Swedbank hosts and query handling; IBAN country length/checksum; Unicode NFC names; duplicates; inactive/foreign/stale sources; and malicious substitutions.

The SQL candidate is fail-closed for some valid inputs but not a complete integrity verifier. It is safe only as review evidence, not as a deployable duplicate of the TypeScript validator. The shortest acceptable design is to choose and prove one canonical validation boundary, bind every staged option to a locked active requester-owned source row, and run the same golden cases through both the server adapter and the final database contract without losing any currently supported destination.

Pricing/late-join model tests cover collecting versus finalized projects, counted-recipient selection, join windows, flat and per-person pricing, bundle boundaries, reverse transfers, collector fallback, zero deltas and transfer idempotency. Existing full unit tests cover refunds, extras, immutable counted-payment snapshots and duplicate activity prevention. The atomic SQL fault test proves rollback in the reduced fixture, but full-schema financial parity remains an open P1 because the candidate is not integrated.

## Security and concurrency assessment

The SQL candidates use project-first locking, then request/participant locks, and service-role-only execution with an empty `search_path`. Isolated CI has exercised two direct joins for one seat, two managed approvals, direct versus managed contention, cancellation versus approval, date finalization, reactivation/raw writers, retries, authorization failures, stale/foreign payment sources and a forced payment-option failure with full transaction rollback.

Those results validate the candidate lock strategy, not the current application. The current runtime does not call the RPC and has no database guard, so its TOCTOU and managed-finance partial-write risks remain.

## Validation evidence

Local commands on the audited branch:

- Focused PR40 plus membership regression tests: `node --test --experimental-transform-types ...` — **158 passed, 0 failed**.
- Full unit suite: `npm test` — **484 total: 480 passed, 1 failed, 3 skipped**. The single failure is the existing real-browser `newProjectForm.test.ts` timeout waiting for the form. PR40 does not change that test or the New Project implementation; all other tests, including the new PR40 tests, passed.
- ESLint: `npm run lint` — **passed** after removing four PR40 test warnings.
- TypeScript: `npx tsc --noEmit --incremental false` — **passed**.
- Production-mode build: process-local non-secret placeholder Supabase values plus `npm run build` — **passed**. The first no-env attempt failed as expected because `supabaseUrl` is required; no environment file was created or changed.
- Playwright: first default local four-worker run overloaded the dev server (6 passed, 12 timed out, 12 not run). CI-equivalent retry with `CI=1 npx playwright test` — **30 passed**, including desktop, 390x844 mobile, 320px and 768px responsive projects.
- Local PostgreSQL: **environment-blocked** because Docker Desktop's Linux engine was not running and host `psql` is unavailable.
- Exact starting-head CI: PostgreSQL 17 isolated run `43942913407` passed; focused unit/lint run `43942913573` passed; Playwright run `43942913325` passed; Vercel status was success. New-head CI must pass after this report is committed and pushed.

## Expand–migrate–contract plan

This is a plan for a later reviewed change, not deployment authorization.

1. **Preflight:** verify backup/PITR availability; record active seats, pending requests, duplicate groups, counted snapshots, late transfers and trigger/function/grant state using read-only queries.
2. **Expand:** after closing payment and full-schema parity gaps, add reviewed migration files for service-only atomic RPC(s) and the cross-writer capacity guard. Set empty `search_path`, revoke `PUBLIC`/browser execution and grant only the intended server role. Do not cut runtime yet.
3. **Compatibility test:** apply migrations to a representative disposable database built from the complete migration chain; run RLS, trigger, legacy-data, concurrency, fault and financial-history suites.
4. **Runtime cutover:** deploy a server adapter that derives actor identity from the real session, passes only stored request/source identity, and handles each explicit RPC outcome. Do not add a partial feature switch.
5. **Smoke and monitor:** verify exact Vercel head, direct/private/managed joins, last-seat contention, cancellation, notifications, late transfers, refunds and existing projects before any wider release.
6. **Contract:** remove old non-atomic writers only after the new path is stable. Keep immutable financial history untouched.

Rollback must reverse runtime first, then database objects only when no deployed code depends on them. A rollback cannot undo already committed memberships or financial obligations; recovery must be additive/manual and must never delete historical payments, refunds, extras or audit rows.

## Shortest safe route to GO

Resolve the payment-validation contract, convert the candidates into reviewed migrations, validate them against a complete Production-equivalent schema with RLS/triggers/legacy fixtures, integrate every membership create/reactivate path atomically, then rerun the full gate on the exact resulting head. Until then, keep PR #40 Draft and do not merge or deploy it.
