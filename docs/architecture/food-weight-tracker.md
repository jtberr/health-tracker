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
    food/FoodEntryList.tsx        ← day's entries grouped by exact consumed_at; per-group protein-% rollup; per-entry protein %; group-header action bar ("Save as meal", "Copy this group"); "Log again" (client)
    food/CopyDayDialog.tsx        ← pick a target date → copyFoodEntries(all source-day ids) (client)
    food/LogMealDialog.tsx        ← pick a saved meal + date/time (max=today, 15-min grid) → logMealForDay (client)
    food/SaveGroupAsMealDialog.tsx ← name a logged group → createMealFromEntries; inline expander, not a modal (client)
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
    domain/meal-items.ts          ← pure: groupMealItemsByMeal; computeReorderedSortOrders; mealItemsFromEntries (entries → meal-item drafts)
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
  and group-agnostic. That keeps the exact-timestamp grouping purely derived (§3.2) and means Phase 8's
  multi-select can drive this action unchanged. Passing an arbitrary subset of one's *own* entries is a
  legitimate use, not an attack: there is nothing to corrupt.
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
calories are 0). Group headers offer **"Copy this group"** (→ `copyFoodEntries(groupIds, …)`); per-entry
**"Log again"**; multi-select → "Copy selected". Meal-batch rows (shared `logged_from_meal_id`) are labeled
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

**`DailyTotals`** shows the day's total calories/protein and the **day-level protein %** using the same
ratio-of-sums function on the day's summed totals (from `daily_food_totals`). The dashboard shows the same
for today.

Other components unchanged: `CopyDayDialog`, `LogMealDialog` (its date/time picker is likewise a
`date max=today` + the same 96-value quarter-hour time `<select>`), `MealList`/`MealForm`, `MealItemForm`
(fields always visible — and note it has **no** time field at all: saved-meal items carry no `consumed_at`;
time-of-day is chosen only at log time in `LogMealDialog`, so this control change doesn't touch it),
`MetricForm` (date max=today, no time field, sends `metricTz`), `SettingsForm`, `RangeSelector`,
`WeightChart`/`IntakeChart`. The `(app)` nav has a **"Log out"** control (the only session terminator).
Installability via `app/manifest.ts` (+ icons), `display:'standalone'`, **no service worker**.

**State:** server state is Supabase; client state is in-flight form values (incl. expander state,
`lastConsumedAt` for the smart default, quantity/unit, picked candidate, multi-select set, the open
save-as-meal expander + its in-flight name), optimistic updates, chart range (URL), display-unit prop. No
global store.

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
  id list, so Phase 8's multi-select can drive it later with no action change); a "which meals came from which
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

### Phase 8 — Ease-of-entry extras (copy/repeat)
- **In:** `copyFoodEntries` (the shared primitive) and its three callers — copy-day (`CopyDayDialog`),
  per-entry "Log again", and copy-group (from `FoodEntryList` group headers / multi-select).
- **Out:** — . **Note:** the smart time default and the quarter-hour grid were already implemented in Phase 3
  (they're part of the core form), and Phase 7b already built the group-header **action bar** that "Copy this
  group" slots into, so this phase is essentially just the copy mechanisms on top of both. If the multi-select
  lands here, note that `createMealFromEntries` (7b) already accepts an arbitrary entry-id list, so "save the
  selected entries as a meal" comes for free with no action change — worth wiring, but not required.
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
wants the barcode scanner or charts sooner — only Phases 1→2→3, 6→7, and 7→7b are hard dependencies.
(3) **Phase 7b (2026-07-30) is a genuine new hard dependency on 7, not a resequencing option** — it writes
`meals`/`meal_items` rows, so the tables and CRUD must exist first. It is placed *before* Phase 8 by choice
rather than necessity: the two share the `FoodEntryList` group-header surface, and doing 7b first means Phase 8
adds a button to an action bar that already exists.

---
**Definition of Done for this feature:**
All 10 phases in §8 (1–9 plus 7b) implemented and individually approved through their per-phase checkpoint
(developer implementation + unit tests → qa-reviewer's independent acceptance tests for that
phase → Jeff's review and approval); the full §6 acceptance-test suite green in CI; and Jeff has
used the app for real day-to-day food and weight logging for several days with no data loss and
no cross-user RLS leakage observed.
