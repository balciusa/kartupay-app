# RLS lockdown security review

Risk: **HIGH / P0 security remediation**

Production project inspected read-only: `cqklvbwmaocztrfwqeig`

Production changes performed during development: **none**

## Confirmed Production exposure

The pre-migration Production catalog has broad table grants for `anon` and
`authenticated`. RLS currently determines practical access, but several
permissive policies override the intended boundaries:

- `projects.proj_read`, `messages.msg_select`, `payment_options.payopt_read`,
  `payment_options.payopts_select`, and `payments.pay_select` use `using (true)`.
- `participants.participants_read_any` exposes all participant rows to every
  authenticated user.
- `participants.participants_insert_guard` checks only that the project is not
  canceled. It does not bind `user_id` to `auth.uid()`, constrain `role`, require
  approval, or enforce capacity.
- `payments.payments_insert_guard` checks only that the participant's project
  is not canceled. It does not authorize the payer, organizer, or collector.
- Direct participant updates can change authorization-bearing columns, and
  direct late-transfer/payment-signal updates are not column constrained.
- `payment_options_read_same_project` only verifies that the target participant
  exists, so any authenticated user can satisfy it.
- `users_select_display` and `users_select_minimal` expose every profile row to
  any authenticated user.
- `addons.addon_select` and `addon_votes.votes_select` expose project-specific
  add-on details and votes through `to public using (true)`. Production contains
  add-ons associated with private projects.
- `audit_logs` has RLS disabled and grants all table privileges, including
  `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`, to `anon` and `authenticated`.
  No application code, database function, or trigger currently reads or writes
  this table, so it is restricted to the service role.

The migration removes direct Data API writes from project authorization and
manual ledger tables. Existing checked server actions use `supabaseAdmin` and
retain service-role access.

## Authorization matrix after migration

| Actor | Projects | Participants, messages, profiles | Project payment data | Direct authorization/ledger writes |
| --- | --- | --- | --- | --- |
| Anonymous | Public projects only | Denied | Denied | Denied |
| Unrelated authenticated user | Public projects and private projects where they are an active member | Only their own profile and active co-participants | Only projects where they are active | Denied |
| Active member | Public projects plus their private projects | Their project rows/messages/co-participant profiles | Project destinations, confirmations, signals, extras, and late transfers | Denied; checked server actions remain available |
| Active organizer | Same read boundary as an active member; can read project join requests | Same as active member | Same as active member | Denied; organizer actions use the service role after authorization checks |
| Active collector | Same read boundary as an active member | Same as active member | Same as active member | Denied; collector actions use the service role after authorization checks |
| Former member | Public projects and own profile only | Private project access denied | Denied | Denied; must request access again |
| Service role | All rows | All rows | All rows | Preserved; server code must authorize before every operation |

Personal `user_payment_options` remain owner-readable and owner-writable for
compatibility. Project copies in `payment_options` are member-readable and
service-role writable. Legacy `addons` and `addon_votes` are active-member
readable and service-role writable. `audit_logs` is service-role-only.

## Application dependencies reviewed

- Public discovery in `src/app/page.tsx` uses the session client and continues
  to receive only `is_public = true` plus the current user's active projects.
- Private `/project/[id]` invitation pages still show the existing limited
  title/description/date/location preview. That first limited query now uses
  `supabaseAdmin`; related project data is not loaded until active membership is
  verified.
- Project creation, join requests, approval, participant changes, chat writes,
  payment destination cloning, payment confirmations, payment signals, late
  transfers, and extra payments already write through authorized server actions
  using the service role.
- Repository and Production dependency inspection found no reader or writer for
  `audit_logs` and no database trigger or function referencing it. The only
  `addons` writer is `addSampleAddon`, which now authenticates the caller and
  requires the active finance manager before using the service role.
- No application caller currently reads `addons` or reads/writes `addon_votes`.
  Public project discovery does not load these tables, so it does not require an
  anonymous add-on policy.
- Display-name updates use the session client. The migration keeps only
  `UPDATE (display_name)` for the authenticated user's own profile.
- `project_invites` remains service-role only. An invitation URL reveals the
  limited preview but does not grant membership.
- Approval actions recheck organizer status and capacity. Their existing
  count-then-write concurrency window is not changed by this focused migration.

## Policies replaced

