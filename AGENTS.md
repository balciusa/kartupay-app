# KartuPay development workflow

## Product and code map
- KartuPay coordinates group projects and events: participants, date selection, shared costs and payments, extras, transport, and notifications.
- This is a TypeScript Next.js App Router app (Next 16, React 19). Routes and server actions live in `src/app`; UI lives in `src/components`; shared business rules and Node tests live in `src/lib`.
- Styling uses Tailwind CSS 4 and the existing component patterns. Supabase provides Auth and Postgres; `src/lib/supabaseServer.ts` uses the user session and `src/lib/supabaseAdmin.ts` uses a server-only service role. SQL migrations live in `supabase/migrations`.
- Prefer existing helpers, naming, and English/Lithuanian strings. Inspect nearby code and tests before changing behavior. The root README is scaffold text; use the current code and `package.json` as the source of truth for paths and commands.

## Product invariants
- Revalidate dependent fields immediately when an upstream input changes. Automatically recalculate deterministic values; preserve invalid user selections, show immediate inline validation, and block invalid submission. Never silently delete, reset, or replace ambiguous user selections.
- Date Finder supports fixed dates and Choose Together selection. Keep candidate dates, votes, deadlines, finalization, and participant confirmations consistent; only authorized roles may mutate each stage.
- A new project's event duration is one whole number of nights from 0 through 365. For duration-backed date options, users select start dates; derive ends from the project duration using UTC calendar days. Zero nights means same day and a null option end. Do not derive night counts from timezone-adjusted display timestamps.
- Preserve legacy projects with `event_duration_nights = NULL` and their existing date-range semantics. Once a project has date-option history, do not change its duration or reinterpret existing votes. Date Finder controls the final date for selecting projects; settings must not override it.
- Check both client behavior and server validation for changes to these rules. Keep the database constraints and triggers aligned.

## Security and authorization
- Private projects must stay out of public discovery. Private invitation links do not grant membership: join requests require organizer approval; finance collector privileges alone cannot approve them. Former members must request access again. Recheck capacity and authorization at approval. Check the authenticated user's current project membership and role on every protected server read and mutation; scope data to the project and use the least privilege required.
- The Supabase service-role client bypasses RLS. Any code using it must make explicit authorization checks before reading or writing user or project data. Review RLS and SQL functions for cross-project access and role escalation. Keep service-role keys, tokens, and sensitive data out of client bundles, logs, fixtures, and PRs.
- Treat authentication, authorization, finances, RLS, migrations, and sensitive data as HIGH risk even for a small diff.

## Git and validation
- Inspect the original checkout's status before work. It may contain uncommitted changes: never stash, reset, clean, or modify it. Use a separate worktree or clone from the intended base and a focused `codex/` branch. Do not copy uncommitted files or local secrets into it.
- Classify each task by its highest-risk touched behavior; that level sets the minimum validation. Record exact commands, results, and any omitted checks in the PR.

| Risk | Changes | Minimum validation |
| --- | --- | --- |
| LOW | Copy, styling, isolated UI, documentation | Focused checks or tests for touched behavior; visual/browser check when UI changes. |
| MEDIUM | Business logic, forms, workflows | Relevant regression tests, `npm run lint`, `npm run build`, and browser checks for affected flows. |
| HIGH | Auth, authorization, finances, RLS, database migrations, sensitive data | Security and data-integrity review; comprehensive relevant regression tests plus `npm test`, `npm run lint`, `npm run build`; test role boundaries and migration compatibility. Require a migration deployment gate. |

- The repository uses npm and has `npm test` (Node's test runner with TypeScript transform), `npm run lint`, and `npm run build` scripts. Use the script definitions in `package.json`; do not claim a check ran unless it did. For documentation-only changes, validate the diff and instructions; mark runtime tests, build, and browser checks N/A with a reason.
- Fix P1/P2 findings before asking for review, or state each unresolved finding and its impact. Keep the PR focused and reviewable.

## Database and deployment gates
- Review migration order, existing data, constraints, RLS, privileges, and backward compatibility. Prefer additive schema changes before dependent application code when appropriate; plan rollback or recovery and test against a representative database.
- Never automatically deploy production migrations. Record whether a migration is required, its reviewed deployment order, and whether it was actually deployed. Do not repair divergent migration history without explicit product owner approval.
- For a PR with a Vercel preview, verify the deployment belongs to the PR's exact head SHA before using its result as evidence; record preview status and relevant smoke checks. After an approved merge, verify the Production deployment and core affected flow against the merged SHA.
- Never automatically merge. No merge, including auto-merge, without explicit product owner approval. A green check or preview does not grant approval.

## PRs and short reports
- Open a focused PR with purpose, risk level, changed files, validation evidence, P1/P2 status, browser result, Vercel head SHA/status, and migration/deployment state. Put detailed evidence in the PR description, CI logs, or repository artifacts; avoid repeating it in chat.
- Default Codex report (one short line per field; use N/A or BLOCKED where applicable):

```text
TASK:
STATUS:
PR:
HEAD:
TESTS:
BUILD:
VERCEL:
DB MIGRATION:
DB DEPLOYED:
P1/P2:
BROWSER TEST:
BLOCKERS:
```
