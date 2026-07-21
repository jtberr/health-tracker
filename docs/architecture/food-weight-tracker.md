# Food, Weight & Body-Fat Tracker — Design Doc

**Status:** Approved
**Author:** architect (agent)
**Date:** 2026-07-19
**Approved by:** Jeff Berry, 2026-07-20

## 1. Problem / Goal

We are building the first real feature of the app: a personal daily health tracker. Each user can log
what they eat (individual food entries with calories and protein), their body weight, and their body
fat percentage, and then see trends over time in charts. The purpose is to let a user answer questions
like "am I hitting my protein target?" and "is my weight trending down over the last month?" without
spreadsheets.

**Ease of entry is the top priority — the app is worthless if logging is cumbersome.** So beyond basic
entry, the app provides: external food-database lookup (barcode / description) to prefill an entry; an
editable **quantity and free-text unit** ("4 eggs", "3 servings"); **saved meals** for planned recurring
combinations; low-effort **copy/repeat** flows for the common "I ate the same thing again" case; a
**minimal default entry form** (name + totals) with details tucked behind an optional expander; a per-entry
and per-day **"% of calories from protein"** readout; **persistent login**; and an **installable,
full-screen** (home-screen) experience. These are all logging conveniences that populate the same
`food_entries` rows a user could enter by hand.

The product is multi-user with authentication from day one (Supabase Auth + Row Level Security), so
every user sees only their own data. This is a settled decision — it avoids the exposed-URL risk of a
public deploy and avoids a painful single-user → multi-user schema migration later. This doc defines the
data model, RLS policies, route/server-action surface, component breakdown, and charting approach so the
Developer can implement directly against it.

## 2. Requirements

### Functional
- A user must authenticate (email + password via Supabase Auth) before accessing any tracking data.
  Signup uses Supabase's **built-in email confirmation** (see non-functional notes below).
- **Food intake:** create, edit, and delete individual food entries. Each entry has a name, calorie and
  protein values, and a **`consumed_at` timestamp (UTC)** — when the food was eaten — pre-filled to a
  smart default (see the fast-entry bullet) but overridable (log earlier today, or backdate). Day totals are
  the sum of that day's entries grouped by the **local calendar day** derived from `consumed_at` + the
  entry's captured time zone (3.2).
- **Fast default entry form (progressive disclosure + smart time default):** the default add-entry path is
  the **fewest fields** — name + **total** calories + **total** protein + date/time. In that path quantity
  defaults to 1 and unit is blank, so no per-unit math is required. Quantity, unit, and the per-unit/total
  input mode live behind an optional **"add detail"** expander. The date/time defaults to the **previous
  entry's `consumed_at`** while the user is adding items in the same sitting (so items typed together
  naturally share a timestamp and group as one meal — see grouping below), falling back to "now" for the
  first entry or after a freshness window elapses (exact rule in 3.4). **Time-of-day is entered on a
  15-minute grid** (:00/:15/:30/:45) via a native `<input type="time" step="900">`; when the smart default
  doesn't apply, "now" resolves to the 15-minute interval **at or before** the current time (floor — never a
  future bucket, so it stays consistent with the no-future cap).
- **% of calories from protein (new metric):** each food entry displays its protein-calorie ratio using the
  conventional formula `(protein_g × 4) ÷ calories × 100`. The **day-level rollup uses ratio-of-sums**:
  `(day_total_protein_g × 4) ÷ day_total_calories × 100` — sum the day's protein and calories first, then
  divide (not the average of per-entry percentages, which a tiny high-protein/low-calorie item would skew).
  The same ratio-of-sums rollup is shown per **meal group** (see grouping). Computed from existing
  `calories`/`protein_g` — no new stored field.
- **Quantity & unit (first-class, editable):** each food entry (and saved-meal item) stores a **quantity**
  (numeric, decimals allowed), an optional free-text **unit** (e.g. "eggs", "cup", "serving" — no fixed
  enum, no conversion), and a **per-unit** calorie/protein reference; the stored totals are
  `quantity × per-unit`. Because all three are stored, the user can later edit the quantity and the totals
  recalculate (3.2). Values may be entered per-unit or as a total (single-model rule in 3.4).
- **Meal grouping of logged entries (derived, exact-timestamp):** for display/rollup, already-logged entries
  that share the **exact same `consumed_at`** are treated as one meal group (fully deterministic — no gap
  heuristic, no time window, no stored category). This drives the per-meal protein-ratio rollup and the
  copy-a-group ease-of-entry feature below. This is distinct from **Saved Meals** (reusable templates that
  need advance setup); meal *grouping* is an inferred grouping of things already logged.
- **Copy / repeat (low-effort re-logging, three mechanisms — all in scope):** all three are thin callers of
  one shared server action (3.3):
  - **(a) Copy a whole day** to today or any chosen date.
  - **(b) "Log again" a single past entry** — one tap re-logs that exact entry (name/quantity/unit/per-unit)
    to now, no pre-saving. Distinct from Saved Meals: zero planning.
  - **(c) Copy a meal group** — entries sharing an exact `consumed_at` can be selected and copied as a group.
  Copies duplicate values into new `food_entries` rows and **go through the same no-future-day validation as
  any other write** — copy cannot bypass the cap.
- **No future-day logging (cap on the local day, not the instant):** an entry (including any copy) may not
  be dated later than the user's current local calendar day in that entry's time zone. Applies to add, edit,
  meal-batch logging, and copy. The same cap applies to weight/body-fat metric dates (3.2).
- **Food lookup to prefill (barcode-first, description-search second):** scan/type a UPC/EAN barcode, or
  search free text, to prefill name + per-unit calories/protein. Prefill, never auto-submit; graceful "not
  found — enter manually" fallback; a lookup is never required to log.
