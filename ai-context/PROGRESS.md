# Progress
# Health Tracker

**Last updated**: 2026-07-20

---

## Current Status: Phase 1 (Foundation) checkpoint complete and green — qa-reviewer verdict was "ready to approve on the merits"; the two trivial test-harness bugs it found are now fixed. Awaiting Jeff's approval of the checkpoint before Phase 2 (Data model + RLS) starts.

---

## Completed
- [x] Repo scaffolded from the AI-agent-workflow template (AGENTS.md, agent-roles/, .claude/agents/ adapters, CI skeleton).
- [x] `AGENTS.md` fully filled in (was still templated): project summary, Jeff's dev-background
  bridging notes, real tech stack/repo-structure/run commands matching the design doc, and
  project-specific Conventions / Absolute Rules / What Not To Do.
- [x] Design doc drafted and iterated for the first feature: `docs/architecture/food-weight-tracker.md`
  (Status: Draft). Covers: multi-user auth + RLS, food/weight/body-fat data model, UTC timestamp +
  per-entry timezone handling for local-day grouping, a cap preventing any entry (food, meal-batch,
  or weight/body-fat) from being dated later than the current local day, kg/lb unit preference,
  minimal goals, trend charts with gap handling, barcode + description food lookup (Open Food Facts
  + USDA FoodData Central via a server-side proxy), saved meals (reusable food combinations,
  batch-logged into independent food_entries rows), quantity/unit tracking with DB-generated entry
  totals, an ease-of-entry pass (shared copy/repeat-entries action, a progressively-disclosed fast
  entry form, persistent login, and an installable PWA-lite shell with no offline support), a
  derived "% of calories from protein" metric (per-entry/per-day/per-meal-group, ratio-of-sums for
  rollups), and exact-`consumed_at`-match meal grouping (`lib/domain/entry-grouping.ts`, replacing
  the earlier 90-minute gap heuristic) with a smart date/time default so items logged in one
  sitting auto-share a timestamp. Full reasoning for every decision is in `ai-context/DECISIONS.md`
  and in the doc's own §4 "Alternatives Considered".
- [x] Architect subagent (`.claude/agents/architect.md`) granted `Edit` in addition to
  `Read, Write, Grep, Glob` — not yet exercised by the running architect session (spawned before
  the change), which has been doing full-file rewrites via `Write`. Will apply to future spawns.
- [x] Design doc gained §8 "Implementation Plan (phased)": 9 phases in dependency order
  (Foundation → Data model+RLS → core food logging loop → weight/goals → charts → food lookup →
  saved meals → ease-of-entry extras → PWA shell), each phase scoped In/Out and mapped to the §6
  test rows qa-reviewer runs at that checkpoint. Only 1→2→3 and 6→7 are hard dependencies; phases
  4–8 can be resequenced by priority if wanted. Per-phase loop: developer implements + unit tests →
  qa-reviewer writes/runs that phase's acceptance tests → Jeff reviews and approves → next phase
  starts. The doc-approval gate (below) still applies before Phase 1 begins — phasing is
  implementation sequencing, not a substitute for it.
