# Decision Log
# Health Tracker

---

## Business Context

A multi-user health tracking app for logging daily food intake (calories, protein), body weight,
and body fat %, with trend charts, barcode/description food lookup, and reusable saved meals.
Built for individual users who want to track these with minimal daily effort.

---

## Made

### Multi-user with Supabase Auth from day one
**Date**: 2026-07-19
**Decision**: The app uses Supabase Auth + Row Level Security from the start, rather than
shipping single-user-no-auth and adding auth later.
**Why**: A public single-user deploy with no auth is only as private as the URL — anyone who
finds it can read/edit the data. Retrofitting auth later means adding `user_id` to every table,
backfilling, and writing RLS after the fact — a real migration, not a toggle. Supabase Auth is
effectively free to include upfront, so the cost of doing it now is low relative to the risk it
closes off.

### Individual food entries, not daily totals
**Date**: 2026-07-19
**Decision**: Food intake is logged as individual entries (one row per food item), not a single
daily calories/protein total.
**Why**: Individual entries support per-item edit/delete and are the natural shape for barcode
lookup, description search, and saved meals — a daily-total model couldn't support any of those.

### Weight and body fat % share one daily row
**Date**: 2026-07-19
**Decision**: `daily_metrics` combines weight and body fat into a single row per user per day
(one upsert, `unique(user_id, metric_date)`), instead of two separate tables.
**Why**: Both are one-per-day and typically captured in the same weigh-in; body fat is
meaningless on a day with no weight logged. A separate table would add a join and a second write
path for no benefit. `body_fat_pct` is nullable so weight can be logged alone.

### Weight stored canonically in kg; kg/lb is a display/input toggle
**Date**: 2026-07-19
**Decision**: `daily_metrics.weight_kg` always stores kilograms. The user's kg/lb preference
(`user_goals.weight_unit`) only affects conversion at the input/display edge (`lib/domain/units.ts`).
**Why**: Storing the user's preferred unit directly would make the column's meaning depend on a
separate flag — every query/aggregate would have to branch on it, and changing the preference
later would misinterpret historical rows. Canonical storage keeps the column's meaning fixed.

### Single current goal, not goal history
**Date**: 2026-07-19
**Decision**: `user_goals` stores one current daily calorie/protein target per user (used as a
flat reference line on intake charts), not a time-varying history of goals.
**Why**: Full goal history (effective-dated rows, "which goal applied on a past day") is real
complexity with little value for a solo tracker. Accepted limitation: changing your goal
re-labels past chart days against the new target.