- **Saved meals:** save a named meal of individual food items (each with quantity/unit/per-unit); create/
  rename/delete meals and add/edit/remove/reorder items. Logging a saved meal creates one `food_entries` row
  per item (copy-by-value, **one shared `consumed_at`/tz for the batch** — so a logged meal already forms a
  single exact-timestamp group with no extra work; subject to the no-future-day cap), each independently
  editable and carrying an optional back-reference to the meal. Editing/deleting a meal never alters entries
  already logged from it.
- **Body weight:** exactly one value per user per day (upsert overwrites). **Body fat %:** optional, at most
  one per user per day. **Weight unit preference (kg / lb):** per-user display/input preference; stored
  canonically in kg (3.2).
- **Goals (minimal):** a single current daily calorie + protein target per user, drawn as a goal line on the
  intake charts (nullable).
- **Trends / charts (v1):** weight over time (+ optional body fat) in the user's unit; daily calories and
  protein vs. their goal lines; selectable range (7/30/90 days); gaps connect the line but only real days
  show a dot.
- **Installable (PWA-lite, online-only):** ships a web manifest + icons for add-to-home-screen + full-screen.
  **Online-only — no offline logging** (see out of scope).

### Non-functional
- **Security:** RLS on every table; `user_id = auth.uid()` on all reads/writes; no cross-user data; no
  service-role key in the browser.
- **Persistent login (settled):** a user stays logged in on a device **indefinitely** — no forced
  re-authentication and no app-imposed session-timeout; only an explicit **"log out"** ends the session.
  Concretely (3.3): persistent session storage + auto-refreshing tokens, relying on Supabase's own
  long-lived, rotating refresh tokens with **no** artificial max-session-age; `signOut()` is the only
  terminator. No schema impact.
- **Third-party lookups:** external food-DB calls go through a **server-side proxy** (3.3); only the
  barcode/search term is sent; logging never depends on a lookup.
- **Time handling (settled):** all instants stored in UTC (`timestamptz`); each food entry captures the
  browser IANA zone so its local day is derived correctly and stably (3.2). Weight/body-fat use a plain `date`.
- **Types:** TypeScript throughout, explicit types, no `any`.
- **Data integrity:** DB-level constraints + computed columns (one weight row per user/day; non-negative
  values; valid unit enum; non-null tz per entry; meal-item ownership; no future-dated logging; totals =
  quantity × per-unit).
- **Performance:** trend queries indexed by `(user_id, date)`; 90-day windows are small.
- **Data retention:** persists until user-deleted; hard delete on entry delete.

### Out of scope (v1)
- **Offline support of any kind — no service worker, no offline logging, no background sync, no push.**
  Install/full-screen only; connectivity required for all logging (explicit boundary).
- Goal history / time-varying goals; breakfast/lunch/dinner **stored** category tags (the exact-timestamp
  meal grouping is derived and stores nothing); macro tracking beyond calories + protein.
- A cross-meal reusable "food library" (meal items are scoped to their meal — see 4); contributing to the
  external food database; **unit conversion/normalization** between food units (free text, verbatim).
- Sub-15-minute time-of-day precision on food logging (the input is snapped to a 15-minute grid — see 3.4);
  Height / body units (cm/in); a user-facing time-zone picker; social/sharing/export/import; native app;
  custom SMTP (see 5); OAuth/social login; password reset beyond Supabase defaults.

## 3. Proposed Design

### 3.1 Module boundaries

```
src/
  app/
    manifest.ts                   ← Next.js MetadataRoute.Manifest (name, icons, display:'standalone', start_url)
    icon.png / apple-icon.png     ← home-screen + full-screen icons
    (auth)/
      login/page.tsx / signup/page.tsx
    (app)/                        ← authenticated group; layout enforces session; has a "Log out" control
      layout.tsx                  ← server-side session check → redirect /login if none; nav; signOut action
      page.tsx                    ← Dashboard: today's totals (incl. day protein %) + quick-add + "copy previous day"
      food/page.tsx               ← Food log for a selected day (grouped list, add/edit/delete, log-from-meal, copy-day, copy-group)
      meals/page.tsx              ← Saved-meals library CRUD
      metrics/page.tsx            ← Weight + body-fat daily entry (upsert)
      trends/page.tsx             ← Charts
      settings/page.tsx           ← Goals + weight-unit preference
    api/lookup/barcode/route.ts / api/lookup/search/route.ts  ← auth-gated proxies (OFF barcode / USDA search)
    auth/callback/route.ts        ← Supabase auth code exchange
  middleware.ts                   ← refreshes the Supabase session cookie on navigation (keeps login alive)
  components/
    food/FoodEntryForm.tsx        ← minimal default (name + totals + date/time smart-defaulted, 15-min grid); "add detail" expander; embeds FoodLookupPanel (client)
    food/FoodLookupPanel.tsx      ← barcode + description tabs → picked FoodCandidate (client)
    food/BarcodeScanner.tsx       ← camera scan via html5-qrcode; manual code fallback (client)
    food/FoodEntryList.tsx        ← day's entries grouped by exact consumed_at; per-group protein-% rollup; per-entry protein %; "Log again"; select group → copy (client)
    food/CopyDayDialog.tsx        ← pick a target date → copyFoodEntries(all source-day ids) (client)
    food/LogMealDialog.tsx        ← pick a saved meal + date/time (max=today, 15-min grid) → logMealForDay (client)
    food/DailyTotals.tsx          ← day sum + day-level protein % (ratio-of-sums)
    meals/MealList.tsx / MealForm.tsx / MealItemForm.tsx  ← meal CRUD; MealItemForm keeps qty/unit/per-unit always visible
    metrics/MetricForm.tsx / settings/SettingsForm.tsx
    trends/WeightChart.tsx / IntakeChart.tsx / RangeSelector.tsx
    ui/…
  lib/
    supabase/server.ts / supabase/client.ts   ← persistent session, auto-refresh
    domain/totals.ts              ← pure: sum entries/meal items
    domain/nutrition.ts           ← pure: proteinCaloriePct((protein×4)/calories×100); used per entry, per group, per day
    domain/entry-grouping.ts      ← pure: groupByConsumedAt — exact-timestamp grouping of logged entries (NOT saved meals)
    domain/quantity.ts            ← pure: lineTotal(qty×perUnit); perUnitFromTotal(total÷qty)
    domain/datetime.ts            ← pure: local↔UTC (tz-aware), browser tz, future-day cap, smart-default consumed_at, quarter-hour floor, validate
    domain/validation.ts / domain/units.ts / domain/trends.ts / domain/lookup.ts
    lookup/openfoodfacts.ts / lookup/usda.ts   ← server-only provider adapters
    actions/food.ts               ← 'use server': add/update/delete + copyFoodEntries (shared copy primitive)
    actions/meals.ts / actions/metrics.ts / actions/goals.ts
    types.ts
```

