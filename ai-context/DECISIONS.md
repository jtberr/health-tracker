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
**Superseded (2026-07-25) as to the *control*, not the *model*:** the 15-minute grid, the
floor-to-past "now" default, the exact-`consumed_at` meal grouping it reinforces, and the
`HH:MM` internal value all stand unchanged — but the **native `<input type="time" step="900">`
is replaced by a plain native `<select>` of the 96 valid quarter-hour values**. Reason: `step`
constrains valid *values* but browsers still *render* `<input type="time">` as three separately-set
segments (hour/minute/AM-PM) regardless of `step`, so the "fewer interactions" friction win this
entry was chosen for was never actually delivered. See "Food time-of-day entry is a native
`<select>` of 96 quarter-hour options…" below.

### Food time-of-day entry is a native `<select>` of 96 quarter-hour options (replaces the `<input type="time" step="900">` widget)
**Date**: 2026-07-25
**Decision**: The food-entry time-of-day control is a **plain native `<select>`** whose options are
the 96 valid quarter-hour instants of a day (12h × 4 × AM/PM: "12:00 AM", "12:15 AM", … "11:45 PM").
Each `<option>`'s **`value` stays 24-hour `HH:MM`** (`"00:00"`, `"08:15"`, `"23:45"`) — exactly the
string the form field, `localInputToUtcInTz`, and the server-side `validateFoodEntryInput`
already consume — while the **12-hour AM/PM form is display-label-only** (the option's visible text).
This supersedes the `<input type="time" step="900">` widget from the entry above; nothing else about
the time model changes (15-minute granularity, the `floorToQuarterHour` floor-of-now default, the
smart `defaultConsumedAtForNextEntry` same-sitting default, exact-`consumed_at` meal grouping, and
the no-future-day cap are all untouched, because none of them key off the widget — they key off the
`HH:MM` value / the resulting `consumed_at`). Applies to `FoodEntryForm` and, when built, to
`LogMealDialog`'s log-time picker (Phase 7). It does **not** apply to `MealItemForm`: saved-meal
items carry no `consumed_at` and have no time field at all, so there is nothing to change there. One
required implementation invariant: because a `<select>` can only display a value present in its
option set, the **edit path must inject the entry's actual stored time-of-day as an extra selected
option if it is ever off-grid** (e.g. a legacy or copied entry whose `consumed_at` doesn't land on a
quarter hour), so opening an entry for an unrelated edit can never silently snap/rewrite its time.
**Why**: The original entry chose native `<input type="time" step="900">` specifically "for zero
custom code" friction reduction — but that reasoning had a real gap, confirmed by hands-on use (not a
QA miss; qa tested exactly the spec — grid enforcement + server-side off-grid rejection — and both
pass): `step` only restricts which values are *valid*, it does **not** change how Chrome/Edge/Safari
*render* the widget, which is always three independently-set segments (hour, minute, AM-PM). So the
constraint worked but the "fewer interactions to pick a time" benefit was never delivered — the whole
reason a coarse grid was chosen over free-minute entry. Since the app only ever needs 15-minute
granularity, a flat 96-option list collapses time selection to **one interaction** (open, pick),
which is the actual friction win, and directly serves the project's first-order ease-of-entry goal on
the everyday logging path. A **plain native `<select>`** (not a custom combobox/dropdown) is the
right control: it's standard HTML, needs zero custom JS, and is fully keyboard- and screen-reader-
accessible for free — matching the project's explicit prefer-conventional / no-clever-when-standard-
exists bias. Keeping the option **`value` as 24-hour `HH:MM`** means the change is presentation-only
below the form boundary: server validation (`TIME_PATTERN` + `minutes % 15 !== 0`),
`localInputToUtcInTz`, `consumed_at` construction, grouping, and the future-day cap all see the exact
same string they do today, so no domain/action/test contract moves — only the rendered control and
its labels. **Accessibility is a wash-to-net-improvement, not a regression:** a native `<select>`
gives screen-reader users a single labeled control announcing "X of 96" with working type-ahead
(typing "8" jumps toward the 8-o'clock options) and keyboard arrow navigation, versus the time
input's three separate segment interactions; and in the common in-sitting case the smart default
already pre-selects the correct value, so the control is usually not touched at all — this fix is
about the cases where the user *does* adjust it. **Accepted tradeoffs:** on mobile the gap is smaller
(both render as native platform pickers), but a single-column 96-item list is still no worse than the
time input's three-column wheel and is more consistent with desktop; and a 96-long list is longer to
scroll than a wheel, mitigated by type-ahead and the pre-selected smart default. **Rejected:** a
custom dropdown/combobox component (violates the conventional-default bias and adds JS/accessibility
surface for no benefit over `<select>` at this option count); and keeping the native time input (its
friction-reduction premise doesn't hold, per above).

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

### `food_entries.logged_from_meal_id` stays a plain FK (RLS + app-layer write invariant), NOT a composite ownership FK like `meal_items.meal_id`
**Date**: 2026-07-21
**Decision**: Keep `food_entries.logged_from_meal_id` as a **plain single-column `FK → meals(id) ON DELETE
SET NULL`** — it does not carry or check the meal owner's `user_id`, and deliberately does *not* mirror the
composite `(meal_id, user_id) → meals(id, user_id)` FK that `meal_items` uses. Same-owner-ness of this column
is instead guaranteed on the **write path**: `logMealForDay` (Phase 7) may set `logged_from_meal_id` only to a
meal it read as the acting user's own through the RLS-scoped server client, never the service-role client.
The design doc's §3.2 and §8 Phase 7 were updated to state this app-layer invariant explicitly (it was
previously implicit — which is how qa-reviewer's flag came to be raised), plus a Phase 7 qa-reviewer test
(`logMealForDay` with another user's `mealId` fails and writes no rows). Raised by qa-reviewer at the Phase 2
checkpoint as non-blocking; evaluated and closed as "keep as-is, document the invariant."
**Why**: The composite FK on `meal_items` is load-bearing for a specific reason that does **not** transfer to
`food_entries`. `meal_items.user_id` is a *denormalized copy of the owner that RLS itself trusts* (RLS keys
off that column, not off a join to `meals`), and a meal item is a composition of its parent meal
(`ON DELETE CASCADE`, no independent existence) — so its owner column must be kept in lockstep with
`meals.user_id`, which is exactly what the composite FK enforces; without it the denormalized owner could
drift or be spoofed and RLS would be trusting a lie. `food_entries` has none of that: a food entry is an
independent aggregate root, and `logged_from_meal_id` is a *weak informational back-reference*, **not** an RLS
discriminator — `food_entries` RLS keys purely off `food_entries.user_id`. So a stray cross-user
`logged_from_meal_id` corrupts no trust boundary: any read that joins it back to `meals` goes through the
RLS-scoped client and a foreign reference resolves to **null/invisible** (RLS filters `meals` to the caller's
own rows), never to another user's data — the same already-accepted "points to a since-invisible/deleted
concept" state `ON DELETE SET NULL` already embraces. No planned Phase 3+ query breaks or leaks on it: copy/
repeat (Phase 8) *drops* `logged_from_meal_id` outright, and `FoodEntryList` labeling just shows no "from
meal" label for an unresolved reference (cosmetic, self-inflicted, no leak). A composite FK would also fight
the required delete semantics: a plain composite `ON DELETE SET NULL` nulls **all** referencing columns —
including the row's own NOT NULL `user_id` — breaking the row when a meal is deleted; avoiding that needs the
less-common Postgres-15 `ON DELETE SET NULL (logged_from_meal_id)` column-list variant, i.e. real added
complexity purely to defend an invariant RLS already makes non-load-bearing. Net: RLS-on-read fully contains
any exposure, the natural `ON DELETE SET NULL` (delete a meal, keep the logged history — a core decision) is
cleaner as a plain FK, and the one genuine gap (nothing stopped a *direct* authenticated insert from writing a
foreign meal id) is closed where it actually matters — the server action — and now stated explicitly rather
than left implicit. No migration change required.

### `user_goals` ensure-row reads its result from the same `upsert(...).select()` call, never a separate re-`select`
**Date**: 2026-07-22
**Decision**: `getGoals()`'s first-visit "create the default row" path is one call —
`.upsert({ user_id }, { onConflict: 'user_id' }).select().single()` — not an insert (or
ignore-duplicates upsert) followed by a second, separately issued `select` to read the row back.
**Why**: A separate re-`select` was tried first and intermittently returned an empty result even
though the insert had already committed (confirmed via direct debug logging: the insert returned
`201 Created`, an unfiltered `select *` right after saw the new row, but a *differently-shaped-only-
by-coincidence-of-being-identical-to-an-earlier-call* filtered re-select did not). Root cause: the
re-select had the exact same table/filter shape as an earlier "does a row already exist" check
earlier in the same Server Component render, and Next.js App Router's fetch **Request
Memoization** deduped the two, serving the first (pre-insert, empty) call's cached result instead
of re-querying Postgres. Reading the row back from the mutating call's own response sidesteps this
by construction — there is no second identically-shaped request to collide with. This is not
`goals.ts`-specific: **any Server Component that reads, writes, then re-reads within one render**
can hit this, so any future get-or-create-style logic (a Phase 5+ read-modify-read flow) should
prefer "read the mutation's own response" over "mutate, then issue a plain re-select" whenever
the two reads could end up shaped identically. Logged in more detail in
`ai-context/PROGRESS.md`'s Notes for 2026-07-22.

### `SettingsForm`'s fields remount (keyed on `updated_at`) after every successful save, rather than staying one long-lived controlled component
**Date**: 2026-07-22
**Decision**: `SettingsForm` is split into an outer component (owns `useActionState`/`formAction`)
and an inner `SettingsFields` component keyed on the latest known-good `user_goals` row's
`updated_at` (the just-saved row on success, otherwise the initial server-fetched row). A
successful save therefore remounts `SettingsFields` with fresh local state, rather than the same
instance's controlled state persisting across the submit.
**Why**: Caught only by manually driving the app in a real browser, not by the automated
suite — `e2e/phase4-acceptance.spec.ts` asserts the *stored* value via a direct DB read after
reload, which was always correct, so it never exercised the *immediate* post-save DOM. In the
browser, right after a successful save the "Weight unit" radio visibly snapped back to its
pre-save selection (e.g. back to kg after saving lb) even though the save itself was correct.
Root cause: React resets the underlying native `<form>` once a form Action settles, and that
reset directly mutates the DOM `checked` property outside of React's own reconciliation; since
the component's `weightUnit` state hadn't changed (the user's selection was never undone, only
the native DOM), React had no reason to re-assert the correct `checked` value on its next render,
so the mismatch stuck until something else (like a reload, which re-derives fully from the
server-fetched row) forced a fresh render. Remounting via a key that changes on every successful
save sidesteps this by construction — the new instance's DOM is created fresh from the
already-correct saved data, so there's nothing for the native reset to desync. This is the same
"reset state via key" pattern `MetricForm` already uses when switching days, applied to the
"successful save" transition instead. **General implication for future phases**: any form using
`useActionState` with a *controlled* checkbox/radio (not just text inputs) should be checked for
this exact symptom by hand in a browser — it will not surface from automated tests that only
assert the persisted DB value or a post-reload render.

### Visual identity: warm-paper + sage/clay palette, Fraunces-for-headings, pill/soft-radius, single "sage arc" motif
**Date**: 2026-07-25
**Decision**: Adopt a deliberate visual identity, replacing the app's accidental default-Tailwind
`zinc`+`indigo` styling (which was never a decision — it was `create-next-app`'s defaults, later
propagated into `components/ui/` by the 2026-07-22 "Visual redesign" commit but still never
recorded). Direction was chosen by Jeff after a side-by-side review against noom.com, translating
Noom's *feeling* — calm, warm, health-forward — into a daily-use logging tool, **not** copying its
marketing-page literal content (no lifestyle photography, no serif marketing hero, no
uppercase-tracked pill CTAs, no organic blob section transitions).

**Design tokens** (live in `src/app/globals.css`; see the "where tokens live" decision below).
Contrast ratios below are computed against `--paper` unless noted, and drive the semantic usage
rules — the token *values* are as Jeff suggested; the *usage rules* are what keep them WCAG AA:

| Token | Value | Contrast | Semantic use — and the accessibility guardrail |
|---|---|---|---|
| `--paper` | `#FBF8F1` | — | App background (replaces `zinc-50`/`#fafafa`); card surfaces stay white or `--paper`. |
| `--ink` | `#23211C` | 15.2:1 on paper | Body/heading text **and** primary-button fill (replaces `zinc-900`). White/paper text on an ink button is ~15:1. |
| `--sage` | `#A9BE8C` | **1.9:1 on paper — FAILS text** | **Decorative FILL ONLY**: the arc motif, chart area fills, badge/hover backgrounds, large flat blocks. **Never** a text color, link color, or focus-ring color on paper (fails both the 4.5:1 text and 3:1 non-text thresholds). Ink text *on* a sage fill is ~8:1 (fine). |
| `--sage-deep` | `#5C7444` | 4.9:1 on paper | The **accent that carries meaning**: link text, active-nav text, focus rings/outlines (replaces every `indigo-600`/`indigo-500`/`indigo-700` use). 4.9:1 clears AA text (4.5) and the 3:1 focus-indicator rule. |
| `--sage-pale` | `#E3EAD6` | — | Badge / hover-fill / active-nav background tint (replaces `indigo-50`). Put **ink** text on it (~13:1); `--sage-deep` on `--sage-pale` is only ~4.2:1, i.e. a hair under AA for `text-xs`, so don't use sage-deep for small text on this tint. |
| `--clay` | `#C97452` | 3.2:1 on paper — large/fill only | The single secondary accent, **used sparingly for positive emphasis only** (streaks, milestones). OK as large stat numerals, an icon fill, or a badge background (with ink text on it, ~4.7:1). **Not** for small body text (fails AA), and **never** for errors/warnings. |

Semantic reds/ambers/greens already in the code are **out of scope and stay**: the `red-600` error
text/borders (Jeff explicitly excluded them), the `amber-50/amber-800` auth-callback notice on the
login page (a warning signal, not brand), and field-border grays. The one existing green that *is*
touched deliberately — `SettingsForm`'s `emerald-50/emerald-700` "Settings saved." pill — moves to
`--sage-pale` + `--ink` **as an intentional choice** (a transient, low-stakes success confirmation
reading on-brand), *not* as a blind find-replace of "a green"; it must not be confused with the
persistent semantic red, which is a standing status and stays its own hue.

**Type**: add **Fraunces** (a warm humanist serif, Google Fonts) self-hosted via `next/font/google`
— identical loading pattern to the already-loaded Geist, so **no external runtime request and no
CSP/privacy implication** (the fonts are served from our own origin at build time). Fraunces is used
**only** for headings, the wordmark, and large stat numerals. **Geist Sans stays the body/UI/forms/
data face, unchanged** — deliberately not replacing an already-good workhorse; the serif is an
accent, not a wholesale swap.

**Shape**: buttons become fully-rounded pills (`rounded-full`, replacing the current
`rounded-lg`/`rounded-md` mix); cards soften from `rounded-lg`/`rounded-xl` to `rounded-2xl`.

**Signature motif**: a single quiet **"sage arc"** — one thin curved line (evoking a day's progress
curve) rendered in `--sage` as a restrained backdrop element, **once per screen** (behind the auth
card, behind the dashboard "Today so far" block, behind empty states). This is the one deliberate
visual risk; **everything else stays quiet on purpose.** **Explicit guardrail: the arc appears at
most once per screen and never becomes repeated decoration** — if it starts showing up on cards,
list rows, or multiple times per page, that has drifted from the decision and should be pulled back.
**Superseded (2026-07-26, scope only — the auth-screen usage stands):** the dashboard usage is
removed; the arc is now **auth screens only** (`(auth)/layout.tsx`), not the dashboard. Jeff's
call, made directly (no architect loop needed for narrowing an already-recorded decision): on the
dashboard the arc's `<svg>` was absolutely positioned while `DailyTotals`' `Card` was not, so per
CSS stacking rules the (non-positioned) card painted *before* the (positioned) arc regardless of
DOM order — the arc rendered visibly on top of the stat numbers rather than behind them as
intended, confirmed against a live screenshot. Beyond that rendering bug, Jeff judged that even a
correctly-stacked arc-sliver poking out from one card on one screen read as arbitrary rather than
intentional, and rejected the alternative of adding it to every page's header (that would trade
one glitch for exactly the "repeated decoration" outcome this decision's own guardrail warns
against). Net: the motif now appears on exactly one surface (auth), which is still "at most once
per screen." `(app)/page.tsx`'s dashboard reverted to just its heading + `TodaySummary`, no wrapping
`relative overflow-hidden`/`<svg>`.

**Why**: The prior palette carried no intent and the two most-seen-first screens (`(auth)/login`,
`(auth)/signup`) were never even brought into the `components/ui/` system — they still use raw
ad-hoc classes (a hardcoded `bg-zinc-900` button, no `Button`/`Card` reuse), making the app's first
impression its most dated. Recording this as a real decision (with tokens, usage rules, and the
verified contrast constraints) is what the indigo/zinc choice never got, and is what lets the
developer roll it out consistently instead of re-guessing per screen. The sage-mid/clay text
restrictions above are the substantive finding: the suggested hex values are fine, but sage-mid can
only be a fill and clay only large/emphasis — enforced by choosing `--sage-deep` for anything that
must be legible (links, nav, focus). Fraunces-headings-only and Geist-body keeps the register warm
but plain (a frequent-use tool, not a landing page), and self-hosting keeps the privacy posture
identical to today. **Rejected** (per Jeff's review): Noom's literal marketing treatment —
lifestyle photography, serif marketing hero copy, uppercase button labels (sentence case fits this
app's plainer register), and blob section transitions beyond the single arc.

### Visual-identity tokens live in `globals.css` `@theme inline`; `components/ui/*` consume Tailwind color utilities, not inline hex
**Date**: 2026-07-25
**Decision**: The tokens above are defined as CSS custom properties on `:root` in
`src/app/globals.css` and exposed to Tailwind v4 via its `@theme inline` block (e.g.
`--color-paper: var(--paper)`, `--color-ink`, `--color-sage`, `--color-sage-deep`,
`--color-sage-pale`, `--color-clay`), so they become first-class utilities (`bg-paper`, `text-ink`,
`ring-sage-deep`, `bg-sage-pale`, etc.). `components/ui/` primitives (`Button.tsx`, `Card.tsx`,
`NavLink.tsx`, `styles.ts`) and every screen reference those utilities — **no raw hex in
components** — so the palette has exactly one source of truth. Fraunces is registered in
`src/app/layout.tsx` as a `next/font/google` instance with a `--font-serif` CSS variable and wired
into `@theme inline` as `--font-serif` (a `font-serif` utility), mirroring how `--font-geist-sans`
is done today.
**Why**: This is the structure the repo already uses — `globals.css` already has the `:root` +
`@theme inline` pattern for `--background`/`--foreground`/`--font-geist-sans`, so extending it is the
lowest-surprise, conventional Tailwind-v4 approach and keeps the developer from inventing a parallel
config. Centralizing in tokens is also what makes the two-pass rollout (below, design doc §8
"Visual identity") mostly a matter of swapping utility names, since the already-restyled Food/Weight/
Settings screens reference a small shared vocabulary.
**Also decided (light-only)**: `globals.css` currently has a `@media (prefers-color-scheme: dark)`
block that flips only `--background`/`--foreground` — but nothing else in the app respects those
(cards are hardcoded `bg-white`, text `zinc-900`), so dark mode is already non-functional. This warm
light palette is explicitly **light-only for v1**; the dark-mode media block should be **removed**
as part of this work rather than shipping a half-wired dark theme against warm paper. A real dark
theme is a future decision, not silently half-present.
**Also decided (component-mapping guardrails — the one non-mechanical part of the swap)**: the
rollout is *mostly* a utility-name swap, but three spots must not be blind find-replaced:
- **Active `NavLink` must be `bg-sage-pale text-ink`, NOT `bg-sage-pale text-sage-deep`.** The active
  nav today is `bg-indigo-50 text-indigo-700`; the naive mapping (`indigo-50→sage-pale`,
  `indigo-700→sage-deep`) lands on `sage-deep`-on-`sage-pale` = ~4.2:1, which is under AA (4.5:1) for
  `NavLink`'s normal-weight `text-sm`. Use **`--ink` on `--sage-pale`** (~13:1) for the active pill;
  reserve `--sage-deep` for text/links/focus that sit **on `--paper`/white** (4.9:1). This resolves
  the apparent tension between the token table's `--sage-deep` row (which lists "active-nav text") and
  its `--sage-pale` row (which warns off small `--sage-deep` text on that tint) — `--sage-pale` wins
  for the active-nav *background*, so its text goes to `--ink`.
- **`Button`'s `danger` variant and `errorTextClass` stay their existing red** — semantic status, out
  of scope per the entry above; do not route them through the brand palette.
- **`(auth)/login` + `(auth)/signup` need a structural refactor, not a color swap.** `LoginForm`/
  `SignupForm` hand-roll their own `<button className="...bg-zinc-900...">`, `<input>`, `<label>`, and
  link styles instead of using `components/ui/` at all. They must be refactored to consume `Button`,
  `Card`, and `styles.ts` (`inputClass`/`labelClass`/`errorTextClass`) so they inherit the tokens like
  every other screen — this is what makes "one source of truth" actually true for the first-impression
  pages, and is why they're their own pass in the design doc §8 rollout.

### Phase 5 implementation choices: trend-series reads inlined in the client view (not a Server Action), Recharts data-series colors via `currentColor` + Tailwind `className` (not hex), dot markers keyed on the domain `isReal` flag
**Date**: 2026-07-25
**Decision**: Three implementation choices for Phase 5 ("Trend charts"), none specified precisely
enough by the design doc's §8 Phase 5 bullet to be unambiguous, recorded here per the project's
"flag deviations/implicit decisions" convention: (1) `getWeightSeries`/`getIntakeSeries` (the exact
names §8 Phase 5 uses) are plain async functions living in `components/trends/TrendsView.tsx`
itself — not a `'use server'` Server Action, and not a separate query-layer module — that query
`daily_metrics`/`daily_food_totals` through the RLS-scoped **browser** Supabase client and hand the
rows to the pure `lib/domain/trends.ts` builders. (2) `WeightChart`/`IntakeChart`'s data-series
`Line`/`ReferenceLine` colors are set via `stroke="currentColor"` plus a Tailwind
`className="text-sage-deep"`/`"text-clay"` on the same element — never a literal hex string —
while `CartesianGrid`/`XAxis`/`YAxis` (which don't accept a `className` at all, per the installed
`recharts` type declarations) use two small documented constants that are Tailwind's own built-in
`stone-200`/`stone-500` neutrals, not a second copy of the brand palette. (3) Each chart's dot
marker is a custom render function that checks the data point's own `isReal` boolean (carried
through from `lib/domain/trends.ts`), not Recharts' own implicit "no dot for a `null` value"
behavior, even though the two are equivalent for this data shape.
**Why**: (1) mirrors the already-established Phase 3/4 precedent (`FoodDayView`, `MetricForm`,
`TodaySummary`) that any read whose date window depends on "today in the user's local timezone"
must happen client-side, since the server can't determine that reliably — a trend chart's range is
exactly this kind of read, so keeping the query beside the client component that needs it (rather
than introducing a new server-side data-access pattern for just this one screen) stays consistent
with the rest of the codebase. (2) preserves "no raw hex in components, one source of truth for the
brand tokens" (see the two 2026-07-25 visual-identity entries above) for the colors that carry
actual brand meaning, using the exact `currentColor`-on-a-colored-ancestor technique the dashboard's
"sage arc" motif already established, rather than inventing a second technique; the two neutral
grid/tick constants are a narrow, documented exception forced by Recharts' own API (verified by
reading its type declarations, not assumed) rather than a silent drift from the palette. (3) keying
the dot on `isReal` rather than the incidental null-check makes the "chart gaps: connect across
missing days, mark real entries with a dot" rule an explicit, intentional property of the render
code — matching what `lib/domain/trends.ts`'s dense-series builders were designed to expose — rather
than something that happens to work today because of how the values are currently encoded.

---
