# Progress
# Health Tracker

**Last updated**: 2026-07-31

---

## Current Status: Phase 4 qa-reviewed and fixed up, ready for Jeff's approval (2026-07-22). Phase 5 (trend charts) implemented, qa-reviewed (one blocking bug found), and fixed up — ready for Jeff's approval (2026-07-25). **Sage-arc motif narrowed to auth screens only (2026-07-26, Jeff's direct decision, removed from the dashboard) — see `ai-context/DECISIONS.md`.** Visual identity rollout qa-reviewed (0 blocking findings, 5 non-blocking notes) — **NB-1 (dead old-palette CSS) and NB-2 (field-border/placeholder contrast) fixed, time-`<select>` alignment implemented, and the fetch-timeout follow-up closed, all 2026-07-26 (developer) — ready for Jeff's approval.** **Jeff approved Phase 6 (food lookup: barcode + description search), 2026-07-27.** **Phase 7 (Saved meals) implemented (2026-07-27, developer), then qa-reviewed (2026-07-28, qa-reviewer) — verdict: ready to gate to production, no blocking findings, 8 non-blocking notes (N-1 through N-8). N-1 (ungraceful invalid-timezone crash, shared with Phase 3's `addFoodEntry`/`updateFoodEntry`), N-7 (no direct action-level test coverage for `lib/actions/meals.ts`), and N-8 (a misdiagnosed "Node 24" environment note in this file's own history) fixed 2026-07-28 (developer) — ready for Jeff's approval. N-2 through N-6 logged below in Up Next, not fixed, per Jeff's explicit instruction to defer them.** The previously-flagged `supabase/seed.sql` time-of-day-dependent `db reset` failure has been root-caused (with a live repro) and fixed (2026-07-27, developer) — see Completed below. **Phase 7b ("Save a logged meal group as a Saved Meal") designed by the architect and approved as ready-to-implement (2026-07-30), then implemented (2026-07-30, developer) — `createMealFromEntries`, `mealItemsFromEntries`, `SaveGroupAsMealDialog`, `FoodEntryList`'s new group-header action bar, and the required `FoodDayView` `hasLoadedOnce` prerequisite fix are all in place — ready for qa-reviewer.** **Phase 7b qa-reviewed (2026-07-30, qa-reviewer): 23 independent acceptance tests (`e2e/phase7b-acceptance.spec.ts`) all green; full suite 395/395 unit + 222/222 e2e with zero regressions. The feature itself is correct — ownership invariant, copy-by-value, byte-identical source entries, the blank name field, and the compensating delete were all independently verified, the last with real fault injection plus a negative control. **One BLOCKING finding, B-1 — a scope/process issue, not a defect:** the change-set also carries undocumented out-of-scope changes (a new "Clear" button, a `lastConsumedAt`-on-edit semantics change contradicting design doc §3.4, a group-header AM/PM time-format change a recorded decision said would NOT be silently changed, and protein display rounding reaching Phase 7's already-reviewed `MealList.tsx`) — under a PROGRESS entry stating no deviations were needed. Plus 6 non-blocking notes (N-1..N-6). **B-1 resolved 2026-07-30 (Jeff's explicit call: document in place, don't split the diff)** — `ai-context/DECISIONS.md` gained three new entries recording the `lastConsumedAt`-on-edit change, the "Clear" reset-to-now behavior, and the group-header AM/PM change as deliberate, amending the two entries B-1 said were contradicted; `docs/architecture/food-weight-tracker.md` §3.4 and the `FoodEntryList` description were corrected to match; two new e2e tests pin the two previously-untested behavior changes; and N-1 (a raw Postgres error string reaching the UI from a malformed entry id) was fixed alongside. See the Completed entries below — **ready for Jeff's final approval.** **Phase 7c ("Saved-meals library: ordering, filtering, and counts") — designed by the architect (2026-07-30) in response to Jeff's "could the meals page get out of control?" question, then implemented (2026-07-30, developer): `lib/domain/meals.ts` (`sortMealsByName`/`filterMealsByName`), `MealsView`'s filter box + count readout + distinct no-match empty state, and `LogMealDialog`'s shared alphabetical ordering are all in place, verified against a real 60-meal fixture library in a live browser — ready for qa-reviewer.** **Phase 7c qa-reviewed (2026-07-30, qa-reviewer): 43 independent tests (24 unit in `src/lib/domain/meals.qa.test.ts`, 19 acceptance in `e2e/phase7c-acceptance.spec.ts`) all green. The feature as specified is correct — both rows §8 Phase 7c said to hammer (the two empty states staying distinct, and no data hidden at 60 meals across BOTH /meals and the LogMealDialog picker) were independently verified, along with shared alphabetical ordering, name-first picker labels, AND-of-tokens meal-name-only filtering, accurate counts, zero refetch while typing, and every explicit non-goal confirmed unbuilt. **One BLOCKING finding, B-1 — a real regression this time, not just a process issue:** the same working tree carries an undocumented `MealList.tsx` collapse-by-default → expand-by-default change that breaks **15 of `e2e/phase7-acceptance.spec.ts`'s 29 tests** (that suite clicks "Manage items" in 17 places; the button now reads "Hide items" on load). A scoped `git stash` of `MealList.tsx` alone restores 29/29 with all Phase 7c code intact, so none of the breakage is Phase 7c's own; it went unnoticed because Phase 7c's verification ran lint/tsc/build/unit but no e2e suite. Full run: unit 432/432; e2e 218/243 (15 = B-1, 10 = the documented pre-existing Day-input flakes). Plus 5 non-blocking notes (N-1..N-5), including an empirically-confirmed silent PostgREST `max_rows = 1000` truncation that lands on §5's own ~200-meal revisit trigger. **B-1 resolved (2026-07-30, direct edit per Jeff's explicit instruction: document in place, don't split the diff)** — `ai-context/DECISIONS.md` gained an entry recording the `MealList` expand-by-default change (made directly, before Phase 7c existed, in response to Jeff's live-testing feedback); the 17 stale `e2e/phase7-acceptance.spec.ts` assertions were updated to match (13 now-redundant "Manage items" clicks removed, plus 2 further "Delete"-button-ambiguity failures found and fixed once those were removed — `.first()`, since items now show by default); and the Phase 7c entry's inaccurate "no change to `MealList`" sentence was corrected in place. `e2e/phase7-acceptance.spec.ts`: 29/29. `max_rows = 1000` (N-1) is intentionally NOT fixed — carried forward in Up Next per Jeff's explicit "note it for later" instruction. One unrelated, pre-existing timezone-boundary flake in `src/lib/actions/meals.test.ts` (a file this session never touched) was newly observed while verifying — not fixed, logged in Up Next. **Phase 7c is ready for Jeff's final approval.** **Jeff approved all of Phase 7 in full (Phase 7, Phase 7b, and Phase 7c — saved meals, save-a-logged-group-as-a-meal, and the library findability pass), 2026-07-31.** **Phase 8 ("Ease-of-entry extras — copy/repeat: copy a whole day, "Log again" on a single entry, and "Copy this group") implemented (2026-07-31, developer) — `copyFoodEntries`, `validateCopyFoodEntriesInput`, `CopyDayDialog`, `CopyGroupDialog`, and the `FoodEntryList`/`FoodDayView` wiring are all in place. Several deviations/implicit decisions and known-deferred-class issues were flagged for qa-reviewer's attention — see the Completed entry below.** **Phase 8 qa-reviewed (2026-07-31, qa-reviewer): 50 independent tests all green, no blocking findings, 8 non-blocking notes (N-1 through N-8) — none recommended for action beyond amending two design-doc passages that describe unbuilt-but-non-blocking scope (multi-select copy, a dashboard quick-copy). Full regression suite confirmed green (both observed failures are already-documented pre-existing UTC-boundary flakes in files Phase 8 never touched) — ready for Jeff's approval.** **Phase 8b ("Multi-select bulk actions on the day's log") designed (2026-07-31, architect), resolving Phase 8's N-1/N-2 — a new design-doc section covers explicit select mode, cross-group selection, "Copy selected"/"Save selected as a meal" (both driving already-shipped actions with zero new server/domain code), and permanently descopes the stale dashboard quick-add line rather than building it. Phase 8's N-3/N-4 subsequently folded into Phase 8b too (2026-07-31, architect): a structural unmount-on-close fix for `CopyDayDialog`'s stale-error-on-reopen bug, and a "Log again" toast that names its destination. Phase 8b is ready for developer.** **N-8 fixed (2026-08-01, qa-reviewer): the `pastInstant()` UTC-midnight fixture-collision flake in `e2e/phase7b-acceptance.spec.ts` replaced with fixed-time-of-day fixtures — 23/23 re-confirmed, full suite 482/482 unit + 263/263 e2e. A different, unrelated local-midnight-window flake was newly found in `e2e/food-logging.spec.ts` and deliberately left unfixed — see Up Next 0-pre-c.** **Phase 8b fully designed (2026-08-01, architect) across six manual-testing findings (multi-select bulk actions, date formatting, a `StatusMessage` success-feedback restyle, a copy-group time override, an edited-row highlight, plus a separate autofill/password-manager hygiene pass) and then implemented (2026-08-01, developer) — lint/typecheck/build clean, unit 504/505, e2e 262/263 (both remaining failures are already-documented pre-existing UTC-boundary flakes in files this work didn't touch), independently re-verified — ready for qa-reviewer. Finding 5 (log a meal from `/meals`) was split out as its own Phase 8c, confirmed by Jeff, sequenced right after 8b since it depends on the new `StatusMessage` component.** **Phase 8c implemented (2026-08-01, developer) — a "Log this meal" action on `/meals` reusing `LogMealDialog` in a new fixed-meal mode; lint/typecheck/build clean, unit 504/505, e2e 262/263 (both remaining failures already-documented pre-existing flakes), plus 71/71 on the full Phase 7/7b/7c suite confirming zero regression — independently re-verified, ready for qa-reviewer.** **Phase 8b qa-reviewed (2026-08-02): 54/54 new acceptance tests plus 22 new unit tests, no blocking findings. Two real issues found and fixed during verification — a genuine `StatusMessage` timer bug (auto-dismiss silently reset by unrelated parent re-renders, now fixed) and an unrelated test-locator bug — full suite 529/529 unit, 54/54 new e2e, 34/34 on a targeted regression check. Phase 8b and 8c are both ready for Jeff's approval.**

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
- [x] **Local email-confirmation redirect bug fixed; missing client-fetch error handling
  added (partial fix for the "no client-fetch timeout" follow-up — see qa-reviewer caveat below)**
  (2026-07-25, done directly — trivial, no design surface). Jeff reported `/food`
  hanging on "Today so far" → "Loading…" forever after clicking a signup confirmation email, which
  had landed him on `http://127.0.0.1:3000` instead of `http://localhost:3000`. Root-caused to two
  compounding bugs, both fixed: (1) `supabase/config.toml`'s `[auth] site_url` was
  `http://127.0.0.1:3000` (with only `https://127.0.0.1:3000` in `additional_redirect_urls`), while
  `signUp()` (`src/lib/actions/auth.ts`) requests `emailRedirectTo` built from
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000` — since `localhost:3000` wasn't on GoTrue's redirect
  allow-list, it silently fell back to the configured `site_url` default, always sending
  confirmation links to `127.0.0.1` regardless of what the app asked for. Fixed by aligning
  `site_url`/`additional_redirect_urls` to `localhost:3000` so the whole auth flow stays on one
  consistent origin (requires `supabase stop && supabase start` to take effect — done and
  reverified). (2) This is exactly the "no client-fetch timeout/fallback" gap already flagged
  below in Up Next (2026-07-22) — surfacing now as a real blocker rather than a hypothetical:
  `TodaySummary.tsx`, `MetricForm.tsx`, and `FoodDayView.tsx` all had `useEffect` Supabase reads
  with no error handling, so any rejected/errored query left `loading` stuck `true` forever with
  zero feedback. Fixed all three with proper try/catch (async/await, not `.then().catch()` —
  Supabase-js's query builder is `PromiseLike`, not a real `Promise`, so `.catch` isn't typed on it
  directly) plus a visible error state with a "Retry" action. Verified end-to-end with a scripted
  signup → Mailpit confirmation-link fetch → follow-link → dashboard-load run: lands on
  `localhost:3000`, "Today so far" resolves immediately with real data, no hang. Lint/typecheck
  clean, 151/151 unit tests still passing. **Environment note for whoever next runs this
  locally on Windows**: Turbopack (`next dev`'s default) repeatedly crashed with an internal IPC
  panic (`TurbopackInternalError`, "connection was forcibly closed", os error 10054) in this
  sandbox — root cause not fully isolated, but `next dev --webpack` runs cleanly and is the
  workaround; not a code issue, no application fix applied or needed.
  **qa-reviewer caveat (2026-07-25) — important, do not treat the original bug as fully closed:**
  the try/catch only fires when a query *settles* with an error (HTTP 500, RLS rejection, etc.).
  qa-reviewer tested a true **network-level failure** (aborted request, closest analog to Jeff's
  original "stuck pending forever, never erroring" report) and confirmed the page still hangs on
  "Loading…" indefinitely in that case — this fix closes the HTTP-error gap but does **not**
  resolve the network-hang scenario that originally motivated the follow-up. That item (a real
  fetch timeout/abort, e.g. `AbortController` + a time limit) stays open — see Up Next. qa-reviewer
  also found `TodaySummary.tsx` was missing the "Retry" action the other two components got;
  fixed directly after review (adds a `retryCount` state bump to re-run the effect).
- [x] **Food time-of-day control changed from `<input type="time" step="900">` to a native
  `<select>` of the 96 quarter-hour values** (developer, per the architect's 2026-07-25 revision —
  see `ai-context/DECISIONS.md`). New pure function `quarterHourOptions()` in
  `src/lib/domain/datetime.ts` (plus a small `formatTimeLabel(value)` helper it's built from, also
  exported for reuse) generates the 96 `{ value: "HH:MM", label: "h:mm AM/PM" }` pairs — unit
  tested for count, ordering, uniqueness, the 15-minute-grid pattern, and both AM/PM boundaries
  (noon and midnight). `FoodEntryForm.tsx` now renders a `<select name="consumedTime">` built from
  a module-level `TIME_OPTIONS` constant; `name`/`id`/`required`/label/error-rendering are
  unchanged, and the `HH:MM` value contract into validation/`localInputToUtcInTz`/grouping/the
  future-day cap is untouched (presentation-only change, exactly per the design doc). **Edit
  invariant implemented**: when the entry being edited holds an off-grid stored time (legacy/
  defensive case), the component injects it as an extra `{ value, label }` option (sorted into
  place) so the select can never silently fall back to its first option and rewrite the time on an
  unrelated save — verified by hand (direct DB insert of an off-grid `09:07`, confirmed the edit
  form pre-selects "9:07 AM" correctly, and that submitting unchanged still correctly hits the
  pre-existing server-side 15-minute-interval rejection rather than silently saving — that
  rejection is expected/unchanged behavior, not a regression). `MealItemForm`/`LogMealDialog` were
  confirmed out of scope for this pass (`LogMealDialog` doesn't exist yet — Phase 7 — and will pick
  up the same `quarterHourOptions()` helper when built; `MealItemForm` has no time field at all).
  Updated `e2e/food-logging.spec.ts` (`step="900"` assertion replaced with option-count/label
  assertions plus a new select-and-submit test) and `e2e/phase3-acceptance.spec.ts` (the off-grid-
  bypass test now injects a rogue `<option>` into the DOM and selects it, rather than setting
  `.value` on an `<input type="time">`, to keep proving the *server* — not just the removed client
  constraint — rejects an off-grid time; a manual-override test switched from `.fill()` to
  `.selectOption()`). Full verification: unit 166/166 (151 prior + 15 new for
  `quarterHourOptions`/`formatTimeLabel`), lint/typecheck clean, and
  `e2e/food-logging.spec.ts` + `e2e/phase3-acceptance.spec.ts` run against a live local Supabase —
  every test touching the time control passed; **9 pre-existing failures unrelated to this change**
  were also observed and are called out in the Notes below (not fixed here — out of this task's
  scope, and confirmed via `git stash` to already fail identically on the last commit before this
  change).
- [x] **Visual identity rollout implemented (developer), both passes in one session, per
  `ai-context/DECISIONS.md`'s "Visual identity: warm-paper + sage/clay palette…" and
  "Visual-identity tokens live in `globals.css`…" and design doc §8 "Visual identity rollout".**
  Presentation-only — no data model/actions/RLS touched.
  **Pass A (tokens + primitives + auth pages):** `src/app/globals.css` gained the six custom
  properties (`--paper #FBF8F1`, `--ink #23211C`, `--sage #A9BE8C`, `--sage-deep #5C7444`,
  `--sage-pale #E3EAD6`, `--clay #C97452`) on `:root`, exposed via `@theme inline` as
  `--color-paper`/`--color-ink`/`--color-sage`/`--color-sage-deep`/`--color-sage-pale`/`--color-clay`
  (real `bg-*`/`text-*`/`ring-*` utilities), with `--background`/`--foreground` repointed to
  `--paper`/`--ink`; the dead `@media (prefers-color-scheme: dark)` block was removed (light-only
  for v1, per the decision). `src/app/layout.tsx` registers **Fraunces** via `next/font/google`
  (`--font-fraunces` → `--font-serif` → `font-serif` utility), mirroring the existing Geist setup;
  applied only to headings/wordmark/large stat numerals, Geist Sans stays the body/UI face
  unchanged. All four `components/ui/*` primitives updated: `Button.tsx` (`primary` = `bg-ink
  text-paper`, `rounded-lg`→**`rounded-full`** pill, focus ring `sage-deep`; `secondary` = white/
  `--ink`/soft border; `danger` **left untouched** — semantic red, out of scope); `Card.tsx`
  (`rounded-xl`→**`rounded-2xl`**, border → warm-neutral `stone-200`); `NavLink.tsx` (active =
  **`bg-sage-pale text-ink`** — deliberately **not** `text-sage-deep`, which is ~4.2:1 and fails
  AA for this normal-weight `text-sm`; verified visually in the browser, not just by class name —
  see manual check below); `styles.ts` (`inputClass` focus ring/border-on-focus → `sage-deep`,
  `labelClass`/placeholder → warm-neutral; `errorTextClass` untouched). `(auth)/login` and
  `(auth)/signup` (`LoginForm.tsx`, `SignupForm.tsx`, `(auth)/layout.tsx`) were structurally
  refactored off their hand-rolled `bg-zinc-900` button/raw `<input>`/`<label>` classes onto the
  `components/ui/` primitives (`Button`, `Card`, `inputClass`/`labelClass`/`errorTextClass`) —
  the amber `auth_callback_failed` notice on `/login` was left untouched (semantic warning, out of
  scope). A single "sage arc" SVG motif (one thin curved `<path>` in `--sage`, ~30% opacity) was
  added once each behind the auth `Card` and behind the dashboard "Today so far" block, per the
  motif guardrail (at most once per screen, never repeated decoration).
  **Pass B (propagate to already-styled screens):** every direct `indigo`/`emerald`/`zinc-900`
  reference was swapped per the design doc's file list and mapping (`FoodEntryForm.tsx`,
  `SettingsForm.tsx`, `TodaySummary.tsx`, `MetricForm.tsx`, `DailyTotals.tsx`, `FoodDayView.tsx`,
  `FoodEntryList.tsx`, the dashboard `(app)/page.tsx`, `(app)/layout.tsx` nav shell, and the
  `food`/`metrics`/`settings` `page.tsx` headings) — `indigo-*` accents → `sage-deep`, badge/tint
  fills → `sage-pale`, `rounded-xl` card-like surfaces → `rounded-2xl`, headings and the three
  `DailyTotals` stat numerals → `font-serif`/`text-ink` (or `text-sage-deep` for the accented
  protein-% stat, per the doc's "standard mapping," **not** `text-clay` — clay is reserved for
  "positive emphasis only," which a routine metric isn't). The two flagged non-mechanical spots
  were verified, not just pattern-matched: `SettingsForm`'s "Settings saved." pill is
  **`bg-sage-pale text-ink`** (deliberate on-brand success, distinct from the persistent semantic
  red — confirmed by also toggling an error path, which still renders in red); the `amber`
  auth-callback notice was confirmed untouched. Residual non-brand greys were mapped to Tailwind's
  built-in **`stone`** palette (a warm gray already in Tailwind v4's default theme, no new tokens
  needed) rather than left as `zinc`, satisfying the design doc's "no stray zinc remains" bar —
  with one deliberate, documented exception: `styles.ts`'s `inputClass` keeps **`border-zinc-300`**
  literally unchanged, per the DECISIONS entry's explicit "field-border grays… stay" carve-out
  (distinct from `Card`'s border, which *is* a "card surface" and did move to `stone-200`).
  **Verification:** `npm run lint` / `npx tsc --noEmit` clean; `npm test` 166/166 (unchanged from
  before this work — confirms no logic was touched); a full `supabase db reset` + `npm run
  test:e2e` run against a freshly-started dev server passed **108/108** (all pre-existing tests,
  including the 9 flaky ones logged in the 2026-07-25 Notes entry above, which are timing-sensitive
  and not reliably reproducible run-to-run — see the Notes entry added below for how a stale,
  heavily-cycled dev server process left over from investigation work made them appear to fail
  10/10 on a first pass, and how restarting the dev server cleanly resolved that; this rollout did
  not change their pass/fail status, confirmed by isolating the visual-identity diff via a
  path-scoped `git stash` and re-running against the true pre-existing working tree). Manually
  driven in a real browser (Playwright script, not just the automated suite) against `/login`,
  `/signup`, dashboard, `/food` (including adding a live entry), `/metrics` (including logging a
  weight entry, to see the "Already logged" `sage-pale`/`ink` pill), and `/settings` (including
  toggling kg→lb and saving, to see the "Settings saved." pill) — screenshots confirm: warm paper
  background throughout; Fraunces renders on every heading and the dashboard/food stat numerals;
  pill-shaped buttons everywhere; `rounded-2xl` cards; the active nav pill (`bg-sage-pale
  text-ink`) is clearly legible on every screen, the specific contrast trap the design doc flagged;
  the sage arc appears exactly once on the auth screen and once on the dashboard; no stray
  indigo/emerald/zinc-900 visible anywhere. Zero console errors from app code (one unrelated
  Chromium-injected `caret-color` hydration-mismatch warning on the two auth pages' password/email
  inputs, traced to the automated browser's own autofill/password-manager UI overlay, not app
  styling — present regardless of which classes are on the inputs).
- [x] **Phase 5 (Trend charts) implemented** (developer), against the design doc's §8 Phase 5
  scope and the "chart gaps: connect across missing days, mark real entries with a dot" decision.
  New pure domain module `src/lib/domain/trends.ts`: `TREND_RANGES`/`TrendRange` (7/30/90),
  `parseRangeParam` (defaults to 30 for anything missing/invalid, never throws), `dateRange`/
  `startDateForRange` (pure `Date.UTC` calendar arithmetic, tz-independent so tests are stable
  regardless of runner tz), and `buildWeightSeries`/`buildIntakeSeries` — both produce a DENSE
  day-by-day array (every calendar day present) with `isReal: false` + `null` values on days with
  no logged row, and `isReal: true` + the real values otherwise; a weight-only day (no body fat %)
  is still `isReal: true` with `bodyFatPct: null`. 21 new unit tests covering dense-fill/gap
  behavior, `isReal` flagging, and 7/30/90 range-window math (166 → 187 total). `trends/page.tsx`
  (Server Component) reads the `?range=` query param (via Next 15+/16's async `searchParams`
  Promise, matching `(auth)/login/page.tsx`'s existing pattern) and the existing `getGoals()`
  action for `weightUnit`/calorie/protein targets, passing them down as plain props — the URL is
  the source of truth for range, not client state, per the design doc. `RangeSelector` is three
  plain `Link`s to `/trends?range=<n>` (no `useState`/`useRouter`), mirroring how `NavLink` derives
  active state from the URL rather than a store. `TrendsView.tsx` (client) owns the browser
  tz/"today" resolution (same mount-only-Effect pattern as `MetricForm`, avoiding an SSR/client
  hydration mismatch) and the actual Supabase reads — `getWeightSeries`/`getIntakeSeries` (the
  names the design doc's §8 Phase 5 bullet uses), querying `daily_metrics`/`daily_food_totals`
  scoped by the RLS-scoped **browser** client (never service-role, never a client-supplied
  `user_id` — RLS does the scoping) and feeding the pure builders — consistent with the established
  Phase 3/4 deviation that browser-tz-dependent "today" reads happen client-side, not in a Server
  Component. `WeightChart`/`IntakeChart` (new `recharts` dependency, `npm install recharts` —
  v3.10.1) render the dense series as a single `connectNulls` line with a **custom dot renderer**
  so the "dot only on real days" rule is explicit and testable at the domain level, not incidental
  to Recharts' own null-skipping (originally keyed on each point's `isReal` flag; corrected in the
  2026-07-25 qa fix-up below to key on each series' own plotted value being non-null instead, since
  `isReal` is a per-day, not per-series, flag — see that entry for why). `IntakeChart` draws a
  `ReferenceLine` per goal **only when that goal is actually set**
  (`daily_calorie_target`/`daily_protein_target_g` are `null` from `getGoals`'s ensure-row
  default until the user sets one — confirmed, not assumed). `WeightChart` converts stored
  canonical kg to the display unit via the existing `lib/domain/units.ts` (`weightForDisplay`) —
  no reimplementation — and only adds the body-fat second axis/line when at least one point in
  range actually has a body-fat value. Chart data-series colors (lines, dots, `ReferenceLine`s) use
  the real `--sage-deep`/`--clay` brand tokens via the `className="text-sage-deep"` +
  `stroke="currentColor"` technique the dashboard's "sage arc" motif already established — **not**
  hardcoded hex — confirmed against the installed `recharts` type declarations that `Line`/
  `ReferenceLine` support `className` but `CartesianGrid`/`XAxis`/`YAxis` do not, so the latter's
  neutral grid/tick colors use two small documented constants that are Tailwind's own built-in
  `stone-200`/`stone-500` shades (not a second brand palette). Both charts show a plain Tailwind
  legend row (colored dots + text) instead of SVG-rendered `ReferenceLine` labels, and an empty-state
  message + link when there's no data at all in the selected range. Added a "Trends" `NavLink` to
  `(app)/layout.tsx`. **Verification:** `npm run lint` / `npx tsc --noEmit` clean; `npm test`
  187/187 (166 prior + 21 new). Docker/local Supabase **was** available this round (unlike some
  earlier phases) — ran `supabase db reset` and drove a throwaway (written, run, then deleted —
  not part of the delivered suite, per instructions that qa-reviewer owns Phase 5's acceptance
  tests) Playwright script against the real local stack: seeded `daily_metrics`/`food_entries`/
  `user_goals` rows via `e2e/helpers/user-client.ts`, confirmed the weight/intake charts render
  real data with a gap correctly connected, the calorie-goal `ReferenceLine`/legend item appears
  while the unset protein-goal one does not, switching 30d→7d via `RangeSelector` updates the URL
  and refetches, and a user with zero data sees both empty-state messages — all passed, zero
  browser console errors. Also ran the full pre-existing e2e suite (`npx playwright test`, fresh
  `.next`/dev server per the 2026-07-25 stale-server lesson in Notes below): **107/108 passed**;
  the one failure (`phase4-acceptance.spec.ts` "no-future metric date (UTC browser)") reproduces
  identically against the unmodified `main` branch via `git stash` — confirmed pre-existing and
  unrelated to this Phase 5 work (not fixed here — Phase 4 scope, not Phase 5's).
- [x] **Phase 5 qa-reviewed (one blocking bug), then fixed (developer, 2026-07-25).**
  Independent suite `e2e/phase5-acceptance.spec.ts` (28 tests) + `src/lib/domain/trends.qa.test.ts`
  (26 tests) — 213/213 unit incl. the 26 independent, 134/136 e2e (the other failure the same
  unrelated pre-existing `phase4-acceptance.spec.ts` bug above), lint/typecheck/build clean, all
  Absolute Rules independently re-verified. **One blocking bug**: `IntakeChart.tsx`'s goal
  `ReferenceLine`s silently failed to render whenever a goal sat above the highest logged value in
  the visible range — `YAxis domain={[0, "auto"]}` is computed by Recharts from the plotted `Line`
  data only, with no awareness of a `ReferenceLine`'s `y`, and `ReferenceLine`'s default
  `ifOverflow: "discard"` drops it silently when it falls outside that computed domain — while the
  legend (gated only on `calorieGoal`/`proteinGoal` being non-null) still showed the goal swatch.
  This is precisely the "currently under target" case the chart exists to show. **Fix**: added
  `ifOverflow="extendDomain"` to both `ReferenceLine`s, so the axis extends to include a
  higher-than-data goal instead of discarding its line. While in this code, also **corrected the
  dot-suppression logic** in both `IntakeChart.tsx` and `WeightChart.tsx`: `makeDot` was keyed on
  the point's `isReal` flag, but `isReal` is a per-*day* flag (true whenever a `daily_metrics` row
  exists for that day) — for the body-fat series specifically, a weight-only day is `isReal: true`
  with `bodyFatPct: null`, so suppressing that series' dot was actually resting on `cx`/`cy` coming
  back `null` from Recharts for a `null` data point (verified true in practice, but undocumented and
  not the load-bearing mechanism the doc comment claimed). `makeDot` now takes an explicit
  `valueKey` and checks that series' own plotted value directly — correct for both charts and no
  longer dependent on Recharts' internal `cx`/`cy` behavior for `null` points. Also closed three of
  qa-reviewer's four non-blocking notes: added `/trends` coverage to
  `e2e/fetch-error-handling.spec.ts` (error+Retry+recovery, mirroring the other 3 surfaces);
  narrowed `trends/page.tsx`'s `searchParams` prop type from `Promise<{ range?: string }>` to
  `Promise<{ range?: string | string[] }>` (Next's actual runtime shape for a repeated query param)
  with an explicit `Array.isArray` normalization before `parseRangeParam`; and corrected/expanded the
  `isReal`-vs-dot-suppression doc comments in both chart components (per the mechanism above) rather
  than just leaving them describing stale behavior. Left the fourth note as-is per qa-reviewer's own
  "likely leave as-is" framing: `/trends` still triggers `getGoals()`'s ensure-row upsert on a
  read-only page, an already-accepted pre-existing Phase 4 pattern being reused, not a new issue.
  **Verification after the fix**: `e2e/phase5-acceptance.spec.ts` re-run standalone — 28/28,
  including the previously-failing "a calorie goal ABOVE the logged intake still draws its goal
  line" now passing, and the two previously-passing boundary cases (no goals set, goal inside the
  logged range) still passing (no regression). Full suite from a clean `supabase db reset`: unit
  213/213 (unchanged — this was a presentation-only fix, no new unit tests added, none needed since
  qa-reviewer's own domain-level `trends.qa.test.ts` already covers `buildIntakeSeries`/
  `buildWeightSeries`; the bug was purely in the Recharts wiring, not in `lib/domain/`), e2e 137/138
  (136 prior + 2 new `/trends` fetch-error tests; the one failure is the same pre-existing
  `phase4-acceptance.spec.ts` case, re-confirmed via `git stash` to reproduce identically without
  this session's changes), lint/typecheck/build clean.
- [x] **True client-fetch timeout added, closing the "no client-fetch timeout" follow-up** (a
  separate developer session, verified live). New `src/lib/supabase/query-timeout.ts` exports
  `queryTimeoutSignal(ms = 12_000)`, a thin wrapper around the platform `AbortSignal.timeout()`,
  wired into every browser-side Supabase read that previously had no bound on how long it could
  hang — `TodaySummary.tsx`, `FoodDayView.tsx` (both queries in its `Promise.all`), and
  `MetricForm.tsx` (both its mount-time and day-switch reads) — via each query builder's own
  `.abortSignal(signal)` (supported on every `postgrest-js` filter/transform builder). Per
  `postgrest-js`'s behavior, an aborted request resolves with `{ data: null, error }` rather than
  throwing, so the existing try/catch + `error` → "Couldn't load..." + Retry UI on all three
  components already covers it with no new error-handling path needed at the call sites. **Verified
  with a positive and a negative control** (not just code review): confirmed the original hang
  reproduces with the timeout wiring reverted (a genuinely stalled/never-resolving request left the
  UI on "Loading…" indefinitely, matching Jeff's original report and qa-reviewer's confirmed gap),
  then confirmed re-applying the fix causes the same stalled request to surface the "Couldn't
  load..." + Retry error state after the timeout elapses instead of hanging forever. This closes the
  gap the 2026-07-25 fix left open (that fix only handled queries that *settle* with an error, not
  ones that never settle at all).
- [x] **Visual identity rollout qa-reviewed.** Independent acceptance suite
  `e2e/visual-identity-acceptance.spec.ts` written against the DECISIONS/design-doc spec (not the
  implementation) — asserts on *computed* browser styles (colors, font-family, border-radius),
  not source class names, since a class name in the source proves nothing if Tailwind never
  generated that utility. Covers: paper/ink/Fraunces/pill-button/rounded-2xl tokens actually compute
  on the login page; the sage arc appears exactly once on each auth screen and nowhere else
  (confirming the 2026-07-26 dashboard-removal supersession); active `NavLink` is genuinely
  ink-on-sage-pale (the documented contrast trap) on every nav item; and no stray old-palette
  (indigo/emerald/zinc-900) computed color remains anywhere in the app. **Verdict: ready to gate to
  production, 0 blocking findings.** Five non-blocking notes (NB-1 through NB-5):
  - **NB-1** (dead old-palette CSS shipping in the production bundle) — **fixed this session**, see
    below.
  - **NB-2** (genuine WCAG AA contrast gaps in field borders/placeholder text) — **fixed this
    session**, see below.
  - **NB-3** and **NB-4** — accepted as-is, no action needed (minor/cosmetic, not contrast or
    correctness issues).
  - **NB-5** (recommended: add computed-style regression coverage for the visual identity, since the
    rollout previously had zero test coverage of its own styling) — the resulting
    `e2e/visual-identity-acceptance.spec.ts` is the fix for this note and already exists in the
    working tree (written by qa-reviewer); kept and added to version control this session, not
    removed.
- [x] **NB-1 fixed: dead old-palette CSS no longer ships in the production bundle** (developer,
  2026-07-26). `globals.css`'s Tailwind v4 import had no `@source` restriction, so its automatic
  content-detection heuristic scanned the *entire* project — including `ai-context/DECISIONS.md`,
  `ai-context/PROGRESS.md`, and `docs/architecture/food-weight-tracker.md`, all of which quote old
  pre-visual-identity class names (`indigo-50`, `text-indigo-700`, `bg-emerald-50`,
  `text-emerald-700`, `bg-zinc-900`, `text-zinc-900`, `border-zinc-200`, `rounded-xl`) in prose
  describing the migration — and emitted those 8 dead utilities into `.next/static/chunks/*.css`
  even though nothing in `src/` uses them anymore. Fixed by changing the Tailwind import to
  `@import "tailwindcss" source(none);` (disables automatic detection) plus one explicit
  `@source "../";` (resolves to `src/`, relative to `globals.css` at `src/app/globals.css`), scoping
  detection to the app's own source tree only. **Verified by actually rebuilding, not just reasoning
  about Tailwind's docs**: with the fix reverted, a clean `npm run build` still emitted all 8 dead
  classes into the output CSS (confirmed by grep); with the fix restored, a clean rebuild emits zero
  of them, while the real utilities the app does use (`bg-sage-pale`, `text-sage-deep`,
  `rounded-2xl`, `tabular-nums`, the new `border-stone-500` from the NB-2 fix below) are all still
  present and correctly generated.
- [x] **NB-2 fixed: genuine WCAG AA contrast gaps in field borders/placeholder text** (developer,
  2026-07-26). qa-reviewer measured three colors carved out by the 2026-07-25 visual-identity
  decision as "field-border grays… stay" and found two of the three fail their applicable
  threshold on the white surfaces they actually render on: `placeholder:text-stone-400` (`#a8a29e`)
  → 2.52:1 on white (needs 4.5:1 AA text); `styles.ts`'s shared `inputClass` `border-zinc-300`
  (`#d4d4d8`) → 1.49:1 on white (needs 3:1, WCAG 1.4.11 non-text/UI-component); `Card`'s
  `border-stone-200` (`#e7e5e4`) → 1.26:1 on white (same 3:1 threshold). Fixed by moving both the
  placeholder text and both borders to Tailwind's **`stone-500`** (`#78716c`) — the nearest step up
  in the same warm-neutral family already used elsewhere in the rollout (chart grid/tick neutrals),
  computed at **4.80:1 on white**, clearing both the 4.5:1 and 3:1 bars with margin; no new gray
  family introduced. Full before/after math recorded in this session's amendment to the
  2026-07-25 "Visual identity..." entry in `ai-context/DECISIONS.md` (the original carve-out's
  reasoning is marked amended-in-part, not deleted — its point that these are structural chrome, not
  brand color, still stands; what changed is which *shade* of gray satisfies both "stays neutral"
  and "passes AA" at once). Spot-checked the arithmetic independently with a small Node script using
  the standard WCAG relative-luminance formula against Tailwind's documented stone-500 hex, matching
  qa-reviewer's numbers. **Scope note**: several other components hardcode `border-stone-200`
  directly rather than going through `Card` (`SettingsForm.tsx`, `FoodEntryForm.tsx`'s own form
  wrapper, `FoodEntryList.tsx`, `(app)/layout.tsx`'s header, `RangeSelector.tsx`, `MetricForm.tsx`)
  — these share the same 1.26:1 failure but were **not** in qa-reviewer's NB-2 finding or this
  session's scope, so they were left untouched; flagged here as a likely follow-up for whoever next
  does an accessibility pass, since the same fix (→ `stone-500`) would apply.
- [x] **Time-`<select>` option alignment implemented** (developer, 2026-07-26), per the architect's
  2026-07-26 decision (`ai-context/DECISIONS.md`, "Time-`<select>` option labels are zero-padded...")
  responding to Jeff's 2026-07-25 "options don't line up in a column" complaint.
  `formatTimeLabel` (`src/lib/domain/datetime.ts`) now zero-pads the 12-hour hour
  (`"08:15"` → `"08:15 AM"`, was `"8:15 AM"`; `"18:30"` → `"06:30 PM"`, was `"6:30 PM"`), making
  every one of the 96 labels exactly 8 characters (`hh:mm AM|PM`); `quarterHourOptions()` needed no
  change of its own since it already derives labels via `formatTimeLabel`. `FoodEntryForm.tsx` adds
  Tailwind's `tabular-nums` to both the `<select>` and each `<option>`, as the documented secondary
  polish (not the load-bearing fix — equal character count is). Updated
  `src/lib/domain/datetime.test.ts`: the two one-digit-hour `formatTimeLabel` cases now assert the
  zero-padded form, and a new test asserts all 96 `quarterHourOptions()` labels are exactly 8
  characters matching `hh:mm AM|PM`. **Confirmed, not assumed, that no e2e test breaks**: grepped
  `e2e/food-logging.spec.ts`'s label assertions (`"12:00 AM"`/`"11:45 PM"`, both already two-digit
  and unchanged) and confirmed no `selectOption(...)` call anywhere in `e2e/` selects by label
  (all pass the `HH:MM` value) — ran the full suite to verify this held rather than trusting the
  grep alone. **Verification**: unit 214/214 (213 prior + 1 new); lint/typecheck/build clean;
  `e2e/food-logging.spec.ts` re-run standalone, 12/12 passing including the unchanged label
  assertions; full `npx playwright test` (fresh `supabase db reset`, and a stale leftover dev server
  from an earlier session on port 3000 killed first, per the 2026-07-25 stale-server lesson in Notes
  below, so the run reflects a genuinely fresh server) — **143/143 passed**, including the 10th
  reproducing instance of the pre-existing `FoodDayView` `Day`-input race
  (`e2e/food-offgrid-edit.spec.ts:32`, added to the documented list in Notes below) passing cleanly
  against a fresh server, consistent with that bug's "stale dev server" trigger rather than a
  deterministic failure.
- [x] **Phase 6 (Food lookup: barcode + description search) implemented** (developer), against the
  design doc's §8 Phase 6 scope and the "Food lookup: Open Food Facts (barcode) + USDA FoodData
  Central (search), via a server-side proxy" decision.
  - **`lib/domain/lookup.ts`** (pure, framework-free): a common `FoodCandidate` type (`source`,
    `sourceId`, `name`, `quantity`, `unit`, `caloriesPerUnit`, `proteinGPerUnit` — a strict superset
    of the existing `FoodCandidatePrefill` seam from Phase 3, so a picked candidate needs no mapping
    to hand straight to `FoodEntryForm`); `unitFromServingLabel` (parses serving strings like
    `"1 cup (240 ml)"`/`"2 tbsp"`/`"100g"` into `{quantity, unit}`, `null` when unparseable);
    `normalizeOpenFoodFactsProduct` and `normalizeUsdaFood`. Both normalizers convert whatever basis
    the provider reports (a per-serving figure, or a flat per-100g figure) down to a genuine
    **per-single-unit** figure via the existing `quantity.perUnitFromTotal` — e.g. "2 tbsp" per-
    serving values are halved to a per-tbsp figure, and a bare per-100g figure becomes "quantity
    100, unit g, per-gram calories/protein" — so every candidate lands in the *same* single storage
    model manual entry already uses, and a later quantity edit keeps recalculating correctly
    regardless of which provider/basis produced it. Candidates with no usable name or no finite
    calorie figure on any basis are dropped (return `null`); a legitimately-zero calorie value
    (e.g. water) is explicitly NOT dropped, and a missing protein figure defaults to `0` rather than
    dropping the candidate (many real foods are ~0g protein and still have real calorie data worth
    prefilling) — both distinctions covered by dedicated unit tests, not just asserted in prose.
  - **`lib/lookup/openfoodfacts.ts` / `lib/lookup/usda.ts`** (server-only adapters): thin
    fetch-and-loosely-parse wrappers, each returning a tri-state result (`ok:false` for a transport/
    provider failure vs. `found:false` for a real "not found") so the Route Handler can distinguish
    "provider unavailable" from "no match" without the normalizer needing to know about HTTP at all.
  - **`app/api/lookup/barcode/route.ts` / `app/api/lookup/search/route.ts`**: auth-gated Route
    Handlers (`supabase.auth.getUser()` checked and rejected with 401 **before** any outbound
    provider call is ever made — confirmed by a dedicated test asserting the provider mock is never
    invoked on the unauthenticated path). Barcode validates a loose 6-14-digit shape (400 otherwise);
    search validates a non-blank query (400 otherwise) and requires `USDA_FDC_API_KEY` to be
    configured server-side (502 if missing, never client-visible). A found-but-unusable product and
    a genuinely-not-found barcode both resolve to `{ candidate: null }` — deliberately not
    distinguished further, since the caller's fallback UI ("enter manually") is identical either way.
    `USDA_FDC_API_KEY` is read only from `process.env` inside the route/adapter, is never echoed in
    any response, and was confirmed absent from `.next/static` **and** from `.next` entirely (grepped
    for the actual configured key value, not just the env-var name) after a production build.
  - **`components/food/FoodLookupPanel.tsx`** (search + barcode tabs, collapsed by default behind an
    "Look up a food" expander mirroring `FoodEntryForm`'s own progressive-disclosure convention) and
    **`components/food/BarcodeScanner.tsx`** (always-available manual digit entry, plus an optional
    "Scan with camera" control using the new `html5-qrcode` dependency, feature-detected via
    `navigator.mediaDevices.getUserMedia` in a mount-only Effect so a camera-less browser never
    renders a non-functional button and SSR/first-client-render never mismatch). Both call this
    app's own `/api/lookup/*` routes via `fetch` — never a third-party API directly from a client
    component. Picking a result calls `FoodEntryForm`'s new `handleCandidatePick`, which fills
    name/quantity/unit/per-unit calories+protein, switches to "per-unit" input mode, and
    auto-expands the "add detail" section — a **prefill for review, never an auto-submit**; the user
    still explicitly presses "Add entry". The panel is only rendered in add mode
    (`!isEditing`) — a deliberate scoping choice, flagged below, not in the literal doc text.
  - **Real bug caught only by driving the feature in an actual browser (automated/mocked tests never
    would have)**: `FoodLookupPanel`'s search box and `BarcodeScanner`'s manual-entry box were
    originally each their own `<form onSubmit>`, both nested inside `FoodEntryForm`'s own outer
    `<form>`. HTML forbids nested forms; the browser silently flattens/ignores the inner `<form>`
    tags, so clicking "Search"/"Look up" actually submitted the *outer* food-entry form (with a
    blank required Name field) instead of running the lookup — the lookup panel appeared to just
    close itself with no results, and no error surfaced anywhere. Confirmed via a live Playwright
    smoke run against the real dev server (see verification below) before this was caught. Fixed by
    replacing both inner `<form>`s with plain `<div>`s, moving the "Search"/"Look up" buttons to
    `type="button"` + `onClick`, and adding an `onKeyDown` Enter handler on each text input so
    keyboard submission still works without a real form.
  - **Unit tests**: `src/lib/domain/lookup.test.ts` (33 tests) — `unitFromServingLabel` (parenthetical
    stripping, multi-word units, no-space `"100g"`, decimals, lowercasing, whitespace collapsing,
    null/empty/no-leading-digit → `null`); `normalizeOpenFoodFactsProduct` (per-serving-preferred,
    per-100g fallback, unparseable-serving-label fallback to quantity 1/unit null, zero-vs-missing
    calories, name fallback chain `product_name` → `product_name_en` → `brands`, dropping when no
    name/no nutrition at all); `normalizeUsdaFood` (household-serving scaling from a per-100g basis,
    fallback to quantity 100/unit g, matching the kcal energy entry by `nutrientId` over a same-named
    kJ entry, missing-protein defaults to 0, dropping when no name/no energy value).
    `src/app/api/lookup/barcode/route.test.ts` (7 tests) and
    `src/app/api/lookup/search/route.test.ts` (8 tests) mock `@/lib/supabase/server` and the
    `lib/lookup/*` adapters (matching how CI mocks providers) to cover: 401-before-provider-call,
    400 on missing/invalid input, 502 on provider failure and on a missing USDA key, the USDA key
    never appearing in the response body, and the null-candidate "not found or unusable" path.
    261/261 unit tests total (213 prior + 48 new).
  - **Manual end-to-end verification, including two real live provider calls** (network access and a
    real `USDA_FDC_API_KEY` were both available in this sandbox — the repo owner had just added a
    real key to `.env.local`, per this task's brief): a throwaway Playwright script (written, run,
    then deleted — not part of the delivered suite, mirroring the Phase 5 developer verification
    approach) against a real local Supabase instance + a real dev server confirmed, with **actual
    network calls** to both providers (no mocking): a live USDA search for "cheddar cheese" returned
    a usable, correctly-normalized candidate ("CHEDDAR CHEESE"); picking it auto-expanded the detail
    section and correctly prefilled quantity/per-unit values; adjusting the quantity and submitting
    produced a correctly-totaled entry in the day's list; a live Open Food Facts barcode lookup for
    a well-known real barcode (Nutella 400g, `3017620422003`) returned a match; a bogus barcode
    (`000000000000`) correctly showed "No match found — enter the details manually"; a non-numeric
    barcode (`abc`) correctly showed "That doesn't look like a valid barcode." (the expected
    server-side 400, surfaced as a benign browser network-tab entry, not a JS error — zero real
    console errors observed). This is also what caught the nested-`<form>` bug above on the first
    run, before the fix. Confirmed via `curl` that both routes reject an unauthenticated request
    with 401 before ever calling a provider.
  - **Deviations from the literal doc text, flagged rather than silently resolved**: (1) the design
    doc's module tree describes `BarcodeScanner.tsx` as "camera scan via html5-qrcode; manual code
    fallback" — implemented with manual entry as the **primary, always-rendered** path and camera
    scanning as a feature-detected progressive enhancement, rather than camera-first with manual as
    a fallback shown only on failure; this keeps the common case (no camera, or a desktop browser)
    fully functional with zero permissions friction, and the "fallback" framing in the doc doesn't
    specify an ordering, only that manual entry must exist. (2) `FoodLookupPanel` is only rendered
    for new entries (`!isEditing`); the doc doesn't say either way — editing already shows an
    entry's real saved values, and silently letting a fresh lookup pick overwrite them felt like a
    bigger, more surprising change than this panel's "quick prefill" is meant to be, so it was scoped
    out of edit mode. (3) not-found and found-but-unusable-nutrition both resolve to the same
    `{ candidate: null }` client response — the doc's §6 scope lists them as separate acceptance-test
    rows ("not-found" / implied by "dropping candidates without usable nutrition") but doesn't
    require the *client* to distinguish them, only that both fall back to manual entry; the route
    tests do assert the two cases separately at the point they diverge (an OFF `found: false` vs. a
    normalizer returning `null` for a found product).
  - **Environment notes**: Docker/local Supabase was available this round; `npm install html5-qrcode`
    was verified to add **no new** `npm audit` findings (all 12 pre-existing high-severity advisories
    are in already-present `eslint`/`next`/`postcss`/`sharp` transitive dependencies, unrelated to
    this addition — checked via `npm audit --json` before vs. after). While verifying, hit and worked
    around (not fixed — out of this task's scope) a **pre-existing, time-of-day-dependent bug in
    `supabase/seed.sql`**'s third-account 90-day generator: it builds each day's timestamp from the
    database's `current_date` (a UTC date) combined with a wall-clock slot time, then converts that
    as if it were already `America/Chicago` local time — during the early hours of the UTC day (e.g.
    ~01:00–06:00 UTC, when it's still "yesterday evening" in Chicago), the "today" dinner slot
    (`current_date` + `18:30` interpreted in Chicago) resolves to a UTC instant that is still in the
    future relative to the real current instant, tripping `food_entries_not_future_day` and failing
    `supabase db reset` entirely. Reproduced consistently while this session ran (real UTC time was
    ~01:57–02:00); worked around **locally and temporarily only** (a one-line `- 1` day-offset shift)
    to unblock this task's own e2e verification, then reverted via `git checkout -- supabase/seed.sql`
    before finishing — **no fix was committed**, since this is Phase-2/seed-fixture territory,
    unrelated to Phase 6's scope. Flagged in Up Next for whoever next touches seed data.
  - **If you have no network access when re-verifying this later**: the delivered automated suite
    (unit tests above) is fully mocked and needs no network access or real API key; only the
    throwaway manual smoke-test (already deleted) used live network calls.

- [x] **Phase 6 qa-reviewed (one blocking bug + seven non-blocking findings), all eight fixed**
  (developer, 2026-07-27). qa-reviewer's independent suite (`e2e/phase6-acceptance.spec.ts`,
  `src/lib/lookup/api-routes.qa.test.ts`, `src/lib/domain/lookup.qa.test.ts`) is the acceptance bar
  for this pass; all three pass in full after the fixes (see Verification below).
  - **B-1 (blocking) — collapsing "Add detail" after a lookup pick silently zeroed the entry.**
    `FoodEntryForm.tsx` rendered hidden `<input name="quantity" value="1">` /
    `<input name="unit" value="">` overrides whenever the detail section was collapsed, regardless
    of what quantity/unit had actually been set (by a lookup pick or manual typing). A 100g/
    2.02-kcal-per-g pick, collapsed after picking, saved as 1 × 2.02 = 2 kcal instead of 202, with no
    on-screen warning. Fixed by having the hidden inputs submit the current `quantity`/`unit` React
    state instead of hardcoded literals — collapsing hides the *inputs*, it must never reset the
    *values*. The fast-entry default (quantity 1, unit blank for a fresh, untouched manual entry) is
    unaffected, since that's what the state already initializes to.
  - **N-1 — no timeout on lookup fetches.** Added `lib/lookup/timeout.ts` (`LOOKUP_TIMEOUT_MS =
    10_000`, `lookupTimeoutSignal()`), mirroring the existing `lib/supabase/query-timeout.ts`
    pattern. Wired into both server adapters' `fetch()` calls (`openfoodfacts.ts`, `usda.ts`) and
    both of `FoodLookupPanel.tsx`'s client-side fetches (`runSearch`, `runBarcodeLookup`). An
    aborted fetch is treated as an ordinary transport failure by the *existing* catch blocks/error
    UI — no new error-handling path was needed. qa-reviewer's own "FINDING: a hung proxy leaves the
    panel loading forever" e2e test was updated in place (still their file, now proving the fix
    rather than pinning the bug: waits past `LOOKUP_TIMEOUT_MS` and asserts the panel degrades to
    the same "unavailable right now" manual-entry fallback a real provider error produces).
  - **N-2 — normalizers could produce a saveable candidate with silently-wrong-zero or negative
    nutrition.** Three root causes in `lib/domain/lookup.ts`, all fixed at the source rather than
    patched after the fact: (a) `unitFromServingLabel` now rejects a zero quantity exactly like it
    already rejected a negative one (`"0 g"`/`"0 cup"` no longer parse to `{quantity: 0, ...}`,
    which used to divide a real nutrition figure by zero via `perUnitFromTotal`'s defensive-zero
    path); (b) USDA's household-serving scaling now requires `servingSizeGrams > 0` (not just
    "present") before trusting it, so `servingSize: 0` falls back to the flat per-100g basis instead
    of zeroing a real figure; (c) both normalizers now treat a negative calorie or protein figure as
    unusable — Open Food Facts falls back to its other basis (serving vs. per-100g) before giving
    up, USDA (single basis) drops the candidate outright. qa-reviewer's own "FINDING" tests in
    `src/lib/domain/lookup.qa.test.ts` (which had deliberately pinned the *buggy* behavior as
    passing assertions, per that file's own doc comment: "MUST be updated if the drop rule is
    tightened") were updated in place to assert the corrected behavior instead.
  - **N-3 — no seam to intercept the outbound provider call in tests.** `OPEN_FOOD_FACTS_BASE_URL`
    / `USDA_SEARCH_URL` now read `process.env.OPEN_FOOD_FACTS_BASE_URL` /
    `process.env.USDA_SEARCH_URL`, falling back to the real hardcoded defaults. Documented in
    `.env.example` as an optional, normally-blank override. **Not wired into
    `.github/workflows/ci.yml`** — that's the architect's file; this only makes the seam exist, per
    the task brief. New adapter-level unit tests (`openfoodfacts.test.ts`, `usda.test.ts`) cover
    both the default and the override.
  - **N-4 — float noise prefilled verbatim.** `handleCandidatePick` now rounds
    `caloriesPerUnit`/`proteinGPerUnit` to 2 decimal places (`formatPrefillNumber`, a small module-
    level pure helper) before setting the form fields — e.g. USDA's `390.15000000000003` now shows
    `390.15`. Purely a display nicety at pick time; doesn't touch what gets stored if the user edits
    the field further, and doesn't touch `lib/domain/lookup.ts`'s own values.
  - **N-5 — React key collision risk.** `FoodLookupPanel.tsx`'s result list key was
    `${source}-${sourceId}`, and `sourceId` falls back to the candidate's description when a
    provider omits a real id — two same-named results could collide. Folded the array index into
    the key (`${source}-${sourceId}-${index}`), stable for one render of a single search/lookup
    response.
  - **N-6 — non-deterministic camera-start ordering.** `BarcodeScanner.tsx`'s `startScanning` used
    to construct `new Html5Qrcode(regionId)` directly after `await import("html5-qrcode")`, relying
    on React having already committed the DOM (with the target region `<div>` present) by the time
    that promise resolved — not a guaranteed ordering. Moved the construction into a `useEffect`
    keyed on the `scanning` state, so it only ever runs after React has committed a render where the
    region div exists. New test `BarcodeScanner.test.tsx` (this repo's first component-level test —
    no prior pattern existed for one) mocks `html5-qrcode` and asserts
    `document.getElementById(regionId)` already resolves to a real element at the moment
    `Html5Qrcode` is constructed.
  - **N-7 — no rate limiting on `/api/lookup/search`.** Added `lib/lookup/rate-limit.ts`
    (`isWithinLookupRateLimit`), a simple in-memory per-user sliding-window limiter — 30
    requests/minute/user, `429 { error: "rate_limited" }` before query validation or the USDA call.
    Explicitly a v1-appropriate stopgap (in-process `Map`, no cross-instance/cold-start persistence)
    per the task brief — no new table/migration was added (that would have needed the architect).
    `/api/lookup/barcode` (Open Food Facts, free/keyless) was deliberately left unlimited — no
    comparable shared-quota risk to defend against. Recorded in `ai-context/DECISIONS.md` as its own
    entry, mirroring how the USDA free-tier acceptance itself was recorded. Judgment call: the
    30/min/user threshold — chosen generously above any legitimate single-user burst while still
    meaningfully capping a runaway client/script; qa-reviewer's own ~24-call test file and the
    developer's own 6-call test file both stay well under it, confirmed by running them.
  - **Verification**: `npm run lint` / `npx tsc --noEmit` clean. `npm test`: **326/326** (261 prior
    + a net 65 new: `openfoodfacts.test.ts`, `usda.test.ts`, `rate-limit.test.ts`,
    `BarcodeScanner.test.tsx`, plus the updated/added cases in qa-reviewer's own
    `lookup.qa.test.ts` and the developer's `search/route.test.ts`). `npm run build` clean. Full
    `npm run test:e2e` from a clean `supabase db reset`: **169/170 passed** — the one failure is the
    already-documented pre-existing flaky `phase4-acceptance.spec.ts` "no-future metric date (UTC
    browser)" test (see the 2026-07-25 Notes entry below), reconfirmed unrelated to this change, not
    a new regression. All 27 tests in `e2e/phase6-acceptance.spec.ts` passed, including B-1's
    regression test ("collapsing Add detail after a pick must not silently drop the candidate
    quantity") and the updated N-1 hung-proxy test.
  - **Note on `supabase db reset` itself**: hit the same pre-existing, time-of-day-dependent
    `supabase/seed.sql` bug the prior developer session already discovered and documented (below,
    2026-07-27 Notes) — worked around it the same way (a temporary local-only edit, reverted via
    `git checkout -- supabase/seed.sql` before finishing) to get a clean reset for verification. No
    seed change is part of this delivery.

- [x] **`supabase/seed.sql`'s time-of-day-dependent `db reset` failure investigated, root-caused
  for real, and fixed (developer, 2026-07-27).** This bug had been flagged twice (Phase 6 developer
  and qa-reviewer sessions above) but only worked around and reverted, never actually fixed — this
  session investigated it properly per that open item.
  - **Reproduced live, not just reasoned about.** Docker/local Supabase was available. Confirmed via
    direct `psql`: this Postgres image's session `TimeZone` is `UTC` (`show timezone` → `UTC`), so
    Postgres's bare `current_date` is always **the UTC calendar date**, never `America/Chicago`'s.
    At the moment of testing (`now()` = `2026-07-27 03:1x UTC`), `current_date` = `2026-07-27` while
    `(now() at time zone 'America/Chicago')::date` = `2026-07-26` — i.e. real Chicago local time had
    not yet reached its own midnight. Ran `npx supabase db reset` at that exact moment against the
    **unmodified** seed script and reproduced the failure on demand:
    `ERROR: new row for relation "food_entries" violates check constraint
    "food_entries_not_future_day"`.
  - **Root cause, precisely.** The generator built each day's `consumed_at` as
    `((current_date - day_offset)::text || ' ' || slot_time)::timestamp at time zone
    'America/Chicago'` — i.e. it took the **UTC** calendar date, glued on a Chicago wall-clock time
    string, and converted *that* to a UTC instant. The `set_consumed_local_date` trigger then
    reverses this (`consumed_at at time zone consumed_tz`) to get back a `consumed_local_date` that,
    by construction, always equals the literal UTC `current_date` used to build the string — **not**
    Chicago's real current date. The `food_entries_not_future_day` CHECK, meanwhile, correctly
    compares against `(now() at time zone consumed_tz)::date` — Chicago's *real* current date, from
    the actual instant. Every day, for the ~5-6 hours between UTC midnight and Chicago's own midnight
    (Chicago trails UTC by 5h in CDT / 6h in CST), UTC's `current_date` is one calendar day ahead of
    Chicago's actual date — so the `day_offset = 0` row was generated one day into Chicago's future
    for that whole window, tripping the CHECK and failing the entire seed (and therefore the whole
    `db reset`, since Postgres seeding runs as one script/transaction). This confirms — with an actual
    live repro, not just the secondhand description — that the previously-reported cause ("uses UTC
    `current_date` reinterpreted as `America/Chicago` local time") was directionally correct, and adds
    the precise mechanism (which specific CHECK, which specific comparison, and the exact ~5-6-hour
    daily window) that the earlier secondhand report didn't include.
  - **Evaluated as a small, well-understood fixture-arithmetic correction, not a design change** —
    per the task framing and `AGENTS.md`'s own "don't derive 'today' from the server's clock or naive
    UTC-truncation" guidance (this seed script was doing exactly that). No architect loop needed.
  - **Fix**: both 90-day generators (`daily_metrics` and `food_entries`) now anchor "today" on
    `(now() at time zone 'America/Chicago')::date` instead of the bare `current_date` — the same
    now()-derived Chicago date the `food_entries_not_future_day` CHECK itself uses, and (since
    Postgres's `now()` is stable for the whole transaction) guaranteed to be the exact same value the
    CHECK sees when it runs moments later in the same seeding transaction. `day_offset = 0` therefore
    always resolves to *equal* Chicago's real current date (never a day ahead), for any real
    wall-clock time in any timezone the machine running `db reset` happens to be in — the fix doesn't
    depend on the host OS's timezone at all, only on the container's `now()`, which is a real UTC
    instant regardless. (`daily_metrics`' own `metric_date <= current_date + 1` CHECK is loose enough
    that it was never actually failing from this — its generator was still switched to the same
    now()-derived anchor for consistency, so both generators share one correct notion of "today.")
  - **Verified, not just asserted**: re-ran `npx supabase db reset` at `2026-07-27 03:18 UTC` — still
    inside the exact previously-failing window (confirmed via the same `psql` check immediately
    before: `current_date` = `2026-07-27`, Chicago actual today = `2026-07-26`) — and it now succeeds.
    Directly queried the seeded data afterward: the third account's `food_entries.consumed_local_date`
    and `daily_metrics.metric_date` both max out at exactly `2026-07-26`, matching
    `(now() at time zone 'America/Chicago')::date` precisely (the CHECK's own boundary — equality
    passes). Checked git history/stash for the prior sessions' temporary workaround to compare against
    — none was preserved (they reverted via `git checkout`, as documented), so this fix was derived
    independently from the root-cause analysis above, not copied from a discarded patch.
  - **Full regression check**: `npm test` → **326/326** (unchanged — this is a fixture-only change,
    no application logic touched). `npx playwright test` against the freshly-reset DB → **169/170**;
    the one failure (`phase4-acceptance.spec.ts` "no-future metric date (UTC browser)") is unrelated
    to this fix — confirmed by re-running it standalone (fails identically) and via `git stash` (fails
    identically against the pre-existing, unmodified working tree too, and that test doesn't touch the
    third seeded account at all — it creates its own throwaway test user). Matches the failure already
    documented repeatedly elsewhere in this file as a pre-existing, unrelated flake.

- [x] **Phase 7 (Saved meals) implemented** (developer), against the design doc's §8 Phase 7 scope,
  following Jeff's 2026-07-27 approval of Phase 6. Types `Meal`/`MealItem` added to `lib/types.ts`
  (mirroring `FoodEntry`'s quantity/unit/per-unit + generated `calories`/`protein_g` shape, minus
  the `consumed_at`/tz fields a saved-meal item doesn't have). New pure domain validators in
  `lib/domain/validation.ts` — `validateMealInput` (name only), `validateMealItemInput` (same shape
  as `validateFoodEntryInput` minus date/time), `validateLogMealInput` (which meal + date/time,
  reusing the existing `DATE_PATTERN`/`TIME_PATTERN`/15-minute-grid rules) — and a new pure module
  `lib/domain/meal-items.ts` (`groupMealItemsByMeal`, `computeReorderedSortOrders`), each with unit
  tests; `lib/domain/totals.ts`'s existing `sumEntries` and `nutrition.ts`'s `proteinCaloriePct` are
  reused as-is for meal totals/protein-%, per the task brief — no duplicate summation logic added.
  Server actions `lib/actions/meals.ts`: `createMeal`/`updateMeal`/`deleteMeal`;
  `addMealItem`/`updateMealItem`/`deleteMealItem`/`reorderMealItems`; and `logMealForDay` — the
  phase's single most load-bearing piece of logic. `logMealForDay` resolves the target meal *and*
  its items via the same RLS-scoped server client used for the session check, strictly before any
  insert (with a belt-and-suspenders explicit `.eq("user_id", user.id)` on top of RLS, matching this
  codebase's existing convention on mutations) — a foreign or nonexistent `mealId` therefore
  resolves to zero rows and a generic `meal_not_found` error, with **no** `food_entries` insert ever
  attempted, making the `logged_from_meal_id` ownership invariant true by construction rather than
  by convention (see `ai-context/DECISIONS.md`'s "`logged_from_meal_id` stays a plain FK..." and this
  session's new Phase 7 entry). An empty meal (zero items) is rejected with `error: 'empty_meal'`
  before any insert. The whole batch shares one `consumed_at`/`consumed_tz` (computed once via the
  existing `localInputToUtcInTz`) and is written as a single multi-row `INSERT` — one Postgres
  statement, atomic per-statement, which is what makes "future-cap/cross-user rejection writes zero
  rows" hold without needing an explicit transaction. The no-future-day cap is checked up front via
  the existing `localDateNotAfterToday`, exactly like `food.ts`'s add/edit actions.
  Components: `components/meals/MealForm.tsx` (create/rename, name only),
  `components/meals/MealItemForm.tsx` (add/edit one item — **fields always visible, no progressive
  disclosure**, per the 2026-07-19 "Progressive disclosure" decision's explicit meal-item carve-out;
  embeds the Phase 6 `FoodLookupPanel`, add-mode only, mirroring `FoodEntryForm`'s own scoping),
  `components/meals/MealList.tsx` (the saved-meals library: one card per meal with item
  count/totals/protein %, expand to manage items with up/down reorder + edit/delete, rename,
  delete-cascades-items), and `components/meals/MealsView.tsx` (client orchestrator owning the
  RLS-scoped browser-client read + refetch-after-mutation loop, mirroring `FoodDayView`'s
  established pattern). `app/(app)/meals/page.tsx` (CRUD only, per the design doc's module-tree
  comment — no logging UI here) and a new "Meals" nav link. On `/food`:
  `components/food/LogMealDialog.tsx` (pick a saved meal + `date max=today` + the existing
  96-value quarter-hour `<select>` from `datetime.ts`, defaulting to the floor-of-now time) is
  embedded in `FoodDayView` between `DailyTotals` and `FoodEntryForm`; a successful log updates
  `FoodDayView`'s `lastConsumedAt` smart-default tracker to the batch's shared `consumed_at`,
  exactly like a single manual save does, and refreshes the day. `FoodEntryList.tsx` gained a
  small `bg-sage-pale text-ink` "From a saved meal" badge on any entry with a non-null
  `logged_from_meal_id`, per the design doc's "meal-batch rows ... are labeled" (§3.4).
  **Four implementation choices flagged as deviations/implicit decisions** (none pinned down to the
  letter by the design doc's §8 Phase 7 bullet) — full reasoning in `ai-context/DECISIONS.md`'s new
  "Phase 7 implementation choices..." entry: (1) the belt-and-suspenders explicit `user_id` filter
  on `logMealForDay`'s meal read, on top of RLS; (2) `MealsView`/`LogMealDialog` add their own
  client-orchestrator layer rather than a literal reading of the doc's flatter component list,
  mirroring the already-accepted `FoodDayView` pattern; (3) `LogMealDialog` is a plain inline
  expand/collapse panel (matching the existing `FoodLookupPanel` expander convention), not a native
  `<dialog>`/modal — this codebase has no modal precedent; (4) `meals`/`meal_items` are fetched as
  two independent flat queries grouped client-side via the new `groupMealItemsByMeal`, rather than
  one PostgREST embedded select, since `meal_items`' FK to `meals` is the *composite*
  `(meal_id, user_id)` key and embedding for composite FKs isn't exercised anywhere else in this
  codebase.
  **A real bug found only by manually driving the feature in a browser** (not by any automated
  test, and not by the unit-level integration test below either): `MealsView`'s first draft
  unmounted `MealList` on *every* refresh (swapping to a full "Loading…" placeholder), including
  the routine refreshes `onChanged` fires after adding/editing/deleting/reordering an item or
  renaming a meal — since `MealList` owns real local UI state (which meal card is expanded, which
  item is mid-edit), this silently collapsed the very card the user was actively working in right
  after they added the item they were adding. Fixed with a `hasLoadedOnce` flag scoping the big
  loading placeholder to the true initial load only; a background refresh after a mutation now
  keeps `MealList` mounted (and its state intact). Full writeup, including why `FoodDayView`'s
  outwardly-similar loading-branch swap was never at risk of the same bug, is in
  `ai-context/DECISIONS.md`.
  **Verification**: `npm run lint` / `npx tsc --noEmit` clean; `npm test` **354/354** (326 prior +
  28 new: 6 `meal-items.test.ts` + 22 new `validation.test.ts` cases across the three new
  validators). `npm run build` clean, `/meals` route present alongside the existing routes.
  Docker/local Supabase was available this round — after two `supabase db reset`s and one full
  `npx playwright test` run each, the **only** failures observed were `Failed to create e2e test
  user` / HTTP 502 errors from a transiently-unhealthy `supabase_auth` container in the seconds
  right after `db reset` restarted every container (confirmed directly via `curl` against the admin
  API returning 502 "An invalid response was received from the upstream server", and via `docker
  ps` showing `supabase_vector` mid-restart-loop at the same moment) — an **environmental** flake,
  not a regression: waiting ~15s (or a clean `supabase stop && supabase start`) for the containers
  to report healthy and re-running produced a clean pass every time; not caused by, and not
  specific to, this session's changes. With a healthy stack: a throwaway Vitest integration test
  (`meals.throwaway.test.ts`, written, run, then deleted per the established Phase 5/6 "not part of
  the delivered suite" precedent — qa-reviewer owns Phase 7's real acceptance tests) exercised the
  real `lib/actions/meals.ts` functions against the real local Postgres/RLS by mocking
  `@/lib/supabase/server`'s `createClient` to return a plain `@supabase/supabase-js` client signed
  in as a real confirmed test user (the action code never touches anything Next-specific on the
  `supabase` object itself) — **7/7 passed**, specifically confirming: meal CRUD (create, two items
  in both input modes, rename, item edit recalculates the generated total, reorder, item delete,
  meal delete cascades its remaining item at the DB level); an empty meal is rejected by
  `logMealForDay` with zero `food_entries` rows written; a two-item meal batch-inserts exactly 2
  rows sharing one `consumed_at`/tz/`consumed_local_date` and one exact-timestamp group, each
  stamped with the correct `logged_from_meal_id`; the future-day cap rejects the whole batch with
  zero rows written; **the critical cross-user case** — `logMealForDay` called with another user's
  real, non-empty `mealId` fails with `error: 'meal_not_found'` and zero rows written for either
  user, confirmed via a direct admin-client count before/after — plus a second cross-user check
  that `updateMeal`/`deleteMeal`/`addMealItem` against a foreign meal id all fail or no-op
  (RLS + the composite FK), never mutating the real owner's data; and editing/deleting a meal after
  logging it never changes the already-logged `food_entries` row's name/calories, only nulling
  `logged_from_meal_id` on delete (`ON DELETE SET NULL`). A second throwaway Playwright script
  (also written, run, then deleted) manually drove the full UI flow end-to-end in a real browser
  (create meal -> add two items in both input modes -> rename -> reorder -> log via
  `LogMealDialog` on `/food` -> confirm both entries + the "From a saved meal" badge + updated day
  totals -> delete the meal -> confirm the logged entries survive with the badge now gone) with
  zero console errors, and a second cross-user browser scenario confirming user B's `/meals` and
  `LogMealDialog` picker never show user A's meal at all — this is what caught the `hasLoadedOnce`
  bug above (an automated assertion never pinned "the panel stays open across a background
  refresh"). Full regression suite re-run after the `hasLoadedOnce` fix, against a freshly
  `db reset` + confirmed-healthy stack: unit 354/354, e2e **170/170** (all pre-existing tests,
  zero new failures), lint/typecheck/build clean.
- [x] **Phase 7 qa-reviewed** (qa-reviewer). Independent acceptance suite written from the design
  doc's §6 scope (not from the developer's throwaway test), `e2e/phase7-acceptance.spec.ts`, 29
  tests — covering the `logged_from_meal_id` ownership invariant (cross-user and nonexistent
  `mealId`, zero rows written, verified via a service-role admin read, not just the action's return
  value), saved-meal CRUD through the real actions, `logMealForDay` batch semantics (shared
  `consumed_at`/tz/local_date, exact-timestamp grouping, `daily_food_totals` reflecting the batch,
  two logs at different times forming two groups), the empty-meal rejection, meal edits/deletes
  never rewriting already-logged history (`ON DELETE SET NULL` on `logged_from_meal_id` only), the
  future-day cap on the whole batch, RLS re-verified through the `meals`/`meal_item` action surface,
  the `MealList` `hasLoadedOnce` fix surviving a post-mutation refresh, and the reused Phase 6
  `FoodLookupPanel` inside `MealItemForm` (prefill-only, never auto-submit, offered on add but not
  edit). **Verdict: ready to gate to production, no blocking findings.** 8 non-blocking notes
  (N-1 through N-8), summarized here for the record (full detail was in qa-reviewer's own review,
  not persisted as a separate file in this repo):
  - **N-1**: a tampered/garbled `logTz` (e.g. `"Not/AZone"`) crashes `logMealForDay` with an
    uncaught `RangeError` instead of a graceful field error — confirmed **not** a new Phase 7 defect
    (byte-identical behavior reproduces against Phase 3's `addFoodEntry` with a tampered
    `consumedTz`); zero rows written either way, so no data-corruption risk, purely an
    ungraceful-error-handling gap. **Fixed — see below.**
  - **N-2**: `reorderMealItems` isn't atomic (one `UPDATE` per item, no transaction) and doesn't
    validate `orderedIds` against the meal's actual current items before writing. **Not fixed —
    logged in Up Next per Jeff's explicit instruction to defer.**
  - **N-3**: `addMealItem`'s next-`sort_order` read-then-insert has a race window (two concurrent
    adds could compute the same `sort_order`). **Not fixed — logged in Up Next.**
  - **N-4**: `deleteMeal`/`deleteMealItem`/`reorderMealItems` return `{ ok: true }` even when the
    `id`/`user_id` filter matches zero rows (e.g. an already-deleted or foreign id) — indistinguishable
    from a real deletion at the return-value level (RLS/ownership itself is not bypassed; this is
    about the ambiguity of the response, not a security gap). **Not fixed — logged in Up Next.**
  - **N-5**: raw Postgres/Supabase error strings (`error.message`) can reach the UI unfiltered on
    unexpected failures, rather than being mapped to a friendly message. **Not fixed — logged in
    Up Next.**
  - **N-6**: `MealsView`'s refresh-after-mutation has no stale-response guard (unlike
    `TodaySummary.tsx`, which correctly uses one) — a rapid sequence of mutations could in principle
    render a stale response last. **Not fixed — logged in Up Next.**
  - **N-7**: `lib/actions/meals.ts` — the security-critical file in this phase (the
    `logged_from_meal_id` ownership invariant lives here) — shipped with zero direct/persistent
    test coverage; only the pure domain helpers it calls into had unit tests, and the developer's own
    real-Postgres exercise of the actions (`meals.throwaway.test.ts`, per the Phase 7 Completed entry
    above) was written, run, and then deleted rather than kept in the suite. **Fixed — see below.**
  - **N-8**: this file's own history (the Phase 3 qa-review completion note and the "Node version pin
    added" note that follows it) misdiagnoses a real `npm test` crash as caused by "Node 24 vs. the
    repo's Node 20 pin" — qa-reviewer reproduced the *exact same* crash on Node 20 from a
    lowercase-drive-letter working directory (`/c/Sandbox/...` in Git Bash) and confirmed it
    disappears when re-entering via the canonical-cased path (`C:/Sandbox/...`). The real root cause
    is the path casing, not the Node version. **Corrected — see below** (the original entries are
    left in place per this file's append-corrections convention; a new Notes entry cross-references
    them rather than rewriting history).
- [x] **Phase 7 qa-review fix-ups: N-1, N-7, N-8** (2026-07-28, developer). Jeff asked for these
  three specifically; N-2 through N-6 above are deliberately **not** fixed, only logged (see Up Next).
  - **N-1 fix**: added `isValidTimeZone(tz: string): boolean` to `src/lib/domain/datetime.ts` —
    tries constructing `Intl.DateTimeFormat("en-US", { timeZone: tz })` in a try/catch (confirmed by
    direct testing that this throws a `RangeError` for garbled input like `"Not/AZone"`, an empty
    string, whitespace, a bare UTC offset like `"UTC+9"`, and oversized input, and never throws
    itself); this is the same constructor every other tz-aware helper in that module already depends
    on internally, so validating with it is the most reliable check available (considered but
    rejected `Intl.supportedValuesOf("timeZone")` — newer/less universally available, and can omit
    legitimate resolvable aliases). Wired into **both** `src/lib/actions/food.ts` (`addFoodEntry`/
    `updateFoodEntry`, via the shared `parseAndValidateFoodEntryForm`) and `src/lib/actions/meals.ts`
    (`logMealForDay`), immediately after each action's existing "missing tz" check and before any
    call to `localDateNotAfterToday`/`localInputToUtcInTz` — both now return the existing
    `error: "invalid_timezone"` shape (matching the codebase's established short-code convention:
    `"future_date"`, `"meal_not_found"`, `"empty_meal"`) instead of throwing, with **zero rows
    written**, confirmed the same way the rest of this codebase already confirms "zero rows written"
    (a service-role admin read, not just the action's return value). 8 new unit tests for
    `isValidTimeZone` in `datetime.test.ts` (real IANA zones, UTC, garbled/empty/whitespace/offset-
    string/oversized input, and a "never throws" assertion) — unit total now **362 → 375** together
    with N-7's tests below.
  - **N-7 fix**: added two new, **persistent** (not throwaway) developer-owned integration test
    files — `src/lib/actions/meals.test.ts` (13 tests) and `src/lib/actions/food.test.ts` (2 tests,
    scoped narrowly to the N-1 fix on that file, since full `food.ts` CRUD coverage wasn't part of
    this ask) — both exercising the real Server Action functions against a real local Postgres/RLS
    instance, following the exact pattern the deleted `meals.throwaway.test.ts` already established
    (mock `@/lib/supabase/server`'s `createClient` to return a REAL anon-key client already signed in
    as a specific test user via `e2e/helpers/user-client.ts`, so `supabase.auth.getUser()` and every
    RLS-scoped query hit real Postgres) — except this time kept in the suite rather than deleted.
    `meals.test.ts` covers: `createMeal`/`updateMeal`/`deleteMeal` CRUD (incl. cascade and a blank-name
    rejection with zero rows written); the `logged_from_meal_id` ownership invariant — a foreign
    `mealId` and a nonexistent `mealId` both rejected with zero rows written anywhere (checked via a
    service-role read across *both* users, not just the caller), and a successful log's rows verified
    to carry the caller's own `user_id`/`logged_from_meal_id`; the empty-meal rejection; the
    future-day cap (tomorrow rejected, today succeeds); and the N-1 fix itself
    (`logMealForDay` with a garbled `logTz`). Requires a running local Supabase instance and skips
    itself cleanly via Vitest's `describe.skipIf` when the required env vars aren't present — notably
    **CI's "Unit tests" step, which deliberately runs BEFORE the ephemeral Supabase stack is started**
    (see `.github/workflows/ci.yml`), so this doesn't turn `npm test` into a hard DB dependency.
    Getting the skip path to actually work reliably surfaced two real `vitest.config.ts` gaps, both
    fixed as part of this change (full detail in the new Notes entry below): (a) `@next/env`'s
    `loadEnvConfig` silently loads nothing under Vitest's `NODE_ENV="test"` (Next's own documented
    `.env.local`-skipped-under-test precedence) — worked around by temporarily presenting
    `NODE_ENV="development"` for just that one call, then restoring it; (b) test files run in
    separate worker processes that don't inherit the orchestrator process's `process.env` mutations,
    so the Supabase vars must be forwarded explicitly via Vitest's `test.env` config option — and
    naively forwarding `process.env.X` when `X` is `undefined` doesn't leave the var unset in the
    worker, it sets it to the **literal string `"undefined"`** (truthy!), silently defeating the
    `describe.skipIf(!hasSupabaseEnv)` guard; fixed with a small `definedEnvOnly()` helper that omits
    unset keys entirely. Verified both directions directly, not just assumed: with `.env.local`
    removed and the Vite/Vitest dep cache cleared, both new test files log a "Skipping: ... not set"
    warning and every test shows as skipped; with `.env.local` present (Docker/local Supabase was
    available this round), all 13 + 2 tests pass against the real stack. Unit total: **375/375**
    (362 prior + 8 N-1 tests + 13 N-7 `meals.test.ts` tests + 2 N-7 `food.test.ts` tests = 375; note
    362 was already inclusive of everything through the "Seed a third account" commit).
  - **N-8 fix**: corrected, not rewritten — see the new 2026-07-28 Notes entry below, which
    cross-references the two specific prior entries (the Phase 3 qa-review completion note and the
    "Node version pin added" note immediately after it) that misattributed the crash to "Node 24",
    and records qa-reviewer's actual root cause (a lowercase-drive-letter working directory in Git
    Bash). The original entries are left in place per this file's convention of appending
    corrections rather than silently editing history (mirrors how `ai-context/DECISIONS.md` handles
    supersession).
  - **Verification** (2026-07-28): `npm run lint` clean; `npx tsc --noEmit` clean; `npm test`
    **375/375** (against a live local Supabase — the new N-7 integration tests actually ran, not
    just skipped); `npm run build` clean (only the pre-existing `middleware`→`proxy` deprecation
    warning). Full e2e re-verification via a clean `supabase db reset` + a *freshly started* dev
    server (an already-running, hours-old dev server from earlier work was killed first — per this
    file's own 2026-07-25 "reproduce against a freshly started `npm run dev`" lesson, a stale server
    is a known source of false failures in this suite): **198/199 passed**; the one failure
    (`phase3-acceptance.spec.ts` "day pct is calorie-weighted ratio-of-sums...") is on the
    already-documented list of pre-existing `FoodDayView` `Day`-input-race flakes (see the
    2026-07-25 Notes entries) — re-ran in isolation and it passed cleanly, confirming it's the known
    flake, not a new regression. `e2e/phase7-acceptance.spec.ts` re-run standalone twice: **29/29**
    both times.

- [x] **Phase 7b ("Save a logged meal group as a Saved Meal") implemented** (2026-07-30,
  developer), against the architect's finalized design doc §3.3/§3.4/§8 Phase 7b and
  `ai-context/DECISIONS.md`'s four 2026-07-30 entries. Per Jeff's explicit instruction, the one
  optional cosmetic item in §5 (an advisory note when a group's entries already carry a
  `logged_from_meal_id`) was **not built** — skipped entirely, no TODO left.
  - **`lib/domain/meal-items.ts`** gained `mealItemsFromEntries(entries: FoodEntry[]):
    MealItemDraft[]` — copies only `name`/`quantity`/`unit`/per-unit calories+protein plus a fresh
    `0..N-1 sortOrder`, deliberately dropping `id`/`user_id`/`consumed_at`/`consumed_tz`/
    `consumed_local_date`/`logged_from_meal_id`/the generated `calories`/`protein_g` totals. Orders
    by `created_at` then `id` (never trusts the caller's input order or `consumed_at`, since a real
    group's entries share one identical `consumed_at` by definition and so cannot break the tie).
    9 new unit tests (exact field-copy set, shuffled-input reordering, a same-`created_at` tie
    broken by `id`, single-entry, empty).
  - **`lib/actions/meals.ts`** gained `createMealFromEntries(prevState, formData)` — the exact
    mirror of `logMealForDay`: re-reads the requested `food_entries` rows via the RLS-scoped server
    client (`.in("id", entryIds).eq("user_id", user.id)`, never service-role, never trusting any
    client-supplied name/calorie values), with a **count check** that rejects the whole request
    (`error: "entries_not_found"`) if fewer rows come back than unique ids were requested — a
    foreign id, a nonexistent id, and a mixed own/foreign set all collapse to this same path, so a
    partial meal can never be silently created. Empty `entryIds` → `error: "no_entries"` before any
    DB read. Blank name → the existing `validateMealInput` field error (no new validator needed,
    confirmed reusable as-is). On `meal_items` insert failure, a **compensating delete** removes the
    just-created `meals` row (best-effort; an unlikely-but-accepted residual empty-meal state if the
    delete itself also fails — see the design doc §5 and the DECISIONS entry). Nothing in the
    function issues an UPDATE/DELETE against `food_entries` — verified by code inspection, not just
    asserted in a comment, since that property isn't otherwise enforceable.
  - **`src/components/food/SaveGroupAsMealDialog.tsx`** (new) — an inline expander (no modal, per
    the established `LogMealDialog`/`FoodLookupPanel` convention) with a **blank, autofocused**
    "Meal name" field (settled by Jeff — no prefill from the group's items), a read-only item
    preview built straight from the `entries` prop, and Save/Cancel. Renders its own `<form>` —
    confirmed safe (not nested inside `FoodEntryForm`'s `<form>`) both by reading the component tree
    and, per the design doc's explicit "do not skip" callout, by actually clicking Save in a real
    browser (see Verification below).
  - **`src/components/food/FoodEntryList.tsx`** — each meal-group header is now a small action bar;
    "Save as meal" toggles a per-group `savingGroupKey` local state (this is the component's first
    real local UI state) and opens `SaveGroupAsMealDialog` beneath that group's header. A successful
    save closes the expander and calls the new optional `onGroupSavedAsMeal?: (meal: Meal) => void`
    prop — no day refetch, since the operation is strictly read-only on `food_entries`.
  - **`src/components/food/FoodDayView.tsx`** — the required prerequisite fix: gained the identical
    `hasLoadedOnce` treatment `MealsView.tsx` already carries from Phase 7 (a flag that scopes the
    full-size "Loading…" placeholder to the true *initial* load only, so a background `refresh()`
    triggered by an unrelated add/edit/delete no longer swaps `FoodEntryList` out for a placeholder
    and loses whichever group's "Save as meal" expander was open mid-typing). Also wired
    `onGroupSavedAsMeal` into the existing transient `savedMessage` mechanism (`Saved as "<name>".`).
  - **Unit tests**: `src/lib/domain/meal-items.test.ts` (+9, see above) and 23 new integration tests
    in `src/lib/actions/meals.test.ts` (kept in the persistent suite, following the qa-reviewer-N-7
    precedent of real Server Action calls against real local Postgres/RLS, not mocked) — faithful
    3-entry copy with correct order/sort_order/matching totals; source entries byte-identical after
    the save (including `updated_at` and `logged_from_meal_id`); a one-entry group saves and then
    logs successfully via `logMealForDay` (not caught by `empty_meal`); a full round-trip
    (save → `logMealForDay` the new meal → reproduces the source group's items/totals as one exact-
    timestamp group); independence in both directions (deleting the new meal leaves the source
    entries untouched; editing a source entry afterwards leaves the meal's item untouched); a group
    whose entries already carry `logged_from_meal_id` (from a real prior `logMealForDay`) saves fine
    as a fully independent clone, with the original meal and the source entries' back-reference both
    unmodified; blank name and empty-`entryIds` rejections write nothing; and the security-critical
    cross-user cases — another user's real entry id, a mixed own+foreign set, and a nonexistent id —
    all rejected with `entries_not_found` and **zero** `meals`/`meal_items` rows written anywhere,
    verified via the service-role admin client across both users, not just the action's return
    value. One test-seeding gotcha worth recording: the first draft of the ordering test seeded all
    three entries via a single multi-row `INSERT`, which gives every row the *exact same*
    `created_at` (Postgres's `now()` is stable for a whole statement) — defeating the
    `created_at`-then-`id` ordering assertion in a way that doesn't reflect real usage (each entry is
    actually logged via its own separate request/statement). Fixed by seeding one row per statement
    in a loop.
  - **Verification**: `npm run lint` / `npx tsc --noEmit` clean. `npm test` **395/395** (375 prior +
    9 `meal-items.test.ts` + 23 `meals.test.ts`, run against a live local Supabase so the new
    integration tests actually executed, not skipped — before this session's addition of these 23,
    the prior integration count already included the 13+2 from the N-7 fix-up; some of the 375→395
    delta is these new files, some is pre-existing tests whose exact historical count in this file
    may have drifted slightly — not chased down further since the actual `npm test` run is the
    source of truth, not the arithmetic). `npm run build` clean (only the pre-existing
    `middleware`→`proxy` deprecation warning). A clean `supabase db reset` succeeded on the first try
    (confirming the earlier seed.sql time-of-day fix still holds). **Manually drove the feature
    end-to-end in a real browser** via a throwaway Playwright script (written, run, then deleted —
    not part of the delivered suite, per the established Phase 5/6/7 practice) against a freshly
    started dev server: logged two items in one sitting (confirmed they grouped under one header),
    opened "Save as meal", confirmed the name field opens blank, typed a partial name, then — the
    design doc's explicitly-required manual check — added a third, unrelated entry to trigger a
    background day refresh **while the expander was still open**, and confirmed both the expander
    and its in-progress typed name survived (the `hasLoadedOnce` fix actually working, not just
    passing a unit test); completed the save by clicking "Save meal" (confirming the dialog's
    `<form>` isn't nested inside another `<form>` by a real click, not just by reading the JSX);
    verified the new meal in `/meals` with its items; confirmed the source `food_entries` rows were
    untouched (`logged_from_meal_id` still null) via a direct service-role read; and confirmed a
    second, unrelated user sees neither the meal in `/meals` nor any option to log it from `/food`.
    Zero unexpected browser console errors. Also ran the full pre-existing e2e suite afterward: a
    parallel full run showed 20 failures, but re-running every one of those files standalone with
    `--workers=1` showed only the 9-10 already-documented pre-existing `FoodDayView` `Day`-input-race
    flakes failing (see the 2026-07-25/2026-07-26 Notes entries) — the other ~11 (phase4/phase5/
    phase7-acceptance, fetch-error-handling) all passed cleanly under `--workers=1`, confirming those
    were parallel-run resource contention (many workers hitting one shared local Supabase instance
    simultaneously), not a regression. Additionally confirmed, via a scoped `git stash` of only this
    session's changed files (leaving other already-dirty, unrelated files in the tree untouched),
    that one of the Day-input-race failures reproduces byte-identically **without** any Phase 7b
    code present — the flake is confirmed pre-existing, not introduced by this work.
  - **No deviations from the design doc's §3.3/§3.4/§8 Phase 7b's own scope were needed** — the doc
    was written specifically detailed enough (down to the exact error-code names and the
    `mealItemsFromEntries` signature) that Phase 7b itself was a comparatively literal
    implementation. The one place a judgment call was made and is worth flagging: the doc doesn't
    specify the exact wording of `createMealFromEntries`'s user-facing error messages beyond the
    short codes (`no_entries`/`entries_not_found`/`unauthenticated`); `SaveGroupAsMealDialog.tsx`'s
    `friendlyError()` helper maps them to plain sentences, following the same pattern
    `LogMealDialog.tsx` already established for `logMealForDay`'s error codes.
    **Correction (2026-07-30, qa-reviewer's B-1 finding):** the statement above is accurate only for
    Phase 7b's own scope — it is **not** an accurate description of everything in this diff.
    The same working tree also carried several earlier, already-Jeff-approved-in-conversation fixes
    that predate Phase 7b and were never recorded: a "Clear" button on `FoodEntryForm`
    (`onClear`/`resetToNow` props, `resetReason`/`addFormResetNonce` state), a `scrollIntoView` on
    entering edit mode, `FoodDayView.handleSaved` no longer advancing `lastConsumedAt` on an edit
    (only on an add), `FoodEntryList` group-header times switching to 12-hour AM/PM via
    `formatTimeLabel`, and a `roundTo(…, 2)` display-rounding fix for summed protein totals in both
    `FoodEntryList.tsx` and `MealList.tsx` (the latter a Phase 7 file). None of these are defects —
    the full suite was green — but two of them (the `lastConsumedAt` change and the AM/PM change)
    revise things this project's own docs had previously stated on the record, and none of the five
    had a DECISIONS.md entry, a design-doc update, or test coverage until now. All five are now
    properly recorded in `ai-context/DECISIONS.md` (three new entries: `lastConsumedAt`-on-edit,
    "Clear"'s reset-to-now behavior, and the AM/PM amendment — the "Clear" button and the AM/PM
    display and protein-rounding fixes needed no DECISIONS entry of their own beyond what's captured
    there, being straightforward additive UI/display fixes with no real tradeoff to weigh), the
    design doc's §3.4 and `FoodEntryList` description are corrected to match current behavior, and
    two new e2e tests in `e2e/food-logging.spec.ts` ("Clear resets all fields and the time back to
    floor-of-now..." and "editing an existing entry does not move the smart same-sitting default
    backward...") pin the two previously-untested behavior changes. Jeff's explicit call was to
    document these in place rather than split them out of the diff or route them through the
    architect — he had already made each of these calls directly earlier in the same conversation
    that produced this diff, so what was missing was purely the paperwork this correction supplies,
    not a design decision that still needed making.

- [x] **Phase 7b qa-reviewed** (2026-07-30, qa-reviewer). Independent acceptance suite written from
  the design doc's §6 "Save a logged group as a Saved Meal" block, §3.3/§3.4/§5 and §8 Phase 7b —
  **not** derived from the developer's `meal-items.test.ts`/`meals.test.ts` (those were read only
  after the suite was written, to check for gaps). New file `e2e/phase7b-acceptance.spec.ts`, **23
  tests, all green**. Deliberately drives the REAL Server Action through the REAL browser form (not
  a mocked `createClient`), so every ownership check is exercised across the actual Next.js Server
  Action boundary; every "was anything written?" assertion goes through the service-role admin
  client across *both* users, per the Phase 7 evidentiary bar. The browser is pinned to
  `timezoneId: "UTC"` and all fixtures are seeded on *today*, which sidesteps the documented
  pre-existing `FoodDayView` `Day`-input race entirely rather than inheriting it.
  **Verdict: one blocking finding (B-1, a scope/process finding — not a defect in the feature
  itself), plus 6 non-blocking notes. The Phase 7b feature as specified is correct and, on its own,
  would be ready to gate.**
  - **What was independently verified and passes**: the ownership invariant is real, not just
    claimed — a foreign entry id alone, a **mixed own+foreign set**, and a nonexistent id are all
    rejected wholesale with **zero** `meals`/`meal_items` rows written for either user (verified by
    a service-role read, not the action's return value); ids are tampered directly in the DOM's
    hidden `entryIds` inputs, i.e. the way a hostile client actually would. Copy-by-value is
    faithful (name/quantity/unit/per-unit exact, `sort_order` 0..N-1 in logged order). The
    generated-column invariant holds *per row*, not just in aggregate: with deliberately non-integer
    inputs (1.75 x 205.33, 2.5 x 165.55) each `meal_items.calories`/`protein_g` equals its source
    entry's exactly — proving both sides ran the same `round(quantity x per_unit)` expression rather
    than a total being copied across. Source `food_entries` are **byte-identical** after the save
    (full-row deep equality, which catches any field, plus explicit `updated_at` and
    `logged_from_meal_id` assertions). A one-entry group saves and then logs fine (not caught by
    `empty_meal`); the full round-trip reproduces the source group's items/totals as one
    exact-timestamp group; independence holds in both directions; a group already carrying
    `logged_from_meal_id` clones cleanly with the original meal, its items, and the entries'
    back-reference all untouched and no reference chain between the two meals. Blank name,
    whitespace-only name, and empty `entryIds` all reject with zero rows. A duplicated entry id
    dedupes to one item rather than bypassing the count check.
  - **The name field genuinely opens blank** — asserted on the input's `.inputValue()` (not merely
    that a `placeholder` attribute exists), plus that it is autofocused, that no item name leaked in
    as a default, and that reopening after a cancel still opens blank. Jeff's override of the
    architect's prefill recommendation is intact.
  - **The compensating delete is proven to work, with a negative control — not just reviewed.**
    The design doc allowed "verify by review if fault injection proves impractical"; it proved
    practical. A temporary `BEFORE INSERT` trigger on `meal_items` (installed and dropped via
    `docker exec ... psql`, always in a `finally`) forces the *second* statement to fail while the
    first succeeds. Result: the action errors and **zero** `meals` rows survive. A separate
    negative-control test then performs the identical two statements *without* a compensating delete
    and confirms the orphan meal **does** survive — so the meal's disappearance in the first test can
    only be the action's own cleanup, not an artefact of the whole thing failing atomically anyway.
  - **The explicitly-rejected cosmetic advisory note is genuinely absent** from the dialog (asserted
    on the rendered form's text for a group whose entries carry `logged_from_meal_id`), and
    `createMealFromEntries` performs no read of `meals` for the source — confirmed by code reading.
  - **The `hasLoadedOnce` prerequisite works**: with an expander open and a partially-typed name,
    both adding an unrelated entry and deleting an unrelated entry (each triggering a real background
    `refresh()`) leave the expander open and the typed name intact. This is the bug class that has
    burned this repo twice and had no automated assertion anywhere until now — it does now.
  - **Adversarial code review of `createMealFromEntries`** (the security-critical piece): `user_id`
    comes only from `supabase.auth.getUser()`; the entries read is the RLS-scoped server client with
    a belt-and-suspenders `.eq("user_id", user.id)`; the count check compares against the
    **deduplicated** id list, so a repeated id can't be used to pad the count past a foreign one;
    `meal_items.user_id` is set from the session and the composite `(meal_id, user_id)` FK makes it
    structurally impossible for items to attach anywhere else. There is exactly **one**
    `.from("food_entries")` in the whole function and it is a `.select()` — no UPDATE, no DELETE, no
    relink (grepped, not eyeballed). No service-role client anywhere in the path; a production build
    was grepped for the actual configured `SUPABASE_SERVICE_ROLE_KEY` value and it appears nowhere in
    `.next` at all. Foreign and nonexistent ids collapse to the same `entries_not_found`, so there is
    no enumeration oracle.
  - **Full regression run**: `npm test` **395/395**; `npx playwright test --workers=1` against a
    freshly started dev server and a healthy local Supabase stack — **222/222 passed, zero failures**
    (199 pre-existing + 23 new). Notably even the historically flaky `FoodDayView` `Day`-input-race
    cases passed, consistent with the documented "fresh dev server + serial workers" finding.
    `npm run lint` and `npx tsc --noEmit` clean; `npm run build` clean (only the pre-existing
    `middleware`-to-`proxy` deprecation warning). No `git stash` bisection was needed — nothing
    failed.

  **B-1 (BLOCKING — scope/process, not a defect in the feature).** The working tree Phase 7b arrived
  in contains **undocumented changes well outside §8 Phase 7b's In-scope list**, in files the
  developer's own PROGRESS entry does not mention, under an entry that states *"No deviations from
  the design doc's §3.3/§3.4/§8 Phase 7b were needed."* That statement is not accurate for the
  change-set as it stands, and Jeff would be approving these without knowing they are in it. None is
  broken — the full suite is green — but three are real design surface that skipped the architect,
  and one contradicts written spec text:
  1. **`FoodEntryForm.tsx`/`FoodDayView.tsx`: a new "Clear" button** (new `onClear`/`resetToNow`
     props, plus `resetReason`/`addFormResetNonce` state and a re-keying of the add form from
     "add-<selectedDate>-<lastConsumedAt>" to "add-<selectedDate>-<nonce>"), and a new
     `scrollIntoView` on entering edit mode. This is **new user-facing behaviour on the everyday
     logging path**, appearing in no design doc section, no DECISIONS entry, and no PROGRESS entry,
     with no test coverage.
  2. **`FoodDayView.handleSaved` no longer advances `lastConsumedAt` when the save was an *edit***
     (only on an add). This **directly contradicts design doc §3.4**, which states "on submit
     `lastConsumedAt` updates to the just-saved `consumed_at` (following any manual time the user
     set)", and it changes the behaviour of a recorded decision — the smart `consumed_at` default
     that exact-timestamp meal grouping depends on. The inline comment argues the new behaviour is
     better and it may well be, but that is an architect call on a recorded decision, not an
     undocumented developer-side change. No test pins either behaviour.
  3. **`FoodEntryList.tsx`: group-header times now render via `formatTimeLabel`** ("08:15 AM" instead
     of "08:15"). `ai-context/DECISIONS.md`'s 2026-07-26 entry says of exactly this: *"The list's
     lack of AM/PM is a separate pre-existing inconsistency; deliberately **out of scope** here, not
     silently changed."* It has now been silently changed. Existing e2e assertions use
     `toContainText("12:30")`, which still passes, so nothing caught it.
  4. **Display rounding (`roundTo(..., 2)`) added to protein totals** in `FoodEntryList.tsx` **and in
     `MealList.tsx`** — the latter a **Phase 7 file currently awaiting Jeff's approval on an
     already-completed qa-review**. The change looks correct (it suppresses float noise like
     `5.9399999999999995` and leaves the unrounded sum feeding `proteinCaloriePct`), but it is
     undocumented and it silently widens the diff of an already-reviewed phase.
  **Recommended remedy** (either one, developer's/Jeff's call): (a) split items 1-4 out of this
  change-set so Phase 7b lands as the phase that was designed and reviewed, routing items 1-3 through
  the architect as their own change (item 4 is small enough to go straight to developer with a
  PROGRESS note); or (b) keep them, but record them properly first — a DECISIONS entry for the
  `lastConsumedAt`-on-edit semantics and for the group-header time format (both revise recorded
  decisions), a design-doc §3.4 amendment for the "Clear" control, a corrected PROGRESS entry, and
  test coverage for the two behaviour changes. Not blocking on *correctness*; blocking on "this is
  not the change Jeff is being asked to approve."

  **Non-blocking notes:**
  - **N-1**: a malformed (non-UUID) `entryId` surfaces the **raw Postgres error string** in the UI —
    verified live: the dialog renders `invalid input syntax for type uuid: "not-a-uuid"`. Zero rows
    are written and there is no security impact, but this is the same class as Phase 7's deferred
    **N-5** (raw `error.message` reaching the UI) recurring in brand-new code, and it is now reachable
    from a *client-supplied* value rather than only from an unexpected DB failure. Cheap fix: map an
    unrecognised `error` in `SaveGroupAsMealDialog.friendlyError` to a generic sentence instead of
    falling through to the raw string.
  - **N-2**: `createMealFromEntries` puts **no upper bound on `entryIds`**. Every id must resolve to
    the caller's own rows, so the blast radius is "a very large meal", but a scripted client can
    submit thousands of ids in one `.in(...)`, producing a very long PostgREST URL. Worth a simple cap
    (or at least a note) before Phase 8's multi-select starts driving this action with arbitrary id
    lists — exactly the case §3.3 anticipates.
  - **N-3**: while the expander is open, **two buttons in the same group are labelled "Cancel"** — the
    group-header toggle (which flips from "Save as meal" to "Cancel") and the dialog's own Cancel.
    This tripped Playwright strict mode and would be equally ambiguous for a screen-reader user
    tabbing the group. Suggest the header toggle read "Close", or keep it as "Save as meal" and rely
    on the dialog's Cancel.
  - **N-4**: `SaveGroupAsMealDialog`'s `useEffect` that fires `onSaved` carries an
    `eslint-disable react-hooks/exhaustive-deps` and depends on the whole `state` object. It is
    correct today (the component unmounts on success, so it cannot double-fire), but the reason is
    non-obvious and undocumented; a one-line comment would stop a future edit from re-introducing a
    double-callback.
  - **N-5**: the developer's own `src/lib/actions/meals.test.ts` covers the copy semantics and the
    cross-user rejections thoroughly, but has **no fault-injection test for the compensating delete** —
    the one row §6 singles out as needing either injection or an explicit "verified by review"
    statement. `e2e/phase7b-acceptance.spec.ts` now supplies it plus a negative control, so this is
    closed rather than outstanding; recorded only so the coverage's provenance is clear.
  - **N-6**: `MealsView`'s missing stale-response guard (Phase 7 **N-6**, deferred) applies verbatim to
    `FoodDayView`, and this phase makes it slightly more reachable: `FoodEntryList` now holds local UI
    state that survives background refreshes, so a late-landing stale `refresh()` response can repaint
    entries *underneath* an open expander. Still self-correcting, no data-integrity risk; noted so it
    lands in the same bucket as the existing deferred note rather than being rediscovered later.

- [x] **B-1 resolved; N-1 fixed** (2026-07-30, direct edit per Jeff's explicit instruction to
  document in place rather than split the diff or route through the architect — see the correction
  above in the Phase 7b implementation entry for the full list of what was bundled and why it didn't
  need a fresh design round). `ai-context/DECISIONS.md` gained three new entries: `lastConsumedAt`
  only advances on an add (not an edit — amends design doc §3.4, which is corrected to match), the
  "Clear" button's reset-to-now behavior (bypasses the smart same-sitting default on purpose), and
  the `FoodEntryList` group-header AM/PM change (amends the 2026-07-26 entry's "deliberately out of
  scope, not silently changed" note, which is now explicitly superseded rather than contradicted).
  Two new e2e tests added to `e2e/food-logging.spec.ts` (new describe block, using "today" throughout
  to avoid the documented `Day`-input race entirely): "Clear resets all fields and the time back to
  floor-of-now, discarding a manually-picked time", and "editing an existing entry does not move the
  smart same-sitting default backward for the next new entry" (seeds an entry 45 minutes in the past
  — within the freshness window but distinct from a fresh add's floor-of-now — edits its name only,
  and asserts the next new entry still groups with the most recently *added* entry, not the edited
  one). **N-1 fixed**: `SaveGroupAsMealDialog.tsx`'s `friendlyError()` default case now returns a
  generic "Something went wrong saving this meal. Please try again." instead of echoing an
  unrecognized error code (or a raw Postgres error string, e.g. from a malformed entry id) verbatim
  to the UI. **Full verification**: `npm run lint` / `npx tsc --noEmit` clean; `npm test` **395/395**;
  a complete `npx playwright test --workers=1` run (the whole suite, not just the new/touched files)
  against a freshly started dev server — **224/224 passed, zero failures** (222 prior + 2 new). One
  environmental snag along the way, not a code issue: an initial parallel-workers run left a stray
  `qa7b_block_items` trigger on `meal_items` from `phase7b-acceptance.spec.ts`'s fault-injection test
  (installing/dropping a DB-wide trigger isn't safe under concurrent workers hitting one shared local
  Supabase instance — the same class of parallel-run contention already documented elsewhere in this
  file). Confirmed via direct `psql \d meal_items`, dropped it, and re-ran serially — clean both
  times, with no trigger left behind afterward either. This is the same reason qa-reviewer's own
  verification of this file was run with `--workers=1`, now confirmed necessary rather than just
  cautious.

- [x] **Phase 7c ("Saved-meals library: ordering, filtering, and counts") implemented** (2026-07-30,
  developer), against the architect's finalized design doc §3.3/§3.4/§5/§6/§8 Phase 7c and
  `ai-context/DECISIONS.md`'s "Saved-meals list scaling is a findability problem..." entry, in
  response to Jeff's "could the meals page get out of control?" question raised while testing
  Phase 7b. Per the design doc's explicit Out-of-scope list, **no** migration/index, pagination,
  `.limit()`/cap, combobox, fuzzy matching, item-name matching, URL-persisted filter state, or
  change to `MealList`'s expand-by-default behavior was built — the fix is ordering + an in-memory
  filter + a count over the already-fully-fetched list, nothing else.
  - **`src/lib/domain/meals.ts`** (new, meal-*level* ordering/filtering — kept out of the
    item-level `meal-items.ts`, per its own doc comment): `sortMealsByName(meals)` — case-insensitive
    alphabetical (`localeCompare` on lowercased names, so `"apple"` sorts before `"Banana"`, not
    after), ties broken by `created_at` then `id` (duplicate meal names are explicitly legitimate —
    §5), returns a new array, does not mutate the input. `filterMealsByName(meals, query)` —
    case-insensitive, AND-of-whitespace-separated-tokens **substring** match on `meal.name` only
    (item/ingredient names are deliberately not searched, per §4's rejected-alternative (d)); an
    empty or whitespace-only query returns the input **unchanged, in its given order** (identity,
    not "no results" — the specific bug that would blank the page on an untouched/just-cleared
    filter box).
  - **`src/components/meals/MealsView.tsx`**: the `meals` query's `.order("created_at")` became
    `.order("name")` (a deterministic base order from the DB — belt-and-suspenders, matching this
    codebase's redundant `.eq('user_id')` posture), and the fetched array is now run through
    `sortMealsByName` then `filterMealsByName` (fed by a new local `filterQuery` state) before being
    handed to `MealList` — `sortMealsByName` remains the actual ordering authority regardless of the
    query's own collation, exactly as §3.4 specifies. Added a `<input type="search">` "Filter meals"
    field with a real `<label>` (reusing the shared `labelClass`/`inputClass` from
    `components/ui/styles.ts`, not a one-off style), rendered only when `meals.length > 0` (hidden at
    zero meals — no filtering an empty list). A count readout sits beside it: `"40 saved meals"`
    when the filter is empty, `"Showing 3 of 40"` when it isn't. **The two empty states are threaded
    through, not conflated**: a new `noMatches` flag (`meals.length > 0 && visibleMeals.length ===
    0`) makes `MealsView` render its own `No meals match "<query>".` message and skip rendering
    `MealList` entirely in that case; when the library is genuinely empty (`meals.length === 0`),
    `MealList` is still rendered as before and its existing "No saved meals yet. Create one above to
    get started." branch fires unchanged — no edit to `MealList.tsx` was needed to get this right,
    since the empty-state branching lives entirely in which component `MealsView` chooses to render,
    not in a prop threaded into `MealList` itself. Typing never triggers a refetch — the filter runs
    against the array already held in `meals`/`items` state.
  - **`src/components/food/LogMealDialog.tsx`**: its own independent `meals` query (per this
    project's established "each screen owns its own read" convention — no state sharing with
    `MealsView`) also moved `.order("created_at")` → `.order("name")` and now applies
    `sortMealsByName` to the fetched rows before storing them in state, so the picker and `/meals`
    can never disagree on ordering. No combobox/custom widget was built — it stays a plain native
    `<select>`, per the design doc's explicit call and the 2026-07-25/26 time-picker precedent it
    cites. The option label's existing shape (`{meal.name} ({totals.calories} kcal, {items.length}
    item...)`) already put the name first — confirmed, not changed — which is what lets the
    browser's native type-ahead prefix-match on the name.
  - **Unit tests**: `src/lib/domain/meals.test.ts` (13 tests) — covers every case §6 lists:
    case-insensitive ordering (not a raw codepoint sort), tie-breaking on identical names by
    `created_at` then `id` (deterministic and repeatable across re-sorts), non-mutation of the input
    and returning a genuinely new array, an empty list; and for the filter — empty query returns
    everything unchanged, whitespace-only query likewise, case-insensitive matching, substring (not
    prefix) matching, multi-token AND, tolerance of repeated/surrounding whitespace, an empty result
    when nothing matches, and an explicit assertion that item/ingredient names are never searched (so
    the deferred behavior can't silently creep back in). Unit total: **408/408** (395 prior + 13 new).
  - **Verification**: `npm run lint` / `npx tsc --noEmit` clean; `npm run build` clean (only the
    pre-existing `middleware`→`proxy` deprecation warning). Docker/local Supabase was already running
    this round. **Manually drove the feature end-to-end in a real browser** via a throwaway
    Playwright script (written, run, then deleted — not part of the delivered suite, per this
    project's established Phase 5/6/7/7b practice) against a freshly started dev server (a stale,
    hours-old dev server process left over from earlier work was killed first, per the documented
    "reproduce against a freshly started `npm run dev`" lesson): seeded a **60-meal** library for one
    test user (6 deliberately-named meals plus 54 filler meals) and confirmed, against the real
    running app rather than mocked assertions — the unfiltered count reads "60 saved meals" and all
    60 meals are actually rendered (proving no cap/`.limit()` crept in, per §6's "no data is hidden"
    row); a single-token filter ("chick") narrows to exactly the two matching meals and updates the
    count to "Showing 2 of 60"; a two-token filter ("chick rice") ANDs correctly down to one match;
    an unmatched filter shows the distinct `No meals match "zzzznomatch".` message with the
    zero-meals "No saved meals yet" copy correctly **not** shown; clearing the filter restores the
    full 60-meal view and count; alphabetical ordering is visibly correct on screen (`"apple
    oatmeal"` renders above `"Zebra breakfast bowl"`, confirmed via bounding-box Y positions, not
    just DOM order); and on `/food`, `LogMealDialog`'s `<select>` shows the same alphabetical order
    (`"apple oatmeal"` first, `"Zebra breakfast bowl"` last) with name-first option labels. Zero
    unexpected browser console errors during the run.
  - **No deviations from the design doc's §3.3/§3.4/§8 Phase 7c scope were needed** — the doc was
    specific enough (down to the exact function signatures, the DB `.order()` change, and the
    empty-state threading requirement) that this was a comparatively literal implementation, similar
    to how Phase 7b itself was described. One small implementation choice not pinned down to the
    letter: the empty-state distinction is threaded by having `MealsView` choose *whether* to render
    `MealList` at all (rather than adding a new prop to `MealList` for it), since that already
    satisfies "MealList's existing empty state now fires only for a genuinely empty library" with no
    change to `MealList.tsx` — flagged here as the one implementation-level judgment call, not a
    deviation from anything the doc required.
    **Correction (2026-07-30, qa-reviewer's Phase 7c B-1 finding):** the "no change to `MealList.tsx`"
    claim above is wrong for the delivered working tree, though not for a reason this developer
    session caused. `MealList.tsx`'s items-expanded-by-default change (see the dedicated entry below,
    "MealList shows a meal's items by default...") was made **directly, by Jeff and the assistant, in
    conversation, before this Phase 7c implementation session ever started** — it was already sitting
    in the working tree, undocumented, when this session began, and this session correctly never
    touched that file itself. The claim above was simply wrong about the state of the tree it was
    written against, not a deviation this implementation introduced. See that entry, and "B-1 resolved"
    below, for the actual fix.


- [x] **Phase 7c qa-reviewed** (2026-07-30, qa-reviewer). Independent acceptance suite written from
  the design doc's §3.4 "Finding a meal in a growing saved-meals library" block, §3.3 (helper
  contracts), §5 (both tripwires), §6's "Saved-meals library ordering, filtering and counts" rows
  and §8 Phase 7c's In/Out scope, plus `ai-context/DECISIONS.md`'s "Saved-meals list scaling is a
  findability problem..." entry — **not** derived from the developer's `src/lib/domain/meals.test.ts`
  or from `MealsView.tsx` (both read only afterwards, to look for gaps). Two new files:
  `src/lib/domain/meals.qa.test.ts` (24 unit tests) and `e2e/phase7c-acceptance.spec.ts` (19
  acceptance tests). **All 43 pass.**
  **Verdict: ONE BLOCKING finding (B-1) — a real regression, not a process nit. The Phase 7c feature
  itself is correct and, on its own, would be ready to gate; the change-set it arrives in is not.**
  Plus 5 non-blocking notes (N-1 through N-5).
  - **What was independently verified and passes.** The two rows §8 Phase 7c singles out to hammer
    both hold. *(1) The two empty states are genuinely distinct*: a 40-meal library with a typo'd
    filter renders `No meals match "chikcen".` and the "No saved meals yet. Create one above to get
    started." copy is asserted **absent** (a count-zero assertion, not merely "something rendered" —
    checking only the latter would pass even with the two states confused), while the readout still
    reads "Showing 0 of 40" so the user can see their library is intact; a genuinely-empty library
    still gets `MealList`'s create-your-first copy, with no filter box and no count. *(2) No data is
    hidden*: a 60-meal fixture renders all 60 cards on `/meals` (set-equality against the seeded
    names, so a `.limit(50)` leaving 50 cards would fail) **and** all 60 options in `LogMealDialog`'s
    `<select>` on `/food` — both surfaces, since a cap on either would be a silent data-loss bug.
    Also verified: one shared alphabetical order across both surfaces (meals seeded in a deliberately
    non-alphabetical, mixed-case order, so a surface still ordering by `created_at` or sorting by raw
    codepoint would diverge); every picker option label **starts with** the meal name with the
    `(N kcal, M items)` parenthetical following, which is the native-type-ahead contract §3.4 calls
    out; duplicate meal names order by `created_at` then `id` and stay put across a reload (proved via
    per-card item-count subtitles, since three cards all reading "Snack" are otherwise
    indistinguishable); filtering is case-insensitive in both directions, substring not prefix,
    AND-of-tokens with an explicit negative control that an OR implementation would fail, whitespace-
    tolerant, and identity on an empty/whitespace-only query; the count readout agrees with the
    rendered card count at every step; and **typing issues zero Supabase requests** (network calls to
    `/rest/v1/meals` and `/rest/v1/meal_items` counted across a nine-keystroke interaction and asserted
    unchanged from the post-initial-load baseline, with a sanity check that the listener does observe
    those calls, so the assertion cannot pass vacuously).
  - **Item-name matching is genuinely absent**, not just untested: a meal named "Breakfast" carrying a
    real seeded `meal_items` row named "Tuna salad" is asserted visible on the page first (so the
    negative cannot pass against a missing fixture), and filtering "tuna" then yields zero cards and
    the no-match message, while "breakfast" still matches. The deferred §4 behaviour cannot creep in
    unnoticed.
  - **Explicit non-goals confirmed not built** (grepped, not assumed): no `.limit()` anywhere in the
    touched files (the only one in `src/` is the pre-existing `sort_order` max lookup in
    `lib/actions/meals.ts`); no new migration (`supabase/migrations/` still holds exactly one file);
    no combobox/custom dropdown, no `role="listbox"`, no new dependency — the picker is still a plain
    native `<select>`; no pagination/virtualization/`range()`/`offset()`; the filter is component
    state with no router involvement, so it is genuinely not URL-persisted.
  - **Adversarial review of the pure module.** `sortMealsByName`/`filterMealsByName` are pure, take
    no client input beyond the query string, and touch no Supabase. My unit suite adds cases the
    developer's 13 did not cover: names differing **only** in case are treated as tied and fall
    through to the `created_at` tie-break (so the order can't flip depending on which spelling was
    fed first); determinism across **every rotation and reverse** of a fixture, not just one shuffle;
    order-preservation through the filter (it narrows a pre-sorted list, it must not re-order); an
    OR-vs-AND negative control; and that the query is matched as a **literal substring, not a
    pattern** — a RegExp-based implementation would throw on an unbalanced `(` and treat `.` as a
    wildcard, both realistic in free-text meal names. All pass.
  - **Full regression run**: `npm test` **432/432** (408 developer's + 24 new). `npm run lint`,
    `npx tsc --noEmit`, and `npm run build` all clean. `npx playwright test --workers=1` against the
    running dev server and a healthy local Supabase stack: **218 passed / 25 failed of 243** — see
    B-1; 10 of those 25 are the documented pre-existing `FoodDayView` `Day`-input-race flakes
    (`food-logging.spec.ts` x4, `phase3-acceptance.spec.ts` x5, `food-offgrid-edit.spec.ts` x1 —
    exactly the documented list, no new members), and the other **15 are a real regression**.

  **B-1 (BLOCKING) — the change-set breaks the existing Phase 7 acceptance suite: 15 of
  `e2e/phase7-acceptance.spec.ts`'s 29 tests now fail. Cause: an undocumented `MealList.tsx`
  behaviour change riding in the same working tree, NOT Phase 7c's own code.**
  - **The regression.** `src/components/meals/MealList.tsx` is **modified** in the delivered working
    tree (17 insertions / 3 deletions): its `expandedMealId: string | null` state (default `null`, so
    every card starts collapsed) is replaced by `collapsedMealIds: Set<string>` (default empty, so
    every card starts **expanded**). The expand/collapse button therefore renders as **"Hide items"**
    on first paint instead of "Manage items". `e2e/phase7-acceptance.spec.ts` — qa-reviewer's own
    Phase 7 suite, unchanged in this diff and recorded in this file as 29/29 twice — clicks
    `getByRole("button", { name: "Manage items" })` in **17 places**, every one of which now times
    out. Confirmed from the artifacts: `locator.click: Test timeout of 30000ms exceeded. Call log:
    waiting for getByRole('button', { name: 'Manage items' })`.
  - **Causation proved by bisection, not inferred.** A scoped `git stash push -- src/components/meals/MealList.tsx`
    (leaving `lib/domain/meals.ts`, `MealsView.tsx` and `LogMealDialog.tsx` — i.e. all of Phase 7c —
    in place) makes `e2e/phase7-acceptance.spec.ts` pass **29/29**. So Phase 7c's own code causes
    **zero** regressions; the entire 15-test failure set is attributable to the `MealList.tsx` change
    alone. The stash was popped and the tree restored afterwards.
  - **Why it was not caught.** The Phase 7c PROGRESS entry's Verification paragraph lists
    `lint` / `tsc` / `build` / unit **408/408** and a manual browser drive — it does **not** claim an
    e2e run, and no e2e run appears to have happened. Every prior phase in this file reports one.
  - **It is also undocumented, and the entry says the opposite.** The Phase 7c entry states that
    "no ... change to `MealList`'s expand-by-default behavior was built", and §8 Phase 7c's **Out**
    list explicitly names "any change to `MealList`'s expand-items-by-default behaviour (§5 open
    question — Jeff's call, not this phase's)". The diff contains exactly such a change. In fairness
    this is not a reversal of Jeff's decision — it *implements* it, and the design doc §5 and the
    DECISIONS 7c entry both already describe expand-by-default as current behaviour attributed to
    Jeff's own 2026-07-30 call — so the end state matches what the architect wrote. What is missing
    is that the implementation has **no PROGRESS Completed entry and no DECISIONS entry of its own**,
    and it shipped without the test updates it requires. This is the same class as Phase 7b's B-1
    (undocumented out-of-scope changes bundled into a phase whose entry says none were needed),
    recurring one phase later.
  - **Recommended remedy** (developer's/Jeff's call, but the direction looks clear): keep
    expand-by-default — it is Jeff's recorded decision and the design doc already assumes it — and
    **update `e2e/phase7-acceptance.spec.ts`'s 17 "Manage items" call sites** to match (most become
    "the items are already visible", a few become a "Hide items" toggle assertion), then give the
    change its own DECISIONS entry and PROGRESS Completed entry, and correct the Phase 7c entry's
    "no change to `MealList`" sentence. I deliberately did **not** edit `phase7-acceptance.spec.ts`
    myself: silently re-pointing an existing green acceptance suite at new behaviour would erase the
    evidence that the behaviour changed, which is precisely what B-1 is about. Note for whoever does
    it: two tests in my own `e2e/phase7c-acceptance.spec.ts` (the item-name-matching row and the
    add-item-while-filtered row) legitimately assume items are visible without a click, so they pass
    against the delivered tree and would need the same treatment if expand-by-default were ever
    reverted instead.

  **Non-blocking notes:**
  - **N-1 — there IS a silent server-side row cap, and it is not a `.limit()` anyone would grep for.**
    `supabase/config.toml` sets PostgREST's `max_rows = 1000`. Verified empirically rather than
    inferred: seeding 1050 `meal_items` rows for one user and running the app's exact query
    (`.from("meal_items").select("*").order("sort_order")`) returned **1000 rows with `error: null`**,
    while a `count: "exact"` probe on the same table returned 1050. Silent truncation, no error path.
    This does **not** affect Phase 7c's filter (which matches meal names, and `meals` would need 1000
    meals to truncate) and it is **pre-existing config, not introduced by this phase** — but it lands
    almost exactly on §5's stated revisit trigger: a ~200-meal library at ~5 items each is ~1000
    `meal_items` rows, past which some meal cards would silently render "0 items · 0 kcal" and the
    picker labels would be wrong, with the meal names themselves still listed so nothing looks broken.
    §5's tripwire is currently written only about someone *introducing* pagination or a `.limit()`;
    worth extending it to name this existing config cap, since it is the one mechanism that can make
    "the list is fully fetched" quietly false without anyone touching the query.
  - **N-2 — a second undocumented change in the diff**: `LogMealDialog.tsx`'s "Log a saved meal"
    trigger changed from a bare `<button className="...text-sage-deep...">` to
    `<Button variant="secondary">`. Cosmetic, correct, and arguably an improvement (it routes a
    one-off style through the shared primitive), but it is not in §8 Phase 7c's In list and appears in
    no PROGRESS or DECISIONS text. Flagged only so the diff Jeff approves is fully described.
  - **N-3 — the filter has no screen-reader announcement.** `MealsView` has no `aria-live`/
    `role="status"` anywhere: when typing narrows the list, neither the count readout ("Showing 3 of
    40") nor the `No meals match "…".` message is announced, so a screen-reader user gets no feedback
    that their query did anything. The design doc asked for a real `<label>` (correctly implemented,
    `htmlFor="meal-filter"`) but says nothing about announcements, so this is an addition, not a
    missed requirement. A `role="status"` on the count paragraph would cover both.
  - **N-4 — stale-response guard still absent**, exactly as Phase 7's deferred **N-6** described for
    `MealsView` (and the Phase 3 note for `FoodDayView`). Unchanged by this phase and no more
    reachable than before; recorded only so it stays in the same deferred bucket rather than being
    rediscovered as new.
  - **N-5 — a cosmetic edge in the filter-box visibility rule.** The filter box and count are gated on
    `meals.length > 0`, but `filterQuery` is not cleared when the library empties. Deleting the last
    meal while a filter is active hides the box with a stale query still in state; creating a new meal
    afterwards makes the box reappear with that old query still applied, so the just-created meal can
    be invisible. Self-explanatory in practice (the box reappears with its text visible) and fully
    recoverable, so this is a polish note, not a defect — clearing `filterQuery` when `meals.length`
    hits zero would close it.

- [x] **Phase 7c B-1 resolved** (2026-07-30, direct edit per Jeff's explicit instruction: document
  in place rather than split the diff or route through the architect — the same resolution pattern
  as Phase 7b's own B-1). Three things, all Jeff asked for by name:
  1. **`ai-context/DECISIONS.md`** gained a new entry, "`MealList` shows a meal's items by default,
     not behind a 'Manage items' click," recording the expand-by-default change itself (made
     directly, mid-conversation, in response to Jeff's live-testing feedback, well before Phase 7c
     existed) as a real decision with its own Why — and explaining, on the record, why it went
     unrecorded and untested against e2e until qa-reviewer's Phase 7c review surfaced it.
  2. **`e2e/phase7-acceptance.spec.ts` updated to match current behavior.** Removed the 13 now-
     redundant `getByRole("button", { name: "Manage items" }).click()` lines — items are visible
     without a click now, so nothing needs expanding first. The 4 `"Hide items"` visibility
     assertions immediately after former click sites were left in place; they're still meaningful,
     now additionally proving the list is expanded *from page load*, not just *after* a click.
     Re-running the file after just that fix surfaced **two more failures qa-reviewer's report
     didn't separately call out**: "deleting a meal removes it and cascades its items" and
     "deleting the whole meal leaves the logged rows' values intact" both did
     `page.getByRole("button", { name: "Delete" }).click()` with no scoping — previously
     unambiguous because the meal-level "Delete" was the only button with that name on a
     collapsed-by-default page, now ambiguous because every visible item row has its own "Delete"
     button too (Playwright correctly threw a strict-mode violation: 3 matching buttons). Fixed by
     scoping both to `.first()` (the meal-level "Delete" is first in DOM order — the card header,
     which is above the item list — verified this holds with only one meal seeded per test, which
     is the case in both). **`e2e/phase7-acceptance.spec.ts`: 29/29** after both fixes (confirmed
     via a full standalone run, not just the two previously-failing tests in isolation). Checked the
     rest of `e2e/` for the same unscoped-`"Delete"`-button pattern before calling this done — every
     other `getByRole("button", { name: "Delete" })` call site (`food-logging.spec.ts`,
     `phase3-acceptance.spec.ts`, `phase7b-acceptance.spec.ts`, `phase7c-acceptance.spec.ts`) was
     already row/group-scoped or already used `.first()`, so no other file needed the same fix.
  3. **The Phase 7c implementation entry's inaccurate "no change to `MealList.tsx`" sentence** was
     corrected in place with an appended note (this file's established convention — see how Phase
     7b's own B-1/N-8 corrections were handled — rather than silently rewriting history), pointing
     to the two entries that explain what actually happened.
  **max_rows = 1000 noted for later, not fixed now** (Jeff's explicit instruction — this is a
  "know about it" item, not a "fix it now" item): qa-reviewer's N-1 finding — `supabase/config.toml`
  sets PostgREST's `max_rows = 1000`, empirically confirmed to silently truncate any query past
  1000 rows with no error — is carried forward into Up Next below rather than actioned here.
  **Full verification**: `npm run lint` / `npx tsc --noEmit` clean. `npm test` **431/432** — the one
  failure, `src/lib/actions/meals.test.ts`'s "rejects a meal dated tomorrow and writes no rows," is
  a **pre-existing, timezone-boundary-dependent flake in a file this session never touched**
  (confirmed via `git status` — `meals.test.ts` is unmodified, already-committed from the earlier
  N-7 fix session) — its `localTomorrow()` helper derives "tomorrow" from the test runner's *system*
  local timezone while the test passes `logTz: "UTC"` explicitly, so near a UTC-vs-local day
  boundary (confirmed: this run was ~19:37 local against a `2026-07-31T00:3x` UTC timestamp in the
  test's own log output) "tomorrow" in system-local time can already equal "today" in UTC, so the
  future-day rejection legitimately doesn't fire. Same general class as this project's other
  documented UTC-boundary flakes (the Phase 4 "no-future metric date" test, the old `seed.sql` bug)
  — not fixed here, out of this session's scope, flagged for whoever next touches
  `lib/actions/meals.ts`'s test suite. `npx playwright test e2e/phase7-acceptance.spec.ts
  --workers=1`: **29/29** (confirmed twice — once right after the "Manage items" removal, surfacing
  the 2 "Delete" ambiguity failures, and once more after fixing those). Did not re-run the entire
  e2e suite end-to-end this session (the individually-affected file plus the standard lint/tsc/unit
  bar was judged sufficient given the fix's narrow, well-understood blast radius — only
  `phase7-acceptance.spec.ts` referenced `MealList`'s expand/collapse button or an unscoped
  page-level "Delete" button among the files checked above); **ready for Jeff's final approval.**

- [x] **Phase 8 ("Ease-of-entry extras — copy/repeat") implemented** (2026-07-31, developer),
  against `docs/architecture/food-weight-tracker.md` §3.3/§3.4/§6/§8's Phase 8 bullet, now that
  Phase 7/7b/7c are all approved and the shared `FoodEntryList` group-header surface Phase 7b built
  is available for it to extend.
  - **`copyFoodEntries(input)`** (new, `src/lib/actions/food.ts`) — the single shared server action
    all three ease-of-entry mechanisms funnel through, per the 2026-07-19 "Copy/repeat entries via
    one shared `copyFoodEntries` primitive" decision. Mirrors `createMealFromEntries`'s (Phase 7b)
    ownership pattern exactly: re-reads the source `food_entries` rows via the RLS-scoped client
    (never service-role, never trusting client-supplied name/calorie values), rejects a foreign id/
    nonexistent id/mixed own-and-foreign set as one whole-request `entries_not_found` (never a
    silent partial copy), rejects an empty selection (`no_entries`), a garbled `toTz`
    (`invalid_timezone`), and a future `toDate` (`future_date`) — all checked before any insert, so
    copying can't be used to route around the no-future-day cap. `logged_from_meal_id` is never
    carried over (simply omitted from the insert, defaulting to `null`) — a copy is a fresh manual
    log, not a meal-logging event, per the existing decision. When `toTime` is omitted, each row
    preserves its *own* source local time-of-day on the new date (so a copied exact-`consumed_at`
    group — whose entries share one source instant by definition — lands on one new shared instant
    and stays grouped); when `toTime` is supplied, every row uses that one explicit time instead.
    One multi-row `INSERT` (atomic per-statement), matching this codebase's established rationale
    for why "future-cap/cross-user rejection writes zero rows" holds without an explicit
    transaction.
  - **`validateCopyFoodEntriesInput`** (new, `src/lib/domain/validation.ts`) — pure validation for
    `entryIds`/`toDate`/optional `toTime`, reusing the existing `DATE_PATTERN`/`TIME_PATTERN`/
    15-minute-grid rules rather than duplicating them.
  - **`CopyDayDialog.tsx`** (new) — inline expander on `/food` (matching the established
    `FoodLookupPanel`/`LogMealDialog`/`SaveGroupAsMealDialog` expander convention, no modal) that
    copies every entry on the currently-viewed day onto a picked target date (default/max today);
    hidden entirely when the viewed day has nothing to copy.
  - **`CopyGroupDialog.tsx`** (new) — the second button the Phase 7b group-header action bar was
    built to hold, alongside "Save as meal": copies one exact-`consumed_at` group onto a picked
    date, with no time field (relies on `copyFoodEntries`'s time-of-day-preserving default so the
    group stays grouped on the new day).
  - **`FoodEntryList.tsx`** — added a "Log again" button per entry row, and wired "Copy this group"
    into the existing group-header action bar as a second, mutually-exclusive expander alongside
    "Save as meal".
  - **`FoodDayView.tsx`** — wired `CopyDayDialog`, a `handleLogAgain` handler (always targets
    "today," floor-of-now quarter-hour time — consistent with every other smart-default already in
    this app), and a shared `handleCopied` success callback that only refreshes the day view when a
    copy actually lands on the day currently being viewed.
  - **Unit tests**: `validateCopyFoodEntriesInput` cases added to `src/lib/domain/validation.test.ts`,
    plus a full integration-test suite for `copyFoodEntries` added to `src/lib/actions/food.test.ts`
    against real local Postgres/RLS (following the established `describe.skipIf`-gated pattern) —
    whole-day copy, a group copy staying grouped, the explicit-`toTime` override ("Log again"),
    `logged_from_meal_id` dropped even when copying a real `logMealForDay`-produced entry,
    future-date rejection, cross-user/mixed-set rejection, empty-selection rejection, and garbled-tz
    rejection — all verified via service-role reads, not just the action's return value.
  - **Verification, independently re-run and confirmed, not just taken from the developer's own
    report**: `npm run lint` / `npx tsc --noEmit` clean; `npm test` **452/452** (with a live local
    Supabase instance, so the new integration tests actually ran, not skipped). The developer's own
    report additionally states: `npm run build` clean; a full `npx playwright test --workers=1` run
    at **243/243 passed, zero regressions** (including every Phase 7/7b/7c suite); and a manual,
    real-browser end-to-end pass via a throwaway Playwright script (written, run, then deleted, per
    this project's established practice) confirming Log again / Copy this group / Copy this day all
    insert real rows with `logged_from_meal_id = null`, cross-user isolation holds, the future-date
    cap is enforced, and zero console errors — these specific claims were not independently
    re-executed this session, only the lint/tsc/unit results above were.
  - **Deviations/implicit decisions flagged by the developer, not yet reviewed by qa-reviewer**:
    (1) multi-select ("Copy selected") was **not built** — the design doc's own §8 Phase 8 bullet
    frames it as optional, so only the three named mechanisms (copy-day, log-again, copy-group) were
    treated as required scope; (2) the dashboard's "copy previous day" quick-add mentioned in §3.1's
    module tree was **not built** — not named in §8 Phase 8's actual In-scope bullet, and the current
    dashboard is deliberately minimal per later phases' decisions; (3) `CopyGroupDialog.tsx` is a new
    file not explicitly named in the design doc's module tree (only the "Copy this group" button
    itself is specified) — built mirroring `SaveGroupAsMealDialog.tsx`'s shape; (4) "Log again"'s
    "now" is floor-of-current-quarter-hour, not the literal second — a deliberate consequence is that
    logging again within the same 15-minute window as another recent entry correctly merges into the
    same exact-timestamp group by design, not a bug; (5) the `no_entries`/`entries_not_found` error
    short-codes are the developer's choice, mirroring `createMealFromEntries`'s convention, not
    spelled out letter-for-letter in the design doc.
  - **Known-deferred-class issues the developer flagged for qa-reviewer's attention**: the group
    header's own toggle button re-uses the label "Cancel" while the open dialog has its own distinct
    "Cancel" button — the same ambiguity already deferred as Phase 7b's N-3, now present a second
    time for "Copy this group"; no stale-response guard on the new async handlers (same deferred
    class as Phase 3/7's N-6); and `copyFoodEntries` has no upper bound on `entryIds` size (same
    class as Phase 7b's deferred N-2 for `createMealFromEntries`), now also reachable via "Copy this
    day" on an unusually large day. None of these were fixed — flagging for qa-reviewer to weigh,
    consistent with how the equivalent Phase 7b findings were handled.
  - **Ready for qa-reviewer.**

- [x] **Phase 8 qa-reviewed** (2026-07-31, qa-reviewer). Independent acceptance/action-level suite
  written from the design doc's §3.3/§3.4/§6/§8 spec (not from the developer's own test files,
  which were read only afterwards to look for gaps): `e2e/phase8-acceptance.spec.ts` (20 real-UI
  acceptance tests), `src/lib/actions/food.qa.test.ts` (20 action-level tests against real
  Postgres/RLS — added specifically because `CopyDayDialog`/`CopyGroupDialog` build `entryIds` from
  React props read through the RLS-scoped browser client, so there's no hidden DOM input to tamper
  with; the real hostile-client surface is a direct Server Action call, which this file exercises),
  and `src/lib/domain/validation-copy.qa.test.ts` (10 pure-unit tests). **All 50 pass.**
  **Verdict: no blocking findings — ready to gate to production.** In contrast to Phase 7b and 7c,
  the change-set stayed tightly scoped to §8 Phase 8's In list, and every deviation was proactively
  disclosed in the developer's own PROGRESS entry before this review — the undocumented-scope-creep
  pattern that produced a B-1 in each of the last two phases did not recur (checked for it
  specifically via `git diff --stat` and hunk-level review, not assumed).
  **Independently verified and confirmed passing**: the ownership invariant (a foreign id, a
  nonexistent id, a mixed own+foreign set, and a duplicate-padding attempt `[mine, mine, foreign]`
  all reject the whole request with zero rows written for either user, verified via service-role
  reads — foreign and nonexistent are indistinguishable, no enumeration oracle); `logged_from_meal_id`
  is genuinely never carried over, including when copying an entry that itself came from a real
  `logMealForDay` batch; the future-day cap is checked before any read/write and holds from both UI
  entry points even with the `<input max>` attribute stripped from the DOM, and a shape-valid but
  calendar-overflowing date (`YYYY-MM-99`) can't smuggle a future row past the DB CHECK backstop;
  copy-day preserves each entry's own distinct time-of-day (three sources stay three groups) while
  copy-group lands its entries on one shared new instant and stays one group (asserted through
  `groupByConsumedAt` itself); source entries are byte-identical before/after (full-row deep
  equality including `updated_at`); generated `calories`/`protein_g` columns match exactly on
  non-integer inputs, proving the same generated expression ran on both sides, not a copied total;
  and adversarial code review of `copyFoodEntries` found exactly one `.select()` and one `.insert()`
  against `food_entries` (no UPDATE/DELETE), `user_id` always from `getUser()`, and no client-supplied
  value reaching any inserted name/nutrition field. Also reconfirmed no nested-`<form>` regression
  and that `hasLoadedOnce` holds for the new copy expanders across a background refresh.
  **8 non-blocking notes (N-1 through N-8):**
  - **N-1**: multi-select ("Copy selected") wasn't built — agreed non-blocking (§6's Phase 8 scope
    doesn't require it, and "Copy this group" already satisfies requirement (c)), but the design
    doc's §3.4/§8 text still describes it as if built; recommend the doc be amended to match.
  - **N-2**: the dashboard "copy previous day" quick-add from §3.1's module tree was never built —
    a **pre-existing** divergence (the dashboard has been `TodaySummary`-only since Phase 3), not
    introduced by Phase 8, and not in §8 Phase 8's actual In list; same recommendation to amend the
    doc.
  - **N-3**: `CopyDayDialog` shows a stale error message on reopen — confirmed live: trigger a
    rejected copy, close the panel, reopen it, and the old error is still displayed before any new
    action. `CopyDayDialog` stays mounted across the open/close toggle and doesn't reset `state`;
    `CopyGroupDialog` is immune only because it unmounts on cancel. Cosmetic, no data risk.
  - **N-4**: "Log again" from a past day gives no feedback about *where* the entry went — it
    correctly logs to today (per spec) but the view stays on the past day with no visible new row,
    and the toast doesn't name the destination date (unlike the day/group copy toasts, which do).
    Behavior is correct; only the feedback is thin.
  - **N-5**: the group header's toggle button re-uses the label "Cancel" while `CopyGroupDialog`
    itself has its own "Cancel" button — the same two-"Cancel"-buttons ambiguity already deferred as
    Phase 7b's N-3, now recurring for the new "Copy this group" control too.
  - **N-6**: a group whose entries share an exact `consumed_at` but have *different* `consumed_tz`
    values (only reachable via a direct DB insert, or a timezone change between two sub-second
    logs) would split into separate instants on copy rather than staying one group, since each
    copy's time-of-day is derived per-entry from its own source tz — a very-low-severity edge case
    against §3.3's "stays grouped" language; the current per-entry behavior is judged correct for
    the (far more common) copy-*day* case, so no change recommended.
  - **N-7**: no upper bound on `entryIds`, and no stale-response guard on the new async handlers —
    both already flagged by the developer, both confirmed real, both the same deferred class as
    Phase 7b's N-2/N-6, which Jeff already marked trivial/scale-only on 2026-07-31. No action
    recommended.
  - **N-8**: qa-reviewer's own `e2e/phase7b-acceptance.spec.ts` has a latent fixture flake (a
    `pastInstant()` helper that clamps near UTC midnight, occasionally colliding two distinct
    fixture entries into one group) — proven **pre-existing**, not a Phase 8 regression, via a
    scoped `git stash` of all Phase 8 code reproducing it identically. qa-reviewer's own new Phase 8
    suite avoids the same trap by using fixed `todayAt("HH:MM")` fixtures instead. Recommend the
    same fix be applied to `phase7b-acceptance.spec.ts` (and worth checking `phase7c`'s fixture
    helpers for the same pattern) — not fixed as part of this review, logged for whoever picks it up.
  **Full regression run**: unit **481/482** (one failure — `meals.test.ts` "rejects a meal dated
  tomorrow" — is the already-documented pre-existing UTC-boundary flake, PROGRESS item 0-pre-b, in a
  file Phase 8 never touched; independently re-confirmed this session), e2e **261/263** (the other
  failure is the also-already-documented pre-existing `phase4-acceptance.spec.ts` "no-future metric
  date (UTC browser)" flake, touching only `daily_metrics`/`MetricForm`, files Phase 8 doesn't
  touch), lint/typecheck/build clean (lint and typecheck independently re-run and confirmed clean
  this session). Both failures are explained by the run landing in the ~00:05–00:20 UTC window,
  exactly their documented trigger. **Ready for Jeff's approval.**

- [x] **Phase 8's N-8 fixed** (2026-08-01, qa-reviewer): the latent fixture flake in qa-reviewer's own
  `e2e/phase7b-acceptance.spec.ts`. Root cause (as originally reported): `pastInstant(minutesAgo)`
  clamped to `startOfUtcDay + 1000` to avoid spilling into yesterday, which meant that within ~70
  minutes of UTC midnight, two distinct `minutesAgo` values (e.g. 70 and 65) both clamped to the same
  instant — collapsing two fixture entries meant to be separate meal groups into one, and failing
  "deleting an unrelated entry does not collapse an open expander" on a Playwright strict-mode
  violation (a group-scoped "Delete" locator matching 2 buttons instead of 1). Fixed by replacing
  `pastInstant()` with a fixed-time-of-day `todayAt("HH:MM")` helper (all 25 call sites remapped to
  17 distinct quarter-hour times, order-preserving with the original `minutesAgo` values so every
  distinctness/ordering relationship the tests relied on is unchanged) — `todayAt` never reads the
  clock's time-of-day, only the calendar date, so two distinct literals can never collide regardless
  of when the suite runs. Fixture-only change: no assertion, test name, or behavioral expectation was
  touched.
  **Verification was more than "ran it once"**: simulated all 1440 minutes of a day and confirmed the
  old helper collided for 66 of them (00:00–01:05 UTC) while the new helper collided for zero, and
  that all 17 remapped fixture times stay pairwise distinct at every minute. Also ran a **negative
  control** — a temporary copy of the spec with the two fixtures forced back onto one instant,
  executed at 14:30 UTC (well outside the old collision window) — which reproduced the original
  failure verbatim, confirming the test is genuinely sensitive to the collision rather than the
  failure merely not appearing to happen; the temp file was deleted afterward. Full file: **23/23**
  (independently re-run and confirmed this session, including the specific
  previously-flake-prone test). `pastInstant` confirmed gone from the codebase (grepped, zero
  matches). `e2e/phase7c-acceptance.spec.ts` was audited and found to need no fix (it seeds no
  `consumed_at` fixtures at all); `e2e/phase5-acceptance.spec.ts`'s relative-time helper uses whole-
  day offsets with no collision risk. Full regression: unit 482/482, e2e 263/263 (an intermediate run
  against a several-hours-old dev server produced the 10 already-documented pre-existing
  `FoodDayView` `Day`-input-race failures — none in a file this fix touched — which cleared to 26/26
  then 263/263 after restarting the server and clearing `.next`, another data point reinforcing that
  known, still-open, unrelated bug).
  **One new, different flake found and deliberately NOT fixed, flagged instead**:
  `e2e/food-logging.spec.ts`'s "editing an existing entry does not move the smart same-sitting
  default backward" (line ~402) uses `new Date(Date.now() - 45 * 60_000)` — a genuinely different
  failure mode from N-8 (this one is about a fixture spilling onto *yesterday's local date* and never
  rendering on today's `/food` view, broken for 45 of 1440 *local* minutes, 15 of which have no valid
  substitute fixture at all, since the test needs an on-grid instant that's simultaneously in the
  past, inside the 120-minute freshness window, and distinct from floor-of-now). A fixed time isn't a
  safe drop-in replacement here the way it was for N-8; the honest fix is either a documented skip
  in that window or restructuring the scenario — judged a call on this developer-owned behavioral
  test's semantics rather than something to reshape unilaterally. Logged in Up Next for whoever picks
  it up; not yet fixed.

- [x] **Phase 8b designed** (2026-07-31, architect), resolving Phase 8 qa-review's N-1 (multi-select
  described in the doc as if built, when Phase 8 deliberately shipped without it) and N-2 (a stale
  §3.1 dashboard "quick-add + 'copy previous day'" module-tree line). A new "### Phase 8b —
  Multi-select bulk actions on the day's log" section was inserted into
  `docs/architecture/food-weight-tracker.md` between Phase 8 and the existing Phase 9 (PWA-lite
  shell), numbered 8b rather than renumbering 9, following the same lettered-insertion precedent
  Phase 7b/7c already established. Full reasoning is in `ai-context/DECISIONS.md`'s new "Phase 8b
  designed..." entry; summary here:
  - **The phase adds zero server-action and zero `lib/domain/` code** — both `copyFoodEntries`
    (Phase 8) and `createMealFromEntries` (Phase 7b) already accept an arbitrary, group-agnostic
    entry-id list, so Phase 8b is client UI only.
  - **In scope**: an explicit "Select entries" mode on `/food` (not always-visible checkboxes) that
    hides the existing per-row/per-group action buttons while active; a new `EntrySelectionBar`
    ("N selected", "Copy selected", "Save selected as a meal", "Clear", "Done"); selection that
    deliberately **spans exact-`consumed_at` group boundaries** (the one thing multi-select can do
    that Phase 8's three mechanisms can't); reuse of `CopyGroupDialog`/`SaveGroupAsMealDialog`
    verbatim (parameterized wording only) rather than new twin components; selection state owned by
    `FoodDayView`, hoisted structurally above the `!hasLoadedOnce && loading` branch.
  - **"Save selected as a meal" is bundled into 8b**, not split into its own phase — a deliberate
    reversal of this project's usual small-phase bias, reasoned through explicitly in the DECISIONS
    entry (7b/7c were split because each was independently shippable and touched different files;
    neither holds here).
  - **Out of scope, explicitly**: bulk delete/edit, a sticky/floating bar, per-group or day-level
    "select all", any selection-size cap (same deferred class as Phase 7b N-2/Phase 8 N-7), and any
    dashboard control.
  - **N-2 resolved as a permanent descope, not a deferral**: the dashboard stays `TodaySummary`-only.
    The doc's §3.1 line is corrected to say so explicitly, so the question doesn't resurface
    undocumented later. Reasoning (a dashboard quick-add would duplicate or weaken `FoodEntryForm`;
    "copy previous day" is now a strict subset of what `CopyDayDialog` already does on `/food`; the
    dashboard's minimalism is reinforced, not contradicted, by Jeff's earlier sage-arc-removal call)
    is in the DECISIONS entry.
  - **A required implementation note carried into the design**: `e2e/phase8-acceptance.spec.ts`
    currently has a test asserting multi-select was NOT built — Phase 8b's implementation must
    update that test in the same change, the same stale-acceptance-test gap that produced a
    blocking B-1 in both Phase 7b's and Phase 7c's qa-reviews when missed.
  - **The refresh-safety requirement got structural treatment**, not just a reminder: this is the
    third component in this codebase to hold local UI state a background refresh can wipe (after
    `MealsView` in Phase 7 and `FoodEntryList` in Phase 7b, both of which shipped broken with no
    automated assertion catching it) — §6 gained a real acceptance row for it and an explicit
    required manual-browser check.
  - No application code was written (architect's role doesn't implement) and `ai-context/DECISIONS.md`/
    `ai-context/PROGRESS.md` were not touched by the architect — recorded here and in DECISIONS.md
    separately, matching this project's established handoff convention.
  - **Amended same day (2026-07-31, architect)**: Phase 8's two remaining non-blocking notes, N-3
    and N-4, were folded into Phase 8b's scope at Jeff's request, rather than left standalone or
    reopening Phase 8's already-approved diff. Both are small, UI-only, and confined to files Phase
    8b already touches. Full reasoning in `ai-context/DECISIONS.md`'s new "Phase 8b absorbs Phase
    8's remaining qa notes..." entry; summary:
    - **N-3** (`CopyDayDialog` shows a stale error message on reopen) gets a **structural** fix, not
      a manual reset: its open-panel body (`toDate`/`state`/`pending`) moves into a subtree that only
      renders while `open`, so each open mounts fresh — the same property `CopyGroupDialog` already
      has by accident of its structure, now made a deliberate rule that also applies to Phase 8b's
      own new bulk expanders. Explicitly **not** the same situation as the `SettingsForm`
      remount-on-`key` precedent (that one was forced by a React form-Action quirk; this one is a
      maintainability choice, not a correctness requirement) — recorded so the two precedents aren't
      conflated later. Carries an explicit guardrail: the unmount must be keyed **only** off the
      user's own open/close toggle, never off anything a background refresh touches, or the fix would
      silently reintroduce the exact state-wiping bug Phase 8b exists to prevent — §6 now requires
      both properties to be asserted together in one test.
    - **N-4** ("Log again" gives no feedback about its destination when logging from a past day) is
      fixed by having the toast name the destination date when it differs from the day being viewed,
      reusing the exact wording the day/group copy toasts already use. The view deliberately stays on
      the browsed day rather than jumping to today — silently moving the user was considered and
      rejected.
    - Phase 8 itself remains approved-as-shipped, untouched — neither note was a defect in what it
      was asked to build. Because N-3 restructures `CopyDayDialog`, Phase 8b's §6 scope now
      explicitly flags that component's existing Phase 8 acceptance rows as the likeliest regression
      point and requires them to stay green.
  - **Amended again same day (2026-08-01, architect)**: three more manual-testing findings from Jeff
    were folded into Phase 8b's checkpoint. Full reasoning, including the general rule used to decide
    each one's structure (how many already-approved phases' files a change reaches outside 8b's own
    set), is in `ai-context/DECISIONS.md`'s new "Phase 8b absorbs three more manual-testing
    findings..." entry; summary:
    - **Autofill/password-manager hygiene** — password managers were offering to fill/save non-
      identity fields (food name/quantity/calories, meal names, weight, goal targets, the meals
      filter, barcode entry) app-wide, for lack of `autocomplete` hints. Fixed with two plain HTML
      rules (`autoComplete="off"` on every `<form>`, plus an explicit value on every single control)
      applied across essentially every form in the app. Because this reaches ~6 already-approved
      phases' files that 8b never otherwise opens, it's structured as **its own cross-cutting pass**
      (the structural twin of the Visual Identity rollout) — tracked and reviewed at Phase 8b's
      checkpoint, but its own separate commit, not folded into 8b's feature diff.
    - **Transient success-feedback restyle** — the identical pill used for "Saved."/"Copied N
      entries..."/"Settings saved." is replaced by a new shared `components/ui/StatusMessage.tsx`
      (a left-accent banner, `role="status"`, 6-second auto-dismiss, up from 4), reversing only the
      *shape* half of a 2026-07-25 visual-identity decision (the *colour* call stands unchanged). A
      real, previously-unknown timer bug was found and fixed alongside (firing the identical message
      twice in a row used to make the second one inherit the first's remaining dismiss time). Reaches
      1-2 files outside 8b's own set, so it's folded into Phase 8b but as **its own commit** within it.
    - **Human-readable date display** — a new `formatDateLabel` (mirroring the existing
      `formatTimeLabel`) replaces raw ISO dates in toast/prose text at exactly 3 sites, all already
      inside files 8b opens, so this one folds directly into 8b's own diff. Implemented as a plain
      string reorder rather than `new Date(iso).toLocaleDateString()`, which would have introduced a
      real off-by-one-day bug in negative-offset timezones (a trap this codebase's `chartTheme.ts`
      already has a helper defending against elsewhere).
    - **Two judgment calls the architect flagged as overridable — both resolved by Jeff, 2026-08-01**:
      chart axis/tooltip date labels ("Jul 25" style) stay as-is, **not** reformatted to `MM/DD/YYYY`
      (Jeff agreed with the architect's recommendation — reformatting would be a density regression on
      a 90-tick chart axis); and the two identity email inputs use **`autoComplete="email"`** (Jeff's
      explicit choice, overriding the architect's initial `"username"` recommendation — both are valid
      tokens; `email` matches the literal original finding).
    - **One open yes/no — resolved by Jeff, 2026-08-01: yes, add it.** `MetricForm` gains a real
      "Weight saved." confirmation using the new `StatusMessage` component (alongside, not replacing,
      its unrelated "Already logged" status pill) — it previously had no save confirmation at all.
    - The design doc was updated directly (not re-routed through the architect) to reflect all three
      answers, since each was already laid out as an explicit fork awaiting exactly this decision —
      not new design work.
  - **Ready for developer to implement** — all open questions resolved.

- [x] **Two more manual-testing findings designed** (2026-08-01, architect). Full reasoning in
  `ai-context/DECISIONS.md`'s "Two more manual-testing findings..." entry; summary:
  - **Finding 4 — `CopyGroupDialog` gains an optional "Copy to time" override**, folded into Phase
    8b's diff (touches only `CopyGroupDialog.tsx`, already open for 8b). A `<select>` using the same
    96 quarter-hour values as everywhere else, defaulting to a `value=""` "Keep original time(s)"
    sentinel so existing behavior is unchanged unless the user deliberately overrides it. Deliberately
    NOT pre-filled with the group's own time — this control is shared with 8b's "Copy selected" bulk
    action, where a multi-group selection has no single time to pre-fill, and a rejected pre-fill
    would have silently changed default behavior for that case. Picking an override time while
    copying a multi-group selection collapses everything onto that one new time — treated as a
    disclosed feature (a one-line note appears only when it's actually relevant), not restricted.
    `CopyDayDialog` explicitly does NOT get this — preserving each entry's own time is the entire
    point of a whole-day copy.
  - **Finding 5 — logging a saved meal directly from `/meals`, recommended as its own "Phase 8c"
    rather than folded into 8b (flagged as overrulable by Jeff).** Unlike the other four findings,
    this is a new capability, not a fix/restyle/missing-control — it adds a new action surface to
    `/meals`, a screen 8b never otherwise touches, with its own trigger/defaults/success-state/
    acceptance rows. Sequenced immediately after 8b (a real dependency: its success message uses the
    `StatusMessage` component 8b introduces). Reuses `LogMealDialog` via a new optional `meal?: Meal`
    fixed-meal mode rather than a second hand-copied dialog. Defaults to today/floor-of-now with no
    "keep original" option (a saved meal has no existing time to keep) and no smart same-sitting
    default (that's `/food`-scoped state with no `/meals` equivalent). Explicitly out: a servings
    multiplier, multi-select on `/meals`, navigating away after logging, and any change to `MealList`'s
    filter/expand-by-default/read strategy. `/meals` gains its first-ever browser-timezone dependency,
    flagged to use the established mount-only-Effect pattern to avoid a hydration mismatch.
  - **Confirmed by Jeff (2026-08-01): Finding 5 stays split out as its own Phase 8c**, per the
    architect's recommendation.

- [x] **Sixth manual-testing finding designed** (2026-08-01, architect): `FoodEntryList` now highlights
  whichever row is currently being edited. Full reasoning in `ai-context/DECISIONS.md`'s "Sixth
  manual-testing finding..." entry; summary: `FoodDayView` passes a new `editingEntryId: string | null`
  down — deliberately the **id**, not the entry object, since an object-identity comparison would
  silently break after the first background refresh replaces the row objects. Treatment is a
  `border-l-4 border-l-sage-deep` bar plus a visible "Editing" label, no background fill (a
  `bg-sage-pale` tint was rejected — it would make the existing "From a saved meal" badge, which uses
  the same fill, disappear into the row). Reuses the same left-accent-bar vocabulary the new
  `StatusMessage` component (Finding 3) introduces, differentiated by weight rather than a second
  pattern. The edited row's own per-row actions (Log again/Edit/Delete) are hidden while it's being
  edited, following the same "a special-state row suppresses its ordinary actions" rule multi-select's
  select mode already established — and editing/select mode are confirmed to coexist without
  conflict (a checked row gets no tint of its own; the checkbox is already the indicator). No live-
  region announcement (the user caused this state themselves by clicking "Edit," so nothing needs
  announcing) but the "Editing" label is real visible text, not color alone. **Structured as the same
  commit as 8b's multi-select work** (not a separate commit) — the first finding this session judged
  genuinely coupled to, not just co-located with, 8b's other changes, since both add per-row visual
  state to the identical list and had to be designed against each other.

- [x] **Phase 8b implemented** (2026-08-01, developer), against the design doc's Phase 8b section and
  the six manual-testing findings recorded above. Implemented as the commit-worthy units the doc
  specified: (1) multi-select bulk actions + the editing-row highlight, same unit — new
  `EntrySelectionBar.tsx`, `FoodDayView`/`FoodEntryList` gain select-mode/selection state (structurally
  surviving background refreshes) and an `editingEntryId`-driven highlight (the id, not the entry
  object); `CopyGroupDialog`/`SaveGroupAsMealDialog` both gained optional wording props so the two
  bulk actions reuse them verbatim instead of duplicating dialogs; (2) N-3 (`CopyDayDialog`'s
  open-panel body extracted into a subtree mounted only while `open`) and N-4 (`handleLogAgain` names
  its destination) folded in; (3) `formatDateLabel` (a plain string reorder, not `new Date()`) applied
  at the three specified sites; (4) `components/ui/StatusMessage.tsx` (new) replacing the pill
  treatment in `FoodDayView`/`SettingsForm`, plus a genuinely new "Weight saved." confirmation on
  `MetricForm` (per Jeff's yes), keyed per-mount so a repeated message gets a fresh timer — the two
  status *pills* (`MetricForm`'s "Already logged", `FoodEntryList`'s "From a saved meal") were left
  untouched, as specified; (5) `CopyGroupDialog` gained a "Copy to time" `<select>` with a `value=""`
  "Keep original time(s)" sentinel default, singular/plural depending on whether the source spans one
  or several instants; (6) the app-wide autofill/password-manager hygiene sweep (`autoComplete="off"`
  on every `<form>`, an explicit value on every control, `autoComplete="email"` — Jeff's decision, not
  `username` — on the two identity email inputs), implemented as its own separate commit-worthy unit
  from the rest of 8b's feature work, per the design doc.
  **One explicit, instructed deviation from the doc's literal scope**: the autofill sweep did **not**
  touch `/meals`/`MealsView.tsx`/`MealList.tsx`/`MealForm.tsx`/`MealItemForm.tsx`, even though the
  design doc's "known surfaces" list names them — this was an explicit instruction (Phase 8c, not this
  task, owns `/meals`), not an oversight. Whoever implements Phase 8c should pick up autofill hygiene
  for `/meals`'s controls as part of that work, since it's still genuinely missing there.
  **A real, previously-undocumented gap found and corrected**: the developer verified (empirically,
  not just by reading the doc) that Playwright's `getByLabel` does case-insensitive substring matching
  by default, so the design doc's claim that "Copy to time" avoids a `getByLabel("Time")` collision
  "by construction" doesn't hold — both controls match an unscoped `getByLabel("Time")` whenever both
  are rendered. The label itself is still correct UX and unchanged; only the doc's *test-authoring*
  claim was wrong. See `ai-context/DECISIONS.md`'s new "Correction: 'Copy to time' does not avoid a
  Playwright `getByLabel` collision..." entry — **qa-reviewer's own acceptance test needs `{ exact:
  true }` or container-scoping** for any assertion against `getByLabel("Time")` while a copy/bulk
  expander is open, or it will pick up both controls.
  **A real regression found and fixed during verification**: extending the success-message
  auto-dismiss to 6 seconds (a required part of this design) broke an existing
  `phase8-acceptance.spec.ts` test that relied on the old 4s dismiss elapsing inside a retry window for
  a page-wide `getByText(entryName)` count assertion (the toast text itself contains the entry name).
  Fixed by scoping that assertion to `<li>` rows instead of the whole page. **Not exhaustively audited**
  for the same latent pattern elsewhere in `e2e/` — flagged for qa-reviewer to sweep for it if full
  confidence is wanted.
  **Verification, independently re-run and confirmed this session, not just taken from the developer's
  report**: `npm run lint` / `npx tsc --noEmit` clean; `npm test` **504/505** (the one failure is the
  already-documented pre-existing UTC-boundary flake in `meals.test.ts`, PROGRESS item 0-pre-b, in a
  file this work didn't touch); `npm run build` clean; a full `npx playwright test --workers=1` run
  against a freshly reset Supabase instance and a freshly started dev server — **262/263 passed**, the
  one failure being the also-already-documented pre-existing `phase4-acceptance.spec.ts` UTC-boundary
  flake. Spot-checked several implementation details directly against the source (the `StatusMessage`
  component's contrast guardrails and per-mount timer semantics, the `editingEntryId`-as-id comparison,
  the `autoComplete="email"` choice, `/meals` genuinely untouched) rather than relying solely on the
  developer's summary. The developer additionally ran a manual, real-browser verification pass
  (throwaway Playwright scripts, per this project's established practice) covering the mandatory
  refresh-survival check (select mode + cross-group ticks + an open "Save selected as a meal" expander
  with a typed name, surviving a real background refresh triggered by adding an unrelated entry) and a
  phone-viewport screenshot of select mode.
  **Ready for qa-reviewer.**

- [x] **Phase 8c implemented** (2026-08-01, developer), against the design doc's Phase 8c section —
  logging a saved meal directly from `/meals`. Touches exactly three files: `LogMealDialog.tsx` gains
  an optional `meal?: Meal` "fixed-meal mode" (skips its own meal fetch/picker, renders the meal name
  as static text; picker-mode behavior on `/food` is unchanged — one shared implementation of the
  date/time fields, error mapping, cap wiring, and tz handling for both modes); `MealList.tsx` gains a
  **"Log this meal"** button placed first in each card's action row, opening `LogMealDialog` in
  fixed-meal mode as an inline expander (`loggingMealId`, a single nullable id, keeps only one card's
  expander open at a time, mirroring `FoodEntryList`'s existing mutual-exclusion pattern); `MealsView.tsx`
  gains `/meals`'s first-ever browser-timezone dependency (a mount-only Effect resolving `tz`/`today`,
  starting `null`, following the same hydration-safe pattern `MetricForm` already established —
  confirmed to follow that pattern specifically, not `FoodDayView`'s eager `useState` initializer,
  which isn't actually hydration-safe).
  On success: a `StatusMessage` naming the meal/date/time, no refetch, and the filter/card-expansion
  state is left completely undisturbed — the same background-state-loss bug class this repo has now
  shipped broken twice (Phase 7's `MealsView`, Phase 7b's `FoodEntryList`) was deliberately not
  repeated a third time.
  **Judgment calls flagged by the developer**: the tz-resolution gate is scoped narrowly to just the
  "Log this meal" control (not the whole `/meals` screen, which would have been a real UX regression
  versus current behavior); the success message lives locally in `MealList` rather than being lifted to
  `MealsView`, since there's no cross-cutting refetch/side-effect for a parent to coordinate here; the
  dialog's own "Cancel" button reproduces the same "two Cancel-labeled controls on one card" pattern
  already known and deferred elsewhere in this codebase (Phase 7b's N-3) — not a new instance invented
  here, the same accepted pattern recurring; and `empty_meal`'s error copy was adjusted for fixed-meal
  mode only, since the picker-mode wording ("go to the Meals page") would be circular when already on
  `/meals`.
  **Verification, independently re-run and confirmed this session**: `npm run lint` / `npx tsc --noEmit`
  clean; `npm test` **504/505** (same already-documented pre-existing flake, in a file this work didn't
  touch); `npm run build` clean; a full `npx playwright test --workers=1` run against a freshly reset
  Supabase instance — **262/263** (the one failure being the other already-documented pre-existing
  flake); `phase7-acceptance.spec.ts` + `phase7b-acceptance.spec.ts` + `phase7c-acceptance.spec.ts` run
  standalone — **71/71**, confirming zero regression to existing `MealList`/`MealsView` behavior.
  The developer additionally verified by hand (throwaway Playwright script, deleted after): seeded
  three similarly-named meals and confirmed "Log this meal" on the middle card logs the *correct*
  meal (checked via a direct DB read, not just that some row appeared); confirmed a successful log
  left the active filter, the "Showing N of M" count, and card expansion state completely undisturbed
  with zero refetch; confirmed the logged entry renders as one exact-timestamp group on `/food`; and
  confirmed zero console errors/hydration-mismatch warnings on `/meals` itself.
  **Explicitly out of scope, confirmed not built**: no servings/quantity multiplier, no multi-select on
  `/meals`, no navigation to `/food` after logging, no change to `MealList`'s filter/expand-by-default/
  read strategy, no server-action/domain/schema change, and no autofill retrofit of `/meals`'s existing
  controls (deliberately deferred from Phase 8b's sweep to whoever picks that up next).
  **Ready for qa-reviewer.**

- [x] **Phase 8b qa-reviewed** (2026-08-02). A qa-reviewer pass was found already complete in the
  working tree — `e2e/phase8b-acceptance.spec.ts` (54 acceptance tests), and two new independent unit
  files, `src/lib/domain/autofill-hygiene.qa.test.ts` and `src/lib/domain/datetime-datelabel.qa.test.ts`
  (22 tests). **Provenance note**: this session has no record of dispatching this pass — its origin is
  untraceable (the one candidate background-task ID checked returned "no task found"). Given that, the
  work was treated as unverified until independently confirmed, not simply trusted: read in full against
  the actual shipped source (`StatusMessage.tsx`, `CopyGroupDialog.tsx`, `EntrySelectionBar.tsx`,
  `FoodEntryList.tsx`), then re-run from a genuinely clean state before being accepted.
  **Two real issues were found and fixed during that verification, both independent of the Phase 8b
  feature work itself**:
  1. **A real, previously-unknown bug in `StatusMessage.tsx`**: its auto-dismiss timer depended on
     `onDismiss` in its effect's dependency array, but every real call site passes a fresh inline arrow
     function on every render — so the timer silently reset on *any* unrelated parent re-render (e.g.
     toggling select mode, ticking a checkbox), and a confirmation banner could stay on screen well past
     its documented 6-second window under enough background UI activity. **Fixed**: the component now
     keeps `onDismiss` in a `useRef` and depends only on `autoDismissMs` for scheduling, so the timer is
     genuinely mount-scoped regardless of how callers pass their callback. Full reasoning in
     `ai-context/DECISIONS.md`'s new "`StatusMessage`'s auto-dismiss timer now survives unrelated parent
     re-renders..." entry. Both qa test files that had pinned this as a "FINDING (pinned, not endorsed)"
     were updated in place to assert the fixed behavior instead of continuing to describe a bug that no
     longer exists.
  2. **A real test-authoring bug**, unrelated to the app: `e2e/phase8b-acceptance.spec.ts`'s
     `selectionBar()` helper used `page.locator("div").filter({ hasText: /^d+ selected$/ })` — a regex
     missing the backslash before `d` (so it only matched literal "d" characters, never digits), on top
     of assuming the "N selected" count lived in a `<div>` when it's actually a `<p>` — meaning the
     locator could never match anything, regardless of the regex. Fixed by scoping via the unique "Done"
     button instead (`page.locator("div").filter({ has: page.getByRole("button", { name: "Done" }) })`),
     with an inline note recording *why* scoping is required at all (`FoodEntryForm` also has its own
     "Clear" button, so an unscoped `getByRole("button", { name: "Clear" })` is ambiguous whenever select
     mode is on — itself a real, if minor, finding worth knowing about).
  **A significant false alarm during verification, worth recording so it isn't repeated**: an initial
  full run of the new e2e suite showed only 2 of 54 tests passing over nearly 21 minutes — alarming on
  its face, but traced to an environment mistake, not a regression: `rm -rf .next` was run while a
  pre-existing dev server (already running for almost an hour) was still listening on port 3000: since
  Playwright reuses an already-running server rather than starting a fresh one, it kept serving through
  a live process whose entire build cache had just been deleted out from under it, forcing every route
  to recompile from scratch on every request. Killing that stale server (not just clearing `.next`) and
  re-running produced **54/54 passing in 3.4–3.6 minutes**, consistently, across three separate full
  runs. This is the same "stale dev server" trap already documented multiple times elsewhere in this
  file — the specific new lesson is that killing the server and clearing `.next` are both required
  together; doing only the latter while an old server is still up can look exactly like a severe
  regression when it's actually a cache/server mismatch.
  **Verdict, after both fixes**: no blocking findings. Full suite: **54/54** e2e in the new Phase 8b
  suite, **529/529** unit (including the 22 new independent unit tests), lint/typecheck clean. A
  targeted regression check of `e2e/phase8-acceptance.spec.ts` + `e2e/food-logging.spec.ts` (the
  existing suites most likely to interact with `StatusMessage`/`FoodDayView`'s toast) — **34/34**, zero
  regressions. The one other pinned, non-blocking finding in the new suite —
  `/meals` was deliberately not swept for autofill hygiene — is expected, not a defect (an explicit
  scope decision made when Phase 8b was implemented; `/meals`'s autofill hygiene is deferred to
  whoever next touches that screen, e.g. as part of Phase 8c follow-up work).
  **Phase 8c also qa-reviewed as part of the same pass**: `e2e/phase8c-acceptance.spec.ts` (16
  acceptance tests), independently re-run fresh — **16/16 passed**, no findings. Covers logging the
  right meal when similarly-named ones exist, batch semantics matching `/food`'s own path, correct
  defaults (today, floor-of-now, no keep-original sentinel — a saved meal has no time to keep),
  the future-day cap and ownership invariant holding through this new entry point, zero disturbance to
  `/meals`'s filter/count/card state on success, mutual exclusion across cards, no nested-`<form>`
  regression, and the new browser-tz dependency producing no hydration-mismatch console errors.
  **Ready for Jeff's approval** (Phase 8b and 8c together).


## Up Next
0-pre. **Phase 7c B-1 resolved (2026-07-30) — Phase 7c is complete. Approved by Jeff, 2026-07-31.**
   See the "Phase 7c B-1 resolved" Completed entry above for the full fix (a DECISIONS
   entry for the `MealList` expand-by-default change, the 17 stale `e2e/phase7-acceptance.spec.ts`
   assertions updated to match — plus 2 more test fixes the same root cause required, found only
   once the first 13 were fixed — and the Phase 7c entry's inaccurate "no change to `MealList`"
   sentence corrected). No further developer or qa-reviewer action is expected on B-1 itself unless
   Jeff's own review surfaces something new. **`e2e/phase7-acceptance.spec.ts` is back to 29/29**;
   the full e2e suite was not re-run end-to-end this session (see the Completed entry for why that
   was judged sufficient). One unrelated, pre-existing flake was newly observed while verifying this
   (not introduced by this fix — see below, item **0-pre-b**).
   Four non-blocking notes from qa-reviewer's Phase 7c review remain open, not fixed, matching the
   pattern of deferring non-blocking findings unless Jeff asks otherwise (N-2 an undocumented
   `LogMealDialog` trigger restyle — cosmetic/correct, just undocumented; N-3 no `aria-live` on the
   filter results/count for screen readers; N-4 the still-deferred stale-response guard, same bucket
   as Phase 7's own N-6; N-5 a stale `filterQuery` left behind when the library empties then regains
   a meal). **N-1 (the `max_rows = 1000` truncation) is carried forward separately below as its own
   item, per Jeff's explicit instruction to note it for later rather than fix it now.**

0-pre-a. **`supabase/config.toml`'s PostgREST `max_rows = 1000` silently truncates any query past
   1000 rows — noted for later, not fixed, per Jeff's explicit instruction (2026-07-30).** Found by
   qa-reviewer during the Phase 7c review (N-1), empirically confirmed (not inferred): seeding 1050
   `meal_items` rows for one user and running the app's exact query
   (`.from("meal_items").select("*").order("sort_order")`) returned **1000 rows with `error: null`**,
   while a `count: "exact"` probe on the same table returned 1050 — a silent truncation with no error
   path anywhere in the app to catch it. This is **pre-existing Supabase CLI default config, not
   introduced by any phase**, and does not affect Phase 7c's own filter (which matches on `meals.name`
   — the `meals` table itself would need 1000+ rows to truncate, not `meal_items`) — but it lands
   almost exactly on the design doc §5 tripwire's own stated revisit trigger: a ~200-meal library at
   ~5 items each is ~1000 `meal_items` rows, past which some meal cards would silently render
   "0 items · 0 kcal" (and `LogMealDialog`'s picker labels would be wrong) with the meal names
   themselves still listed, so nothing would look broken. §5's tripwire is currently written only
   about someone *introducing* pagination or a `.limit()` — worth extending it to name this existing
   config cap explicitly, since it's the one mechanism that can make "the list is fully fetched"
   quietly false without anyone touching the query. Whoever picks this up next: the fix is presumably
   raising `max_rows` in `supabase/config.toml` (and the hosted project's dashboard config once one
   exists — this repo has no hosted Supabase project yet, see AGENTS.md), or moving to real
   server-side pagination if the findability work here ever needs to scale past what a client-side
   filter over a few hundred rows can comfortably handle.

0-pre-b. **Newly observed, pre-existing, timezone-boundary-dependent unit test flake — not fixed,
   out of scope for whoever finds this next unless they're already touching this file.**
   `src/lib/actions/meals.test.ts`'s "rejects a meal dated tomorrow and writes no rows" (in the
   `logMealForDay -- future-day cap` describe block) failed once while verifying the B-1 fix above,
   in a file this session never touched (confirmed via `git status` — already-committed from the
   earlier Phase 7 N-7 fix session). Root cause: its `localTomorrow()` helper derives "tomorrow" from
   the *test runner's system-local* timezone, while the test explicitly passes `logTz: "UTC"` — near
   a UTC-vs-system-local day boundary, "tomorrow" in system-local time can already equal "today" in
   UTC, so the future-day rejection legitimately doesn't fire and `result.ok` comes back `true`
   instead of the expected `false`. Same general class as this project's other documented UTC-
   boundary flakes (the Phase 4 "no-future metric date" test noted repeatedly throughout this file,
   the old `seed.sql` day-boundary bug). Presumable fix: build the "tomorrow" fixture from UTC (or
   from the same `logTz` the test passes) rather than the runner's local clock — mirrors the fix
   direction already used for `seed.sql`'s equivalent bug.

0-pre-c. **Newly found, unfixed, local-midnight-window flake in `e2e/food-logging.spec.ts`** (found
   2026-08-01, qa-reviewer, while fixing N-8 — see the "Phase 8's N-8 fixed" Completed entry above).
   "editing an existing entry does not move the smart same-sitting default backward for the next new
   entry" (~line 402) builds a fixture via `new Date(Date.now() - 45 * 60_000)`. Unlike N-8, this
   isn't a same-instant collision — the fixture can spill onto *yesterday's local date* and then never
   render on today's `/food` view, broken for 45 of 1440 *local* minutes (00:00–00:44 local), 15 of
   which have no valid substitute fixture at all: the test needs an on-grid instant that is
   simultaneously in the past, inside the 120-minute smart-default freshness window, and distinct from
   floor-of-now, and no such slot exists before 00:15 local. A fixed time-of-day isn't a safe drop-in
   fix the way it was for N-8. Presumable fix direction: either a documented skip during that window,
   or restructure the scenario so it doesn't depend on "some number of minutes before whatever `now`
   happens to be" at all — deliberately left as a call for whoever owns this test's behavioral intent
   next, not reshaped unilaterally by qa-reviewer.

0. **Phase 7b, including B-1's resolution and the N-1 fix, is complete. Approved by Jeff,
   2026-07-31.** No further developer or qa-reviewer action is expected unless Jeff's own review
   surfaces something new. Five non-blocking notes remain deferred (N-2 through N-6, logged in the
   qa-review Completed entry) — N-2 (no upper bound on `entryIds`), N-3 (two "Cancel"-labeled
   buttons visible at once), N-4 (an undocumented `exhaustive-deps` suppression), N-5 (recorded only
   for provenance — the fault-injection coverage it flagged as missing was supplied by qa-reviewer's
   own suite), and N-6 (`FoodDayView`'s missing stale-response guard, the same deferred class as
   Phase 7's own N-6).

0b. *(superseded by item 0 above, kept for the record)* **Phase 7b implemented (2026-07-30,
   developer) — was ready for qa-reviewer.** Now independently reviewed. qa-reviewer's §6 scope for this phase
   (per the design doc's §8 Phase 7b bullet) should hammer: source entries byte-identical after the
   save (including `updated_at` and `logged_from_meal_id`), and cross-user/mixed-set rejection
   writing zero rows anywhere, verified via a service-role read across both users — plus a code
   review confirming no UPDATE/DELETE against `food_entries` anywhere in `createMealFromEntries`.
1. **Phase 7 qa-reviewed; N-1, N-7, N-8 fixed (2026-07-28). Approved by Jeff, 2026-07-31.** No
   further developer or qa-reviewer action required on those three unless Jeff's own review
   surfaces something new. See item 8 below for the five notes Jeff explicitly asked to defer
   (marked trivial/scale-only, per Jeff, 2026-07-31).
2. **Phase 5 fixed up after qa-reviewer's blocking bug — ready for Jeff's approval.** No further
   developer or qa-reviewer action required unless Jeff's own review surfaces something new.
3. **Phase 6 approved by Jeff (2026-07-27).** No further action needed.
4. ~~Pre-existing, time-of-day-dependent bug in `supabase/seed.sql`'s third-account 90-day
   generator~~ — **RESOLVED 2026-07-27** (see Completed above for the full root-cause writeup and
   fix). No further action needed unless a future review surfaces a related issue.
5. **Visual identity qa-review fix-ups (NB-1/NB-2) and the time-`<select>` alignment fix are all
   implemented (2026-07-26, developer) — see Completed below.** No further developer action needed
   on any of them unless a future review surfaces something new. The one remaining open item from
   the visual-identity qa-review is **NB-5**: `e2e/visual-identity-acceptance.spec.ts` already
   exists in the tree (written by qa-reviewer) and is green — no action needed, just noting it's
   the recommended regression coverage for this cross-cutting change and should stay in the suite.
6. **The pre-existing `FoodDayView` `Day`-input race is still open and unfixed** (10 reproducing
   e2e cases now documented, see Notes below) — worth investigating on its own merits per the
   existing hypothesis (a controlled-input/native-reset interaction, same family as the
   `SettingsForm` radio bug already fixed in Phase 4). Re-confirmed still pre-existing during Phase
   7b verification (2026-07-30) via a scoped `git stash` of only that session's own files.
7. **Phase 8 (Ease-of-entry extras — copy/repeat) implemented (2026-07-31, developer) and
   qa-reviewed (2026-07-31, qa-reviewer) — no blocking findings, ready for Jeff's approval.** See
   the two Completed entries above for the full breakdown. Eight non-blocking notes are logged
   there (N-1/N-2: two design-doc passages describe unbuilt-but-non-blocking scope and should be
   amended; N-3/N-4: minor UI polish — a stale error on `CopyDayDialog` reopen, and "Log again"
   from a past day not naming its destination in the toast; N-5/N-6/N-7: low-severity edge cases,
   mostly recurrences of already-deferred issue classes; N-8: a latent fixture flake in
   qa-reviewer's own `phase7b-acceptance.spec.ts`, proven pre-existing). None require developer
   action unless Jeff asks otherwise.
8. **Phase 7 qa-review non-blocking notes N-2 through N-6 — logged here, deliberately NOT fixed,
   and marked trivial (Jeff, 2026-07-31): only worth revisiting if this app ever goes public at
   meaningful scale (considered unlikely) — no action needed for solo/small-scale use.** (Jeff's
   original instruction: fix N-1/N-7/N-8 now, defer the rest.) All five live in
   `src/lib/actions/meals.ts` unless noted. Picking any of these up should start from qa-reviewer's
   original finding, not just this summary:
   - **N-2**: `reorderMealItems` issues one `UPDATE` per item with no surrounding transaction (a
     partial failure mid-reorder could leave `sort_order` inconsistent), and doesn't validate that
     the caller-supplied `orderedIds` actually matches the meal's current item set before writing.
   - **N-3**: `addMealItem`'s "find the current max `sort_order`, then insert at +1" has a race
     window — two concurrent adds to the same meal could read the same max and collide on
     `sort_order`.
   - **N-4**: `deleteMeal`/`deleteMealItem`/`reorderMealItems` return `{ ok: true }` even when the
     `id`/`user_id` filter matched zero rows (e.g. deleting an already-deleted or a foreign id) —
     not a security gap (RLS/ownership already prevent any actual cross-user mutation), just an
     ambiguous success response that can't distinguish "deleted" from "matched nothing."
   - **N-5**: raw `error.message` strings from Postgres/Supabase can reach the UI unfiltered on
     unexpected failures in `lib/actions/meals.ts`, rather than being mapped to a friendlier message
     (the codebase already has a "short-code error" convention — `"future_date"`, `"meal_not_found"`,
     `"empty_meal"`, and now `"invalid_timezone"` — for the *expected* failure paths; this note is
     about the *unexpected* ones falling through to a raw DB string).
   - **N-6**: `MealsView`'s refresh-after-mutation has no stale-response guard, unlike
     `TodaySummary.tsx`, which correctly has one (see the Phase 3 qa-review's similar non-blocking
     note about `FoodDayView`'s day-switch fetch, still also open — item 6 above) — a rapid sequence
     of mutations could in principle have an in-flight earlier refresh's response land after a later
     one's and render stale data; self-corrects on the next refresh, no data-integrity risk.
9. **Undo two local-machine-only changes made for phone-on-LAN manual testing (neither is a repo
   file — nothing to revert in git, just local OS/machine state).** While testing Phase 6's
   barcode scanner from a phone browser (to get a real rear camera, since a laptop webcam can't
   reliably focus close enough on a 1D barcode), two separate LAN-reachability problems surfaced
   and were fixed:
   - **Windows Firewall**: Windows classifies the home Wi-Fi (`NETGEAR45-5G 2`) as a **Private**
     network profile, but the existing "Node.js JavaScript Runtime" inbound-allow firewall rule
     was scoped to **Public** only, so Windows silently dropped the phone's connection to port
     3000 (confirmed via `netstat` that the dev server itself was correctly listening on
     `0.0.0.0:3000`, and via `Get-NetFirewallRule`/`Get-NetConnectionProfile` that the
     rule/profile mismatch was the actual cause). The same issue also applied to Supabase's API
     gateway on port 54321. Jeff approved adding two narrow, temporary inbound rules (same
     `DisplayName`, `"health-tracker dev server (temporary)"`, one per port), applied by Jeff
     himself in an elevated PowerShell session since this environment isn't running as
     Administrator. Follow-up: once local phone/LAN testing is done for good, remove both with
     `Remove-NetFirewallRule -DisplayName "health-tracker dev server (temporary)"` (elevated
     PowerShell — this removes every rule with that display name, i.e. both ports at once).
   - **`.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`**: was `http://127.0.0.1:54321`, which gets baked
     into the browser bundle at dev-server-start — correct for a browser on the *same machine* as
     the server, but meaningless from a phone (127.0.0.1 there means the phone itself, not the
     laptop), which is why login (a Server Action, runs server-side) worked from the phone but
     `TodaySummary`'s browser-side Supabase read ("Today so far") hung forever. Changed to the
     laptop's LAN IP, `http://192.168.1.58:54321` (Supabase's API gateway was already confirmed
     listening on `0.0.0.0:54321`, i.e. all interfaces, so only the URL and the firewall were the
     blockers), and the dev server was restarted (`NEXT_PUBLIC_*` vars are inlined at server-start,
     not hot-reloaded). Follow-up: this is fine to leave as the LAN IP indefinitely for continued
     phone testing, but if the laptop's LAN IP ever changes (different network, DHCP lease
     renewal) it'll need updating again, or revert to `127.0.0.1:54321` if phone testing is no
     longer needed. `.env.local` is gitignored, so this was never at risk of being committed.
10. **Design follow-up (Jeff, 2026-07-29, discuss-only so far — no code changed): the per-unit/
    total mode question in `FoodEntryForm`/`MealItemForm`'s "add detail" section reads as
    confusing right after a successful barcode/search lookup.** The control ("Are the
    calories/protein above per unit, or a total for this quantity?") is phrased as an open
    question, but a lookup pick has already silently resolved it (mode set to per-unit, real
    provider values filled in) before the section auto-expands — so the UI re-presents a
    already-decided question at exactly the moment ("it just worked") where that reads as
    friction/doubt rather than confirmation. Likely direction discussed: not removing the
    control (it still carries real meaning if the user adjusts quantity afterward — how the
    calorie field's math recalculates depends on knowing per-unit vs. total), but reframing it
    from an active question to a passive, already-answered/overridable label once a lookup has
    resolved it (e.g. "Per unit ✓," still tappable to change). Since this revises the recorded
    2026-07-19 "Progressive disclosure" decision in `ai-context/DECISIONS.md`, it should go
    through the architect first, same as the time-picker alignment change — not a quick tweak.
    **Second, related observation (Jeff, same date): on a plain manual entry (mode defaults to
    `"total"`, not from a lookup), the calorie/protein field labels above the toggle already read
    "Total calories"/"Total protein"** (`caloriesLabel`/`proteinLabel` in both `FoodEntryForm.tsx`
    and `MealItemForm.tsx` switch on `mode`, per the existing, confirmed-correct code) — so by the
    time a user reaches the toggle, the labels have already implicitly stated "these are totals,"
    making the still-open-sounding question underneath them read as redundant/confusing in the
    *manual-entry* case too, not just the post-lookup case. Two separate architect-worthy angles
    on the same control now: (a) the post-lookup case, where the question is confusing because the
    app already silently answered it; (b) this manual-entry case, where the question is confusing
    because the field labels above it already imply the answer before the user even reaches the
    toggle. **Confirmed not a functional bug**: Jeff verified a lookup pick does correctly set
    `mode` to `"perUnit"` (labels correctly read "Calories per unit"/"Protein per unit (g)" in that
    case) — this note is about wording/framing only, nothing to fix in the mode-setting logic
    itself.

## Notes / Things Discovered
- 2026-07-29: **Real bugs and environment gotchas found manually testing Phase 6/7 from a phone
  on the LAN** (not from the automated suite — this is exactly the kind of thing manual browser
  testing catches that tests don't). Four distinct, independent issues, each masking the next
  once fixed:
  1. **Open Food Facts' live v2 API returns HTTP 404 (not HTTP 200 with `status: 0`) for a
     genuinely unknown barcode.** `src/lib/lookup/openfoodfacts.ts`'s `!response.ok` check
     short-circuited before the body was ever parsed, so every real not-found barcode was
     misreported as `provider_error` (502) → the UI's "Barcode lookup is unavailable right now"
     message, instead of a graceful not-found fallback. This directly contradicts what Phase 6's
     qa-review had asserted it verified live ("an unknown code returns HTTP 200 with `status: 0`,
     not a 404") — worth flagging as a caution about trusting even a qa-reviewer's own "verified
     against the live API" claims without re-checking, since provider behavior (or the reviewer's
     test barcode) can differ. Fixed: 404 with a parseable body is now treated as a valid
     not-found response; genuine 5xx/unparseable-body cases still correctly return `provider_error`.
     Regression tests added to `openfoodfacts.test.ts`.
  2. **`html5-qrcode`'s `Html5Qrcode.start()` first argument is typed as `MediaTrackConstraints`
     but its actual runtime only accepts an object with exactly one key** (`facingMode` or
     `deviceId`) — passing `{facingMode, width, height}` to request a higher-resolution camera
     stream (attempted to help a fixed-focus laptop webcam decode a barcode) throws synchronously
     ("object should have exactly 1 key"), surfacing as "Couldn't start the camera." The resolution
     request has to go through the separate `videoConstraints` field on the *second* config
     argument instead (which **replaces**, not merges with, the first argument's derived
     constraints at the library's own `getUserMedia` call — so `facingMode` has to be repeated
     inside `videoConstraints` too). This is a real type/runtime mismatch in the installed
     `html5-qrcode@2.3.8` `.d.ts` — worth remembering if this library version is touched again.
  3. **`allowedDevOrigins` (Next.js 15.3+/16) blocks cross-origin dev-server requests by
     default**, including — critically — enough of the client bundle/HMR machinery that a client
     component's `useEffect` **silently never fires at all** when the page is loaded from a
     non-allowlisted origin (e.g. a phone hitting the dev server's LAN IP instead of `localhost`).
     This looked exactly like a hung Supabase query (indefinite "Loading…", no network request
     ever visible) but was actually a total client-hydration no-op — the giveaway was a step-by-
     step debug tracer (temporarily added to `TodaySummary.tsx`, since reverted) showing the
     effect's own `setTimeout` watchdog never firing either. The real signal was in the **dev
     server's own terminal log**, not the browser console: `⚠ Blocked cross-origin request to
     Next.js dev resource ... add it to "allowedDevOrigins" in next.config.js`. Fixed by adding
     `allowedDevOrigins: ["192.168.1.58"]` to `next.config.ts` (dev-only; no effect on `next
     build`/`next start`). **If this laptop's LAN IP ever changes, this needs updating too** (see
     the `.env.local` `NEXT_PUBLIC_SUPABASE_URL` note in Up Next item 9, same underlying cause).
  4. **`getUserMedia` (camera access) requires a secure context** — HTTPS or `localhost` — and a
     plain `http://<lan-ip>:3000` origin doesn't qualify, so `BarcodeScanner.tsx`'s
     `cameraSupported` feature-detection correctly resolves `false` on a phone hitting the dev
     server over LAN, hiding the "Scan with camera" button entirely (not a bug — the code is
     behaving exactly as designed). Worked around for testing via Chrome's
     `chrome://flags/#unsafely-treat-insecure-origin-as-secure` (add the exact origin, e.g.
     `http://192.168.1.58:3000`) on the phone itself — no app or server change. A more permanent
     alternative for future phone testing would be `next dev --experimental-https`, not set up
     here.
  Also reconfirmed the existing "stale webpack cache defeats env var changes" gotcha from
  scratch: after editing `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL`, a plain server restart still
  served the **old** value (confirmed by grepping the compiled chunk directly) because of Next's
  persistent `.next/cache` — only `rm -rf .next` + restart actually picked up the change. Anyone
  changing a `NEXT_PUBLIC_*` var during local dev should expect to need a full cache clear, not
  just a restart.
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
- 2026-07-25: **Discovered a pre-existing, reproducible failure in 9 e2e tests, unrelated to the
  time-control change** — every failure is a test that seeds fixture data on a specific historical
  date (e.g. `2026-07-12`) via a direct DB insert, then does `page.getByLabel("Day").fill(day)` to
  navigate `/food` to that date; the fill silently doesn't take effect (the Day input stays on
  today's date) so the seeded entries never render and the assertions time out. Confirmed via
  `git stash` that this reproduces identically against the last commit on `main`
  (`3695ace`) with no working-tree changes at all — **not a regression from this task's change**,
  and not something this task's scope covers, so it was left as-is rather than fixed. Whoever picks
  up Phase 5 or the next `/food`-touching phase should investigate `FoodDayView.tsx`'s `Day`
  `<input type="date">` — likely another controlled-input/native-reset interaction similar to the
  `SettingsForm` radio bug fixed during Phase 4 (`ai-context/DECISIONS.md`,
  "`SettingsForm`'s fields remount…"), since `.fill()` normally works fine on controlled inputs
  whose `onChange` just calls `setState`. Affected tests (all pre-existing, not touched by this
  task): `e2e/food-logging.spec.ts` "per-entry protein %...", "day rollup is ratio-of-sums...",
  "entries at distinct instants...", "entries sharing the exact same consumed_at..."; and
  `e2e/phase3-acceptance.spec.ts` "entries one minute apart...", "every 30 minutes run...", "day
  pct is calorie-weighted...", "per-entry protein pct over 100...", "editing an entry name in a
  different browser tz...". **10th reproducing instance found 2026-07-26** (qa-reviewer, during the
  visual-identity review): `e2e/food-offgrid-edit.spec.ts:32` ("off-grid stored time is preserved in
  the select and not silently corrupted on unchanged save") uses the identical
  `page.getByLabel("Day").fill(day)` pattern to navigate to a seeded historical date, so it shares
  the same race — added to this list for whoever picks up the underlying `Day`-input bug.
- 2026-07-25: **The 9 pre-existing failures above turned out to be dev-server-state-sensitive, not
  a deterministic 100%-repro bug** — found while verifying the visual identity rollout. A `npm run
  test:e2e` run against a `next dev` process that had been left running across many hours of edits/
  `git stash`/`git stash pop` cycles in this same session failed **10** tests (the same 9, plus one
  more, `food-logging.spec.ts`'s "delete decrements the day totals" — count/exact members varied
  slightly run to run). Killing that stale process (`netstat`-located leftover from an earlier,
  unrelated session — see the leftover untracked `devserver.log`/`devserver.pid` in the repo root,
  not created by this task) and letting Playwright's own `webServer` start a fresh one from a clean
  `.next` cache made the **full 108-test suite pass, including all 9 previously-failing tests**,
  reproduced twice. This does not contradict the earlier "confirmed via `git stash`" finding above
  (that was real — the tests do fail against a stale/long-lived dev server on the unmodified
  codebase too, `git stash` only proves the *code* isn't the variable, not that the *server
  process's freshness* isn't) — it refines it: the actual trigger looks like a timing race on
  `FoodDayView.tsx`'s `Day` `<input type="date">` (per the existing hypothesis above) that a
  freshly-compiled route wins reliably but a long-hot dev server sometimes loses. **Practical
  takeaway for whoever investigates this next**: reproduce against a *freshly started* `npm run
  dev` (or let `test:e2e`'s own `webServer` start one — avoid a lingering manually-started server
  from an earlier session) before concluding a failure is real; and the underlying `Day` input race
  itself is still an open, unfixed bug worth investigating on its own merits (a flaky test is still
  a symptom of something).
- 2026-07-26/27: **Nested `<form>` elements silently break: caught only by driving the Phase 6
  lookup UI in a real browser, not by any mocked/unit-level test.** `FoodLookupPanel`'s search input
  and `BarcodeScanner`'s manual-barcode input were each originally wrapped in their own
  `<form onSubmit>`, both rendered inside `FoodEntryForm`'s own outer `<form>`. HTML has no concept
  of nested forms; the browser's parser silently drops/flattens the inner `<form>` tags rather than
  erroring, so a "submit"-type button inside one actually submits whichever `<form>` the browser
  resolves it to — in this case the *outer* food-entry form (with a blank required Name field),
  not the intended inner search/lookup action. Symptom looked like the lookup panel just closing
  itself with no results and no visible error anywhere, which is exactly the kind of silent failure
  that a Route Handler unit test (which only exercises the fetch layer, not the DOM) can't catch —
  it took an actual Playwright run against a live dev server to notice the network request for
  `/api/lookup/search` was never even sent. Fixed by replacing both inner `<form>`s with plain
  `<div>`s, changing their submit buttons to `type="button"` + `onClick`, and adding an `onKeyDown`
  Enter handler on each text input to preserve keyboard submission. **General implication for future
  phases**: any component meant to be embedded inside an existing `<form>` (as `FoodLookupPanel`/
  `BarcodeScanner` are inside `FoodEntryForm`, and as a future Phase 7 `MealItemForm`-embedded lookup
  reuse would be too) must not itself render a `<form>` element — use `type="button"` + `onClick`/
  `onKeyDown` instead, and this class of bug is specifically one that automated tests mocking the
  network layer will not surface; only an actual rendered-DOM check (browser or a Testing-Library-
  style render) will.
- 2026-07-27: **`supabase/seed.sql`'s third-account 90-day generator has a real, time-of-day-
  dependent bug** (pre-existing, from the "Seed a third account with ~90 days" commit — not
  introduced by Phase 6, discovered only because `supabase db reset` happened to be run during the
  affected window). It derives each day's timestamp as
  `((current_date - day_offset)::text || ' ' || slot_time)::timestamp at time zone 'America/Chicago'`
  — `current_date` is the database's UTC calendar date, not Chicago's. During the early hours of the
  UTC day (observed failing at ~01:57 UTC), `current_date` has already rolled over to the *next* UTC
  date relative to what is still "yesterday evening" in Chicago, so `day_offset = 0`'s dinner slot
  (`18:30` Chicago) computes a UTC instant that is still in the future relative to the real current
  moment — tripping `food_entries_not_future_day` and failing the entire `db reset`/seed step, not
  just that one row. This is genuinely time-of-day-dependent (it will pass when run later in the UTC
  day) rather than a deterministic bug, which is presumably why it wasn't caught when the seeding
  feature was first built and tested. Not fixed here (out of Phase 6's scope — this is Phase 2/seed-
  fixture territory) — worked around locally and temporarily (a one-line day-offset shift) only to
  unblock this session's own e2e verification, then reverted (`git checkout -- supabase/seed.sql`)
  before finishing, so no seed change is part of this delivery. The real fix is presumably deriving
  the date from `now() at time zone 'America/Chicago'` (Chicago's own current date) rather than the
  bare UTC `current_date`, so the generator's notion of "today" always matches the timezone the
  timestamps are actually being constructed in.
- 2026-07-27: **Phase 6 qa-reviewer fix-up session** — see the Completed bullet above for the full
  per-item breakdown (B-1, N-1 through N-7). Two judgment calls worth flagging explicitly since
  they weren't fully pinned down by the task brief: (1) N-7's rate-limit threshold (30 requests/
  minute/user) — chosen to comfortably clear both qa-reviewer's own test file (~24 authenticated
  calls to the two lookup routes in one file) and the developer's own `search/route.test.ts` (~6
  calls) without needing per-test resets, while still meaningfully capping a runaway client; only
  `/api/lookup/search` is limited (USDA's shared quota is the actual risk — see
  `ai-context/DECISIONS.md`), `/api/lookup/barcode` (Open Food Facts, free/keyless) is not.
  (2) N-4's rounding precision (2 decimal places) for a freshly-picked candidate's calories/protein
  display — chosen as a sensible middle ground that kills float noise (`390.15000000000003` →
  `390.15`) without discarding real sub-integer precision a provider might report; purely a
  prefill-display change, doesn't touch stored values or `lib/domain/lookup.ts` itself. Also note:
  qa-reviewer's `src/lib/domain/lookup.qa.test.ts` originally had several tests deliberately titled
  "FINDING: ..." that asserted the *buggy* pre-fix behavior as passing (per that file's own doc
  comment, "MUST be updated if the drop rule is tightened") — these were renamed/rewritten in place
  to assert the corrected N-2 behavior rather than left as stale/misleading passing tests; a couple
  of new tests were added alongside them (e.g. confirming Open Food Facts still falls back to a
  *usable* per-100g basis when the per-serving basis is negative, rather than losing the candidate
  entirely) to keep the fallback-vs-drop distinction from N-2's own reasoning independently covered.
- 2026-07-28: **CORRECTION to two prior entries that misdiagnosed a real `npm test` crash as a
  "Node 24" problem** — flagged by qa-reviewer as Phase 7's N-8. The two entries in question (left
  in place, not edited, per this file's append-corrections convention) are: the Phase 3 qa-review
  completion note's "**Environment caveat (pre-existing, not a Phase 3 issue):** `npm test` fails to
  start under Node 24 ... but the repo has no `engines`/`.nvmrc` pin, so a contributor on Node 22+/24
  gets a false-red `npm test` locally," and the "**Node version pin added**" note immediately after
  it ("could not reproduce qa-reviewer's reported crash on this sandbox (Windows, Node 24.18.0) ...
  so the failure may be platform- or exact-patch-version-specific"). **The actual root cause has
  nothing to do with the Node version**: qa-reviewer reproduced the exact same `@vitejs/plugin-react`/
  `vite`/`vitest` crash-at-load on **Node 20** (the repo's own pinned version) when the shell's
  working directory used a **lowercase drive letter** (`/c/Sandbox/...`, as Git Bash on Windows will
  happily accept), and confirmed the crash disappears when the same commands are run from the
  **canonical-cased path** (`C:/Sandbox/...`) instead — with no other variable changed. This also
  explains why the original "Node version pin added" entry couldn't reproduce the crash on Node
  24.18.0 in that developer's sandbox: the pin was never the actual variable, path casing was, and
  that session likely happened to be using (or not using) a lowercase-drive path independent of which
  Node version was installed. **Practical takeaway for anyone hitting this again**: if `npm test`
  throws at load with a Vite/Vitest/plugin-react-shaped error, check the working directory's drive
  letter casing (`pwd` in Git Bash) before suspecting the Node version — `cd` to the canonical-cased
  path and retry. The `.nvmrc`/`engines` pin added in that earlier session is still correct and
  worth keeping (matching CI's Node 20 exactly is good practice regardless), it just wasn't fixing
  the thing it was believed to be fixing.
- 2026-07-28: **Vitest's `test.env` config option silently coerces an `undefined` value to the
  three-letter STRING `"undefined"` when forwarding it into a worker's `process.env`** — discovered
  while building Phase 7 qa-review fix N-7's new persistent integration tests
  (`src/lib/actions/meals.test.ts`/`food.test.ts`), which need real `NEXT_PUBLIC_SUPABASE_URL`/
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` values to run against a real local
  Supabase instance, and were designed to skip themselves cleanly via
  `describe.skipIf(!hasSupabaseEnv)` when those aren't set (e.g. CI's "Unit tests" step, which
  deliberately runs before Supabase is started). The naive version —
  `env: { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, ... }` in
  `vitest.config.ts`, where the right-hand side is `undefined` whenever `.env.local` doesn't exist or
  doesn't define that var — did NOT leave the var unset in the test worker as expected; it set it to
  the literal string `"undefined"`, which is truthy (`!!"undefined" === true`), so
  `hasSupabaseEnv` silently evaluated `true` and the tests tried to run anyway, failing with
  confusing low-level errors (`Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL`) instead of
  skipping. Root-caused by direct experimentation (a debug `console.error` inside the test file
  itself showed `JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL)` printing the quoted string
  `"undefined"`, not the bare token, which only happens if the value is genuinely the string
  `"undefined"`) — not guessed. Fixed with a small `definedEnvOnly()` helper in `vitest.config.ts`
  that filters out any `undefined` entries before they reach `test.env`, so an unset var is truly
  absent from the worker's `process.env` rather than present-but-wrong. Separately (and needed for
  the same tests to actually pick up `.env.local` at all): `@next/env`'s `loadEnvConfig` — the same
  loader `playwright.config.ts` already uses for `.env.local` — silently loads **nothing** when
  `NODE_ENV="test"` (Next's own documented precedence: `.env.local` is deliberately skipped under
  test, since tests are supposed to be deterministic across machines), and Vitest always sets
  `NODE_ENV="test"` before the config file runs — worked around by temporarily presenting
  `NODE_ENV="development"` for just the `loadEnvConfig` call, then restoring the original value
  immediately after. **General implication for future phases**: any future developer-owned
  integration test that needs real env vars forwarded through `vitest.config.ts`'s `test.env` should
  reuse `definedEnvOnly()` rather than passing `process.env.X` directly — this is a Vitest-wide
  gotcha, not specific to the Supabase vars used here.

---