- [x] **Phase 1 (Foundation) implemented** (developer). Next.js 16 App Router scaffold
  (TypeScript strict, Tailwind v4, `src/` layout matching the design doc's §3.1 tree); Supabase
  client factories (`src/lib/supabase/{client,server,middleware,env}.ts`, `@supabase/ssr`,
  `persistSession`/`autoRefreshToken`); `src/middleware.ts` (session-cookie refresh only, no route
  gating there); email/password auth via Server Actions (`src/lib/actions/auth.ts`: `signIn`,
  `signUp`, `signOut`) + `(auth)/login` and `(auth)/signup` pages with client `LoginForm`/
  `SignupForm` (`useActionState`); `auth/callback/route.ts` (code exchange for Supabase's built-in
  email-confirmation flow); `(app)/layout.tsx` single auth gate (redirect to `/login` when no
  session) + nav with a "Log out" control; placeholder `(app)/page.tsx` dashboard (Phase 1 is
  explicitly no-tracking-features). Pure validation logic split into
  `src/lib/domain/auth-validation.ts` (email/password/confirm-password rules, the primary
  unit-test target per convention). `npm run dev/build/lint/test/test:e2e` all added and working;
  `test` runs Vitest, `test:e2e` runs Playwright (both newly chosen for this repo — see Decisions).
  Local Supabase CLI wired via `npx supabase init` (`supabase/config.toml`, empty
  `supabase/migrations/` + `supabase/seed.sql` placeholders for Phase 2, `enable_confirmations`
  turned on to mirror the hosted default). `.env.example` documents every required var. An
  admin-API auto-confirmed test-user helper (`e2e/helpers/{admin-client,test-users}.ts`) and a
  Playwright auth spec (`e2e/auth.spec.ts`) are established per the doc's Phase 1 §6 scope, for
  qa-reviewer to run and extend — **not executed by the developer** (no Docker in the dev sandbox,
  so no local Supabase instance to run against; see Notes below for full verification status).
- [x] **CI/Supabase gap resolved** (architect owns `.github/workflows/ci.yml`). CI now stands up an
  **ephemeral local Supabase stack inside the job** (`supabase/setup-cli` + `supabase start` against
  the committed `supabase/config.toml`) and captures its fixed local API URL / anon key /
  service-role key at runtime via `supabase status -o env --override-name …` → `$GITHUB_ENV` as
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. The
  `build`, the Playwright-launched Next server, and `test:e2e` (incl. the service-role
  `e2e/helpers/admin-client.ts` helper) now all have a working backend. Playwright browser install
  added. `USDA_FDC_API_KEY` no longer referenced as a hard requirement — a `'ci-dummy-usda-key'`
  fallback keeps it defined (CI mocks lookup providers). Net effect: **no GitHub Actions secrets are
  required for CI to go green, and no hosted Supabase project is needed for CI.** Decision recorded
  in `ai-context/DECISIONS.md` ("CI runs an ephemeral local Supabase instance …").

## Up Next
1. **Jeff reviews and approves the Phase 1 checkpoint** — the only remaining gate before Phase 2
   starts. qa-reviewer's independent acceptance suite (`e2e/phase1-acceptance.spec.ts`, 12 tests —
   auth gating, persistent login across reload/new context, unconfirmed-user login correctly
   blocked, auth-callback failure path) plus the developer's `e2e/auth.spec.ts` (6 tests) are both
   green: 18/18 e2e, 36/36 unit, lint/typecheck/build all clean, run for real against a local
   Supabase instance. Absolute Rules adversarial check came back clean (service-role key confirmed
   absent from client bundles; auth gate uses non-spoofable `getUser()`). One non-blocking
   hardening note for whenever it's convenient: `src/app/auth/callback/route.ts`'s `next` redirect
   param isn't validated against open-redirect yet (not exploitable today, but should get a
   `next.startsWith("/")` check before it carries real values).
2. **Manual setup Jeff needs — minimal, and already done as of this checkpoint:** Docker Desktop +
   `supabase start` running locally, `.env.local` populated, `git init` + push to a GitHub remote —
   all confirmed done. No GitHub Actions secrets are needed for CI (ephemeral local Supabase stack
   per job); a hosted Supabase project is only needed later, for the real Vercel production deploy.
3. **Phase 2 (Data model + RLS)** starts once Phase 1 is approved — the highest-priority test
   surface (cross-user isolation on a greenfield multi-user app), deliberately isolated before any
   feature UI is built on top of it. Phase 2's migrations will run in CI via the ephemeral Supabase
   step, so RLS/constraint acceptance tests execute on every PR.
4. Phases 3–9 follow per §8's dependency order (only 1→2→3 and 6→7 are hard dependencies; 4–8
   can be resequenced by priority later if wanted).

