# Browser test environments

The test:e2e npm script starts the real Next.js development server and a small local HTTP stub that returns an unauthenticated, empty project list. The smoke suite therefore exercises the rendered application and real Chromium interactions without reading from or writing to Production Supabase.

## Authenticated Date Finder coverage

Authenticated Date Finder tests require a real isolated Supabase environment because they must verify client behavior, server actions, database constraints, and authorization together. The repository currently has migrations but no local Supabase configuration, isolated project credentials, or test accounts.

Before adding mutating Date Finder tests:

1. Provision a dedicated disposable Supabase project or checked-in local Supabase configuration and apply the repository migrations in order.
2. Create separate organizer and participant test accounts plus deterministic project fixtures.
3. Keep service-role credentials in test setup only; never expose them to the browser bundle, traces, screenshots, logs, or artifacts.
4. Require E2E_ISOLATED_DATABASE=1 and reject the known Production Supabase URL before setup, mutation, or cleanup.
5. Create and remove fixtures through setup/teardown code, then exercise Date Finder through accessible browser controls.
6. Cover deadline boundaries, duration recalculation, invalid preserved selections, submission blocking, participant limits, and organizer/member authorization.

Until that isolated environment exists, authenticated Date Finder mutation tests remain intentionally out of the automated suite.