| Table | Removed Production policies | New policies |
| --- | --- | --- |
| `projects` | `proj_read`, `proj_write`, `proj_update`, `projects_update_collector` | `projects_select_public`, `projects_select_active_members` |
| `participants` | `participants: self-update left_at`, `participants_insert_guard`, `participants_read_any`, `participants_select_own`, `participants_select_same_project` | `participants_select_active_project` |
| `messages` | `messages_insert`, `messages_read`, `messages_select`, `msg_insert`, `msg_select` | `messages_select_active_project` |
| `payment_options` | all six existing read/write policies | `payment_options_select_active_project` |
| `payments` | `pay_insert`, `pay_select`, `payments_insert_guard`, `payments_read_for_members` | `payments_select_active_project` |
| `payment_signals` | existing insert/select/update policies | `payment_signals_select_active_project` |
| `late_join_transfers` | existing sender/recipient update and member-read policies | `late_join_transfers_select_active_project` |
| `extra_payments` | `extra_payments_select_participants` | `extra_payments_select_active_project` |
| `addons` | `addon_insert`, `addon_select` | `addons_select_active_project` |
| `addon_votes` | `votes_insert`, `votes_select` | `addon_votes_select_active_project` |
| `audit_logs` | none; RLS was disabled | RLS enabled with no client policy |
| `join_requests` | ten duplicate/self/organizer policies | self-read and active-organizer-read policies |
| `users` | two global read and two own-update policies | own/co-participant read and own display-name update |
| `user_payment_options` | four owner policies scoped to `public` | four owner policies scoped to `authenticated` |

`anon` retains only `SELECT` on `projects`. `authenticated` retains the reads
listed in the matrix, including active-project `SELECT` on legacy add-ons, owner
CRUD on `user_payment_options`, and column-level `UPDATE (display_name)` on
`users`. Neither client role has any `audit_logs` privilege. Service-role grants
are unchanged.

## Isolated test evidence

Tests used Supabase CLI 2.120.0 and dedicated local Supabase Postgres
17.6.1.158 containers. One portable run used the committed minimal schema
fixture. A second run loaded a complete Production `public` schema export
without data, then inserted schema-valid synthetic rows. Both fixtures contain
only fixed UUIDs, `.invalid` email addresses, and synthetic project/payment
data.

Executed in order:

1. `supabase/tests/rls_lockdown_fixture.sql`
2. `supabase/migrations/20261011075702_rls_lockdown.sql`
3. `supabase/tests/rls_lockdown_authorization.sql`
4. `supabase/rollback/20261011075702_rls_lockdown.rollback.sql`
5. Reapply migration and rerun authorization tests

The matrix passed for anonymous, unrelated authenticated, member, organizer,
collector, former-member, and service-role contexts. Negative tests proved that
direct organizer escalation, counted-payment insert, transfer confirmation,
join approval, project update, payment update, add-on mutation, add-on voting,
and audit-log read/tampering are denied. Active members retained scoped add-on
reads and the service role retained add-on and audit-log reads and writes.

Public function, trigger, constraint, index, and column fingerprints were
unchanged. Rollback preserved all synthetic row counts, restored the exact
captured vulnerable policies/grants, and the forward migration and matrix passed
again after reapplication.

`supabase db lint --level warning` against the final clone completed and reported
one pre-existing `project_has_financial_activity` reference to the absent
`participant_refund_requests` table. The migration does not modify that public
function or any public function fingerprint; treat it as a separate reliability
follow-up rather than migration regression.

## Deployment gate

Deployment requires separate product-owner approval.

1. Record the PR exact head from `git rev-parse HEAD` in the release record and
   confirm GitHub E2E and Vercel Preview report that same SHA.
2. Confirm the migration history discrepancy is understood; do not rewrite or
   repair Production migration history as part of this deployment.
3. Export the current Production policy, grant, function, and migration-history
   catalogs and retain the timestamped output with the release record.
4. Confirm a restorable Supabase backup/PITR point and name the rollback owner.
5. Deploy the backward-compatible application change first. Verify public
   discovery, private invite preview, login, and an active private member view.
6. Apply `20261011075702_rls_lockdown.sql` in a maintenance window.
7. Verify policy names and grants match this document. Confirm `audit_logs` has
   RLS enabled, no `anon`/`authenticated` grants or policies, and service-role
   access. Confirm `addons` and `addon_votes` expose only their active-member
   `SELECT` policies and no client write privileges. Use read-only role tests to
   confirm anonymous/private and unrelated-user denial.
8. With disposable accounts, verify invite request, organizer approval,
   capacity rejection, chat, payment recipient display, participant paid signal,
   collector confirmation, former-member denial, and desktop/mobile navigation.
9. Verify service-role application logs contain no permission or recursion
   errors and exact-head Production Vercel remains healthy.
10. Declare the vulnerability fixed only after those Production checks pass.

## Rollback plan

The tested rollback is
`supabase/rollback/20261011075702_rls_lockdown.rollback.sql`.

It intentionally restores the vulnerable pre-migration policies and broad
grants, including public add-on reads/writes and client control of `audit_logs`,
and disables `audit_logs` RLS. Use it only for a confirmed outage, with explicit
product-owner and security approval, after capturing logs and current policy
state. The application changes are backward-compatible and do not need to be
rolled back. After emergency rollback, suspend the pilot until a forward fix is
verified and deployed.

## Remaining risks

- The shared private-project URL is an unexpired UUID link and exposes the
  deliberately limited invitation preview to anyone who possesses it. It does
  not grant membership.
- Join approval capacity checking still has a count-then-write concurrency
  window. Direct database bypass is removed, but atomic approval is separate.
- Future service-role actions must keep explicit caller authorization because
  the service role bypasses all RLS policies.
- Production migration history is divergent from repository filenames; this
  PR does not repair it.
