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
editable **quantity and free-text unit** ("4 eggs", "3 servings"); **saved meals** for recurring
combinations — built up front *or* **captured after the fact from a meal group already logged**; low-effort
**copy/repeat** flows for the common "I ate the same thing again" case; a
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
  15-minute grid** (:00/:15/:30/:45) via a native **`<select>` of the 96 quarter-hour values of a day**
  (option labels in 12-hour AM/PM form, option `value`s in 24-hour `HH:MM`) — one interaction to pick a
  time, standard HTML, no custom picker. When the smart default doesn't apply, "now" resolves to the
  15-minute interval **at or before** the current time (floor — never a future bucket, so it stays
  consistent with the no-future cap).
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
  copy-a-group ease-of-entry feature below. This is distinct from **Saved Meals** (reusable named templates
  — built up front in `/meals`, *or* captured from a logged group after the fact, see "Save a logged meal
  group as a Saved Meal" below); meal *grouping* is an inferred grouping of things already logged, and stays
  derived-only even when a group is used as the *source* of a saved meal.
- **Copy / repeat (low-effort re-logging, four mechanisms — all in scope):** all four are thin callers of
  one shared server action (3.3):
  - **(a) Copy a whole day** to today or any chosen date.
  - **(b) "Log again" a single past entry** — one tap re-logs that exact entry (name/quantity/unit/per-unit)
    to now, no pre-saving. Distinct from Saved Meals: zero planning.
  - **(c) Copy a meal group** — entries sharing an exact `consumed_at` can be selected and copied as a group.
  - **(d) Copy an arbitrary multi-entry selection** (Phase 8b) — the user ticks individual entries anywhere in
    the day's log, **across meal-group boundaries**, and copies exactly that set. Same primitive, same cap; the
    only new thing is the selection itself. That same selection also feeds **"Save selected as a meal"**
    (`createMealFromEntries`, already id-list-based — see 3.3/3.4), so one selection serves both bulk actions.
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
  already logged from it. **A meal can be logged from either surface:** from `/food` (pick a meal for the day
  being viewed) *and*, from Phase 8c, **directly from the `/meals` library** (log *this* meal to a chosen day
  and time, defaulting to today at the current quarter-hour) — the same action, the same cap, no navigation. **The library must stay findable as it grows:** both places meals are listed (the
  `/meals` library and the log-a-meal picker) present them in one shared, predictable alphabetical order, show
  how many there are, and `/meals` offers a name filter. No meal is ever hidden or capped (3.4/4).
- **Save a logged meal group as a Saved Meal (2026-07-30 addition — closes the one-directional gap):** from
  any exact-timestamp **meal group** in the day's log, the user can capture that group as a **new named
  Saved Meal in one step**, instead of re-typing it in `/meals`. Each entry in the group becomes one
  `meal_items` row, **copied by value** (`name`, `quantity`, `unit`, `calories_per_unit`,
  `protein_g_per_unit`) — the same by-value direction Saved Meals already use when logging, just running the
  other way. Two properties are load-bearing and must hold by construction, not by convention:
  - **Strictly read-only with respect to `food_entries`.** The source entries are never updated, relinked, or
    deleted by this operation. In particular their `logged_from_meal_id` is *not* repointed at the new meal,
    so the "From a saved meal" label on a group that was itself logged from an older meal keeps saying exactly
    what it said before.
  - **The new meal keeps no reference back to the entries it came from.** There is no "derived from" column in
    either direction — a Saved Meal has no concept of its origin. From the moment it is saved it is an
    independent template, which is what makes "editing/deleting a meal never alters entries already logged
    from it" *and* its mirror ("editing/deleting entries never alters a meal captured from them") both true
    without any extra rule.
  A **name is required and prompted up front** (`meals.name` is NOT NULL); a **one-entry group is a valid
  one-item meal**; and an empty selection is rejected outright (never create an empty meal — the same stance
  `logMealForDay` already takes on the read side). Ownership/atomicity semantics in 3.3.
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
- **Autofill hygiene (2026-07-31 addition):** password managers and browser autofill must engage with the
  **login/signup identity fields only**. Every other form control in the app — food names, quantities, units,
  calorie/protein figures, meal names, weight/body-fat, goal targets, filter and search boxes, barcode entry,
  date and time pickers — must carry an explicit hint telling the browser it is not identity data, so no manager
  offers to fill or save it. Achieved with **standard `autocomplete` markup only** — no JS, no custom widgets
  (3.4). Best-effort by nature: browser heuristics and third-party extensions are not fully controllable (5).
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
- Server-side search/pagination/virtualization of the saved-meals library, and any cap on how many meals a
  user may keep; fuzzy matching; recency-of-use or favourites ordering (see 4/5 — the saved-meals list is
  sorted, filtered and counted **client-side** over a fully-fetched list, by design and with a documented
  revisit trigger).
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
      page.tsx                    ← Dashboard: today's totals only (incl. day protein %), via TodaySummary — deliberately minimal, see §4
      food/page.tsx               ← Food log for a selected day (grouped list, add/edit/delete, log-from-meal, copy-day, copy-group, multi-select bulk actions)
      meals/page.tsx              ← Saved-meals library CRUD + (Phase 8c) "Log this meal" per card
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
    food/FoodEntryList.tsx        ← day's entries grouped by exact consumed_at; per-group protein-% rollup; per-entry protein %; group-header action bar ("Save as meal", "Copy this group"); "Log again"; per-row selection checkboxes in select mode (client)
    food/EntrySelectionBar.tsx    ← Phase 8b: "N selected" + "Copy selected" / "Save selected as a meal" / Clear / Done; rendered by FoodDayView above the list (client)
    food/CopyDayDialog.tsx        ← pick a target date → copyFoodEntries(all source-day ids) (client)
    food/CopyGroupDialog.tsx      ← pick a target date + an OPTIONAL time override ("Keep original time" default) → copyFoodEntries; serves BOTH a group header and a multi-select selection (client)
    food/LogMealDialog.tsx        ← date/time (max=today, 15-min grid) → logMealForDay; picks a meal on /food, or (Phase 8c) takes a fixed `meal` prop for /meals (client)
    food/SaveGroupAsMealDialog.tsx ← name a logged group OR a multi-select selection → createMealFromEntries; inline expander, not a modal (client)
    food/DailyTotals.tsx          ← day sum + day-level protein % (ratio-of-sums)
    meals/MealsView.tsx           ← client orchestrator: reads meals+items, owns the name-filter box + counts (client)
    meals/MealList.tsx / MealForm.tsx / MealItemForm.tsx  ← meal CRUD; MealItemForm keeps qty/unit/per-unit always visible
    metrics/MetricForm.tsx / settings/SettingsForm.tsx
    trends/WeightChart.tsx / IntakeChart.tsx / RangeSelector.tsx
    ui/…
  lib/
    supabase/server.ts / supabase/client.ts   ← persistent session, auto-refresh
    domain/totals.ts              ← pure: sum entries/meal items
    domain/nutrition.ts           ← pure: proteinCaloriePct((protein×4)/calories×100); used per entry, per group, per day
    domain/entry-grouping.ts      ← pure: groupByConsumedAt — exact-timestamp grouping of logged entries (NOT saved meals)
    domain/meal-items.ts          ← pure: groupMealItemsByMeal; computeReorderedSortOrders; mealItemsFromEntries (entries → meal-item drafts)
    domain/meals.ts               ← pure: sortMealsByName; filterMealsByName — meal-level (not item-level) library ordering/filtering
    domain/quantity.ts            ← pure: lineTotal(qty×perUnit); perUnitFromTotal(total÷qty)
    domain/datetime.ts            ← pure: local↔UTC (tz-aware), browser tz, future-day cap, smart-default consumed_at, quarter-hour floor, validate
    domain/validation.ts / domain/units.ts / domain/trends.ts / domain/lookup.ts
    lookup/openfoodfacts.ts / lookup/usda.ts   ← server-only provider adapters
    actions/food.ts               ← 'use server': add/update/delete + copyFoodEntries (shared copy primitive)
    actions/meals.ts              ← 'use server': meal/item CRUD; logMealForDay (meal → entries); createMealFromEntries (entries → meal)
    actions/metrics.ts / actions/goals.ts
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
columns** = `round(quantity × per-unit)`, nullable `logged_from_meal_id` (**plain** single-column
`FK → meals(id)`, `on delete set null`), audit timestamps. Trigger `set_consumed_local_date` (BEFORE insert/update) + CHECK
`consumed_local_date <= (now() at time zone consumed_tz)::date`. Indexes on
`(user_id, consumed_local_date, consumed_at)` and partial `(logged_from_meal_id)`.

The `consumed_at` **time-of-day input is restricted to 15-minute intervals** (:00/:15/:30/:45) — via a native
`<select>` of the 96 quarter-hour values (see §3.3/§4) — but this is an **input constraint only**:
`consumed_at` remains a full-precision UTC `timestamptz` (a snapped time simply
stores with `:00` seconds), so storage, indexing, the local-day trigger, and exact-match grouping are all
unchanged. No DB constraint enforces the grid (it is a UI affordance for ease of entry, not an invariant);
any legacy/off-grid instant still groups and sums correctly.

**Saved-meals list scaling adds no schema either (2026-07-30, Phase 7c).** Finding a meal in a growing library
is handled entirely client-side over rows the app already fetches (§3.4), so there is **no migration in that
phase — no new column, no new index, no new extension.** The existing `meals_user_id_idx (user_id)` already
serves the only query involved (RLS-scoped `select * from meals where user_id = …`), and at this app's scale
that read returns tens of rows. Two indexes were considered and **deliberately not added**: a `(user_id, name)`
index (a sort over tens of rows is free — Postgres would very likely ignore it anyway) and a `pg_trgm` GIN
index for `ILIKE '%…%'` search (needs a new extension and a real migration to accelerate a query the app does
not make). Both become worth revisiting **only if** server-side search or pagination is ever adopted — see the
tripwire in §5.

**Derived, non-stored (this round):** per-entry protein % and the exact-timestamp meal grouping are computed
in `lib/domain/*` at read/render time — deliberately not persisted. Grouping keys off the already-indexed
`consumed_at`; no `meal_group_id` column or join table is introduced (a stored group id would drift from the
timestamps and reintroduce the category-tag concept that is out of scope).

**Save-a-group-as-a-meal adds no schema either (2026-07-30).** It writes only rows the existing tables already
describe: one `meals` row + N `meal_items` rows, using the columns Phase 7 already created. Deliberately **no
new column in either direction** — no `meal_items.from_food_entry_id`, no `meals.derived_from_consumed_at`, no
`food_entries.saved_into_meal_id`. Such a column would be exactly the reference-not-value coupling the
copy-by-value decision exists to avoid: it would make a meal's meaning depend on rows the user is free to edit
or delete afterwards, and would need its own `ON DELETE` semantics, ownership story, and "what does a dangling
one mean" answer — all to store provenance nothing in the product actually reads. **A useful invariant falls
out of the copy being per-unit:** `meal_items.calories`/`protein_g` are STORED generated columns computed by
the *same* `round(quantity × per-unit)` expression as `food_entries.calories`/`protein_g`, so copying only the
per-unit inputs makes the new meal's totals equal the source group's totals *by construction* — the totals are
never copied (they can't be; they're generated), and therefore can never be copied wrongly.

**`meals`** / **`meal_items`** (per-meal items with quantity/unit/per-unit + generated totals; composite FK
`(meal_id, user_id) → meals(id, user_id)`), **`daily_metrics`** (`unique (user_id, metric_date)`; loose
future backstop `metric_date <= current_date + 1`; **no time-of-day field, so the 15-minute grid does not
apply to weight/body-fat logging**), **`user_goals`** (with `weight_unit`) — unchanged. `daily_food_totals`
view unchanged (groups on `consumed_local_date`, sums generated `calories`/`protein_g`, `security_invoker =
on`); the day-level protein % is derived from its `total_calories`/`total_protein_g` in `nutrition.ts`, not
added as a view column. RLS: identical four-policy `user_id = auth.uid()` shape on all five tables.
Migration: single greenfield file, FK-ordered, constraints/triggers/view/policies; no backfill.

**Deliberate FK asymmetry — `meal_items.meal_id` is composite-owner-checked, `food_entries.logged_from_meal_id`
is not (and must not be).** `meal_items.user_id` is a *denormalized copy of the owner that RLS itself trusts*
(RLS on `meal_items` keys off that column, not off a join to `meals`), and a meal item has no independent
existence from its parent meal — it is a composition (`ON DELETE CASCADE`). So its owner column **must** be
kept in lockstep with `meals.user_id`, which is exactly what the composite `(meal_id, user_id) → meals(id,
user_id)` FK guarantees at the DB level: without it the denormalized owner could drift or be spoofed, and RLS
(which trusts it) would then be operating on a lie. **None of that transfers to `food_entries`.** A food entry
is an independent aggregate root that exists in its own right whether or not it came from a meal;
`logged_from_meal_id` is a *weak, informational back-reference* ("this row was logged from meal X"), **not** an
RLS discriminator — `food_entries` RLS keys purely off `food_entries.user_id`, never off the referenced meal.
A stray cross-user `logged_from_meal_id` therefore corrupts no trust boundary: any read that joins it back to
`meals` goes through the RLS-scoped client, so a foreign reference resolves to *nothing/null* (RLS filters
`meals` to the caller's own rows) — never to another user's data — exactly the already-accepted "points to a
since-invisible/deleted concept" state that `ON DELETE SET NULL` embraces. A composite FK here would also fight
the required delete semantics: a plain composite `ON DELETE SET NULL` would null **both** referencing columns
(including the row's own NOT NULL `user_id`) when a meal is deleted, breaking the row; avoiding that needs the
less-common Postgres-15 `ON DELETE SET NULL (logged_from_meal_id)` column-list variant — real added complexity
to defend an invariant RLS already makes non-load-bearing. The same-owner guarantee for this column is instead
an **app-layer write invariant** (see §3.3 / §8 Phase 7): `logMealForDay` may only ever set
`logged_from_meal_id` to a meal it read as the acting user's own through the RLS-scoped server client (never
the service-role client), so a foreign meal id is structurally unreachable on the write path — and the DB does
**not** enforce this, so the server action is the enforcement point.

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

// 2026-07-31 addition (Phase 8b) — display-only date label, the exact mirror of formatTimeLabel.
// "2026-07-29" → "07/29/2026". PURE STRING REORDER: it must NOT go via `new Date(iso)` +
// toLocaleDateString, because `new Date("2026-07-29")` parses as UTC midnight and renders as the
// PREVIOUS day in any negative-offset zone — the off-by-one `chartTheme.ts`'s parseCalendarDate
// already exists to defend against. A split/reorder cannot have that bug and needs no tz reasoning.
// Anything not matching YYYY-MM-DD is returned unchanged (never throws, never renders "NaN/NaN/NaN").
// Presentation only: every ISO date VALUE (input value/max, DATE_PATTERN, comparisons, the
// future-day cap, consumed_local_date/metric_date, ?range=) is untouched — see §3.4.
export function formatDateLabel(isoDate: string): string;

// lib/domain/meal-items.ts — 2026-07-30 addition: the by-value entry→meal-item copy, as pure logic.
// Keeps `createMealFromEntries` a thin I/O shell (project convention: business logic lives in lib/domain).
export type MealItemDraft = {
  name: string; quantity: number; unit: string | null;
  caloriesPerUnit: number; proteinGPerUnit: number; sortOrder: number;
};
// Copies ONLY the five value columns + a fresh 0..N-1 sortOrder. Deliberately drops id, user_id,
// consumed_at/tz/local_date, logged_from_meal_id, timestamps, and the generated calories/protein_g
// (the DB regenerates those from quantity × per-unit — see §3.2). Orders by created_at then id, so
// item order matches the order the entries were actually logged in (consumed_at is identical across
// a group and therefore cannot break the tie).
export function mealItemsFromEntries(entries: FoodEntry[]): MealItemDraft[];
// NOTE: there is deliberately no `defaultMealNameFromEntries` helper — the name field starts blank
// (§3.4, settled 2026-07-30), so there is no prefill to derive and nothing pure to test here.
// (existing) groupMealItemsByMeal / computeReorderedSortOrders

// lib/domain/meals.ts — 2026-07-30 addition (Phase 7c): meal-LEVEL ordering/filtering, kept out of
// meal-items.ts (which is item-level, per its own doc comment). Pure — no query, no fetch.
// One shared ordering for BOTH surfaces (/meals list and LogMealDialog's picker), so a meal sits in
// the same place in both. Case-insensitive by name; ties broken by created_at then id, because
// duplicate meal names are explicitly legitimate (§5) and an unstable sort would make rows jump
// between renders.
export function sortMealsByName(meals: Meal[]): Meal[];               // returns a new array; does not mutate
// Case-insensitive AND-of-whitespace-separated-tokens substring match on `meal.name` only.
// Empty/whitespace-only query → returns the input order unchanged (identity, not "no results").
// Substring, not prefix, so "rice" finds "Chicken and rice"; no fuzzy/trigram matching (§4).
export function filterMealsByName(meals: Meal[], query: string): Meal[];
```

**Shared copy primitive** (unchanged shape; requirement (c) now supplies an exact-timestamp group's ids):
```ts
copyFoodEntries(input: { entryIds: string[]; toDate: string; toTime?: string; toTz: string }): Promise<Result<FoodEntry[]>>
```
Semantics unchanged: (a) copy-day passes all source-day ids and **never** a `toTime`; (b) "Log again" passes one
id with `toDate=today`,`toTime=now`; (c) copy-group passes the ids of an exact-`consumed_at` group, **and from
Phase 8b may optionally pass a `toTime` the user picked**; (d) **Phase 8b's "Copy selected" passes the ids the
user ticked, which may span several groups**, likewise with an optional `toTime`. The action already accepts an
arbitrary id list *and* an optional time, so **both new callers need no action change whatsoever** — confirmed
against the implementation, not assumed: `toTime` is normalized (`""` is treated exactly as omitted), the
15-minute grid is already validated server-side when a time is present, and the future-day cap keys off
`toDate` alone, so an override time cannot interact with it.

**The two time modes, and what each does to grouping** — this is the user-visible consequence, so it is stated
rather than left to be discovered:
- **`toTime` omitted → each copy preserves its own source local time-of-day** on `toDate`. A copied *group*
  (whose sources share one instant) lands on one new instant and **stays one group**; a copied *cross-group
  selection* or a copied *whole day* reproduces its several source instants as the **same several groups**,
  keeping the day's rhythm.
- **`toTime` supplied → every copied row lands on that one instant**, so the copy becomes **exactly one group**
  on the target day no matter how many groups the source spanned. For a single-group copy that is
  indistinguishable from preserving (one group either way); for a multi-group selection it is a deliberate
  collapse — see §3.4/§4. `logged_from_meal_id` is dropped on copies; the
future-day cap is reused via `localDateNotAfterToday(toDate, toTz)` (reject `error:'future_date'` before any
insert, whole-batch transaction, DB CHECK backstop); ownership/atomicity via RLS (empty/foreign ids →
`ok:false`).

**`createMealFromEntries` — the entries→meal direction (2026-07-30 addition).** The exact mirror of
`logMealForDay`, and deliberately shaped like it, so the two directions are reviewable against each other:

```ts
// 'use server', useActionState-shaped like every other form-backed action in lib/actions/*.
// formData carries: name (string) + repeated entryIds fields (read with formData.getAll('entryIds')).
// Reuses Phase 7's MealActionState → { ok, error, fieldErrors?, meal? }.
createMealFromEntries(prevState: MealActionState, formData: FormData): Promise<MealActionState>
```

- **Input is entry *ids*, never entry *values*.** The action re-reads the `food_entries` rows itself through
  the **RLS-scoped server client** (never service-role), exactly as `logMealForDay` re-reads `meal_items`
  rather than trusting a client-supplied item list. Client-supplied names/calories are display data only; they
  never reach a write.
- **Ownership is stated, not assumed** (this codebase's convention — cf. §3.2's FK asymmetry and Phase 7's
  belt-and-suspenders filters). The read is `.in('id', entryIds).eq('user_id', user.id)` on top of RLS, so a
  foreign or nonexistent id resolves to zero rows. **Then a count check:** if `rows.length !== unique(entryIds).length`,
  reject the whole request (`error:'entries_not_found'`) — without it a mixed own/foreign set would silently
  produce a *partial* meal, which is worse than an error because it looks like it worked. `meals.user_id` and
  `meal_items.user_id` are set from the session only; `meal_items`' composite `(meal_id, user_id)` FK then
  makes it structurally impossible for the items to attach to anything but the meal just created for this user.
- **Empty `entryIds` → `error:'no_entries'`, nothing written** (mirrors `logMealForDay`'s `empty_meal` and
  `copyFoodEntries`' empty-ids rejection). Blank name → the existing `validateMealInput` field error, checked
  **before** any write.
- **The action does *not* require the ids to share one `consumed_at`.** Its contract is "these entry ids" —
  the *group* is a UI-level selection, identical to how `copyFoodEntries(entryIds, …)` is already id-list-based
  and group-agnostic. That keeps the exact-timestamp grouping purely derived (§3.2) and means **Phase 8b's
  multi-select drives this action unchanged — confirmed when 8b was designed, not just hoped for: the phase adds
  no action-layer code at all.** Passing an arbitrary subset of one's *own* entries is a legitimate use, not an
  attack: there is nothing to corrupt.
- **Nothing in this action touches `food_entries`.** No UPDATE, no DELETE, no relink — the requirement's
  read-only property is enforced by there simply being no such statement in the code path. This is a
  code-review checkpoint for qa-reviewer, since no schema constraint can express it.
- **Atomicity — compensating delete (settled 2026-07-30, Jeff's call; no RPC, no migration).** Two statements
  are unavoidable: `INSERT INTO meals … RETURNING` then one multi-row `INSERT INTO meal_items`. Each is
  individually atomic, but supabase-js exposes no cross-statement transaction, so the residual failure mode is
  "meal created, items failed". **Required handling:** on item-insert failure the action deletes the
  just-created meal (`.eq('id', …).eq('user_id', user.id)`) and returns the error — the compensating delete is
  part of the action's contract, not a nice-to-have, and qa-reviewer should confirm the code path exists. In
  the doubly-unlucky case where the compensating delete *also* fails, the worst residual state is a **named,
  empty, visible, user-deletable meal** — which `logMealForDay` already refuses to log (`empty_meal`), so it
  cannot corrupt anything downstream. The Postgres-RPC alternative was considered and **rejected** — see §4.

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
- **Time-of-day is a native `<select>` of the 96 valid quarter-hour values** ("12:00 AM" … "11:45 PM";
  option labels 12-hour AM/PM, option `value`s 24-hour `HH:MM`), so picking a time is **one interaction**
  rather than three separately-set segments — standard HTML, fully keyboard/screen-reader accessible, no
  custom picker. (This replaces the earlier `<input type="time" step="900">`: `step` constrained the valid
  values but browsers still render that widget as three independent hour/minute/AM-PM segments regardless of
  `step`, so it never delivered the intended fewer-interactions friction win — see §4 and
  `ai-context/DECISIONS.md`.) The value handed to the form/action is still the 24-hour `HH:MM` string, so
  server validation, `localInputToUtcInTz`, grouping, and the future-day cap are unchanged. **Edit invariant:**
  if an entry's stored time-of-day is ever off-grid, the edit form injects it as an extra selected option so
  opening it for an unrelated edit never silently rewrites its time. The date is a native
  `<input type="date" max={today}>`.
- **Label format (2026-07-26 revision): the 12-hour label is zero-padded to a fixed `hh:mm AM|PM` shape** —
  `"08:15 AM"`, `"06:30 PM"`, `"12:00 AM"`, `"11:45 PM"` — so all 96 labels are the same character count and
  line up as a column while scrolling (a one-digit hour otherwise shifted the colon/minutes/meridiem one glyph
  left on 72 of the 96 rows). `formatTimeLabel` owns the padding; `quarterHourOptions` and the off-grid
  injected option inherit it. The `<select>` and each `<option>` also carry Tailwind's `tabular-nums`, as a
  secondary polish only — equal character count is the load-bearing fix, since `<option>` CSS is ignored by
  macOS Safari/Chrome and by every mobile native picker. Label text only: the `HH:MM` option `value`, the
  15-minute grid, the floor-of-now default, exact-`consumed_at` grouping, and the future-day cap are all
  untouched. Accepted tradeoff: `<select>` type-ahead now needs `0`,`8` rather than a bare `8`. Full
  reasoning and rejected alternatives (tabular-nums alone, monospace, figure-space padding, 24-hour labels,
  `<optgroup>`s) in `ai-context/DECISIONS.md`.
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
- Edge cases: on submit of an **added** entry, `lastConsumedAt` updates to the just-saved `consumed_at`
  (following any manual time the user set). **Amended 2026-07-30 (`ai-context/DECISIONS.md`, "`lastConsumedAt`
  only advances on an add, not an edit"):** submitting an **edit** to an existing entry does NOT update
  `lastConsumedAt`, however recent that entry's own time is — an edit isn't a new eating occasion, and letting
  it move the tracker could snap the next new entry's default backward to whatever was just edited, undoing
  forward progress from real adds made earlier in the same sitting. Changing the selected day resets
  `lastConsumedAt` to null (→ floor-of-now on that day). The user may override the time, but the `<select>`'s
  fixed 96-value option set keeps even manual edits on the 15-minute grid (the control literally cannot express
  an off-grid time). 120 min is a tunable constant; grouping semantics remain pure exact-match on whatever
  `consumed_at` is stored.
- **"Clear" (2026-07-30 addition, `FoodEntryForm`/`FoodDayView`):** a button next to "Add entry" (add mode
  only) that resets every field — name/calories/protein/quantity/unit/detail-mode — back to the fast-entry
  defaults. Its date/time reset deliberately **bypasses** the smart same-sitting default above: it always shows
  the viewed day and the floor-of-now quarter-hour, never a reused `lastConsumedAt`, since "Clear" means "start
  over," not "continue this sitting." See `ai-context/DECISIONS.md`, "'Clear' resets to the viewed day's
  current time...".
- **This reinforces exact-`consumed_at` grouping:** snapping both the default and manual edits to the grid
  means near-miss hand entries from one sitting (e.g. 12:03 vs 12:04 for two items) collapse onto the same
  bucket and group correctly, reducing unintended splits — complementing the smart default.
- Submit sends `{ consumedAt, consumedTz, name, quantity, unit, caloriesPerUnit, proteinGPerUnit }`.

**`FoodEntryList` — exact-timestamp meal groups + protein %.** Renders the day's entries via
`entry-grouping.groupByConsumedAt(entries)`: entries sharing an exact `consumed_at` appear under one **meal
group** header showing the group's local time (12-hour AM/PM, via `formatTimeLabel` — **amended 2026-07-30**;
this list previously showed the bare 24-hour `HH:MM` and was explicitly called out as "deliberately out of
scope, not silently changed" in `ai-context/DECISIONS.md`'s 2026-07-26 entry, which that same file's
2026-07-30 amendment now supersedes) and its **ratio-of-sums protein %**
(`proteinCaloriePct(sumProtein, sumCalories)`). Each entry row shows "qty × unit — name — total kcal / g" and
its own **per-entry protein %** (`proteinCaloriePct(entry.protein_g, entry.calories)`, rendering `—` when
calories are 0). Group headers offer **"Save as meal"** and **"Copy this group"**
(→ `copyFoodEntries(groupIds, …)`); each entry row offers **"Log again"**, "Edit" and "Delete". A separate
**multi-select mode** (Phase 8b — see the block below; *not* built in Phase 8) layers per-row checkboxes and two
bulk actions on top of this list. Meal-batch rows (shared `logged_from_meal_id`) are labeled
and — because `logMealForDay` shares one `consumed_at` — naturally fall into a single group.

**"Save as meal" on a group header (2026-07-30 addition).** The group header becomes a small **action bar**
rather than a one-off button holder: it carries "Save as meal" now and "Copy this group" when Phase 8 lands.
Building the slot now (and doing this work before Phase 8 — see §8 Phase 7b) means Phase 8 adds a button to an
existing bar instead of retrofitting one.
- **The prompt is an inline expander, not a modal** — `components/food/SaveGroupAsMealDialog.tsx`, opening
  directly under the group header it belongs to. Same idiom as `LogMealDialog` and `FoodLookupPanel`; this
  codebase has **no modal precedent anywhere**, and a single feature is not the place to introduce focus-trap
  and dismiss semantics (the same reasoning already recorded for `LogMealDialog` in Phase 7).
- **Contents:** a "Meal name" text input, a **read-only preview** of the N items about to be copied (name +
  qty/unit + kcal, straight from the entries already in props — display only; the action re-reads from the DB
  regardless, §3.3), and Save / Cancel. Name is **prompted before the copy executes**, never after (§4).
- **The name field starts blank (settled 2026-07-30, Jeff's call) — no prefill.** It is **autofocused** with a
  `placeholder` for shape only (e.g. "e.g. Weekday breakfast", matching `MealForm`'s existing placeholder
  convention), and a placeholder is never a value, so submitting without typing is a field error rather than a
  silently-accepted default. Validation is the existing `validateMealInput` (non-blank) — no new validator, and
  **no `defaultMealNameFromEntries` helper** (§3.3). The reasoning is in §4: a saved meal is a long-lived
  library object the user will pick from a list months later, so its name is worth one deliberate keystroke
  sequence.
- **It must not render a `<form>` inside another `<form>`.** `FoodEntryList` is currently a sibling of
  `FoodEntryForm`, not nested in it, so its own `<form>` is legal today — but this repo has already lost time
  to exactly this bug once (the Phase 6 `FoodLookupPanel`/`BarcodeScanner` nesting, see
  `ai-context/PROGRESS.md`), so the developer should confirm the nesting rather than assume it.
- **No day refetch on success.** This is the useful consequence of the operation being read-only on
  `food_entries`: nothing on `/food` changed, so there is nothing to reload. Success collapses the expander and
  reports via a new optional `onGroupSavedAsMeal?: (meal: Meal) => void` prop, which `FoodDayView` wires into
  its **existing** transient `savedMessage` mechanism ("Saved as a meal." — optionally linking to `/meals`).
- **Required prerequisite — don't reintroduce the `MealsView` bug.** `FoodEntryList` gains real local UI state
  for the first time (which group's expander is open, and its in-flight name). `FoodDayView` currently swaps
  the whole list out for a `Loading…` placeholder on **every** `refresh(...)`, which would unmount the
  expander mid-typing if any other action refreshed the day underneath it. Apply the same fix `MealsView`
  already carries: scope the full-size loading placeholder to the **initial** load only (a `hasLoadedOnce`
  flag) and keep `FoodEntryList` mounted through background refreshes. This is the identical bug class
  recorded in `ai-context/DECISIONS.md`'s Phase 7 entry — it is being called out ahead of time here precisely
  because last time it was only caught by driving the UI by hand.

**Multi-select bulk actions on the day's log (2026-07-31 addition, Phase 8b).** Phase 8 shipped the three
*implicit-scope* copy mechanisms — whole day, one group, one entry — where the set of entries is decided by
*which button you press*. Multi-select is the fourth: the user picks an arbitrary set by hand, across group
boundaries, and then applies one of two bulk actions to it. **This is the first selection UI anywhere in this
codebase**, so the interaction is specified here rather than left to the implementation.

- **Two bulk actions, both driving already-shipped, already-qa-reviewed actions with no change:**
  **"Copy selected"** → `copyFoodEntries(selectedIds, toDate, /* no toTime */, tz)` (Phase 8), and
  **"Save selected as a meal"** → `createMealFromEntries` (Phase 7b). Both already take an arbitrary id list and
  both already document that they do **not** require a shared `consumed_at` (§3.3). **Phase 8b therefore adds no
  server-action code and no domain code at all — it is entirely UI.** That is the fact that makes bundling both
  bulk actions into one phase cheap and reviewable (§4).
- **Selection may span meal groups.** Restricting it to one group would make the feature strictly redundant with
  "Copy this group" and unable to express anything else — i.e. it would have no reason to exist. The two
  cross-group consequences are both well-defined and must be stated in the UI's own copy, not discovered:
  *copying* a cross-group selection reproduces each entry's own source time-of-day, so it lands as the same
  several groups on the target day (§3.3); *saving* one as a meal produces one meal whose items are ordered by
  `created_at`-then-`id`, i.e. chronologically across the day (`mealItemsFromEntries`, unchanged).
- **Entering/exiting: an explicit "Select entries" toggle, not always-visible checkboxes.** A **"Select entries"**
  button sits in `FoodDayView`'s existing control row (beside "Log a saved meal" / "Copy this day"), rendered
  only when the day has at least one entry. Pressing it enters **select mode**; a **"Done"** control in the
  selection bar exits it. Rationale in §4 — briefly: every row already carries three buttons and every group
  header two, so always-on checkboxes would put five affordances on a row on a phone, and would leave "Copy this
  group" and "Copy selected" visible simultaneously — exactly the ambiguity that has already been raised twice
  as a non-blocking note (the duplicated "Cancel" labels, Phase 7b N-3 / Phase 8 N-5). Making the mode explicit
  answers "what will this button copy?" unambiguously at every moment.
- **In select mode the per-row and per-group action buttons are hidden** ("Log again", "Edit", "Delete",
  "Save as meal", "Copy this group"), and entering select mode **closes any open group expander**
  (`groupAction → null`). Exiting restores the buttons and remembers nothing. Select mode is a *mode*: while it
  is on, the only thing the list does is select.
- **The control is a plain native `<input type="checkbox">` per entry row**, with a real accessible name
  identifying the entry (e.g. `aria-label="Select 2 eggs — Eggs"`), not a custom toggle/switch. Same reasoning
  as the 96-option time `<select>` over a combobox (§4): standard HTML, free keyboard and screen-reader support,
  zero custom JS. Clicking the row itself does **not** toggle selection — only the checkbox does; a
  whole-row-is-a-hit-target rule would make an accidental tap silently change what a subsequent bulk action
  operates on. **A checked row gets no background tint of its own** — the checkbox is the indicator. That is
  deliberate: this phase also introduces an *editing-row* highlight (below), and two per-row visual states in one
  list must stay distinguishable rather than competing for the same surface.
- **The selection bar (`EntrySelectionBar`) renders directly above the list, in `FoodDayView`, and is not
  sticky/floating.** It shows "N selected", the two bulk-action buttons (**`disabled` while N = 0**, so the
  affordance stays discoverable and its own enablement explains the precondition), **"Clear"** (deselect all,
  stay in select mode) and **"Done"** (exit). A sticky/floating bar was rejected: this codebase has no
  sticky-toolbar pattern anywhere, and introducing one for a single feature is the same "new interaction pattern
  for one feature" cost that already ruled out modals (§4, Phase 7 `LogMealDialog`). Accepted tradeoff: on a
  long day the user scrolls back up to act. A day's log is bounded by one day, so this is small — but it is the
  first thing to revisit if it bites.
- **Both bulk actions reuse the existing dialogs.** "Copy selected" opens `CopyGroupDialog` and "Save selected
  as a meal" opens `SaveGroupAsMealDialog`, each rendered under the selection bar and each already driven purely
  by an `entries: FoodEntry[]` prop — neither is actually group-specific today. Their *group-specific wording*
  is parameterized (a `submitLabel` and the two "this group" strings), **with defaults that preserve the
  existing group call site's rendered text byte-for-byte**, so no existing acceptance assertion moves.
  `CopyGroupDialog` additionally **gains the optional time override** described below, which both of its call
  sites (the group header and the selection bar) get identically. Deliberately **not** done: creating
  `CopySelectionDialog`/`SaveSelectionAsMealDialog` twins (two more files to keep in sync forever), and renaming
  the two components (a cosmetic rename that widens the diff of two already-reviewed files for no behavioural
  gain — their doc comments are updated to name both call sites instead). Only one bulk expander is open at a
  time.
- **A successful bulk action clears the selection and exits select mode**, then reports through `FoodDayView`'s
  existing transient `savedMessage` ("Copied 3 entries to …" / `Saved as "…"`). The selection has been spent;
  leaving four boxes ticked invites an accidental second copy, which silently creates duplicate entries and has
  no undo. Accepted tradeoff: copying one selection to two dates means selecting twice.
- **Selection state lives in `FoodDayView`, not in `FoodEntryList` — and this is a correctness requirement, not
  a style preference.** Three things follow from it, each of which is the fix for a specific hazard:
  1. **A background `refresh()` can never destroy it.** `FoodDayView` is never unmounted by a refresh, so
     hoisting the selection (and the selection bar, and the open bulk expander) *above* the
     `!hasLoadedOnce && loading` branch makes survival **structural** rather than dependent on `hasLoadedOnce`
     continuing to hold. `hasLoadedOnce` (Phase 7b) must still be maintained — it is what keeps `FoodEntryList`
     and the checkbox states mounted — but the phase must not rest on it alone. **This repo has now lost time to
     this exact bug class twice (`MealsView` in Phase 7, `FoodEntryList` in Phase 7b); a third occurrence is a
     process failure, not bad luck.** Concretely, a background refresh must never: exit select mode, clear or
     alter the selection, close an open bulk expander, or discard a typed meal name / picked target date.
  2. **Day change clears it, at the one existing choke point.** `handleDayChange` already resets
     `lastConsumedAt`, `editingEntry` and `savedMessage`; the selection and select mode reset there too. Anywhere
     else means a second reset path that is easy to forget, and stale ids from yesterday silently surviving into
     today's bulk action.
  3. **The effective selection is derived by intersecting the stored ids with the currently loaded `entries`.**
     Both bulk actions reject the **whole** request if any id fails to resolve (`entries_not_found` — §3.3, and
     deliberately so), so a single stale id would fail the entire bulk action with a confusing error rather than
     doing the obvious thing. Intersecting at render time (a pure derivation, no Effect, no `setState`-in-Effect
     suppression) means a vanished entry simply drops out of the selection and the count. This is defensive
     rather than a primary path — in select mode the row-level "Delete" is hidden, so the user cannot delete
     their own selected entry from this screen — but it costs one line and converts a confusing whole-request
     failure into a no-op.
- **The bulk expanders must not be nested inside `FoodEntryForm`'s `<form>`.** `SaveGroupAsMealDialog` renders
  its own `<form>`; rendering it from `FoodDayView` keeps it a sibling of `FoodEntryForm`, which is legal — but
  this repo has already lost time to exactly this bug once (Phase 6's `FoodLookupPanel`/`BarcodeScanner`
  nesting), so **confirm it by clicking Save in a real browser, not by reading the JSX.**

**Two Phase 8 feedback fixes, folded into Phase 8b (2026-07-31; qa notes N-3 and N-4).** Both are small,
UI-only, and confined to files Phase 8b already opens, so they ride along here rather than becoming standalone
unscoped polish — and rather than reopening Phase 8's already-reviewed diff.

- **An inline expander's in-flight state must live in a subtree the open flag conditionally renders, so closing
  it genuinely unmounts that state (fixes N-3).** `CopyDayDialog` currently shows a **stale error on reopen**:
  trigger a rejected copy, close the panel, reopen it, and the previous error is still on screen before any new
  action. The cause is structural, not a missing reset — the *collapsed button* is what's conditionally
  rendered, so the component itself never unmounts and its `state`/`toDate`/`pending` survive the toggle.
  `CopyGroupDialog` is immune only because its stateful body *is* the conditionally-rendered part. **Make that
  property deliberate rather than accidental:** extract `CopyDayDialog`'s open-panel body (holding `toDate`,
  `state`, `pending`) into a subtree rendered only while `open`, so each open mounts a fresh one. Reopening
  therefore resets the picked date as well as the error — intended, and consistent with `CopyGroupDialog`: a
  reopened panel is a fresh action, not a half-remembered one. **This is the rule for Phase 8b's new bulk
  expanders too**, so the same defect can't be reintroduced by the selection bar.
  - **Guardrail — this must not fight the refresh-survival requirement above.** The unmount is driven by the
    **user's own open/close toggle and nothing else.** The flag (or key) governing it must never be derived from
    anything a background refresh changes — not `loading`, not a fetch nonce, not `entries.length`, not the
    selection — or the fix reintroduces exactly the state-wiping bug this phase is otherwise guarding against.
    The two requirements are compatible; getting the key wrong is what makes them look like they conflict.
- **"Log again" must say where the entry went when that isn't the day on screen (fixes N-4).** "Log again"
  correctly logs to **today** regardless of which day is being viewed (§2), but from a past day nothing visibly
  changes — no new row appears in the list, and the toast reads only `Logged "X" again.`. When
  `today !== selectedDate`, the toast must name the destination, mirroring the wording `handleCopied` already
  uses for day/group copies (`Copied N entries to <date>.`). Behaviour is unchanged and correct; only the
  feedback changes. Deliberately **not** done: switching the view to today (§4).

**The row being edited is highlighted in `FoodEntryList` (2026-08-01 addition, Phase 8b).** Jeff's sixth
manual-testing finding: nothing in the day's list shows that an edit is in progress, or on which item. Confirmed
by reading the code: `FoodEntryList` receives `onEdit` but **no prop carrying which entry is being edited**, so
today it genuinely cannot know. `FoodDayView` already holds `editingEntry` and already clears it on save, on
cancel and on a day change — so this is a prop plus a style.

- **Pass `editingEntryId: string | null`, not the entry object — and that shape is load-bearing, not a
  preference.** `refresh()` replaces every object in `entries` with a fresh row from the DB while
  `editingEntry` still holds the **pre-refresh snapshot**, so any identity comparison
  (`entry === editingEntry`) would silently stop matching after the first background refresh. Passing the id
  makes `entry.id === editingEntryId` the only expressible comparison, so the bug cannot be written.
- **Treatment: a `border-l-4 border-l-sage-deep` left accent bar plus a small "Editing" label**, with the row's
  **background left unchanged**. Two concrete reasons the row is *not* given a `bg-sage-pale` fill, which is the
  obvious first instinct: (1) this list already renders a **`bg-sage-pale` "From a saved meal" badge**, which
  would become invisible sitting on a sage-pale row; and (2) the row's existing `hover:bg-stone-50/70` would
  fight it. The bar and the label carry the state without touching the surface.
- **Reusing `StatusMessage`'s left-bar vocabulary is deliberate, and the two are differentiated by weight, not
  by inventing a second vocabulary.** In this app the left accent bar now means "this block is called out" —
  which is a standard treatment for *both* callout messages and active/selected list rows, so it is not a
  register mismatch. `StatusMessage` is bar **+ sage-pale fill + icon**; the editing row is **bar only** on its
  normal surface. Same family, lighter weight — honest, because they genuinely are related and genuinely differ
  in kind. Building a separate emphasis language (a ring, an outline) for one row state would invent a pattern
  where one already exists. Contrast checks: `--sage-deep` as a **border** on white is non-text (4.9:1 against a
  3:1 bar), and the "Editing" label is `text-sage-deep` **on white** (4.9:1, clears AA) — never on `--sage-pale`,
  which is the ~4.2:1 trap the token table warns about.
- **The edited row's own action buttons are hidden** ("Log again", "Edit", "Delete") while it is being edited.
  Each is either meaningless or actively confusing there: "Edit" re-targets what is already open, "Delete"
  destroys the row the open form is editing (leaving a form that cannot save), and "Log again" copies the
  *saved* values while unsaved changes sit above. The edit form already owns that entry's actions ("Save
  changes" / "Cancel"). This gives the phase **one consistent rule**: *when a row is in a special state, its
  ordinary actions are suppressed because another surface owns them* — the same rule select mode follows.
  Accepted cost: a small layout shift on that row. **Other rows are untouched** — copying or deleting an
  unrelated entry mid-edit is legitimate and already works (`handleLogAgain` deliberately does not cancel an
  in-progress edit). Group-header actions are untouched too; they act on a whole group, not the edited row.
- **Accessibility: a visible "Editing" text label, and no live region.** The label is the required part — it
  makes the state perceivable without relying on colour (WCAG 1.4.1) and is available to assistive tech as
  ordinary content, which a coloured border alone is not. `aria-current="true"` on the row is a reasonable
  addition. **A `role="status"` announcement is deliberately *not* added**, and the test for that is worth
  stating because this session has added live regions elsewhere: announce when the user did **not** cause the
  change, or could not otherwise know. Here they clicked "Edit" themselves and the form scrolls to them —
  announcing it would be redundant chatter, unlike the filter count or a save confirmation.
- **It does not interact with the existing `scrollIntoView`, and must not add a second one.** That effect
  scrolls the **form** into view (`formRef`, `block: "start"`, mount-only in edit mode), so at the moment of
  clicking "Edit" the highlighted row is typically scrolled *below* the viewport. **The highlight is therefore a
  persistent state marker, not a transition cue** — its value is when the user scrolls back to the list, when
  both are visible on a short day, or when they return after a distraction. That is precisely why the treatment
  is calm rather than a flash or pulse, and why adding a row-targeted `scrollIntoView` is out of scope: two
  competing scroll targets would fight.
- **Refresh survival is structural here, confirmed rather than assumed:** `editingEntry` lives in `FoodDayView`
  and `refresh()` only ever writes `entries`/`totals`/loading flags — it never touches it. So a background
  refresh cannot clear the highlight, provided the id-based comparison above is used. Day change already clears
  `editingEntry` (and so the highlight) via `handleDayChange`.

**Optional time override when copying a group or a selection (2026-08-01 addition, Phase 8b).** Jeff's fourth
manual-testing finding: `CopyGroupDialog` offers only a target *date*, so a copied group always lands at its
original time-of-day. Copying breakfast to eat it at dinnertime means editing every item's time individually
afterwards — there is no bulk way to say "same food, different time". The action already supports it
(`toTime`, §3.3); only the UI is missing.

- **The control is one native `<select>` with a "keep original" sentinel as its first option**, not a checkbox
  that reveals a picker and not a pre-filled time. Its options are the **same 96 quarter-hour values**
  `quarterHourOptions()` already supplies to `FoodEntryForm` and `LogMealDialog` (24-hour `HH:MM` option
  `value`s, zero-padded 12-hour labels), preceded by a **`value=""`** option reading **"Keep original time"**
  (singular) / **"Keep original times"** (plural, when the selection spans more than one distinct source
  instant). `""` maps to "no override" for free — §3.3 confirms the action already normalizes an empty string
  exactly as omitted, so no special-casing is needed on either side.
- **Default is the sentinel, so today's behaviour is the default behaviour.** Nobody who ignores the new control
  gets a different result than before, which is also why no existing Phase 8 copy-group assertion moves.
- **Label it "Copy to time"**, pairing with the existing "Copy to date" — deliberately **not** a bare "Time".
  `FoodEntryForm`'s own time control is already labelled "Time" and lives on the same `/food` page, so a second
  "Time" would make `getByLabel("Time")` ambiguous the moment a copy expander is open (it is used that way in
  `e2e/phase3-acceptance.spec.ts`). A distinct label avoids a strict-mode collision by construction rather than
  relying on scoping in every future test.
- **The grouping consequence is shown, not implied — but only when it can differ.** When the source spans **more
  than one** distinct `consumed_at` *and* an explicit time is chosen, the dialog states that the copies will
  land together, e.g. *"All 5 entries will be copied to 06:30 PM as a single meal group."*; with the sentinel
  chosen it reads *"Each entry keeps its own time of day."* For a single-group copy both modes produce one
  group, so the note is suppressed rather than stating something vacuous.
- **`CopyDayDialog` deliberately does NOT get this control.** Preserving each entry's own time-of-day is the
  entire point of a whole-day copy — the recorded decision is that a day copy "reproduces the day's rhythm". A
  single override there would collapse breakfast, lunch, dinner and every snack onto one instant, producing one
  absurd mega-group; there is no plausible use for it, and it would be a foot-gun on the widest-reaching copy
  control in the app. The user who genuinely wants "some of these, at one time" already has the right tool at
  the right granularity: multi-select the entries and use "Copy selected" with a time. Capability preserved,
  foot-gun declined.
- **The server-side premise this leans on stays true by construction.** `copyFoodEntries` notes that a bad
  `toTime` shape "would be a caller bug, not a real user-facing state" because every caller supplies an
  already-gridded time from its own UI. A `<select>` of 96 fixed values keeps that true for this new caller too
  — it cannot express an off-grid time — exactly the argument that made `FoodEntryForm`'s time control a
  `<select>`.

**Transient success feedback — a left-accent banner, not a pill (2026-07-31 addition, Phase 8b).** Jeff's third
manual-testing finding: the "action succeeded" message "blends in, doesn't catch the user's eye, then
disappears", and the pill shape is wrong for it — **"pills should be used for statuses, not user messages."**
That distinction is the design rule, and applying it correctly required auditing which of the existing pills are
actually messages. **Two of the four are not, and must keep their pill:**

| Site | What it really is | Action |
|---|---|---|
| `FoodDayView`'s `savedMessage` | **Transient message** — "Entry added.", the copy toasts, "Logged … again.", `Saved as "…"`, and 8b's new bulk-action confirmations | **Restyle** |
| `SettingsForm`'s "Settings saved." | **Transient message** (gated on `state.ok`; note it has **no auto-dismiss at all** today — it persists until the next action) | **Restyle** + adopt the shared auto-dismiss |
| `MetricForm`'s "Already logged for this day — saving overwrites it." | **Status.** Gated on `existing`, no timer, describes the state of the data, not the outcome of an action — Jeff's own rule says this *should* be a pill | **Keep as-is** |
| `FoodEntryList`'s "From a saved meal" | **Status** badge on a data row | **Keep as-is** |

- **Correction worth stating plainly, because it changes the scope:** `MetricForm` was described as having a
  saved-confirmation pill. It does not — it has the *status* pill above, and **no success message at all**; a
  successful weight save produces no confirmation, and re-saving a day that already had a value changes nothing
  on screen. That is a real feedback gap, but closing it means *adding* a message rather than restyling one, so
  it is called out as a **small, explicitly-flagged addition** (below) rather than smuggled in under "restyle".

**The treatment** — one shared, conventional alert/banner, reusing the recorded palette with no new tokens:

- **Shape:** a full-width block (`w-full`, replacing `w-fit`), `rounded-lg`, with a **4px solid left accent bar**
  (`border-l-4`) — the standard inline-alert idiom (Bootstrap alerts, GitHub flash messages, Tailwind UI). Not a
  chip, not a card.
- **Colour:** `bg-sage-pale` surface, **`text-ink`** message text, `border-l-sage-deep` accent bar, and a
  decorative check icon in `sage-deep` (`aria-hidden`, since the text carries the meaning).
- **This threads the recorded contrast guardrail rather than ignoring it.** The 2026-07-25 token table warns
  that `--sage-deep` on `--sage-pale` is ~4.2:1 — *"a hair under AA for `text-xs`, so don't use sage-deep for
  small text on this tint."* So sage-deep appears here **only** as the border and the icon, both **non-text**
  elements against the 3:1 threshold, which 4.2:1 clears; all actual text is `--ink` on `--sage-pale` (~13:1).
  `--sage` was available (it is sanctioned as decorative fill) but is too low-contrast against `--sage-pale` to
  read as an accent, so `--sage-deep` is the right pick.
- **Size:** `text-sm` (the app's body scale) and `px-4 py-3`, up from `text-xs`/`px-3 py-1` — the prominence
  complaint is as much about scale as shape.
- **`role="status"`** on the container, so the message is actually announced to screen readers. It is invisible
  to assistive tech today; this is the same live-region gap qa-reviewer already raised against the `/meals`
  filter count (Phase 7c N-3), so it is a known class in this repo, and `role="status"` is the standard fix.
- **Duration: 6 seconds** (from 4). Reasoning rather than "a bit longer": the message must first be *noticed*
  (~2s, since it appears outside the user's focus, which is the actual complaint) and then *read* — the longest
  string here, "Copied 3 entries to 07/29/2026.", is ~6 words, ≈2s at an unhurried pace. 6s covers noticing plus
  reading with margin, while staying short of the ~8–10s point where a stale confirmation starts reading as
  stuck UI beside a form the user has already moved on from.
- **The timer must key off a per-message nonce, not the message string** — a real latent bug in the current
  code, worth fixing while here: `FoodDayView`'s dismiss effect depends on `savedMessage`, so firing the *same*
  message twice in a row (adding two entries → "Entry added." twice) does not change the state value, the effect
  does not re-run, and the second message silently inherits whatever was left of the first one's 4 seconds —
  occasionally vanishing almost instantly. Bump a counter alongside the text, the same idiom `addFormResetNonce`
  already uses in this component.
- **Extract it — `components/ui/StatusMessage.tsx`** (props: the message, an optional `autoDismissMs`, exporting
  a single `SUCCESS_MESSAGE_MS = 6000`). Reasoning in §4; briefly, this change exists to make the treatment
  consistent, and the alternative is shipping a *fourth* hand-copied class string of a pattern that is already
  duplicated three times.
- **Decided (Jeff, 2026-08-01): yes, add it.** `MetricForm` gains a real "Weight saved." message using the new
  `StatusMessage` component, alongside — not replacing — its "Already logged" status pill. Closes the
  no-feedback gap noted above.

**Human-readable date format — `MM/DD/YYYY`, display only (2026-07-31 addition, Phase 8b).** Raised by Jeff
from real manual use: dates render inconsistently, with "save messages" showing raw `2026-07-29`. **The defect
is ISO leaking into prose, not the existence of more than one human format** — that framing is what keeps this
from becoming a blind reformat. `formatDateLabel` (§3.3) is the single helper, applied **only where a date is
rendered as human-readable text**, exactly as `formatTimeLabel` is for times.

**An audit of every date-bearing surface found the affected set is small and precisely bounded** — three sites,
all of them in files Phase 8b already opens:

| Site | Today | Action |
|---|---|---|
| `FoodDayView` `handleCopied` toast | ``Copied 3 entries to 2026-07-29.`` | **Fix** — Jeff's reported case |
| `CopyDayDialog`'s explanatory line | "Copies all 3 entries from **2026-07-29** onto another date…" | **Fix** |
| `FoodDayView`'s "Log again" toast | gains a destination date **in this same phase** (N-4) | **Write it formatted from birth** — do not add it raw and fix it later |

**Deliberately NOT touched, each for a concrete reason** (this half of the audit matters as much as the list
above — blanket-reformatting any of these would introduce a defect, not fix one):

- **The six native `<input type="date">` controls** (`FoodDayView`'s Day picker, `FoodEntryForm`, `MetricForm`,
  `CopyDayDialog`, `CopyGroupDialog`, `LogMealDialog`). Their `value`/`defaultValue`/`max` are ISO **because the
  HTML spec requires it** — that is the submitted wire format, not a display choice — while the browser already
  renders the *visible* text in the user's own locale (`MM/DD/YYYY` on a US profile). **There is nothing to fix
  here and nothing that can be fixed** short of replacing the native control with a custom picker, which this
  project has consistently declined (see the time-`<select>` decisions in §4). Confirmed by audit: this is
  almost certainly *not* what Jeff saw.
- **The chart axis and tooltip labels** (`chartTheme.ts`'s `formatAxisDate` → "Jul 25", `formatTooltipDate` →
  "Jul 25, 2026"). These are **already human-readable and already deliberate** (Phase 5), not ISO — so they are
  not instances of the reported defect. Converting them to `MM/DD/YYYY` would be a **regression**: "07/25/2026"
  is far denser than "Jul 25" in the one place where tick width is the binding constraint, on a chart that may
  show 90 of them. **Flagged as the one judgement call Jeff may want to overrule** — "standardize everywhere"
  read literally would include these; the recommendation is that it shouldn't, because the goal is *no raw ISO
  in prose*, not *one format in every context*.
- **`MetricForm`'s "Already logged for today / this day"** renders no date at all — no change. (Naming the date
  there is a plausible improvement and is deliberately **not** taken: out of scope, not overlooked.)
- **Every ISO date *value*.** `DATE_PATTERN` validation, `localDateNotAfterToday` and the future-day cap,
  `consumed_local_date`/`metric_date`, `toDate`/`logDate`/`metricDate` action inputs, `?range=`, all date
  comparisons and query filters, and every input's `value`/`max`. This is the identical value-contract boundary
  the zero-padded time labels held: **only the rendered string changes; nothing below the render boundary can
  observe it.**

**Autofill / password-manager hygiene — an app-wide markup convention (2026-07-31 addition).** Raised by Jeff
from real manual use: password managers offer to fill and save non-identity fields all over the app (food entry
name/quantity/unit/calories/protein, meal names, weight/body-fat, goal targets, the `/meals` filter, barcode
entry, date pickers) because those controls carry no `autocomplete` hint, leaving the browser to guess from
labels and `name`/`id` — and a field literally labelled **"Name"** is the textbook case a name-autofill heuristic
fires on. The fix is standard HTML attributes, nothing else: **no JS, no custom widget, no library.**

**The convention — two rules, applied to every form in `src/`:**

1. **Default-deny at the `<form>`:** every `<form>` carries `autoComplete="off"`.
2. **Explicit per-control value on every `<input>`, `<select>` and `<textarea>`** — including the ones inside a
   form that already denies, and including numeric, date and search controls. Inheritance alone is not relied on:
   Chrome is documented to weigh form-level `off` less heavily than field-level, and — the reason that matters
   more here — a per-control attribute makes the intent legible **at the field**, and makes the whole convention
   **greppable and therefore enforceable** later (§6). This is the same belt-and-braces posture this codebase
   already applies to the redundant `.eq('user_id')` filters that sit on top of RLS.

**Values by category:**

| Category | Controls | Value |
|---|---|---|
| **Identity — help, don't suppress** | `LoginForm` email | `autoComplete="email"` |
| | `LoginForm` password | `autoComplete="current-password"` |
| | `SignupForm` email | `autoComplete="email"` |
| | `SignupForm` password **and** confirm-password | `autoComplete="new-password"` (both) |
| **Everything else — suppress** | every other `<input>`/`<select>`/`<textarea>` in the app | `autoComplete="off"` |

- **`email`, per Jeff's decision (2026-08-01), not `username`.** Both are spec-valid and both are recognized by
  password managers. `username` was the architect's initial recommendation — it pairs with `current-password`/
  `new-password` slightly more strongly for a manager's sign-in-vs-sign-up form recognition — but Jeff confirmed
  `email` (matching the literal wording of the original finding, and still a fully valid, widely-recognized
  token) is the one to ship. The inputs keep `type="email"`, so nothing about validation or the mobile keyboard
  changes either way.
- **The suppressed set is deliberately uniform**, with no per-field cleverness: one value, everywhere, including
  `type="number"` (calories/protein/quantity/per-unit/weight/body-fat/goal targets) and `type="date"` (the Day
  picker, both copy target-date pickers, the metric date) where a manager is unlikely to fire anyway. A rule
  with exceptions is harder to review and to keep true than a rule without, and the whole value of this
  convention is that a reviewer can check it mechanically.
- **Also covered, so they aren't missed:** the 96-option quarter-hour time `<select>`, `LogMealDialog`'s meal
  `<select>`, `SettingsForm`'s kg/lb radios, `FoodLookupPanel`'s search box, `BarcodeScanner`'s manual-entry box
  (which a heuristic could plausibly mistake for a card number or a one-time code — it must never be left to
  guess), and `MealsView`'s `<input type="search">` filter.
- **One accepted side effect, called out rather than discovered:** `autoComplete="off"` also suppresses the
  browser's own *form-history* dropdown, so the `/meals` filter and the lookup search box stop offering
  previously-typed values. Judged the right trade (both are transient view state, and the filter is
  re-typed in a second), but it is the one place a reader could reasonably land differently.
- **`autoComplete` is a best-effort hint, not an enforcement mechanism** — see §5 for what it cannot promise and
  the evidence-gated escalation path if a specific field still prompts in real use.

**Logging a saved meal straight from the library (2026-08-01 addition, Phase 8c).** Jeff's fifth
manual-testing finding: a meal can only be logged from `/food`, where `LogMealDialog` is scoped to "pick a meal
for the day currently being viewed". From `/meals` — the screen where you are already looking at the meal you
want — there is no way to log it without navigating away and re-finding it in a picker. `logMealForDay` already
does exactly the required work (verified: `(prevState, formData)`, FormData carrying `mealId`/`logDate`/
`logTime`/`logTz`, returning the inserted `entries`), so this is **UI-only**.

- **A "Log this meal" control on each `MealList` card, placed first** in the card's action row, ahead of
  "Manage/Hide items", rename and Delete. Logging is the *point* of a saved meal; the others are maintenance,
  and a card whose most-used action is last has its hierarchy backwards. It keeps `variant="secondary"` like its
  siblings — 40 ink-filled primary buttons down a library page would be heavier than the emphasis is worth.
  (Promoting it to `primary` is a reasonable alternative and is Jeff's call, not a defect either way.)
- **It opens an inline expander under that card** — the same idiom as `SaveGroupAsMealDialog`, `LogMealDialog`,
  `CopyGroupDialog` and `FoodLookupPanel`; still no modal anywhere in this codebase. **Only one open at a time
  across the list**, the same mutual-exclusion rule `FoodEntryList` uses for its group actions.
- **Reuse `LogMealDialog` with an optional fixed-meal mode** (a `meal?: Meal` prop): when supplied it skips its
  own meals fetch and its picker, renders the meal's name as static text, and submits that `mealId`. This keeps
  **one** implementation of the date/time fields, the `logMealForDay` error-code→message mapping, the cap wiring
  and the tz handling — the same "don't ship a second hand-copied copy" reasoning that decided `StatusMessage`.
  Its file name and its `/food` behaviour are unchanged (no rename — same diff-hygiene call made for
  `CopyGroupDialog`); only its doc comment gains the second mode.
- **Contents: date + time, both required, defaulting to now.** `<input type="date" max={today}>` defaulting to
  **today**, and the **same 96-option `quarterHourOptions()` `<select>`** defaulting to the **floor** of the
  current quarter-hour — identical to `LogMealDialog`'s existing behaviour on `/food`, and flooring for the
  recorded reason (never a future bucket, so it composes with the no-future-day cap).
- **Consistent with the Phase 8b copy-time control where they genuinely overlap, and deliberately not where they
  don't.** Both use the *same* control type and the *same* 96-value option set — that is the shared vocabulary.
  But Phase 8b's control is an **optional override** over an existing time, so it carries a "Keep original
  time" sentinel; this one is a **required** time for an event that has none yet, so a "keep original" option
  would be meaningless (a saved meal has no `consumed_at` — see `MealItemForm`, which has no time field at all).
  Forcing one affordance onto both would make one of them nonsense; sharing the option set and the control type
  is the real consistency.
- **No smart same-sitting default here.** `lastConsumedAt` is `/food`'s day-scoped state and does not exist on
  `/meals`; logging from the library is a deliberate one-off, not "adding items in one sitting". Always
  floor-of-now. Stated because a reader who knows §3.4's smart-default rule would reasonably expect it to apply.
- **`/meals` gains a browser-timezone dependency for the first time** — it has never needed "today", because
  meals carry no dates. `today`/`tz` must therefore be resolved in a **mount-only Effect** with an identical
  placeholder on the server pass and the client's first pass, exactly as `MetricForm`/`FoodDayView`/`TrendsView`
  already do. This is the hydration-mismatch class this repo has already been bitten by; it is called out
  because `/meals` is the one data screen whose developer has never had to think about it.
- **On success: a `StatusMessage` (Phase 8b), no refetch, no state disturbed.** The confirmation names what
  happened using the same formatters as everywhere else — e.g. `Logged "Weekday breakfast" to 08/01/2026 at
  07:30 AM.` (`formatDateLabel` + `formatTimeLabel`). **Nothing on `/meals` is refetched**: this writes
  `food_entries`, while the screen renders `meals`/`meal_items` — the same "nothing here changed" reasoning as
  Phase 7b's save-as-meal. Critically, success must **not** clear the `/meals` filter query, collapse cards, or
  remount `MealList` — the state-preservation lesson this screen has already been burned by twice.

**Finding a meal in a growing saved-meals library (2026-07-30 addition, Phase 7c).** Both surfaces that list
saved meals — `/meals` (`MealsView` → `MealList`) and the `LogMealDialog` picker on `/food` — currently fetch
and render **every** saved meal with no filter, no ordering by anything a human would predict (`created_at`
ascending, i.e. oldest first), and no count. Nothing breaks at 5 meals; at 40 both become hard to scan, and the
picker's oldest-first order actively buries the meals most recently added. **The problem is findability, not
data volume** — see §4 for why that distinction decides the whole design — so the fix is ordering + filtering
over the rows already in memory, not pagination.

- **One shared ordering, alphabetical by name, for both surfaces.** `sortMealsByName` (§3.3) is the single
  authoritative order, applied client-side so `/meals` and the picker cannot disagree and so the result is
  independent of the database's collation. The Supabase queries also change their `.order("created_at")` to
  `.order("name")` — belt-and-suspenders (a deterministic base order from the DB, the same posture as the
  redundant `.eq('user_id')` filters elsewhere in this codebase), with the pure function remaining the
  authority. Ties (duplicate names are legitimate, §5) break on `created_at` then `id`, mirroring
  `mealItemsFromEntries`.
- **`/meals` gains a filter box, owned by `MealsView`.** A single `<input type="search">` ("Filter meals") with
  a real `<label>` (`labelClass`), held in `MealsView` local state — it is transient view state on a client
  orchestrator, deliberately **not** a URL param (unlike `/trends`' `?range=`, which is a server-rendered,
  shareable view). `MealsView` applies `filterMealsByName` and passes the **already-filtered, already-sorted**
  array to `MealList`, which stays a renderer of what it is given. Typing **never refetches** — it filters rows
  already in memory, so there is no debounce, no loading state, and no new network path.
- **The two empty states must stay distinguishable.** `MealList`'s existing "No saved meals yet. Create one
  above to get started." must fire **only** when the user genuinely has zero meals. When `meals.length > 0` but
  the filter matches nothing, `MealsView` renders its own distinct message (e.g. `No meals match "chick".`)
  and does not render `MealList` at all. Showing the create-your-first-meal copy to someone with 40 meals and a
  typo'd filter would be actively misleading.
- **A count readout for orientation**, in `MealsView` beside the filter: the total ("40 saved meals") when no
  filter is active, and "Showing 3 of 40" when one is. This is the cheapest possible answer to Jeff's actual
  question ("could this get out of control?") — it makes the size of the library visible instead of implied by
  scroll length.
- **The filter box is hidden when `meals.length === 0`** (nothing to filter). No other threshold: the control
  does not appear/disappear at some magic library size, because a UI that behaves differently at 9 items than
  at 10 is a surprise, not a feature.
- **`LogMealDialog`'s picker stays a plain native `<select>`** — no combobox, no filter box, no custom widget
  (§4). It gains only the shared alphabetical order. **Implementation invariant: the meal name must remain the
  FIRST text in each option's label**, before the `(450 kcal, 3 items)` parenthetical, because native `<select>`
  type-ahead prefix-matches the option's rendered text — that name-first shape plus alphabetical order is what
  makes typing "c" jump to the chicken meals. This is the same lesson the zero-padded time labels taught: for a
  `<select>`, the label *text* is a functional contract, not decoration.
- **Not changed here:** the two-flat-queries + `groupMealItemsByMeal` read strategy (Phase 7's recorded choice);
  `LogMealDialog` still fetches items only while open, and still only to render the kcal/item-count in each
  label. That items query is the heavier of the two and is the first thing to trim if load time ever becomes
  perceptible — noted, not pre-emptively done.

**`DailyTotals`** shows the day's total calories/protein and the **day-level protein %** using the same
ratio-of-sums function on the day's summed totals (from `daily_food_totals`). The dashboard shows the same
for today.

Other components unchanged: `CopyDayDialog`, `LogMealDialog` (its date/time picker is likewise a
`date max=today` + the same 96-value quarter-hour time `<select>`; its *meal* picker gains only the shared
alphabetical order — see the Phase 7c block above), `MealList`/`MealForm` (`MealList` receives an
already-filtered, already-sorted array; the filter itself lives in `MealsView`), `MealItemForm`
(fields always visible — and note it has **no** time field at all: saved-meal items carry no `consumed_at`;
time-of-day is chosen only at log time in `LogMealDialog`, so this control change doesn't touch it),
`MetricForm` (date max=today, no time field, sends `metricTz`), `SettingsForm`, `RangeSelector`,
`WeightChart`/`IntakeChart`. The `(app)` nav has a **"Log out"** control (the only session terminator).
Installability via `app/manifest.ts` (+ icons), `display:'standalone'`, **no service worker**.

**State:** server state is Supabase; client state is in-flight form values (incl. expander state,
`lastConsumedAt` for the smart default, quantity/unit, picked candidate, the open save-as-meal expander + its
in-flight name, the `/meals` filter query, and — Phase 8b — select mode plus the multi-select id set, both owned
by `FoodDayView` for the reasons in the multi-select block above), optimistic updates, chart range (URL),
display-unit prop. No global store.

## 4. Alternatives Considered

- **Time-of-day input: 15-minute grid via a native `<select>` of 96 values, floor-to-past default (chosen)**
  vs. round-to-nearest, free-second entry, a native `<input type="time" step="900">`, or a custom time picker.
  **Floor, not round-to-nearest**, because rounding up could land on a quarter-hour bucket *later* than the
  current time — a not-yet-happened instant that the no-future-day cap would (correctly) reject, spuriously
  blocking the default; flooring can only ever produce an at-or-before bucket, so it composes cleanly with the
  cap. **Native `<select>` of the 96 quarter-hour values (`"12:00 AM"`…`"11:45 PM"`, `value`s in 24-hour
  `HH:MM`)** over both a bespoke picker *and* the native time input: it's standard HTML with built-in keyboard
  entry, type-ahead, and screen-reader accessibility for zero custom code — matching the project's
  prefer-conventional bias — and collapses time selection to **one interaction**. This replaced an earlier
  `<input type="time" step="900">`: `step` constrains valid *values* but browsers still *render* that widget as
  three independently-set hour/minute/AM-PM segments regardless of `step`, so it enforced the grid but never
  delivered the fewer-interactions friction win the coarse grid was chosen for (confirmed by hands-on use, not
  a QA gap — see `ai-context/DECISIONS.md`). A `<select>`'s fixed option set also **constrains manual edits to
  the grid by construction** (it can't express an off-grid value) — with one edit-path caveat: an off-grid
  stored time must be injected as an extra selected option when editing so it isn't silently rewritten. The
  option `value` stays 24-hour `HH:MM`, so nothing below the form boundary (validation, `localInputToUtcInTz`,
  grouping, the cap) changes — the switch is presentation-only. **Bonus:** snapping default and manual edits to
  the grid makes near-miss timestamps from one sitting coincide, reinforcing the exact-`consumed_at` meal
  grouping. The grid is a UI affordance only (not a DB constraint), so it never rejects data and doesn't touch
  storage precision.
- **Meal grouping: exact-timestamp match (chosen) vs. a time-gap heuristic (rejected).** An earlier revision
  grouped entries by a >90-minute gap. Jeff rejected it: a user who eats every 30 minutes for 3 hours has no
  natural 90-minute chunk boundary — the heuristic would split or merge arbitrarily and unpredictably.
  **Exact-match** (`groupByConsumedAt`) is fully deterministic, parameter-free, and easy to reason about: two
  entries are "the same meal" iff they carry the identical `consumed_at`. The **smart time default + 15-min
  grid** (3.4) make this ergonomic for free — items logged in one sitting inherit the same gridded timestamp —
  while `logMealForDay` already shares one timestamp per batch. Tradeoff (accepted): if the user manually
  changes one item's time, it forms its own group; that's a faithful reflection of what they entered.
- **Save-a-group-as-a-meal: one `createMealFromEntries(entryIds, name)` server action (chosen) vs. composing
  `createMeal` + N `addMealItem` calls client-side (rejected) vs. a Postgres RPC (rejected — settled by Jeff,
  2026-07-30).** Client-side composition was rejected on three counts, any one of which is disqualifying: it makes
  N+1 round trips; it is *maximally* non-atomic (each item is its own request, so a mid-loop failure or a
  closed tab leaves a visibly half-built meal); and it would have the browser hand the nutrition values back
  to the server, when the whole point is that the server re-reads them from rows it can verify the caller owns.
  It would also inherit `addMealItem`'s per-call `max(sort_order)` read — an N-times-repeated race
  (qa-reviewer's Phase 7 N-3) to assign an ordering the source group already determines. A **Postgres
  function** (`create_meal_from_entries`, `SECURITY INVOKER` so RLS still applies) would be genuinely atomic in
  one statement and is the honest "most correct" answer — **Jeff considered it and rejected it (2026-07-30)**
  because it needs a migration (new architect-owned schema surface) and would be the codebase's **first and
  only RPC**, against a project bias toward the pattern already proven elsewhere; and because the failure it
  prevents degrades to a benign, self-evident, one-click-deletable empty meal (§3.3), not to data loss or a
  corrupt row. **The compensating delete is the decided approach, not a placeholder for a later RPC.** Noting
  for the record only: were that judgment ever revisited, the swap changes the action's internals, not its
  signature — so nothing else in this design is betting on it.
- **Name prompted *before* the copy, and the field starts blank (both chosen; blank settled by Jeff
  2026-07-30).** Prompting first means a cancel writes **zero rows**, and one submit = one action call = the
  atomicity story above. Create-then-rename would need either a placeholder name (abandonable "Untitled meal"
  rows accumulating in `/meals`) or a nullable `meals.name` — a schema change to make a worse UX possible.
  For the field's initial value, **blank** was chosen over prefilling the group's first item name, over
  concatenating every item name, and over a time-of-day-derived suggestion. Concatenation is unreadable past
  two items. A time-derived name ("Breakfast"/"Lunch"/"Dinner") is rejected twice over: meal *categories* are
  explicitly out of scope, and it would need exactly the arbitrary hour-boundary heuristic Jeff already
  rejected for grouping. First-item-name prefill was the initial recommendation and was **overruled**: on any
  multi-item group it is actively wrong ("Eggs" for eggs+toast+coffee), and a prefilled field is the one a user
  accepts without reading — so the failure mode isn't "no name", it's a *library full of confidently mislabelled
  meals*, which is worse and only discovered later. A saved meal is a long-lived object picked from a list
  months after it was created, so unlike the everyday food-entry path (where prefills and smart defaults are
  exactly right, and remain so) its name is worth one deliberate keystroke sequence. Accepted tradeoff: two or
  three extra seconds on a save that is itself far rarer than logging — and this is a *net* keystroke saving
  regardless, since the alternative to the whole feature is retyping every item by hand in `/meals`.
- **Saved-meals list scaling: client-side sort + filter over a fully-fetched list (chosen) vs. server-side
  search/pagination (rejected) vs. a hard cap (rejected) vs. a combobox picker (rejected).** The question Jeff
  actually asked — "is there any limit to the number of meals we display? That could get out of control" — has
  two possible readings, and they have different answers. **As a data-volume question it is a non-problem, and
  saying so plainly is most of the design.** Saved meals are created one at a time by hand (in `/meals`, or one
  per "Save as meal" click); there is no import, no sync, no automatic creation path, so there is no runaway
  mechanism at all. A `meals` row is ~100 bytes; a realistic heavy user reaching 200 meals × ~5 items is on the
  order of 1000 `meal_items` rows / low hundreds of KB — well inside what one browser fetch and one flat render
  handle without noticing, and returned by an already-indexed `user_id` lookup. **As a findability question it
  is real today**, at a library size Jeff can reach this year: an unsorted-by-anything-meaningful, unfiltered,
  uncounted list of 40 meals is genuinely hard to use, and `created_at ascending` is the worst available order
  (the meals you just made are furthest from the top). So the fix targets findability — ordering, a filter, and
  a count — and deliberately does **not** touch the fetch strategy, because the fetch is not what hurts.
  - **Server-side search/pagination was rejected on cost, not on principle.** It would introduce the first
    pagination pattern anywhere in this codebase (every other screen — `/food`, `/metrics`, `/trends` — fetches
    a bounded window and renders it whole), and it interacts badly with the existing two-flat-queries read:
    each meal card's totals come from `sumEntries(items)`, so paginating `meals` forces a matching paginated
    `meal_items` fetch keyed to the visible page, plus refetch-on-page-change, plus a stale-response guard —
    real machinery, coordinated across two surfaces, to make a tens-of-rows query faster than it already is.
    Server-side `ILIKE '%…%'` search additionally wants a `pg_trgm` GIN index to avoid a sequential scan, i.e.
    a new extension and an architect-owned migration, to accelerate a scan over tens of rows. This is the
    "infrastructure this app doesn't otherwise have" case, and it is the one to say no to.
  - **A hard cap (or a silent `.limit()`) was rejected outright.** There is no runaway path to defend against
    (above), and the failure mode is severe and silent: a meal the user deliberately saved simply would not
    appear in their own library, with no indication why. A *visible* count (§3.4) gives Jeff the awareness he
    was actually asking for without ever hiding data. Note this is a different question from Phase 7b's
    unbounded `entryIds` note (qa N-2) — that is an untrusted, client-supplied list in a single request; this
    is the user's own row count accumulated over years.
  - **The `LogMealDialog` picker stays a native `<select>`; a searchable combobox was rejected.** This is
    settled by direct precedent rather than fresh judgment: the 2026-07-25/26 time-picker decisions chose a
    plain native `<select>` of **96** options over a custom combobox, explicitly because a combobox "violates
    the conventional-default bias and adds JS/accessibility surface for no benefit over `<select>` at this
    option count." A saved-meals library will be well under 96 for a long time, on a *less* frequently used
    control than the everyday time picker, so building a combobox here would contradict a decision this project
    made about a harder version of the same problem three days earlier. Native `<select>` also brings
    type-ahead, keyboard navigation, and platform pickers on mobile for free — and alphabetical ordering plus
    name-first labels (§3.4) is what turns that built-in type-ahead from useless into the actual search feature.
    A second filter box above the picker was also rejected, as a second control on the fast logging path for
    something type-ahead already does.
  - **Filtering on meal *name* only (chosen) vs. also matching item names (deferred).** Matching item names
    ("chicken" finding a meal called "Tuesday dinner") is genuinely useful and the items are already in memory
    — but a match with no visible cause needs a "matched on: chicken" affordance to not read as a bug, which is
    more UI than this problem warrants right now. Deferred deliberately, not overlooked.
  - **Also rejected: fuzzy/typo-tolerant matching** (a scoring library for a list of tens is unjustifiable) and
    **URL-persisted filter state** (transient view state on a client orchestrator; `/trends`' `?range=` is in
    the URL because it is a server-rendered, shareable view — this is not).
- **Multi-select: an explicit "Select entries" mode (chosen) vs. always-visible checkboxes (rejected) vs. no
  multi-select at all (rejected — but only after Phase 8 shipped without it).** Phase 8 deliberately shipped its
  three implicit-scope copy mechanisms without multi-select, which was correct sequencing: it proved
  `copyFoodEntries` and its ownership/cap invariants against three callers whose id lists the UI derives
  automatically, before adding a caller whose id list the *user* composes. Phase 8b is that caller. **Always-on
  checkboxes** were rejected on two counts. First, density: an entry row already carries "Log again", "Edit" and
  "Delete", and a group header "Save as meal" and "Copy this group" — a permanent checkbox makes it five
  affordances per row on a phone, on the app's most-used screen, in service of a rare action. Second, and more
  importantly, ambiguity: with checkboxes always present, "Copy this group" and "Copy selected" are both live at
  once, and the answer to "what is about to be copied?" depends on invisible state. This project has already
  raised the same class of ambiguity twice as a non-blocking note (two buttons labelled "Cancel" in one group —
  Phase 7b N-3, recurring as Phase 8 N-5); designing a third instance in deliberately would be careless. An
  explicit mode makes the list do exactly one thing at a time. **A per-group "select all in this group"
  checkbox** was also rejected: it needs indeterminate-state semantics and duplicates "Copy this group"
  outright. **A day-level "Select all"** was rejected as redundant with "Copy this day" for the copy case, and
  as a strange thing to want for the save case — an easy follow-on if Jeff misses it, but not worth the button
  now. The checkbox itself is a **plain native `<input type="checkbox">`**, on the same reasoning that chose a
  96-option native `<select>` over a combobox: standard HTML, free keyboard/screen-reader behaviour, no custom
  JS.
- **Bundling "Save selected as a meal" into Phase 8b (chosen) vs. scoping 8b to "Copy selected" alone and
  deferring the save (rejected).** The default instinct here — one phase, one feature — is the one this project
  has correctly followed twice (7b split from 7, 7c split from 8). It does **not** apply here, and the
  difference is worth stating because the surface reasoning looks identical. 7b and 7c were split out because
  each was *independently valuable*, *independently shippable*, and touched *different files* (7c and 8 share no
  files at all — that sentence is in §8 Phase 7c). Neither is true of "Save selected as a meal": it is not
  shippable without the selection UI, and it touches the identical three files ( `FoodEntryList`, `FoodDayView`,
  the selection bar). Splitting it would mean a second phase that re-opens the same files, re-derives the same
  selection-state invariants (survives-refresh, cleared-on-day-change, pruned-against-loaded-entries), and buys a
  second full qa cycle over one interaction surface — **two reviews of one thing, which is the expensive outcome,
  not the safe one.** The marginal implementation cost of the second action is also genuinely near-zero and
  *structural*, not merely small: `SaveGroupAsMealDialog` is already driven by an `entries: FoodEntry[]` prop,
  and `createMealFromEntries` already accepts an arbitrary id list and already documents that it does not
  require a shared `consumed_at` — §3.3 says so explicitly, written in Phase 7b *in anticipation of this*. So the
  phase adds **no action-layer code** for either bulk action; the only genuinely new thing being designed and
  tested is the selection, exercised through two already-hardened pipes. qa scope stays coherent because both
  bulk actions have the same shape ("hand the current selection's ids to an already-reviewed action"); they
  differ only in which table is written, and each already has a full ownership/rejection test block in §6 to
  carry forward. **Accepted risk:** a slightly larger phase than 8b would otherwise be. Mitigated by the phase
  containing no new business logic at all.
- **Stale-expander state (qa N-3): unmount the panel on close (chosen) vs. resetting its fields in the toggle
  handler (rejected).** Both fix the reported `CopyDayDialog` bug. Resetting in the handler is one line today,
  but it requires *enumerating* the state to clear (`state`, `pending`, and the question of whether `toDate`
  counts), and it silently rots the moment anyone adds a fourth field — the classic forgot-one bug, which is how
  this defect would come back wearing a different hat. Unmounting resets everything by construction, with
  nothing to enumerate. It is also the **structurally consistent** choice: `CopyGroupDialog` and
  `SaveGroupAsMealDialog` already behave correctly *because* their stateful bodies are the conditionally-rendered
  part, so this makes `CopyDayDialog` match a property the other two already have rather than adding a
  bespoke reset to the odd one out. Note this is **not** the same situation as `SettingsForm`'s recorded
  remount-on-key decision: that one needed a remount because React resets the native `<form>` after a form
  Action settles, desyncing a *controlled* radio outside reconciliation. `CopyDayDialog` isn't
  `useActionState`-driven, so a manual reset *would* work here — it's rejected on maintainability, not on
  correctness, and saying so keeps the two cases from being conflated later. **Accepted tradeoff:** a picked
  target date is also discarded on reopen; judged correct (a reopened panel is a fresh action) and consistent
  with the sibling dialog. **The one real hazard is the interaction with Phase 8b's refresh-survival
  requirement** — an unmount keyed off anything a background refresh touches would reintroduce the state-wiping
  bug this phase exists to prevent; §3.4 states the guardrail explicitly rather than leaving a developer to
  discover the tension.
- **"Log again" from a past day: name the destination in the toast (chosen) vs. switching the view to today
  (rejected) vs. leaving it (rejected — it's qa N-4).** The behaviour is already correct per §2 ("re-logs that
  exact entry to now"), so the only defect is that from a past day the user gets no confirmation of *where* it
  went — nothing appears in the visible list, and the toast doesn't say. **Navigating the view to today was
  rejected**: the user is deliberately browsing a past day (reviewing or copying from it), and yanking the view
  away mid-review to show a result they didn't ask to look at is a worse trade than one extra clause of text. It
  would also make "Log again" the only action in the app that moves the user, which is a surprise. Naming the
  destination costs one conditional and reuses wording `handleCopied` already established, so the two copy
  flows read consistently.
- **Editing-row highlight: a left accent bar + "Editing" label, no surface fill (chosen) vs. a `bg-sage-pale`
  row tint (rejected on a concrete collision) vs. a ring/outline (rejected as an invented vocabulary).** The
  row-tint instinct is the natural first answer and breaks something specific: `FoodEntryList` already renders a
  **`bg-sage-pale` "From a saved meal" badge**, which would disappear into a sage-pale row, and the row's
  existing `hover:bg-stone-50/70` would fight the fill. Leaving the surface alone avoids both. A **ring or
  outline** would work visually but invents a second emphasis language for one state when this phase is already
  introducing the left accent bar via `StatusMessage`; **reusing that bar is the consistent choice, and the
  register objection does not hold** — a left bar is the standard treatment for active/selected list rows just as
  much as for callouts. The two are differentiated by *weight* (message = bar + fill + icon; editing row = bar
  only), which is honest, since they are related in meaning and different in kind. The **"Editing" label** is not
  decoration: it is what makes the state non-colour-dependent and available to assistive tech.
- **Suppressing the edited row's actions (chosen) vs. leaving or disabling them (rejected).** On the row being
  edited, "Edit" re-targets what is already open, "Delete" destroys the row the open form is editing (leaving a
  form that cannot save — a real dead end, not a cosmetic one), and "Log again" silently copies the *saved*
  values while unsaved changes sit in the form above. **Disabled** buttons were rejected as the usual
  unexplained-dead-control problem. Hiding them states the truth: that entry's actions have moved into the form.
  It also lets this phase carry **one rule** rather than two — *a row in a special state suppresses its ordinary
  actions* — which is exactly what select mode does, so the two features reinforce each other instead of each
  being a special case.
- **Editing and select mode may co-exist; entering select mode does not cancel an in-progress edit.** Cancelling
  would discard the user's typed changes without asking, which is a far worse outcome than a brief overlap; and
  blocking the "Select entries" button while editing adds a disabled control with a rule to explain. So both
  states can be on screen: the edited row shows its bar and label, and every row (including that one) shows a
  checkbox. This is workable **only because the two treatments were chosen not to collide** — a checked row has
  no tint and the edited row has no fill (§3.4). Selecting the row you are editing and copying it is harmless:
  the action re-reads from the DB, so it copies saved values, the same benign staleness "Log again" already has.
- **This ships in the same commit as the multi-select work, not its own.** Elsewhere this session a commit
  boundary earned its place because the work was *independent* (a restyle reaching other phases' files; an
  app-wide markup sweep). Here it is *coupled*: both changes add a per-row visual state to the same list and both
  suppress per-row actions, so they had to be designed against each other — can they co-occur, do their
  treatments collide, do they share one rule? Splitting them into two commits would mean reviewing two halves of
  a single interaction rule separately, which is the opposite of what commit separation is for. Same principle as
  the other calls, applied to a case where the answer comes out the other way.
- **Copy time override: a "keep original" sentinel option inside the time `<select>` (chosen) vs. a checkbox
  that reveals a picker (rejected) vs. a `<select>` pre-filled with the group's own current time (rejected — it
  is a trap in the bulk case).** The **pre-filled** variant is the one that looks most natural and is actually
  wrong: a multi-group selection has **no single "current time"** to pre-fill, so any concrete default would
  silently collapse every selected group onto it — changing today's behaviour by default, and making a real
  data-shaping decision the user never made. It also makes "keep the original" and "explicitly set the same
  value" indistinguishable, which is harmless for one group and meaningless for several. That one control is
  shared between the group header and the selection bar is what decides this. A **checkbox + revealed picker**
  is a legitimate, conventional pattern this app already uses elsewhere (the "add detail" expander), but here it
  is two controls and two pieces of state where one suffices, and the checkbox label has to explain in prose
  what an option label can simply *be*. The **sentinel option** keeps it to a single native control, makes the
  default readable as text without any interaction ("Keep original time" is visible, not implied by an unticked
  box), pluralizes cleanly for the bulk case, and maps onto the action's existing `""`-means-omitted
  normalization with no glue. Consistent with every other time control in the app being a plain `<select>` of
  the same 96 values.
- **Collapsing a multi-group selection onto one time is a feature, and is made visible (chosen) vs. blocking or
  warning about it (rejected).** When several groups are copied with an explicit time, they become one group on
  the target day. That is the *only* coherent reading of "put these at 6:30 PM", and it is not a novel outcome
  in this app — `logMealForDay` already stamps one shared `consumed_at` across a batch, so "several items on one
  instant = one meal group" is established, understood behaviour. It also composes with the selection feature's
  other action: assembling items from across a day and landing them together is exactly meal-shaped. So it is
  allowed, and the cost is paid in *disclosure* rather than in restriction — a one-line note when (and only
  when) the source actually spans more than one instant. Blocking it would remove the feature's most useful
  case; warning about it unconditionally would nag on the common single-group copy where the two modes are
  identical.
- **Transient success feedback: an inline left-accent banner (chosen) vs. a floating toast (rejected) vs.
  keeping the pill (rejected — it is the reported defect).** A **floating/fixed-position toast** is the other
  conventional answer and would certainly catch the eye, but it introduces fixed positioning, stacking and
  dismissal mechanics this codebase has nowhere — and it would directly contradict two calls made in this very
  phase: no modal (no focus-trap/dismiss semantics for one feature) and a deliberately **non-sticky** selection
  bar. Adding a floating layer while refusing a sticky bar would be incoherent. An **inline banner** gets the
  prominence from scale, a left accent bar and an icon, with **zero new layout mechanics** — the conventional,
  boring answer this project's bias points at. **Keeping the pill** was rejected on Jeff's own rule, which is a
  sound one: a pill is a *status affordance* (a compact label attached to a thing, like "From a saved meal"),
  and reusing that vocabulary for a transient event message makes the message read as a label and disappear
  unnoticed — exactly the reported symptom.
- **This explicitly reverses part of a recorded decision, and the reversal is narrower than it looks.** The
  2026-07-25 "Visual identity" entry called `SettingsForm`'s `bg-sage-pale`/`text-ink` pill *"a deliberate
  on-brand success confirmation, not a blind green swap"* — i.e. it was a real call, not an unstyled
  placeholder, and this change overrules it. **What is reversed is the *shape*; the *colour* call stands and is
  reused unchanged** (sage-pale surface, ink text — the new banner is the same palette in a different
  container). Worth noting *why* the original looks wrong now without it having been careless: that decision was
  made mid-rollout, where the live question was "which green replaces `emerald-50/emerald-700`" — the **pill
  shape was inherited from the pre-existing emerald pill and never independently chosen**, so it was never
  weighed against "is a pill the right vocabulary for a message at all?", which is precisely the question Jeff
  is now answering. All of that entry's usage guardrails still bind and were checked, not assumed: no sage-deep
  text on sage-pale, no `--sage` as text, ink on sage-pale for anything that must be legible (§3.4).
- **Extracting `components/ui/StatusMessage.tsx` now (chosen) vs. leaving three copies as future cleanup
  (rejected).** The counter-argument — "don't grow a visual fix into a refactor" — is the right instinct in
  general and is wrong here for a specific reason: **the entire purpose of this change is consistency**, and the
  identical class string is already hand-copied in three places with a fourth arriving in this same phase.
  Leaving it duplicated would ship a *longer* copied string than before and guarantee drift at the next tweak —
  the fix would decay for the same reason the original inconsistency arose. `components/ui/` already exists as
  this project's one-source-of-truth layer (the recorded visual-identity structure decision says components
  consume shared primitives rather than re-specifying styles), so this is *using* the established pattern, not
  inventing a refactor. The component stays deliberately small — presentation, `role="status"`, and an **opt-in**
  `autoDismissMs` — so the caller keeps control of lifecycle, and one exported `SUCCESS_MESSAGE_MS` means the
  duration is a single number rather than three magic literals.
- **Date display: a pure string reorder in `formatDateLabel` (chosen) vs. `new Date(iso).toLocaleDateString()`
  (rejected — it is an off-by-one bug, not merely a heavier option) vs. `Intl.DateTimeFormat` with an explicit
  UTC timezone (rejected, narrowly).** The obvious one-liner is actively wrong here: `new Date("2026-07-29")`
  parses per spec as **UTC midnight**, so `toLocaleDateString()` in any negative-offset zone renders
  **07/28/2026** — the previous day. That is not hypothetical for this codebase; `chartTheme.ts` already carries
  a `parseCalendarDate` helper written specifically to defend against it, so the trap is documented in-repo and
  would be walked into a second time. `Intl.DateTimeFormat(..., { timeZone: "UTC" })` fixes the off-by-one and
  is what the charts correctly use — but for a fixed `MM/DD/YYYY` target it buys nothing over splitting the
  string on `-` and reordering three known-good parts, while adding a locale/ICU dependency to a function whose
  entire contract is "always this one format". A pure reorder **cannot** have a timezone bug, needs no injected
  clock, and is trivially unit-testable — the same reasoning that made `formatTimeLabel` a plain string
  transform. Malformed input returns unchanged rather than throwing or rendering `NaN/NaN/NaN`.
- **Date formatting folds into Phase 8b's own diff (chosen) vs. a cross-cutting pass like the autofill sweep
  (rejected) — and the audit, not the instinct, is what decided it.** Both findings arrived framed as "probably
  app-wide", and it was reasonable to expect the same answer for both. It isn't. **Autofill genuinely touches
  every form in the app**, i.e. six already-approved phases' files that 8b never opens — hence the separate
  pass. **Date formatting touches three sites, and all three are in files 8b already opens**: `FoodDayView`
  (8b's core file) and `CopyDayDialog` (already opened by 8b for the N-3 fix), plus the "Log again" toast that
  **this very phase is creating** under N-4. Zero files outside 8b's existing set are touched, so the criterion
  that pushed autofill out simply isn't met. Splitting it would also produce an odd artefact: 8b would add a
  destination-date toast in raw ISO and a sibling change would immediately reformat it — writing it formatted
  from birth is strictly better. **This is why the audit came before the scoping call rather than after it:**
  the honest answer changed once the actual blast radius was known, and "it sounds app-wide" would have given
  the wrong structure.
- **Logging from `/meals` is feature-sized and gets its own phase (chosen) vs. folding it into 8b (rejected).**
  This is the one of Jeff's five findings that is **not** a fix, a restyle or a missing control on something 8b
  already touches — it is a **new capability on a screen 8b never opens**, with its own trigger, its own inline
  expander, its own success state, its own future-day-cap exposure and its own acceptance rows. The project's
  own rule is that feature-sized work — "new modules… anything touching multiple parts of the system… when in
  doubt, it's a feature" — goes through its own architect→developer→qa loop. The precedent is right here in §8:
  **Phase 7c was split out for less than this** ("small — one pure module, a filter box and a changed
  `.order()` — but not trivial: it changes what a user sees on two screens and adds a control with its own
  empty-state semantics"). It is also the exact mirror of the case where I *rejected* splitting: "Save selected
  as a meal" stays inside 8b because it is **not independently shippable** and shares 8b's exact files; this is
  independently shippable and shares **none** of them. Folding it in would blur 8b's qa scope across two
  unrelated features — the same sentence §8 Phase 7c uses about itself — onto a checkpoint already carrying
  multi-select, two bulk actions, N-3, N-4, a date-format change and a success-message restyle. **Recommended as
  Phase 8c, running immediately after 8b**, which is also a genuine technical dependency and not a manufactured
  one: its success toast uses the `StatusMessage` primitive 8b introduces, so doing it first would mean
  duplicating that component. **Jeff can overrule this** — if he wants it inside 8b it should at minimum be its
  own commit with its own §6 block, exactly like the success-message restyle.
- **The scoping rule behind all six findings, stated once so the calls are auditable rather than ad-hoc.**
  Jeff's six manual-testing findings all arrived with the same question attached ("fold into 8b, or run it
  alongside?"), and they did not all get the same answer. The criterion is **how far the change reaches outside
  Phase 8b's own file set** — because that is exactly what produced a blocking B-1 in each of the last two
  phases (out-of-scope edits inside a phase diff, leaving a reviewer unable to tell which lines are the
  feature) — with a second question applied only at the top of the range: **is it a fix, or a new capability?**

  | Finding | Reach outside 8b's set | Structure |
  |---|---|---|
  | N-3 / N-4 (stale error, "Log again" feedback) | **0** — `CopyDayDialog`/`FoodDayView`, both already open | **Folded into 8b's diff** |
  | Copy time override | **0** — `CopyGroupDialog`, already opened by 8b as the shared bulk dialog | **Folded into 8b's diff** |
  | Editing-row highlight | **0** — `FoodEntryList`/`FoodDayView`, *and coupled to* the select-mode work | **Folded, same commit as multi-select** |
  | Date format (`MM/DD/YYYY`) | **0** — all three sites in `FoodDayView`/`CopyDayDialog` | **Folded into 8b's diff** |
  | Success-message restyle | **1–2 files, 1 phase** — `SettingsForm`, optionally `MetricForm`, + a new `ui/` primitive | **Folded, as its own commit** |
  | Autofill hygiene | **~6 phases' worth** — every form in the app | **Separate cross-cutting pass** (§8), own commit |
  | Log a meal from `/meals` | **2–3 files, 1 phase — *and it is a new capability, not a fix*** | **Its own phase (8c)** |

  The **mechanism is the same throughout** — the work stays separable and revertible, which is the property that
  actually matters, since a scoped `git stash` is the tool this project has twice used to prove what caused a
  regression. Only the *ceremony* scales: a commit boundary at a couple of files, a dedicated §8 pass when a
  change spans the whole app, a numbered phase when it is a feature in its own right. Note the last two rows
  have similar file counts and different answers — **reach alone does not decide it**; a new capability earns a
  checkpoint that a same-size restyle does not. **All of them remain tracked against Phase 8b's checkpoint or
  the one immediately following it**, which is what Jeff asked for, and none is buried inside the feature commit.
- **Autofill suppression: plain `autocomplete="off"` everywhere (chosen) vs. unique non-standard tokens
  (rejected *for now*, kept as an evidence-gated escalation) vs. vendor `data-*` opt-outs (rejected, same
  escalation).** The known weakness of bare `"off"` is real and should not be papered over: **Chrome may ignore
  it** on fields its own heuristics classify as personal data (a long-standing, documented behaviour, originally
  aimed at address forms), and the popular workaround is to feed the attribute a token outside the spec's
  field-name grammar — `autocomplete="nope"`, or a per-field random string — so no heuristic recognizes it.
  Vendor-specific opt-outs exist too (1Password's `data-1p-ignore`, Bitwarden's `data-bwignore`, LastPass's
  `data-lpignore`), because **a browser extension is not a browser** and honours `autocomplete` only as far as
  it chooses to. So there are three tiers, and the question is where to start. **Starting at the standard tier
  is the right call**, on this project's own stated bias: `"off"` is the spec-sanctioned answer, it is honoured
  by every major browser for most field types, it is self-explanatory to the next reader, and it is greppable.
  Shipping ~40 random tokens or four vendors' proprietary attributes **up front, unverified**, to defeat
  heuristics that may not even fire once the positive `username`/`current-password`/`new-password` hints are in
  place, is exactly the clever-over-conventional move this project consistently declines — and it would be
  untestable cargo-culting, since none of it can be verified in CI (§6). **The positive hints are also expected
  to do much of the work on their own:** a large share of spurious prompting comes from managers that have not
  confidently located the real login form and are guessing; giving them an unambiguous one changes that input.
  **Escalation is therefore evidence-gated, not pre-emptive:** if Jeff still sees a specific manager prompt on a
  specific field after this lands, escalate **that field** to a unique non-standard token, and only then to that
  vendor's `data-*` attribute — recording which field and which manager, so the exception is justified by an
  observation rather than by folklore. **Honest limitation, stated up front so the fix isn't judged failed:
  no markup can guarantee a third-party extension stays away** (§5).
- **Autofill hygiene runs as a cross-cutting pass reviewed at Phase 8b's checkpoint (chosen) vs. folding it into
  Phase 8b's own diff like N-3/N-4 (rejected) vs. leaving it unscoped (rejected).** Jeff asked for it "added to
  8b", and it **is** — at the checkpoint that matters: it ships with 8b, qa-reviewer reviews it in the same pass,
  and Jeff approves both together. What it is *not* is folded into 8b's feature diff, and the difference is not
  bookkeeping. N-3 and N-4 were foldable because they land in **files 8b already opens** (`CopyDayDialog`,
  `FoodDayView`) and are about the copy flow 8b extends. This touches essentially **every form in the app** —
  `LoginForm`/`SignupForm` (Phase 1), `MetricForm`/`SettingsForm` (Phase 4), `FoodLookupPanel`/`BarcodeScanner`
  (Phase 6), `MealForm`/`MealItemForm`/`MealsView` (Phase 7/7c), `FoodEntryForm` (Phase 3) — i.e. **the files of
  six already-approved phases, none of which 8b otherwise goes near.** That is precisely the shape that produced
  a **blocking B-1 in each of the last two phases** (7b and 7c: undocumented out-of-scope edits reaching
  already-reviewed files inside a phase's diff). Documenting it fixes the *undocumented* half of that failure;
  it does not fix the half where a reviewer can no longer tell which lines are the feature — 8b's diff would end
  up mostly not being 8b. It is also structurally the twin of the **Visual identity rollout** already in §8:
  cross-cutting, presentation-only markup, no place in the 1→9 dependency chain, applies to whatever screens
  exist when it runs, and reviewed against its own criteria rather than a numbered §6 phase row. **The concrete
  mechanism that makes this more than a label: it must be a separate commit from 8b's feature work** — so
  qa-reviewer can review it as its own unit, and so either side can be `git stash`-ed or reverted independently,
  which is the exact tool this project has twice used to prove what caused a regression. Rejected alternative:
  leaving it unscoped as "polish someone will do" — that is how it stays undone, and Jeff hit it in real use.
- **Dashboard "quick-add" + "copy previous day": descoped, and §3.1 corrected to match (chosen) vs. building
  them (rejected).** §3.1's module tree described the dashboard as "today's totals + quick-add + 'copy previous
  day'" from the original draft; neither was ever built, the dashboard has been `TodaySummary`-only since Phase
  3, and the divergence was surfaced by qa-reviewer as a Phase 8 non-blocking note (N-2). It is being resolved as
  a **descope**, not a backlog item. A dashboard **"quick-add"** would be a *second* food-entry form needing its
  own validation, timezone capture, smart-default and lookup story — either a duplicate of `FoodEntryForm` (two
  code paths for the single most important interaction in the app, and the place a divergence would hurt most)
  or a deliberately weaker form that cannot express quantity/unit or a lookup prefill. **"Copy previous day"** is
  now strictly a subset of the `CopyDayDialog` that Phase 8 shipped on `/food`, where the source day is actually
  visible while you copy it; a second entry point would buy one tap and cost a second surface that must stay
  consistent with the future-day cap and the tz rules forever. Both are one nav tap from the dashboard already.
  The wider point is that the dashboard's minimalism is no longer an accident: it was *actively reinforced* by
  Jeff's 2026-07-26 decision to pull the sage-arc motif off that screen (`ai-context/DECISIONS.md`), where even a
  decorative element was judged clutter and the alternative of spreading it further was explicitly rejected.
  Recording the descope here — rather than silently deleting the line — is what stops the same "should we build
  it?" question resurfacing in a year. If a dashboard shortcut is ever wanted, the cheap and correct version is a
  **link** into `/food` (the nav already provides one), not a duplicated form.
- **The new meal keeps no link to its source entries (chosen) vs. a provenance column (rejected).** See §3.2 —
  a `derived_from` reference would recreate the reference-vs-value coupling copy-by-value exists to prevent,
  and nothing in the product reads it.
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
- **Saving a group as a meal can produce duplicates, by design.** `meals.name` has no uniqueness constraint
  (and shouldn't gain one — "Lunch" twice with different contents is legitimate), so saving the same group
  twice, or saving a group that was itself logged *from* an existing meal, yields two similar meals. The
  second case is the more likely one and is **correct behaviour, not a bug**: it's a value-copy clone, with no
  nesting, no reference chain, and no way for one to affect the other (`meal_items` has no link to
  `food_entries` and none to another meal). Accepted; the user renames or deletes. **Optional, not required:**
  the dialog could note "these entries came from a saved meal — this creates a separate copy" when the group's
  entries carry a `logged_from_meal_id`; deliberately left out of the required scope because it needs an extra
  `meals` read for a purely advisory string.
- **The empty-meal residual state (accepted, 2026-07-30).** If the `meal_items` insert fails *and* the
  compensating delete also fails (§3.3), a named meal with zero items remains. It is visible in `/meals`,
  deletable in one click, and `logMealForDay` already refuses it (`empty_meal`), so it cannot propagate. This
  is a **knowingly accepted** loose end: the Postgres-RPC alternative would close it outright and was weighed
  and declined (§4). Worth re-raising only if it is ever actually observed in practice, not pre-emptively.
- **The `/meals` filter is only correct because the list is fully fetched — that coupling is a tripwire.**
  `filterMealsByName` searches rows already in memory. That is exactly right today (every meal is fetched), but
  it means **the day anyone introduces server-side pagination or a `.limit()` on the meals query, the filter
  silently becomes wrong** — it would quietly search only the fetched page while looking like it searched
  everything, which is worse than not having it. If pagination is ever added, search must move server-side in
  the same change. Recorded here so a future change has to trip over it.
- **When to revisit (concrete trigger, not "someday").** Revisit if a single user's `meals` count passes ~200,
  or if `/meals` initial load becomes perceptibly slow in real use. The escalation order is deliberate:
  (1) trim `LogMealDialog`'s all-items fetch (it exists only to label options); (2) order by recency-of-use
  rather than name — the genuinely better ordering, but it needs either a new `meals.last_logged_at` column or
  a `food_entries.logged_from_meal_id` aggregate, i.e. schema/design surface, which is why it is not in Phase
  7c; (3) only then, server-side search + pagination together. Nothing before ~200 meals justifies step 3.
- **Open question for Jeff — the expand-by-default interaction (deliberately not decided here).** `MealList`
  currently expands every meal's items by default (Jeff's 2026-07-30 call: "a saved meal's whole point is
  checking what's in it"). That decision was made at a handful of meals; at 40 it means 40 cards × ~5 item rows
  rendered at once, which is the *visible* form of the problem being solved here. Phase 7c deliberately does
  **not** reverse it — it is three days old, it is Jeff's explicit call, and the filter box addresses the same
  pain from the other direction (a filtered list is short again). If the fully-expanded list still feels
  unwieldy after 7c ships, the next lever is collapsing items by default once the library exceeds some size —
  but that is a behaviour-changes-at-a-magic-number design, so it should be Jeff's call with an architect
  round, not a developer tweak folded into this phase.
- **Multi-select is the third component in this app to hold real local UI state that a background `refresh()`
  could wipe — and the first two both shipped broken.** `MealsView` (Phase 7) collapsed the meal card the user
  was working in; `FoodEntryList` (Phase 7b) would have unmounted an open expander mid-typing had the
  `hasLoadedOnce` fix not been made a required in-scope prerequisite. Both were caught **only by driving the UI
  by hand** — no automated assertion existed for either until afterwards. Phase 8b's mitigation is structural
  (own the selection in `FoodDayView`, above the loading branch — §3.4) rather than another instance of the same
  guard, plus a required manual-browser check and a real acceptance row (§6/§8). This is called out as a risk,
  not marked solved, because the mechanism that failed twice was *"nobody thought to check"*, and a design note
  does not by itself fix that.
- **A bulk action's all-or-nothing rejection is correct but user-hostile if the selection can go stale.** Both
  `copyFoodEntries` and `createMealFromEntries` reject the **whole** request when any id fails to resolve
  (§3.3 — deliberately, so a mixed set can never produce a silent partial result). A selection is composed by
  hand and then held across time, so it is the first caller that can plausibly carry an id whose row has since
  disappeared. §3.4's derived intersection is the answer, and it must not be dropped as "defensive polish": the
  failure it prevents is a whole bulk action failing with an error the user has no way to act on.
- **Selection is cleared on success, and there is no undo.** A copy that lands duplicates rows; nothing in this
  app can reverse it in one step (the user deletes the duplicates by hand). That asymmetry is why a successful
  bulk action exits select mode rather than leaving the boxes ticked (§3.4). Accepted; revisit only if repeating
  one selection to several dates turns out to be a real workflow.
- **The selection bar is not sticky, by choice.** On an unusually long day the user scrolls back up to act. A
  day's log is bounded by one day so this is small, but it is the first thing to revisit if the bar is reported
  as awkward — and the revisit should introduce a sticky pattern deliberately, once, rather than as a one-off
  for this bar.
- **Autofill hygiene is best-effort, and the acceptance criterion must reflect that or the work will be judged
  against a promise it cannot keep.** `autocomplete` is a **hint**. Browsers are explicitly permitted to ignore
  it and Chrome documentedly does for some heuristically-classified fields; and a password-manager **extension**
  is not a browser at all — it classifies fields with its own DOM heuristics and honours the attribute only as
  far as it chooses. So the deliverable is **"every control carries the correct, explicit hint"**, which is
  objective and checkable; it is **not** "no manager ever prompts again", which is neither. If a specific field
  still prompts, that is an escalation trigger (§4), not a failed phase.
- **It cannot be verified in CI, only asserted.** Playwright runs a clean browser with **no password-manager
  extension installed**, and headless Chrome's autofill heuristics differ from a real profile's — so an
  automated test can prove the *markup* is right and nothing more. The behavioural check is **Jeff's, by hand,
  in his own browser with his own extensions**, and §6 splits the two explicitly so nobody reports a green suite
  as evidence the symptom is gone.
- **The editing highlight makes an existing dead end *visible* rather than creating one.** If the entry being
  edited disappears underneath the open form — deleted in another tab, then pulled in by a background refresh —
  no row matches `editingEntryId`, so the highlight simply isn't drawn while the form still says it is editing.
  That state is **pre-existing** (the save would already fail today, with no cue at all); the highlight turns a
  silent inconsistency into an observable one. Deliberately **not** fixed in Phase 8b — auto-cancelling an edit
  because a refresh no longer sees the row would discard typed changes on what may be a transient read, which is
  a worse trade and its own design question. Noted so the behaviour is a known state rather than a surprise.
- **`/meals` acquires a browser-timezone dependency in Phase 8c, and it is the one data screen with no history
  of one.** Saved meals carry no dates, so `MealsView` has never had to resolve "today" or an IANA zone; adding
  a date/time picker means it now must, and doing it during render rather than in a mount-only Effect is the
  documented hydration-mismatch bug this repo has already fixed in `MetricForm` and worked around in
  `FoodDayView`/`TrendsView`. Called out because the person implementing 8c will be working in the one file
  where that lesson isn't already visible in the surrounding code.
- **Two ways to log a meal now exist, and they must not drift.** After 8c, `/food`'s picker and `/meals`' per-card
  action both call `logMealForDay`. Reusing one component with a fixed-meal mode (§3.4) is what keeps the cap,
  the error mapping and the time semantics identical; if a future change ever splits them into two
  implementations, that is the moment the two paths start disagreeing about what "today" or an off-grid time
  means. Recorded as a tripwire, not a current problem.
- **The success-message restyle reverses a decision that was deliberate at the time**, so it should be recorded
  as a reversal rather than as filling a gap (§4). The *colour* half of that 2026-07-25 call survives intact; only
  the *shape* is overruled. Related, and the reason the change is worth doing carefully rather than quickly: the
  same treatment is used for both **messages** and **statuses** today, and it is that conflation — not the
  colour — that made a transient confirmation read as a label and go unnoticed. Any future addition has to pick
  a side; if a third category appears (a *warning* that isn't an error), it needs its own decision rather than
  being squeezed into whichever of the two looks closest.
- **The convention decays silently the moment someone adds a form control without thinking about it**, and the
  failure is invisible — a missing attribute looks like nothing at all until a manager pops up months later.
  §6 therefore specifies a mechanical grep ("every `<input>`/`<select>`/`<textarea>` in `src/` carries an
  explicit `autoComplete`") rather than relying on reviewer memory. A lint rule would be stronger and is the
  natural upgrade if this is ever violated twice; new tooling is not justified for a first offence.
- **The "read-only on `food_entries`" property is not enforceable by the database.** Nothing in the schema
  prevents a future edit to `createMealFromEntries` from adding an UPDATE against `food_entries` (e.g. a
  well-meaning "link the entries to the new meal"). It is an app-layer invariant held by code review and by
  the acceptance test that asserts the source rows are byte-identical before and after — same enforcement
  posture, and same reasoning, as `logged_from_meal_id`'s write invariant in §3.2.
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
- `meal-items.ts`: `mealItemsFromEntries` copies **exactly** `name`/`quantity`/`unit`/per-unit calories and
  protein and **nothing else** — assert the drafts carry no `id`, `consumed_at`/`consumed_tz`/
  `consumed_local_date`, `logged_from_meal_id`, `user_id`, or `calories`/`protein_g` (the generated totals are
  never copied; the DB recomputes them). `sort_order` is `0..N-1` in `created_at`-then-`id` order (the entries
  of one group share an identical `consumed_at`, so that column cannot break the tie — feed the test entries in
  shuffled order and assert the output order); a single entry → one draft with `sortOrder: 0`; empty → empty.
  (No name-derivation tests — the name field starts blank, so there is no prefill helper to cover.)
- `meals.ts` (Phase 7c): `sortMealsByName` orders case-insensitively (`"apple"` before `"Banana"`, not after —
  i.e. it is not a raw codepoint sort), breaks ties on `created_at` then `id` for duplicate names (feed two
  meals with the identical name and assert a deterministic, repeatable order), returns a **new** array and does
  not mutate the input. `filterMealsByName`: an empty **and** a whitespace-only query returns every meal in the
  input order (identity — not "no results", the bug that would blank the page on focus); matching is
  case-insensitive; it is a **substring** match, not a prefix one (`"rice"` matches `"Chicken and rice"`);
  multi-token queries are **AND**-ed (`"chick rice"` matches `"Chicken and rice"`, `"chick beef"` does not);
  surrounding/repeated whitespace is tolerated; no match → empty array; item names are **not** searched (assert
  explicitly, so the deferred behaviour in §4 can't be added by accident).
- `quantity.ts` / `totals.ts` / `units.ts` / `lookup.ts` / `validation.ts` / `trends.ts`: as previously
  specified (validation still rejects empty `entryIds` / future `toDate` for `copyFoodEntries`;
  `validateMealInput` is reused unchanged for the save-as-meal name — no new validator).

**Acceptance / integration tests (QA, from spec):**
- **Per-entry protein %:** an entry with 30 g protein / 240 kcal displays 50%; a 0-kcal entry displays `—`.
- **Day rollup is ratio-of-sums, not average-of-ratios:** a day with a normal meal + a tiny high-protein/
  low-calorie shake shows the calorie-weighted day % (assert it equals `(Σprotein×4)/Σcalories×100` and is
  **not** the mean of the entries' individual percentages).
- **Exact-timestamp meal grouping:** two entries logged with the same `consumed_at` render under one group
  with a group-level ratio-of-sums %; entries at different instants render as separate groups; a
  `logMealForDay` batch (one shared `consumed_at`) renders as exactly one group with no extra steps.
- **15-minute time grid + floor default:** the time control only offers :00/:15/:30/:45 (native `<select>` of
  the 96 quarter-hour values, `HH:MM` option `value`s); server-side validation still rejects any off-grid
  `HH:MM` submitted directly;
  the first add of a session defaults to the quarter-hour **floor** of now (e.g. at 12:07 → 12:00), never a
  future bucket; two items typed in one sitting share the defaulted bucket and group; the metrics form has no
  time field and is unaffected.
- **Smart time default:** the first add of a session defaults to floor-of-now; a second add moments later
  defaults to the first entry's `consumed_at` (so they group); after >120 min the default reverts to
  floor-of-now (new group); changing the selected day resets to floor-of-now on that day; a manual time
  override (still on grid) is respected and following adds follow it.
- **Save a logged group as a Saved Meal (2026-07-30 addition):**
  - *Faithful copy:* a 3-entry group saved under a name produces one meal with exactly 3 `meal_items`, matching
    the sources' `name`/`quantity`/`unit`/per-unit values and ordered as they were logged; and the **meal's
    summed totals equal the source group's summed totals exactly** (both sides are the same generated
    expression over the same per-unit inputs — §3.2).
  - *Source entries are untouched (the load-bearing one):* re-read the source `food_entries` rows after the
    save and assert them **byte-identical to before**, explicitly including `updated_at` (proves no UPDATE
    fired) and `logged_from_meal_id` (proves no relink). The "From a saved meal" badge on a group that already
    had one must read exactly as it did before.
  - *One-entry group:* saveable as a valid one-item meal, and that meal logs successfully via `logMealForDay`
    (the empty-meal rejection must not catch a one-item meal).
  - *Round-trip:* save a group → `logMealForDay` the new meal onto today → the resulting batch reproduces the
    source group's items and totals, as one exact-timestamp group.
  - *Independence in both directions:* renaming/deleting the new meal leaves the source entries untouched
    (`ON DELETE SET NULL` cannot even reach them — they never referenced it); editing/deleting the source
    entries afterwards leaves the meal's items untouched.
  - *Derived from a meal-logged group:* a group whose entries carry `logged_from_meal_id` saves fine, producing
    an independent clone — the original meal and the source entries are both unmodified, and no reference chain
    exists between the two meals.
  - *The name field opens blank:* assert the input's **value** is empty on open (a `placeholder` is not a
    value), and that submitting it untouched produces a field error and writes nothing — i.e. no group's item
    name ever leaks in as a default.
  - *Compensating delete:* if the `meal_items` insert fails, no orphan `meals` row survives. Needs fault
    injection to test directly; if that proves impractical in this suite, qa-reviewer should verify the code
    path by review and say so explicitly rather than silently skipping it.
  - *Rejections write nothing:* blank name → field error; empty `entryIds` → `no_entries`; **another user's
    real entry id → rejected**; a **mixed set** (one own id + one foreign id) → rejected wholesale, not a
    partial meal. In every case assert **zero** `meals` and `meal_items` rows written, read back via the
    service-role client across *both* users (the Phase 7 evidentiary bar — the action's return value alone is
    not proof).
  - *Code review, not an automated row:* confirm `createMealFromEntries` contains no UPDATE/DELETE against
    `food_entries`, reads entries only via the RLS-scoped client (never service-role), and takes `user_id`
    solely from the session.
- **Saved-meals library ordering, filtering and counts (2026-07-30 addition, Phase 7c):**
  - *Shared ordering:* with several meals whose names sort differently from their creation order, `/meals` and
    `LogMealDialog`'s picker list them in the **same** alphabetical order — assert both surfaces, since "a meal
    is in the same place in both" is the point.
  - *Picker labels stay name-first:* each `<option>`'s text **starts with** the meal name (the kcal/item-count
    parenthetical follows), which is what makes native type-ahead usable. Assert on the rendered option text.
  - *Filter narrows without refetching:* typing narrows the rendered list to matching meals only; assert
    case-insensitivity and a mid-word (substring) match; clearing the box restores the full list. Assert **no
    Supabase request is issued while typing** (the list is filtered in memory) — e.g. by counting network calls
    to the meals endpoint across the interaction.
  - *The two empty states are distinct (the one to hammer):* a user with **zero** meals sees the "No saved
    meals yet" create-your-first copy; a user **with** meals whose filter matches nothing sees the distinct
    no-match message and **not** the create-your-first copy. Getting these confused is the most likely defect
    in this phase.
  - *Counts are accurate:* the unfiltered readout equals the number of meals actually returned; a filtered
    readout reports matches-of-total and agrees with the number of cards rendered.
  - *Nothing else regressed:* create/rename/delete a meal and add/reorder an item **while a filter is active**
    — the mutation succeeds, the refresh preserves the filter, and (per Phase 7b's `hasLoadedOnce` fix) the
    expanded card the user was working in stays open. A newly created meal appears if it matches the active
    filter and does not if it doesn't.
  - *No data is hidden:* with a deliberately large fixture library (e.g. 60 meals seeded via the admin client),
    every one is present with the filter cleared — proving no cap or `.limit()` crept in.
- **Logging a saved meal from the `/meals` library (2026-08-01 addition, Phase 8c):**
  - *It logs the right meal:* "Log this meal" on a **specific** card, with several meals in the library, writes
    exactly that meal's items — assert via a service-role read that the inserted `food_entries` match that
    meal's `meal_items` (name/quantity/unit/per-unit) and carry `logged_from_meal_id` = that meal. Seed at least
    two similar meals so picking the wrong card would fail rather than coincidentally pass.
  - *Batch semantics are identical to `/food`'s path:* the rows share **one** `consumed_at`/`consumed_tz`/
    `consumed_local_date`, form exactly **one** exact-timestamp group, and roll into `daily_food_totals` for the
    chosen day — the Phase 7 `logMealForDay` guarantees, re-verified through the new entry point.
  - *Defaults:* the expander opens with the date = **today** and the time = the **floor** of the current
    quarter-hour (never a future bucket); the time control offers exactly the 96 quarter-hour values and **no
    "keep original" sentinel** (that belongs only to the copy override — §3.4).
  - *A chosen past day and time are honoured:* pick an earlier date and a different time, log, and assert the
    rows land there — this is the whole point of the feature, not just "log to now".
  - *The cap holds through the new entry point:* a future date is rejected with **zero** rows written even with
    the `<input max>` stripped from the DOM.
  - *Ownership:* another user's `mealId` submitted directly is rejected with zero rows for either user
    (`logMealForDay`'s recorded invariant, re-asserted through this caller).
  - *Success does not disturb the screen (the row most likely to break):* with a **filter active** and a card's
    items expanded, log a meal — assert the confirmation appears, the filter query is still applied, the same
    cards are still rendered, and the expanded card is still expanded. `/meals` shows `meals`/`meal_items`,
    which this action does not touch, so there must be **no refetch** and no remount.
  - *Empty meal:* a meal with zero items is still rejected (`empty_meal`) from this surface too.
  - *`/food`'s existing `LogMealDialog` is unregressed:* all Phase 7 logging rows still pass — the fixed-meal
    mode must not alter the picker path.
- **Copy a meal group = exact subset:** "Copy this group" copies exactly the entries sharing that
  `consumed_at` (not the whole day, not other groups), and the copied entries share one new `consumed_at` so
  they remain a group on the target day.
- **Multi-select bulk actions (2026-07-31 addition, Phase 8b):**
  - *Entering and leaving the mode:* "Select entries" is absent on a day with no entries and present otherwise;
    entering select mode reveals a checkbox on every entry row and **hides** every per-row ("Log again", "Edit",
    "Delete") and per-group ("Save as meal", "Copy this group") action; "Done" exits and restores them. Assert
    the hiding explicitly — two live copy affordances at once is the specific ambiguity the mode exists to
    prevent. Entering select mode with a group expander already open closes it.
  - *Copy selected = exactly the ticked set (the row to hammer for copy):* on a day with three groups, tick two
    entries from **different** groups and copy to another date. Assert **exactly two** rows were written
    (service-role read), that they are the two ticked ones and not their group-mates, and that they land as
    **two** groups on the target day (each preserving its own source time-of-day, per §3.3) — a selection that
    silently copied whole groups, or collapsed both onto one instant, would pass a naive "some rows appeared"
    check.
  - *Save selected as a meal = exactly the ticked set:* tick entries from two different groups, save under a
    name, and assert one meal with exactly those N `meal_items`, ordered `created_at`-then-`id` (chronological
    across the day), with the meal's summed totals equal to the ticked entries' summed totals. Re-read the
    source `food_entries` and assert them **byte-identical** (including `updated_at` and
    `logged_from_meal_id`) — the Phase 7b read-only invariant must still hold when the source is a selection
    rather than a group.
  - *The bulk actions are disabled with nothing selected*, and clearing the selection re-disables them.
  - *A successful bulk action clears the selection and exits select mode*, and the transient confirmation names
    what happened; the checkboxes are gone and no second copy can be fired by a stray click.
  - *Selection survives a background refresh (the row to hammer overall — this bug class has shipped twice):*
    enter select mode, tick two entries, open "Save selected as a meal" and type a **partial** name, then
    trigger a real background refresh by adding an unrelated entry via the normal form. Assert select mode is
    still on, the same two entries are still ticked, the expander is still open, and the typed name is still
    there. Repeat with a delete of an *unselected* entry as the refresh trigger.
  - *A stale selected id degrades to a no-op, not a whole-request failure:* with entries selected, delete one of
    the selected rows out-of-band (a second client / direct DB delete) and refresh the day. Assert the count
    drops and the remaining bulk action succeeds — not an `entries_not_found` rejection of the whole set.
  - *Day change clears the selection:* tick entries, change the Day input, and assert select mode is off and
    nothing is ticked (and, on returning to the original day, still nothing is ticked — no resurrection).
  - *Ownership and the cap are unchanged, verified through this new entry point too:* a future `toDate` from the
    selection copy is rejected with **zero** rows written even with the `<input max>` stripped from the DOM; and
    a tampered/foreign id submitted directly to either action rejects the whole request with zero rows for
    either user. (The action-level invariants are already proven in the Phase 7b/8 blocks — this row only
    confirms the new caller cannot route around them.)
  - *Copy-flow feedback fixes folded in from Phase 8's qa notes (Phase 8b):*
    - **No stale error on reopen (N-3):** on `/food`, open "Copy this day", submit a copy that is **rejected**
      (e.g. a future target date with the `<input max>` stripped, so the server rejects it), confirm the error
      renders, then **close and reopen** the panel — assert **no error text is present** before any new action,
      and that the target-date field is back to its default. Repeat the same close/reopen assertion for
      Phase 8b's own bulk expanders opened from the selection bar, since the rule applies to them too.
    - **Reopening after a *successful* copy is also clean** — no leftover error, no leftover picked date.
    - **The N-3 fix must not weaken refresh survival (assert both, in one test):** with a bulk expander open and
      a target date picked, force a background refresh (add an unrelated entry) and assert the expander stays
      open with its picked date intact. An unmount keyed off anything a refresh changes would pass the
      stale-error rows above and fail this one — which is the whole point of asserting them together.
    - **"Log again" names its destination when it isn't the day on screen (N-4):** while viewing a **past** day,
      "Log again" an entry; assert the row was written to **today** (service-role read — the behaviour itself is
      unchanged and must stay correct) and that the confirmation **names the destination date**. Then repeat
      while viewing **today** and assert the toast does *not* redundantly name it. Assert the view **stays on
      the past day** — naming the destination is the fix; navigating was rejected (§4).
  - *Editing-row highlight (Phase 8b — §3.4/§4):*
    - **The right row is marked:** with several entries on the day, click "Edit" on the third — assert that row
      carries the editing treatment and **no other row does**. Assert on the visible **"Editing" label**, not
      only on a computed border colour, since the label is the part that must exist for non-colour perception.
    - **It clears on every exit path:** saving, cancelling the edit, and changing the day each remove the
      highlight (`handleDayChange` already clears `editingEntry`).
    - **It survives a background refresh (the id-comparison trap):** start editing a row, then trigger a real
      refresh by deleting a *different* entry — assert the same row is still highlighted. This is the row that
      fails if the implementation compares entry objects instead of ids, which is the likeliest defect here and
      is invisible until a refresh happens.
    - **The edited row's actions are hidden and others' are not:** the edited row shows no "Log again"/"Edit"/
      "Delete"; an unrelated row still shows all three and "Log again" on it still works without cancelling the
      edit in progress.
    - **The "From a saved meal" badge stays legible** on an edited row that has one — the specific collision the
      no-surface-fill decision exists to avoid.
    - **Co-existence with select mode:** enter select mode while an edit is in progress and assert the edit is
      **not** cancelled, the form keeps its typed values, and the edited row shows both its highlight and a
      checkbox distinguishably.
    - **No live region:** assert no `role="status"`/`aria-live` announcement is introduced for entering edit
      mode (deliberate — §3.4/§4), while the "Editing" text is present in the accessibility tree.
  - *Optional time override on copy (Phase 8b — §3.3/§3.4/§4):*
    - **Default preserves today's behaviour:** open "Copy this group", change nothing but the date, copy — the
      rows land at the group's **original** time-of-day and stay one group. (All existing Phase 8 copy-group
      rows must still pass unchanged; that they do is the point of the sentinel default.)
    - **An explicit time is applied to every copied row:** pick a time, copy, and assert every new row's
      `consumed_at` is that instant on the target date (service-role read), and that they form **one** group.
    - **The bulk collapse is real and disclosed:** multi-select entries from **three different groups**, choose
      an explicit time, copy — assert all of them land on one instant as **one** group on the target day, and
      that the dialog stated so before submission. Then repeat with the sentinel and assert they land as
      **three** groups and the note is **absent**. Also assert the note is absent for a single-group copy with
      an explicit time (nothing to disclose — both modes give one group).
    - **The control cannot express an off-grid time:** the `<select>` offers exactly the 96 quarter-hour values
      plus the sentinel; server-side 15-minute validation still rejects an off-grid `toTime` submitted directly.
    - **`CopyDayDialog` has no time control at all** — assert its absence, since adding one there is an
      explicit non-goal (§3.4/§4), and a whole-day copy still preserves each entry's own time.
    - **No label collision:** with a copy expander open on `/food`, `getByLabel("Time")` must still
      unambiguously resolve to `FoodEntryForm`'s control — the copy control is "Copy to time". Worth asserting
      once, because the failure mode is a strict-mode error in an unrelated existing spec
      (`e2e/phase3-acceptance.spec.ts` uses that locator), not a visible bug.
  - *Transient success feedback (Phase 8b — §3.4/§4):*
    - **The message is a banner, not a pill, and is announced:** after adding an entry, the confirmation carries
      `role="status"`, spans the content width, and no longer uses the `rounded-full`/`text-xs` pill classes.
      Assert on the **computed** styles/roles, not source class names (the visual-identity suite's established
      approach — a class in source proves nothing if Tailwind never emitted it).
    - **Both real message sites use the shared component:** `/food` (add, copy-day, copy-group, "Log again",
      "Saved as …", and 8b's bulk actions) and `/settings` ("Settings saved.") render the identical treatment.
    - **The two status pills are untouched (assert explicitly — this is the distinction the whole change rests
      on):** `MetricForm`'s "Already logged for …" and `FoodEntryList`'s "From a saved meal" are still pills.
      A blanket restyle would have caught both, and that would be the defect, not the fix.
    - **Auto-dismiss is ~6s, and repeats get a full timer:** the message is still visible at 5s and gone by 7s;
      then — the latent bug — fire the **same** message twice in a row (add two entries with identical
      confirmation text) and assert the second one is still visible ~5s after *it* appeared, rather than
      inheriting the first's remaining time.
    - **`/settings` gains auto-dismiss too** (it has none today) without breaking the recorded `SettingsForm`
      remount-on-`updated_at` behaviour — re-run the Phase 4 settings rows, especially the kg/lb radio, which
      has its own recorded desync bug.
    - **Contrast spot-check** (the recorded trap): message text is ink-on-sage-pale, and `sage-deep` appears
      only as the border/icon, never as text on that tint.
  - *Human-readable date format (Phase 8b — §3.3/§3.4/§4):*
    - **Unit (`datetime.ts`):** `formatDateLabel("2026-07-29") === "07/29/2026"`; zero-padding holds for
      single-digit months and days (`"2026-01-05"` → `"01/05/2026"`); **a date is never shifted by a day** —
      assert the same input yields the same output with the test runner's `TZ` set to a **negative-offset** zone
      (e.g. `America/Chicago`), which is precisely the case `new Date(iso).toLocaleDateString()` would get wrong;
      malformed/empty input is returned unchanged rather than throwing or producing `NaN`.
    - **Acceptance:** the copy-day/copy-group confirmation reads ``Copied 3 entries to 07/29/2026.``, and
      `CopyDayDialog`'s explanatory line names its source day in the same format. **No user-facing text anywhere
      renders a bare `YYYY-MM-DD`** — worth one sweep assertion (no visible text matching `\d{4}-\d{2}-\d{2}`)
      across `/food`, `/meals`, `/metrics`, `/settings`, since that is the actual reported defect.
    - **The N-4 "Log again" toast is formatted from birth** — assert it names the destination as `MM/DD/YYYY`,
      not ISO.
    - **The untouched set stays untouched (assert, don't assume):** the six native `<input type="date">`
      controls still submit ISO — assert an input's `value` is `YYYY-MM-DD` after picking a day, and that a copy
      to a chosen date still writes the right row — and the chart axis/tooltip labels still read "Jul 25" /
      "Jul 25, 2026". A blanket reformat would break the former and regress the latter.
    - **Required in-the-same-change test update — five known stale assertions.**
      `e2e/phase8-acceptance.spec.ts` asserts the copy toast against a raw ISO date in **five** places
      (`getByText("Copied N entries to " + target)`, lines ~140/178/227/273/297). All five go stale the moment
      the toast is formatted and **must be updated in the same change**. This is the third consecutive phase
      where an existing acceptance suite pins behaviour a new phase changes — it produced a blocking B-1 in both
      7b and 7c; it is being named up front here so it doesn't a third time.
  - *Autofill / password-manager hygiene (cross-cutting pass, reviewed at this checkpoint — §3.4/§4):*
    - **The identity fields carry the positive hints:** `/login`'s email is `username` and its password
      `current-password`; `/signup`'s email is `username` and **both** its password and confirm-password inputs
      are `new-password`. Assert on the rendered attribute, not the source. These are the rows that must not
      regress — breaking them makes the *real* login form harder for a manager to recognize, which is worse than
      the problem being fixed.
    - **No form control anywhere else is left unhinted:** walk every screen (`/food` incl. the add form, "add
      detail", the lookup panel, the barcode box, all three copy/save expanders and the selection bar; `/meals`
      incl. the filter, meal form and item form; `/metrics`; `/settings`; `/trends`) and assert **every**
      `<input>`, `<select>` and `<textarea>` has `autocomplete="off"`. Cover the number, date, search and
      `<select>` controls too — those are the ones a per-field implementation is most likely to skip.
    - **Every `<form>` carries `autocomplete="off"`** as the default-deny layer.
    - **A mechanical decay guard, not a reviewer's memory:** grep `src/` for `<input`/`<select`/`<textarea` and
      assert each occurrence has an explicit `autoComplete` — this is what catches the *next* control someone
      adds without one (§5). Report the count, so a future reviewer can see it move.
    - **Explicitly NOT an acceptance criterion: "no password manager prompts."** Playwright runs with no
      extension installed and headless heuristics differ from a real profile, so the suite can only prove the
      markup (§5). **qa-reviewer must state this limitation rather than imply behavioural verification**, and
      the behavioural check belongs to Jeff's manual pass below.
    - **Nothing regressed:** login and signup still work end-to-end (the auth rows from Phase 1), and every form
      in the app still submits — an `autoComplete` value cannot break a submit, but the sweep touches six
      approved phases' files, so the cheap confirmation is worth taking.
  - *Carried-forward, and a required doc/test-hygiene check:* `e2e/phase8-acceptance.spec.ts` contains a test
    asserting **"the explicitly-optional multi-select (Copy selected) was NOT built"** (it asserts zero
    `Copy selected` buttons and zero checkboxes). That assertion becomes **false by design** when this phase
    lands and **must be updated in the same change**, not discovered later — this is exactly the stale-acceptance-
    test failure that produced a blocking B-1 in both Phase 7b and Phase 7c. The sibling test **"no copy/quick-add
    control was added to the dashboard" stays and stays passing** — under the §4 descope it is now an intentional
    guard on a decision, not a marker for something unbuilt.
- Carried forward unchanged: copy-day + future-cap-on-copy (no rows on a future target) + "Log again" +
  copy ownership/atomicity; minimal-form submit → valid unitless entry; candidate-prefilled submit; quantity
  edit recalculates totals; saved-meals CRUD + logging; no-future-day (add/edit/meal); RLS isolation across
  all five tables; barcode/search lookup; unit-preference kg/lb; goals/charts/gap rendering; metrics upsert;
  persistent login (reload keeps session; log out clears it); installability (valid manifest, no service
  worker); DB constraints.

**Fixtures:** as before, plus a day containing (i) two entries with an identical `consumed_at` and (ii)
entries at several distinct instants incl. an "every 30 min" run — to exercise grouping and the ratio-of-sums
rollup — and a high-protein/low-calorie item to exercise the ratio-of-sums-vs-average distinction. For
save-as-meal, add (iii) a group produced by a real `logMealForDay` batch (so its entries carry
`logged_from_meal_id`) and (iv) a **second user's** group, for the cross-user and mixed-set rejection rows.
Mocked
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
- **Save-a-group-as-a-meal (Phase 7b) needs nothing new from CI** — no secret, no provider, no migration, no
  clock/timezone dependency (it copies values between two tables and never computes a date). It runs on the
  same ephemeral local Supabase stack every other phase's e2e already uses.
- **Saved-meals list scaling (Phase 7c) needs nothing new from CI either** — no secret, no provider, no
  migration, no clock/timezone dependency. It is pure client-side sorting/filtering plus one changed `.order()`
  clause; its unit tests are framework-free and its acceptance tests run on the same ephemeral local Supabase
  stack every other phase already uses. The only fixture addition is a larger seeded meals library for the
  "nothing is hidden" row (§6).
- **Multi-select bulk actions (Phase 8b) need nothing new from CI either** — no secret, no provider, no
  migration, and **no new server-action or domain code at all** (it drives `copyFoodEntries` and
  `createMealFromEntries` unchanged), so there is nothing new to seed, mock or configure. Its acceptance tests
  run on the same ephemeral local Supabase stack every other phase already uses. Two fixture notes: the
  cross-group rows need a day seeded with entries at **several distinct `consumed_at` instants** (the §6
  fixtures already call for exactly that), and the background-refresh row needs no fixed clock — it asserts on
  UI state surviving, not on a time calculation. Prefer the fixed `todayAt("HH:MM")` fixture style Phase 8's own
  suite adopted over a "recent past instant" helper, to avoid the near-UTC-midnight collision flake logged
  against `phase7b-acceptance.spec.ts`.
- **Phase 8c (log a meal from `/meals`) needs nothing new from CI** — no secret, no provider, no migration, and
  **no new server action** (it calls the existing `logMealForDay`). It does add a **clock/timezone-dependent**
  surface to `/meals`, so its acceptance tests should pin the browser timezone and use fixed `todayAt("HH:MM")`
  fixtures, per the same guidance as Phase 8b, rather than a "recent past instant" helper.
- **The autofill-hygiene pass needs nothing new from CI** — it is static HTML attributes, no secret, no
  provider, no migration, no runtime behaviour. Its assertions run in the existing e2e job. **Note for whoever
  reads a green run:** CI proves the *markup* only — no password-manager extension exists in the CI browser, so
  a green suite is not evidence that the reported symptom is gone (§5/§6).
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
  total modes) with quantity/unit; the 15-min quarter-hour time grid (native `<select>` of the 96 values —
  see the post-Phase-3 revision note below; originally shipped as `<input type="time" step="900">`) +
  `floorToQuarterHour` floor default + the smart `lastConsumedAt` default;
  `addFoodEntry`/`updateFoodEntry`/`deleteFoodEntry` (future-day guarded);
  `FoodEntryList` with exact-`consumed_at` grouping + per-entry and per-group protein %; `DailyTotals` +
  dashboard day protein %; reads off `daily_food_totals`; the domain modules `totals`, `quantity`,
  `nutrition`, `entry-grouping`, `datetime` (future-cap + floor + smart default), `validation`; `food/page`.
- **Out:** metrics, charts, lookup, saved meals, copy mechanisms. (Build `FoodEntryForm` with a clean seam to
  accept an external `FoodCandidate` prefill + auto-expand later — the point Phase 6 plugs into.)
- **Post-Phase-3 revision (2026-07-25, control-only):** the time-of-day input was changed from
  `<input type="time" step="900">` to a native `<select>` of the 96 quarter-hour values (12-hour AM/PM
  labels, 24-hour `HH:MM` option `value`s) — the original widget enforced the grid but, because browsers
  render `<input type="time">` as three separate segments regardless of `step`, never delivered the
  one-interaction friction win the coarse grid was chosen for. Presentation-only: the `HH:MM` value contract,
  `floorToQuarterHour`, the smart default, grouping, and the future-day cap are unchanged. Edit path must
  inject an off-grid stored time as an extra option so editing never silently rewrites it. Full reasoning in
  `ai-context/DECISIONS.md`.
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
  - **App-layer ownership invariant on `logged_from_meal_id` (required — the DB does not enforce it).**
    `food_entries.logged_from_meal_id` is a plain FK with no owner check (see §3.2 "Deliberate FK asymmetry"),
    so `logMealForDay` **must** be the enforcement point: it may set `logged_from_meal_id` only to a meal it
    first **read as the acting user's own through the RLS-scoped server client** (never the service-role
    client, which bypasses RLS). Concretely: resolve/verify the meal (and its items) via the RLS-scoped client
    before inserting; if the meal id doesn't resolve to one of the caller's own meals, return an error rather
    than inserting entries that back-reference a foreign meal. This keeps every `logged_from_meal_id` value
    same-owner by construction. qa-reviewer test for this phase: `logMealForDay` with a **another user's**
    `mealId` fails (no rows written), and every row it does write has `logged_from_meal_id` = the caller's own
    meal.
- **Out:** copy mechanisms.
- **§6 scope for qa-reviewer:** *saved-meals CRUD* (meal total = item sum; rename; add/edit/remove/reorder;
  delete cascades items); *logging* (`logMealForDay` → exactly N rows sharing one `consumed_at`/tz/
  `consumed_local_date` + `logged_from_meal_id`, summing into the day and forming one exact-timestamp group;
  empty meal rejected); *meal edits don't touch already-logged history*; *future-cap on the batch*; re-verify
  RLS on `meals`/`meal_items` via the actions (base isolation was proven in Phase 2).

### Phase 7b — Save a logged meal group as a Saved Meal (2026-07-30 addition)

**Why its own phase, and why here.** Jeff called this "a critical ease-of-use function," so it gets a real
checkpoint rather than being appended to a phase that has already shipped. It is deliberately **not** folded
into Phase 7: that phase is implemented, qa-reviewed with a verdict on record, and awaiting Jeff's approval —
reopening its scope would invalidate a review that has already been done. It is also deliberately **not**
folded into Phase 8: bundling would mean this can't ship until copy/repeat is also finished, and would blur
Phase 8's qa scope across two independent features. **Numbered 7b rather than renumbering 8/9** so every
existing reference to "Phase 8" in this doc, `ai-context/*`, and the test suite stays correct. **Runs next,
before Phase 8** — its only dependency (Phase 7's `meals`/`meal_items` + actions) is complete, and it
establishes the `FoodEntryList` group-header action bar that Phase 8's "Copy this group" then slots into,
rather than the reverse.

- **In:** `createMealFromEntries` (§3.3 — entryIds + name in, RLS-scoped re-read of the entries, count check,
  `meals` insert then one multi-row `meal_items` insert, **compensating delete on item-insert failure — a
  required part of the action, not optional**); `mealItemsFromEntries` in `lib/domain/meal-items.ts` (the pure
  copy/ordering logic, unit-tested); `components/food/SaveGroupAsMealDialog.tsx` (inline expander, **blank**
  autofocused name input + read-only item preview + Save/Cancel); a **"Save as meal"** control in `FoodEntryList`'s group
  header, built as a reusable **action-bar slot**; the new `onGroupSavedAsMeal` callback wired into
  `FoodDayView`'s existing transient `savedMessage`; and the **required in-scope prerequisite** from §3.4 —
  give `FoodDayView` the `hasLoadedOnce` treatment so a background refresh no longer unmounts `FoodEntryList`
  (now that it holds real local UI state, the `MealsView` bug from Phase 7 would otherwise reappear here).
  **Settled 2026-07-30 (Jeff's call): that fix ships inside Phase 7b, not as a separate change** — it is a
  prerequisite of this phase's own correctness, so splitting it out would mean landing a known-broken
  interaction and fixing it afterwards.
- **Out:** any change to `food_entries` (this phase writes only `meals`/`meal_items` — that boundary *is* the
  feature); any schema change; multi-select-across-groups as a source (the action already accepts an arbitrary
  id list, so **Phase 8b's** multi-select drives it with no action change); a "which meals came from which
  entries" provenance view; renaming/merging into an *existing* meal (out of scope — this always creates a new
  one; appending a group to an existing meal is a plausible follow-up but is a different interaction with its
  own duplicate-item questions, and is not being smuggled in here).
- **§6 scope for qa-reviewer:** unit — `meal-items` (`mealItemsFromEntries` field-copy set and `sort_order`
  assignment). Acceptance — the whole *"Save a logged group as a Saved Meal"*
  block in §6, with the two rows to hammer being **(1) source entries byte-identical after the save**
  (including `updated_at` and `logged_from_meal_id`) and **(2) cross-user / mixed-set rejection writing zero
  rows**, verified via a service-role read across both users, not from the action's return value. Also review
  by hand: no UPDATE/DELETE against `food_entries` anywhere in the new action, and `user_id` from the session
  only. Carried-forward Phase 7 rows must keep passing unchanged — a regression there means this phase touched
  something it shouldn't have.
- **Manual-browser check (do not skip — this phase's shape is exactly the one that has burned this repo
  twice):** open a group's expander, then trigger a day refresh underneath it (add or delete another entry) and
  confirm the expander and its typed name survive; and confirm the dialog's `<form>` isn't nested inside
  another `<form>` by actually clicking Save in a browser, not just by reading the JSX.

### Phase 7c — Saved-meals library: ordering, filtering, and counts (2026-07-30 addition)

**Why its own phase, and why here.** Raised by Jeff while manually testing Phase 7b ("is there any limit to the
number of meals we display on the meals page? It seems like that could get out of control"). It is **small** —
one new pure module, a filter box and count in `MealsView`, and a changed `.order()` on two queries — but it is
**not trivial**: it changes what a user sees on two screens, adds a control with its own empty-state semantics,
and answers a scaling question with a documented "no" that deserves to be on the record rather than in a chat
message. It is deliberately **not folded into Phase 8**: the two share **no files at all** (7c touches
`meals/*` and `food/LogMealDialog.tsx`; Phase 8 touches `food/FoodEntryList.tsx`, `FoodDayView`, and
`copyFoodEntries`), so bundling would buy nothing and would blur Phase 8's qa scope across two unrelated
features — the same reasoning §8 Phase 7b used for not folding *itself* into Phase 8. **Numbered 7c** so every
existing "Phase 8"/"Phase 9" reference in this doc, `ai-context/*`, and the test suite stays correct.

**Sequencing: recommended before Phase 8, but this is a preference, not a dependency.** There is no technical
ordering constraint in either direction — Jeff can flip them freely. The weak arguments for first: it is a
live annoyance already being felt in real use, it is genuinely small next to Phase 8, and **Phase 8b's**
"save the selected entries as a meal" wiring makes meals easier to create, so the library grows faster
afterwards. The argument for second is simply that copy/repeat is the more valuable feature and has waited
through 7 and 7b.

- **In:** `lib/domain/meals.ts` (`sortMealsByName`, `filterMealsByName` — pure, unit-tested per §6);
  `MealsView` gains the `<input type="search">` filter box (with a real `<label>`), the local filter state, the
  count readout, the **distinct no-match message**, and applies sort-then-filter before handing the array to
  `MealList`; `MealList` renders what it is given (its existing "No saved meals yet" empty state now fires only
  for a genuinely empty library); `LogMealDialog`'s meal picker adopts the same shared ordering and keeps its
  name-first option labels; both surfaces' `meals` queries change `.order("created_at")` → `.order("name")`.
- **Out — say no to all of these explicitly:** any migration, index, or extension (§3.2); server-side search,
  pagination, infinite scroll, or list virtualization (§4); any `.limit()` or hard cap on how many meals a user
  may have or see (§4); a combobox/custom dropdown for the picker, or a second filter box on it (§4); fuzzy
  matching; matching against **item** names rather than meal names (deferred, §4); URL-persisted filter state;
  meal categories/tags/folders/favourites/pinning (already out of scope project-wide — this phase must not be
  the door they come in through); recency-of-use ordering (needs schema surface — §5); archiving or
  soft-deleting meals; any change to the two-flat-queries + `groupMealItemsByMeal` read strategy; any change to
  `MealList`'s expand-items-by-default behaviour (§5 open question — Jeff's call, not this phase's);
  and anything at all on `/food`'s day list, which is bounded by day and has no equivalent problem.
- **§6 scope for qa-reviewer:** unit — `meals.ts` (both functions, all listed cases). Acceptance — the whole
  *"Saved-meals library ordering, filtering and counts"* block in §6, with the two rows to hammer being
  **(1) the two empty states are distinct** (never show "create your first meal" to someone with 40 meals and a
  typo) and **(2) no data is hidden** (a 60-meal fixture library renders all 60 with the filter cleared — proof
  that no cap or `.limit()` crept in while "handling scale"). Carried-forward Phase 7 and 7b rows must keep
  passing: meal CRUD, item reorder, `logMealForDay`, and "Save as meal" are all untouched by this phase, so a
  regression there means it reached somewhere it shouldn't have.

### Phase 8 — Ease-of-entry extras (copy/repeat)
- **In:** `copyFoodEntries` (the shared primitive) and its three **implicit-scope** callers — copy-day
  (`CopyDayDialog`), per-entry "Log again", and copy-group (`CopyGroupDialog`, from a `FoodEntryList` group
  header). In all three the set of entries is determined by *which button is pressed*, not by a user-composed
  selection.
- **Out:** **user-composed multi-select and its bulk actions — deliberately deferred to Phase 8b** (see below;
  this was flagged as non-blocking qa note N-1 on this phase and is being resolved by designing 8b, not by
  amending 8's scope after the fact). Also out: any dashboard copy/quick-add control — see the §4 descope of
  that stale §3.1 line (qa note N-2), which is a *decision not to build*, not a deferral.
  **This phase's two remaining actionable qa notes are also folded into Phase 8b rather than reopening this
  already-reviewed diff** (Jeff's call, 2026-07-31): **N-3** (`CopyDayDialog` shows a stale error on reopen) and
  **N-4** ("Log again" from a past day doesn't say where the entry went). Both are UI-only and land in files 8b
  already opens. Neither is a defect in what this phase was asked to build — the copy semantics, ownership and
  cap invariants all reviewed clean — so Phase 8 stands as approved-as-shipped with the follow-ups tracked in a
  named phase instead of a loose list.
  **Note:** the smart time default and the quarter-hour grid were already implemented in Phase 3
  (they're part of the core form), and Phase 7b already built the group-header **action bar** that "Copy this
  group" slots into, so this phase is essentially just the copy mechanisms on top of both.
- **§6 scope for qa-reviewer:** *copy-day* (duplicates every source entry, preserves times, drops
  `logged_from_meal_id`); *future-cap on copy* (future `toDate` → `error:'future_date'`, **no** rows inserted
  — copy can't bypass the cap); *"Log again"* single entry; *copy-group = exact subset* (and the copied group
  stays grouped on the target day); *ownership/atomicity* (empty/foreign `entryIds` → `ok:false`, nothing
  inserted).

### Phase 8b — Multi-select bulk actions on the day's log (2026-07-31 addition)

**Why its own phase, and why here.** Phase 8 shipped the three copy mechanisms whose entry set the UI derives
automatically (whole day / one group / one entry) and deliberately did **not** ship user-composed multi-select —
which this doc's §3.4 and §8 Phase 8 nonetheless described as if it existed. qa-reviewer raised that as
non-blocking note N-1 on Phase 8. It is being resolved by **designing the feature properly**, not by quietly
deleting the sentence: multi-select is the one copy mechanism that can express "these four things, from
different points in the day", which none of Phase 8's three can. It is deliberately **not** folded back into
Phase 8 — that phase is implemented, qa-reviewed with a clean verdict on record, and awaiting Jeff's approval;
re-opening its scope would invalidate a completed review, exactly as §8 Phase 7b reasoned about Phase 7.
**Numbered 8b rather than renumbering 9** so every existing "Phase 9" reference in this doc, `ai-context/*`, and
the test suite stays correct — the same convention 7b and 7c established.

**It also absorbs Phase 8's two remaining non-blocking qa notes, N-3 and N-4** (Jeff's call, 2026-07-31), for
the same reason and by the same route: both are small, UI-only, and land in files this phase already opens
(`CopyDayDialog.tsx`, and `FoodDayView`'s "Log again" toast wiring), so folding them in beats leaving them as
standalone unscoped polish that nobody owns. They are genuinely additive to 8b's design rather than bolted on —
N-3's fix (an expander's in-flight state must live in a conditionally-rendered subtree) is a rule this phase's
own new bulk expanders have to follow regardless, and it interacts directly with 8b's refresh-survival
requirement, so it is better decided here than in isolation. All four of Phase 8's qa notes that were not
"no action recommended" (N-1 multi-select, N-2 the dashboard descope, N-3, N-4) are therefore now accounted for
in writing: three are in this phase's scope, one is a recorded decision not to build (§4).

**Dependencies: hard on both Phase 7b and Phase 8, and on nothing else.** It drives `createMealFromEntries`
(7b) and `copyFoodEntries` (8), and it layers onto the `FoodEntryList` surface both of them already extended.
It has no relationship to Phase 9 (PWA shell) in either direction, so 8b→9 is ordering only.

**The defining property of this phase: it adds no server-action code, and no `lib/domain/` code beyond one pure
display formatter.** Both bulk actions call already-shipped, already-qa-reviewed actions with unchanged
signatures, because both were built id-list-based and explicitly group-agnostic (§3.3 — Phase 7b wrote that
property down *in anticipation of this phase*). The phase is client UI, plus the single pure `formatDateLabel`
helper the date-format finding requires (§3.3) — **the one deliberate, documented exception**, called out here
so it doesn't read as an unexplained deviation. That is what makes it reasonable to ship two bulk actions in one
checkpoint (§4) and what should shape the review: the ownership, cap, and zero-rows-on-rejection invariants were
proven in Phases 7b and 8, and 8b's job is only to demonstrate that a new, user-composed caller cannot route
around them.

- **In:**
  - **Select mode on `/food`** — a "Select entries" toggle in `FoodDayView`'s existing control row (hidden when
    the day has no entries); per-row native `<input type="checkbox">` with a real accessible name in
    `FoodEntryList`; per-row and per-group action buttons **hidden** while in select mode; entering select mode
    closes any open group expander.
  - **`components/food/EntrySelectionBar.tsx`** (new) — "N selected", "Copy selected", "Save selected as a
    meal" (both `disabled` at N = 0), "Clear", "Done". Rendered by `FoodDayView` directly above the list; **not
    sticky/floating** (§3.4/§4).
  - **Selection state owned by `FoodDayView`**, above the `!hasLoadedOnce && loading` branch — cleared in the
    existing `handleDayChange` choke point, cleared on a successful bulk action (which also exits select mode),
    and **derived against the currently loaded `entries`** so a vanished id drops out instead of failing the
    whole request. All three are correctness requirements, not polish — reasoning in §3.4.
  - **Reuse of `CopyGroupDialog` and `SaveGroupAsMealDialog` for both bulk actions**, parameterizing only their
    group-specific wording (submit label + the two "this group" strings) **with defaults that preserve the
    existing group call site's rendered text byte-for-byte**, plus doc-comment updates naming both call sites.
    One bulk expander open at a time.
  - **Updating `e2e/phase8-acceptance.spec.ts`'s "multi-select was NOT built" test in the same change** (§6).
  - **Two Phase 8 qa notes folded in as small additions** (§3.4/§4/§6; both UI-only, both in files this phase
    already opens, neither reopening Phase 8's reviewed diff):
    - **N-3 — no stale error on reopen.** `CopyDayDialog`'s open-panel body (its `toDate`/`state`/`pending`)
      moves into a subtree the `open` flag conditionally renders, so closing unmounts it and reopening mounts a
      fresh one. **The same rule applies to this phase's own bulk expanders.** The governing flag must be driven
      **only** by the user's open/close toggle — never by `loading`, a fetch nonce, `entries.length`, or the
      selection — or it reintroduces the state-wiping bug this phase is otherwise guarding against.
    - **N-4 — "Log again" names its destination.** When `today !== selectedDate`, `FoodDayView`'s "Log again"
      confirmation names the destination date, mirroring `handleCopied`'s existing copy-toast wording. Behaviour
      is unchanged: it still logs to today, and the view still **stays** on the day being browsed (switching the
      view was rejected — §4). **Write this toast using `formatDateLabel` from the start** (below) — not raw ISO.
  - **Editing-row highlight (§3.4/§4; Jeff's sixth manual-testing finding, 2026-08-01) — same commit as the
    multi-select work, since both add a per-row visual state to this list and both suppress per-row actions.**
    `FoodDayView` passes a new **`editingEntryId: string | null`** (the id, **not** the entry object — an
    identity comparison breaks after the first background refresh, §3.4); `FoodEntryList` gives the matching row
    a `border-l-4 border-l-sage-deep` bar and a visible **"Editing"** label, **no surface fill** (the
    `bg-sage-pale` "From a saved meal" badge would vanish into one), and **hides that row's** "Log again"/
    "Edit"/"Delete". No new colours, no live region, no second `scrollIntoView`.
  - **Optional time override on `CopyGroupDialog` (§3.3/§3.4/§4; Jeff's fourth manual-testing finding,
    2026-08-01).** A "Copy to time" `<select>` — the same 96 `quarterHourOptions()` values every other time
    control uses — preceded by a `value=""` **"Keep original time(s)"** sentinel which is the **default**, so
    current behaviour is unchanged unless the user opts in. Both call sites (group header and selection bar) get
    it. A one-line note discloses the single-group collapse **only** when the source spans more than one
    instant. **No action-layer change** — verified against `copyFoodEntries`: optional `toTime`, `""` already
    normalized to omitted, 15-minute grid already validated server-side, cap keyed off `toDate` alone.
    **`CopyDayDialog` deliberately does not get it** (§3.4).
  - **Human-readable date format (§3.3/§3.4/§4; Jeff's second manual-testing finding, 2026-07-31).** Add the
    pure `formatDateLabel(isoDate)` to `lib/domain/datetime.ts` (a plain string reorder — **not** via
    `new Date()`, which is an off-by-one bug here) with unit tests, and apply it at the **three** audited
    display sites: `FoodDayView`'s copy toast, `CopyDayDialog`'s explanatory line, and the new N-4 toast. Update
    the **five** stale ISO assertions in `e2e/phase8-acceptance.spec.ts` in the same change (§6). **Explicitly
    not touched:** any ISO date *value* (input `value`/`max`, `DATE_PATTERN`, comparisons, the future-day cap,
    `?range=`), the six native `<input type="date">` controls, and the chart axis/tooltip labels — see §3.4 for
    why each would be a regression rather than a fix.
  - **Transient success-feedback restyle (§3.4/§4; Jeff's third manual-testing finding, 2026-07-31) — as its
    own commit.** New `components/ui/StatusMessage.tsx` (left-accent banner, `role="status"`, opt-in
    `autoDismissMs`, exported `SUCCESS_MESSAGE_MS = 6000`), adopted by `FoodDayView` (including 8b's own bulk
    confirmations, from birth) and `SettingsForm`; `FoodDayView`'s dismiss timer re-keyed on a per-message nonce
    so a repeated message gets a full duration. **Explicitly reverses the *shape* half of the 2026-07-25
    visual-identity call on `SettingsForm`'s pill while keeping its *colour* half** — say so in the record.
    **The two status pills stay pills** (`MetricForm`'s "Already logged", `FoodEntryList`'s "From a saved
    meal") — that distinction is the change. **Optional, Jeff's yes/no:** give `MetricForm` a real "Weight
    saved." message, which it has never had (§3.4).
- **Out — say no to all of these explicitly:** any change to `copyFoodEntries`, `createMealFromEntries`, or any
  other server action; any change to `lib/domain/*`; any schema change, migration, or index. A per-group "select
  all in this group" checkbox, and a day-level "Select all" (§4 — both rejected with reasons; easy follow-ons,
  not smuggled in). Always-visible checkboxes / row-click-to-select (§4). A sticky or floating selection bar, or
  any other new layout pattern; a modal (this codebase still has no modal precedent). **Bulk *delete* or bulk
  *edit*** — this phase adds selection for two *additive* actions only; a bulk delete is destructive, has no
  undo anywhere in this app, and deserves its own design round rather than riding in on shared plumbing.
  Selection persisting across a day change or a page reload. Any cap or upper bound on selection size (the same
  deferred `entryIds`-size class as Phase 7b N-2 / Phase 8 N-7 — noted, not solved here). Any dashboard
  copy/quick-add control (§4 descope). Any change to `/meals` or the saved-meals surfaces.
- **§6 scope for qa-reviewer:** unit — **`formatDateLabel` only** (the multi-select feature itself adds no pure
  logic; if any *other* helper appears in `lib/domain/*`, that is a deviation worth questioning, not a bonus) — plus
  `formatDateLabel`'s own cases in §6, including the negative-offset-timezone row that catches the off-by-one a
  `new Date()`-based implementation would introduce. Acceptance — the whole *"Multi-select bulk
  actions"* block in §6, with **three rows to hammer**: **(1) selection, select mode, an open bulk expander and a
  typed-but-unsubmitted meal name all survive a background refresh** — the bug class that has now shipped broken
  twice in this repo (`MealsView` Phase 7, `FoodEntryList` Phase 7b) and had no automated assertion either time;
  **(2) "Copy selected" copies exactly the ticked set across group boundaries** — assert the ticked entries'
  group-mates were *not* copied and that the result lands as multiple groups on the target day, since a naive
  "rows appeared" check passes even if whole groups were copied; and **(3) saving a selection as a meal leaves
  the source `food_entries` byte-identical** (including `updated_at` and `logged_from_meal_id`) — Phase 7b's
  read-only invariant must hold for a selection source, not just a group source. Also run the *"Copy-flow
  feedback fixes"* rows (N-3/N-4) in the same block — note the N-3 and refresh-survival rows are deliberately
  asserted **together**, because a wrongly-keyed unmount passes one and fails the other — plus the
  *"Transient success feedback"* and *"Human-readable date format"* rows for Jeff's two other findings folded
  into this phase. Carried-forward Phase
  7b, 7c and 8 rows must keep passing unchanged: this phase touches no action and no domain module, so a
  regression there means it reached somewhere it shouldn't have. **`CopyDayDialog`'s existing Phase 8 rows in
  particular must stay green** — N-3's fix restructures that component, so a copy-day regression is the
  most likely place for this phase to break something already approved.
- **Manual-browser check (do not skip — this is the third component in this app to hold state a refresh can
  wipe, and the first two both shipped broken):** enter select mode, tick two entries in different groups, open
  "Save selected as a meal", type a partial name, then add an unrelated entry through the normal form to force a
  real background refresh — confirm select mode, both ticks, the open expander and the typed name all survive.
  Then confirm the bulk expander's `<form>` is not nested inside `FoodEntryForm`'s by **actually clicking Save**,
  not by reading the JSX (the Phase 6 nesting bug is a rendered-DOM failure that mocked tests do not surface).
  Also reproduce **N-3 by hand before and after the fix** (rejected copy → close → reopen; the stale error was
  found live, not by a test), and **N-4 from a real past day**, confirming the toast names the destination while
  the view stays put. Finally, drive it once on a phone-sized viewport: the density argument in §4 is the reason
  select mode exists, so it is worth confirming the mode actually delivers the uncluttered row it was chosen for.

### Phase 8c — Log a saved meal from the `/meals` library (2026-08-01 addition)

**Why its own phase, and why here.** Jeff's fifth manual-testing finding, and the only one of the five that is a
**new capability** rather than a fix, a restyle or a missing control on something Phase 8b already opens. It adds
a new action surface to `/meals` — a screen 8b never touches — with its own trigger, expander, defaults, success
state, cap exposure and acceptance rows. Folding it into 8b would blur that checkpoint's qa scope across two
unrelated features (the same reasoning §8 Phase 7c gives for not folding *itself* into Phase 8), onto a phase
already carrying multi-select, two bulk actions, two qa notes, a date-format change and a success-message
restyle. §4 has the full call, including the file-reach criterion applied across all five findings and the
contrast with "Save selected as a meal", which stays *inside* 8b precisely because it is not independently
shippable. **Numbered 8c** so every existing "Phase 9" reference stays correct — the convention 7b, 7c and 8b
established. **Jeff can overrule this**: if he wants it inside 8b, it should at minimum be its own commit with
its own §6 block.

**Dependencies: Phase 7 (hard) and Phase 8b (soft but real).** It calls `logMealForDay` and renders on
`MealList`, so Phase 7 must exist. Its success confirmation uses the `StatusMessage` primitive **Phase 8b
introduces**, so running it before 8b would mean building that component twice — which is why it is placed
immediately after rather than anywhere else. It shares **no files** with 8b, so the two cannot conflict.

**Confirmed before designing, not assumed: this is UI-only.** `logMealForDay(prevState, formData)` already
exists with exactly the needed shape (FormData carrying `mealId`/`logDate`/`logTime`/`logTz`, returning the
inserted `entries`), already stamps one shared `consumed_at`/tz across the batch, already enforces the
no-future-day cap, and already re-reads the meal through the RLS-scoped client to hold the
`logged_from_meal_id` ownership invariant. **No server-action change, no domain change, no schema change.**

- **In:** a **"Log this meal"** control on each `MealList` card, **placed first** in the card's action row
  (logging is the point of a saved meal; rename/delete/manage are maintenance), opening an **inline expander**
  under that card — one open at a time across the list. `LogMealDialog` gains an optional **`meal?: Meal`
  fixed-meal mode** (skips its own fetch and picker, renders the name as static text, submits that `mealId`),
  keeping one implementation of the date/time fields, error mapping, cap wiring and tz handling; its file name
  and `/food` behaviour are unchanged. Date `<input type="date" max={today}>` defaulting to **today**; the same
  96-option `quarterHourOptions()` `<select>` defaulting to the **floor** of the current quarter-hour. `/meals`
  resolves `today`/`tz` in a **mount-only Effect** with a matching server/first-client placeholder (its first
  ever browser-tz dependency — §3.4/§5). Success renders a `StatusMessage` naming the meal, date and time via
  `formatDateLabel`/`formatTimeLabel`, with **no refetch**.
- **Out — explicitly:** any change to `logMealForDay` or any other server action; any domain or schema change;
  a "keep original time" sentinel on this control (meaningless — a saved meal has no `consumed_at`; that
  affordance belongs only to Phase 8b's copy override); the smart same-sitting `lastConsumedAt` default (that is
  `/food` day-scoped state and does not exist here — always floor-of-now); logging **multiple** meals at once,
  or any multi-select on `/meals`; a quantity/servings multiplier on the logged meal (a plausible and frequently
  wanted follow-up, and a real design question about how it interacts with per-item quantities — **not** smuggled
  in here); navigating to `/food` after logging (the user is working in the library; moving them is the same
  rejected move as N-4's); any change to `MealList`'s expand-by-default behaviour, the `/meals` filter, or the
  two-flat-queries read strategy.
- **§6 scope for qa-reviewer:** unit — **none new** (no pure logic is added; a new `lib/domain/*` helper here
  would be a deviation worth questioning). Acceptance — the whole *"Logging a saved meal from the `/meals`
  library"* block in §6, with **two rows to hammer**: **(1) it logs the *right* meal** (seed several similar
  meals, so picking the wrong card fails rather than coincidentally passing) and **(2) success disturbs nothing
  on `/meals`** — filter still applied, cards still rendered, expanded card still expanded, no refetch — which
  is the same state-preservation failure this screen has already produced twice. Carried-forward Phase 7/7b/7c
  rows must keep passing, especially `/food`'s existing `LogMealDialog` picker path, which the fixed-meal mode
  must not alter.
- **Manual-browser check:** log a meal from `/meals` **with a filter active and a card expanded**, and confirm
  neither is disturbed; log one to a **past** date and time and confirm it lands there and appears on `/food`
  for that day as a single group; and confirm the expander renders no `<form>` inside another `<form>`.

### Phase 9 — PWA-lite shell
- **In:** `app/manifest.ts` (`display:'standalone'`, `start_url`, name/theme) + `icon.png`/`apple-icon.png`.
- **Out:** service worker / offline / sync / push (explicitly out of scope).
- **§6 scope for qa-reviewer:** *installability* (valid `manifest.webmanifest` with `display:'standalone'`,
  `start_url`, name, icons; **no service worker registered** — the online-only boundary holds).

### Autofill / password-manager hygiene (cross-cutting — one pass, not a numbered feature phase; ships and is reviewed with Phase 8b)

Raised by Jeff from real manual use (2026-07-31): password managers offer to fill and save non-identity fields
throughout the app. The convention, the exact values, and the reasoning are in §3.4 and §4; this is the
sequencing and review structure.

**Why cross-cutting rather than inside Phase 8b's diff — and why it is still 8b's checkpoint.** The work touches
essentially every form in the app, i.e. the files of **six already-approved phases** (1, 3, 4, 6, 7, 7c) that
Phase 8b otherwise never opens. Folding it into 8b's feature diff would reproduce the exact shape that produced a
**blocking B-1 in each of the last two phases** — out-of-scope edits reaching already-reviewed files inside a
phase's diff — with the reviewer unable to tell which lines are the feature. It is structurally the twin of the
Visual identity rollout below: presentation-only markup, no place in the 1→9 dependency chain, applies to
whatever screens exist when it runs. **But it is tracked as part of Phase 8b's checkpoint** (Jeff's explicit
ask): it ships with 8b, qa-reviewer reviews it in the same pass against the §6 rows, and Jeff approves both
together.

- **Required: a separate commit from Phase 8b's feature work.** This is the mechanism, not a formality — it lets
  qa-reviewer review the sweep as its own unit and lets either side be `git stash`-ed or reverted independently,
  which is the exact tool this project has twice used to prove what caused a regression.
- **In:** `autoComplete="off"` on every `<form>`; an explicit `autoComplete` on **every** `<input>`, `<select>`
  and `<textarea>` in `src/` (per the §3.4 table); the four positive identity hints on `LoginForm`/`SignupForm`.
  Known surfaces: `LoginForm`, `SignupForm`, `FoodEntryForm`, `FoodLookupPanel`, `BarcodeScanner`,
  `FoodDayView`'s Day picker, `CopyDayDialog`, `CopyGroupDialog`, `SaveGroupAsMealDialog`, `LogMealDialog`,
  `MealForm`, `MealItemForm`, `MealsView`'s filter, `MetricForm`, `SettingsForm`, `RangeSelector` if it gains a
  control, and any input Phase 8b's own `EntrySelectionBar` ends up with. **Enumerate by grep, not by this
  list** — the list is a cross-check, not the source of truth.
- **Out:** any JS, custom widget, library, or event handler (the whole point is that this is standard markup);
  unique non-standard tokens and vendor `data-*` opt-outs (`data-1p-ignore`, `data-bwignore`, `data-lpignore`) —
  **evidence-gated escalation only**, per §4, never pre-emptive; any change to a form's fields, layout, labels,
  validation or behaviour; a lint rule (§5 — the natural upgrade if the convention is ever violated twice, not
  now); and `autocomplete` values beyond the two categories in §3.4's table (no `name`, `organization`,
  `one-time-code`, etc. — this app has no such fields, and guessing at richer tokens is how a wrong one gets in).
- **§6 scope for qa-reviewer:** the *"Autofill / password-manager hygiene"* rows in §6. **The row that must not
  be got wrong is the limitation statement**: the suite proves the markup only — no password-manager extension
  exists in the CI browser — so qa-reviewer must say so explicitly rather than implying the reported symptom was
  behaviourally verified.
- **Manual check — Jeff's, and it is the only one that tests the actual complaint.** In his own browser with his
  own extensions: confirm the manager still offers to fill and save on `/login` and `/signup` (this must keep
  working — it is the half of the fix that is *positive*), and confirm it no longer prompts on the food entry
  form, meal forms, metrics, settings, the meals filter and barcode entry. Any field that still prompts is an
  **escalation trigger** (§4), recorded with the field and the specific manager — not a failed phase.

### Visual identity rollout (cross-cutting — two passes, not a numbered feature phase)

This restyles every existing screen to the palette/type/shape identity recorded in
`ai-context/DECISIONS.md` ("Visual identity: warm-paper + sage/clay palette…" and "Visual-identity
tokens live in `globals.css`…"). It is **cross-cutting**, not a feature phase: it has no place in the
1→9 dependency chain, touches only presentation (no data model, no actions, no RLS), and applies to
whatever screens exist when it runs. It can run now (Phases 1–4 exist) and any later phase's new
screens simply get built against the tokens from the start. **No application logic changes** — this
is class-name/token work only.

**Pass A — tokens + `components/ui/` source of truth + the never-styled auth pages.** Do this as one
unit because Pass B depends on it and the auth pages are the app's worst first impression.
- **`src/app/globals.css`**: add the six color custom properties on `:root` (`--paper #FBF8F1`,
  `--ink #23211C`, `--sage #A9BE8C`, `--sage-deep #5C7444`, `--sage-pale #E3EAD6`, `--clay #C97452`)
  and expose them in the existing `@theme inline` block as `--color-paper`/`--color-ink`/
  `--color-sage`/`--color-sage-deep`/`--color-sage-pale`/`--color-clay` (making `bg-paper`,
  `text-ink`, `text-sage-deep`, `ring-sage-deep`, `bg-sage-pale`, `bg-sage`, `text-clay`, etc. real
  utilities). Point `--background`→`--paper` and `--foreground`→`--ink`. **Remove** the
  `@media (prefers-color-scheme: dark)` block (light-only for v1, per the decision).
- **`src/app/layout.tsx`**: register **Fraunces** via `next/font/google` with a `--font-serif` CSS
  variable (mirroring the existing Geist setup), and wire `--font-serif` into `@theme inline` so a
  `font-serif` utility exists. Apply Fraunces only to headings/wordmark/large stat numerals; Geist
  stays the body/UI/data face.
- **`components/ui/` primitives** (the single source of truth — updating these cascades to every
  screen that already uses them):
  - `Button.tsx`: `primary` → ink fill (`bg-ink text-paper`, hover a touch lighter, focus
    `outline-sage-deep`), `secondary` → paper/white surface with `--ink` text and a soft border,
    `danger` **unchanged** (semantic red). Shape `rounded-lg` → **`rounded-full`** (pill).
  - `Card.tsx`: `rounded-xl` → **`rounded-2xl`**; `border-zinc-200`→a warm neutral border; surface
    stays white/`--paper`.
  - `NavLink.tsx`: active `bg-indigo-50 text-indigo-700` → **`bg-sage-pale text-ink`** (NOT
    `text-sage-deep` — see the DECISIONS guardrail: sage-deep on sage-pale is ~4.2:1, under AA for this
    normal-weight `text-sm`); inactive hover greys → warm-neutral equivalents.
  - `styles.ts`: `inputClass` focus ring `indigo-500`→**`sage-deep`**; `labelClass`/placeholder greys
    → warm-neutral; `errorTextClass` **unchanged** (semantic red).
- **Auth pages — structural refactor** (`(auth)/login/{page.tsx,LoginForm.tsx}`,
  `(auth)/signup/{page.tsx,SignupForm.tsx}`, `(auth)/layout.tsx`): replace their hand-rolled
  `bg-zinc-900` submit button, raw `<input>`/`<label>`, and `text-zinc-900 underline` links with the
  `components/ui/` primitives (`Button`, `Card`, `inputClass`/`labelClass`/`errorTextClass`). The
  `bg-amber-50/amber-800` auth-callback notice on the login page **stays** (semantic warning). This is
  the pass that finally brings these two never-restyled screens into the system. Optionally place the
  single "sage arc" motif behind the auth `Card` here (once per screen — see guardrail below).

**Pass B — propagate to the already-restyled screens.** After Pass A, most of these inherit the new
look automatically through `Button`/`Card`/`NavLink`/`styles.ts`; the remaining work is swapping the
**direct** color references that bypass the primitives. Known direct references to convert (from a
grep of `indigo`/`emerald`/`bg-zinc-900`; 18 occurrences across these files):
`components/food/FoodEntryForm.tsx` (indigo ×4), `components/settings/SettingsForm.tsx` (the kg/lb
segmented control's `peer-checked:text-indigo-700` → `text-sage-deep`; the "Settings saved."
`bg-emerald-50 text-emerald-700` pill → **`bg-sage-pale text-ink`** per the decision — a deliberate
on-brand success confirmation, not a blind green swap, and distinct from the persistent semantic
red), `components/food/TodaySummary.tsx` (indigo ×2), `components/metrics/MetricForm.tsx` (indigo ×2),
`components/food/DailyTotals.tsx` (indigo ×1), `components/food/FoodDayView.tsx` (indigo ×1), plus the
dashboard `(app)/page.tsx`, `(app)/layout.tsx` nav shell, `(app)/{food,metrics,settings}/page.tsx`,
and `components/food/FoodEntryList.tsx` for any residual `zinc`/`rounded-lg` surfaces the primitives
don't cover. Standard mapping: `indigo-*` accent → `sage-deep` (text/link/ring) or `sage-pale`
(fill/tint); page background → `bg-paper`; body text → `text-ink`; `rounded-lg`/`rounded-xl` card
surfaces → `rounded-2xl`; buttons → the pill `Button`. **Semantic reds/ambers and field-border grays
stay.**

**Sequencing choice & justification:** two passes rather than one big-bang or a per-screen drip. Pass
A first because the tokens + primitives are the dependency for everything else and the auth pages are
the highest-impact/lowest-risk starting point (they were never in the system, so they improve most and
can't regress an already-approved screen). Pass B is then mostly mechanical utility swaps that the
primitives already do 80% of. A single combined pass would be a large, hard-to-review diff spanning
21 files; a per-screen drip would leave the app visibly half-migrated (new auth page, indigo
dashboard) for longer. Splitting at the primitives boundary keeps each pass independently reviewable
and shippable.

**Motif guardrail (carry into review):** the "sage arc" appears **at most once per screen** (auth
card, dashboard "Today so far", empty states) and never becomes repeated decoration on cards/rows —
if it starts multiplying, pull it back.

**Testing / qa for this work:** no automated test asserts on Tailwind class-names or colors (verified:
zero hits for `indigo`/`zinc-900`/`toHaveClass`/`rounded-lg` across `e2e/*.spec.ts` and component
tests), so the full unit + e2e suite must stay green unchanged — a red here means logic was touched,
which this work must not do. Verification is therefore: (1) suite stays green; (2) a manual
browser walk of every screen (dashboard, food, metrics, settings, nav, both auth pages) confirming no
stray indigo/zinc remains and the auth pages now use the primitives; (3) an accessibility spot-check
of the contrast-sensitive combos — active `NavLink` (`ink`-on-`sage-pale`), focus rings
(`sage-deep`-on-`paper`), and that no text uses `--sage` or small `--clay`. Because this is
cross-cutting presentation, qa-reviewer reviews it as a standalone change against the two DECISIONS
entries + this section, not as a numbered §6 phase row.

**On the ordering (architect's read):** the dependency order is sound — Foundation → schema/RLS is the right
base, and isolating RLS in its own hardened checkpoint (Phase 2) before any feature is the highest-value
sequencing decision here. Two things to keep in mind rather than reorder: (1) Phase 3's `FoodEntryForm` must
be built with a clean seam to accept a `FoodCandidate` prefill later, so Phase 6 slots in without a rewrite —
called out in Phase 3's scope. (2) Saved meals (Phase 7) intentionally follows lookup (Phase 6) so
`MealItemForm` can reuse the finished `FoodLookupPanel`; if lookup were deferred, meal items would just start
manual-only and gain lookup later — but keeping 6→7 avoids reworking `MealItemForm`. Everything after Phase 3
(metrics, charts, lookup, meals, copy) is independent enough that Jeff can resequence 4–8 by priority if he
wants the barcode scanner or charts sooner — only Phases 1→2→3, 6→7, 7→7b, and 7b+8→8b are hard dependencies.
(3) **Phase 7b (2026-07-30) is a genuine new hard dependency on 7, not a resequencing option** — it writes
`meals`/`meal_items` rows, so the tables and CRUD must exist first. It is placed *before* Phase 8 by choice
rather than necessity: the two share the `FoodEntryList` group-header surface, and doing 7b first means Phase 8
adds a button to an action bar that already exists. (4) **Phase 7c (2026-07-30) depends on 7 and on nothing
else** — it restyles how Phase 7's saved-meals surfaces list and find meals. It shares **no files** with Phase
8, so 7c↔8 is a free ordering choice; 7c-before-8 is a recommendation only (see Phase 7c above for both sides).
(5) **Phase 8b (2026-07-31) depends hard on *both* 7b and 8** — it calls `createMealFromEntries` (7b) and
`copyFoodEntries` (8) and layers onto the `FoodEntryList` surface both of them extended, so it cannot precede
either. It has no relationship to Phase 9 in either direction, so **8b↔9 is a free ordering choice**; 8b first
is a recommendation only, because 9 is small, isolated and presentation-only, and nothing waits on it.
(6) **Phase 8c (2026-08-01) depends hard on 7 and softly on 8b** — it calls Phase 7's `logMealForDay` and
renders on Phase 7's `MealList`, and its success toast uses the `StatusMessage` primitive **8b introduces**, so
running it before 8b would mean building that component twice. It shares **no files** with 8b, so the two cannot
conflict; 8c-immediately-after-8b is the recommendation, and 8c↔9 is another free ordering choice.

---
**Definition of Done for this feature:**
All 13 phases in §8 (1–9 plus 7b, 7c, 8b and 8c) implemented and individually approved through their per-phase checkpoint
(developer implementation + unit tests → qa-reviewer's independent acceptance tests for that
phase → Jeff's review and approval); the full §6 acceptance-test suite green in CI; and Jeff has
used the app for real day-to-day food and weight logging for several days with no data loss and
no cross-user RLS leakage observed.