`lib/domain/*` is pure and the main unit-test target. **Note the rename:** the former gap-based
`clustering.ts` is replaced by `entry-grouping.ts` (exact-timestamp `groupByConsumedAt`) — no gap parameter,
deterministic — and a new `nutrition.ts` holds the protein-ratio math. Both are derived-only (they read
existing columns; they add no schema).

### 3.2 Data model

**No schema change is required for this round** (as for the prior one): the protein-calorie % is computed
from the existing generated `calories`/`protein_g`; meal grouping is computed from the existing
`consumed_at`; the 15-minute time grid is an input constraint only; copy/repeat reuses `food_entries`;
persistent login and the manifest are config/metadata. The five tables are unchanged; summarized here.

**`food_entries`** — one row per logged food; all timestamps UTC `timestamptz`. Key columns: `consumed_at`
(UTC, user-editable), `consumed_tz` (IANA, not null), `consumed_local_date` (trigger-derived grouping key,
not-future), `name`, `quantity` (numeric >0, default 1), `unit` (nullable free text), `calories_per_unit` /
`protein_g_per_unit` (numeric ≥0), `calories` INT and `protein_g` NUMERIC(6,2) as **STORED generated
columns** = `round(quantity × per-unit)`, nullable `logged_from_meal_id` (FK → `meals`, on delete set null),
audit timestamps. Trigger `set_consumed_local_date` (BEFORE insert/update) + CHECK
`consumed_local_date <= (now() at time zone consumed_tz)::date`. Indexes on
`(user_id, consumed_local_date, consumed_at)` and partial `(logged_from_meal_id)`.

The `consumed_at` **time-of-day input is restricted to 15-minute intervals** (:00/:15/:30/:45) — but this is
an **input constraint only**: `consumed_at` remains a full-precision UTC `timestamptz` (a snapped time simply
stores with `:00` seconds), so storage, indexing, the local-day trigger, and exact-match grouping are all
unchanged. No DB constraint enforces the grid (it is a UI affordance for ease of entry, not an invariant);
any legacy/off-grid instant still groups and sums correctly.

**Derived, non-stored (this round):** per-entry protein % and the exact-timestamp meal grouping are computed
in `lib/domain/*` at read/render time — deliberately not persisted. Grouping keys off the already-indexed
`consumed_at`; no `meal_group_id` column or join table is introduced (a stored group id would drift from the
timestamps and reintroduce the category-tag concept that is out of scope).

**`meals`** / **`meal_items`** (per-meal items with quantity/unit/per-unit + generated totals; composite FK
`(meal_id, user_id) → meals(id, user_id)`), **`daily_metrics`** (`unique (user_id, metric_date)`; loose
future backstop `metric_date <= current_date + 1`; **no time-of-day field, so the 15-minute grid does not
apply to weight/body-fat logging**), **`user_goals`** (with `weight_unit`) — unchanged. `daily_food_totals`
view unchanged (groups on `consumed_local_date`, sums generated `calories`/`protein_g`, `security_invoker =
on`); the day-level protein % is derived from its `total_calories`/`total_protein_g` in `nutrition.ts`, not
added as a view column. RLS: identical four-policy `user_id = auth.uid()` shape on all five tables.
Migration: single greenfield file, FK-ordered, constraints/triggers/view/policies; no backfill.

### 3.3 API / interface surface

Reads via RLS-scoped server client; **mutations are server actions**; **lookups are read-only auth-gated
Route Handlers** (proxy). All resolve the session first; `user_id` always from session.

**Supabase auth config (persistent login):** browser client `persistSession: true` + `autoRefreshToken:
true`; server client bound to Next cookies; `middleware.ts` refreshes/rotates the session cookie on
navigation. No custom expiry on top of Supabase's long-lived rotating refresh tokens; only `signOut()`
(a "Log out" nav control) ends a session.

Types: `FoodEntry`/`MealItem` carry `quantity`, `unit: string | null`, `calories_per_unit`,
`protein_g_per_unit`, read-only generated `calories`/`protein_g` (as before). **Protein % is not added to the
row types** — it is derived by `nutrition.proteinCaloriePct` in the UI. Other types unchanged.

