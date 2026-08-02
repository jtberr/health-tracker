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
**Amended (2026-07-26, label *format* only — the control, the value contract, and every time-model
invariant stand):** the option label format changes from a bare-hour 12-hour string (`"8:15 AM"`) to a
**zero-padded** one (`"08:15 AM"`), so all 96 labels are the same character count and line up as a
column while scrolling. The `<select>` itself, the 96-option set, the 24-hour `HH:MM` option `value`s,
and everything below the form boundary are unchanged. Two specific claims in this entry are superseded
by that amendment: (a) the four labels enumerated in the Decision paragraph read as `"12:00 AM"`,
`"12:15 AM"`, … `"11:45 PM"` — still literally correct, since those all have two-digit hours, but
one-digit-hour examples elsewhere (`"8:15 AM"`) now render `"08:15 AM"`; and (b) the type-ahead claim
in the Why ("typing `8` jumps toward the 8-o'clock options") **no longer holds** — with padded labels
the user types `0` then `8`. That regression was weighed and accepted; see "Time-`<select>` option
labels are zero-padded…" below for the full reasoning.

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

**Amendment (2026-07-26) — the "field-border grays… stay" carve-out is partially superseded for a
genuine AA contrast failure, not a stylistic re-litigation:** qa-reviewer measured the actual
shipped colors against `#ffffff` (`inputClass`/`Card` are both on a white surface) using the
standard WCAG relative-luminance formula and found two of the three carved-out grays fail their
applicable threshold:
- `placeholder:text-stone-400` (`#a8a29e`) → **2.52:1** on white — fails the 4.5:1 AA text minimum.
- `border-zinc-300` (`#d4d4d8`, `styles.ts`'s shared `inputClass`) → **1.49:1** on white — fails the
  3:1 WCAG 1.4.11 non-text/UI-component minimum.
- `Card`'s `border-stone-200` (`#e7e5e4`) → **1.26:1** on white — also fails the same 3:1 minimum.

Fix: both moved to **`stone-500`** (`#78716c`), the nearest step up in the same warm-neutral family
already used elsewhere in the rollout (chart grid/tick neutrals) — **4.80:1** on white, clearing
both the 4.5:1 text and 3:1 non-text bars with margin. No new gray family was introduced. The
*labels*/*legends*/other stone-700 body text and `Card`'s general "stay warm-neutral, not brand"
intent are untouched — only the two specific under-threshold shades moved. The original reasoning
for excluding these three from the sage/clay/ink rollout (they're structural chrome, not brand
color) still stands and is not what's being revised; what's revised is which *shade* of gray
satisfies both "stays neutral" and "passes AA" at the same time — the original choice hadn't
actually been checked against contrast math when it was carved out, and now has been.

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

### Time-`<select>` option labels are zero-padded (`"08:15 AM"`), with `tabular-nums` as a secondary polish — a label-format change, not a CSS-only one
**Date**: 2026-07-26
**Decision**: Fix Jeff's 2026-07-25 complaint that the 96-option time `<select>`'s options don't line
up in a column by changing **the label string itself**, with a CSS utility as a secondary polish:

1. **`formatTimeLabel(value)` in `src/lib/domain/datetime.ts` zero-pads the 12-hour hour to two
   digits.** `"08:15"` → `"08:15 AM"` (was `"8:15 AM"`); `"18:30"` → `"06:30 PM"` (was `"6:30 PM"`).
   Labels with a two-digit hour are unchanged (`"12:00 AM"`, `"11:45 AM"`, `"12:00 PM"`, `"11:45 PM"`).
   Every one of the 96 labels becomes exactly 8 characters, in the fixed shape `hh:mm AM|PM`. This is
   a one-line change (drop the existing `displayHour` collapse into a `String(displayHour).padStart(2, "0")`);
   the AM/PM and 12-vs-24-hour mapping rules themselves do **not** change.
2. **`quarterHourOptions()` needs no edit of its own** — it already derives every label by calling
   `formatTimeLabel(value)`, so it inherits the new format, and so does `FoodEntryForm`'s
   defensively-injected off-grid option (same helper), which keeps the edit invariant intact and
   consistently formatted (a legacy `09:07` renders `"09:07 AM"`).
3. **`FoodEntryForm.tsx` adds Tailwind's built-in `tabular-nums` utility** to the time `<select>`
   (`className={`${inputClass} tabular-nums`}`) **and to each `<option>`** (`className="tabular-nums"`).
   Both are needed: some browsers render popup option text from the option's own computed style rather
   than inheriting the select's. This is a **best-effort polish, not the fix** — see Why.
4. **Explicitly not changed**: `src/components/ui/styles.ts`'s shared `inputClass` (the utility goes on
   the one control that needs it, not on every text/number/date field app-wide); no monospace font
   anywhere; no new CSS token, no custom CSS, no `<optgroup>`, no change to the option count.

**Test impact** (all label-assertion sites, verified by grep — the developer should expect exactly
these and no others): `src/lib/domain/datetime.test.ts` — the `formatTimeLabel` cases for `"08:15"` and
`"18:30"`, and the `quarterHourOptions` "crosses the noon/midnight boundary" cases only insofar as they
assert one-digit-hour labels (the enumerated `12:00 AM`/`11:45 PM`/`12:15 PM` cases are unaffected);
`e2e/food-logging.spec.ts` lines ~72/~74 assert `options.first()`/`options.last()` text, which are
`"12:00 AM"`/`"11:45 PM"` — **both unchanged**, so that spec likely needs no edit at all. **No e2e test
selects an option by label** — every `selectOption(...)` call in `e2e/` passes the `HH:MM` *value*
(`"08:15"`, `"12:07"`, `"12:30"`), so the Playwright suite is insulated from this by construction. A
new unit case asserting a uniform label length across all 96 options is worth adding, since "they all
line up" is now a real, testable property rather than an incidental one.

**Invariants explicitly confirmed unchanged** (this is a label-text change only, strictly above the
form boundary): the option **`value` contract stays 24-hour `HH:MM`**; the **15-minute grid** and its
96 buckets; `floorToQuarterHour`'s **floor-of-now** default; `defaultConsumedAtForNextEntry`'s smart
same-sitting default and its 120-minute freshness window; **exact-`consumed_at` meal grouping**; the
**no-future-day cap**; server-side `validateFoodEntryInput` (`TIME_PATTERN` + `minutes % 15 !== 0`);
`localInputToUtcInTz`; `consumed_at` storage precision; and the off-grid-option **edit invariant**.
Nothing downstream of the rendered label reads it — validation, conversion, grouping, and the cap all
key off the `HH:MM` value or the resulting `consumed_at`, so none of them can observe this change.
Scope: `FoodEntryForm` today, and `LogMealDialog`'s log-time picker when Phase 7 builds it (it consumes
the same `quarterHourOptions()` helper, so it inherits this for free). `MealItemForm` is untouched —
saved-meal items carry no `consumed_at` and have no time field.

**Why**: The central finding is that **the CSS-only fix does not actually work, so this cannot stay a
pure rendering concern.** `font-variant-numeric: tabular-nums` equalizes the advance width of each
*digit glyph*; it cannot conjure a character that isn't there. `"8:15 AM"` is seven characters and
`"11:45 PM"` is eight, so in a left-aligned list the colon, the minutes, and the AM/PM of every
one-digit-hour row sit one glyph to the left of every two-digit-hour row — with or without tabular
figures. This is not a marginal case: of the 96 labels, **72 have a one-digit hour** (12-hour hours
1–9) and only 24 have two digits (10, 11, 12), so the ragged edge is what you see for most of the
scroll — exactly what Jeff reported. Equal character count is therefore the necessary condition, and
that lives in the label string, i.e. in `formatTimeLabel`. Accepting a small, well-tested change to one
pure domain function is the honest fix; reaching for CSS because it's "not domain logic" would have
shipped a change that demonstrably doesn't solve the reported problem.

`tabular-nums` still earns its place as a **secondary** measure, for a different reason than the one
it's usually reached for: once all labels are 8 characters, any residual drift comes from proportional
figures (a `1` narrower than an `8`), which depends on Geist Sans' default figure set — not something
worth guessing about when one built-in Tailwind utility makes it deterministic at zero cost. It is
deliberately *not* the load-bearing fix, because **`<option>` styling is unreliable exactly where it
matters most**: macOS Safari/Chrome largely ignore `<option>` CSS (native menu rendering), and every
mobile browser renders the option list as a native platform picker that ignores author CSS entirely.
The padded label is *content*, so it survives all of those paths; the CSS is an enhancement on the
platforms that honor it. Getting this ordering wrong (CSS as the fix, padding as optional) would leave
mobile — a primary surface for a "log it fast" app — unfixed.

Zero-padding also happens to make the picker **more** consistent with the rest of the app, not less:
`FoodEntryList`'s meal-group headers already render times as raw 24-hour `HH:MM` from `utcToLocalTime`
(`"08:15"`, `"23:45"`) — already two-digit-hour and already uniform-width. So the padded picker moves
toward the existing display convention rather than inventing a third one. (The list's lack of AM/PM is
a separate pre-existing inconsistency; deliberately **out of scope** here, not silently changed.)

