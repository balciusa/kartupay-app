# PR40 final GO / NO-GO gate

Date: 2026-11-18

PR: #40 (codex/pr40-atomic-capacity-reservation, Draft)

Base inspected: 235ce5d62f464c711509c984e5374366e9d66443

Implementation start: 833fbae1b9aabf6596fb9c975de6b3ce25fd364a

## Decision

**All five identified P1 implementation blockers are resolved. The PR remains
NO-GO for merge until an explicitly authorized, migration-first release window
is approved.**

This is a deployment-order gate, not an open P1 code defect. The application
now depends on the three service-only functions and the cross-writer capacity
trigger in 20261116205555_atomic_membership_and_managed_approval.sql. Merging
can cause Vercel to deploy the runtime before those objects exist in Production.
The safe order is: reviewed migration deployment, function/grant smoke check,
then merge/runtime deployment. This task did not authorize or perform any of
those Production operations.

## P1 resolution matrix

| P1 blocker | Status | Exact resolution and evidence |
| --- | --- | --- |
| Final-seat race across membership writers | **Resolved** | A BEFORE INSERT OR UPDATE OF left_at trigger locks the project and counts exactly active rows (left_at IS NULL). Direct join and finance-none approval use reserve_project_membership_atomic; managed approval uses the same project-first lock. Independent-session final-seat races produce exactly one reserved and one full; a raw service-role insert cannot bypass the trigger. |
| Managed approval partial writes / retry safety | **Resolved** | Membership insertion/reactivation, cloned payment destinations, late-join transfers, request state, notification resolution and activity rows are one transaction in approve_managed_membership_atomic. Repeated approval is a no-op, and an injected payment-option failure rolls back every side effect. |
| Incompatible payment validators | **Resolved** | paymentRecipient.ts is the single format validator. PostgreSQL does not maintain a second IBAN/Revolut/Swedbank parser; it locks the exact active requester-owned user_payment_options source and verifies the TypeScript-normalized command against its source snapshot. Golden tests cover provider URLs, percent encoding, host/query attacks, IBAN country length/checksum, Unicode NFC, inactive/foreign/stale sources and deduplication. |
| Reduced-schema-only evidence | **Resolved** | The gate builds a disposable PostgreSQL 17 database from a realistic pre-chain core schema, applies every repository migration in lexical order, then installs representative legacy financial rows, RLS, grants and existing date/transport/collector triggers. Full-chain assertions and concurrency/fault tests pass. No Production schema or data was changed. |
| Runtime parity not integrated | **Resolved** | requestJoin and approveJoinRequest call the atomic server adapters. Actor identity comes from the authenticated server session. A service-only authorization-context RPC runs before any requester payment read, and each write RPC re-authorizes under locks. Supabase JS → PostgREST → PostgreSQL integration exercises direct join, managed approval, notification resolution, payment-option persistence and browser-role denial. Reactivation, existing-active membership, cancellation, full capacity and finance-none paths are covered. |

No unresolved P0/P1 defect was found in the implemented scope.

## Security and data-integrity properties

- All three RPCs use SECURITY DEFINER, an empty search_path, explicit actor
  identity and service-role-only execution. anon and authenticated cannot
  execute them.
- Approval authorization happens in the database before the service adapter
  reads requester payment destinations. Managed and finance-none write RPCs
  repeat authorization and request-state checks under row locks.
- Private-project approval remains organizer-only. Collector-only approval is
  accepted only for a public project, preserving the existing policy.
- Active membership, not attendance, consumes capacity. Reactivation preserves
  participant identity and historical financial associations.
- The migration never deletes payments, extras, refunds, transfers or audit
  rows. Exact legacy fixture identities and values are asserted unchanged after
  migration, approval, retries, concurrency and forced rollback.
- Late-join transfer uniqueness remains
  (project_id, from_participant_id, to_participant_id). The tested managed
  fixture creates exactly two EUR 20 transfers (EUR 40 total) and no second base
  obligation.

## Validation evidence

Local validation on the final working tree:

- Focused PR40/actions/security tests: **132 passed, 0 failed**.
- Full unit suite: **486 total: 482 passed, 1 failed, 3 skipped**. The only
  failure is the inherited newProjectForm.test.ts real-browser timeout waiting
  for document.querySelector("form"); PR40 does not modify the New Project form
  or that test. Every PR40 test passed.
- TypeScript: npx tsc --noEmit --incremental false — **passed**.
- ESLint: npm run lint — **passed**.
- Production build with process-local non-secret placeholder values:
  npm run build — **passed**. No environment file was created or changed.
- Playwright with CI settings and one worker: **30 passed, 0 failed** in 3.9m,
  covering desktop, 390x844 mobile, 320px compact and 768px tablet projects.
- PostgreSQL 17 full migration chain: **passed**. This includes RLS/grants,
  existing triggers, direct and managed final-seat races, raw-writer guard,
  cancellation serialization, retry idempotency, invalid payment provenance,
  historical finance preservation and injected-failure rollback.
- Runtime integration: **passed** through the actual Supabase JavaScript client,
  standalone PostgREST and the fully migrated PostgreSQL database.
- Exact-head GitHub Actions and Vercel Preview are required to be green before
  review approval; their run/deployment links are recorded in the PR check UI
  after the resulting head is pushed.

The first build attempt used the wrong service-role variable name and failed
configuration collection (supabaseKey is required); the repository's actual
variable name was then supplied with a process-local placeholder and the full
build passed. The first sandboxed Node test attempts failed with Windows
spawn EPERM; rerunning the same commands outside that process sandbox produced
the results above. Neither is an application failure.

## Migration readiness and release gate

The migration is **ready for reviewed deployment** based on the full-chain,
security, concurrency, rollback and runtime-integration evidence. It has **not**
been applied to Production.

Required authorized release sequence:

1. Confirm backup/PITR and record a read-only preflight snapshot.
2. Apply 20261116205555_atomic_membership_and_managed_approval.sql to Production
   in a controlled migration window.
3. Verify the trigger, function definitions and service/browser role grants.
4. Merge/deploy the exact reviewed application head and smoke direct join plus
   one managed approval with synthetic authorized actors.
5. If the migration fails, do not deploy the runtime. If the runtime deployment
   fails after migration, leave the additive database objects in place and roll
   back only the application; do not delete financial or membership history.

No merge, main modification, Production migration, Production write or
Production deployment occurred during this task.

## Remaining non-blocking findings

- The inherited newProjectForm.test.ts browser timeout remains P2/test-harness
  debt and is reported separately above.
- Production's duplicate pending-join unique indexes and existing Supabase
  advisor findings were not changed because they are outside this focused PR.
- GitHub Actions still use mutable action tags; supply-chain pinning remains a
  separate P2 hardening task.

Keep PR #40 Draft until exact-head CI/Vercel are green and the product owner
explicitly authorizes the migration-first release window.