New / changed pure helpers:
```ts
// lib/domain/nutrition.ts — one function serves per-entry, per-group, and per-day (ratio-of-sums).
// Returns null when calories === 0 (undefined ratio); caller renders '—'.
export function proteinCaloriePct(proteinG: number, calories: number): number | null; // (proteinG*4)/calories*100

// lib/domain/entry-grouping.ts — replaces the removed gap-based clustering.
// Groups logged entries that share the EXACT same consumed_at instant. Deterministic; no threshold.
export type EntryGroup = { consumedAt: string; entries: FoodEntry[] };
export function groupByConsumedAt(entries: FoodEntry[]): EntryGroup[]; // preserves chronological order of groups

// lib/domain/datetime.ts — smart default + 15-min grid for the next add-entry form (pure; injectable now).
// Returns lastConsumedAt when it is within `freshnessMinutes` of now (same sitting) else the quarter-hour
// floor of now (ISO UTC). floorToQuarterHour floors local time-of-day to :00/:15/:30/:45 (never rounds up,
// so the default can never be a future bucket that the no-future cap would reject).
export function defaultConsumedAtForNextEntry(lastConsumedAt: string | null, now: Date, freshnessMinutes?: number): string; // default 120; floors the "now" branch
export function floorToQuarterHour(instant: Date): Date;
export function localInputToUtcInTz(dateStr: string, timeStr: string, tz: string): string; // (existing) wall time in tz → ISO UTC
// (existing) localDayNotAfterToday / localDateNotAfterToday / utcToLocalTime / browserTimeZone
```