**Accepted tradeoff — a real, small type-ahead regression, called out rather than glossed:** the
2026-07-25 entry advertised native `<select>` type-ahead ("typing `8` jumps toward the 8-o'clock
options") as an accessibility benefit. Browser type-ahead prefix-matches the option's *text*, so with
`"08:15 AM"` a bare `8` matches nothing and the user must type `0` then `8`. This was weighed against
simply not fixing the alignment, and the fix wins: the previous behavior was already coarse (a lone
`8` landed on the first `8`-something option and needed repeat presses to advance), the two-keystroke
form is fully deterministic once learned, arrow-key navigation is unaffected, and — the deciding
point — in the common in-sitting case the smart default already pre-selects the right value, so the
control is usually not touched at all. Jeff raised scanning-while-scrolling, a mouse/touch path, as the
actual pain; trading a marginal keyboard shortcut for it is the right direction. Flagged here so it is
a recorded choice, not a silent side effect discovered later.

**On the other half of the complaint ("feels like a lot of choices")**: deliberately *not* addressed by
reducing the option count, because that isn't a presentational change — 96 options is a direct
consequence of the recorded 15-minute-grid decision, and cutting to a 30-minute grid would change the
time model, meal-grouping granularity, and the floor-of-now default. If 96 still feels heavy once
alignment lands, that is a **separate decision** (architect loop, its own entry), not something to
smuggle in here. Improved scannability is the appropriate first remedy for "a lot of choices" anyway.

**Rejected**: (a) **`tabular-nums` alone** — doesn't solve it, per above; this is the option the fix was
most likely to default to, and it fails on the arithmetic. (b) **A monospace font on the `<select>`** —
would align, but clashes with the Geist UI face, looks wrong beside the Date field sitting next to it,
inherits the same unreliable-`<option>`-CSS problem, and is unnecessary once labels are equal-length.
(c) **Padding with a leading space or a U+2007 figure space** (`" 8:15 AM"`) — preserves single-digit
type-ahead and looks cleaner than a leading zero, but HTML collapses leading whitespace in option text,
so it requires an invisible special character: precisely the kind of clever, non-obvious trick the
project's conventional-default bias exists to prevent. (d) **Switching labels to 24-hour `"08:15"`** —
naturally aligned and would make label equal value, but reverses the deliberate 12-hour AM/PM display
choice from the prior entry and is a bigger change than the alignment problem warrants. (e) **Grouping
the options under 24 `<optgroup>` hour headers** — plausible against "a lot of choices", but adds 24
non-selectable rows (120 total) and more scrolling, and does nothing about alignment, which is the
stated problem. (f) **Adding `tabular-nums` to the shared `inputClass`** — would apply tabular figures
to every text/number/date field app-wide as a side effect of fixing one dropdown; scope the utility to
the control that needs it.

### `/api/lookup/search` rate limiting is a simple in-memory, per-user sliding window — an accepted v1 stopgap, not a distributed limiter
**Date**: 2026-07-26
**Decision**: `/api/lookup/search` (the USDA FoodData Central proxy) is rate-limited per
authenticated user via a plain in-memory `Map<userId, timestamps[]>` sliding window
(`lib/lookup/rate-limit.ts`, `isWithinLookupRateLimit`), capped at 30 requests/minute/user,
returning `429 { error: "rate_limited" }` before the query is validated or USDA is called. Raised
by qa-reviewer (N-7) during the Phase 6 review as a blocking-adjacent non-blocking finding: any
single authenticated user could otherwise burn through the whole app's shared ~1000 req/hr USDA
quota (already accepted as a v1 constraint — see "Food lookup: Open Food Facts (barcode) + USDA
FoodData Central (search), via a server-side proxy" above) alone.
**Why**: This is explicitly a v1-appropriate stopgap, not a production-grade distributed rate
limiter: the `Map` lives in a single process's memory, so it does not persist across a serverless
cold start and does not coordinate a shared limit across multiple concurrently-running instances.
Both are accepted, known limitations at this app's actual solo/small-user scale — a DB- or
Redis-backed limiter would coordinate/persist correctly but would need a new table/migration (an
architect-owned schema change) or an external service, which is disproportionate infrastructure for
what a v1 solo app needs right now. 30 req/min/user was chosen as generously above any legitimate
single-user burst (searching several foods back-to-back while building one meal) while still
meaningfully capping a runaway client/script. `/api/lookup/barcode` (Open Food Facts) was
deliberately left unlimited — it's free/keyless with no comparable shared-quota risk, so adding
rate limiting there would be defending against a problem that doesn't exist for that provider.

### Phase 7 implementation choices: `logMealForDay`'s ownership check re-reads via the RLS-scoped client (belt-and-suspenders over RLS alone), `MealsView`/`LogMealDialog` add their own client-side orchestrator layer (like Phase 3's `FoodDayView`), `LogMealDialog` is an inline expander not a modal, two flat queries instead of one embedded select
**Date**: 2026-07-27
**Decision**: Several implementation choices for Phase 7 ("Saved meals"), none pinned down to the
letter by the design doc's §8 Phase 7 bullet, recorded here per the project's "flag deviations/
implicit decisions" convention: (1) `logMealForDay` (`lib/actions/meals.ts`) resolves the target
meal via `.from("meals").select("id").eq("id", mealId).eq("user_id", user.id).maybeSingle()` on
the RLS-scoped server client — the explicit `.eq("user_id", ...)` is redundant with what
`meals_select_own` RLS already enforces, added purely as self-documenting belt-and-suspenders
(the same convention `food.ts`/`metrics.ts` already use on update/delete), not because RLS alone
was judged insufficient. (2) `meals/page.tsx` and `food/page.tsx`'s new `LogMealDialog` both gained
a client "orchestrator" component (`MealsView.tsx`, `LogMealDialog.tsx`) that owns the RLS-scoped
browser-client read + refetch-after-mutation loop, mirroring the `FoodDayView` pattern Phase 3
established (and flagged as a deviation there) rather than a literal reading of the design doc's
flatter `meals/MealList.tsx / MealForm.tsx / MealItemForm.tsx` component list — a saved meal has no
timezone-dependent "today" the way food/metrics do, but the read+refetch shape was kept consistent
with every other data screen rather than inventing a second pattern for one screen. (3)
`LogMealDialog` is a plain inline expand/collapse panel (open/closed local state, matching the
existing `FoodLookupPanel`/"Add detail" expander convention), not a native `<dialog>` element or a
modal overlay — this codebase has no modal precedent anywhere, and introducing one for a single
feature would cost more (new interaction pattern, new focus-trap/dismiss semantics to get right)
than it buys over the already-established expander idiom. (4) `MealsView`/`LogMealDialog` fetch
`meals` and `meal_items` as two independent flat queries and group them client-side via the new
pure `lib/domain/meal-items.ts` (`groupMealItemsByMeal`), rather than one PostgREST embedded
`.select("*, meal_items(*)")` — `meal_items`' FK to `meals` is the *composite* `(meal_id, user_id)`
key (not a plain single-column FK), and PostgREST embedding for composite foreign keys isn't
exercised anywhere else in this codebase, so two flat, independently-RLS-scoped queries plus a pure
grouping function were judged the lower-risk, more-obviously-correct choice over relying on
untested embedding behavior for this one screen.
**Also recorded — a real bug found only by manually driving the feature in a browser, not by any
automated test**: `MealsView`'s first implementation swapped to a full-screen "Loading…" placeholder
(unmounting `MealList` entirely) on *every* `refresh()` call, including the ones `onChanged` fires
after a routine item add/edit/delete/reorder or meal rename. Since `MealList` owns real local UI
state (which meal card is expanded, which item is mid-edit), that unmount-then-remount silently
collapsed the meal card the user was actively working in immediately after they added the item they
were adding — confirmed live (add an item -> the still-open "Manage items" panel snapped shut).
`FoodDayView`'s equivalent loading-branch swap is safe because `FoodEntryList` holds no comparable
local UI state (its edit target lives in the parent `FoodDayView`), so this wasn't a case of copying
a known-bad pattern, only of the same *shape* of code behaving differently once a child component
holds meaningful state of its own. Fixed with a `hasLoadedOnce` flag: the big loading placeholder is
now scoped to the true *initial* load only; a background refresh after a mutation keeps `MealList`
mounted (and its state intact) throughout. Verified with a Playwright script driven through the real
UI (create meal -> add two items -> rename -> reorder, asserting the item-management panel stays
expanded throughout) before and after the fix.
**Why**: (1) makes the ownership invariant legible at the call site without requiring a reader to
already know the RLS policy exists, matching the rationale already given for the same pattern
elsewhere in this codebase. (2)/(3)/(4) all prioritize consistency with already-established patterns
(the `FoodDayView`-style orchestrator, the expander idiom, flat independently-scoped queries) over
introducing a new pattern (a Server-Component-driven meals list, a modal, or embedded-select
reliance) for a single screen, per the project's general "prefer the pattern already proven
elsewhere in this codebase" bias. The `hasLoadedOnce` fix is recorded in detail because it's exactly
the kind of bug the project's own convention flags as one automated tests are unlikely to catch
(no assertion anywhere pins "the panel stays open across a background refresh") — it surfaced only
because the phase was actually driven by hand in a real browser per the developer role's own
verification bar, not because a test caught it.

### Saving an already-logged meal group as a Saved Meal: a copy-by-value, read-only-on-`food_entries` operation via one `createMealFromEntries` action — its own Phase 7b, ahead of Phase 8
**Date**: 2026-07-30
**Decision**: Close the one-directional gap between the two existing meal concepts. Until now, an
exact-`consumed_at` **meal group** (derived, presentational — `lib/domain/entry-grouping.ts`) could
only ever be *read*, and a **Saved Meal** (`meals` + `meal_items`) could only ever be built from
scratch in `/meals` and then logged *forward* into `food_entries`. A user who had just logged a meal
by hand had no way to keep it except retyping every item. New surface: a **"Save as meal"** control
on each `FoodEntryList` group header, opening an inline expander
(`components/food/SaveGroupAsMealDialog.tsx`) that takes a name and calls one new Server Action,
`createMealFromEntries(prevState, formData)` in `lib/actions/meals.ts` — the exact mirror of
`logMealForDay`, deliberately shaped like it so the two directions are reviewable against each other.
Load-bearing specifics:
- **Input is entry *ids*, never entry *values*.** The action re-reads the `food_entries` rows itself
  through the RLS-scoped server client (never service-role), exactly as `logMealForDay` re-reads
  `meal_items` rather than trusting a client-supplied item list. Ownership is `.in('id', entryIds)
  .eq('user_id', user.id)` on top of RLS, plus a **count check**: if fewer rows come back than ids
  were requested, the whole request is rejected (`entries_not_found`).
- **Copy-by-value, per-unit only**: `name`, `quantity`, `unit`, `calories_per_unit`,
  `protein_g_per_unit`, plus a fresh `sort_order` of `0..N-1`. The generated `calories`/`protein_g`
  are never copied (they can't be — they're STORED generated columns).
- **Strictly read-only on `food_entries`**: no UPDATE, no DELETE, no relink. The source entries'
  `logged_from_meal_id` is *not* repointed at the new meal, so the "From a saved meal" badge on a
  group reads exactly as it did before.
- **No provenance column in either direction** — no `meal_items.from_food_entry_id`, no
  `food_entries.saved_into_meal_id`. **No schema change at all.**
- The action **does not require the ids to share one `consumed_at`** — the group is a UI-level
  selection, exactly as `copyFoodEntries(entryIds, …)` is already id-list-based and group-agnostic.
- Sequenced as **its own "Phase 7b", running next, before Phase 8**, and numbered 7b rather than
  renumbering 8/9.
**Why**: Jeff called this "a critical ease-of-use function," so it gets a real per-phase checkpoint
rather than being appended to a phase that has already shipped. It is deliberately **not** folded
into Phase 7 (implemented, qa-reviewed, verdict on record — reopening its scope would invalidate a
review already done) and **not** folded into Phase 8 (bundling would block shipping this until
copy/repeat is also finished, and would blur Phase 8's qa scope across two independent features);
7b runs *before* 8 because the two share the `FoodEntryList` group-header surface, so doing 7b first
means Phase 8 adds a button to an action bar that already exists rather than retrofitting one.
Numbering 7b keeps every existing "Phase 8" reference in the design doc, `ai-context/*`, and the test
suite correct. Re-reading the entries server-side rather than accepting values from the browser is
what makes ownership checkable at all — client-supplied nutrition values would be unverifiable, and
the count check matters specifically because without it a mixed own/foreign id set would silently
produce a *partial* meal, which is worse than an error because it looks like it worked. Copying only
the per-unit inputs yields a genuinely useful invariant: `meal_items.calories`/`protein_g` and
`food_entries.calories`/`protein_g` are computed by the *same* `round(quantity × per-unit)`
generated expression, so **the new meal's totals equal the source group's totals by construction** —
the totals are never copied, so they can never be copied wrongly. Rejecting a provenance column is the
same reasoning that made Saved Meals copy-by-value in the first place (see "Saved meals: items scoped
per-meal, logged by copying values…"): a `derived_from` reference would make a meal's meaning depend
on rows the user is free to edit or delete afterwards, and would need its own `ON DELETE` semantics,
ownership story, and "what does a dangling one mean" answer — all to store provenance nothing in the
product reads. Keeping the action id-list-based (not group-shaped) keeps exact-timestamp grouping
purely derived and means Phase 8's multi-select can drive the same action with no change. `sort_order`
comes from `created_at`-then-`id` order because a group's entries share an identical `consumed_at` by
definition, so that column **cannot** break the tie. **Accepted tradeoffs**: saving the same group
twice, or saving a group that was itself logged from an existing meal, produces similar duplicate
meals — correct behaviour for a value-copy (no nesting, no reference chain, no way for one to affect
the other), and the user renames or deletes; and the "read-only on `food_entries`" property is **not
enforceable by the database**, so it is an app-layer invariant held by code review plus an acceptance
test asserting the source rows are byte-identical (including `updated_at`) before and after — the same
enforcement posture, and the same reasoning, as `logged_from_meal_id`'s write invariant.

### `createMealFromEntries` atomicity: a compensating delete, NOT a Postgres RPC — the empty-meal residual state is knowingly accepted
**Date**: 2026-07-30
**Decision**: `createMealFromEntries` needs two statements (`INSERT INTO meals … RETURNING`, then one
multi-row `INSERT INTO meal_items`) and supabase-js exposes no cross-statement transaction, so the
residual failure mode is "meal created, items failed." **Handled by a compensating delete**: on
item-insert failure the action deletes the just-created meal (`.eq('id', …).eq('user_id', user.id)`)
and returns the error. This is **part of the action's contract, not a nice-to-have** — qa-reviewer
confirms the code path exists (by review, if fault injection proves impractical in this suite, and
says so explicitly rather than silently skipping it). A Postgres function
(`create_meal_from_entries`, `SECURITY INVOKER` so RLS still applies) would be genuinely atomic in
one statement and was evaluated as the "most correct" answer — **Jeff considered and rejected it**.
In the doubly-unlucky case where the compensating delete also fails, the residual state is a named,
empty meal: **knowingly accepted**, to be re-raised only if actually observed in practice, not
pre-emptively.
**Why**: the RPC needs a migration (new architect-owned schema surface) and would be the codebase's
**first and only RPC**, against the project's standing bias toward the pattern already proven
elsewhere — every mutation in this app is a Server Action, and DB functions exist only as triggers.
Disproportionate for the failure it prevents, which degrades to a **benign, self-evident,
one-click-deletable empty meal** rather than data loss or a corrupt row — and `logMealForDay` already
refuses to log an empty meal (`empty_meal`), so the residual state cannot propagate anywhere
downstream. Consistent with this codebase's existing posture on the same question:
`reorderMealItems` already issues N untransacted `UPDATE`s (qa-reviewer's deferred Phase 7 N-2), so
requiring strict cross-statement atomicity here alone would be an inconsistent bar. Noted for the
record only: were this ever revisited, swapping in the RPC changes the action's *internals*, not its
signature, so nothing else in the design is betting on the choice.

### The save-as-meal name field starts **blank** — no prefill from the group's first item
**Date**: 2026-07-30
**Decision**: `SaveGroupAsMealDialog`'s name input opens **empty and autofocused**, with a
`placeholder` for shape only (matching `MealForm`'s existing convention). A placeholder is never a
value, so submitting untouched is a `validateMealInput` field error, not a silently-accepted default.
The name is prompted **before** the copy executes (so a cancel writes zero rows, and one submit = one
action call = the atomicity story above). **No `defaultMealNameFromEntries` helper is added** — with
no prefill there is nothing pure to derive or unit-test. The architect's initial recommendation was
to prefill the group's first item name, autofocused and pre-selected; **Jeff overruled it.**
**Why**: on any multi-item group a first-item prefill is actively wrong — "Eggs" for eggs + toast +
coffee — and a prefilled field is precisely the one a user accepts without reading. So the failure
mode isn't "no name," it's a *library full of confidently mislabelled meals*, which is worse and only
discovered months later. A Saved Meal is a long-lived object picked from a list long after it was
created; unlike the everyday food-entry path (where prefills and smart defaults are exactly right and
remain so), its name is worth one deliberate keystroke sequence. Also rejected: concatenating every
item name (unreadable past two items), and a time-of-day-derived suggestion like
"Breakfast"/"Lunch"/"Dinner" — rejected twice over, since meal *categories* are explicitly out of
scope **and** it would need exactly the arbitrary hour-boundary heuristic Jeff already rejected for
meal grouping. **Accepted tradeoff**: two or three extra seconds on a save that is itself far rarer
than logging — and the feature is a large *net* keystroke saving regardless, since the alternative is
retyping every item by hand in `/meals`.

### The `FoodDayView` `hasLoadedOnce` fix ships **inside** Phase 7b, as a prerequisite — not as a separate change
**Date**: 2026-07-30
**Decision**: Phase 7b gives `FoodDayView.tsx` the same `hasLoadedOnce` treatment `MealsView` already
carries — scope the full-size "Loading…" placeholder to the **initial** load only, and keep
`FoodEntryList` mounted through background refreshes. Jeff's call: this ships **as part of Phase 7b**,
not split out into its own change or deferred.
**Why**: `FoodEntryList` gains real local UI state for the first time in Phase 7b (which group's
expander is open, and its in-flight name), while `FoodDayView` currently swaps the whole list out for
a placeholder on **every** `refresh(...)` — so any other action refreshing the day underneath would
unmount the expander mid-typing. That is the identical bug class already recorded in this file's
Phase 7 entry, where `MealsView` collapsed the meal card a user was actively working in. Splitting the
fix out would mean deliberately landing a known-broken interaction and repairing it afterwards; it is
a prerequisite of Phase 7b's own correctness, not an independent improvement. Recorded here (and
called out ahead of time in the design doc, §3.4 and §8) specifically because last time this bug class
was caught **only** by driving the UI by hand in a real browser — no automated assertion anywhere pins
"the expander stays open across a background refresh," so the design doc also carries an explicit
manual-browser check for it rather than relying on the suite.

### `lastConsumedAt` (the smart same-sitting default) only advances on an **added** entry, never on an edit
**Date**: 2026-07-30
**Decision**: `FoodDayView.handleSaved` now updates the tracked `lastConsumedAt` only when the save
that just succeeded was an **add** (`editingEntry === null` at the time of the save); saving an
**edit** to an existing entry leaves `lastConsumedAt` untouched, regardless of how recent that
entry's own `consumed_at` is. This amends design doc §3.4's edge-case bullet, which previously said
plainly "on submit `lastConsumedAt` updates to the just-saved `consumed_at`" with no add/edit
distinction.
**Why**: Jeff reported the real symptom directly — after editing an older entry (e.g. fixing a typo)
and saving, the *next new* entry's smart-defaulted time snapped backward to the just-edited entry's
time instead of continuing forward from whatever was actually most recently added. Concretely: add
entries at 9:00 and 9:03 (correctly sharing 9:03 via the freshness window), then edit the 9:00 entry
— under the old behavior this reset the tracker to 9:00, so the *next* new entry would default back
to 9:00 instead of continuing at 9:03, silently un-grouping it from the sitting actually in progress.
The smart default exists so items *actively being added* in one sitting share a timestamp; an edit
(however recent the entry) isn't "the next thing being added," so it shouldn't move that reference
point. Confirmed directly with Jeff before implementing (he agreed this was a bug relative to the
feature's own intent, not a case where the original design just doesn't fit). Covered by a new e2e
test, `e2e/food-logging.spec.ts` "editing an existing entry does not move the smart same-sitting
default backward for the next new entry" (seeds an old-but-still-fresh entry via direct insert,
edits it, and asserts the next new entry still groups with the *other* recently-added entry, not the
edited one).

### "Clear" resets to the viewed day's current time, bypassing the smart same-sitting default entirely
**Date**: 2026-07-30
**Decision**: A new "Clear" button on `FoodEntryForm` (add mode only, next to "Add entry") resets
every field back to the fast-entry defaults — including date/time, which resets to the **viewed
day's floor-of-now quarter-hour**, not a re-application of `defaultConsumedAtForNextEntry`'s
same-sitting reuse. Implemented via a `resetToNow` flag threaded from `FoodDayView` into
`computeInitialDateTime`, set only for the remount triggered by a "Clear" click (a `resetReason`
state distinguishes a Clear-triggered remount from a post-save one, read once at the moment the
freshly-keyed instance mounts).
**Why**: Jeff's call, confirmed directly — "Clear" is an explicit "start over" action, and silently
falling back to whatever the smart default would have produced (potentially an old reused timestamp
from earlier in the sitting) defeats the point of a reset. The smart default is specifically for the
*implicit*, no-action-taken case (opening the form fresh after a save); an *explicit* user action
asking for a blank slate should give the most neutral answer — today, right now — not resume a
grouping context the user may be deliberately abandoning. This is unrelated to and does not change
`lastConsumedAt` itself (see the entry above) — Clear only affects what the *current, about-to-be-
replaced* form instance shows; it doesn't retroactively alter the tracker other new adds will still
see.

### Saved-meals list scaling is a **findability** problem, not a data-volume one: client-side alphabetical sort + a name filter + a visible count, over a still-fully-fetched list — no pagination, no server-side search, no cap, no combobox, no migration (Phase 7c)
**Date**: 2026-07-30
**Decision**: Both surfaces that list saved meals — `/meals` (`MealsView` → `MealList`) and `/food`'s
`LogMealDialog` picker — keep fetching **every** saved meal and every meal item exactly as they do today. What
changes is only how those already-fetched rows are ordered, narrowed and counted:
- A new pure module `lib/domain/meals.ts` (meal-level, deliberately **not** added to the item-level
  `meal-items.ts`): `sortMealsByName(meals)` — case-insensitive alphabetical, ties broken by `created_at` then
  `id`, returns a new array — and `filterMealsByName(meals, query)` — case-insensitive, AND-of-whitespace-
  separated-tokens **substring** match on `meal.name` only, with an empty/whitespace-only query returning the
  input unchanged (identity, **not** "no results").
- `sortMealsByName` is the single authoritative order for **both** surfaces, so a meal sits in the same place in
  the library and the picker, independent of the database's collation. The two Supabase queries also move
  `.order("created_at")` → `.order("name")` as a deterministic base order — belt-and-suspenders, the same
  posture as this codebase's redundant `.eq('user_id')` filters, with the pure function remaining the authority.
- `MealsView` owns a `<input type="search">` filter box (real `<label>`, local `useState`, hidden only when the
  user has zero meals) and a count readout ("40 saved meals" / "Showing 3 of 40"), applies sort-then-filter, and
  passes the result to `MealList`. **Typing never refetches** — no debounce, no loading state, no new network
  path.
- **The two empty states must stay distinct**: `MealList`'s existing "No saved meals yet…" fires only for a
  genuinely empty library; a non-empty library whose filter matches nothing gets its own message from
  `MealsView`, which does not render `MealList` at all in that case.
- `LogMealDialog`'s picker stays a **plain native `<select>`**, gaining only the shared order. Implementation
  invariant: each option's label must keep the **meal name first**, before the `(450 kcal, 3 items)`
  parenthetical, because native type-ahead prefix-matches the rendered option text.
- **No migration, no index, no extension.** Sequenced as its own small **Phase 7c**; it shares no files with
  Phase 8, so 7c-before-8 is a recommendation, not a dependency.
**Why**: Jeff asked, while manually testing Phase 7b, "is there any limit to the number of meals we display on
the meals page? It seems like that could get out of control." That question has two readings with different
answers, and separating them is most of this decision. **As a data-volume question it is a non-problem, and the
honest answer is to say so**: saved meals are created one at a time by hand (in `/meals`, or one per "Save as
meal" click) — there is no import, no sync, no automatic creation path, so no runaway mechanism exists at all. A
`meals` row is ~100 bytes; even a heavy 200-meal library with ~5 items each is ~1000 `meal_items` rows / low
hundreds of KB, returned by an already-indexed `user_id` lookup and rendered in one pass without a browser
noticing. **As a findability question it is real now**, at a size Jeff can plausibly reach this year: 40 meals
in an unfiltered, uncounted list ordered by `created_at ascending` is genuinely hard to use, and that order is
the worst available one (the meals just created are furthest from the top). So the fix targets ordering,
filtering and orientation, and deliberately leaves the fetch strategy alone, because the fetch is not what
hurts. **Rejected, each for a specific reason rather than as a blanket "too complex":** (a) **server-side
search/pagination** — it would be the first pagination pattern anywhere in this codebase (every other screen
fetches a bounded window and renders it whole) and interacts badly with the existing two-flat-query read, since
each card's totals come from `sumEntries(items)`, so paginating `meals` forces a page-keyed `meal_items` fetch,
refetch-on-page-change and a stale-response guard — real coordinated machinery to speed up a tens-of-rows query;
server-side `ILIKE '%…%'` additionally wants a `pg_trgm` GIN index, i.e. a new extension and an architect-owned
migration, to accelerate a sequential scan over tens of rows. (b) **A hard cap or a silent `.limit()`** —
there is no runaway path to defend against, and the failure mode is severe and silent (a meal the user
deliberately saved simply isn't in their own library, with no explanation); a *visible count* delivers the
awareness Jeff actually asked for without ever hiding data. This is a different question from Phase 7b's
unbounded-`entryIds` note (qa N-2), which concerns an untrusted client-supplied list in one request. (c) **A
searchable combobox for the picker** — settled by direct precedent rather than fresh judgment: the 2026-07-25/26
time-picker decisions chose a plain native `<select>` of **96** options over a custom combobox, explicitly
because a combobox "violates the conventional-default bias and adds JS/accessibility surface for no benefit over
`<select>` at this option count." A meals library will be well under 96 for a long time, on a less-used control,
so building one here would contradict a decision this project made about a harder version of the same problem
five days earlier — and alphabetical order plus name-first labels is precisely what turns the `<select>`'s free
built-in type-ahead into the search feature a combobox would have been built to provide. (d) **Matching item
names as well as meal names** — genuinely useful and the data is already in memory, but a match with no visible
cause needs a "matched on: chicken" affordance to not read as a bug; deferred deliberately, not overlooked.
(e) **Fuzzy matching** (a scoring library for a list of tens) and **URL-persisted filter state** (`/trends`'
`?range=` is in the URL because it is a server-rendered shareable view; this is transient state on a client
orchestrator). **Two things recorded as tripwires rather than solved**: the filter is only correct *because*
the list is fully fetched, so anyone introducing pagination later must move search server-side in the same
change or it silently searches one page while appearing to search everything; and the revisit trigger is
concrete (~200 meals, or perceptible `/meals` load time) with a deliberate escalation order — trim
`LogMealDialog`'s label-only items fetch, then recency-of-use ordering (needs schema surface, hence not in 7c),
then server-side search+pagination together. **Explicitly left to Jeff, not decided here**: `MealList` expands
every meal's items by default (his own 2026-07-30 call), which is the visible form of this same problem at 40
meals — Phase 7c does not reverse a three-day-old explicit decision, and the filter addresses the same pain from
the other side; if it still feels unwieldy afterwards, collapsing-above-a-threshold is a behaviour-changes-at-a-
magic-number design that deserves its own architect round.

### `FoodEntryList` group-header times now render in 12-hour AM/PM (amends the 2026-07-26 time-`<select>` entry)
**Date**: 2026-07-30
**Decision**: Meal-group headers in `FoodEntryList.tsx` now format their time via the existing
`formatTimeLabel` helper (the same one the time `<select>` uses), e.g. "09:00 AM" instead of the bare
24-hour "09:00". This **amends** (does not replace) this file's 2026-07-26 entry, "Time-`<select>`
option labels are zero-padded...", which explicitly noted at the time: *"`FoodEntryList`'s meal-group
headers already render times as raw 24-hour `HH:MM` from `utcToLocalTime`... The list's lack of AM/PM
is a separate pre-existing inconsistency; deliberately **out of scope** here, not silently changed."*
That inconsistency is now deliberately closed, on the record, rather than left as a known gap.
**Why**: Jeff asked for it directly, pointing out the mismatch between the AM/PM-labeled time picker
used to log an entry and the bare 24-hour time shown for that same entry afterward in the day's list.
Reusing `formatTimeLabel` (already exported, already unit-tested for all 96 quarter-hour values) rather
than writing a second formatter keeps exactly one source of truth for this label shape, per the
project's "no duplicate logic" bias. Purely presentational — `groupByConsumedAt`'s grouping key is
still the raw `consumed_at` string; only the rendered label changed. Existing e2e assertions
(`toContainText("12:30")`) still pass unchanged, since AM/PM is an appended suffix, not a
reformatting of the digits themselves.

### `MealList` shows a meal's items by default, not behind a "Manage items" click
**Date**: 2026-07-30
**Decision**: `MealList.tsx`'s per-meal item list is now expanded on first paint for every meal card,
not collapsed. Implemented by inverting the tracked state from `expandedMealId: string | null`
(single accordion slot, default nothing expanded) to `collapsedMealIds: Set<string>` (default empty
set) — `isExpanded` is `!collapsedMealIds.has(meal.id)`, so a meal is expanded unless the user has
explicitly clicked to hide it, and a newly created meal is expanded by default too with no
special-casing needed. The toggle button's existing label logic (`isExpanded ? "Hide items" :
"Manage items"`) was kept as-is, so on a fresh page load the button now reads "Hide items" rather
than "Manage items" — this is the load-bearing, test-visible symptom of the change.
**Why**: Jeff's direct call while manually testing the just-shipped Saved Meals feature: "I feel like
the meals should default to showing their ingredients on the Meals page." A saved meal's whole point
is checking what's in it before deciding whether to log it or edit it — hiding that behind a click on
every single visit to `/meals` was the wrong default, confirmed by a live screenshot comparison before
and after (the "Breakfast staple" card went from a bare name+totals summary to showing "3 egg — Egg"/
"2 slice — Toast" immediately). Tracking *collapsed* ids rather than *expanded* ones was chosen
specifically so the fix generalizes correctly as the meal list grows (see the separate Phase 7c
"findability" work started the same day) — an expanded-id allowlist would need every newly-created or
newly-fetched meal added to it to also default open, while a collapsed-id denylist gets that for free.
**Process note (why this is being recorded after the fact rather than at implementation time)**: this
was made as a direct, un-delegated edit mid-conversation while responding to Jeff's live testing
feedback, verified at the time with lint/typecheck/the unit suite (395/395) and a manual browser
screenshot — but **not** against the e2e suite, and not recorded in this file or in
`ai-context/PROGRESS.md`. `e2e/phase7-acceptance.spec.ts` (written before this change, when
"Manage items" was the default state) had 13 places that clicked "Manage items" to reach the expanded
state before interacting with items — since items are now expanded by default, that click became
unnecessary and, on the four tests asserting `"Hide items"` was visible afterward, the click would
have instead *collapsed* the already-open list, inverting the assertion. This surfaced as qa-reviewer's
Phase 7c review B-1 (found while reviewing an unrelated, later change — Phase 7c's meal-search
filtering — that never touched `MealList.tsx` at all; qa-reviewer confirmed via `git stash` that
reverting only this change restores the suite to 29/29, proving Phase 7c's own code was not at fault).
Same lesson as Phase 7b's own B-1 one phase earlier: a real, wanted UI change made directly rather than
through the full architect/developer/qa-reviewer loop still needs its decision recorded and its
downstream tests updated in the same sitting, even when — especially when — it's small enough to feel
like it doesn't need the paperwork. **Fixed 2026-07-30**: this entry, plus removing the now-redundant
13 `"Manage items"`-click lines from `e2e/phase7-acceptance.spec.ts` (the four `"Hide items"`
visibility assertions right after them are left in place and still meaningful — they now additionally
prove the list is expanded *from page load*, not just *after* a click).

---

### Phase 8b designed: multi-select bulk actions ship as their own phase, adding no server-action or domain code; the dashboard "quick-add"/"copy previous day" is descoped, not deferred
**Date**: 2026-07-31
**Decision**: Following Phase 8 qa-review's non-blocking N-1 (the design doc, in two places, described a
"multi-select → 'Copy selected'" control as already built, when it deliberately wasn't), Jeff asked the
architect to properly design it rather than just correct the sentence. The result is a new **Phase 8b**
(`docs/architecture/food-weight-tracker.md`, inserted between the completed Phase 8 and the existing Phase 9
PWA-lite shell — numbered 8b, not a renumbered 9, following the exact precedent Phase 7b/7c already
established) with three load-bearing properties: (1) **it adds zero server-action and zero `lib/domain/`
code** — both `copyFoodEntries` (Phase 8) and `createMealFromEntries` (Phase 7b) already accept an arbitrary,
group-agnostic entry-id list, a property Phase 7b's design doc explicitly wrote down in anticipation of this
phase, so Phase 8b is client UI only, driving two already-shipped, already-qa-reviewed actions unchanged; (2)
**select mode is explicit, not always-visible checkboxes** — entering select mode hides the existing per-row
("Log again") and per-group ("Copy this group"/"Save as meal") action buttons, closes any open group
expander, and shows a new `EntrySelectionBar` ("N selected", "Copy selected", "Save selected as a meal",
"Clear", "Done"); (3) **selection spans exact-`consumed_at` group boundaries** — a user can tick entries from
two different meal groups into one bulk action, which is the one thing multi-select can do that Phase 8's
three implicit-scope mechanisms (whole day / one group / one entry) cannot, and is the actual reason this
phase exists rather than being folded back into 8. **"Save selected entries as a meal" is bundled into 8b**,
not split into its own phase — a deliberate reversal of this project's usual small-phase bias (see Why).
Both bulk actions reuse `CopyGroupDialog`/`SaveGroupAsMealDialog` verbatim (parameterized wording only, with
defaults preserving the existing group call sites' rendered text byte-for-byte), rather than new twin
components. Selection state is owned by `FoodDayView`, hoisted above the `!hasLoadedOnce && loading` branch
(not resting on that flag alone), cleared at the existing `handleDayChange` choke point and on a successful
bulk action, and derived by intersecting stored ids against the currently-loaded entries so one stale id
drops out instead of failing the whole request. Explicitly out of scope: bulk delete/edit (destructive, no
undo anywhere in this app, deserves its own round), a sticky/floating bar, per-group "select all", a
day-level "select all", any cap on selection size (same deferred class as Phase 7b N-2/Phase 8 N-7), and any
dashboard control (see the descope decision below).
**Separately, N-2 resolved**: the design doc's §3.1 module tree had long described the dashboard as having
"quick-add + 'copy previous day'" — neither was ever built (the dashboard has been `TodaySummary`-only since
Phase 3). **Decision: descope permanently, don't build it** — the doc line is corrected to "today's totals
only... deliberately minimal" rather than silently deleted, so the question doesn't resurface undocumented in
a year.
**Why (bundling)**: the instinct to split "Copy selected" and "Save selected as a meal" into separate phases
is the same reasoning that correctly produced 7b and 7c as their own phases — but that precedent doesn't
transfer here. 7b and 7c were each independently valuable, independently shippable, and touched different
files (§8 Phase 7c states it shares no files with Phase 8). None of that holds for the two Phase 8b actions:
"Save selected as a meal" isn't shippable without the selection UI, and it touches the identical three files
selection itself touches. Splitting would mean a second phase re-opening the same files and re-deriving the
same selection-state invariants for a second full qa cycle over one interaction surface — two reviews of one
thing, the expensive outcome, not the safe one. The marginal cost of bundling is genuinely small precisely
because of property (1) above: both actions are "hand the selection's ids to an already-reviewed action,"
differing only in which table gets written.
**Why (explicit select mode, not always-visible checkboxes)**: two reasons. Density — entry rows already
carry Log again/Edit/Delete and group headers carry two more actions, so permanent checkboxes would add a
fifth affordance per row on the most-used screen, for a rare action, worst on a phone. Ambiguity — with
checkboxes always live, "Copy this group" and "Copy selected" would both be simultaneously actionable with
"what am I about to copy?" depending on invisible state, which is the same class of ambiguity already raised
twice as a non-blocking note (duplicate "Cancel" labels: Phase 7b's N-3, recurring as Phase 8's N-5) — not a
class worth deliberately building a third instance of.
**Why (the refresh-safety requirement gets structural treatment, not just a reminder)**: this is the third
component in this codebase to hold local UI state that a background `refresh()` can silently wipe — the first
two (`MealsView` in Phase 7, `FoodEntryList` in Phase 7b) both shipped broken and had no automated assertion
catching either. Rather than just noting "don't do that again," the design hoists selection state to live
above the loading-placeholder branch structurally, and requires both a real §6 acceptance row and an explicit
manual-browser check (tick entries across two groups, open the save dialog, force a real background refresh
via an unrelated add, confirm everything survives) — the same bug class shipping broken a third time would be
a process failure, not a surprise.
**Why (dashboard descope)**: a dashboard quick-add would need its own validation/tz/smart-default/lookup
story — either duplicating `FoodEntryForm` (two code paths for the app's single most important interaction,
exactly where divergence hurts most) or shipping a deliberately weaker form that can't express quantity/unit
or a lookup prefill. "Copy previous day" is now strictly a subset of what `CopyDayDialog` (Phase 8) already
does on `/food`, where the source day is actually visible while copying it — a dashboard shortcut buys one
tap and costs a second surface that must stay consistent with the future-day cap and timezone rules forever.
Both are one nav click away already. The dashboard's minimalism is also no longer accidental: it's the same
direction as Jeff's 2026-07-26 call to pull the sage-arc motif off the dashboard specifically because even a
decorative element read as clutter there (see the visual-identity entry above) — adding a live form to that
screen would cut directly against that judgment.
**Also required by this design** (not a new decision, but newly load-bearing): `e2e/phase8-acceptance.spec.ts`
currently contains a test asserting multi-select was **not** built — Phase 8b's implementation must update
that test in the same change, exactly the kind of stale-acceptance-test gap that produced a blocking B-1 in
both Phase 7b's and Phase 7c's qa-reviews when it wasn't caught.
**Rejected**: per-group "select all in this group" (needs indeterminate-checkbox state and duplicates "Copy
this group" — no new capability); a day-level "select all" (redundant with the existing "Copy this day");
row-click-to-select instead of a dedicated checkbox (an accidental tap must not silently change what a bulk
action operates on); a sticky/floating selection bar (no sticky-positioning pattern exists anywhere in this
codebase); new twin dialog components instead of parameterizing the existing group ones (would widen the diff
of two already-reviewed files' *behavior* for a cosmetic rename, and duplicate logic this project's
conventions explicitly avoid); a cheap "link to `/food` with the previous day pre-selected" version of the
dashboard shortcut was considered and also rejected for v1, noted as the fallback if the descope is ever
revisited.

### Phase 8b absorbs Phase 8's remaining qa notes (N-3, N-4): `CopyDayDialog` gets a structural unmount-on-close fix, "Log again" names its destination in the toast
**Date**: 2026-07-31
**Decision**: Jeff asked for Phase 8 qa-review's last two non-blocking notes to be folded into Phase 8b's
design rather than left as standalone unscoped polish or reopening Phase 8's already-reviewed, approved diff.
Both are small, UI-only, and confined to files Phase 8b already touches, so they were added to that phase
rather than given their own round.
**N-3 fix — `CopyDayDialog`'s stale error on reopen, fixed structurally, not with a manual reset.** The bug:
trigger a rejected copy, close the panel, reopen it — the previous error is still displayed before any new
action. Root cause is structural: the *collapsed button*, not the dialog body, is what's conditionally
rendered, so `CopyDayDialog` itself never unmounts and its `state`/`toDate`/`pending` survive the toggle.
`CopyGroupDialog` never had this bug only by accident of structure (its stateful body **is** the
conditionally-rendered part). **Chosen fix**: extract `CopyDayDialog`'s open-panel body into a subtree
rendered only while `open`, so each open mounts fresh — making the property `CopyGroupDialog` has by accident
into a deliberate rule, applied to Phase 8b's new bulk expanders too. **Rejected**: manually resetting the
tracked fields in the toggle handler — works today, but requires enumerating exactly which fields to clear and
silently rots the first time a field is added and someone forgets to add it to the reset list (the same defect
returning in a different shape). Explicitly **not** the same situation as `SettingsForm`'s remount-on-`key`
decision (see that 2026-07-22 entry above) — `SettingsForm` needed a remount because React resets the native
`<form>` after a form Action settles, desyncing a controlled radio *outside* React's reconciliation, so a
manual reset genuinely couldn't fix it there. `CopyDayDialog` isn't `useActionState`-driven, so a manual reset
*would* be correct here; it's rejected on maintainability grounds, not correctness — recorded explicitly so a
future reader doesn't over-generalize either precedent onto the other.
**Guardrail — the fix must not fight the refresh-survival requirement Phase 8b already established** (see the
"Phase 8b designed" entry above): the unmount must be driven **only** by the user's own open/close toggle,
never by anything a background `refresh()` changes (not `loading`, not a fetch nonce, not `entries.length`,
not the selection) — a wrongly-keyed implementation would fix the stale error and simultaneously reintroduce
the exact state-wiping bug Phase 8b exists to guard against. The two requirements are compatible; getting the
key source wrong is what makes them look like they conflict. §6 now requires both to be asserted **together**
in one test, not separately, specifically so an implementation that passes one by breaking the other gets
caught.
**N-4 fix — "Log again" now names its destination when it isn't the day on screen.** "Log again" always
correctly logs to *today* regardless of which day is being viewed, but from a past day nothing visibly changes
in the list and the toast read only `Logged "X" again.`, with no indication of where it went. Fix: when
`today !== selectedDate`, the toast names the destination, reusing the exact wording `handleCopied` already
uses for day/group copies (`Copied N entries to <date>.`) so the feedback is consistent across all of Phase
8/8b's copy-shaped actions. **Rejected**: switching the view to today so the new entry is visible — the user
is deliberately browsing a past day, and silently moving them off it is a worse trade than one clause of
toast text; it would also make "Log again" the only action in the app that navigates the user without being
asked. §6 explicitly asserts the view **stays on the browsed day** so this can't be "improved" into navigation
later.
**Also recorded**: Phase 8 itself remains approved-as-shipped and unmodified — neither N-3 nor N-4 was a
defect in what Phase 8 was actually asked to build, only UI polish gaps, which is why they were routed to the
still-pre-implementation Phase 8b instead of reopening Phase 8's clean, already-reviewed verdict. Because N-3
restructures `CopyDayDialog`, Phase 8b's §6 scope explicitly flags that component's existing Phase 8
acceptance rows as the likeliest place a regression could land, and requires them to stay green.

---

### Phase 8b absorbs three more manual-testing findings: `autoComplete` hygiene (own cross-cutting pass), a non-pill success-feedback treatment (own commit), and human-readable date display (folds into 8b's diff) — plus the general rule used to decide which is which
**Date**: 2026-08-01
**Decision**: While manually testing Phase 8, Jeff raised three more findings, all routed to Phase 8b's
checkpoint at his request. The architect designed all three and, for each, decided how it should actually be
*structured* using one explicit rule stated in §4: **the deciding factor is how many already-approved phases'
files a change reaches outside the files Phase 8b already opens** — because reaching into an already-reviewed
phase's files without saying so, inside a feature's own diff, is exactly what produced a blocking B-1 in each
of the last two phases (7b and 7c).

| Finding | Files outside 8b's own set | Structure |
|---|---|---|
| Human-readable date display | 0 (all 3 sites are in files 8b already opens) | Folds into 8b's diff |
| Success-message restyle | 1–2 (`SettingsForm`, optionally `MetricForm`) + a new `components/ui/` primitive | Folded into 8b, but **its own commit** |
| Autofill/password-manager hygiene | ~6 already-approved phases' worth (essentially every form in the app) | A **separate cross-cutting pass**, structurally the twin of the Visual Identity rollout — tracked and reviewed at 8b's checkpoint, but its own commit |

**1. Autofill/password-manager hygiene.** Password managers were offering to fill/save non-identity fields
throughout the app (food entry name/quantity/unit/calories/protein, meal names, weight/body-fat, goal targets,
the `/meals` filter, barcode entry) because none of those controls carried an `autocomplete` hint, leaving the
browser to guess from labels/`name`/`id` — a field literally labelled "Name" is the textbook case a
name-autofill heuristic fires on. Fix is two plain HTML rules applied to every form in `src/`, no JS/library/
custom widget: (1) every `<form>` gets `autoComplete="off"` as a default-deny; (2) **every** `<input>`/
`<select>`/`<textarea>` — including ones inside a denying form — gets an explicit value anyway, both because
Chrome weighs field-level over form-level `off`, and because an explicit per-control value is what makes the
convention greppable/enforceable later. Two categories: identity fields (`LoginForm`/`SignupForm` email +
password) get real autofill-helping values — `autoComplete="email"` on both email inputs (**Jeff's explicit
choice, 2026-08-01**, overriding the architect's initial recommendation of `username`, which pairs slightly
more strongly with `current-password`/`new-password` for a manager's sign-in-vs-sign-up recognition; `email`
is still fully valid and matches the literal original finding), `current-password` on login,
`new-password` on both signup password fields; everything else in the entire app gets a uniform
`autoComplete="off"`, deliberately with no per-field exceptions (including number/date/search controls where a
manager is unlikely to fire anyway — a ruleset without exceptions is what a reviewer can check mechanically).
**Structured as its own cross-cutting pass** (not folded into 8b's feature diff) because it touches ~6 already-
approved phases' files that 8b never otherwise opens — folding it in would reproduce the exact "which lines are
the feature" ambiguity that produced the last two phases' B-1s. It is still tracked at Phase 8b's checkpoint —
ships with it, qa-reviewed in the same pass, approved together — just as its own reviewable/revertable commit.
**Accepted side effect**: `autoComplete="off"` also suppresses the browser's own form-history dropdown on the
`/meals` filter and the lookup search box (both re-typed in a second, judged an acceptable trade). **Explicitly
not solved**: this is a best-effort HTML hint, not an enforcement mechanism — no CI browser has a real password-
manager extension, so the suite proves the markup only; if a specific field still prompts in someone's real
browser, that's an evidence-gated escalation (to a vendor-specific opt-out like `data-1p-ignore`, or eventually
a lint rule if the convention is ever violated twice), not a sign the whole approach failed.
**2. Transient success-feedback restyle.** The identical pill (`rounded-full bg-sage-pale px-3 py-1 text-xs
font-medium text-ink`) was hand-copied in three places for a transient confirmation message — `FoodDayView`'s
`savedMessage` (4s auto-dismiss), and `SettingsForm`'s "Settings saved." (no auto-dismiss at all, previously
unnoticed). Jeff's complaint: it blends in, doesn't catch the eye, and a pill reads wrong for a one-off message
("pills should be used for statuses, not user messages"). Audit found `MetricForm`'s pill is NOT actually a
success message — `{existing && "Already logged for this day..."}` is gated on the data's state with no timer,
i.e. a genuine status by Jeff's own rule, and stays a pill unchanged, exactly like `FoodEntryList`'s "From a
saved meal" badge. **New shared component**: `components/ui/StatusMessage.tsx` — a left-accent banner
(`border-l-4 border-l-sage-deep`, `bg-sage-pale` surface, `text-ink` text at `text-sm`/`px-4 py-3`, a decorative
`aria-hidden` sage-deep check icon, `role="status"` so it's actually announced to assistive tech — closing the
same live-region gap qa-reviewer already flagged for the `/meals` filter as Phase 7c N-3), an optional
`autoDismissMs` prop, and one exported `SUCCESS_MESSAGE_MS = 6000` (up from 4s) so the duration is a single
number, not three copied literals. **Duration reasoning**: ~2s to notice (it appears outside the user's focus,
the actual complaint) + ~2s to read the longest string ("Copied 3 entries to 07/29/2026.") + margin, while
staying under the ~8–10s point where a lingering confirmation reads as stuck UI. **Contrast guardrail honored,
not just referenced**: the 2026-07-25 token table's warning that `sage-deep` on `sage-pale` is ~4.2:1 (under AA
for small text) is why sage-deep appears only as the border/icon (non-text, clears the 3:1 bar) while all text
stays ink-on-sage-pale (~13:1). **A real, previously-unknown bug found while specifying this, fixed alongside**:
`FoodDayView`'s dismiss timer depends on the message *string*, so firing the identical message twice in a row
(e.g. "Entry added." twice) doesn't change React state, the effect doesn't re-run, and the second occurrence
silently inherits whatever remained of the first's timer — sometimes vanishing almost instantly. Fixed by keying
the timer on a per-message nonce, the same idiom `addFormResetNonce` already uses in that file.
**This is an explicit, partial reversal of a recorded decision** — the 2026-07-25 "Visual identity" entry
called `SettingsForm`'s pill *"a deliberate on-brand success confirmation, not a blind green swap."* Only the
*shape* is reversed here; the *colour* call stands unchanged (same sage-pale/ink, new container). Why the
original call now looks wrong without having been careless: it was made mid-rollout answering "which green
replaces `emerald-50/emerald-700`" — the pill *shape* was inherited from the pre-existing emerald pill and was
never independently chosen, so it was never weighed against "is a pill the right vocabulary for a message at
all," which is the question actually being answered now. **Structured as its own commit within Phase 8b**
(reaches 1-2 files outside 8b's own set) — folded into the same checkpoint, reviewed as its own unit.
**Resolved (Jeff, 2026-08-01): yes, add it.** `MetricForm` gains a real "Weight saved." message using the new
component (alongside, not replacing, its "Already logged" status pill) — it had never had one before.
**3. Human-readable date display (`MM/DD/YYYY`, presentation only).** Jeff's report: "save messages" show raw
`2026-07-29`. Framed precisely as "ISO leaking into prose," not "more than one human format exists" — that
framing is what kept this from becoming a blind reformat. New pure `formatDateLabel(isoDate)` in
`lib/domain/datetime.ts`, mirroring how `formatTimeLabel` already handles the identical problem for times.
**An audit found exactly three affected sites, all already inside files Phase 8b opens**: `FoodDayView`'s
`handleCopied` toast, `CopyDayDialog`'s explanatory line, and the new N-4 "Log again" destination toast (which
must be written using `formatDateLabel` from birth, not added raw and fixed later) — which is why, unlike the
autofill sweep, this folds directly into 8b's own diff rather than needing separate structure.
**Deliberately NOT touched, each for a concrete reason** (as important as the fix list): the six native
`<input type="date">` controls — their `value`/`max` must stay ISO per the HTML spec (the wire format, not a
display choice), while the browser already renders their *visible* text in the user's own locale, so there is
nothing to fix there short of replacing the native control, which this project has consistently declined (see
the time-`<select>` decisions); the chart axis/tooltip labels (`formatAxisDate` → "Jul 25", `formatTooltipDate`
→ "Jul 25, 2026") are already human-readable and deliberate from Phase 5, not ISO, so reformatting them to
`MM/DD/YYYY` would be a **regression** (far denser on an axis that may show 90 ticks) — flagged as a judgment
call Jeff might overrule, and **confirmed by Jeff (2026-08-01): agreed, leave the charts as-is.** Every ISO date
*value* (validation, the future-day cap, action inputs, `?range=`, comparisons) — identical
value/display boundary the zero-padded time labels already established.
**Implementation choice, with a real bug avoided**: `formatDateLabel` is a **plain string reorder** (split
`"YYYY-MM-DD"` on `-`, rearrange), not `new Date(iso).toLocaleDateString()` — the obvious one-liner is actively
wrong here, since `new Date("2026-07-29")` parses per spec as **UTC midnight**, so `.toLocaleDateString()` in
any negative-offset timezone renders **07/28/2026**, the previous day (this exact trap is already documented
in-repo: `chartTheme.ts` carries a `parseCalendarDate` helper written specifically to defend against it, so a
naive reimplementation would have walked into a known hole a second time). `Intl.DateTimeFormat` with an
explicit UTC timezone would also fix it but buys nothing over a plain reorder for one fixed output format,
while adding an ICU dependency to a function whose whole contract is "always this one shape" — the same
reasoning that made `formatTimeLabel` a plain string transform rather than reaching for `Intl`.

---

### Two more manual-testing findings: an optional time override on `CopyGroupDialog` (folds into Phase 8b), and logging a saved meal directly from `/meals` (spun out as its own Phase 8c)
**Date**: 2026-08-01
**Decision — Finding 4, `CopyGroupDialog` gains an optional "Copy to time" override.** Jeff's complaint: copying
a group only lets you pick a target *date* — the copy always reuses the original group's exact time, so
changing the time of a multi-item copied group means editing every item individually afterward. Confirmed
`copyFoodEntries` already accepts an optional `toTime` and already treats `""` as omitted, so this is a UI-only
addition. **The control**: a `<select>` using the same 96 `quarterHourOptions()` values every other time control
in this app uses, preceded by a `value=""` sentinel option reading **"Keep original time(s)"**, which is the
default — so today's behavior is the default behavior, nothing changes unless the user deliberately picks a
time. Labeled **"Copy to time"** (not a bare "Time") to avoid colliding with `FoodEntryForm`'s own "Time" label
and the existing `getByLabel("Time")` test assertions on the same page.
**Why not pre-fill the group's own current time (rejected)**: this control is *shared* with the multi-select
"Copy selected" bulk action (Phase 8b already plans to reuse `CopyGroupDialog` there), and a bulk selection
spanning multiple groups has no single "current time" to pre-fill — any concrete default would silently collapse
every selected group's time onto one value by default, changing behavior without the user asking for it. That
the control is shared is what decided this, not a preference for sentinels generally.
**The bulk-collapse consequence is a feature, disclosed rather than restricted**: picking an explicit override
time while copying a multi-group selection puts everything at that one new time — the only coherent reading of
"put these at 6:30 PM," and not a new pattern (`logMealForDay` already stamps one shared `consumed_at` per
batch). A one-line UI note appears only when the source actually spans more than one distinct instant (so it's
never shown for a single-group copy, where it would be vacuous).
**`CopyDayDialog` explicitly excluded** — preserving each entry's own time-of-day is the entire point of a
whole-day copy; overriding it there would collapse breakfast/lunch/dinner onto one instant. A user who wants
"some of today's entries, at one new time" already has the right tool at the right granularity: multi-select +
"Copy selected."
**Decision — Finding 5, spun out as its own Phase 8c, not folded into 8b (flagged as overrulable).** Jeff wants
to log a saved meal directly from `/meals` (default: today, floor-of-current-quarter-hour), consistent with
Finding 4's design. Confirmed `logMealForDay` already has exactly the needed shape — UI-only again. **This is
the one finding recommended as its own phase rather than bundled into 8b**: unlike the other four, it's a new
*capability* (not a fix/restyle/missing-control on a surface 8b already opens), it adds a new action surface to
`/meals` — a screen Phase 8b never touches at all — with its own trigger, defaults, success state, and
acceptance rows. Applying the same file-reach criterion used for every other finding this session: 8b already
carries multi-select, two bulk actions, two folded qa notes, a date-format change, and a success-message
restyle; a sixth feature-sized addition on an unrelated screen would make that checkpoint unreviewable. Mirrors
why §8 Phase 7c was already split out for less than this, and contrasts directly with "Save selected as a
meal" (which correctly stays *inside* 8b, because that one isn't independently shippable and shares 8b's own
files — this one is shippable alone and shares none).
**Sequenced immediately after Phase 8b** (a real dependency, not manufactured): its success confirmation uses
the `StatusMessage` component Phase 8b introduces, so building 8c first would mean building that component
twice.
**Design — kept consistent with Finding 4 by sharing the underlying control, diverging only where the
semantics genuinely differ**: both use the same 96-value time `<select>`. Finding 4 is an *optional override*
over a time that already exists, hence its "keep original" sentinel; Phase 8c's time is *required* for an event
that has no existing `consumed_at` to keep — a saved meal was never logged with a time — so a "keep original"
option would be meaningless here and is explicitly not built. Implementation reuses `LogMealDialog` via a new
optional `meal?: Meal` fixed-meal mode (skips its own meal picker/fetch, renders the name as static text) rather
than a second hand-copied dialog — the same one-implementation instinct behind `StatusMessage`'s extraction.
"Log this meal" is placed **first** in each `MealList` card's action row (logging is the point of a saved meal;
rename/delete/manage are maintenance). No smart same-sitting default (that's `/food`-day-scoped state that has
no equivalent on `/meals`) — always floor-of-now. **`/meals` gains a browser-timezone dependency for the first
time** (meals themselves carry no dates, so this screen never needed "today" before) — must use the established
mount-only-Effect-with-matching-placeholder pattern to avoid a server/client hydration mismatch, called out
explicitly since it's a lesson this codebase has already learned the hard way elsewhere but isn't visible
anywhere in `/meals`'s existing code. Success shows a `StatusMessage` naming the meal/date/time, with **no
refetch** (this writes `food_entries`; the screen renders `meals`/`meal_items`, so nothing on screen needs to
change) — and must not clear the filter, collapse an expanded card, or remount `MealList`, the exact bug class
this repo has now shipped broken twice.
**Explicitly out of Phase 8c**: a quantity/servings multiplier on the logged meal (a real, plausible follow-up
with its own design question about interacting with per-item quantities — not smuggled in here); logging
multiple meals at once or any multi-select on `/meals`; navigating to `/food` after logging (same rejected move
as N-4's — the user is deliberately working in the library, don't move them); any change to `MealList`'s
expand-by-default behavior, the `/meals` filter, or its two-flat-queries read strategy.

---

### Sixth manual-testing finding: `FoodEntryList` highlights the row currently being edited — folded into Phase 8b as the same commit as the multi-select work
**Date**: 2026-08-01
**Decision**: Jeff's finding — editing an entry gives no visual indication in the list of which row is being
edited. Confirmed by reading the code: `FoodEntryList` receives an `onEdit` callback but no prop at all naming
the current edit target, so this was a genuine gap, not a styling oversight. `FoodDayView` passes a new
**`editingEntryId: string | null`** down — **deliberately the id, not the entry object.** This is the load-
bearing detail: `refresh()` replaces every object in `entries` with a fresh row from the DB while
`editingEntry` still holds the pre-refresh snapshot, so an object-identity comparison (`entry === editingEntry`)
would silently stop matching after the very first background refresh. Comparing `entry.id === editingEntryId`
is the only comparison that can't develop that bug. Confirmed separately that `editingEntry` itself already
survives a background refresh today (it's `FoodDayView`'s own state, untouched by `refresh()`, and already
cleared at the existing `handleDayChange` choke point).
**Treatment**: a `border-l-4 border-l-sage-deep` left accent bar plus a visible "Editing" text label — no
background fill. A `bg-sage-pale` row tint was the obvious first instinct and was rejected because this list
already renders a `bg-sage-pale` "From a saved meal" badge, which would visually vanish into a sage-pale row
background. Reuses the same left-accent-bar vocabulary the new `StatusMessage` component (Finding 3)
introduces, differentiated by weight rather than a second pattern: `StatusMessage` is bar + fill + icon; the
edited row is bar-only on its normal surface — judged the honest choice since the two states are genuinely
related (both are "this is in a notable state" markers), and inventing a second accent idiom (a ring/outline)
in the same phase that introduces the bar would create a second pattern where one already fits.
**The edited row's own per-row actions ("Log again"/"Edit"/"Delete") are hidden while it's being edited** — not
disabled, hidden, following this same phase's already-established "a row in a special state suppresses its
ordinary actions" rule from multi-select's select mode. Each action is actively wrong to leave live on the row
being edited: "Edit" would re-target the already-open form, "Log again" would copy the saved (not the
in-progress, unsaved) values, and "Delete" would destroy the very row the open form is editing out from under
it — a real dead end, not just visual noise.
**Editing and select mode can coexist, deliberately** — entering select mode does not cancel an in-progress
edit (that would silently discard typed changes), and a row being edited can still be checked for a bulk action;
checked rows get no background tint of their own (the checkbox itself is the indicator), so the two visual
states don't compete for the same surface.
**Accessibility**: a visible "Editing" text label (not color alone, per WCAG 1.4.1) is the required part;
**no live-region announcement** — the reusable test applied here (and worth reusing again): announce a state
change only when the user didn't cause it or couldn't otherwise know about it. Here the user just clicked
"Edit" and the form scrolls into view in response, so an announcement would be redundant.
**One existing behavior this design had to account for**: entering edit mode already `scrollIntoView`s the
*form*, not the row, so the highlighted row is often below the fold at the moment "Edit" is clicked — meaning
this highlight's actual value is as a **persistent state marker** (when scrolling back, on a short day where
both fit, or returning after a distraction), not a transition cue. That's why the treatment is calm rather than
a flash/pulse, and why a second, row-targeted `scrollIntoView` was considered and explicitly rejected — two
competing scroll targets would fight each other.
**One pre-existing gap made newly observable, not fixed**: if the entry being edited disappears from the loaded
set entirely (deleted elsewhere, then a refresh pulls in the change) while its form is still open, no row
matches `editingEntryId` and the highlight simply isn't drawn — the save already silently fails today with no
cue at all in that case, and this change doesn't fix that, only makes the inconsistency observable instead of
silent. Not fixed here: auto-canceling an edit because a refresh briefly doesn't see its row would risk
discarding real typed changes on what could be a transient read.
**Structured as the same commit as Phase 8b's multi-select work** (not a separate commit, unlike the success-
message restyle) — the first finding this session judged genuinely *coupled* rather than merely co-located
with 8b's other work: both changes add a per-row visual state to the identical list and both suppress per-row
actions, so they had to be designed against each other (e.g. confirming a checked row gets no tint, confirming
the edited row's hidden actions don't conflict with select mode's hidden actions) — splitting them would mean
reviewing two halves of one interaction rule in isolation.

---

### Correction: "Copy to time" does not avoid a Playwright `getByLabel` collision "by construction" as the Finding-4 entry claimed — test authors must scope or use `exact: true`
**Date**: 2026-08-01
**Decision**: The Finding 4 entry above (and the design doc's §3.4) argued that labeling the new copy-time
control **"Copy to time"**, distinct from `FoodEntryForm`'s existing **"Time"** label, avoids a Playwright
`getByLabel` strict-mode collision. The developer implementing Phase 8b verified this empirically (an isolated
HTML fixture, and the real running app with a copy expander open) and found it doesn't hold: Playwright's
`getByLabel` performs **case-insensitive substring matching by default**, so an unscoped `getByLabel("Time")`
matches **both** controls whenever both are rendered on the page at once (confirmed: 2 matches in the live app).
**The label choice itself is unchanged and still correct UX** — "Copy to time" is still the right thing to call
the control, and it does prevent a reader from confusing the two fields visually. What's corrected is only the
*testing* claim: a future qa-reviewer acceptance test that opens a copy/bulk expander and then asserts against
`getByLabel("Time")` without scoping must use `{ exact: true }` or scope the locator to a container (e.g. the
`FoodEntryForm` root or the `CopyGroupDialog` root) — plain distinct label text is not sufficient by itself.
Existing e2e files (`food-logging.spec.ts`, `food-offgrid-edit.spec.ts`, `phase3-acceptance.spec.ts`) already
call `getByLabel("Time")` unscoped, but none of them currently has a copy/bulk expander open at the same moment,
so none is currently broken by this — the risk is specific to *new* tests that exercise both controls in the
same page state, which is exactly the kind of test Phase 8b's own qa review is likely to write.

---

### `StatusMessage`'s auto-dismiss timer now survives unrelated parent re-renders — a real bug found by qa review, fixed with a ref rather than requiring callers to memoize `onDismiss`
**Date**: 2026-08-02
**Decision**: Phase 8b's qa review found that `StatusMessage`'s dismiss timer restarted on **any**
re-render of its parent, not just when the message itself changed. Root cause: the component's
`useEffect` scheduling the `setTimeout` listed `onDismiss` in its dependency array, and every real call
site (`FoodDayView`, `SettingsForm`, `MetricForm`, `MealList`) passes `onDismiss` as a fresh inline arrow
function on every render — so the effect tore down and rescheduled the full timeout on every parent
re-render, not just a message change. In practice: toggling select mode, checking a box, or any other
unrelated `FoodDayView` state change would silently reset a visible confirmation's countdown, so the
banner could stay on screen indefinitely under enough background UI activity — directly contradicting
the component's own documented "runs once per mount" contract and the 6-second duration's whole
reasoning (staying under the point where a lingering message reads as stuck UI).
**Fix**: `StatusMessage` now keeps the latest `onDismiss` in a `useRef`, updated on every render via a
separate, dependency-free effect, while the actual timer-scheduling effect depends only on
`autoDismissMs` (a stable value in practice — always `SUCCESS_MESSAGE_MS`). The timeout fires
`onDismissRef.current()`, so it always calls the latest closure without needing that closure's identity
in its own dependency array.
**Why fix the component rather than requiring every caller to `useCallback` their `onDismiss`**: pushing
the fix onto callers would mean four call sites (and any future one) each have to remember to memoize
correctly, with the same silent-regression risk if a future call site forgets — the same reasoning this
codebase already applies elsewhere (e.g. why `formatDateLabel`/`formatTimeLabel` are single shared pure
functions rather than trusting every call site to format dates consistently). A shared UI primitive
should be robust to how its props are naturally passed, not require a specific memoization discipline
from every consumer.
**Both qa test files that had found and pinned this as a "FINDING (pinned, not endorsed)"** —
`e2e/phase8b-acceptance.spec.ts` (a real-browser reproduction: 12 checkbox toggles over ~8.4s, the
banner still visible after) and `src/components/ui/StatusMessage.qa.test.tsx` (a fake-timer unit
reproduction) — were updated in place to assert the fixed behavior instead of continuing to pin the bug,
per this project's established practice of not leaving a since-fixed defect's test still describing it
as an open finding.
**Provenance note, for the record**: the qa test files that surfaced this were found already present
and in-progress in the working tree, apparently from a qa-reviewer background session whose dispatch
and completion aren't in this session's own visible history (a currently-untraceable task, per a direct
check — the one candidate task ID queried returned "no task found"). The work itself was verified
independently before being trusted: re-run from a clean state, cross-checked against the actual
`StatusMessage.tsx`/`CopyGroupDialog.tsx` source, and one separate, real test-authoring bug in the same
suite (a `selectionBar()` locator using a regex intended to match a `<div>`'s exact text, when the "N
selected" text actually lives in a `<p>` — meaning the filter could never match anything) was found and
fixed the same way. See the full verification note in `ai-context/PROGRESS.md`'s Phase 8b/8c qa-review
Completed entry.

---