## Notes / Things Discovered
- 2026-07-19: `AGENTS.md`, `ai-context/PROGRESS.md`, and `ai-context/DECISIONS.md` were still
  unfilled template placeholders when this feature work started (except the "Health Tracker"
  project title and Jeff's dev-background note, already set). `AGENTS.md` has since been fully
  filled in (see Completed above) — no longer templated.
- 2026-07-19: The design doc went through many rounds of revision in one session (units, chart
  gaps, email confirmation, per-entry date/time, UTC storage override, food lookup, saved meals).
  Each revision resumed the same architect subagent session rather than respawning, so it kept
  full context of prior decisions — respawning a fresh architect for a follow-up change on this
  same doc would lose that thread and should be avoided unless the old session is truly stale.
- 2026-07-20: Replaced the 90-minute gap-heuristic entry clustering with exact-`consumed_at`-match
  grouping, after Jeff pointed out the heuristic breaks down for frequent grazing (e.g. eating
  every 30 minutes for 3 hours has no natural 90-minute boundary). The earlier clustering decision
  in `ai-context/DECISIONS.md` is marked Superseded (partial) rather than deleted — the shared
  `copyFoodEntries` primitive and presentation-only (not stored) stance both still hold, only the
  grouping rule itself changed.
- 2026-07-20: Phase 1 implemented in a sandbox with no Docker and no `git` repo yet. Consequences:
  (a) `create-next-app` refuses to scaffold into a non-empty directory and also auto-inits a git
  repo — worked around by scaffolding into a scratch temp dir and copying only the generated
  app files (not `.git`, not its own `AGENTS.md`/`README.md`) into this repo, so the existing
  template files were preserved and no `.git` was created without being asked. (b) No Docker
  means `supabase start` could not actually be run or verified here — `supabase/config.toml` was
  generated via `npx supabase init` and hand-adjusted (`enable_confirmations = true`), but is
  unverified until someone with Docker runs `supabase start` against it. (c) The Playwright e2e
  spec + admin-API test-user helper were written and type-check/lint clean and Playwright itself
  lists the 6 tests correctly, but none were executed (no local Supabase, no dev server target) —
  qa-reviewer's Phase 1 checkpoint is the first real run of that suite.
- 2026-07-20: Scaffolded on Next.js **16.2.10** (the current `create-next-app@latest`), not 14 —
  satisfies the design doc's "14+" floor. Next 16 deprecates the `middleware.ts` file convention
  in favor of `proxy.ts` (same behavior, new name/location convention) and defaults `next build`
  to Turbopack; both are noted in build output. Kept `middleware.ts` since that's the literal name
  the design doc's §3.1 module tree specifies and it still works (deprecation warning only, not an
  error) — flagging here in case the architect wants to update the doc for the renamed convention
  before it's actually removed in a future Next major version.
- 2026-07-20: Test frameworks were not specified by the design doc or AGENTS.md, so the developer
  chose Vitest (`npm test`, unit tests, jsdom environment) and Playwright (`npm run test:e2e`,
  acceptance/integration) as the conventional current choices for a Next.js/TypeScript stack —
  flagging as a new implicit decision for the record (see DECISIONS.md).
- 2026-07-20: **CI/Supabase gap (was Up Next item 3) resolved by the architect** — `ci.yml` now runs
  an ephemeral local Supabase instance in-job rather than expecting a hosted project + GitHub
  secrets. Chose the ephemeral approach over a hosted CI-dedicated project because it needs zero
  secrets, zero pre-flight setup from Jeff, and mirrors local dev exactly (Supabase's documented CI
  pattern); full reasoning + the rejected hosted alternative are in `ai-context/DECISIONS.md`. Two
  implementation notes for whoever runs it first: (a) the workflow relies on
  `supabase status -o env --override-name api.url=… auth.anon_key=… auth.service_role_key=…`, which
  is the current CLI syntax — if a future CLI renames those keys the override-names must follow; and
  (b) `test:e2e` assumes Playwright's `webServer` inherits the exported `$GITHUB_ENV` values (it runs
  in the same job, so it does) — the developer's `playwright.config.ts` webServer should not hardcode
  a different Supabase URL.

---