**Shared copy primitive** (unchanged shape; requirement (c) now supplies an exact-timestamp group's ids):
```ts
copyFoodEntries(input: { entryIds: string[]; toDate: string; toTime?: string; toTz: string }): Promise<Result<FoodEntry[]>>
```
Semantics unchanged: (a) copy-day passes all source-day ids; (b) "Log again" passes one id with
`toDate=today`,`toTime=now`; (c) copy-group passes the ids of an exact-`consumed_at` group. If `toTime` is
omitted each copy preserves its source local time-of-day on `toDate` — so a copied group (whose sources share
one instant) lands on one new instant and **stays grouped**. `logged_from_meal_id` is dropped on copies; the
future-day cap is reused via `localDateNotAfterToday(toDate, toTz)` (reject `error:'future_date'` before any
insert, whole-batch transaction, DB CHECK backstop); ownership/atomicity via RLS (empty/foreign ids →
`ok:false`).

Other actions unchanged: `addFoodEntry`/`updateFoodEntry`/`deleteFoodEntry` (inputs take quantity/unit/
per-unit; future-day guarded); meal CRUD + **`logMealForDay`** (already stamps one shared `consumed_at`/tz
across the batch — **confirmed: this batch is exactly one exact-timestamp meal group with no change
needed**); `upsertDailyMetric` (with `metricTz`)/`deleteDailyMetric`; `updateGoals`. Read helpers unchanged.
Lookup routes unchanged.

### 3.4 State & UI

**`FoodEntryForm` — progressive disclosure + smart time default + 15-min grid.** Default view = name + total
calories + total protein + date/time; quantity 1, unit null, so the typed total is stored as the per-unit
value at quantity 1. "Add detail" expander reveals quantity/unit/per-unit-or-total (auto-expands on a
lookup-candidate pick; see prior revision).
- **Time-of-day is a native `<input type="time" step="900">`** (900 s = 15 min), so the browser's own
  keyboard/stepper/platform picker only offers :00/:15/:30/:45 — standard HTML, no custom picker. The date is
  a native `<input type="date" max={today}>`.
- **Smart `consumed_at` default (the rule that makes exact-match grouping free):** `food/page` tracks the
  most recently logged entry's `consumed_at` for the selected day (`lastConsumedAt`). Opening the add form
  defaults its date/time to `datetime.defaultConsumedAtForNextEntry(lastConsumedAt, now)`:
  - **first entry / no recent context** (`lastConsumedAt` null) → default **the quarter-hour floor of now**
    (`floorToQuarterHour`), capped to the selected day/today. Flooring (not rounding to nearest) guarantees
    the default is at-or-before the current time, so it can never be a not-yet-loggable future bucket.
  - **adding again in the same sitting** (`lastConsumedAt` within the **120-min** freshness window) → default
    **`lastConsumedAt`** (already on the grid, since it came from a prior gridded entry), so the new item
    shares the exact instant and joins the same meal group.
  - **enough time has passed** (>120 min) → default **the floor of now** again (starts a new group).
- Edge cases: on submit `lastConsumedAt` updates to the just-saved `consumed_at` (following any manual time
  the user set); changing the selected day resets `lastConsumedAt` to null (→ floor-of-now on that day). The
  user may override the time, but the `step` keeps even manual edits on the 15-minute grid. 120 min is a
  tunable constant; grouping semantics remain pure exact-match on whatever `consumed_at` is stored.
- **This reinforces exact-`consumed_at` grouping:** snapping both the default and manual edits to the grid
  means near-miss hand entries from one sitting (e.g. 12:03 vs 12:04 for two items) collapse onto the same
  bucket and group correctly, reducing unintended splits — complementing the smart default.
- Submit sends `{ consumedAt, consumedTz, name, quantity, unit, caloriesPerUnit, proteinGPerUnit }`.

**`FoodEntryList` — exact-timestamp meal groups + protein %.** Renders the day's entries via
`entry-grouping.groupByConsumedAt(entries)`: entries sharing an exact `consumed_at` appear under one **meal
group** header showing the group's local time and its **ratio-of-sums protein %**
(`proteinCaloriePct(sumProtein, sumCalories)`). Each entry row shows "qty × unit — name — total kcal / g" and
its own **per-entry protein %** (`proteinCaloriePct(entry.protein_g, entry.calories)`, rendering `—` when
calories are 0). Group headers offer **"Copy this group"** (→ `copyFoodEntries(groupIds, …)`); per-entry
**"Log again"**; multi-select → "Copy selected". Meal-batch rows (shared `logged_from_meal_id`) are labeled
and — because `logMealForDay` shares one `consumed_at` — naturally fall into a single group.

**`DailyTotals`** shows the day's total calories/protein and the **day-level protein %** using the same
ratio-of-sums function on the day's summed totals (from `daily_food_totals`). The dashboard shows the same
for today.

Other components unchanged: `CopyDayDialog`, `LogMealDialog` (its date/time picker is likewise a
`date max=today` + `time step="900"`), `MealList`/`MealForm`, `MealItemForm` (fields always visible),
`MetricForm` (date max=today, no time field, sends `metricTz`), `SettingsForm`, `RangeSelector`,
`WeightChart`/`IntakeChart`. The `(app)` nav has a **"Log out"** control (the only session terminator).
Installability via `app/manifest.ts` (+ icons), `display:'standalone'`, **no service worker**.

**State:** server state is Supabase; client state is in-flight form values (incl. expander state,
`lastConsumedAt` for the smart default, quantity/unit, picked candidate, multi-select set), optimistic
updates, chart range (URL), display-unit prop. No global store.

## 4. Alternatives Considered

- **Time-of-day input: 15-minute grid via native `step="900"`, floor-to-past default (chosen)** vs.
  round-to-nearest, free-second entry, or a custom time picker. **Floor, not round-to-nearest**, because
  rounding up could land on a quarter-hour bucket *later* than the current time — a not-yet-happened instant
  that the no-future-day cap would (correctly) reject, spuriously blocking the default; flooring can only ever
  produce an at-or-before bucket, so it composes cleanly with the cap. **Native `<input type="time"
  step="900">`** over a bespoke picker: it's standard HTML with built-in keyboard entry, platform pickers, and
  accessibility for zero custom code — matching the project's prefer-conventional bias — and the `step`
  constrains manual edits too. **Bonus:** snapping default and manual edits to the grid makes near-miss
  timestamps from one sitting coincide, reinforcing the exact-`consumed_at` meal grouping. The grid is a UI
  affordance only (not a DB constraint), so it never rejects data and doesn't touch storage precision.
- **Meal grouping: exact-timestamp match (chosen) vs. a time-gap heuristic (rejected).** An earlier revision
  grouped entries by a >90-minute gap. Jeff rejected it: a user who eats every 30 minutes for 3 hours has no
  natural 90-minute chunk boundary — the heuristic would split or merge arbitrarily and unpredictably.
  **Exact-match** (`groupByConsumedAt`) is fully deterministic, parameter-free, and easy to reason about: two
  entries are "the same meal" iff they carry the identical `consumed_at`. The **smart time default + 15-min
  grid** (3.4) make this ergonomic for free — items logged in one sitting inherit the same gridded timestamp —
  while `logMealForDay` already shares one timestamp per batch. Tradeoff (accepted): if the user manually
  changes one item's time, it forms its own group; that's a faithful reflection of what they entered.
- **Per-day protein % rollup: ratio-of-sums (chosen) vs. average-of-per-entry-percentages (rejected).**
  Averaging each entry's percentage lets a small high-protein/low-calorie item (e.g. a protein shake) skew
  the day disproportionately. Ratio-of-sums `(Σprotein×4)/Σcalories×100` weights by calories, which is the
  conventional and correct day/meal figure. Same function serves entry, group, and day.
- **Protein % stored vs. derived (chosen: derived).** It's a pure function of existing `calories`/`protein_g`;
  storing it would add a redundant column that could drift. Computed in `nutrition.ts` at render time.
- Prior settled calls carried forward: shared `copyFoodEntries` primitive over three actions; copy preserves
  source times by default and drops `logged_from_meal_id`; progressive disclosure on `FoodEntryForm`,
  always-visible on `MealItemForm`; candidate pick auto-expands; persistent login via Supabase long-lived
  tokens; PWA-lite (no service worker); generated-column totals; single quantity model with per-unit/total
  input; free-text unit (no conversion); UTC `consumed_at` + per-entry tz + trigger local-day; no-future-day
  DB CHECK + app check; OFF barcode + USDA search behind a server proxy; per-meal items; canonical kg; unit
  pref on `user_goals`; Recharts; single current goal; summed-on-read totals; server actions; auth from day one.

## 5. Risks & Open Questions

- **Protein % divide-by-zero / odd values.** An entry with `calories = 0` (possible if `calories_per_unit`
  is 0 while protein is >0) makes the ratio undefined — `proteinCaloriePct` returns `null` and the UI shows
  `—` (both per entry and, if a day/group sums to 0 calories, at the rollup). Inconsistent source data can
  also yield >100% (protein_g × 4 exceeding calories); displayed as-is (no clamping) since it signals a data
  issue rather than a code one.
- **Exact-timestamp grouping depends on identical `consumed_at`.** Grouping only "works" when items truly
  share the instant; the smart default plus the 15-minute grid (3.4) arrange that for the common in-sitting
  case, but a manual time tweak (still to another grid bucket), a copy with `toTime` set, or logging the same
  food across two sittings will (correctly) land in separate groups. Intended determinism, not a defect. The
  120-minute freshness window is a tunable constant.
- **15-minute granularity is coarse by design.** Two genuinely distinct eating occasions inside the same
  quarter-hour would share a bucket and group together; conversely the loss of exact-minute precision is
  accepted for the ease-of-entry win (Jeff's priority) and is listed as an explicit out-of-scope item. Sub-15-
  minute precision can be revisited if a user needs it; storage keeps full precision, so it's a UI-only change.
- **Copying a large day / persistent login on shared devices / online-only / rounding of quantity × per-unit
  / free-text unit non-normalization / third-party lookup availability + data quality / lookup-query privacy
  (settled acceptable) / trust-the-browser clock+tz for the future-day cap / camera-barcode UX / cost /
  duplicate weigh-in / goal retroactivity / email at scale / RLS misconfiguration** — all as previously
  documented and unchanged.

## 6. Testing Strategy

**Unit tests (Developer) — pure `lib/domain/*`:**
- `nutrition.ts`: `proteinCaloriePct(50, 800) = 25`; ratio-of-sums example (entries 30g/200kcal +
  10g/300kcal → `(40×4)/500×100 = 32`, which differs from averaging the two per-entry %s — assert the
  ratio-of-sums value); returns `null` when `calories = 0`; rounding to the chosen display precision.
- `entry-grouping.ts`: `groupByConsumedAt` puts entries with the identical `consumed_at` in one group and
  distinct instants in separate groups; the "every 30 minutes for 3 hours" case → each distinct instant is
  its own group (no arbitrary chunking); identical-instant entries group regardless of insertion order;
  empty → empty; group order is chronological.
- `datetime.ts`: `floorToQuarterHour` floors to the earlier bucket and **never rounds up** (12:00→12:00,
  12:07→12:00, 12:15→12:15, 12:44→12:30, 12:59→12:45); the floored "now" default is always ≤ the injected
  `now` (so it never trips the no-future cap). `defaultConsumedAtForNextEntry` returns `lastConsumedAt` when
  within 120 min of injected `now`, else the floor of now; returns the floor of now when `lastConsumedAt` is
  null (first entry); boundary at exactly the freshness window; plus the existing future-day cap and
  `localInputToUtcInTz` tests.
- `quantity.ts` / `totals.ts` / `units.ts` / `lookup.ts` / `validation.ts` / `trends.ts`: as previously
  specified (validation still rejects empty `entryIds` / future `toDate` for `copyFoodEntries`).

**Acceptance / integration tests (QA, from spec):**
- **Per-entry protein %:** an entry with 30 g protein / 240 kcal displays 50%; a 0-kcal entry displays `—`.
- **Day rollup is ratio-of-sums, not average-of-ratios:** a day with a normal meal + a tiny high-protein/
  low-calorie shake shows the calorie-weighted day % (assert it equals `(Σprotein×4)/Σcalories×100` and is
  **not** the mean of the entries' individual percentages).
- **Exact-timestamp meal grouping:** two entries logged with the same `consumed_at` render under one group
  with a group-level ratio-of-sums %; entries at different instants render as separate groups; a
  `logMealForDay` batch (one shared `consumed_at`) renders as exactly one group with no extra steps.
- **15-minute time grid + floor default:** the time input only accepts :00/:15/:30/:45 (native `step=900`);
  the first add of a session defaults to the quarter-hour **floor** of now (e.g. at 12:07 → 12:00), never a
  future bucket; two items typed in one sitting share the defaulted bucket and group; the metrics form has no
  time field and is unaffected.
- **Smart time default:** the first add of a session defaults to floor-of-now; a second add moments later
  defaults to the first entry's `consumed_at` (so they group); after >120 min the default reverts to
  floor-of-now (new group); changing the selected day resets to floor-of-now on that day; a manual time
  override (still on grid) is respected and following adds follow it.
- **Copy a meal group = exact subset:** "Copy this group" copies exactly the entries sharing that
  `consumed_at` (not the whole day, not other groups), and the copied entries share one new `consumed_at` so
  they remain a group on the target day.
- Carried forward unchanged: copy-day + future-cap-on-copy (no rows on a future target) + "Log again" +
  copy ownership/atomicity; minimal-form submit → valid unitless entry; candidate-prefilled submit; quantity
  edit recalculates totals; saved-meals CRUD + logging; no-future-day (add/edit/meal); RLS isolation across
  all five tables; barcode/search lookup; unit-preference kg/lb; goals/charts/gap rendering; metrics upsert;
  persistent login (reload keeps session; log out clears it); installability (valid manifest, no service
  worker); DB constraints.

**Fixtures:** as before, plus a day containing (i) two entries with an identical `consumed_at` and (ii)
entries at several distinct instants incl. an "every 30 min" run — to exercise grouping and the ratio-of-sums
rollup — and a high-protein/low-calorie item to exercise the ratio-of-sums-vs-average distinction. Mocked
provider responses for lookups; injected fixed `now` for time-dependent (grouping-default, floor, future-cap)
tests. RLS tests run as each user's JWT.

## 7. CI/Pipeline Impact

No structural change to `.github/workflows/ci.yml`. Action items:
- **New secret — `USDA_FDC_API_KEY`** (server-only, not `NEXT_PUBLIC_*`; free tier is enough for v1 —
  settled) as a GitHub Actions secret for build/e2e and in the Vercel env. Open Food Facts needs no key.
- **npm scripts must exist** (`lint`, `test`, `test:e2e`, `build`) — added when the app is scaffolded.
- **Mock external providers in CI**; **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) only for the
  acceptance-test step (or local `supabase start`); **create test users via the admin API** (auto-confirmed);
  **inject fixed `now` + explicit `consumedAt`/`consumedTz`/`toDate`** in time-dependent tests (now also
  covering the grouping smart-default and the quarter-hour floor).
- **PWA/manifest, persistent login, protein-%, grouping, and the 15-min time grid** need no new secret or
  pipeline step — the grid is native HTML + pure `floorToQuarterHour` logic covered by unit tests; protein %
  and grouping are pure derived logic; the manifest is static output.
- No new pipeline stages, runners, or build steps otherwise.

## 8. Implementation Plan (phased)

The build is split into small, dependency-ordered phases so this first Next.js/Supabase project lands in
digestible chunks. **Each phase runs the full role loop before the next begins:** **developer** implements
that phase's scope + writes unit tests (per §6) → **qa-reviewer** writes and runs **independent acceptance
tests from this spec for that phase's scope only** (not the whole app) and reviews the code adversarially →
**Jeff reviews and approves** the phase → the next phase starts. A phase is not "done" on the developer's
say-so; qa-reviewer gates each checkpoint and Jeff approves it.

**This plan activates only once Jeff approves this design doc as a whole** (Status is still *Draft*). Phasing
is about implementation sequence and incremental review — it is **not** a substitute for the doc-level
approval gate above. Any phase that surfaces genuinely new design surface goes back through the architect
before it's built, per the project workflow.

The §6 pointers below tell qa-reviewer which slice of the testing strategy is in play at each checkpoint.
Carried-forward items from earlier phases must keep passing (no regressions), but the *new* rows are the
focus of that phase's review.

### Phase 1 — Foundation (no user-visible tracking features)
- **In:** Next.js 14 App Router scaffold (TypeScript, Tailwind); Supabase project + env wiring; browser +
  server Supabase clients (`persistSession`/`autoRefreshToken`, cookie-bound server client); auth pages
  (signup with the built-in email-confirmation state, login, logout control) + `auth/callback` route;
  `middleware.ts` session refresh; `(app)/layout.tsx` auth gate (redirect to `/login` when no session) and
  base nav; the `lint`/`test`/`test:e2e`/`build` npm scripts + CI wiring; required secrets (`SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for the e2e step from Phase 2 on; `USDA_FDC_API_KEY`
  may be deferred to Phase 6).
- **Out:** any tables, tracking data, or feature UI.
- **§6 scope for qa-reviewer:** *Auth gating* (unauthenticated access to every `(app)` route redirects/401s);
  *persistent login* (reload/cookie-refresh keeps the session; "Log out" clears it and re-gates). Establish
  the admin-API auto-confirmed test-user helper here (used by all later e2e).

### Phase 2 — Data model + RLS (no UI; highest-risk, isolated deliberately)
- **In:** all five tables + the `daily_food_totals` view in one FK-ordered migration; the four-policy
  `user_id = auth.uid()` RLS on every table; the `set_consumed_local_date` and `updated_at` triggers; the
  STORED generated `calories`/`protein_g` columns; every CHECK/constraint incl. the future-date caps
  (`food_entries_not_future_day`, `daily_metrics_not_future_day`), the composite `(meal_id, user_id)` FK, the
  unit enum, and non-negativity; the two-user seed/fixtures.
- **Out:** all UI, components, and feature server actions (tests exercise the DB directly, as each user's JWT).
- **§6 scope for qa-reviewer (hammer this checkpoint):** *RLS isolation (critical)* across all five tables +
  the view; *DB constraints* (negative/out-of-range values, invalid `weight_unit`, empty/null `consumed_tz`,
  null `consumed_at`, future `consumed_local_date`, grossly future `metric_date`, cross-user `meal_item`);
  *generated-total integrity* (totals can't be set directly and always equal `round(quantity × per-unit)`);
  *trigger derivation of `consumed_local_date`* and *DB-level local-day grouping* (near-midnight, travelling
  tz). Cross-user isolation must be proven here before anything is built on top.

### Phase 3 — Core food logging loop (minimum "actually useful" milestone)
- **In:** `FoodEntryForm` (progressive disclosure: name + totals default, "add detail" expander, per-unit/
  total modes) with quantity/unit; the 15-min `step="900"` time grid + `floorToQuarterHour` floor default +
  the smart `lastConsumedAt` default; `addFoodEntry`/`updateFoodEntry`/`deleteFoodEntry` (future-day guarded);
  `FoodEntryList` with exact-`consumed_at` grouping + per-entry and per-group protein %; `DailyTotals` +
  dashboard day protein %; reads off `daily_food_totals`; the domain modules `totals`, `quantity`,
  `nutrition`, `entry-grouping`, `datetime` (future-cap + floor + smart default), `validation`; `food/page`.
- **Out:** metrics, charts, lookup, saved meals, copy mechanisms. (Build `FoodEntryForm` with a clean seam to
  accept an external `FoodCandidate` prefill + auto-expand later — the point Phase 6 plugs into.)
- **§6 scope for qa-reviewer:** unit — `nutrition`, `entry-grouping`, `quantity`, `datetime` (floor, smart
  default, future cap), `totals`, `validation`. Acceptance — *per-entry protein %*, *day ratio-of-sums vs
  average*, *exact-timestamp grouping*, *15-min grid + floor default*, *smart time default*, *minimal-form
  submit → valid unitless entry*, *quantity edit recalculates totals*, *no-future-day (add/edit)*.

### Phase 4 — Weight/body-fat logging + goals/settings
- **In:** `upsertDailyMetric` (with `metricTz`)/`deleteDailyMetric`; `MetricForm` (kg/lb input via
  `units.ts`, `date max=today`, no time field); `user_goals` ensure-row + `updateGoals`/`getGoals`;
  `SettingsForm` (goals + `weight_unit` toggle); `metrics/page`, `settings/page`.
- **Out:** charts.
- **§6 scope for qa-reviewer:** unit — `units` (kg↔lb round-trip, formatting). Acceptance — *metrics upsert*
  (one row/day, weight-only leaves body fat null, `unique` enforced), *unit-preference end-to-end* (lb stored
  as kg, displayed back, switching re-renders without changing stored values), *goals CRUD*, *no-future
  metric date* (client cap + loose DB backstop; a legitimate ahead-of-UTC "today" not blocked).

### Phase 5 — Trend charts
- **In:** `trends/page`; `WeightChart` (unit conversion, optional body-fat second axis), `IntakeChart` (goal
  `ReferenceLine`), `RangeSelector` (7/30/90 via `?range=`); `trends.ts` (dense series + `isReal`);
  `getWeightSeries`/`getIntakeSeries`.
- **Out:** lookup, meals, copy.
- **§6 scope for qa-reviewer:** unit — `trends` (`isReal` flags, connect-across-gaps, range filtering).
  Acceptance — *goals + charts + gap rendering* (goal line only when set; series in the user's unit; a
  continuous line with dots only on real days).

### Phase 6 — Food lookup (barcode + description search)
- **In:** `/api/lookup/barcode` (Open Food Facts) and `/api/lookup/search` (USDA, using `USDA_FDC_API_KEY`)
  auth-gated Route Handlers; `lib/lookup/*` adapters; `domain/lookup` normalizers + `unitFromServingLabel`;
  `FoodLookupPanel` + `BarcodeScanner` wired into `FoodEntryForm` (candidate prefill: silent fill +
  auto-expand). Add the `USDA_FDC_API_KEY` secret now if not already.
- **Out:** saved meals.
- **§6 scope for qa-reviewer:** unit — `lookup` (normalizers, `unitFromServingLabel`, dropping candidates
  without usable nutrition). Acceptance — *barcode* (mocked OFF: match / not-found → manual fallback /
  provider error; USDA key never in any client bundle/response), *search* (mocked USDA; empty query → 400;
  entry still saveable with hand-typed values), *candidate-prefilled submit* (+ quantity adjust → correct
  total), and *auth-gating on `/api/lookup/*`* (401 unauthenticated). Providers mocked in CI.

### Phase 7 — Saved meals
- **In:** `meals`/`meal_items` CRUD actions (`createMeal`, `updateMeal`, `deleteMeal`, add/update/delete/
  reorder item); `logMealForDay` (batch insert, one shared `consumed_at`/tz, `logged_from_meal_id`,
  future-day cap); `meals/page` (`MealList`, `MealForm`, `MealItemForm` with always-visible fields + reused
  `FoodLookupPanel`); `LogMealDialog` on `food/page`.
- **Out:** copy mechanisms.
- **§6 scope for qa-reviewer:** *saved-meals CRUD* (meal total = item sum; rename; add/edit/remove/reorder;
  delete cascades items); *logging* (`logMealForDay` → exactly N rows sharing one `consumed_at`/tz/
  `consumed_local_date` + `logged_from_meal_id`, summing into the day and forming one exact-timestamp group;
  empty meal rejected); *meal edits don't touch already-logged history*; *future-cap on the batch*; re-verify
  RLS on `meals`/`meal_items` via the actions (base isolation was proven in Phase 2).

### Phase 8 — Ease-of-entry extras (copy/repeat)
- **In:** `copyFoodEntries` (the shared primitive) and its three callers — copy-day (`CopyDayDialog`),
  per-entry "Log again", and copy-group (from `FoodEntryList` group headers / multi-select).
- **Out:** — . **Note:** the smart time default and the quarter-hour grid were already implemented in Phase 3
  (they're part of the core form), so this phase is essentially just the copy mechanisms on top of them.
- **§6 scope for qa-reviewer:** *copy-day* (duplicates every source entry, preserves times, drops
  `logged_from_meal_id`); *future-cap on copy* (future `toDate` → `error:'future_date'`, **no** rows inserted
  — copy can't bypass the cap); *"Log again"* single entry; *copy-group = exact subset* (and the copied group
  stays grouped on the target day); *ownership/atomicity* (empty/foreign `entryIds` → `ok:false`, nothing
  inserted).

### Phase 9 — PWA-lite shell
- **In:** `app/manifest.ts` (`display:'standalone'`, `start_url`, name/theme) + `icon.png`/`apple-icon.png`.
- **Out:** service worker / offline / sync / push (explicitly out of scope).
- **§6 scope for qa-reviewer:** *installability* (valid `manifest.webmanifest` with `display:'standalone'`,
  `start_url`, name, icons; **no service worker registered** — the online-only boundary holds).

**On the ordering (architect's read):** the dependency order is sound — Foundation → schema/RLS is the right
base, and isolating RLS in its own hardened checkpoint (Phase 2) before any feature is the highest-value
sequencing decision here. Two things to keep in mind rather than reorder: (1) Phase 3's `FoodEntryForm` must
be built with a clean seam to accept a `FoodCandidate` prefill later, so Phase 6 slots in without a rewrite —
called out in Phase 3's scope. (2) Saved meals (Phase 7) intentionally follows lookup (Phase 6) so
`MealItemForm` can reuse the finished `FoodLookupPanel`; if lookup were deferred, meal items would just start
manual-only and gain lookup later — but keeping 6→7 avoids reworking `MealItemForm`. Everything after Phase 3
(metrics, charts, lookup, meals, copy) is independent enough that Jeff can resequence 4–8 by priority if he
wants the barcode scanner or charts sooner — only Phases 1→2→3 and 6→7 are hard dependencies.

---
**Definition of Done for this feature:**
All 9 phases in §8 implemented and individually approved through their per-phase checkpoint
(developer implementation + unit tests → qa-reviewer's independent acceptance tests for that
phase → Jeff's review and approval); the full §6 acceptance-test suite green in CI; and Jeff has
used the app for real day-to-day food and weight logging for several days with no data loss and
no cross-user RLS leakage observed.
