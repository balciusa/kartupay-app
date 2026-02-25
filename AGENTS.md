# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

KartuPay is a group expense-splitting web app built with **Next.js 16** (React 19) + **Supabase** (PostgreSQL + Auth). It is a single Next.js application — no monorepo, no separate backend services.

### Services

| Service | How to run | Port |
|---------|-----------|------|
| Next.js dev server | `npm run dev` | 3000 |
| Supabase (local) | `sudo env "PATH=$PATH" npx supabase start` | 54321 (API), 54322 (DB), 54323 (Studio) |

### Running the dev environment

1. **Docker must be running** before starting Supabase: `sudo dockerd &>/tmp/dockerd.log &`
2. **Start Supabase**: `sudo env "PATH=$PATH" npx supabase start` (from `/workspace`). The `sudo env "PATH=$PATH"` prefix is needed because Docker requires root and `npx` is installed via nvm under the `ubuntu` user.
3. **Start Next.js dev server**: `npm run dev` (runs on port 3000).
4. The `.env.local` file at `/workspace/.env.local` is pre-configured to point to the local Supabase instance. If it's missing, get credentials from `sudo env "PATH=$PATH" npx supabase status -o env`.

### Key caveats

- The `npm run dev` script uses Windows-style `set NEXT_FORCE_WEBPACK=1&&` which is benign on Linux (Turbopack is used instead of Webpack; this works fine).
- `next.config.ts` has `serverExternalPackages` under `experimental`, which is deprecated in Next.js 16. It produces a warning during `npm run dev` and a TypeScript error during `npm run build`. The dev server runs fine despite the warning.
- **`npm run build` fails** with a pre-existing TypeScript error in `next.config.ts`. This is not a setup issue — it's a code issue in the repo.
- The Supabase schema is defined in `supabase/migrations/20240101000000_init.sql` and applied automatically by `supabase start`.
- RLS policies must be set up for the app to work. After `supabase start`, run permissive policies in dev or configure per-table policies.

### Standard commands

- **Lint**: `npm run lint` — runs ESLint. Pre-existing lint errors exist (mostly `@typescript-eslint/no-explicit-any`).
- **Build**: `npm run build` — currently fails (see caveat above).
- **Dev**: `npm run dev` — Turbopack dev server on port 3000.

### Test user for local dev

Create via Supabase Auth admin API:
```
curl -X POST 'http://127.0.0.1:54321/auth/v1/admin/users' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'apikey: <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"testpass123","email_confirm":true}'
```
Get the service role key from `npx supabase status -o env` (the `SERVICE_ROLE_KEY` value).
