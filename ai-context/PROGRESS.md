# Progress
# Health Tracker

**Last updated**: 2026-07-22

---

## Current Status: Phase 4 (weight/body-fat logging + goals/settings) qa-reviewed and fixed up, ready for Jeff's approval (2026-07-22). Phase 5 (trend charts) starting next.

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
- [x] **Phase 2 (Data model + RLS) implemented** (developer), DB-only per scope (no UI/actions).
  One FK-ordered migration (`supabase/migrations/20260721000000_food_weight_tracker_schema.sql`):
  all five tables (`meals`, `meal_items`, `food_entries`, `daily_metrics`, `user_goals`) +
  `daily_food_totals` view (`security_invoker = true`); four-policy RLS (`user_id = (select
  auth.uid())`) on every table; `set_consumed_local_date` + `updated_at` triggers; STORED generated
  `calories`/`protein_g` columns; `food_entries_not_future_day` / `daily_metrics_not_future_day`
  CHECK constraints; composite `(meal_id, user_id)` FK on `meal_items` for cross-user integrity;
  `weight_unit` enum CHECK; explicit `GRANT`s to `authenticated`/`service_role` (needed because
  `auto_expose_new_tables` is off). `supabase/seed.sql` replaced with two real confirmed users
  (alice/bob) and fixtures across all five tables. Developer added `e2e/db-schema.spec.ts` (29
  tests) + `e2e/helpers/user-client.ts`. Three deviations from the literal doc text, all reviewed
  and accepted by qa-reviewer: `meal_items.sort_order` added early (Phase 7 needs it), RLS policies
  wrap `auth.uid()` as `(select auth.uid())` (Postgres perf pattern, `db advisors`-flagged), and
  "the unit enum" in the Phase 2 scope text resolved as `user_goals.weight_unit` (not
  `food_entries.unit`, which stays free-text per §3.2). Docker/Supabase CLI were available in this
  sandbox (unlike Phase 1) — migration + seed were actually run via `supabase db reset`, not just
  believed correct.
- [x] **Phase 2 qa-reviewed** (qa-reviewer). Independent acceptance suite written from the design
  doc's spec (not from the developer's test file), `e2e/phase2-acceptance.spec.ts`, 23 tests —
  green. Full suite from a clean `supabase db reset`: unit 47/47, e2e 70/70 (23 new + developer's
  29 + 18 Phase 1), typecheck/lint/build clean, `supabase db lint`/`db advisors --local` clean.
  Verified directly (not trusted from the migration source): RLS actually enabled
  (`relrowsecurity = true`) on all five tables with exactly four correctly-keyed policies each;
  `anon` role has no SELECT/INSERT/UPDATE/DELETE grants (Data API can't reach the tables
  unauthenticated); generated columns are truly STORED and un-settable; cross-user `meal_item`
  forgery rejected on both the FK path and the RLS `WITH CHECK` path; `consumed_local_date` trigger
  correct near-midnight and across travelling timezones; service-role key confirmed absent from
  `src/` and from the built `.next` output. **Verdict: ready to gate to production, no blocking
  findings.** One informational (non-blocking) finding for later: `food_entries.logged_from_meal_id`
  is a plain FK to `meals(id)` with no per-user ownership constraint (matches the design doc exactly
  — only `meal_items` gets the composite `(meal_id, user_id)` FK — and RLS still prevents any actual
  data leak), but Phase 7's `logMealForDay` must only ever populate it from the acting user's own
  meals; the architect may want to consider a composite ownership FK for defense-in-depth when
  Phase 7 is designed.