### Food-entry timestamps stored in UTC with per-entry timezone capture
**Date**: 2026-07-19
**Decision**: `food_entries.consumed_at` is a UTC `timestamptz` (the conventional standard,
per Jeff's explicit direction, overriding an earlier local-wall-clock design). Each entry also
captures the browser's IANA timezone (`consumed_tz`) at write time, and a DB trigger derives
`consumed_local_date` (a plain `date`) from the two — this is the column that grouping/totals
actually key off.
**Why**: A UTC instant alone can't answer "which local calendar day does this count toward."
A single per-user timezone setting would mislabel any day the user is travelling. Computing the
local day at query time is correct but `timezone(text, timestamptz)` is Postgres `STABLE` not
`IMMUTABLE`, so it can't back an index or generated column. Persisting the trigger-derived
`consumed_local_date` per entry keeps grouping trivial/indexable and "freezes" the local day as
logged, regardless of later travel. See `docs/architecture/food-weight-tracker.md` §3.2/§4 for
the full mechanism and the rejected alternatives.

### Food lookup: Open Food Facts (barcode) + USDA FoodData Central (search), via a server-side proxy
**Date**: 2026-07-19
**Decision**: Barcode lookups use Open Food Facts (free, keyless). Description search uses USDA
FoodData Central (free, requires a server-only API key, ~1000 req/hr). Both go through auth-gated
server-side Route Handlers (`/api/lookup/*`), never called directly from the browser.
**Why**: Open Food Facts is strong for packaged/barcoded products; USDA FDC has authoritative
standardized nutrients and real text search, better suited to generic foods. A server-side proxy
is required regardless, to keep the USDA key off the client, avoid CORS, and normalize both
providers behind one `FoodCandidate` type. Lookups always prefill a form for the user to review —
never auto-submit — so provider downtime or bad data never blocks manual logging. Jeff confirmed
the free USDA tier is acceptable for v1, and that barcode/search query terms (no user identity)
leaving the system to these third parties is acceptable.

### Saved meals: items scoped per-meal, logged by copying values into independent food_entries rows
**Date**: 2026-07-19
**Decision**: A saved meal (`meals` + `meal_items`) is composed of individually-tracked items
(own name/calories/protein each), not a flat name+total. Meal items belong to one meal only —
there is no shared cross-meal food library. Logging a meal (`logMealForDay`) inserts one
`food_entries` row per item, copying values by value (not by reference) and sharing one
`consumed_at`/`consumed_tz` for the batch, with a nullable `logged_from_meal_id` back-reference.
**Why**: Per-item composition lets a meal's total be a real sum and lets meal items reuse the
same food-lookup flow as manual entries. Per-meal (not shared-library) scoping avoids item
versioning complexity (a shared item's edit would otherwise ripple into every meal referencing
it) — accepted tradeoff: the same food re-typed into multiple meals is duplicated, not linked.
Copying values into `food_entries` at log time (rather than referencing `meal_items`) is what
makes "editing/deleting a meal never changes already-logged history" true by construction, not
just by convention.

### Chart gaps: connect across missing days, mark real entries with a dot
**Date**: 2026-07-19
**Decision**: Trend charts (weight, calories, protein) draw a continuous line across days with no
data, but only render a point marker on days with an actual logged value.
**Why**: Breaking the line at every gap made sparse logging look choppy; connecting keeps the
trend readable while the dot-only-on-real-days convention keeps missing days visually
identifiable.

### Supabase's built-in email confirmation for v1 (no custom SMTP)
**Date**: 2026-07-19
**Decision**: Signup uses Supabase's built-in, rate-limited confirmation email sender. No custom
SMTP provider is configured for v1.
**Why**: Adequate for expected early-stage signup volume and zero extra setup. A custom SMTP
provider (Resend/Postmark/SendGrid/SES) is a documented pre-scale follow-up, configured in the
Supabase dashboard — not a code change.

### No logging into the future — capped at the current local day
**Date**: 2026-07-19
**Decision**: Food entries, meal-logging batches, and weight/body-fat entries cannot be dated
later than the user's current local day (e.g. 23:59:59 local today is loggable; 00:00:00 local
tomorrow is not). Enforced in three layers: a DB CHECK constraint on `food_entries`
(`consumed_local_date <= (now() at time zone consumed_tz)::date`) and on `daily_metrics`
(`metric_date <= current_date + 1`, deliberately loose — see below), an up-front app-level check
in the server actions returning `error:'future_date'`, and a client date-picker `max` of today.
**Why**: Backdating (logging yesterday's meals) was already a deliberate feature; Jeff wants the
reverse blocked — you can't log something that hasn't happened yet. The cap is on the local
*day*, not the exact instant, so logging later-today entries ahead of the current time-of-day is
still allowed. `daily_metrics` has no per-row timezone (unlike `food_entries`), so a tight
same-day check in server UTC would spuriously reject a legitimate "today" entry for users in
timezones ahead of UTC near midnight — the one-day DB slack avoids that false rejection while
still catching gross future-dating; precise enforcement for metrics happens client-side and via a
new `metricTz` action input (no schema column added). Also confirmed, rather than assumed: DB
CHECK constraints may use STABLE functions like `now()` and timezone math — only generated
columns/indexes require IMMUTABLE, which is why `consumed_local_date` itself needed a trigger but
this constraint doesn't.

### Quantity + unit as first-class fields, with DB-generated entry totals
**Date**: 2026-07-19
**Decision**: `food_entries` and `meal_items` both gain `quantity` (numeric, default 1),
`unit` (nullable free-text, no conversion logic), `calories_per_unit`, and `protein_g_per_unit`.
The existing `calories`/`protein_g` columns become Postgres `GENERATED ALWAYS AS (...) STORED`
columns computed as `quantity × per-unit`, rather than being set by app code or a trigger.
**Why**: Jeff wants real quantities ("4 eggs", "3 servings of chips", "1 cup broccoli") that can
be edited later and have totals recalculate — not a one-time multiply-then-forget. A generated
column was possible here (unlike `consumed_local_date`) because `quantity × per_unit` is plain
IMMUTABLE arithmetic, so the DB guarantees the total is always correct on every write path, and
`daily_food_totals`/every existing chart/query needs zero changes since `calories`/`protein_g`
still hold the same meaning. Manual entry (no lookup) supports two input *modes* — type per-unit
values, or type a total for the current quantity (converted to per-unit at save) — but there is
only **one** storage model, so a later quantity edit always recomputes correctly regardless of
which mode was used to create the row.

### Copy/repeat entries via one shared `copyFoodEntries` primitive; time clustering is presentation-only
**Date**: 2026-07-19
**Decision**: Three ease-of-entry mechanisms — copy an entire previous day, "Log again" on any
single past entry, and copy a time-based cluster of entries — all call one server action,
`copyFoodEntries(entryIds, toDate, toTime?, toTz)`. Time-based clustering (grouping a day's
entries by a 90-minute gap heuristic for display/selection) is a pure presentation function
(`lib/domain/clustering.ts`) — not a stored column, table, or category tag.
**Why**: One primitive avoids reimplementing the same copy/validation logic three times and
guarantees all three respect the future-date cap identically (copies go through the same
`localDateNotAfterToday` check as any other write — copying can't be used to route around it).
Keeping clustering presentation-only avoids reintroducing formal meal categories (breakfast/
lunch/dinner tags), which stays explicitly out of scope. Copies preserve each source entry's
local time-of-day when copying a whole day (reproduces the day's rhythm) and drop the
`logged_from_meal_id` back-reference (a copy is a fresh manual log, not a meal-logging event).
**Superseded (2026-07-20, partial)**: the shared `copyFoodEntries` primitive and the
presentation-only stance stand, but the **90-minute gap clustering was replaced by exact-timestamp
grouping** — see "Meal grouping of logged entries by exact `consumed_at`…" below. Requirement (c)
now copies an exact-timestamp group; `lib/domain/clustering.ts` is renamed to
`lib/domain/entry-grouping.ts`.

### Progressive disclosure: minimal fast-entry form by default, detail fields collapsed
**Date**: 2026-07-19
**Decision**: `FoodEntryForm`'s default view is just name + total calories + total protein +
date/time — quantity/unit/per-unit fields are hidden behind a collapsed "Add detail" expander.
A lookup pick still silently fills quantity/unit/per-unit and auto-expands the detail section to
show it. `MealItemForm` (meal-building, a deliberate lower-frequency action) keeps its fields
always visible.
**Why**: Jeff's core requirement is that day-to-day logging must be fast — the quantity/unit
richness added for accuracy directly worked against that if shown on every entry, every time.
Collapsing it behind an opt-in expander keeps the common case (a quick manual log) to the fewest
fields, while lookup-originated entries (where quantity genuinely matters, e.g. "3 servings")
still get the detail surfaced automatically.

### Persistent login (indefinite session) and installable PWA-lite, online-only
**Date**: 2026-07-19
**Decision**: Sessions stay logged in indefinitely on a device until an explicit "Log out" —
no forced re-authentication or app-imposed session timeout (Supabase's own long-lived rotating
refresh tokens handle this; `persistSession`/`autoRefreshToken` on the clients, a
`middleware.ts` refreshing the session cookie on navigation). The app also ships a web manifest
(`app/manifest.ts` + icons) so it can be added to the home screen and opens full-screen like a
native app — but **no service worker, no offline logging/sync/push** is included; that boundary
is explicit and out of scope for v1.
**Why**: Both reduce logging friction — no login prompts interrupting a quick log, and a
one-tap home-screen icon instead of finding a browser tab. True offline support is a
meaningfully bigger lift (local storage, sync/conflict handling) that wasn't asked for and is
deliberately deferred rather than silently scope-creeping in.

### "% of calories from protein" metric; day/meal rollups use ratio-of-sums
**Date**: 2026-07-20
**Decision**: Each food entry displays a protein-calorie ratio via the conventional formula
`(protein_g × 4) ÷ calories × 100`. The day-level and meal-group rollups use **ratio-of-sums** —
`(Σ protein_g × 4) ÷ Σ calories × 100` — computed in a pure `lib/domain/nutrition.ts`
(`proteinCaloriePct`), not stored. `proteinCaloriePct` returns `null` when calories are 0 (UI
shows `—`); values >100% from inconsistent source data are shown as-is (not clamped).
**Why**: Averaging each entry's individual percentage would let a tiny high-protein/low-calorie
item (e.g. a protein shake) skew the day — ratio-of-sums weights by calories, the correct and
conventional figure. The metric is a pure function of the existing generated `calories`/`protein_g`
columns, so storing it would only create a redundant, drift-prone column; it is derived at render
time. One function serves the per-entry, per-group, and per-day cases.

### Meal grouping of logged entries by exact `consumed_at` (replaces the 90-minute gap heuristic); smart time default
**Date**: 2026-07-20
**Decision**: For display/rollup, already-logged entries that share the **exact same** `consumed_at`
are treated as one meal group — deterministic, parameter-free (`lib/domain/entry-grouping.ts`,
`groupByConsumedAt`). This replaces the earlier >90-minute gap-heuristic clustering. It is a
derived grouping only — no `meal_group_id` column, no stored category — and is distinct from Saved
Meals (reusable templates). To make it ergonomic, `FoodEntryForm`'s date/time **defaults to the
previous entry's `consumed_at`** while adding items in the same sitting (within a 120-minute
freshness window of the real clock), falling back to "now" for the first entry, after the window
elapses, or on a change of selected day. `logMealForDay` already stamps one shared `consumed_at`
across its batch, so a logged saved meal is already exactly one group — no change needed there.
Requirement (c) of copy/repeat now copies an exact-timestamp group.
**Why**: Jeff rejected the gap heuristic — a user eating every 30 minutes for 3 hours has no
natural 90-minute chunk boundary, so the heuristic would split/merge arbitrarily. Exact-match is
fully deterministic and trivial to reason about (two entries are "the same meal" iff their
`consumed_at` is identical), and the smart default makes items logged together share a timestamp
with zero extra user steps. Accepted tradeoff: manually changing one item's time (or copying with an
explicit target time) puts it in its own group — a faithful reflection of what was entered, not a
bug. The 120-minute freshness window is a tunable presentation-only constant and changes no grouping
semantics.

### Food time-of-day entry snapped to a 15-minute grid, defaulting to the floor of "now"
**Date**: 2026-07-20
**Decision**: `consumed_at`'s time-of-day input is restricted to 15-minute intervals
(:00/:15/:30/:45) via a native `<input type="time" step="900">`. When the smart default doesn't
apply (first entry, freshness window elapsed, or day change), "now" resolves to the 15-minute
interval **at or before** the current time — a floor, not round-to-nearest (`lib/domain/datetime.ts`
`floorToQuarterHour`). Applies only to food entries (and, by extension, meal-batch logging, which
shares one `consumed_at`); `daily_metrics` has only a date, no time-of-day, so weight/body-fat
logging is unaffected. It is a UI affordance only — no DB constraint, and `consumed_at` keeps full
`timestamptz` precision in storage.
**Why**: Fewer, coarser choices make time entry faster (Jeff's ease-of-entry priority). **Floor,
not round-to-nearest**, because rounding up could produce a bucket later than the current time — a
not-yet-loggable future instant that the no-future-day cap would reject; flooring is always
at-or-before now, so it composes cleanly with that cap. A **native `step="900"`** input over a
custom picker gives keyboard entry, platform pickers, and accessibility for zero custom code
(prefer-conventional bias). It also **reinforces exact-`consumed_at` meal grouping**: snapping the
default and manual edits to the grid makes near-miss hand entries from one sitting (e.g. 12:03 vs
12:04) land on the same bucket and group correctly, reducing unintended splits. Accepted tradeoff:
sub-15-minute precision is lost from the UI (storage keeps full precision, so it's reversible), and
two truly distinct occasions inside one quarter-hour would share a bucket.

### Phase 1 implementation choices: Next.js 16 (not pinned to 14), Vitest + Playwright, `middleware.ts` kept despite deprecation
**Date**: 2026-07-20
**Decision**: Phase 1 (Foundation) was scaffolded with `create-next-app@latest`, landing on
**Next.js 16.2.10** rather than pinning to 14 — the design doc's requirement is "14+", and 16 is
the current release, so this satisfies it as a floor rather than a ceiling. Unit tests use
**Vitest** (jsdom environment) and acceptance/e2e tests use **Playwright** — neither framework was
specified in the design doc or `AGENTS.md`; both are the conventional current choice for a
Next.js/TypeScript stack, matching the project's stated bias toward standard, non-clever defaults.
The session-refresh file is named `middleware.ts` (at `src/middleware.ts`), exactly as the design
doc's §3.1 module tree specifies, even though Next.js 16 prints a deprecation warning steering
toward a renamed `proxy.ts` convention (same behavior, `next build` output confirms it still
works — not an error).
**Why**: Matching "14+" literally with a pin would mean deliberately installing an older, no-longer-
default version for no functional benefit; using latest is the lower-maintenance default and still
satisfies the doc. Vitest/Playwright were an implicit gap in the design doc (which specifies unit
test *content* in §6 but not *framework*) — recorded here so it's an explicit choice, not a
silent one, and so qa-reviewer knows what `npm test`/`npm run test:e2e` actually run. Keeping
`middleware.ts` avoids a implementation deviating from the literal doc text over a naming-only
framework change with no functional difference; flagged in `ai-context/PROGRESS.md` "Notes" for
the architect to decide whether to update the doc (or accept the eventual forced rename) before
Next.js actually removes the old convention in a future major version.

### Local Supabase CLI (`supabase start`) as the Phase 1 dev/test backend; no hosted project created by AI agents
**Date**: 2026-07-20
**Decision**: Phase 1 wires the app against `npx supabase init`-generated
`supabase/config.toml` (Docker-based local Postgres/Auth/Studio via `supabase start`), with
`auth.email.enable_confirmations` explicitly turned on (overriding the CLI's local-dev default of
`false`) to mirror the hosted project's default and the project's built-in-email-confirmation
decision. No hosted Supabase project was created — AI agents in this workflow don't have
credentials for one and can't provision hosted infrastructure themselves.
**Why**: Local Postgres via Docker is the standard way to develop/test against a real Supabase
instance without waiting on hosted-project provisioning or spending real API quota, and lets
migrations (Phase 2+) and RLS policies actually run somewhere before Jeff creates a hosted
project. Accepted limitation: this developer's sandbox had no Docker, so `supabase start` itself
was never actually run here — the config is believed correct (matches documented CLI schema and
the design doc's decisions) but unverified until someone with Docker runs it, which is now the
first item on the Phase 1 qa-reviewer checklist.

### CI runs an ephemeral local Supabase instance — no hosted "CI project", no GitHub Actions secrets
**Date**: 2026-07-20
**Decision**: `.github/workflows/ci.yml` spins up an **ephemeral local Supabase stack inside the CI
job** (Docker, via `supabase/setup-cli` + `supabase start` against the committed
`supabase/config.toml`) — the same stack local dev runs — rather than pointing CI at a hosted
CI-dedicated Supabase project. The running stack's fixed local API URL / anon key / service-role key
are captured at runtime with `supabase status -o env --override-name …` and appended to `$GITHUB_ENV`
as `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, so the
`build`, the Playwright-launched Next server, and `test:e2e` (including the service-role
`e2e/helpers/admin-client.ts` test-user helper) all work. Result: **zero GitHub Actions secrets are
required for CI to go green, and no hosted project is needed for CI at all.** `USDA_FDC_API_KEY` is
also not required (CI mocks the lookup providers) — the workflow uses a `'ci-dummy-usda-key'`
fallback, so it never blocks Phase 1's CI.
**Why**: (recommendation evaluated and adopted) This mirrors local dev exactly, is Supabase's
documented CI pattern, and removes every pre-flight setup step that would otherwise block CI —
nothing for Jeff to provision or configure before Phase 1 turns green. The local demo keys are
well-known non-secret values; capturing them via `supabase status -o env` (instead of hardcoding the
JWTs) is resilient to CLI/key changes. Rejected the hosted-CI-project-plus-secrets alternative
(which would be "closer to production") because it adds a project to provision and maintain, real
secrets to store/rotate (`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`), and a gate
that blocks CI until configured — disproportionate for a solo v1 whose migrations and RLS run
identically on the local stack. A hosted Supabase project is still needed **eventually, only for the
real Vercel production deploy** (with its own env vars set in Vercel, not GitHub) — not for CI.

---