- [x] **`logged_from_meal_id` FK question resolved** (architect, at Jeff's request). Verdict: keep
  the plain single-column `FK → meals(id) ON DELETE SET NULL` as-is — **no migration change**. RLS
  on `food_entries` keys only off `food_entries.user_id` (never off `logged_from_meal_id`), so a
  stray cross-user reference just resolves to null/inaccessible on read, never to another user's
  data — the same acceptable state as any `ON DELETE SET NULL` reference. `meal_items`' composite
  `(meal_id, user_id)` FK doesn't transfer: that column is a *denormalized owner RLS itself trusts*
  on a *compositional* child row (`ON DELETE CASCADE`), which must stay in lockstep with the parent;
  `logged_from_meal_id` is an independent aggregate's weak back-reference, and forcing a composite FK
  there would fight the required "delete a meal, keep the logged history" semantics (Postgres'
  default composite `ON DELETE SET NULL` would null the row's own NOT NULL `user_id` too, requiring
  the less-common column-list SET NULL variant just to defend an invariant RLS already makes
  non-load-bearing). The one real gap — nothing at the DB level stops a *direct* insert from writing
  a foreign meal id — is closed at the correct layer instead: design doc §8 Phase 7 now explicitly
  requires `logMealForDay` to populate `logged_from_meal_id` only from meals read via the RLS-scoped
  client (so a foreign id is structurally unreachable on the write path), plus a qa-reviewer test for
  it when Phase 7 is built. Full reasoning in `ai-context/DECISIONS.md`
  ("`logged_from_meal_id` stays a plain FK...", 2026-07-21); doc changes in
  `docs/architecture/food-weight-tracker.md` §3.2 ("Deliberate FK asymmetry") and §8 Phase 7.
- [x] **Phase 3 (Core food logging loop) implemented** (developer), against the approved Phase 2
  schema. Domain modules in `src/lib/domain/` (`nutrition`, `entry-grouping`, `quantity`, `totals`,
  `datetime` incl. `floorToQuarterHour`/`defaultConsumedAtForNextEntry`/tz-conversion helpers,
  `validation`), each with unit tests; server actions `src/lib/actions/food.ts`
  (`addFoodEntry`/`updateFoodEntry`/`deleteFoodEntry`, future-day guarded, `user_id` server-session-
  only); components `FoodEntryForm`/`FoodEntryList`/`DailyTotals`/`FoodDayView`/`TodaySummary`;
  `src/app/(app)/food/page.tsx`; dashboard today-summary + nav link. `e2e/food-logging.spec.ts` (11
  tests). Docker/Supabase available — run for real, not just believed correct: 116/116 unit,
  81/81 e2e, lint/typecheck/build clean. Four deviations, all reviewed and accepted by qa-reviewer:
  (1) `/food`/dashboard reads go through the RLS-scoped **browser** client rather than a Server
  Component fetch — "today" is a browser-timezone question and day-switching is client state anyway;
  confirmed still genuinely RLS-scoped, service-role key absent from client bundles; (2) one
  `react-hooks/set-state-in-effect` lint suppression for a standard fetch-on-dependency-change
  pattern; (3) edit mode always shows full quantity/unit detail rather than staying progressively
  disclosed (progressive disclosure is a new-entry speed aid; editing needs real values visible);
  (4) editing an entry preserves its originally-captured `consumed_tz` rather than recomputing from
  the current browser tz, so an unrelated edit can't silently shift `consumed_local_date` or split a
  travelling user's meal group — qa-reviewer built a Tokyo-entry/New-York-browser scenario and
  confirmed this holds.
- [x] **Phase 3 qa-reviewed** (qa-reviewer). Independent acceptance suite from the design doc's spec
  (not from the developer's test file), `e2e/phase3-acceptance.spec.ts`, 11 tests — green, targeting
  edges the developer's suite didn't: one-minute-apart entries NOT grouping (proves exact-match, not
  a window); an extreme 160%/2.2% ratio-of-sums case proving the naive average (81%) is never shown,
  only the calorie-weighted figure (18%); future-day rejection verified by a direct DB query
  confirming zero rows written (not just a UI-level check); off-grid `12:07` rejected **server-side**
  after bypassing the native time-input grid; cross-user read/update/delete isolation through the
  action surface (not just RLS in the abstract). Full suite from a clean `supabase db reset`: e2e
  92/92 (11 new + developer's 11 + 70 prior), lint/typecheck/build clean. Adversarial code review of
  `src/lib/actions/food.ts` confirmed: `user_id` never client-supplied (always from `getUser()`,
  update/delete additionally `.eq("user_id", user.id)` on top of RLS); future-day cap enforced
  server-side on both add and edit (not just client `max`); "today" derivation never uses server
  clock/naive UTC truncation, only the trigger-derived `consumed_local_date` and per-entry `tz`;
  `calories`/`protein_g` are only ever the DB's generated columns, never computed/duplicated in app
  code; service-role key confirmed absent from `.next/static` bundles. **Verdict: ready to gate to
  production, no blocking findings.** Two non-blocking notes: (a) `FoodDayView.tsx`'s day-switch
  fetch has no stale-response guard (unlike `TodaySummary.tsx`, which correctly uses one) — rapid
  day-switching could briefly render the wrong day's entries, self-corrects on next fetch, no data
  risk; (b) `quantity.ts`'s `lineTotal` helper is unused by app code (only its own unit test), noting
  for awareness, not a defect. **Environment caveat (pre-existing, not a Phase 3 issue):** `npm test`
  fails to start under Node 24 (`@vitejs/plugin-react@6`/`vite@8`/`vitest@4` throw at load) — CI pins
  Node 20 where it's fine, and all 116 unit assertions were confirmed passing once the plugin issue
  was bypassed, but the repo has no `engines`/`.nvmrc` pin, so a contributor on Node 22+/24 gets a
  false-red `npm test` locally. Recommend a trivial follow-up (Node version pin or toolchain bump).
- [x] **Node version pin added** (trivial, no design surface — done directly, no subagent needed).
  `.nvmrc` (`20`) and `"engines": { "node": "20.x" }` in `package.json`, matching CI's
  `actions/setup-node` pin exactly. Advisory only (no `engine-strict`), so it steers nvm/fnm/Volta
  and warns on mismatch without hard-blocking `npm install` on another Node version. Note: could not
  reproduce qa-reviewer's reported crash on this sandbox (Windows, Node 24.18.0) — `npm test` passed
  116/116 cleanly with the currently-installed `vite@8.1.5`/`vitest@4.1.10`/`@vitejs/plugin-react@6.0.3`
  before this change too, so the failure may be platform- or exact-patch-version-specific (qa's
  sandbox was likely Linux). The pin is still the correct standard fix regardless.
- [x] **Phase 4 (Weight/body-fat logging + goals/settings) implemented** (developer), against the
  approved Phase 2 schema. New pure domain module `src/lib/domain/units.ts` (kg↔lb conversion,
  storage/display edge functions `weightToKg`/`weightForDisplay`, `formatWeight`; storage stays
  canonical kg regardless of preference, per the existing decision) with unit tests focused on
  round-trip correctness; `validateDailyMetricInput`/`validateGoalsInput` added to
  `src/lib/domain/validation.ts`. Server actions `src/lib/actions/metrics.ts`
  (`upsertDailyMetric`/`deleteDailyMetric`, `metricTz`-based future-day rejection) and
  `src/lib/actions/goals.ts` (`getGoals` ensure-row, `updateGoals`). Components
  `src/components/metrics/MetricForm.tsx` (day-picker + weight/body-fat entry, no time field) and
  `src/components/settings/SettingsForm.tsx` (goal targets + kg/lb toggle); `metrics/page.tsx` and
  `settings/page.tsx`; nav links added. 151/151 unit tests, lint/typecheck/build clean at handoff
  (Docker/Supabase not available in the developer's sandbox this round, so the DB-backed action
  paths were unexercised until qa-reviewer's run — see below).
- [x] **Phase 4 qa-reviewed** (qa-reviewer), then two follow-up fixes applied directly (trivial,
  no design surface). Independent acceptance suite from the design doc's spec,
  `e2e/phase4-acceptance.spec.ts`, 10 tests — metrics upsert (one row/day, weight-only leaves body
  fat null, re-save overwrites not duplicates), unit-preference end-to-end (lb stored as kg,
  survives a unit-toggle switch unchanged), goals CRUD (ensure-row default, round-trip, still one
  row after repeated saves), no-future metric date (tomorrow rejected server-side with zero rows
  written even though the loose DB CHECK would allow it; a legitimate UTC+14 "today" NOT falsely
  rejected), and cross-user isolation on both `daily_metrics` and `user_goals`. **Verdict: ready to
  gate to production, no blocking findings** — two non-blocking notes were raised and then actually
  fixed rather than just logged:
  1. `getGoals()`'s original select-then-insert ensure-row was non-atomic and could surface a
     transient "couldn't load settings" error under concurrent first-visit requests (two tabs,
     route prefetch racing a real navigation). Fixed by switching to a single `upsert(...).select().single()`
     call — idempotent on conflict, and returns the row directly from the same call.
  2. That fix's first attempt (upsert, then a *separate* re-`select` to read the row back) still
     intermittently failed — traced to **Next.js App Router's fetch Request Memoization**: the
     re-select had the exact same query shape as the earlier "does a row exist yet" check earlier in
     the same Server Component render, so Next.js deduped it and served the stale pre-insert (empty)
     result instead of re-hitting Postgres. Fixed for real by reading the row back from the upsert's
     own `.select()` response instead of issuing a second identical query — see the new Notes entry
     below, this is a repo-wide gotcha, not just a `goals.ts` bug.
  3. `MetricForm.tsx`'s date/tz were computed from `browserTimeZone()` during render, which SSRs
     under the server's tz (UTC) and can hydration-mismatch against the client's real tz whenever
     they disagree (routinely near a user's local midnight, always for far-UTC-offset users). Fixed
     by resolving tz/today in a mount-only Effect and rendering an identical "Loading..." placeholder
     on both the server pass and the client's first pass until then.
  Full suite re-verified after both fixes on a clean `supabase db reset`: unit 151/151, e2e 102/102
  (10 new + 92 prior), lint/typecheck/build clean.
- [x] **Phase 4 manually driven in a real browser** (Playwright script against the live dev server +
  local Supabase, not just the automated suite) — logged in, logged a weight+body-fat entry on
  `/metrics`, set calorie/protein targets and toggled kg→lb on `/settings`, confirmed `/metrics` then
  displayed the same weight correctly converted to lb, zero browser console errors throughout. This
  caught a **real bug the test suite didn't**: right after a successful Settings save, the "Weight
  unit" radio visibly snapped back to its pre-save selection (kg) even though the save itself was
  correct (a reload showed lb correctly) — because React's form Actions reset the native `<form>`
  once the action settles, desyncing the *controlled* radio's visible `checked` state from React's
  own state. Fixed in `SettingsForm.tsx` by splitting into an outer component (owns `useActionState`)
  and an inner `SettingsFields` keyed on the latest known-good row's `updated_at`, so a successful
  save remounts the fields fresh from the just-saved data instead of fighting the native reset — the
  same "reset state via key" pattern `MetricForm` already used for day-switching. Re-verified with a
  targeted before/after/reload Playwright script (`kg checked`/`lb checked` at each step) and the
  full suite again after the fix: unit 151/151, e2e 102/102 (one unrelated Phase 3 test —
  floor-of-now clock-boundary timing — flaked once in the full run and passed clean in isolation, a
  pre-existing flake unrelated to this change) still green.

## Up Next
1. **Phase 5 (Trend charts)** — per design doc §8 Phase 5. Goes to the developer next;
   qa-reviewer gates it afterward per the usual per-phase loop.
2. Phases 6–9 follow per §8's dependency order (only 1→2→3 and 6→7 are hard dependencies; 4–8
   can be resequenced by priority if wanted — 4 is now done).
3. **Follow-up (not scoped to any phase, low priority): no client-fetch timeout/fallback on
   `/food` or `/metrics`.** If a browser-side Supabase read (`FoodDayView`, `MetricForm`) ever
   genuinely hangs — a stuck keep-alive connection, a Docker/network hiccup — the page just shows
   "Loading..." forever with no timeout, no error, and no "this is taking a while, try refreshing"
   fallback. Found while investigating a real Jeff-reported case of `/food` stuck on "Loading..."
   with a save that appeared to do nothing (2026-07-22) — see the Notes entry below for what was
   ruled out. Not urgent (the underlying cause in that case was environmental, not a code bug),
   but worth a small UX hardening pass whenever a phase touches these components again.

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
- 2026-07-22: **Next.js fetch Request Memoization can silently serve a stale Supabase read inside a
  single Server Component render.** Discovered fixing `getGoals()`'s ensure-row race (Phase 4): a
  `select` issued *before* an insert, and a second, differently-motivated `select` with the exact
  same table/filter shape issued *after* the insert in the same render, got deduped by Next's
  App Router fetch patch — the second call returned the first call's (pre-insert, empty) cached
  result rather than re-querying Postgres, even though the insert had already committed
  (confirmed via direct debug logging: the insert returned `201 Created`, an unfiltered `select *`
  right after saw the new row, but the identically-shaped filtered re-select did not). This is a
  general trap for **any Server Component (not just Server Actions/Route Handlers) that reads,
  writes, then re-reads within one render** — the fix is to read the row back from the mutating
  call's own response (e.g. Supabase's `.upsert(...).select().single()`) rather than issuing a
  second, separately-shaped `select`. Worth checking for this pattern if a future phase's
  ensure-row/read-modify-read logic (e.g. any Phase 5+ "get-or-create" flow) behaves inconsistently
  only in Server Components and not in direct script/API testing.
- 2026-07-22: **Jeff hit `/food` stuck permanently on "Loading...", with saves appearing to do
  nothing** — investigated live rather than left unexplained. Console showed only a benign
  `webpack-hmr` WebSocket failure (harmless — only affects hot-reload, not data requests); Network
  tab showed the request to `127.0.0.1:54321` stuck as **pending forever**, never erroring. A
  scripted repro of the same flow (fresh user, fresh browser) against the same dev server worked
  correctly end-to-end, so the app's save path itself was not broken. Jeff's own fix was opening a
  new tab and logging in fresh, which immediately worked — raising the question of whether the old
  tab's session had gone stale/logged-out without the app detecting it. Tested that directly with
  two scripted reproductions and **ruled it out**: (a) patching a session's access token to already-
  expired and forcing the refresh network call to hang forever still loaded `/food` correctly,
  because `middleware.ts` transparently refreshes the session **server-side on every navigation**,
  before any client-side code runs — the client-side browser Supabase client never needed its own
  refresh in this flow; (b) deleting the session's user server-side (Supabase admin API) while the
  browser still held its cookie, then navigating to `/food`, correctly **redirected to `/login`**,
  no hang. So neither realistic version of "session went stale" reproduces a hang — the app already
  handles both gracefully. The likely actual cause was environmental: a stale/wedged low-level
  browser connection to the local Docker container in that one long-open tab, plausibly related to
  how many times Supabase/the dev server were restarted during the same testing session — not an
  application bug. The one real, generally-applicable gap surfaced by this investigation (not fixed,
  logged as a follow-up in Up Next above): **no client-fetch timeout or "taking a while" fallback**
  anywhere a browser-side Supabase read is used (`FoodDayView`, `MetricForm`) — if a request ever
  does genuinely hang for any reason, the user has zero feedback beyond an indefinite "Loading...".

---
