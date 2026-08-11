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
      layout.tsx                  ← (Phase 8l) centred card + the app wordmark above it; no decorative motif (8i deleted the arc)
      login/page.tsx / signup/page.tsx
      forgot-password/page.tsx    ← (Phase 8m) request a reset link; neutral confirmation, never an account-existence oracle
      reset-password/page.tsx     ← (Phase 8m) set a new password; server-side session check first (no session → "link expired", not a dead form)
    (app)/                        ← authenticated group; layout enforces session; has a "Log out" control
      layout.tsx                  ← server-side session check → redirect /login if none; nav; signOut action
      page.tsx                    ← (Phase 8h) `redirect("/food")` — the dashboard route is retired, not rebuilt; see §3.4/§4
      food/page.tsx               ← Food log for a selected day (grouped list, add/edit/delete, log-from-meal, copy-day, copy-group, multi-select bulk actions, prev/next-day nav)
      meals/page.tsx              ← Saved-meals library CRUD + (Phase 8c) "Log this meal" + (Phase 8f) pin / duplicate per card
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
    food/EntrySelectionBar.tsx    ← Phase 8b: "N selected" + "Copy selected" / "Save selected as a meal" / Clear / Done; (8k) rendered INSIDE the select-mode ActionPanel, and its buttons are suppressed while a bulk panel is open (client)
    food/CopyDayDialog.tsx        ← pick a target date → copyFoodEntries(all source-day ids); (8k) panel-only — the caller owns the trigger and the open state (client)
    food/CopyGroupDialog.tsx      ← pick a target date + an OPTIONAL time override ("Keep original time" default) → copyFoodEntries; serves BOTH a group header and a multi-select selection (client)
    food/LogMealDialog.tsx        ← date/time (max=today, 15-min grid) → logMealForDay; picks a meal on /food, or (Phase 8c) takes a fixed `meal` prop for /meals; (8k) panel-only in BOTH modes — every caller owns the trigger (client)
    food/DayActionBar.tsx         ← Phase 8k: the three /food day-level triggers in one row ("Log a saved meal" / "Copy this day" / "Select entries"), each with a supplementary Tooltip; renders NO panel itself (client)
    food/SaveGroupAsMealDialog.tsx ← name a logged group OR a multi-select selection → createMealFromEntries; inline expander, not a modal (client)
    food/DailyTotals.tsx          ← day sum + day-level protein %; (Phase 8j) goal-relative progress bars + "N remaining" when a target is set
    meals/MealsView.tsx           ← client orchestrator: reads meals+items, owns the name-filter box + counts (client)
    meals/MealList.tsx / MealForm.tsx / MealItemForm.tsx  ← meal CRUD; MealItemForm keeps qty/unit/per-unit always visible; MealList card row carries log/pin/duplicate/rename/delete
    meals/DuplicateMealDialog.tsx ← Phase 8f: name the copy ("<name> (copy)" prefilled) → duplicateMeal; inline expander (client)
    metrics/MetricForm.tsx / settings/SettingsForm.tsx
    trends/WeightChart.tsx / IntakeChart.tsx / RangeSelector.tsx
    ui/DayNavigator.tsx           ← Phase 8d: ‹ Previous day / date input / Next day ›, shared by /food and /metrics; "Next" disabled on today (client)
    ui/ActionPanel.tsx            ← Phase 8d: the emphasis wrapper for an inline action awaiting completion (heading + sage-deep ring + sage-pale fill)
    ui/Tooltip.tsx                ← Phase 8d: hover/focus supplementary tooltip, pointer-devices only (role="tooltip" + aria-describedby); never the sole source of a control's meaning (client)
    ui/icons.tsx                  ← Phase 8d: inline SVG glyphs (repeat / pencil / trash / pin), Lucide geometry, aria-hidden, currentColor — no icon-library dependency
    ui/StatusMessage.tsx          ← Phase 8b: transient success banner (left accent bar, role="status", 6s auto-dismiss)
    ui/ProgressBar.tsx            ← Phase 8j: thin decorative goal bar (aria-hidden; the numbers beside it carry the information)
    ui/DisclosureButton.tsx       ← Phase 8k: the standard "reveal optional detail" toggle — real button chrome + rotating chevron + aria-expanded/aria-controls (client)
    ui/Wordmark.tsx               ← Phase 8l: the one "Health Tracker" wordmark, used by the app header AND the auth layout — one source of truth for the app's name
    ui/…                          ← Button / Card / NavLink / styles.ts
  lib/
    supabase/server.ts / supabase/client.ts   ← persistent session, auto-refresh
    domain/totals.ts              ← pure: sum entries/meal items
    domain/nutrition.ts           ← pure: proteinCaloriePct((protein×4)/calories×100); used per entry, per group, per day
    domain/goal-progress.ts       ← Phase 8j, pure: goalProgress(consumed, target) → consumed/target/remaining/pct/barPct/isOver, or null when no target
    domain/entry-grouping.ts      ← pure: groupByConsumedAt — exact-timestamp grouping of logged entries (NOT saved meals)
    domain/meal-items.ts          ← pure: groupMealItemsByMeal; computeReorderedSortOrders; mealItemsFromEntries (entries → meal-item drafts)
    domain/meals.ts               ← pure: sortMealsByName (pinned-first from 8f); filterMealsByName; duplicateMealName — meal-level (not item-level) library ordering/filtering/naming
    domain/quantity.ts            ← pure: lineTotal(qty×perUnit); perUnitFromTotal(total÷qty)
    domain/datetime.ts            ← pure: local↔UTC (tz-aware), browser tz, future-day cap, smart-default consumed_at, quarter-hour floor + option groups, day shift, validate
    domain/validation.ts / domain/units.ts / domain/trends.ts / domain/lookup.ts
    domain/auth-validation.ts     ← pure: login/signup rules + (Phase 8m) validateForgotPasswordInput / validateNewPasswordInput
    domain/safe-redirect.ts       ← pure: safeRedirectPath — the `?next=` open-redirect guard the auth callback (and 8m's reset link) relies on
    lookup/openfoodfacts.ts / lookup/usda.ts   ← server-only provider adapters
    actions/food.ts               ← 'use server': add/update/delete + copyFoodEntries (shared copy primitive)
    actions/meals.ts              ← 'use server': meal/item CRUD; logMealForDay (meal → entries); createMealFromEntries (entries → meal); setMealPinned; duplicateMeal (meal → meal)
    actions/metrics.ts / actions/goals.ts
    actions/auth.ts               ← 'use server': signIn / signUp / signOut + (Phase 8m) requestPasswordReset / updatePassword
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

**Pinned saved meals — the one schema change in this batch (2026-08-05, Phase 8f).** Everything else designed
since Phase 7 has been "no migration"; this genuinely needs one, because "which meals are my shortlist" is user
state with nowhere to live. **One column, one migration:**

```sql
alter table public.meals
  add column is_pinned boolean not null default false;
```

- **Boolean, not `pinned_at timestamptz`.** A timestamp would additionally record *when* — but the design below
  orders the pinned block **alphabetically**, exactly like the unpinned block, so nothing would ever read that
  value. Storing a column nothing reads is precisely what §3.2 already rejected for save-as-meal provenance;
  the same reasoning applies to itself here. If recency-of-pin ordering is ever wanted, it is a one-line
  migration *then*, made for a reason, rather than speculative state carried from now until then.
- **No new RLS policy is required, and this is a claim to check rather than assume.** AGENTS.md's Absolute Rule
  is that *every new table* ships with RLS in the same migration; this is an **ALTER on an existing table** whose
  RLS is already enabled with all four `user_id = (select auth.uid())` policies, and whose `authenticated` grant
  is table-level (`grant select, insert, update, delete on public.meals`), so the new column is covered by both
  the moment it exists. Concretely: `meals_update_own` already constrains an `is_pinned` update to rows the
  caller owns on both `using` and `with check`, so a user can pin only their own meals, and the column is
  invisible to anyone else's `select`. **qa-reviewer should verify this by querying the policies after the
  migration, not by reading this paragraph.**
- **No backfill, no index.** `not null default false` fills existing rows in the same statement. A partial index
  (`where is_pinned`) is deliberately **not** added, for the same reason 7c declined its two candidate indexes:
  the query is a full RLS-scoped read of tens of rows that Postgres will scan regardless, and the pinned/unpinned
  split happens client-side in `sortMealsByName`, not in SQL.
- **`Meal` gains `is_pinned: boolean`** in `lib/types.ts`. Both existing `meals` queries are `select("*")`, so
  neither changes.

**Duplicating a saved meal adds no schema (2026-08-05, Phase 8f)** — it writes one `meals` row and N `meal_items`
rows using columns Phase 7 already created, copy-by-value, with **no provenance column in either direction**
(no `meals.duplicated_from_id`). Identical reasoning to save-as-meal above, and the same falls-out invariant:
`meal_items.calories`/`protein_g` are STORED generated columns, so copying only the per-unit inputs makes the
duplicate's totals equal the source's **by construction**.

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

**Password reset — two new Server Actions, no new Route Handler (2026-08-11 addition, Phase 8m).** Both live in
the existing `lib/actions/auth.ts` beside `signIn`/`signUp`/`signOut`, are `'use server'`, and never touch the
service-role client or any application table — this is pure Supabase Auth, so RLS and `user_id` are not
involved at all (the only Absolute Rules in play are "server-side only" and "no user data to third parties").

```ts
// lib/actions/auth.ts — both reuse the existing AuthActionState shape ({ error, fieldErrors?, info? }),
// so both forms are ordinary useActionState clients exactly like LoginForm/SignupForm.

// Sends Supabase's built-in recovery email. The link lands on the EXISTING /auth/callback with a
// ?code=, which exchanges it for a session and forwards to ?next=/reset-password.
// ALWAYS returns the same neutral `info` on success — never "no account with that email".
export async function requestPasswordReset(prev: AuthActionState, formData: FormData): Promise<AuthActionState>;
//   supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` })

// Sets the new password for whoever the CURRENT session is. The recovery session was minted by the
// callback's code exchange, so there is nothing extra to verify here beyond "is there a session".
// On success: signOut() then redirect("/login?reset=success").
export async function updatePassword(prev: AuthActionState, formData: FormData): Promise<AuthActionState>;
//   supabase.auth.getUser() → no user ⇒ { error: 'reset_session_missing' }; else updateUser({ password })
```

```ts
// lib/domain/auth-validation.ts — two pure validators, reusing the existing isValidEmail /
// isValidPassword / MIN_PASSWORD_LENGTH rules rather than restating them. The FieldError union
// ("email" | "password" | "confirmPassword") is UNCHANGED — both new forms reuse those field names.
export function validateForgotPasswordInput(input: { email: string }): ValidationResult;
export function validateNewPasswordInput(input: { password: string; confirmPassword: string }): ValidationResult;
```

**`auth/callback/route.ts` needs no code change, and that was confirmed by reading it rather than assumed.** It
already accepts `?next=`, already validates it through `safeRedirectPath` (so `?next=//evil.com` cannot send the
browser off-origin), and already exchanges `?code=` server-side where cookies *can* be written. A recovery link
is the same PKCE code-exchange the signup-confirmation link already performs successfully today. **One string
does change**: the `?error=auth_callback_failed` notice on `/login` currently reads *"That confirmation link is
invalid or expired. Try logging in, or sign up again."*, which is signup-specific and now also fires for an
expired reset link. It is generalised — and **must keep the substring "invalid or expired"**, because
`e2e/phase1-acceptance.spec.ts` asserts `getByText(/invalid or expired/i)` and that assertion is still correct.

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

// 2026-08-05 addition (Phase 8d) — the whole of the Previous/Next-day buttons' logic.
// "2026-07-29" +1 → "2026-07-30"; crosses month, year and leap-day boundaries correctly.
// MUST use Date.UTC on the split parts (the same technique lib/domain/trends.ts already uses for
// its range windows) and MUST NOT go via `new Date(iso)`, which parses as UTC midnight and then
// reports LOCAL calendar fields — the identical off-by-one trap formatDateLabel and
// chartTheme.parseCalendarDate already exist to avoid. Pure calendar arithmetic: no tz argument is
// needed or wanted, because the caller already holds an ISO local date and wants the adjacent one.
// Anything not matching YYYY-MM-DD is returned unchanged (never throws, never yields "NaN-NaN-NaN").
export function shiftIsoDate(isoDate: string, deltaDays: number): string;

// 2026-08-05 addition (Phase 8e) — the same 96 options, partitioned for scanning. PRESENTATION
// ONLY: every option keeps its 24-hour `HH:MM` value and its zero-padded 12-hour label, all 96 stay
// present, selectable and in order, and concatenating the groups' options must equal
// quarterHourOptions() exactly (asserted in §6 — that identity is what proves nothing was lost).
// `deEmphasized` is a hint the caller may render as dimmer option text where the platform honours
// <option> CSS; it carries no behaviour (§3.4/§4).
export type QuarterHourGroup = { label: string; deEmphasized: boolean; options: { value: string; label: string }[] };
export function quarterHourOptionGroups(): QuarterHourGroup[]; // 3 groups: 24 / 56 / 16 options
// Which group an arbitrary (possibly off-grid, legacy) time belongs to — needed so FoodEntryForm's
// edit invariant can inject an off-grid option into the RIGHT group instead of dropping it.
export function quarterHourGroupIndexFor(value: string): number;
// (existing, unchanged and still exported) quarterHourOptions — the flat list.

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
// AMENDED 2026-08-05 (Phase 8f): now partitions PINNED meals ahead of unpinned ones, then applies
// the identical existing comparator WITHIN each partition. Pinning changes which block a meal is
// in and nothing else — the pinned block is alphabetical too, so pinning meal B never moves meal A.
// The name is deliberately NOT changed to sortMealsForLibrary: renaming ripples through two call
// sites and two test files for cosmetic gain (the same call made for CopyGroupDialog in 8b); the
// doc comment carries the meaning instead.
export function sortMealsByName(meals: Meal[]): Meal[];               // returns a new array; does not mutate
// Case-insensitive AND-of-whitespace-separated-tokens substring match on `meal.name` only.
// Empty/whitespace-only query → returns the input order unchanged (identity, not "no results").
// Substring, not prefix, so "rice" finds "Chicken and rice"; no fuzzy/trigram matching (§4).
export function filterMealsByName(meals: Meal[], query: string): Meal[];

// 2026-08-05 addition (Phase 8f) — the duplicate's prefilled name. `"Weekday breakfast"` →
// `"Weekday breakfast (copy)"`. Deliberately does NOT try to produce a unique name: meals.name has
// no uniqueness constraint and duplicate names are explicitly legitimate (§5), so hunting for
// "(copy 2)" would be inventing a rule the data model doesn't have. Duplicating a duplicate simply
// yields "... (copy) (copy)" — visibly silly, which is the correct nudge to rename it.
export function duplicateMealName(name: string): string;
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

**`setMealPinned` and `duplicateMeal` — the two new actions (2026-08-05 addition, Phase 8f).** Both live in
`lib/actions/meals.ts` beside their siblings and both follow that file's established shape rather than inventing
one.

```ts
// A toggle, not a form — so a plain-argument action like deleteMeal/reorderMealItems, NOT
// useActionState/FormData. Ownership: `.eq('id', mealId).eq('user_id', user.id)` on top of RLS,
// the belt-and-suspenders posture every mutation in this file already uses.
setMealPinned(mealId: string, isPinned: boolean): Promise<MealsActionResult>   // { ok, error }

// A form (it prompts for a name) — so useActionState-shaped like createMealFromEntries, and
// deliberately its structural twin so the two copy directions stay reviewable against each other.
// formData carries: mealId + name. Reuses MealActionState → { ok, error, fieldErrors?, meal? }.
duplicateMeal(prevState: MealActionState, formData: FormData): Promise<MealActionState>
```

- **`duplicateMeal` takes an id and re-reads, never values.** Source meal and its items are resolved through
  the **RLS-scoped server client** (`meals` by `.eq('id', mealId).eq('user_id', user.id)`, then `meal_items` by
  `.eq('meal_id', mealId).eq('user_id', user.id)` ordered by `sort_order`) — never service-role, never a
  client-supplied item list. A foreign or nonexistent `mealId` resolves to zero rows → **reuse the existing
  `meal_not_found` code** (`logMealForDay`'s), rather than minting a new one for the same condition.
- **Blank name → the existing `validateMealInput` field error**, checked before any write. No new validator.
- **Copy-by-value, and `sort_order` is *preserved*, not renumbered.** The five value columns
  (`name`/`quantity`/`unit`/`calories_per_unit`/`protein_g_per_unit`) plus the source item's own `sort_order`.
  **This is the one place a developer is likely to mechanically reach for the wrong helper:**
  `mealItemsFromEntries` *assigns* `0..N-1` because food entries have no order of their own — a saved meal
  already carries a user-curated one, and reproducing it is the entire point of a duplicate. The generated
  `calories`/`protein_g` are never copied (they can't be), so the duplicate's totals equal the source's by
  construction (§3.2). `id`, `user_id`, `meal_id` and the timestamps are all fresh.
- **`is_pinned` is NOT copied — the duplicate always starts unpinned.** Stated explicitly because it is the
  first thing a reader will wonder. Pinning is a statement about *your current shortlist*, not a property of the
  meal's content; a duplicate exists to be edited into something else, and silently arriving pre-pinned would
  push a half-finished meal to the top of the library. One click restores it if wanted.
- **An empty source meal (zero items) duplicates successfully**, producing an empty meal. Deliberately *not*
  rejected the way `createMealFromEntries` rejects `no_entries`: an empty meal is a legitimate stored state that
  `createMeal` itself produces (create a meal, add items later), so refusing to duplicate one would be an
  arbitrary asymmetry. Nothing downstream is at risk — `logMealForDay` still refuses to log it (`empty_meal`).
- **Atomicity: the same compensating delete, reusing the settled decision rather than re-litigating it.** Two
  statements again (`INSERT INTO meals … RETURNING`, then one multi-row `INSERT INTO meal_items`); on
  item-insert failure the action deletes the just-created meal and returns the error. Same contract, same
  knowingly-accepted residual empty-meal state in the doubly-unlucky case (§5), same reason for no RPC (§4).
  Skipped only when the source had zero items, where there is no second statement to fail.
- **Strictly read-only on the source.** No UPDATE, no DELETE, no relink against the source `meals` row or its
  `meal_items` — the same code-review checkpoint as `createMealFromEntries`, since no schema constraint can
  express it, and the same §6 evidentiary bar (source rows byte-identical, `updated_at` included).

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

**Previous / Next day navigation on `/food` and `/metrics` (2026-08-05 addition, Phase 8d).** Jeff's first
manual-testing finding of this round: changing the viewed day means opening a native date picker every time,
when the overwhelmingly common move is ±1 day. Both screens hold the selected day as plain client state
(`FoodDayView.selectedDate` via `handleDayChange`, `MetricForm.selectedDate`), so this is a control plus one
pure helper — no action, no query, no schema.

- **One shared `components/ui/DayNavigator.tsx`, two call sites** — not two hand-rolled rows. The future-day
  cap, the disabled rules and the wording must be identical on both screens, and this codebase has repeatedly
  chosen one implementation with a mode over a second hand-copied copy (`LogMealDialog`'s fixed-meal mode,
  `StatusMessage`, `CopyGroupDialog` serving two callers). It lives in `ui/` rather than `food/` precisely
  because it is now shared by two features. Props: `value`, `today`, `onChange(date)` — it owns no state.
- **Layout: exactly two buttons — `‹ Previous day` | the existing `<input type="date" max={today}>` |
  `Next day ›`.** The date input is **kept, not replaced** — it is still the right tool for "jump to three weeks
  ago", and removing it would trade one friction for a worse one. **A "Today" button was designed and then
  dropped (Jeff's call, 2026-08-05):** it is a third control on a row that reads better as two, the date picker
  already reaches today in one interaction, and "Previous" is the overwhelmingly common direction of travel.
- **"Next day" is `disabled` when the viewed day is `today`.**
  Disabled, not hidden: the same call `EntrySelectionBar` makes for its N = 0 bulk buttons ("the affordance stays
  discoverable and its own enablement explains the precondition") and the same one `MealList`'s item ↑/↓ arrows
  already make at the ends of a list. **This is the one way the new control could create a state the rest of the
  app forbids**, so it must compare against the *same* `today` value the input's own `max` uses — never a
  separately-derived one — so the two can never disagree about where the cap is.
- **"Previous" has no lower bound**, deliberately. There is no "earliest entry" concept anywhere in the app, and
  establishing one would need an extra query per screen to answer a question nobody asked; viewing an empty past
  day is already a well-defined, harmless state with its own empty-state copy.
- **`shiftIsoDate` (§3.3) does the arithmetic, and must not use `new Date(iso)`** — that parses as UTC midnight
  and then reports *local* calendar fields, so "previous day" from `2026-03-01` in a negative-offset zone would
  land two days back. This is the third time this exact trap has come up in this doc (`formatDateLabel`,
  `chartTheme.parseCalendarDate`), which is why the helper is pure and unit-tested rather than three inline
  `setDate(-1)` calls.
- **Accessibility: real visible text, so no `aria-label` is needed or wanted.** The visible labels are
  **"Previous day"** and **"Next day"** in full (the `‹`/`›` glyphs are decoration, `aria-hidden`). Spelling the
  labels out means the accessible name *is* the visible text, which sidesteps WCAG 2.5.3 (Label in Name)
  entirely rather than merely satisfying it — an `aria-label` that differs from visible text is a common way to
  break voice control, and there is no reason to introduce one here. On `/food` the day change already resets
  `lastConsumedAt`, `editingEntry`, `savedMessage` and the
  selection through the single `handleDayChange` choke point, and these buttons **must call that same handler**
  rather than `setSelectedDate` directly — bypassing it would resurrect exactly the stale-selection hazard §3.4
  centralised that choke point to prevent.
- **This is NOT a fix for the open `Day`-input race, and must not be recorded as one.** The documented flake
  (`ai-context/PROGRESS.md`, ten reproducing e2e cases) is a `.fill()` on the controlled `<input type="date">`
  not taking effect against a long-hot dev server. These buttons change the day through a plain React `onClick`
  with no native-input round-trip, so tests driven through them are very unlikely to hit it — a genuine
  convenience for qa-reviewer, and the reason §6 prefers them for *new* rows. But the input remains, users still
  use it, and the bug stays open. **The one real benefit worth recording: it becomes a diagnostic lever** — if
  button-driven day changes are reliable while `.fill()`-driven ones are not, that localises the fault to the
  controlled-input value path, which is precisely the standing hypothesis (§5).

**An active group suppresses its rows' actions and is visually marked (2026-08-05 addition, Phase 8d).** Jeff's
third finding: with "Copy this group" open, every entry inside that group still shows "Log again"/"Edit"/"Delete",
so it is unclear what the open panel applies to. This is not a new rule — it is **the rule Phase 8b already
wrote down, applied one level up**: *when a row is in a special state, its ordinary actions are suppressed
because another surface owns them* (the editing row; select mode). A group with an open expander is in exactly
that state, and its rows are inside the thing being acted on.

- **While a group's expander is open: that group's rows hide their own "Log again"/"Edit"/"Delete"**, and the
  group's *other* header action is hidden too (an open copy panel hides "Save as meal" on that header, and vice
  versa). `FoodEntryList` already tracks `groupAction: { key, kind } | null`, so this is a derived
  `isGroupActive` threaded into the existing `!selectMode && !isEditingRow` condition — no new state.
- **Other groups are untouched and stay fully live.** Opening group B's expander already closes group A's
  (`groupAction` is a single slot), so there is never more than one active group; copying group B while
  A's panel was open is a legitimate, unchanged flow.
- **Extend it to "Save as meal" too, not just copy.** Jeff mentioned only copy, but the two are the same
  interaction on the same header driven by the same state, and treating them differently would make the rule
  unstatable and the behaviour arbitrary. Both, or the rule isn't a rule.
- **Mark the active group with the level-1 emphasis treatment: a `border-l-4 border-l-sage-deep` bar on the
  group's `<section>`**, surface unchanged — the same vocabulary and the same "no fill" reasoning as the editing
  row (a `bg-sage-pale` group would swallow the `bg-sage-pale` "From a saved meal" badges inside it, which is
  the identical collision 8b avoided at row level).
- **Non-colour perception, and why no extra text label is needed here.** The editing row required a visible
  "Editing" label because *nothing else on screen said so*. Here the state is already carried by real content:
  an expander is open directly under that header, `ActionPanel` (below) gives it a visible heading naming the
  action, and the header's own toggle has changed. The accent bar is **reinforcement, not the sole carrier** —
  which is the same test §3.4 used to decide against a live region for the editing highlight (is the state
  otherwise perceivable?). Stated explicitly so a reviewer can check the reasoning rather than the colour.
- **Fold in the long-deferred duplicate-"Cancel" note while this header is open anyway (Phase 7b N-3, recurring
  as Phase 8 N-5).** With an expander open, the header toggle reads "Cancel" *and* the panel has its own
  "Cancel" — two identically-named buttons in one group, raised twice as non-blocking and never fixed. **The
  header toggle becomes "Close"** (qa-reviewer's own suggestion), leaving exactly one "Cancel" per open panel.
  `MealList`'s per-card toggles have the identical shape (`isLogging ? "Cancel" : "Log this meal"`) and get the
  same treatment in Phase 8f, so the app ends up with one rule rather than one fixed instance.

**Inline actions awaiting completion get real emphasis — `components/ui/ActionPanel.tsx` (2026-08-05 addition,
Phase 8d).** Jeff's fourth finding: after clicking "Copy selected", the panel that opens "blends into the rest of
the day's log — the user doesn't know where to look to finish the action." Confirmed by reading the components:
neither `CopyGroupDialog` nor `SaveGroupAsMealDialog` renders any heading at all; each opens straight into a
grey preview block and some fields, on the same white surface as everything around it.

**The emphasis ladder — three levels, no new tokens.** This is the reusable rule, stated once here so the next
addition doesn't invent a fourth treatment:

| Level | Treatment | Means | Used by |
|---|---|---|---|
| 1 | left accent bar only, surface unchanged | "this row/section is in a notable state" | active group (above) |
| 1+ | left bar + **inset `sage-deep` ring** + a filled `sage-deep`/`paper` pill, surface still unchanged | "this row is the one you are acting on right now" | editing row (8b, strengthened in 8g) |
| 2 | left accent bar + `sage-pale` fill + icon | "a transient message" | `StatusMessage` (8b) |
| 3 | **full `sage-deep` ring + `sage-pale` fill + a visible heading** | **"an action is waiting for you to finish it"** | `ActionPanel` (8d) |

**Level 1+ was added (2026-08-07, Phase 8g) rather than renumbering the ladder**, so every existing "level 1/2/3"
reference in this doc and in component doc comments stays correct. It is deliberately *enclosure without fill* —
the editing row cannot take a `sage-pale` surface (it would swallow the `bg-sage-pale` "From a saved meal" badge
inside it), so the one axis left to escalate on is enclosure, which is the same answer the "why a full ring
rather than a louder colour" note below gives for level 3.

- **Why a full ring rather than a louder colour.** The honest answer to "make it stronger" inside this project's
  recorded palette is to *enclose* the panel, not to escalate hue. `--clay` was the obvious candidate and is
  **rejected on the record**: the token table restricts it to "positive emphasis only (streaks, milestones)",
  it is the weakest-contrast token (3.2:1, large/fill only), and using it for a pending action would make clay
  mean two unrelated things. `--sage` is decorative-fill-only and cannot carry a border's meaning. So:
  `border border-sage-deep` (4.9:1 on white — non-text, clears the 3:1 bar with margin) around a `bg-sage-pale`
  surface with **`text-ink`** content (~13:1). Same guardrail `StatusMessage` threads: `sage-deep` never becomes
  small text on `sage-pale`.
- **Colour is the least important part of the fix.** "The user doesn't know where to look" is most reliably
  answered by *putting the panel where they are looking*: on open, `ActionPanel` **scrolls itself into view**
  (`block: "nearest"`) and **focus moves to its first control**. This is not the rejected second-`scrollIntoView`
  from 8b (that was two competing scroll targets for one action); it is one scroll for one action, and moving
  focus into a newly-revealed disclosure is the conventional behaviour that also serves keyboard and
  screen-reader users, who get no benefit at all from a ring.
- **Semantics:** `role="region"` with `aria-labelledby` pointing at its heading. **Not** a live region — the
  user opened it themselves, which is the same test applied to the editing highlight.
- **Applied to exactly these six inline expanders** (listing them is the point — the last two phases both
  produced a blocking finding for edits reaching files the phase never declared): the two **bulk** panels from
  `FoodDayView`, the two **group** panels from `FoodEntryList`, **`CopyDayDialog`**'s open body, and (Phase 8f)
  **`DuplicateMealDialog`**. `LogMealDialog`'s two call sites (`/food` and `MealList`) are the same shape and
  **also** get it, in Phase 8f, so `/meals` isn't left with a visibly different idiom.
- **Deliberately NOT applied to** `FoodEntryForm` (the page's primary, always-present form — wrapping it would
  emphasise everything and therefore nothing), the **"Add detail"** expander, or **`FoodLookupPanel`**: those are
  progressive disclosure of *optional detail*, not a discrete action awaiting completion. The distinction is the
  same one that decided which pills became banners: a treatment that applies everywhere carries no information.
- **The N-3 unmount rule still governs.** `ActionPanel` is a presentational wrapper; the in-flight state stays in
  the subtree the open flag conditionally renders, and that flag is still driven **only** by the user's own
  open/close toggle — never by `loading`, a fetch nonce, `entries.length` or the selection (§3.4, 8b).

**Per-row action density on `/food` — icons with tooltips, reconciled for touch (2026-08-05, Phase 8d).** Jeff's
sixth finding: the per-entry "Log again"/"Edit"/"Delete" text buttons are too many, and he wants icons **with
tooltips** — explicitly including "Log again", and explicitly including tooltips after the first design round
recommended against them. He tests primarily on a phone, so the reconciliation has to be real rather than a
desktop-only tooltip with a shrug attached.

**The platform fact that decides the design, stated first because everything else follows from it.** On touch
there is **no pre-activation hover state**. Tapping a button focuses *and* activates it in the same gesture, so a
focus-triggered tooltip appears at the exact instant the action fires — it can never inform the decision it
exists to inform. The only pre-activation reveal touch offers is **long-press**, which has no web API, collides
with the platform's own text-selection and context menus, and is invisible to anyone who doesn't already know a
tooltip is there. **So on a phone, an icon-only button cannot tell you what it does before you press it. That is
not a preference; it is the platform.**

**The reconciliation: icon + a short always-visible label, plus a real tooltip that adds *more* on pointer
devices.** This gives Jeff every part of what he asked for and gives touch users something that actually works:

- **Both actions are iconified, including "Log again"** (his explicit ask): a **repeat/rotate-left arrow** for
  "Log again" and a **pencil** for "Edit". The **label stays visible next to the icon at every breakpoint** —
  it is never hidden behind a media query, because hiding it on small screens would put icon-only buttons on
  exactly the devices where a tooltip cannot fire. The visible label **is** the touch tooltip mechanism (one of
  the three the coordinator named), and it is the only one of the three that costs nothing and fails never.
- **`components/ui/Tooltip.tsx` carries the *fuller* explanation on pointer devices** — not a repeat of the
  label. `Log again` → *"Log this entry again at the current time."*; `Edit` → *"Edit this entry's name,
  amount or time."* **Rule, worth stating once: a tooltip must never be the only place a control's purpose is
  stated.** If it repeats the visible label it is noise; if it is the sole source it is inaccessible. Here it is
  strictly supplementary, which is the only role a tooltip can honestly hold in an app with a touch-first user.
- **Honest accounting of what the icons buy, so this isn't oversold: scannability, not width.** An icon+label
  button is marginally *wider* than a text-only one. **The width win comes from the removed button, not the
  icons** — "Delete" moves off the row and into the edit form (below). Row goes 3 → 2. The icons make those two
  distinguishable at a glance, which is the real everyday benefit on a list of ten entries.

**`Tooltip` — the concrete spec** (this is a new shared primitive, so it is specified rather than left to the
implementation):

- **Wraps a single interactive child.** Renders a `<span class="relative inline-flex">` around it plus an
  absolutely-positioned `<div role="tooltip" id={generatedId}>` above the trigger. **No portal and no
  positioning library** (`floating-ui` et al. are declined on the standing no-new-dependency bias); accepted
  consequence, stated: near a viewport edge it may clip — on desktop only, on a supplementary affordance.
- **Trigger events: `mouseenter`/`mouseleave` and `focus`/`blur`, plus `Escape` to dismiss** while focused
  (WCAG 1.4.13 Content on Hover or Focus: dismissible, hoverable, persistent). No delay on focus; a short
  (~300 ms) delay on hover so it doesn't flicker while the pointer crosses the row.
- **It deliberately does not render on touch at all**, gated by the CSS media query
  **`@media (hover: hover) and (pointer: fine)`** — a capability query, **not** user-agent sniffing, and not a
  JS `ontouchstart` test (both misclassify hybrid laptops). On a touch device the visible label is already
  carrying the meaning, so a tooltip that flashed on tap would be pure noise arriving too late to help.
- **Accessibility wiring: `aria-describedby`, never `aria-label`, on these buttons.** The button's accessible
  *name* comes from its visible text ("Log again"), and the tooltip is a *description* — so the trigger carries
  `aria-describedby={tooltipId}` and the tooltip carries `role="tooltip"`. Putting an `aria-label` on a control
  that already has visible text is how WCAG 2.5.3 (Label in Name) gets broken and voice control stops working;
  it is used **only** where a control has no visible text at all (the meal-card pin toggle, and `MealList`'s
  existing ↑/↓ arrows). **Amended 2026-08-07 (Phase 8g):** the `FoodEntryList` row buttons now have **no** visible
  text either (icon-only, per the 2026-08-07 decision), so they carry `aria-label` **and** `aria-describedby`
  together — the label supplies the name that used to be visible text, the tooltip still only describes. Nothing
  about WCAG 2.5.3 is reopened: with no visible text left there is nothing for the accessible name to diverge
  from, provided the label keeps the same verb ("Delete …", not "Remove …").
- **The tooltip is announced but not duplicated:** because the icon is `aria-hidden`, a screen reader reads
  "Log again, button" and then the description — never "repeat icon Log again Log again".
- **No animation**, so there is nothing for `prefers-reduced-motion` to handle.

**`components/ui/icons.tsx` — the glyph source, and no dependency.** Four inline SVGs: **repeat** (`rotate-ccw`),
**pencil** (`pencil`), **trash** (`trash-2`) and **pin** (`pin`), with geometry taken from **Lucide**, whose ISC
licence permits copying the path data with attribution in the file header. Each is `aria-hidden="true"`
`focusable="false"`, `h-4 w-4`, `stroke="currentColor"` `strokeWidth={2}` — so the glyph inherits the `Button`
variant's own colour (including the `danger` red and every disabled state) rather than hardcoding hex, the same
`currentColor` technique the charts and the sage-arc motif already use. **A library is still declined**: four
glyphs do not justify a dependency, and `StatusMessage`'s check icon already established inline SVG here. The
recorded threshold for revisiting Lucide-as-a-dependency is roughly **8–10 distinct glyphs**.

**Delete still moves off the entry row and into the edit form**, unchanged from the first round and independent
of the icon question: it is the only irreversible action in an app with no undo anywhere, and it should not sit
one mis-tap from "Edit" on a phone. Direct in-repo precedent — `MetricForm` already puts "Delete this day's
entry" **inside** the form — and the direct rule precedent that 8b established, that the edit form "already owns
that entry's actions". It is rendered there as **trash icon + "Delete entry"** with a `danger` variant, so the
icon vocabulary is consistent wherever the action appears. Accepted cost: deleting becomes Edit → Delete.
**REVERSED 2026-08-07 by Phase 8g** (Jeff's findings 5 + 7): Delete goes back onto the entry row as an icon-only
`danger` button and leaves the edit form entirely. The safety concern above is not dropped — it is re-answered
with a `window.confirm()`, mirroring `MealList.handleDeleteMeal`. Kept in place rather than deleted so the
original reasoning stays readable; see the "Delete returns to the entry row" block later in §3.4 for the
replacement design.

**`/meals` gets the same vocabulary, in Phase 8f, not here.** `MealList`'s per-item rows have the identical
Edit/Delete question and take the identical treatment (icon + visible label + supplementary `Tooltip`); its
existing ↑/↓ reorder arrows are the one place icon-only already ships, and they keep their `aria-label` and gain
a `Tooltip`. The card-level **pin toggle** is the one deliberate icon-only control in the app — it has no room
for a label and its state is already carried in text by the "Pinned" pill — so it keeps `aria-label` +
`aria-pressed` + a `Tooltip`. Kept in 8f rather than 8d purely so the `/meals` files are opened by one phase.

**Shading early and late hours in the time `<select>` (2026-08-05 addition, Phase 8e).** Jeff's fifth finding:
the 96-option picker would be faster to scan if hours before 6 AM and after 8 PM were visually shaded — and he
was explicit that this is presentation only, with **every option remaining present and selectable**.

**The binding constraint is already on the record, and it decides the design.** The 2026-07-26 entry established
that `<option>` CSS is not portable: macOS Safari/Chrome largely ignore it, and every mobile browser renders the
list as a native platform picker that ignores author CSS entirely. A CSS-only "shading" would therefore work on
Windows/Linux Chrome, Edge and Firefox — where Jeff would see it work — and **silently do nothing on his
phone**. The same entry's conclusion is the one to reuse: **content is portable, CSS is a bonus.**

- **The load-bearing mechanism is three `<optgroup>`s**, because a group label is *content*:
  **"Early (12 AM – 6 AM)"** (24 options), **"Daytime (6 AM – 8 PM)"** (56), **"Late (8 PM – 12 AM)"** (16).
  24 + 56 + 16 = 96, boundaries exactly at `06:00` and `20:00`, matching Jeff's stated cut points.
- **`<optgroup>` was rejected on 2026-07-26 — for a different problem, and that rejection does not carry.** It
  was rejected as an answer to *"a lot of choices"*, on the grounds that it "adds 24 non-selectable rows and does
  nothing about alignment, which is the stated problem." Both objections are specific to that proposal and to
  that complaint: this is **3** added rows, not 24, and the complaint it answers is *scanning*, which is exactly
  what grouping addresses. The alignment fix (zero-padded labels) is untouched and still does its job — option
  indentation under a group is uniform, so the column still lines up. Recording this as a reconsideration with a
  reason, rather than a silent reversal, is the point.
- **Everything below the label is unchanged, by construction:** all 96 `value`s stay 24-hour `HH:MM`, all 96 stay
  present, selectable and in chronological order, nothing is disabled, and `quarterHourOptions()` remains
  exported unchanged. §6 asserts the concatenation identity (`groups.flatMap(g => g.options)` deep-equals
  `quarterHourOptions()`), which is what mechanically proves no option was lost, duplicated or reordered.
- **The de-emphasis itself is `text-stone-500` on the Early/Late options** where the platform honours
  `<option>` CSS — **not** a background fill, which is likelier to fight the platform's own selection highlight.
  `stone-500` is 4.80:1 on white, i.e. still **AA-compliant text**: de-emphasis must not become
  "unreadable-by-design", and this repo has already had to fix exactly that (the NB-2 contrast amendment, which
  chose this same shade as the floor).
- **Honest platform statement, because the failure is invisible.** Group **labels** are expected to render on
  Windows/Linux Chrome/Edge/Firefox, macOS Safari/Chrome, and both mobile platforms' native pickers; option
  **colour** is expected on Windows/Linux only. Both claims are **to be verified by hand on a real phone**, not
  asserted — this project's standing "confirmed, not assumed" bar. **The safety property that makes this low-risk
  either way: if a platform ignored `<optgroup>` entirely, the control degrades to exactly what ships today** —
  96 flat options, nothing lost, nothing broken.
- **All three call sites get it**: `FoodEntryForm`, `LogMealDialog` (both modes), and `CopyGroupDialog` (whose
  `value=""` **"Keep original time(s)" sentinel stays outside and above all three groups** — it is not a time).
- **The off-grid edit invariant must survive, and this is where it would quietly break.** `FoodEntryForm` injects
  a legacy off-grid time as an extra selected option so an unrelated edit never rewrites it. With groups, that
  option must be injected **into the correct group** (`quarterHourGroupIndexFor`, §3.3) — an implementation that
  appends it outside the groups, or drops it, silently reintroduces the exact time-rewriting bug the invariant
  exists to prevent.
- **Type-ahead is unaffected** (prefix-matching still spans all options), and Playwright's `selectOption` by
  value is unaffected. **The one real test hazard, named up front:** any locator using a *direct-child* selector
  (`select > option`) breaks under `<optgroup>`, since options are no longer direct children. §6 requires that
  sweep in the same change — this is the fourth consecutive phase where an existing suite pins something a new
  phase changes, and it produced a blocking finding twice.

**Pinned meals and duplicating a meal (2026-08-05 addition, Phase 8f).** Jeff's seventh and eighth findings.
Both are `/meals`-only, both land on `MealList`'s card action row, and both are specified together because they
have to be designed against each other (does a duplicate inherit a pin? where do two new controls go on a row
that already has four?).

***Pinning***

- **`sortMealsByName` partitions pinned-first, then sorts each partition with the identical existing
  comparator** (§3.3). Pinning changes *which block* a meal is in and nothing else — the pinned block is
  alphabetical too, so pinning meal B never moves meal A. Any other rule (pin order, recency) makes the library
  rearrange in ways the user didn't ask for.
- **One shared ordering for both surfaces, still.** 7c's rule was that `/meals` and `LogMealDialog`'s picker
  must agree; pinned-first applies to both, so a pinned meal is at the top of the picker too — which is most of
  the value on the `/food` side.
- **In the picker, pinning is expressed with `<optgroup label="Pinned">` / `<optgroup label="All meals">`** —
  the same portable-content mechanism as Phase 8e, for the same `<option>`-CSS reason, and rendered **only when
  at least one meal is pinned** (never an empty "Pinned" group). 7c's **name-first label invariant is untouched**:
  optgroups don't alter option text, so native type-ahead still prefix-matches the meal name.
- **Filtering beats pinning.** A pinned meal that doesn't match the active filter is **not** shown. Pinning is an
  ordering preference; a filter is an explicit question, and answering it with a non-match would make the count
  readout ("Showing 3 of 40") lie. Decided here because it could plausibly go either way and would otherwise be
  settled by accident.
- **The card shows a "Pinned" pill, and the toggle is an icon button.** The pill is the *status* half of 8b's
  recorded pill-vs-banner rule (`MetricForm`'s "Already logged", `FoodEntryList`'s "From a saved meal") applied
  to a genuinely new status — `bg-sage-pale text-ink`, no new token. It also satisfies WCAG 1.4.1 properly: the
  pinned state is carried by **text**, not by a filled-vs-outline glyph. The toggle itself is a pin glyph
  (inline SVG, per the no-library rule above) with **visually-hidden text** (`"Pin <name>"` / `"Unpin <name>"`)
  and `aria-pressed`, which is the conventional accessible toggle-button pattern.
- **No section headings and no divider between the two blocks.** A "Pinned" / "All meals" heading pair reads
  well until the filter empties one of them, at which point it needs its own empty-state rules; the per-card pill
  carries the same information with none of that. Rejected deliberately, not overlooked.
- **`setMealPinned` is optimistic-free**: toggle → action → `onChanged()` refetch, the same loop every other
  `/meals` mutation uses. It must preserve the filter query and card expansion, which `hasLoadedOnce` already
  guarantees — the state-loss bug class this screen has shipped broken twice.

***Duplicating***

- **A "Duplicate" control on each card opens an inline expander** (`DuplicateMealDialog`, wrapped in
  `ActionPanel`) containing the prefilled name, a read-only "N items will be copied" line, and Save/Cancel.
- **The name IS prefilled — `"<name> (copy)"`, autofocused with the text pre-selected so typing replaces it.
  This does not contradict Phase 7b's blank-name decision; it satisfies its actual reasoning.** That decision
  rejected a prefill because a *first-item* name is **actively wrong** on a multi-item group ("Eggs" for
  eggs + toast + coffee), producing a library of confidently mislabelled meals. `"Weekday breakfast (copy)"` can
  never be wrong in that way — it is provisional and *visibly* provisional, which is the opposite failure mode
  from a name that looks deliberate. The general rule that falls out, worth keeping: **prefill when the derived
  value cannot be wrong; leave blank when it can.**
- **One expander per card, and the ad-hoc mutual-exclusion guards get consolidated.** `MealList` currently
  tracks `renamingMealId` and `loggingMealId` separately with a hand-written `isLogging && !isRenaming` guard;
  adding a third would make the collision matrix grow by hand. Replace those two with a single
  `cardAction: { mealId: string; kind: "log" | "rename" | "duplicate" } | null` — the exact shape
  `FoodEntryList.groupAction` already uses for the same problem. The item-level `addingItemToMealId` /
  `editingItemId` are a different axis and stay as they are. **This is a small refactor of an
  already-approved file and is therefore named explicitly in §8's In-scope list**, not left to be discovered in
  the diff.
- **On success the screen DOES refetch** (`onChanged()`), unlike Phase 8c's "Log this meal" — and the contrast is
  the reason to state it: logging writes `food_entries`, which `/meals` never renders, whereas duplicating writes
  `meals`, which is exactly what this screen shows. A `StatusMessage` names the new meal. If a filter is active
  and the new name doesn't match it, the new meal **won't be visible** — consistent with 7c's existing rule for a
  newly *created* meal, and worth an acceptance row rather than a bug report later.
- **The card action row now carries six controls** (Log this meal · Pin · Hide items · Rename · Duplicate ·
  Delete) — the pre-existing four plus the two this phase adds. That is acknowledged as crowded and is
  **deliberately not solved here** — see §5's open question. Jeff was given the count and its breakdown and
  chose to proceed as designed.
- **This phase also adopts Phase 8d's icon vocabulary on `/meals`** (§3.4, "Per-row action density"): `MealList`'s
  per-**item** rows get icon + visible label + supplementary `Tooltip` for Edit/Delete, its existing ↑/↓ arrows
  keep their `aria-label` and gain a `Tooltip`, and the new **pin toggle is the app's one deliberate icon-only
  control** — it has no room for a label, and its state is already carried in text by the "Pinned" pill, so it
  carries `aria-label` + `aria-pressed` + a `Tooltip`. Doing this here rather than in 8d keeps every `/meals`
  file opened by a single phase.

**Delete returns to the entry row, and the edit form loses it (2026-08-07 addition, Phase 8g) — an explicit
reversal of Phase 8d, not a bug report against it.** Jeff's findings 5 and 7 are one request read from two
directions: put a delete icon on each `FoodEntryList` row, and remove `FoodEntryForm`'s "Delete entry" button.
Phase 8d moved Delete off the row on purpose — it is the only irreversible action in an app with no undo, and it
should not sit one mis-tap from "Edit" on a phone. Jeff has now used that arrangement and judged it wrong: his
read is that "edit an item in order to delete it" is an unintuitive extra step, not a safety feature. That is a
legitimate call on his own app, and the reversal is recorded as a reversal.

- **What replaces the safety argument, because it should not simply be dropped.** 8d's concern was real; what is
  rejected is the *mechanism* it chose, not the concern. The mis-tap risk moves to a **`window.confirm()` naming
  the entry** — `Delete "Eggs"? This can't be undone.` — placed in `FoodDayView`'s delete handler, **not** in
  `FoodEntryList`. This is not a new pattern: `MealList.handleDeleteMeal` already does exactly this, in exactly
  this shape, for exactly this class of action (a destructive control living on a list surface), with the confirm
  sitting beside the handler rather than in the presentational list. Net effect: Delete is one tap to reach
  (Jeff's ask) and still two deliberate acts to complete (8d's concern), and it stops being the only destructive
  control in the app with no confirmation at all. **This is the one judgment call in this phase Jeff may want to
  overrule** — if he wants a bare one-tap delete with no prompt, that is a one-line removal, and the phase should
  ship without it rather than stall.
- **The three row actions are icon-only buttons**, per the 2026-08-07 "Icons replace buttons+text entirely"
  decision: repeat / pencil / **trash (`danger` variant)**, each a real `<button>` with generous tap padding and a
  hover/focus background, an `aria-label`, and its existing supplementary pointer-only `Tooltip`
  (`"Delete this entry. This can't be undone."`). **Phase 8g absorbs the `FoodEntryList` half of that already-
  decided-but-unbuilt icon-only conversion** — "Log again" and "Edit" drop their visible labels in the same
  change that adds the trash icon, because all three live in one JSX block and splitting them would have two
  sessions editing the same lines. The `/meals` half stays in Phase 8f, unchanged.
- **`aria-label` names the entry, and that does not contradict the icon-only decision.** Use
  ``aria-label={`Delete ${entryLabel}`}`` (likewise `Log again …` / `Edit …`), reusing the exact `entryDisplayLabel`
  helper the select-mode checkbox already uses for ``aria-label={`Select ${entryLabel}`}`` — in-repo precedent, same
  file. Ten rows all announcing a bare "Delete, button" is unusable for a screen-reader user tabbing the list. The
  2026-08-07 rule is that the accessible name must not *paraphrase* the verb (so voice control's "click Delete"
  still resolves); a disambiguating suffix keeps the verb intact and satisfies both.
- **Suppression is inherited, not re-derived.** The trash button sits inside the **existing** single
  `!selectMode && !isEditingRow && !isGroupActive` conditional. No new branch, and therefore no new rule: the row
  being edited hides **all three** actions including Delete, exactly as 8b specified and for the same reason —
  deleting the row whose form is open leaves a form that cannot save, the one genuine dead end among the three.
- **So: what is a mid-edit row's delete affordance? There isn't one, deliberately.** With Delete gone from the
  form *and* suppressed on the edited row, deleting an entry you are part-way through editing is **Cancel →
  trash**. That is two clicks, the same count as 8d's Edit → Delete, and it keeps the phase's one consistent rule
  intact (*a row in a special state suppresses its ordinary actions because another surface owns them*) rather
  than carving an exception into it. Stated here explicitly because it is the obvious question an implementer
  will hit and guess at.
- **`FoodDayView` wiring.** `handleDeleteEditingEntry()` becomes `handleDelete(entry)` again, taking the row's
  entry. **Keep Phase 8d's qa N-4 fix verbatim**: route a failed delete through the existing `actionError`
  channel, never echo a raw Postgres string, and do not treat failure as success. Add one thing 8d's version got
  for free and this one must do on purpose: **if the deleted entry happens to be the one currently being edited,
  clear `editingEntry` too** — otherwise the form is left editing a row that no longer exists, which is the
  pre-existing gap §5 already notes, newly reachable in one click. `FoodEntryForm`'s `onDelete` prop, its
  "Delete entry" button and its `TrashIcon` import are removed; `TrashIcon` itself stays (the row now uses it).

**The editing-row highlight gets louder: enclosure, not fill (2026-08-07 addition, Phase 8g).** Jeff's finding 6.
The 8b treatment (left accent bar + a small "Editing" caption, no surface fill) shipped and is committed; he has
seen it on a clean build and finds it too quiet. `ai-context/DECISIONS.md`'s 2026-08-05 entry predicted exactly
this outcome and pre-labelled it *"a taste call for him, not a defect"* — so this is a strengthening, not a fix.

- **The constraint that ruled out a fill in 8b still holds and is not being relitigated.** A `bg-sage-pale` row
  would swallow the `bg-sage-pale` "From a saved meal" badge sitting inside it, and would fight the row's
  `hover:bg-stone-50/70`. Both are still true. So the surface stays unchanged and the escalation goes where the
  ladder already says it should: **enclosure**.
- **Treatment: keep the `border-l-4 border-l-sage-deep` bar, add an inset `sage-deep` ring around the whole row,
  and promote the "Editing" caption to a filled `bg-sage-deep text-paper` pill.** Contrast: sage-deep-on-paper is
  4.9:1 either way round (the ratio is symmetric), so a `text-paper` pill on `bg-sage-deep` clears AA for normal
  text; the ring is a non-text border at 4.9:1 against a 3:1 bar. The filled dark pill is also **visually
  unmistakable next to the pale "From a saved meal" badge** — a dark chip beside a pale chip reads as two
  different things, which a same-coloured row fill would have destroyed.
- **Mechanic: `ring-2 ring-inset ring-sage-deep`, not `border`** — and the reason is layout, not vocabulary. These
  rows live in a `<ul class="divide-y">` inside a `rounded-2xl overflow-hidden` section; a real `border` on one
  `<li>` shifts every row below it and fights the dividers, while an inset ring paints inside the row's own box
  with zero reflow. `ActionPanel` uses `border border-sage-deep` because it is a standalone block where neither
  problem exists. Same visual concept, correct mechanic per context — **not** a second emphasis language.
- **Ladder placement: "level 1+", added without renumbering.** Level 1 (bar only, surface unchanged) is retained
  as-is for the **active group**, which is a whole section and needs to stay quiet. The **editing row** is
  promoted to **level 1+ = bar + inset ring + filled pill, surface still unchanged**. Deliberately not a
  renumber: existing "level 1/2/3" references in this doc and in component doc comments stay correct.
- **Select mode still coexists, and the rule it follows is unchanged.** A *checked* row still gets no visual state
  of its own — the checkbox is the indicator. The editing row's ring is not a tint and does not violate that;
  a row can legitimately be checked **and** ringed at once, and they read as two different things (a control vs.
  an enclosure). No interaction with the new trash icon either, since the edited row hides all three actions.
- **Still no second `scrollIntoView`, and that stays out on purpose.** 8b's rejection (two competing scroll
  targets for one action) is unaffected by making the marker louder — this fix makes the row easier to *find*
  when you look at the list, which is what a persistent state marker is for. If a louder marker still doesn't
  land for Jeff, the remaining question is *where the page scrolls on entering edit mode*, which is a different
  design question and should be raised as one rather than absorbed here.

**Retiring the dashboard (2026-08-07 addition, Phase 8h).** Jeff's finding 1, and he asked for a recommendation
rather than a menu: *"I'm questioning if it even needs to exist… it's just an extra click… Ask the architect if
there's something else we can add to that page that provides value."*

- **Recommendation: retire it.** `(app)/page.tsx` becomes a one-line `redirect("/food")`, and
  `components/food/TodaySummary.tsx` is deleted with it (nothing else imports it — `/food` has `DailyTotals`).
  **Keep the `/` route itself** rather than repointing the auth callback, sign-in redirect and the header
  wordmark: a redirect at `/` means every existing link keeps working and the auth gate is untouched, which makes
  this a genuinely small, low-risk change instead of a routing refactor.
- **Why, in one line: everything a dashboard would show either already exists one click away, or belongs on the
  screen it is about.** Today's totals are `DailyTotals` on `/food` — the current dashboard is a literal duplicate
  of them, so it costs a click and returns nothing. Weight/body-fat *over time* is `/trends`, which already does
  7/30/90-day ranges with real gap handling; a second, smaller, less capable chart on a landing page would be a
  weaker copy of a page that exists, and a second place for the same fact to drift. That leaves nothing for the
  page to be, and "a landing page that exists to be landed on" is not a reason in an app whose stated first
  priority is that logging must be fast.
- **This is consistent with the 2026-07-31 descope, not a re-run of it.** That decision rejected a dashboard
  *quick-add / copy-previous-day* on write-path grounds (it would duplicate or weaken `FoodEntryForm`; copy-day
  is already a strict subset of `CopyDayDialog`). Those arguments genuinely do not cover a **read-only summary**,
  which is a different shape of feature — so the read-only case was evaluated on its own merits above, and lands
  in the same place for a different reason: not "it would be dangerous", but "it would be redundant".
- **The one genuinely-new fact Jeff named, and where it actually belongs: "last logged weight and body fat" goes
  on `/metrics`, not on a dashboard.** It is real information that exists nowhere today — `/metrics` shows the
  *selected day's* row (usually empty until you weigh in), and `/trends` shows a chart you have to read. A single
  line above the form — *"Last logged: 182.4 lb · 18.2% body fat on 08/05/2026"* — answers "what was I last?" on
  the screen a user already opens to ask it, with no new navigation stop. Rendered via `formatWeight`/
  `weightForDisplay` (canonical kg → the user's unit, no reimplementation) and `formatDateLabel`; **null-safe**,
  showing nothing at all when the user has never logged a metric.
- **It reads through `MetricForm`'s existing client fetch, and the server-side alternative is rejected for a
  concrete reason.** "Most recent row" genuinely does **not** depend on the browser's local "today", so a plain
  Server Component read in `metrics/page.tsx` would be simpler and would finally have one screen not using the
  mount-only-Effect tz pattern. It is still rejected: the line would go **stale the moment the user saves** (it
  would keep naming 08/05 immediately after logging 08/07) until a navigation, which is a visible inconsistency
  on the very screen that just changed. Adding the query to `MetricForm`'s existing fetch means the existing
  `refetch()` after save/delete keeps it correct for free. Recorded so a future reader doesn't "simplify" it back
  into a bug.
- **Explicitly not built: an "oldest-to-latest" all-time progress chart.** It is the closest literal reading of
  Jeff's ask, and it is a **`/trends` feature, not a dashboard one** — an `All` option beside 7/30/90. Left out of
  8h because it is not free: it needs an extra query for the user's earliest logged date, and the dense
  day-by-day series builders would then produce an unbounded array (two years of logging is ~730 points on one
  axis). 7/30/90 already covers the useful window for a daily-logging app. Logged as a §5 open question with a
  recommendation, not smuggled in.
- **No stored "progress" value, ever** — computed on read from `daily_metrics`, per the standing no-denormalised-
  computed-columns rule (AGENTS.md). This phase adds no schema, no server action and no `lib/domain/` module.

**`DailyTotals`** shows the day's total calories/protein and the **day-level protein %** using the same
ratio-of-sums function on the day's summed totals (from `daily_food_totals`). Until Phase 8h it was also
rendered, via `TodaySummary`, on the dashboard; after 8h `/food` is its only home. **Phase 8j adds goal-relative
progress** to the calories and protein figures — see the "Daily goal progress" block below; the protein-%
figure is deliberately left as a plain stat, because there is no protein-% target to be relative to.

Other components unchanged: `CopyDayDialog`, `LogMealDialog` (its date/time picker is likewise a
`date max=today` + the same 96-value quarter-hour time `<select>`; its *meal* picker gains only the shared
alphabetical order — see the Phase 7c block above), `MealList`/`MealForm` (`MealList` receives an
already-filtered, already-sorted array; the filter itself lives in `MealsView`), `MealItemForm`
(fields always visible — and note it has **no** time field at all: saved-meal items carry no `consumed_at`;
time-of-day is chosen only at log time in `LogMealDialog`, so this control change doesn't touch it),
`MetricForm` (date max=today, no time field, sends `metricTz`), `SettingsForm`, `RangeSelector`,
`WeightChart`/`IntakeChart`. The `(app)` nav has a **"Log out"** control (the only session terminator).
Installability via `app/manifest.ts` (+ icons), `display:'standalone'`, **no service worker**.

**Visual identity v2 — cool canvas + blue/orange accents, no serif (2026-08-09 addition, Phase 8i).** Jeff has
seen a reference app ("Nourish", built by Codex) and prefers its look. His words, verbatim: *"Our app is clean,
but it's dull and busy. The green buttons and creme background of our app look ugly"* and *"I also like the font
that the codex app used. I do not like the ornate fonts we used in the summary card at the top of food."* This
**reverses the palette and typography halves** of the 2026-07-25 "warm-paper + sage/clay" identity. It does not
reverse that decision's *structure* — tokens in `globals.css`'s `@theme inline`, primitives in `components/ui/`
as the single source of truth, no raw hex in components — which is what makes this a token swap rather than a
rewrite, and is recorded here as still-correct rather than silently reused.

**Important caveat on fidelity, stated up front: this is a direction, not a spec match.** The reference was
described in prose; no screenshot was available to the architect. Every specific value below is the architect's
choice consistent with that description, not a sampled colour. Where a value is an inference it is marked. If
Jeff wants a literal match on any particular colour, that is a one-line token edit — the whole point of the
token structure.

***The token set.*** All ratios below are computed with the standard WCAG relative-luminance formula against
the surface each token actually renders on — the same rigour the 2026-07-25/26 entries applied, and for the same
reason: this project has already shipped two colours that had never been checked (the NB-2 amendment) and this
round found a third (below).

| Token | Value | On `--surface` (white) | On `--canvas` | Role — and the rule that keeps it AA |
|---|---|---|---|---|
| `--canvas` | `#F1F5F9` | 1.10:1 vs white | — | Page background (replaces `--paper`). Cool light grey, not cream. Card separation is carried by the white surface **plus** a border/shadow, never by this 1.10:1 step alone. |
| `--surface` | `#FFFFFF` | — | 1.10:1 | Card / panel / input background. |
| `--ink` | `#0F172A` | **17.85:1** | **16.28:1** | Body + heading text. **Also a feature surface**: white text on an `--ink` fill is 17.85:1. |
| `--muted` | `#475569` | **7.58:1** | **6.91:1** | Secondary / caption text ("760 remaining", helper text, timestamps). Chosen over the lighter `#64748B` **because that one is 4.34:1 on `--canvas`** — under AA for text sitting directly on the page, which several strings do. |
| `--line` | `#CBD5E1` | 1.49:1 | 1.36:1 | **Decorative** borders/dividers only — card edges, list dividers. Deliberately below 3:1; see the SC-scope note below. |
| `--line-strong` | `#64748B` | **4.76:1** | **4.34:1** | **UI-component** borders — text inputs, selects, secondary-button outlines. Both figures clear the 3:1 SC 1.4.11 bar. |
| `--accent` | `#1D4ED8` | **6.70:1** | **6.11:1** | The accent that carries meaning: primary-button fill (white label = 6.70:1), link text, focus rings, the **protein** progress bar. |
| `--accent-soft` | `#DBEAFE` | 1.22:1 | — | Tint: active-nav pill, `ActionPanel` fill, `StatusMessage` surface. `--ink` on it is **14.63:1**; `--accent` on it is **5.49:1**. |
| `--accent-warm` | `#C2410C` | **5.18:1** | **4.72:1** | The single secondary accent — the **calorie** progress bar, the wordmark mark, sparing positive emphasis. Unlike the `--clay` it replaces (3.2:1, large/fill only), this **is** AA-capable as text; the restriction on it is *frequency*, not *size*. |

- **The old "`--sage-deep` must never be small text on `--sage-pale`" guardrail dissolves, and that is a real
  improvement worth naming.** That trap (4.2:1) is the reason `StatusMessage` puts `sage-deep` only on its
  border and icon, `ActionPanel` keeps `text-ink` content, and the active `NavLink` is `ink`-on-`sage-pale`
  rather than the naive mapping. `--accent` on `--accent-soft` is **5.49:1**, so the trap is gone. **The rule is
  kept anyway**: text on the soft tint stays `--ink`. Keeping it means the ladder maps mechanically, no
  component's text colour has to be re-decided, and the margin survives a future tint tweak.
- **Semantic reds stay, exactly as before** — `Button`'s `danger` variant, `errorTextClass`, the `amber` auth-
  callback notice. They are status, not brand, and this round does not touch them. **Being over a calorie goal
  is not an error and must not become red** (see the goal-progress block).
- **A real, pre-existing SC 1.4.11 defect found while doing this contrast pass, and fixed here:**
  `components/ui/Button.tsx`'s `secondary` variant is `border-stone-300` (`#D6D3D1`) on a white fill —
  **1.49:1**, against a 3:1 requirement, and for a white-on-white button that border is the *only* thing
  identifying the control. The 2026-07-26 NB-2 sweep fixed `styles.ts` and `Card` but **missed `Button`**. It
  becomes `--line-strong` (4.76:1). Recorded rather than quietly folded in, because it is a defect in
  already-approved code, not part of the redesign.
- **A deliberate, reasoned partial reversal of NB-2 — `Card`'s border goes back to a subtle line.** NB-2 moved
  `Card` from `border-stone-200` (1.26:1) to `border-stone-500` (4.80:1) to clear the 3:1 non-text bar. Under
  the new direction that border reads as a heavy box, which is most of what makes the current app look "busy".
  **SC 1.4.11's scope is the reason this is conformant, not an exemption being claimed:** it covers *"visual
  information required to identify user interface components and states"* and *"parts of graphics required to
  understand the content"*. A card is a **decorative grouping container** — it is not an interactive component,
  and nothing inside it becomes harder to read or to understand if its edge is not perceived. So `Card` takes
  `--line` (1.49:1) plus `shadow-sm` on a white surface against the `--canvas` page. **The half of NB-2 that
  applies to real components is kept and extended**: `inputClass`, `Button` secondary, and any select/interactive
  outline use `--line-strong`. The rule, stated once so it stops being re-litigated per component: **UI
  components → `--line-strong` (≥3:1); decorative containers and dividers → `--line`.** This is the one
  accessibility call in this round that a reviewer should push back on if they read the SC differently — §5.

***Typography — Fraunces is removed, Geist Sans stands alone.*** Jeff named the serif specifically ("the ornate
fonts we used in the summary card at the top of food" — that is `DailyTotals`' `font-serif` stat numerals).

- **Fraunces goes entirely**: the `next/font/google` registration in `app/layout.tsx`, the `--font-fraunces`
  variable, the `--font-serif` entry in `@theme inline`, and every `font-serif` class in `src/`.
- **No second font family is added, and the reason is that there is nothing left for one to do.** The serif
  existed to carry a warm/editorial register the new direction explicitly rejects; with it gone the app has zero
  functional serif-vs-sans distinction. Geist Sans is already registered, already self-hosted at build time (no
  external request, no CSP/privacy change), and is exactly the modern grotesque the reference is described as
  using. Adding a face would cost a download, a token and a per-component decision surface for no functional
  need — the same bar this project applied to icon libraries and combobox primitives.
- **What replaces the serif's job**: the "this is a heading / this is a big number" signal moves to **weight,
  size and tracking** — `font-semibold`/`font-bold` + `tracking-tight` — which is precisely the reference's
  "bold black number" treatment. **This is cheaper than it sounds**: nearly every `font-serif` call site in `src/`
  already reads `font-serif text-2xl font-semibold tracking-tight text-ink`, so **deleting the one class is the
  whole edit** at those sites. Verify per site rather than assuming; a bare `font-serif` with no weight beside it
  needs `font-semibold` added.
- **RESOLVED (Jeff, 2026-08-09): swap Geist for Inter.** Implement as the one-line swap described above — change
  the `next/font/google` import and the `--font-sans` variable in `app/layout.tsx`; zero component changes,
  because everything already inherits `--font-sans`.

***Shape — pills become rounded rectangles for actions; pills survive for status and selection.***

- **`Button`: `rounded-full` → `rounded-lg` (8px)**, matching the reference's rounded-rectangle "+ Add food".
  `size="icon"` becomes a rounded square (`rounded-lg`) for the same reason.
- **`Card`/`ActionPanel`: `rounded-2xl` (16px) → `rounded-xl` (12px)** — still soft, less pillowy; the "clinical
  modern" register rather than the warm one.
- **Genuinely-pill things stay `rounded-full`**, and this is a rule rather than an exception list: the **active
  `NavLink`** (the reference itself shows a rounded pill tab), the **"From a saved meal"** badge, the **"Pinned"**
  badge, and the **"Editing"** pill. This extends a rule this project already recorded — *pills are for statuses,
  not messages* (Phase 8b) — to **pills are for statuses and selection, actions are rounded rectangles**. Anyone
  adding a control can now answer "pill or not?" from the rule instead of by eye.

***What the primitives become*** (this is the whole propagation surface — every screen inherits it):

| Primitive | Before | After |
|---|---|---|
| `Button` primary | `bg-ink text-paper`, pill | **`bg-accent text-white`**, `rounded-lg` (6.70:1) |
| `Button` secondary | white / `border-stone-300` (1.49:1 — the defect above) | white / **`border-line-strong`** (4.76:1), `rounded-lg` |
| `Button` danger | unchanged red | **unchanged red** |
| `Button` focus ring | `outline-sage-deep` | **`outline-accent`** |
| `Card` | `rounded-2xl border-stone-500` | **`rounded-xl border-line`** + `shadow-sm` on `--surface` |
| `NavLink` active | `bg-sage-pale text-ink`, pill | **`bg-accent-soft text-ink`**, pill (kept) |
| `styles.ts` `inputClass` | `border-stone-500`, `focus:*-sage-deep` | **`border-line-strong`**, `focus:*-accent` |
| `styles.ts` `labelClass` / placeholder | `text-stone-700` / `stone-500` | **`text-ink`** / **`text-muted`** |
| `StatusMessage` | `border-l-sage-deep bg-sage-pale text-ink` | **`border-l-accent bg-accent-soft text-ink`** (level 2) |
| `ActionPanel` | `border-sage-deep bg-sage-pale`, `rounded-2xl` | **`border-accent bg-accent-soft`**, `rounded-xl` (level 3) |
| Editing row (8g) | bar + `ring-sage-deep` + `bg-sage-deep/text-paper` pill | **bar + `ring-accent` + `bg-accent`/`text-white` pill** (level 1+) |

**The emphasis ladder is unchanged in structure — only its two colours move.** `sage-deep` → `--accent`,
`sage-pale` → `--accent-soft`, everywhere, in all four levels. No level is added, removed or renumbered, and the
"why a full ring rather than a louder colour" reasoning survives verbatim with `--accent-warm` now standing where
`--clay` stood in it (still rejected for pending-action emphasis, still for one meaning only).

***What is NOT a token swap — the hand-edit list.*** The 2026-07-25 "tokens are one source of truth" claim still
holds and is the reason this is tractable, but it was never *complete*, and pretending otherwise is how a
redesign ships half-done:

1. **`font-serif`** — every occurrence in `src/` (`(app)/layout.tsx` wordmark, all five page `<h1>`s,
   `DailyTotals`, `TodaySummary` if 8h hasn't landed). Grep, don't work from this list.
2. **The warm-neutral family** — ~100 `stone-*` occurrences across ~31 files. Text and border occurrences move to
   the new `--muted`/`--line`/`--line-strong` **tokens**, not to raw `slate-*`; incidental fills/hovers
   (`hover:bg-stone-50`, `divide-stone-100`) may use raw `slate-*`. **New standing rule: no raw colour-scale
   utility for text or borders in a component** — that per-component guessing is what produced all three contrast
   defects this project has had.
3. **The sage arc** — `(auth)/layout.tsx`'s decorative `<svg>` is **deleted**. The reference has no decorative
   motif, and the arc is the last consumer of `--sage`, a token this round does not replace. **The 2026-07-25
   "signature motif" decision is reversed, not narrowed** (it was already narrowed once, in 2026-07-26, to
   auth-only). The auth card keeps its own presence through the card + wordmark.
4. **`components/trends/chartTheme.ts`** — two **hardcoded hexes** (`#e7e5e4`, `#78716c`), an already-documented
   exception because Recharts' `CartesianGrid`/`XAxis`/`YAxis` accept no `className`. They move to the cool
   equivalents; the documented reason for the exception stands.
5. **`WeightChart` / `IntakeChart`** — 20 combined `text-sage-deep`/`text-clay` classNames on `Line`/
   `ReferenceLine` (the `currentColor` technique). → `text-accent` / `text-accent-warm`. **Check the pairings by
   eye afterwards**: weight vs body-fat, and calories vs protein, must still be distinguishable, and calories
   should take `--accent-warm` so the chart agrees with the goal card's bar colour.
6. **`components/food/FoodEntryList.test.tsx`** — **8 assertions on literal class names**
   (`border-l-sage-deep`, `ring-sage-deep`, `bg-sage-deep`, `text-paper`). These **fail** on the swap. Update in
   the same change.
7. **`e2e/visual-identity-acceptance.spec.ts`** — the entire file pins the *old* identity as computed values:
   the six hexes, "Fraunces for headings", "pill-shaped primary button", "the sage arc appears exactly once on
   each auth screen", and an old-palette-scan whose forbidden list is now the wrong list. It must be **rewritten
   in the same change** to pin the new identity — including a scan whose forbidden list becomes the *sage/clay/
   paper* values, so the old palette cannot creep back. **This is the fifth consecutive phase in which an
   existing suite pins something a new phase reverses; it produced a blocking finding twice.** The 2026-07-25
   rollout's own note that *"no automated test asserts on Tailwind class-names or colors"* was true when written
   and is now false — items 6 and 7 exist precisely because that rollout's qa added them.

**Daily goal progress on `/food` (2026-08-09 addition, Phase 8j).** Jeff wants to see the day's calories and
protein **against his targets**, in the reference's treatment: a bold number, a thin coloured bar, and an
"X remaining" caption. `user_goals.daily_calorie_target` / `daily_protein_target_g` already exist, are already
editable at `/settings`, and are already used as chart reference lines (Phase 5) — this surfaces them on the
screen where the question is actually asked.

- **It surfaces in `DailyTotals` on `/food`. The dashboard is not revived, and that was checked rather than
  assumed.** Phase 8h's recorded reasoning for retiring `/` is that *"today's totals are `DailyTotals` on
  `/food` — the current dashboard is a literal duplicate"*. A goal-progress dashboard would re-create exactly
  that duplication (a second place rendering today's totals, now with a second copy of the progress rule to
  drift), and would mean un-deleting a route in the same breath as deleting it. `/food` is also simply the right
  screen: "how much room do I have left?" is asked **while logging**, and answering it in the component the user
  is already looking at costs zero navigation — the app's stated first priority.
- **The pure module: `lib/domain/goal-progress.ts`, one function.**
  ```ts
  export type GoalProgress = {
    consumed: number; target: number;
    remaining: number;  // target - consumed; NEGATIVE when over
    pct: number;        // consumed/target*100, whole number, UNCLAMPED
    barPct: number;     // pct clamped to 0..100 — bar WIDTH only
    isOver: boolean;
  };
  export function goalProgress(consumed: number, target: number | null): GoalProgress | null;
  ```
  - **`pct` and `barPct` are two fields on purpose, and this is the load-bearing detail.** A bar cannot render
    past 100%, but the *text* must tell the truth. Collapsing them into one clamped number is the obvious
    simplification and it silently makes the app claim you are exactly on target when you are 40% over. This is
    the same stance already recorded for `proteinCaloriePct` (>100% is returned as-is, never clamped).
  - Returns **`null`** when `target` is `null` **or ≤ 0** — so a nonsensical stored target degrades to the plain
    no-goal treatment instead of dividing by zero or drawing an infinite bar.
  - `pct` is rounded to a **whole number**, deliberately unlike `proteinCaloriePct`'s 1 decimal: that figure is a
    ratio people compare across meals, this one is a rough "how far along am I".
- **No new summation logic anywhere** (the explicit ask). `consumed` is `daily_food_totals.total_calories` /
  `total_protein_g` — already summed **on read by the DB view**, already the exact values `DailyTotals` renders
  today. `proteinCaloriePct` keeps the third stat. `totals.ts`'s `sumEntries` is untouched. **Nothing is
  stored**: no percentage, no remaining, no "progress" column — per AGENTS.md's standing rule. Phase 8j adds
  **no schema and no server action.**
- **Where the goals come from: a Server Component read in `food/page.tsx`, passed down as a prop** (
  `page.tsx` → `FoodDayView` → `FoodDayViewContent` → `DailyTotals`). **This deliberately breaks the pattern the
  rest of that screen uses, and the reason is specific**: every other `/food` read is client-side because it
  depends on the browser's local "today", which the server cannot know. A user's goals do not depend on today at
  all, change only from `/settings`, and cannot be changed from `/food` — so there is nothing on this screen for
  them to go stale against, and fetching them once server-side avoids a third round-trip on **every day change**.
  Note the contrast with 8h's last-logged-weight line, which is a *client* read for the opposite reason (it can
  be changed on the very screen that displays it).
  - **Known, accepted, not new**: `getGoals()` performs an ensure-row upsert, so a read-only page triggers a
    write. §5 already records this for `/trends`; `/food` becomes the third caller. It is an existing pattern
    being reused, not a new wart, and the fix if it ever matters is a read-only `getGoalsIfExists` — deferred,
    not smuggled in here.
- **The rendered treatment.** `DailyTotals` becomes **three cards in a responsive grid** (`grid-cols-1
  sm:grid-cols-3`) rather than one card with divided columns:
  - **Calories** — label, bold `--ink` number, thin bar filled `--accent-warm`, caption
    `1,240 of 2,000 · 760 remaining` in `--muted`.
  - **Protein** — identical, bar filled `--accent`.
  - **% from protein** — label + bold number, **no bar and no caption**, because there is no protein-% target.
    Stated explicitly so nobody "completes the set" by inventing one.
  - **Over target**: the caption reads **"320 over"**, not "-320 remaining". The bar sits at 100%.
- **Graceful fallback, which is the behaviour most likely to be got wrong.** A card whose target is `null`
  renders **exactly what it renders today** — label + bold number, no bar, no caption. A user who set only a
  calorie target gets a calorie bar and an unchanged protein card; the two are independent. When **both** are
  unset (the first-run case) a single subtle *"Set daily targets"* link to `/settings` appears **once**, below
  the grid — not per card, and never when the user has deliberately set one and left the other blank.
- **Accessibility, and why the bar is not a `role="progressbar"`.** The bar is `aria-hidden="true"` decoration;
  the caption beside it is real text carrying the same numbers, so a screen reader gets the information once
  rather than twice, in prose rather than as a bare percentage. This also settles two WCAG questions by
  construction: **1.4.1 (colour alone)** — the numbers are text and each card is labelled, so orange-vs-blue is
  never the only signal, and the over-target state is carried by the word *"over"*; and **1.4.11** — the bar's
  track/fill contrast is not load-bearing because nothing depends on perceiving it. **The over-target bar must
  not turn red**: red is semantic-error in this palette, being over a calorie goal is not an error, and it would
  be a colour-only duplicate of text that already says it.

**The `/food` day-action surface: one toolbar, one panel outlet (2026-08-11 addition, Phase 8k).** Jeff's second
finding, and it is a structural defect rather than a styling one. `FoodDayView` renders its three day-level
triggers in a single `flex flex-wrap` row — but **two of the three components render their own trigger *and*
their own open panel from the same position in that row** (`LogMealDialog` picker mode and `CopyDayDialog` both
early-return a `<Button>` when closed and a full panel when open). So opening one turns that flex item into a
full-width block, and every sibling trigger *after* it wraps to a line **below the open panel**: click "Copy this
day" and "Select entries" ends up stranded underneath the copy form. The `w-full` wrappers added to both
components on 2026-08-10 are the visible scar tissue of this — they force the panel onto its own line, which is
the best a component can do from inside a row it should never have been laying out.

- **The fix is to separate the two concerns that are currently fused: a *trigger row* that contains no panels,
  and a *panel outlet* directly beneath it that contains no triggers.** `components/food/DayActionBar.tsx`
  renders exactly the three buttons, always, in one row; `FoodDayView` renders whichever panel is open in a
  sibling block below. A trigger then cannot be displaced by a panel, because they are no longer siblings — the
  bug is fixed by construction rather than by a layout hint that has to keep being right.
- **`CopyDayDialog` and `LogMealDialog` become panel-only components in every mode**, losing their internal
  `open` state and their collapsed-button branch. This is not a new pattern: it is the shape
  `CopyGroupDialog`/`SaveGroupAsMealDialog` have had since Phase 7b/8 (the caller renders the trigger and
  conditionally renders the panel), and the shape `LogMealDialog` **already** uses in its Phase 8c fixed-meal
  mode, where `MealList` owns visibility. Two odd components are being brought onto the majority pattern, not a
  third pattern invented. **Both `w-full` wrappers are deleted** — if either survives the diff, the panels are
  still being rendered from inside the row.
- **`/meals` is unaffected, and this is the thing most likely to be broken by accident.** `MealList` already
  passes `meal` + `onCancel` and owns visibility, so it needs **no change**; the only edit there would be if a
  developer "helpfully" unifies the two modes further. §6 carries a regression row for it.
- **Open state moves to a single slot on `FoodDayView`: `dayAction: "logMeal" | "copyDay" | null`** — the exact
  shape `FoodEntryList.groupAction` and `MealList.cardAction` already use, so opening one closes the other for
  free. Select mode stays its own `selectMode` boolean: it is a **mode** that changes the list below, not a
  panel, and conflating the two would make "can I still be in select mode while a copy panel is open?" a
  question rather than a fact. (It cannot: entering select mode closes any open day panel, and opening a day
  panel is only possible when not in select mode, because "Select entries" and the other two triggers are
  mutually exclusive states of the same bar — see the next bullet.)
- **`dayAction` is set only by the user's own clicks — never by `loading`, a fetch nonce, `entries.length` or
  the selection.** This is the standing N-3/Phase 8b unmount rule, and it is what keeps `ActionPanel`'s
  mount-only scroll+focus firing exactly once per open and keeps a background `refresh()` from wiping an
  in-flight copy date. It is restated here because moving the state to a new owner is exactly the moment it gets
  re-derived incorrectly.

**The day-action row becomes a visually grouped toolbar, and select mode gets real emphasis (2026-08-11
addition, Phase 8k).** Jeff's third and fourth findings, which are one design question: what is this row, and
what does it act on.

- **The three triggers sit in a quiet container** — `rounded-xl border border-line bg-white shadow-sm` with
  `p-2`, i.e. `Card`-like chrome using the **decorative-container** neutral (`--line`) per Phase 8i's standing
  rule. **Deliberately not the accent vocabulary.** The emphasis ladder's levels all mean *something is
  happening or waiting for you*; a permanently-accented toolbar would be on screen every second of every visit
  and would therefore say nothing, which is the same "a treatment applied everywhere carries no information"
  test that kept `ActionPanel` off `FoodEntryForm`.
- **No `role="toolbar"`, and no `aria-label` on the group.** `role="toolbar"` carries a keyboard contract
  (roving tabindex, arrow-key traversal) that this codebase has no pattern for; declaring the role without
  implementing it announces a widget whose expected keys do not work, which is worse than no role. And a group
  label would add another accessible-name string to a page with a **four-instance documented history** of
  `getByLabel` collisions (see `ai-context/DECISIONS.md`'s "Copy to time…" entry and its three addenda) for no
  benefit — three buttons with clear visible labels need no group name. It is a **visual** grouping; the ARIA
  tree is unchanged.
- **Each trigger gets a supplementary `Tooltip`**, obeying the recorded rule that a tooltip explains rather than
  repeats and is never the only place a control's purpose is stated: "Log a saved meal" → *"Add a saved meal's
  items to this day, at a time you pick."*; "Copy this day" → *"Copy every entry on this day to another
  date."*; **"Select entries" → *"Tick individual entries in the day's log below, then copy them or save them
  as a meal."*** That third string is the actual answer to Jeff's complaint that the button is disconnected from
  what it acts on — it names the target ("the day's log below") in words, on the control itself.
- **Select mode's whole surface becomes one level-3 `ActionPanel`, not two stacked ones.** `EntrySelectionBar`
  today is `rounded-xl border-line bg-white` — indistinguishable from a `Card`, which is Jeff's third finding.
  It is wrapped in `ActionPanel`, and **the bulk form renders inside that same panel** rather than as a second
  accent-ringed box beneath it. Two nested rings for one action would dilute level 3 exactly as a permanently
  accented toolbar would.
  - **The heading is the step you are on**: `"Select entries"` → `"Copy selected"` → `"Save selected as a
    meal"`. The panel is **keyed on `bulkAction`** so choosing a bulk action remounts it, which is what makes
    `ActionPanel`'s scroll-into-view and focus-first-control fire for the *form* — the behaviour §6 already
    asserts for all five existing panels. `bulkAction` changes only from a user click, so this does not violate
    the unmount rule above.
  - **While a bulk form is open, the bar collapses to just its "N selected" count and hides its four buttons.**
    This is not a new rule either: it is *when a surface is in a special state, its ordinary actions are
    suppressed because another surface owns them* — the same rule the editing row, select mode itself, and the
    active group all already follow. It also makes the focus ordering correct **by construction** (the form's
    own first field becomes the panel's first focusable control), and it removes one more instance of the
    duplicate-dismissal ambiguity this project has now fixed twice: with the bar's "Done" hidden, the open form's
    "Cancel" is the only dismissal on screen.
  - **Ticking and unticking entries stays live while a bulk form is open** — the checkboxes are in the list, not
    in the bar, and the count in the collapsed bar updates as the selection changes. Worth stating because the
    suppression rule above could easily be over-applied to the checkboxes.
  - **Known, accepted imperfection**: on *entering* select mode with nothing yet selected, `ActionPanel` focuses
    the bar's first enabled button, which is "Clear" (both bulk buttons are `disabled` at N=0). Harmless — it
    clears an empty selection — but arbitrary. The alternative is an opt-out prop on `ActionPanel` to disable its
    own principal behaviour, which is a worse trade for a shared primitive. Recorded in §5 rather than solved.
  - **The scroll-into-view is a feature here, not a side effect**: the bar sits above the list and below the
    form, so clicking "Select entries" in the toolbar now scrolls the user *to the thing the mode acts on* —
    which is the other half of Jeff's fourth finding, answered by behaviour rather than by copy.

**Optional-detail expanders look like buttons, not links — `components/ui/DisclosureButton.tsx` (2026-08-11
addition, Phase 8k).** Jeff's first finding: `FoodEntryForm`'s *"Look up a food (barcode or search)"* control
does not read as clickable, and he asked whether it should be a button or a tab. Confirmed in source: it is
already a real `<button>`, but styled as bare accent text with no chrome, no icon and no `aria-expanded` — so
neither a sighted user nor a screen-reader user is told it expands anything.

- **A disclosure button, not a tab, and the deciding argument is concrete rather than taxonomic.** Tabs switch
  between *alternative views of one region*; this reveals *optional extra tooling on the same form*, which is
  disclosure. More decisively: `FoodLookupPanel` **already contains a real `role="tablist"`** (Search / Barcode).
  Making its own trigger a tab would nest a tab inside a tab strip — two tab layers, one of which switches the
  other on — which is genuinely confusing rather than merely unconventional.
- **`DisclosureButton` is a small shared primitive** wrapping `Button variant="secondary" size="sm"`: label +
  `ChevronDownIcon` (the glyph `MealList` already uses for this exact job, added 2026-08-10), rotated 180° when
  open, with `aria-expanded` and `aria-controls` pointing at the panel's id. **No new glyph and no icon
  library** — the 8–10-glyph threshold for revisiting Lucide-as-a-dependency is unchanged (this adds zero).
- **Applied to both of `FoodEntryForm`'s expanders, not just the one Jeff named** — the lookup trigger and the
  *"+ Add detail (quantity, unit)"* / *"Hide detail"* pair. They are the same control doing the same job three
  inches apart; fixing one would leave the form with two idioms for one concept, which is the same "both, or the
  rule isn't a rule" reasoning that extended the active-group treatment to "Save as meal".
- **The trigger stays rendered while the panel is open, and `FoodLookupPanel`'s own separate "Close" link is
  removed.** One control with `aria-expanded` toggling is the conventional disclosure pattern, and it retires
  another duplicate-dismissal control of exactly the kind already fixed on the group headers ("Cancel" →
  "Close"). Picking a candidate still closes the panel, unchanged.
- **These panels stay OUT of `ActionPanel`, deliberately** — §3.4's existing rule names `FoodEntryForm`, "Add
  detail" and `FoodLookupPanel` explicitly as progressive disclosure of optional detail rather than actions
  awaiting completion. This phase changes their *trigger's* affordance, not their emphasis level.
- **Nothing about the lookup or quantity behaviour changes**: the hidden `quantity`/`unit` inputs that keep a
  collapsed detail section from discarding a picked quantity (the Phase 6 B-1 fix) are untouched, as is the
  auto-expand-on-pick behaviour.

**The auth screens get the app's name back, and a deliberate identity (2026-08-11 addition, Phase 8l).** Jeff's
fifth finding, and the diagnosis is precise: Phase 8i **deleted** the sage-arc motif from `(auth)/layout.tsx`
(correctly — the new register is undecorated) and replaced it with nothing, while the auth pages have never had
a wordmark. The result is that the app's **first** screen is the only one that never says what the app is: a
bare card with an `<h1>Log in</h1>`, two fields and a link. Every authenticated screen has "Health Tracker" in
its header; `/login` and `/signup` have it nowhere on the page.

- **`components/ui/Wordmark.tsx` — one wordmark, two consumers.** The auth layout renders it **above** the card
  (it names the app, not the form); `(app)/layout.tsx`'s header link renders the same component instead of its
  current bare string. One source of truth, the same instinct that produced `StatusMessage`, `DayNavigator` and
  `LogMealDialog`'s shared modes — and the reason the two never drift is that there is only one of them.
  **Implementation invariant**: it renders plain text spans and **no `aria-label`**, so the header link's
  accessible name stays exactly `"Health Tracker"` and no existing locator moves.
- **The treatment uses type and one token, not a graphic: "Health" in `--ink`, "Tracker" in `--accent`.** This
  is the recorded-but-never-used role in Phase 8i's own token table (`--accent-warm`/`--accent` as "the wordmark
  mark"), so it is identity *inside* the new palette rather than a new idea. Both halves are AA on white
  (17.85:1 and 6.70:1) and colour carries no information, so WCAG 1.4.1 is not engaged. **This is the one taste
  call in the phase**; if Jeff dislikes two-tone, the fallback is all-`--ink` text and it is a one-line change
  in one file — which is the entire argument for extracting the component.
- **No decorative graphic, and this is a hard constraint rather than a preference.**
  `e2e/visual-identity-acceptance.spec.ts` asserts **zero app-owned `<svg>` on `/login` and `/signup`** — the
  guard Phase 8i added specifically so the deleted arc cannot creep back. Adding any decorative SVG would mean
  editing that guard in the same breath as it was written, which is how a deliberate decision gets quietly
  reversed. Presence comes from the wordmark, the tagline and the card instead — and this phase therefore needs
  **no change to that suite at all**, which is a real benefit worth naming after five consecutive phases that
  each did.
- **A one-line tagline under the wordmark**: *"Log food, weight and body fat in seconds."* — the app's own
  stated first priority, in the app's own plain register (no marketing voice, per the 2026-07-25 rejection of
  Noom's literal treatment). `text-sm text-muted` (7.58:1 on `--canvas`). **Copy is Jeff's call**; deleting the
  line is one line and changes nothing structural.
- **Card presence: `shadow-lg` on the auth card only**, passed via `className` — **not** a change to `Card`'s
  own definition. Phase 8i deliberately made cards quiet, which is right on a page full of them and reads as
  bare on a page that *is* one. A per-instance shadow is the smallest possible way to say "this one is the
  subject of the page" without touching a primitive every screen inherits.
- **Explicitly unchanged**: each page's `<h1>` ("Log in" / "Create your account") — a page heading should
  describe the page, not the app, and both are also the accessible name several suites already key off; the
  amber `auth_callback_failed` notice (semantic, out of scope since 8i); `LoginForm`/`SignupForm`'s fields,
  labels, `autoComplete` values and button text (every one of them is a locator in the e2e suite); and the
  `Card`/`Button`/`styles.ts` primitives.

**Password reset — a real flow, and the one edge case that decides its shape (2026-08-11 addition, Phase 8m).**
Jeff's sixth finding. **Confirmed by reading the source, not assumed: nothing exists today** — `lib/actions/
auth.ts` has only `signIn`/`signUp`/`signOut`, `(auth)/` has only `login/` and `signup/`, and there is no
`resetPasswordForEmail` or `updateUser` call anywhere in `src/`. A user who forgets their password currently has
no route back into their own data at all.

- **The flow, in four steps, three of which already exist.** (1) `/login` gains a *"Forgot password?"* link. (2)
  `/forgot-password` takes an email and calls `requestPasswordReset`, which asks Supabase to send its **built-in
  recovery email** — reusing the recorded 2026-07-19 "built-in email confirmation for v1, no custom SMTP"
  decision rather than introducing a mail provider. (3) The emailed link lands on the **existing**
  `/auth/callback?code=…&next=/reset-password`, which already exchanges the code for a session server-side and
  already validates `next` against open-redirect. (4) `/reset-password` renders a two-field form that calls
  `updatePassword`. **The only genuinely new surface is two pages, two Server Actions and two pure validators.**
- **The edge case that shapes the design: "am I in a valid reset session?"** `/reset-password` lives in
  `(auth)/`, which has **no auth gate** — so it is reachable with no session at all (a bookmarked URL, an
  expired link, a link opened in a different browser than the one that requested it). It therefore performs its
  own server-side `getUser()` check **before rendering a form**, and with no session renders an explanatory
  state — *"That reset link is invalid or has expired."* plus a link back to `/forgot-password` — rather than a
  password form whose submit can only ever fail. `updatePassword` re-checks server-side regardless
  (`reset_session_missing`), because a page-level check is a UX affordance and never an authorisation control.
- **The neutral confirmation is a security decision, not copy.** `requestPasswordReset` returns the **same**
  message whether or not an account exists: *"If an account exists for that address, we've sent a link to reset
  your password."* A "no account with that email" message would turn the form into an account-existence oracle
  for any address someone cares to try. This also happens to be the *honest* message, because Supabase's own
  `resetPasswordForEmail` deliberately does not distinguish the two cases — so a per-case message could not be
  implemented faithfully even if it were wanted. **An actual error (transport failure, Supabase's own email
  rate limit) is surfaced as a distinct, generic failure** — *"Couldn't send a reset email right now. Please try
  again in a few minutes."* — because swallowing it into the neutral message would tell the user their email is
  on its way when it is not. **To verify rather than assume**: that unknown-email really is a non-error on this
  Supabase version; if it turns out to error, the action must map that specific case to the neutral message.
- **After a successful reset: `signOut()`, then `redirect("/login?reset=success")`.** The login page renders a
  confirmation notice from that flag, reusing the query-flag notice mechanism `?error=auth_callback_failed`
  already established there (no new pattern, and this app has no cross-navigation flash mechanism). Signing out
  is deliberate on two counts: the session in hand was minted by an emailed link rather than by the new
  password, and logging in once immediately proves the new password actually works — worth two seconds on an
  action performed approximately never. **Rejected**: dropping the user straight into `/food`; see §4.
- **Two fields, "New password" and "Confirm new password"**, matching signup's own confirm-field convention and
  reusing `isValidPassword`/`MIN_PASSWORD_LENGTH` (6, matching `supabase/config.toml`'s
  `minimum_password_length`) rather than restating a rule in a second place. Both carry
  `autoComplete="new-password"` per the app-wide hygiene convention (identity fields get real values; everything
  else gets `off`).
- **A locator hazard that must be handled in the same change, because this project has now hit it four times.**
  `/reset-password` renders two controls whose accessible names both contain **"password"**, and `/login` and
  `/signup` already do the same. Playwright's `getByLabel` is a **case-insensitive substring** match, so any new
  test using `getByLabel("Password")` on these pages will strict-mode-collide. Every new assertion must use
  `{ exact: true }` or a scoped locator. Existing suites are unaffected (they only visit `/login` and
  `/signup`), but the *new* tests are exactly the ones at risk — see `ai-context/DECISIONS.md`'s "Copy to time…"
  entry and its three addenda.
- **Out of scope, deliberately**: changing a password while logged in (a `/settings` feature Jeff did not ask
  for — §5); magic-link/passwordless login; custom SMTP or a branded email template; any change to
  `middleware.ts`, the `(app)/` auth gate, RLS, or any application table. **This phase writes no rows in any
  table in this database** — it is Supabase Auth only.

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
- **Day navigation: Previous/Next/Today buttons *alongside* the date input (chosen) vs. replacing it (rejected)
  vs. swipe gestures (rejected) vs. a day carousel/strip (rejected).** Keeping the input costs one row of layout
  and preserves the only good answer to "jump to three weeks ago"; removing it would trade a common friction for
  a rarer but much worse one. Swipe was rejected on two independent grounds: this codebase has **no touch-gesture
  pattern anywhere**, and a gesture has zero discoverability and no keyboard equivalent, so it would need visible
  buttons anyway. A horizontally-scrolling day strip is a third navigation model for one screen. **"Next" is
  disabled rather than hidden** on today, following `EntrySelectionBar`'s N = 0 precedent — a control that
  vanishes teaches nothing, whereas a disabled one shows the boundary exists. **A "Today" button was designed and
  then dropped — Jeff's call, 2026-08-05.** The argument for it was that returning to today is the most common
  destination after browsing and every calendar UI ships one; the argument against, which won, is that it is a
  third control on a row that reads better as two, and the date picker already reaches today in one interaction.
  Two buttons ship.
- **Suppressing in-group row actions while a group expander is open (chosen) vs. disabling them (rejected) vs.
  dimming the other groups (rejected).** Disabling leaves three greyed buttons per row adding visual noise while
  communicating nothing the hidden version doesn't — and 8b already chose *hidden* for the identical situation
  (select mode, the edited row), so disabling here would make the app's own rule inconsistent for no gain.
  **Dimming the non-active groups** ("focus mode") was the most tempting alternative and is rejected on a
  concrete, checkable ground rather than taste: reducing opacity over already-AA-borderline warm greys
  (`stone-500` text sits at 4.80:1, barely clear of 4.5) pushes real content **below AA**, and the app would be
  deliberately shipping unreadable text as an emphasis technique. It is also modal-overlay behaviour by another
  name, on a codebase that has declined modals three times.
- **Emphasising an action panel with a full `sage-deep` ring on `sage-pale` (chosen) vs. `--clay` (rejected) vs.
  a modal (rejected) vs. a sticky/floating bar (rejected) vs. animation (rejected).** `--clay` is the obvious
  "make it louder" reach and is rejected on the record: the token table restricts it to *positive emphasis only*
  (streaks, milestones), it is the weakest-contrast token in the palette (3.2:1 — large/fill only), and
  overloading it to also mean "unfinished action" would leave the app with one colour carrying two unrelated
  meanings, which is how a palette stops communicating. A **modal** would genuinely solve "where do I look" —
  and is still rejected for the same reason as three times before (no modal precedent; focus-trap and dismiss
  semantics are a real primitive, not a style). A **sticky panel** was rejected in 8b and nothing has changed. A
  **pulse/flash** was rejected for the editing row in favour of a calm treatment, and would additionally need
  `prefers-reduced-motion` handling. **The chosen answer escalates *enclosure and position*, not hue** — a ring,
  a heading, a scroll-into-view and a focus move — which is also the only part of the fix that helps
  screen-reader and keyboard users at all, since none of them can see a ring.
- **Icons + tooltips for per-row actions: icon + always-visible label + a pointer-only supplementary tooltip
  (chosen) vs. icon-only with a hover tooltip (rejected) vs. icon-only with a long-press tooltip (rejected) vs.
  labels hidden at small breakpoints (rejected) vs. text-only buttons (superseded).** The first design round
  recommended against tooltips; **Jeff overruled it and also asked for "Log again" to be iconified**, so this is
  a reconciliation, not a re-argument. What survives from the first round is the **fact** that decided it: on
  touch there is no pre-activation hover, because a tap focuses and activates in one gesture — so a
  focus-triggered tooltip fires simultaneously with the action it was supposed to explain. **Long-press** is the
  only pre-activation reveal touch offers, and it is rejected concretely: no web API, collides with the
  platform's own text-selection and context menus, and is invisible to anyone who doesn't already know a tooltip
  exists. **Hiding the label at small breakpoints** is the trap version of "responsive": it puts icon-only
  buttons on precisely the devices where no tooltip can fire. So the label stays visible **at every breakpoint**
  and *is* the touch mechanism, while a real `Tooltip` component adds a fuller sentence on pointer devices, gated
  on `@media (hover: hover) and (pointer: fine)` — a capability query, deliberately not user-agent sniffing and
  not a JS `ontouchstart` test, both of which misclassify hybrid laptops. **The rule that generalises: a tooltip
  may never be the only place a control's purpose is stated** — repeating the label makes it noise, being the
  sole source makes it inaccessible; supplementary is the only honest role. Wiring is `aria-describedby` +
  `role="tooltip"`, **never `aria-label`** on a control that already has visible text (that is how WCAG 2.5.3
  Label in Name gets broken and voice control stops working); `aria-label` is reserved for the two genuinely
  label-less controls (the pin toggle, the existing ↑/↓ arrows). **Honest accounting, so the change isn't
  oversold: the icons buy scannability, not width** — an icon+label button is marginally wider than text alone,
  and the actual density win is the *removed* button ("Delete" into the edit form, 3 → 2). **Still no icon
  library**: four inline SVGs in `ui/icons.tsx` with Lucide geometry (ISC, attribution in the file header),
  `currentColor` so they inherit each `Button` variant including `danger` — matching `StatusMessage`'s existing
  inline check icon. Lucide-as-a-dependency remains the right call only past ~8–10 glyphs, a threshold recorded
  so the next person has a criterion rather than a preference. Also rejected: an overflow "⋯" menu (a new popover
  primitive for two actions), and a positioning library for the tooltip (accepted consequence: it may clip near a
  viewport edge, on desktop only, on a supplementary affordance).
- **Shading the time picker: three `<optgroup>`s as the mechanism + `<option>` colour as a bonus (chosen) vs.
  `<option>` CSS alone (rejected) vs. a marker character in the label (rejected) vs. a custom listbox
  (rejected).** **CSS alone fails the platform test and fails it silently** — it works on Windows/Linux
  Chrome/Edge/Firefox, which is exactly where Jeff would confirm it working, and does nothing on macOS or on
  either mobile platform's native picker. That is the same trap the 2026-07-26 label decision already walked
  through: *content is portable, CSS is a bonus*, and getting the order wrong leaves mobile — a primary surface
  for a "log it fast" app — unfixed while looking fixed. **`<optgroup>` was previously rejected (2026-07-26) and
  that rejection genuinely does not carry**: it was aimed at a different complaint ("too many choices"), and both
  of its stated objections were specific to that proposal — "adds 24 non-selectable rows" (this adds **3**) and
  "does nothing about alignment" (alignment is not what this is for, and the zero-padded labels still handle it).
  Reconsidering it here is a reasoned reversal on a different question, not a forgotten decision. **Encoding the
  shading into the label text** (e.g. a leading `·`) is portable but would break the fixed 8-character label
  shape that decision established eight days earlier — regressing a recent fix to deliver a lesser one.
  **A custom listbox** would give full styling control and is rejected for the fourth time on the same grounds
  (this project chose a native `<select>` over a combobox for a strictly harder version of this problem).
  **The property that makes the chosen answer safe: it degrades to today's exact behaviour** — 96 flat options,
  nothing lost — on any platform that ignores `<optgroup>`.
- **Pinning: `is_pinned boolean` (chosen) vs. `pinned_at timestamptz` (rejected) vs. a `sort_order` on `meals`
  (rejected) vs. favourites-as-tags (rejected).** A timestamp costs the same and records more — but nothing
  reads it, because the pinned block is ordered **alphabetically** (so pinning one meal never moves another),
  and this doc has already rejected storing a column nothing reads once, for save-as-meal provenance. If
  recency-of-pin ordering is ever wanted it is a one-line migration made for a reason. **Full manual ordering**
  (a `sort_order` on `meals`, drag-to-reorder) is a much bigger interaction — drag-and-drop is a primitive this
  codebase doesn't have — to answer a request that was specifically "keep these at the top". **Tags/categories/
  folders** remain out of scope project-wide, and 7c explicitly warned that phase must not be the door they come
  in through; a single boolean is deliberately the smallest thing that satisfies the ask without opening that
  door. **Pinning does not override the filter** — an explicit search that silently returns a non-match would
  make the "Showing N of M" readout untrue.
- **Duplicating a meal: prefill `"<name> (copy)"` (chosen) vs. a blank name (rejected here, though it is the
  recorded choice for save-as-meal).** These two look like the same question and are not, which is why the
  divergence is recorded rather than assumed. Phase 7b's blank-name decision was reasoned specifically: a
  first-item prefill is **actively wrong** on a multi-item group ("Eggs" for eggs + toast + coffee), so the
  failure mode is a library of confidently *mis*labelled meals — worse than no name, because it looks
  deliberate. `"Weekday breakfast (copy)"` cannot be wrong in that way: it is provisional and *visibly*
  provisional. **The rule that generalises: prefill when the derived value cannot be wrong; leave blank when it
  can.** Also rejected: auto-naming with no prompt at all (a library slowly filling with "(copy)" entries nobody
  named), and hunting for a unique `"(copy 2)"` (meal names have no uniqueness constraint and duplicates are
  explicitly legitimate — inventing uniqueness in the UI would imply a rule the data model doesn't have).
  **A duplicate never inherits `is_pinned`** — pinning describes your current shortlist, not the meal's content,
  and a half-edited copy silently arriving at the top of the library is the opposite of what pinning is for.
- **Three lettered phases (8d/8e/8f) rather than one "Phase 8d" (chosen).** Applying the scoping rule this doc
  already wrote down (reach outside the phase's own file set; fix vs. new capability): a single phase would carry
  a **migration**, a **new server action**, **two new shared `ui/` primitives**, a change to the app's
  most-used control on three call sites, and interaction changes on three screens — the unreviewable-checkpoint
  failure mode that rule exists to prevent, and one that has already produced a blocking finding twice when a
  diff grew past what a reviewer could attribute. The split is by *reviewable concern*, not by size: **8d** is
  `/food` + `/metrics` UI with one pure helper; **8e** is one control, three call sites, a cross-platform manual
  check and an amended prior decision; **8f** is `/meals` plus the batch's only schema change — and Phase 2's own
  precedent is that the highest-risk DB work is isolated deliberately. Bundling 7 and 8 *together* inside 8f is
  the deliberate exception, on 8b's own reasoning for bundling its two bulk actions: they share files, share the
  card action row, and have to be designed against each other (does a duplicate inherit a pin?), so splitting
  them would mean two phases reopening the same file to re-derive the same invariants.
- **Retiring the dashboard (chosen, Phase 8h)** vs. keeping it minimal, vs. building a real read-only dashboard
  (last-logged weight/body fat, an oldest-to-latest progress chart). Jeff asked for a recommendation, not a menu.
  **Keeping it minimal** is what was rejected first: the page is a literal duplicate of `/food`'s `DailyTotals`
  behind an extra click, so it costs a navigation stop and returns nothing new — indefensible in an app whose
  first-stated priority is fast logging. **Building a real dashboard** was evaluated on its own merits rather than
  waved off with the 2026-07-31 quick-add descope (which was a *write-path* argument and genuinely does not
  transfer to a read-only summary), and rejected because every candidate is already answered better elsewhere: a
  progress chart would be a smaller, weaker copy of `/trends`, which already does 7/30/90 with real gap handling,
  and would become a second place for the same fact to drift. The one genuinely-new fact Jeff named —
  **last-logged weight/body fat** — is real and exists nowhere today, so it is built, but on **`/metrics`**, the
  screen a user already opens to ask that question, instead of justifying a whole route. Net: one fewer screen,
  one more piece of information, no duplicated rendering of anything. Also rejected: repointing the wordmark and
  the auth redirects at `/food` (a routing refactor to avoid a one-line `redirect()`), and a Server Component
  read for the last-logged line (correct in principle — "most recent row" needs no browser tz — but it would go
  stale the instant the user saves, on the very screen that just changed).
- **Delete on the entry row + `window.confirm` (chosen, Phase 8g)** vs. Phase 8d's edit-form placement, vs. a row
  delete with no prompt, vs. a custom confirmation modal, vs. undo. Jeff reversed 8d after using it; the reversal
  keeps 8d's *concern* and swaps its *mechanism*. `window.confirm` wins on direct in-repo precedent
  (`MealList.handleDeleteMeal` does exactly this for exactly this class of action) and because this codebase has
  declined a modal primitive four times. **No prompt at all** is the variant most likely to be preferred and is
  called out as a one-line removal if Jeff wants it. **Undo** is the genuinely better answer and is deferred as a
  real feature, not smuggled in as a safeguard (§5).
- **Editing-row highlight: escalate enclosure, not fill (chosen, Phase 8g)** vs. a `sage-pale` row fill, a clay
  tint, or a shadow. The fill is ruled out by the same constraint as in 8b (it would swallow the `sage-pale`
  "From a saved meal" badge and fight the row hover); clay is restricted by the token table to positive emphasis
  and is the weakest-contrast token; a shadow would invent a fourth vocabulary. An inset ring plus a filled
  dark pill is the same escalation logic the ladder already applies at level 3, and a dark chip beside a pale
  chip stays legibly distinct. `ring-*` rather than `border-*` purely because the row sits in a `divide-y` list
  where a real border reflows every row below it.
- **Visual identity v2: swap the token *values*, keep the token *structure* (chosen, Phase 8i)** vs. a
  per-screen restyle, vs. a component-library adoption, vs. leaving the palette and only removing the serif.
  **Leaving the palette** was rejected by the brief itself — Jeff named the green buttons and the cream
  background, not only the serif. **A per-screen restyle** is what the 2026-07-25 rollout was designed to make
  unnecessary, and it worked: the primitives plus `@theme inline` mean one file of token values plus eight
  primitives carry most of the change, which is why this is tractable at all. **Adopting a component library**
  (shadcn/ui, Radix, MUI) would match the "modern SaaS" register fastest, and is rejected on this project's own
  standing bias: it replaces eight small, fully-understood, already-reviewed primitives with a dependency and a
  second styling system, for a look already reachable by editing nine hex values. The chosen path is also the
  only one that is **fully reversible** — every decision here is a token value, and reverting is one file.
- **Tokenising the neutrals (`--muted` / `--line` / `--line-strong`) rather than using raw `slate-*` (chosen)**
  vs. the current approach of tokenising only brand colours and picking neutrals per component from Tailwind's
  built-in scale. The current approach is why this project has shipped **three** measured contrast defects
  (`placeholder:text-stone-400`, `inputClass`'s `border-zinc-300`, `Card`'s `border-stone-200` — and now a fourth
  found in this round, `Button` secondary's `border-stone-300`), every one of them a per-component neutral picked
  by eye and never checked. Three named neutral roles with their ratios recorded turns "which grey?" into a
  lookup, and makes the rule greppable: **no raw colour-scale utility for text or borders in a component**.
  Accepted cost: three more tokens than the previous set, and one more concept for a reader to learn.
- **`--line` (1.49:1) for card borders, reversing half of the NB-2 amendment (chosen)** vs. keeping every border
  at ≥3:1. This is the round's one genuinely arguable accessibility call, so it is argued rather than asserted:
  SC 1.4.11 covers *UI components* and *graphics required to understand content*, and a card is neither — it is a
  decorative grouping whose contents lose no legibility if its edge is not perceived. Keeping 4.80:1 borders on
  every card is a large part of what currently reads as "busy". The half of NB-2 that *does* apply — inputs,
  selects, and the secondary button — is kept **and extended to `Button`, which NB-2 missed**. Flagged in §5 as
  the item to challenge if a reviewer reads the SC more strictly; the fix if they do is one token value.
- **Dropping Fraunces without adding a replacement face (chosen)** vs. adding Inter (or another sans) as a
  second family, vs. keeping a serif for headings only. Keeping a serif is what Jeff rejected by name. A second
  family is rejected because **with the serif gone there is no functional distinction left for one to draw** —
  Geist Sans already covers body, UI, data and headings, is already self-hosted, and the heading signal moves to
  weight/size/tracking, which is exactly the reference's own treatment. Same bar this project applied to Lucide
  and to combobox primitives: a dependency needs a job. **Offered rather than decided**: if Jeff wants the
  reference's specific face, swapping Geist for Inter is one import and one CSS variable, with zero component
  changes — §5.
- **Deleting the sage arc rather than restyling it (chosen)** vs. a blue arc on the auth screens. The motif was
  chosen in 2026-07-25 as the *one* deliberate visual risk in an otherwise-quiet identity, was already narrowed
  once (2026-07-26, off the dashboard) for reading as arbitrary, and the reference direction is explicitly
  undecorated. Recolouring it would carry forward a flourish that the new register has no use for, and would
  keep alive `--sage`, a token nothing else consumes. Reversed cleanly instead of kept on life support.
- **Goal progress in `DailyTotals` on `/food` (chosen, Phase 8j)** vs. reviving the dashboard for it, vs. a new
  `/goals` screen, vs. `/trends`. **The dashboard** was checked against 8h's actual recorded reasoning rather
  than assumed dead: 8h retires `/` *because it duplicates `DailyTotals`* — putting goal progress there would
  re-create that duplication with a second copy of the progress rule to drift, and would mean un-deleting a route
  in the same breath as deleting it. **A new screen** adds a navigation stop for three numbers. **`/trends`**
  already draws the same targets as chart reference lines, which is the *retrospective* view; this is the
  *in-the-moment* one, and it belongs where the logging happens. The deciding argument is the app's own first
  priority: "how much room do I have left?" is asked **while adding food**, so it is answered in the component
  already on screen at that moment, at zero navigation cost.
- **Separate `pct` (unclamped) and `barPct` (clamped) on `GoalProgress` (chosen)** vs. one clamped percentage.
  One clamped number is the obvious simplification and it makes the app assert you are exactly on target when you
  are 40% over — the same failure mode this project already rejected for `proteinCaloriePct`, which returns >100%
  as-is because the value signals a real fact. The bar is a *rendering* constraint, not a *data* one, so the
  clamp lives in the field that feeds the width and nowhere else.
- **A server-side goals read on `/food`, against that screen's own client-read convention (chosen, Phase 8j)**
  vs. adding a third query to `FoodDayView`'s client `Promise.all`. `/food` reads client-side because its data
  depends on the browser's local "today"; goals do not, cannot be changed from this screen, and would otherwise
  be refetched on **every day change** for a value that changes monthly. Note the deliberate asymmetry with
  Phase 8h's last-logged-weight line, which is a *client* read for the mirror-image reason — it *can* be changed
  on the screen that shows it, so a server read would go stale after a save. Both are recorded so neither gets
  "simplified" into the other's bug. Accepted, already-known cost: `getGoals()`'s ensure-row upsert gains a third
  read-only caller (§5).
- **The goal bar is decorative (`aria-hidden`) with the numbers as text (chosen)** vs. `role="progressbar"` with
  `aria-valuenow`. The caption already states consumed, target and remaining in prose; a progressbar role would
  make a screen reader announce the same fact twice, the second time as a bare percentage with less meaning. It
  also disposes of the 1.4.11 question by construction — nothing depends on perceiving the bar. **Rejected
  outright: turning the bar red when over target** — red is semantic-error in this palette, exceeding a calorie
  goal is not an error, and it would be a colour-only restatement of a word already on screen.
- **Trigger row and panel outlet as separate containers (chosen, Phase 8k)** vs. keeping each dialog
  self-contained and making the layout hint smarter (a wider `w-full`, an `order-*` utility, a CSS grid with a
  named panel area). The self-contained shape is what produced the bug: a component that renders both its
  trigger and its panel is **laying out its siblings from the inside**, and every fix from that position is a
  hint that has to keep being correct as buttons are added or reordered. The 2026-08-10 `w-full` patches are the
  evidence — they were right, they shipped, and the row still splits. Separating the two containers makes
  "triggers stay together" a structural property with nothing left to get wrong, and it moves two odd components
  onto the panel-only shape `CopyGroupDialog`/`SaveGroupAsMealDialog` and `LogMealDialog`'s own fixed-meal mode
  already use. Accepted cost: `FoodDayView` grows one more piece of state (`dayAction`), and two components lose
  the convenience of being droppable anywhere.
- **One `ActionPanel` for the whole of select mode, with a step-dependent heading (chosen, Phase 8k)** vs.
  wrapping `EntrySelectionBar` in its own `ActionPanel` and leaving the bulk panels as a second one beneath it,
  vs. giving the bar level-3 *colours* without `ActionPanel`'s behaviour, vs. a fourth ladder rung. **Two stacked
  accent boxes** is the obvious literal reading of Jeff's request and is rejected because level 3 means "an
  action is waiting for you to finish it" — rendering it twice, nested, for one action is exactly the dilution
  that keeps `ActionPanel` off `FoodEntryForm`. **Borrowing the colours without the component** would duplicate
  the treatment in a second place and invite the two to drift, which is what the ladder exists to prevent. **A
  new rung** is unjustified: nothing here means something the ladder cannot already say. The chosen design also
  falls out of a rule this project already has — suppressing the bar's buttons while a bulk form is open is the
  same "a surface in a special state yields its ordinary actions" rule as the editing row and the active group,
  and it fixes the focus order by construction rather than by a special case.
- **A visually grouped but *unaccented* toolbar (chosen, Phase 8k)** vs. accenting it, vs. leaving it ungrouped,
  vs. `role="toolbar"`. Jeff asked whether the row should be "highlighted like a toolbar", and the answer splits:
  **grouping** conveys *scope* ("these act on the log below") and is worth having; **accent** conveys *urgency*
  and would be on screen permanently, saying nothing. `role="toolbar"` is rejected on a concrete contract
  problem, not on taste — it promises roving-tabindex arrow-key navigation this codebase has no pattern for, and
  an unimplemented promise is worse for a screen-reader user than no role at all. A group `aria-label` is
  rejected too: it adds a new accessible-name string to the page with this project's worst locator-collision
  history, for no benefit over three clearly-labelled buttons.
- **A disclosure button with a rotating chevron for the lookup expander (chosen, Phase 8k)** vs. a tab, vs.
  leaving it a bare accent link, vs. an always-open lookup panel. **A tab** is rejected on a concrete structural
  ground rather than a definitional one: `FoodLookupPanel` already contains a `role="tablist"` (Search/Barcode),
  so a tab trigger would nest tabs inside tabs. **Always-open** is rejected by the recorded progressive-disclosure
  decision — the fast manual path must not have to look at the lookup panel at all. **The bare link** is the
  status quo Jeff is reporting as broken, and its real defect is not visual: with no `aria-expanded` it does not
  announce as a disclosure to a screen reader either, so this fixes two problems with one control. Extending it
  to the neighbouring "Add detail" expander is deliberate: one form with two idioms for one concept is worse than
  either idiom.
- **Wordmark + tagline + a stronger card for the auth screens (chosen, Phase 8l)** vs. adding a decorative
  element in the new palette, vs. a logo mark, vs. only adding the app name. **Any decorative SVG** is rejected
  by a hard constraint that already exists in the repo: `e2e/visual-identity-acceptance.spec.ts` asserts zero
  app-owned `<svg>` on both auth screens, a guard Phase 8i added days ago precisely so the deleted arc could not
  return — reversing it in the next phase would make that decision meaningless. **A logo mark** was explicitly on
  8i's own "do not build" list and nothing in Jeff's finding requires one; a **typographic** wordmark gives the
  page identity with no asset, no new token and no test to rewrite. **Only the name, no tagline** is a legitimate
  smaller version and is offered as such — the tagline is one deletable line, and the phase's real requirement
  (the page says what the app is) is satisfied either way. Extracting `ui/Wordmark.tsx` rather than hardcoding
  the string twice is the same one-implementation reasoning as `StatusMessage`/`DayNavigator`.
- **Reusing `/auth/callback` for the reset link (chosen, Phase 8m)** vs. a dedicated
  `/auth/reset-callback` Route Handler, vs. pointing the email straight at `/reset-password`. **Straight at the
  page** cannot work and the reason is worth recording so nobody tries it: `/reset-password` is a Server
  Component, and Next.js forbids writing cookies during a Server Component render — so the code exchange would
  succeed and the session would be silently dropped. **A second callback route** would duplicate the code
  exchange, the `safeRedirectPath` guard and the failure redirect for no behavioural difference; the existing
  route already accepts and validates `?next=`, which is the whole feature. The only cost of reuse is one
  signup-specific error string, which is generalised (keeping the substring an existing test asserts).
- **Neutral "if an account exists…" confirmation (chosen, Phase 8m)** vs. telling the user when no account
  matches. The friendly version turns an unauthenticated form into an account-existence oracle for any address
  someone chooses to type. It is also not faithfully implementable: Supabase's `resetPasswordForEmail`
  deliberately does not distinguish the two cases, so a per-case message would be inventing a distinction the API
  refuses to make. A genuine send failure is still surfaced separately, because swallowing it would tell the user
  an email is coming when none is.
- **Sign out and return to `/login?reset=success` after a reset (chosen, Phase 8m)** vs. dropping the user
  straight into `/food` on the recovery session. Going straight in is one fewer step and is the more common
  product choice, so it is rejected on reasons rather than reflex: the session in hand was granted by possession
  of an emailed link rather than by knowledge of the new password, and a single login immediately proves the new
  password works — on an action a user performs approximately never, that is a good trade. It also reuses the
  `?flag=` notice mechanism `/login` already has, instead of inventing a cross-navigation flash message this app
  has never needed.
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
- **The editing-row highlight already exists and is committed; "I see no highlight" is most likely a stale-build
  symptom (2026-08-05). No design work is scheduled, and none should be added.** It arrived as one of Jeff's
  manual-testing findings this round, but it **shipped in Phase 8b**: `FoodDayView` passes `editingEntryId`, and
  `FoodEntryList` renders `border-l-4 border-l-sage-deep` plus a visible "Editing" label on the matching row and
  hides that row's three actions. Confirmed present **in committed source**, not merely in an uncommitted working
  tree. Jeff reports seeing no highlight at all. **The leading explanation is environmental, and this repo has a
  long documented history of exactly this symptom**: a stale `next dev` process and/or a stale `.next` cache
  presenting old output while the source is correct — see `ai-context/PROGRESS.md`'s repeated entries (the
  2026-07-25 stale-server finding, the `NEXT_PUBLIC_*` cache note, and the 2026-08-02 case where deleting
  `.next` under a running server made 52 of 54 passing tests look like a severe regression). **First step is a
  clean restart — kill the dev server, `rm -rf .next`, hard-refresh — then click "Edit" on an entry.** Only if
  the highlight is still absent after that is there anything real here, and it would then be a **developer
  bug-fix task against shipped behaviour, not a design gap** — the design is already written (§3.4) and does not
  need revisiting. A distant second possibility, recorded only so it isn't rediscovered: 8b deliberately chose
  the calmest level-1 treatment and the existing `scrollIntoView` targets the **form**, so the highlighted row is
  often below the fold at the moment "Edit" is clicked. If a clean build shows the highlight and Jeff still finds
  it too quiet, *that* is a taste call for him — not a defect, and not a licence to rebuild the feature.
- **`FoodDayView`'s `today` is resolved once at mount, and the day navigator inherits that.** `today` comes from
  a `useMemo` over the mount-time tz, so a session left open across local midnight has a stale "today" — the
  `<input max>` is already stale in exactly the same way. The navigator's "Next"/"Today" disabling **must key off
  that same value** so the two never disagree; the staleness itself is **pre-existing and out of scope**, and the
  server-side future-day cap is the real backstop regardless (a stale client can at worst be *refused*, never
  allowed through). Recorded so nobody "fixes" it in one place and creates a UI that disagrees with itself.
- **The day-navigation buttons do not fix the open `Day`-input race, and the tempting conclusion is the wrong
  one.** New acceptance rows driven through the buttons will very likely be stable where `.fill()`-driven ones
  flake — because they bypass the controlled native input entirely, not because anything was repaired. The bug
  (ten documented reproducing cases) stays open and users still reach the input. **The genuinely useful outcome
  is diagnostic:** a reliable button path beside an unreliable `.fill()` path localises the fault to the
  controlled-value round-trip, which is the standing hypothesis. If anyone later reports the race as "fixed by
  8d", that is a misreading to correct.
- **`<optgroup>` support is asserted from documentation, not from this machine, and the risk is that it fails
  invisibly.** Group labels are expected everywhere including both mobile native pickers; option colour is
  expected on Windows/Linux only. Neither claim is verifiable in CI (Playwright cannot inspect a platform's
  native picker chrome), so §6 splits the mechanical assertions (three groups exist, 96 options still present and
  selectable, values unchanged) from the **manual cross-platform check**, which is Jeff's or the developer's by
  hand. **The mitigating property is that the failure is benign**: a platform ignoring `<optgroup>` renders
  today's exact control. A reviewer should not report "I couldn't see the groups on my phone" as a defect
  without also checking whether that platform renders *any* optgroup.
- **De-emphasis must not become illegibility.** The Early/Late option colour is `stone-500` (4.80:1 on white)
  specifically because this repo has already shipped, and had to fix, greys below AA (the NB-2 amendment). If a
  future tweak makes the shaded hours "more obviously shaded" by going lighter, it will re-break a fixed
  accessibility defect on the app's most-used control. The floor is 4.5:1, and the shade is already at it.
- **`/meals`' card action row is now crowded, and this is deliberately left unsolved (Jeff's call, 2026-08-05:
  proceed as designed).** After 8f each card carries **Log this meal · Pin · Hide items · Rename · Duplicate ·
  Delete** — the four that already ship plus the two 8f adds. Jeff was given that breakdown and chose to
  proceed. That is the same
  density complaint Jeff raised about `/food` rows, on a different surface, and it is not being solved in passing
  because the plausible answers differ in kind: (1) an overflow "⋯" menu — the best UX answer and a **new
  popover primitive** this codebase has never had, so it needs its own round; (2) move **Delete** into the rename
  form, mirroring exactly what 8d does for `/food` rows and `MetricForm` already does — cheap, consistent, and
  probably the right first step; (3) iconify the maintenance actions. **Recommendation: take (2) if the row feels
  bad in use, and do not take (1) without an architect round.** Logged rather than done, so it is a decision
  rather than an oversight.
- **Pinning has no cap, and does not need one — but the failure mode is worth naming.** Nothing stops a user
  pinning all 40 meals, at which point pinning conveys nothing and the library looks unchanged. That is
  self-correcting, self-inflicted and instantly reversible, so a limit would be solving a non-problem with a
  magic number (the same reasoning 7c used against a `.limit()`). If a cap is ever wanted it belongs with the
  section-heading design that was also declined here.
- **Two "copy a meal by value" paths now exist and must not drift.** `createMealFromEntries` (entries → meal) and
  `duplicateMeal` (meal → meal) share the copy-by-value semantics, the compensating delete, the
  totals-equal-by-construction invariant and the read-only-on-source property — but they differ in one place that
  matters: `sort_order` is **assigned** in the first and **preserved** in the second. A future refactor that
  "unifies" them by routing both through one helper will silently pick one of those behaviours for both.
  Recorded as a tripwire, with the difference stated in §3.3 at the point of temptation.
- **OPEN QUESTION (2026-08-07, recommendation recorded, Jeff's call): an all-time "oldest to latest" range on
  `/trends`.** Jeff's finding-1 wording included *"weight & body fat progress from oldest to latest logged
  values"*. Phase 8h retires the dashboard rather than building a second chart there, which leaves this ask
  homeless — its real home is an **`All`** option beside 7/30/90 on `/trends`. **Recommendation: not now.** It is
  not free: it needs an extra query for the user's earliest logged date before the window can even be computed,
  and the dense day-by-day series builders would then produce an unbounded array (two years of daily logging is
  ~730 points on one axis, with the `isReal`-dot convention drawn over all of them). 90 days already covers the
  useful window for a tool logged daily. Raised here so the ask isn't silently lost with the dashboard.
- **The `window.confirm` on row delete is a safeguard, not an undo (2026-08-07, Phase 8g).** Reversing 8d's
  placement puts the app's only irreversible action back one tap away on a list. The confirm makes it two
  deliberate acts, which is the same protection 8d bought with the edit-form detour, at a lower interaction cost —
  but it is still a prompt people learn to dismiss reflexively, and **this app has no undo anywhere**. Accepted
  knowingly. The honest escalation, if a real accidental deletion ever happens, is an undo affordance (a
  `StatusMessage` with an "Undo" that re-inserts), which is a real feature with its own action-contract design —
  explicitly out of 8g, and the thing to build rather than making the confirm scarier.
- **RESOLVED (Jeff, 2026-08-09): the body/UI typeface is Inter, not Geist Sans.** Phase 8i's implementation
  should swap Geist for Inter as the sole face — **one import and one CSS variable in `app/layout.tsx`, zero
  component changes**, since everything already resolves through `--font-sans`.
- **RESOLVED (Jeff, 2026-08-09): the palette values are accepted as the starting point, not held for
  re-measurement first.** The reference was described in prose only, and every hex in §3.4's token table is the
  architect's choice consistent with that description ("light gray page, white cards, bold blue button,
  orange/blue progress bars, dark navy card"), chosen for the contrast ratios recorded beside it. Jeff confirmed
  implementation should proceed with these values as-is; if any specific colour is wrong to his eye once it's
  actually on screen, the
  fix is a token value in `globals.css` — but **any substitution must be re-measured**, because several of these
  values were chosen *specifically* to clear a bar the obvious lighter choice missed (`--muted` is `#475569` and
  not `#64748B` precisely because the latter is 4.34:1 on `--canvas`).
- **`Card`'s border drops below 3:1, and this is the item to challenge if you disagree with the SC reading.**
  Phase 8i reverses half of the 2026-07-26 NB-2 amendment on the grounds that WCAG SC 1.4.11 covers *UI
  components* and *graphics required to understand content*, and a card container is neither. The other half —
  inputs, selects, the secondary button — is kept and **extended to `Button`, where NB-2 missed a 1.49:1 border
  on a genuine UI component**. A reviewer who reads 1.4.11 as covering container edges should say so at the
  checkpoint; the remedy is one token value (`--line` → `--line-strong` for `Card` only), not a redesign. The
  standing rule this leaves behind — **UI components `--line-strong`, decorative containers `--line`** — is the
  part that must survive either way, since per-component grey-picking is what produced all four defects.
- **Phase 8i and Phase 8h touch overlapping files, and the order matters (though neither is a hard dependency).**
  8h deletes `components/food/TodaySummary.tsx` and replaces `(app)/page.tsx`'s body with a `redirect`. Both
  files carry `font-serif` and brand-token classes 8i would otherwise restyle. **Recommendation: land 8h first**
  — it shrinks 8i's surface by two files and, more importantly, 8i's rewritten
  `e2e/visual-identity-acceptance.spec.ts` currently asserts against `/` and must be written against whichever
  state `/` is actually in. Running 8i first is harmless (two files get restyled and then deleted); running them
  concurrently is not, because both edit that same spec file.
- **The old identity's acceptance suite pins values Phase 8i reverses — the fifth consecutive instance of this
  pattern, which has produced a blocking finding twice.** `e2e/visual-identity-acceptance.spec.ts` (every
  assertion) and `src/components/food/FoodEntryList.test.tsx` (8 class-name assertions) both fail by design on
  the token swap. Both must be **updated in the same change**, not left red and not silently deleted. Named here,
  in §3.4 and in §8 because the last four phases each needed it named and two of them still shipped without it.
- **Nothing enforces the "no raw colour-scale utility for text or borders" rule.** It is a convention, checkable
  only by grep or by eye, exactly like the `autocomplete` convention. The natural escalation is the same one
  recorded there — **a lint rule, if the convention is ever violated twice**, not now. Recorded so the next
  contrast defect is treated as a signal about the mechanism rather than a one-off.
- **`getGoals()`'s ensure-row upsert now has three read-only callers** (`/settings`, `/trends`, and — Phase 8j —
  `/food`). A page that only displays goals still performs a write on a first-ever visit. Harmless and idempotent,
  already recorded for `/trends`, and now slightly more visible because `/food` is the app's most-loaded screen.
  The fix if it ever matters is a read-only `getGoalsIfExists` that returns `null` rather than creating the
  default row — deliberately deferred rather than bundled into a presentation-and-progress phase.
- **A goal target can be edited retroactively, and past days will re-render against the new one.** This is not
  new — it is the accepted consequence of the 2026-07-19 "single current goal, not goal history" decision, which
  already applies to the chart reference lines. Phase 8j makes it *more visible*, because `/food` can be browsed
  to any past day and will show that day's totals against **today's** target. Restated here rather than
  rediscovered as a bug; a goal history remains explicitly out of scope.
- **Entering select mode focuses "Clear" when nothing is selected (Phase 8k) — known, accepted, not solved.**
  `ActionPanel` focuses its first *enabled* control on mount; with N=0 both bulk buttons are `disabled`, so focus
  lands on "Clear", which is harmless (it clears an empty selection) but arbitrary. The alternatives are worse
  than the wart: an opt-out prop on `ActionPanel` disabling its own principal behaviour for one caller, or
  reordering the bar so a dismissal ("Done") is focused first. Recorded so a reviewer sees a decision rather than
  an oversight; if it ever grates, the honest fix is making the bar's first element a focusable summary, which is
  its own small design question.
- **Phase 8k moves open-state ownership, which is exactly when the N-3 unmount rule gets re-derived wrong.**
  `dayAction` and the select-mode `ActionPanel`'s `key` must be driven **only** by user clicks — never by
  `loading`, a fetch nonce, `entries.length` or the selection. A wrongly-keyed implementation would pass the new
  layout tests and silently reintroduce the state-wiping bug this codebase has now shipped **three** times
  (`MealsView` in 7, `FoodEntryList` in 7b, guarded structurally in 8b). §6 requires the survives-a-background-
  refresh assertion to be re-run against the *new* structure, not assumed to carry over.
- **Phase 8k is the first phase in six that carries no required rewrite of an existing acceptance file — verify
  that, don't trust it.** The behaviours it changes (which container a panel renders in, a bar's chrome, a
  trigger's icon) are mostly invisible to the existing suites, and the specific patterns checked while designing
  it (`phase8b`'s `selectionBar()` helper, its `{ name: "Copy selected", exact: true }).last()` submit lookups,
  `phase8d`'s "focus lands inside" rows) all appear to survive. But "appear to survive" is exactly the claim that
  produced a blocking finding twice, and the suppression of the bar's buttons while a bulk form is open is the
  most likely place it is wrong. Run the full suite before believing this bullet.
- **`/reset-password` is reachable with no session, and the page-level check is UX, not authorisation.** The
  `(auth)/` group has no auth gate by design (login and signup must be reachable logged-out), so the reset page
  performs its own `getUser()` check purely so a stale link renders an explanation instead of a dead form.
  `updatePassword` re-checks server-side and is the actual control. A reviewer should test the action directly
  with no session, not only through the page.
- **The recovery email's redirect URL must be on Supabase's allow-list, and this project has already lost a
  session to exactly that.** `resetPasswordForEmail`'s `redirectTo` is
  `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password` — a same-origin URL **with a query string**, which
  signup's plain `/auth/callback` does not exercise. `supabase/config.toml` currently has
  `site_url = "http://localhost:3000"` and `additional_redirect_urls = ["https://localhost:3000"]`. **If the
  reset email lands anywhere other than the callback, the allow-list is the first suspect**, and the remedy is
  adding a same-origin wildcard entry to `additional_redirect_urls` (a `supabase/` edit the developer owns, plus
  the equivalent entry in the hosted project's dashboard when one exists). Recorded because the 2026-07-25
  `127.0.0.1`-vs-`localhost` bug had this exact shape and cost real time.
- **Supabase's built-in email sender is the whole delivery mechanism for password reset, and its rate limits
  apply.** `supabase/config.toml` sets `[auth.rate_limit] email_sent = 2` per hour locally, and the hosted
  built-in sender has its own low limits — so a user who requests several resets in a row, or a developer testing
  the flow repeatedly, will hit a send failure rather than a bug. This is the accepted consequence of the
  2026-07-19 "built-in confirmation email for v1, no custom SMTP" decision, now with a second consumer; the
  documented pre-scale follow-up (a real SMTP provider configured in the Supabase dashboard) is unchanged and is
  still config, not code.
- **OPEN, not designed: changing your password while logged in.** Phase 8m covers *forgot*, which is what Jeff
  asked for. There is still no way for a signed-in user to change a password they remember — a `/settings`
  feature needing a current-password re-auth decision of its own. Named so it is a deliberate gap rather than an
  assumed one.
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
- `goal-progress.ts` (Phase 8j): `goalProgress(1240, 2000)` → `remaining 760`, `pct 62`, `barPct 62`,
  `isOver false`. **The row that must not be got wrong** — *over target keeps `pct` truthful while clamping only
  the bar*: `goalProgress(2800, 2000)` → `remaining -800`, **`pct 140`**, **`barPct 100`**, `isOver true`; assert
  both fields separately, since a single clamped number passes any test that only checks the bar. Exactly on
  target (`goalProgress(2000, 2000)`) → `remaining 0`, `pct 100`, `isOver **false**` (equal is not over). Zero
  consumed → `pct 0`, `barPct 0`, full `remaining`. **Returns `null`** for a `null` target, a `0` target and a
  negative target (three separate cases — the last two are the divide-by-zero / infinite-bar guards, and a naive
  `if (!target) return null` accidentally passes the `0` case while still breaking on `-1`). `pct` rounds to a
  whole number. Pure and side-effect free: no Supabase/React import, no clock read.
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
- `datetime.ts` (Phase 8d/8e additions): `shiftIsoDate` moves one day forward/back across a **month** end
  (`"2026-01-31"` +1 → `"2026-02-01"`), a **year** end (`"2026-12-31"` +1 → `"2027-01-01"`), and a **leap day**
  (`"2028-02-28"` +1 → `"2028-02-29"`); `shiftIsoDate(d, -1)` then `+1` round-trips to `d`; `deltaDays: 0` is
  identity; malformed input is returned unchanged. **The row that catches the real bug:** the same input yields
  the same output with the runner's `TZ` set to a **negative-offset** zone (`America/Chicago`) — this is what a
  `new Date(iso)`-based implementation gets wrong, and it is the third time this trap appears in this suite.
  `quarterHourOptionGroups`: exactly **3** groups of **24 / 56 / 16**; boundaries land exactly at `06:00` and
  `20:00` (assert `05:45` is Early and `06:00` is Daytime; `19:45` is Daytime and `20:00` is Late);
  `deEmphasized` is true for the first and last group only; **the identity row — concatenating the groups'
  options deep-equals `quarterHourOptions()`** (same values, same labels, same order), which is what mechanically
  proves no option was lost, duplicated or reordered by the grouping. `quarterHourGroupIndexFor` places an
  **off-grid** legacy time (`"09:07"`) in the correct group, and places both `00:00` and `23:45` correctly.
- `meals.ts` (Phase 8f additions): `sortMealsByName` puts **every** pinned meal ahead of **every** unpinned one
  regardless of name (a pinned `"Zebra"` precedes an unpinned `"Apple"`), sorts alphabetically **within** each
  block, and still breaks ties on `created_at` then `id` inside a block; pinning one meal does **not** reorder
  the others (assert the unpinned block's order is byte-identical before and after); all-pinned and none-pinned
  both degrade to the existing plain alphabetical order; still returns a new array and does not mutate.
  `duplicateMealName`: `"Weekday breakfast"` → `"Weekday breakfast (copy)"`; applying it twice yields
  `"... (copy) (copy)"` (asserted deliberately — it is the accepted behaviour, not an oversight); whitespace is
  preserved rather than trimmed away silently.
- `auth-validation.ts` (Phase 8m additions): `validateForgotPasswordInput` rejects an empty and a
  whitespace-only email and a malformed one, accepts a valid one, and reports on the **`email`** field (the
  existing `FieldError` union is unchanged — assert the field name, since a new literal would be a type break
  the forms silently mis-render). `validateNewPasswordInput` rejects a password shorter than
  `MIN_PASSWORD_LENGTH`, rejects a mismatched confirmation on the **`confirmPassword`** field, accepts a valid
  matching pair, and — the row worth having — **reports both errors at once** when the password is too short
  *and* the confirmation differs, so the form can't show one problem, get it fixed, and then reveal another.
  Both must reuse `isValidEmail`/`isValidPassword` rather than restating the rules (checkable by review: a
  second regex or a second literal `6` in this file is the defect).
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
- **Day navigation (2026-08-05 addition, Phase 8d):**
  - *It moves the day, on both screens:* on `/food` and on `/metrics`, "Previous" shows the previous calendar
    day's data and "Next" returns; assert against **seeded data for each day**, not just the input's value, so a
    control that changes the label without refetching would fail.
  - *The cap holds (the row to hammer):* on today **"Next day" is disabled**; on a past day it is enabled. Then
    the adversarial half — **re-enable it in the DOM and click it on today** — and assert no future day is ever
    loaded or logged to. The client control is convenience; the cap is the invariant.
  - *There are exactly two navigation buttons:* "Previous day" and "Next day", and **no "Today" control**
    (dropped by decision — §3.4/§4; assert its absence so it can't reappear undocumented).
  - *Month/year/leap boundaries work end-to-end*, not just in the unit test: navigate across the 1st of a month
    and assert the correct day's entries render.
  - *It goes through the same choke point:* on `/food`, select entries and start an edit, then press "Previous" —
    assert select mode is off, nothing is ticked and the edit is cleared, exactly as changing the date input
    does. A navigator wired to `setSelectedDate` instead of `handleDayChange` passes every other row and fails
    this one.
  - *Both screens agree:* the same control renders on `/metrics`, with the same disabled rules — the point of it
    being shared.
  - *Prefer these buttons over `.fill()` in new rows* — see §5; they are not a fix for the documented `Day`-input
    race, so **do not** re-point existing flaking specs at them and report the flake as resolved.
- **Active-group suppression and action-panel emphasis (2026-08-05 addition, Phase 8d):**
  - *An open group expander hides that group's row actions:* open "Copy this group" and assert **no** entry
    inside that group shows "Log again"/"Edit"/"Delete", while a **different** group's rows still show all three
    and still work. Repeat for "Save as meal" — both actions, or the rule isn't implemented.
  - *The active group is marked, and only it:* exactly one `<section>` carries the accent treatment while an
    expander is open, and none does when all are closed.
  - *The header's sibling action is hidden too* (an open copy panel leaves no "Save as meal" on that header).
  - *One "Cancel" per open panel (closes Phase 7b N-3 / Phase 8 N-5):* with a group expander open, assert there
    is exactly **one** control named "Cancel" within that group — the header toggle now reads **"Close"**. This
    is asserted because the ambiguity was reported twice and never fixed; a strict-mode locator collision is the
    failure it caused.
  - *The panel is emphasised, announced and reachable:* each of the six listed expanders renders with
    `role="region"` and an `aria-labelledby` heading naming the action; assert on **computed** styles for the
    ring/fill (a source class proves nothing if Tailwind never emitted it — the visual-identity suite's
    established approach), and that focus lands inside the panel on open.
  - *The excluded surfaces stay excluded (assert, don't assume):* `FoodEntryForm`, the "Add detail" expander and
    `FoodLookupPanel` are **not** wrapped. A blanket application would pass every row above and defeat the point.
  - *Refresh survival is unchanged:* with a group expander open and a target date picked, force a background
    refresh (add an unrelated entry) — the panel stays open with its state intact, **and** the N-3 close/reopen
    rows still pass. Assert both together, for the reason 8b gives.
- **Icon buttons and tooltips (2026-08-05 addition, Phase 8d — Jeff's explicit ask, so the touch half is the
  part that matters):**
  - *The label is never hidden (the row to hammer — this is the whole reconciliation):* at a **phone-sized
    viewport**, "Log again" and "Edit" still render their **visible text** beside the icon. An implementation
    that hides the label below a breakpoint passes every other row here and produces exactly the icon-only-on-
    touch state the design exists to prevent. Assert the visible text, not the icon.
  - *The row is two actions, not three:* the entry row shows "Log again" and "Edit" only; **"Delete" is not on
    the row** and **is** present inside the edit form (trash icon + "Delete entry", `danger` variant), and
    deleting from there still removes the entry.
  - *Icons are decorative, names come from text:* each glyph is `aria-hidden="true"`, and each button's
    accessible name is its visible label — assert a screen reader would get `"Log again"`, not
    `"repeat icon Log again Log again"` and not a differing `aria-label` (WCAG 2.5.3 Label in Name).
  - *The tooltip is supplementary and correctly wired:* on a pointer device, hovering shows a `role="tooltip"`
    element whose text **differs from the label** (it explains, it does not repeat), the trigger carries
    `aria-describedby` pointing at it, `Escape` dismisses it while focused, and keyboard `focus` shows it.
  - *The tooltip is not the only source of meaning (assert by removal):* with tooltips suppressed entirely, every
    action on the row is still identifiable from visible text alone.
  - *No tooltip fires on touch, and nothing depends on one:* in a touch-emulating context the tooltip does not
    render, and both actions remain fully usable and labelled. **Do not assert the media query itself** — assert
    the observable consequence.
  - *`aria-label` is used only where there is no visible text:* the meal-card pin toggle and `MealList`'s ↑/↓
    arrows. Assert no icon+label button carries one.
- **Time-picker grouping (2026-08-05 addition, Phase 8e):**
  - *Nothing was lost (the row to hammer):* the time `<select>` still exposes **exactly 96** options via
    `getByRole("option")` (excluding `CopyGroupDialog`'s sentinel), in the same order, with the same `HH:MM`
    values and the same zero-padded labels, and **none is disabled**. Jeff's constraint was explicit; this is the
    row that enforces it.
  - *Three groups, at the right boundaries:* group labels are present and `05:45`/`06:00` and `19:45`/`20:00`
    fall on the expected sides.
  - *All three call sites:* `FoodEntryForm`, `LogMealDialog` (**both** picker and fixed-meal modes) and
    `CopyGroupDialog`. In the last, the `value=""` "Keep original time(s)" sentinel sits **outside** every group
    and is still the default.
  - *Selecting still works everywhere:* `selectOption` by value in each call site produces the same stored
    `consumed_at` as before — grouping is presentation only.
  - *The off-grid edit invariant survives (the likeliest silent defect):* seed an entry with an off-grid
    `consumed_at` (e.g. `09:07`), open it for edit, and assert the injected option is present, **selected**, and
    **inside the Daytime group** — then save an unrelated field and assert the stored time is unchanged.
  - *Required in-the-same-change sweep:* any existing locator using a **direct-child** selector (`select >
    option`) breaks under `<optgroup>` and must be updated in this change. This is the fourth consecutive phase
    where an existing suite pins something a new phase changes; it produced a blocking finding twice.
  - *Manual, not automatable:* the group labels and the `stone-500` de-emphasis must be eyeballed on **desktop
    and a real phone**, and the result recorded — including "colour not honoured here", which is expected, not a
    defect (§5).
- **Pinned meals and duplicating a meal (2026-08-05 addition, Phase 8f):**
  - *Migration and RLS (verify by query, not by reading the SQL):* after the migration, `meals` has
    `is_pinned boolean not null default false`, pre-existing rows are all `false`, RLS is still enabled, and the
    four policies are unchanged. Then the real test: **user B cannot pin user A's meal** — call `setMealPinned`
    with a foreign `mealId` and assert, via a service-role read, that A's row is untouched.
  - *Pinned-first on both surfaces:* pin a meal whose name sorts last; assert it renders first on `/meals`
    **and** appears first in `LogMealDialog`'s picker — 7c's "one shared ordering" must still hold.
  - *Pinning one meal doesn't reshuffle the rest:* capture the rendered order, pin one, and assert every other
    card's relative order is unchanged.
  - *The picker's optgroups appear only when something is pinned*, and option labels **still start with the meal
    name** (7c's type-ahead invariant).
  - *Filtering beats pinning:* with a pinned meal that does **not** match the active filter, it is not rendered,
    and "Showing N of M" agrees with the visible card count.
  - *The pinned state is not colour-only:* a pinned card shows a visible **"Pinned"** text pill; the toggle
    exposes an accessible name and `aria-pressed`, and unpinning reverses both.
  - *Duplicating is a faithful, independent copy:* duplicate a 3-item meal — the new meal has exactly 3 items
    matching `name`/`quantity`/`unit`/per-unit, **`sort_order` preserved from the source** (not renumbered — feed
    a source whose `sort_order`s are non-contiguous, e.g. 0/2/5, so a renumbering implementation fails), and the
    duplicate's summed totals equal the source's exactly.
  - *The source is byte-identical afterwards* — re-read the source `meals` row and its `meal_items` and assert
    full-row equality **including `updated_at`** (proves no UPDATE fired). Same evidentiary bar as Phase 7b.
  - *Independence in both directions:* editing or deleting the duplicate leaves the source untouched, and
    vice versa.
  - *The duplicate is NOT pinned* even when the source is (assert explicitly — it is the question a reader will
    ask, and the answer is a decision).
  - *The name is prefilled and overridable:* the field opens containing `"<source name> (copy)"`; submitting it
    unchanged succeeds, and typing a different name uses that instead. Blank/whitespace-only → field error, zero
    rows written.
  - *Ownership and atomicity:* another user's `mealId` → `meal_not_found` with **zero** rows written for either
    user (service-role read across both). Compensating delete: on a forced `meal_items` insert failure no orphan
    `meals` row survives — fault injection if practical, otherwise verified by review and **said so explicitly**,
    the same standing rule as `createMealFromEntries`.
  - *An empty source meal duplicates successfully* into an empty meal (deliberately not rejected — §3.3), and
    that meal is still refused by `logMealForDay` (`empty_meal`).
  - *Success refetches, but disturbs nothing:* with a filter active and a card expanded, duplicate a meal —
    the new meal appears **if it matches the filter** (and does not if it doesn't, consistent with 7c's rule for a
    newly created meal), the filter is still applied, and the expanded card is still expanded. This screen has
    shipped state-loss bugs twice.
  - *One expander per card:* opening Duplicate closes an open "Log this meal" or Rename on the same card, and
    only one card's expander is open across the list.
- **Row delete, icon-only actions, and the stronger editing highlight (2026-08-07 addition, Phase 8g):**
  - *Delete is back on the row, and gone from the form (the pair to hammer — this is the reversal):* an entry row
    exposes a control named **"Delete …"**, and `FoodEntryForm` in edit mode exposes **none**. Assert **both
    halves** — an implementation that adds the row icon and forgets to remove the form button passes a
    one-sided test and ships two delete paths.
  - *It actually deletes, with the confirm accepted:* accept the `window.confirm` (Playwright
    `page.on("dialog")`) and assert the row is gone **and the DB row is gone** (service-role read), and the day's
    totals decrement.
  - *Dismissing the confirm deletes nothing (the safety row):* dismiss the dialog and assert the entry is still
    rendered **and still in the DB**. If Jeff drops the confirm, this row and the one above are the two to
    retire — nothing else in the block depends on it.
  - *The row is three icon-only buttons:* "Log again", "Edit", "Delete" each render **no visible text**, each is a
    real `<button>` with an `aria-label` that **starts with the same verb** and names the entry, and each still
    carries a supplementary `aria-describedby` tooltip on pointer devices. This **replaces** Phase 8d's
    "the label is never hidden" row, which becomes false by design — **update it in the same change**, do not
    leave it failing or delete it silently. (Fourth consecutive phase where an existing suite pins something a
    new phase reverses; it produced a blocking finding twice.)
  - *Suppression is unchanged and now covers three actions:* on the edited row, in select mode, and inside an
    active group, **all three** actions are absent — assert Delete specifically, since it is the newcomer.
  - *A mid-edit row has no delete path, by design:* with an entry open for edit, assert there is no delete control
    on that row **and** none in the form; cancel the edit and assert the row's delete returns.
  - *Deleting the entry currently being edited closes the form:* start editing entry A, cancel, delete A from its
    row — then (the real case) start editing A, cancel, and separately assert that if `editingEntry` is somehow
    the deleted row the form does not remain open against a missing entry.
  - *A failed delete surfaces an error and changes nothing* (Phase 8d qa N-4 must not regress): force a failure
    and assert a friendly message appears, no raw Postgres text is shown, and the entry survives.
  - *The editing highlight is louder, and does not collide:* the edited row carries **both** the accent bar and a
    computed inset `sage-deep` ring plus a filled "Editing" pill (assert on **computed** styles, per the
    visual-identity suite's approach), the row's own background is **unchanged** (no `sage-pale` fill), and a
    "From a saved meal" badge in that same row is still visible and still distinguishable.
  - *Select mode and editing still coexist:* a row can be checked **and** highlighted at once; a merely-checked
    row still has no visual state of its own beyond the checkbox.
- **Retiring the dashboard (2026-08-07 addition, Phase 8h):**
  - *`/` lands on the food log:* after login, and on a direct visit to `/`, the user ends up on `/food` with the
    day's log rendered — assert the final URL and real content, not just a 200.
  - *The header wordmark still works* (it links to `/`, which now redirects) — this is the link most likely to be
    broken by a careless route deletion.
  - *Nothing dashboard-shaped remains:* no "Today so far" summary and no "Welcome back" line anywhere in the app.
  - *Required in-the-same-change sweep:* `e2e/auth.spec.ts`, `e2e/phase1-acceptance.spec.ts`,
    `e2e/fetch-error-handling.spec.ts` and `e2e/phase8-acceptance.spec.ts` all assert on the dashboard or on
    `TodaySummary` today (including 8b's *"no copy/quick-add control was added to the dashboard"* guard, which
    becomes vacuous when the page is gone). Every one must be updated or retired **in this change**. The
    `fetch-error-handling` dashboard row should move to another surface rather than being dropped — that suite's
    point is that every client read has an error+Retry path, and `/food`, `/metrics` and `/trends` still do.
  - *Last-logged weight on `/metrics`:* with metrics seeded on two past days, `/metrics` shows the **most recent**
    one, in the user's chosen unit (assert after a kg→lb toggle, so a hardcoded unit fails), with a human-readable
    date. With **no** metrics ever logged, the line is absent entirely — not "Last logged: —".
  - *It does not go stale after a save (the reason it is a client read):* log a weight for today and assert the
    line updates to today **without a page reload**.
- **Visual identity v2 (2026-08-09 addition, Phase 8i):** this is a **rewrite of
  `e2e/visual-identity-acceptance.spec.ts` in place**, not a new file beside it — that suite currently pins the
  *old* identity and every one of its assertions is now false by design. Keep its method, which was right:
  assert on **computed** styles in a real browser, never on source class names, because a class in the source
  proves nothing if the utility was never generated.
  - *The tokens actually compute* — `document.body`'s background is `--canvas`; a `Card`'s is `--surface`; body
    text is `--ink`. A token defined in `:root` but never wired into `@theme inline` produces a class that does
    nothing and a page that silently falls back — the exact failure this style of assertion exists to catch.
  - *No serif anywhere, on any screen* (the row Jeff would check first): every `<h1>`, the wordmark, and
    `DailyTotals`' stat numerals resolve to a font-family containing **"geist"** and **not** "fraunces" — and
    `document.fonts` / the loaded stylesheets contain no Fraunces face at all, so the font is genuinely
    un-registered rather than merely unused.
  - *Shape rules, both halves*: the primary `Button`'s computed `border-radius` is **~8px, not ≥500px** (a
    surviving pill fails), while the **active `NavLink` is still ≥500px** — assert both, because a blind
    find-replace of `rounded-full` would take the nav pill with it.
  - *The `Button` secondary border defect is fixed*: its computed border colour is `--line-strong`, i.e. ≥3:1
    against its own white fill. Compute the ratio in the test rather than string-matching the hex, so the
    assertion states the requirement rather than the current answer.
  - *Contrast spot-checks on the combos that have historically failed here* — active `NavLink` (`--ink` on
    `--accent-soft`), links/focus rings (`--accent` on `--canvas` and on `--surface`), caption text (`--muted`
    on both surfaces), and `StatusMessage`/`ActionPanel` text. Each asserted as a **computed ratio ≥ its
    threshold**, not as an expected colour string.
  - *The sage arc is gone from every screen* — replaces the old *"appears exactly once on each auth screen"*
    row, which becomes false by design. Assert **zero** app-owned decorative `<svg>`s on `/login` and `/signup`
    (reusing the existing helper that excludes Next's dev-overlay indicator).
  - *No stray old-palette colour anywhere* — the old scan's forbidden list is now the **wrong** list. It becomes
    the sage/clay/paper values (`#FBF8F1`, `#5C7444`, `#E3EAD6`, `#A9BE8C`, `#C97452`, `#23211C`) plus the warm
    `stone-*` shades this round replaces, scanned across every screen. This is what stops the old palette
    creeping back one component at a time.
  - *Required in-the-same-change sweep, called out because this is the fifth consecutive phase to need it:*
    `src/components/food/FoodEntryList.test.tsx` asserts on literal `border-l-sage-deep` / `ring-sage-deep` /
    `bg-sage-deep` / `text-paper` class names (8 assertions). Update them to the new tokens — **do not** loosen
    them into "some class is present", which would retire real coverage of the Phase 8g editing highlight.
  - *The suite must otherwise stay green, unchanged.* This is presentation-only work: a failure anywhere in the
    unit or e2e suites that is **not** one of the two files named above means logic was touched, which this
    phase must not do.
- **Daily goal progress (2026-08-09 addition, Phase 8j):**
  - **The two rows to hammer.** *(1) The no-goal fallback is byte-for-byte today's behaviour*: with
    `user_goals` targets `null`, `/food` shows the calorie and protein numbers with **no bar and no caption** —
    assert the absence, not just the presence of the number, since an implementation that renders a 0%-width bar
    or a "0 of 0" caption passes a presence-only check and looks broken to a user who never set a goal.
    *(2) Over target tells the truth*: seed a day exceeding the calorie target and assert the caption says
    **"over"** with the correct magnitude, while the bar's computed width is **exactly 100%** — the one pairing a
    single clamped percentage would silently break.
  - *Partial goals are independent*: with a calorie target set and protein `null`, the calorie card has a bar and
    caption and the protein card has neither. Ships broken if the component gates both cards on one flag.
  - *The numbers are right and come from the view*: with seeded entries, the caption's consumed figure equals
    `daily_food_totals.total_calories` for that day (service-role read), and `remaining` equals
    `target − consumed`. Adding an entry updates all of it **without a reload**, through the existing refresh.
  - *Goals survive a day change*: browse to a previous day and confirm the bars/captions still render against the
    same targets (they are not refetched per day — the server-read choice) and reflect **that day's** totals.
  - *Nothing is stored*: after viewing `/food` with goals set, no new column, row or value appears anywhere —
    `user_goals` is unchanged (its `updated_at` in particular), and the only write a first-ever visit may perform
    is `getGoals()`'s existing ensure-row upsert.
  - *Cross-user isolation through the new read path*: user B's `/food` never shows user A's targets — the goals
    read is a new consumer of `user_goals` on a new screen, so it gets its own assertion rather than inheriting
    `/settings`' .
  - *The protein-% card gains nothing*: it still renders a plain number with no bar — a guard against
    "completing the set" with an invented target.
  - *Accessibility*: the bar is `aria-hidden` and exposes no `progressbar` role or `aria-valuenow`; the caption
    is real text; the over-target state is conveyed by the **word** "over", not by colour alone; and the bar is
    **not red** when over.
  - *The "Set daily targets" link appears only when BOTH targets are unset*, links to `/settings`, and is absent
    the moment either one is set.
- **The `/food` day-action surface (2026-08-11 addition, Phase 8k):**
  - **The row to hammer — *the trigger row never splits, whichever panel is open*.** For **each** of the three
    triggers in turn: open it, then assert **all three** trigger buttons are still rendered, still inside the
    same container element, and — the assertion that actually catches the bug — that every trigger's bounding box
    sits **above** the open panel's bounding box (compare `boundingBox().y`). A test that only asserts the
    buttons are *visible* passes today, with the bug present, because they are visible; they are just in the
    wrong place.
  - *Only one day panel at a time*: with "Copy this day" open, clicking "Log a saved meal" closes the copy panel
    and opens the meal one (assert the copy form's fields are **gone**, not merely hidden behind it).
  - *Select mode and the day panels are mutually exclusive*: entering select mode closes any open day panel, and
    while in select mode the three triggers behave per the design (assert whichever rule ships — this row exists
    so the behaviour is pinned rather than incidental).
  - *`/meals` is unregressed (the most likely accidental breakage)*: `LogMealDialog`'s fixed-meal mode on a
    `MealList` card still opens, logs, and closes from the card's own control, and `/meals` still shows exactly
    one card expander at a time. Re-run the whole Phase 8c suite, not one row.
  - *Refresh survival, re-asserted against the NEW structure*: with a day panel open and a target date typed,
    trigger a real background refresh (add an unrelated entry from another tab/via the admin client, then let the
    view refetch) and assert the panel is still open with the typed value intact. This has shipped broken three
    times; the state just changed owners, so the old passing test proves nothing about the new structure.
  - *Select mode gets one accent region, not two*: in select mode assert exactly **one** `role="region"` inside
    the day-log area; after clicking "Copy selected" still exactly **one**, and its accessible name is now
    **"Copy selected"**. Assert on **computed** border/background (accent ring + accent-soft fill), per the
    visual-identity suite's method.
  - *Opening a bulk form suppresses the bar's buttons but not the checkboxes*: with the copy form open, "Copy
    selected"/"Save selected as a meal"/"Clear"/"Done" are **absent** from the bar, the "N selected" count is
    still shown, and ticking another row in the list still increments it. Cancel restores all four buttons.
  - *Focus lands in the form, not the bar*: after clicking "Copy selected", `document.activeElement` is a control
    **inside** the copy form. This is the property the panel's `key` exists for, and it fails silently if the
    remount is omitted.
  - *The three triggers carry supplementary tooltips*: each has an `aria-describedby` resolving to a
    `role="tooltip"` element whose text is **not** identical to the button's own label (the recorded "explains,
    never repeats" rule), and "Select entries"' description names the day's log below.
  - *The toolbar adds no ARIA surface*: the container exposes **no** `role="toolbar"` and no accessible name — a
    guard against a later "improvement" that promises keyboard semantics nothing implements.
  - **Disclosure buttons:** the lookup trigger and the "Add detail" trigger are real buttons with
    `aria-expanded="false"` collapsed and `"true"` expanded, and `aria-controls` resolves to the revealed
    element's id. **The trigger stays present while open** and toggling it twice returns to the collapsed state
    (a regression here would be the old "trigger disappears, separate Close appears" shape). `FoodLookupPanel`
    exposes exactly **one** dismissal control, not two.
  - *Lookup behaviour is unchanged*: a picked candidate still prefills and auto-expands the detail section, and
    the collapsed-detail hidden-input behaviour (Phase 6 B-1) still submits the picked quantity — re-run the
    Phase 6 rows rather than trusting that a trigger restyle could not reach them.
- **Auth-screen identity (2026-08-11 addition, Phase 8l):**
  - **The row Jeff would check first — *the app names itself*:** `/login` and `/signup` each render the text
    "Health Tracker" somewhere on the page. Assert on rendered text, not on a component name.
  - *One wordmark, two places*: the authenticated header's wordmark link still has the accessible name
    **exactly** `"Health Tracker"` (`getByRole("link", { name: "Health Tracker", exact: true })`) — the
    invariant that keeps a two-tone/`<span>`-split implementation from changing the link's name or breaking
    existing navigation.
  - *No decoration crept back*: **zero** app-owned `<svg>` on `/login` and `/signup` — this is the existing
    Phase 8i assertion, and this phase's requirement is that it **still passes unchanged**. If this phase's diff
    edits that assertion, the phase went out of scope.
  - *Nothing that other suites key off moved*: each page's `<h1>` is still "Log in" / "Create your account", the
    submit buttons are still named "Log in" / "Sign up", and the Email/Password fields still resolve by their
    existing labels. Re-run `e2e/auth.spec.ts` and `e2e/phase1-acceptance.spec.ts` in full.
  - *The identity is on-palette*: the wordmark's computed colours are `--ink` and/or `--accent` (never a
    sage/clay/paper value), and the page background is still `--canvas` — folded in so the old palette cannot
    return through the one screen the visual-identity suite covers most lightly.
- **Password reset (2026-08-11 addition, Phase 8m):**
  - **The row to hammer — *the whole flow works end to end against the real local stack*:** create a confirmed
    test user, request a reset from `/forgot-password`, fetch the email from the local mail catcher (Mailpit, as
    the Phase 4 signup-confirmation verification already does), follow its link, land on `/reset-password`, set a
    new password, and then **prove both halves**: logging in with the **new** password succeeds, and logging in
    with the **old** one fails. Asserting only the success half would pass against an action that silently did
    nothing.
  - **The second row to hammer — *no account-existence oracle*:** submitting an email that has **no** account
    returns the **identical** rendered confirmation as one that does (compare the two rendered strings), and the
    page never says "no account"/"not found"/"unknown". This is the phase's one security property.
  - *A reset link is single-use / expiry-shaped*: after completing a reset, revisiting the same emailed link
    lands on `/login?error=auth_callback_failed` with the "invalid or expired" notice (assert the existing
    `/invalid or expired/i` text still matches — the generalised copy must keep that substring).
  - *`/reset-password` with no session explains itself*: visiting it directly, logged out, renders the
    "invalid or has expired" state **and no password form at all** (assert the absence of the inputs — a form
    that renders and then fails on submit is the failure mode this page exists to avoid), plus a link back to
    `/forgot-password`.
  - *The action re-checks, independently of the page*: call `updatePassword` with no session and assert it
    returns an error and changes nothing — the page-level check is UX, not authorisation.
  - *Validation is server-side, not just an `<input minLength>`*: a too-short password and a mismatched
    confirmation are both rejected with field-level messages after a real submit, and the password is unchanged
    (prove by logging in with the old one afterwards).
  - *Success leaves the user signed out and told so*: after a successful reset the browser is on
    `/login?reset=success`, the confirmation notice is visible, and there is **no** active session (the
    authenticated header's "Log out" control is absent).
  - *`?next=` cannot be turned into an open redirect through this flow*: hitting
    `/auth/callback?code=…&next=//evil.com` still redirects same-origin (the existing `safeRedirectPath` guard —
    re-asserted here because this phase is the first to make `?next=` a routinely-used parameter rather than a
    dormant one).
  - *The login page offers the way in*: `/login` has a "Forgot password?" link to `/forgot-password`, and that
    page is reachable logged-out with no redirect loop.
  - **Locator note for whoever writes these:** `/reset-password` has two controls whose accessible names both
    contain "password". Every `getByLabel` here needs `{ exact: true }` or a scoped locator — the fifth instance
    of the collision class recorded in `ai-context/DECISIONS.md`'s "Copy to time…" entry and its addenda.
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

### Phase 8d — Day navigation, and emphasis/action hygiene on the day's log (2026-08-05 addition)

**Why its own phase, and why here.** Four of Jeff's eight manual-testing findings from this round
(Previous/Next day; suppressing row actions under an open group expander; making the bulk/group action area
actually draw the eye; per-row button density) are **all the same screen, all UI-only, and all interlocking** —
the group-suppression rule and the row-density change edit the same conditional in `FoodEntryList`, and the
emphasis primitive is what the group and bulk panels both consume. Splitting them would mean several phases
reopening `FoodEntryList`/`FoodDayView` to re-derive one interaction rule, which is the outcome §4's scoping rule
exists to avoid — the same reasoning 8b used to bundle its two bulk actions. **Numbered 8d rather than
renumbering 9** so every existing "Phase 9" reference in this doc, `ai-context/*` and the test suite stays
correct: the convention 7b, 7c, 8b and 8c established.

**Dependencies: Phase 8b (hard), and nothing else.** It extends select mode's own suppression rule, edits the
files 8b last touched, and its `ActionPanel` wraps the bulk expanders 8b introduced. It has no relationship to
Phase 9 in either direction, so 8d→9 is ordering only. **Phase 8f depends on 8d** for `ActionPanel` (the same
soft-but-real shape as 8c depending on 8b's `StatusMessage`), so run 8d first.

**Adds no server-action code, no schema, and exactly one pure helper** (`shiftIsoDate`). If anything else appears
in `lib/actions/*` or `supabase/migrations/`, that is a deviation worth questioning, not a bonus.

- **In:**
  - **`components/ui/DayNavigator.tsx`** (new) — **exactly two buttons**, `‹ Previous day` and `Next day ›`,
    around the existing date input, with "Next day" **disabled on today**, full visible text labels (so no
    `aria-label` is needed — WCAG 2.5.3), and `shiftIsoDate` doing the arithmetic. **No "Today" button** (Jeff's
    call, 2026-08-05 — §3.4/§4). Wired into `FoodDayView` **through the existing `handleDayChange` choke point**
    (not `setSelectedDate`) and into `MetricForm` — **the `/metrics` call site as its own commit**, since it
    reaches one file of an already-approved phase (§4's scoping rule).
  - **`shiftIsoDate` in `lib/domain/datetime.ts`**, unit-tested, using `Date.UTC` on the split parts — **never**
    `new Date(iso)` (§3.3/§3.4: the off-by-one this doc has now had to defend against three times).
  - **Active-group suppression in `FoodEntryList`** — a derived `isGroupActive` (from the existing `groupAction`
    state, no new state) hides that group's per-row "Log again"/"Edit"/"Delete" **and** the header's sibling
    action, for **both** "Copy this group" and "Save as meal"; the active `<section>` gets the level-1
    `border-l-4 border-l-sage-deep` accent, **no surface fill**.
  - **The group-header toggle's active label changes from "Cancel" to "Close"**, closing the twice-raised
    duplicate-"Cancel" note (Phase 7b N-3 / Phase 8 N-5) in the file it lives in.
  - **`components/ui/ActionPanel.tsx`** (new) — level 3 of the emphasis ladder (§3.4): `sage-deep` ring +
    `sage-pale` fill + a visible heading, `role="region"` + `aria-labelledby`, scroll-into-view and focus-in on
    open. Applied to **exactly six** expanders, named in §3.4; explicitly **not** to `FoodEntryForm`, "Add
    detail" or `FoodLookupPanel`.
  - **Per-row actions: "Delete" moves off the entry row into the edit form** (`FoodEntryForm` in edit mode,
    rendered as trash icon + "Delete entry", `danger`), and the two remaining row actions become
    **icon + always-visible label**: repeat glyph + "Log again", pencil + "Edit" (§3.4). **The label is not
    hidden at any breakpoint** — that is the load-bearing part, not the icons.
  - **`components/ui/icons.tsx`** (new) — four inline SVGs (repeat, pencil, trash, pin) with Lucide geometry and
    an ISC attribution header, `aria-hidden`, `currentColor`. **No icon-library dependency.**
  - **`components/ui/Tooltip.tsx`** (new) — hover (~300 ms delay) + focus (no delay) + `Escape` to dismiss,
    `role="tooltip"` + `aria-describedby`, **no portal and no positioning library**, and **rendered only under
    `@media (hover: hover) and (pointer: fine)`** so it never appears on touch. Its text must **explain, not
    repeat** the label.
- **Out — say no to all of these explicitly:** **icon-only buttons on the entry row**, and **hiding the label at
  small breakpoints** — both put an unexplained icon on the one device class where no tooltip can fire (§3.4/§4);
  **long-press tooltips**; a native `title` as the tooltip mechanism; `aria-label` on any control that has
  visible text; an icon-library dependency; a tooltip positioning library; an overflow "⋯" menu; any change to
  `/meals` (**including its icon adoption, which is deliberately Phase 8f's** so that screen's files are opened
  by one phase); any change to a server action, `lib/domain/*` beyond `shiftIsoDate`, or the schema; swipe
  gestures, a day carousel, a "Today" button, or removing the date picker; dimming inactive groups; a modal or a
  sticky bar; **any attempt to fix the documented `Day`-input race** (out of scope, different investigation —
  §5); and the editing-row highlight, which **already shipped in Phase 8b and is committed** (§5 — do not
  rebuild it; if it appears missing, that is a stale-build check first and a developer bug-fix second, never a
  redesign).
- **§6 scope for qa-reviewer:** unit — **`shiftIsoDate` only** (including the negative-offset-timezone row).
  Acceptance — the *"Day navigation"*, *"Active-group suppression and action-panel emphasis"* and *"Icon buttons
  and tooltips"* blocks in
  §6, with **four rows to hammer**: **(0) at a phone-sized viewport the icon buttons still render their visible
  text labels** — the reconciliation that makes iconifying safe on touch at all, and precisely the thing an
  implementation is most likely to "optimise" away with a breakpoint; **(1) "Next day" cannot produce a future
  day even with the DOM re-enabled**
  (the client control is convenience; the cap is the invariant); **(2) the navigator goes through
  `handleDayChange`** — a version wired straight to `setSelectedDate` passes every other row and silently
  resurrects stale-selection state; and **(3) the N-3 close/reopen rule and refresh-survival still hold together**
  for the newly-wrapped panels, asserted in one test, since a wrongly-keyed unmount passes one and fails the
  other. Carried-forward Phase 8/8b rows must keep passing unchanged — especially every copy-group, save-as-meal
  and multi-select row, since this phase edits the conditionals those flow through.
- **Manual-browser check (do not skip):** drive `/food` on a **phone-sized viewport** — the density and
  "where do I look" complaints are both phone-first, so a desktop-only pass cannot confirm either. Open a group
  expander and confirm the rows inside it quiet down while another group stays live; **confirm on a real phone
  that "Log again" and "Edit" are still readable as words, not bare glyphs, and that nothing about them depends
  on a tooltip that cannot fire there**; open "Copy selected" and
  confirm the panel actually pulls the eye and the caret lands in it; and navigate several days back and forward,
  confirming "Next" greys out on today.

### Phase 8e — Scanning the time picker: quarter-hour option groups (2026-08-05 addition)

**Why its own phase, and why not folded into 8d.** It is small, but it touches **the single most-used control in
the app** at three call sites, it **amends a decision this doc has already made twice** (the 2026-07-25 native
`<select>` and the 2026-07-26 label format, whose `<optgroup>` rejection is being reconsidered on different
grounds — §4), and its correctness is **platform-dependent in a way CI cannot see**, so its review is mostly a
cross-platform manual check that has nothing in common with 8d's. Bundling it would bury a control-level change
to the everyday logging path inside a phase about buttons and emphasis. **Numbered 8e**, same convention.

**Dependencies: none.** It shares no files with 8f and only `FoodEntryForm`/`LogMealDialog`/`CopyGroupDialog`
with 8d's wrapper work, which does not touch the `<select>` itself. **It can run before, after or between 8d and
8f** — sequencing here is preference, not constraint.

**Presentation only, and that is the load-bearing property.** Every option keeps its 24-hour `HH:MM` value, all
96 stay present, selectable and ordered, nothing is disabled, and `quarterHourOptions()` stays exported
unchanged. Server validation, `localInputToUtcInTz`, exact-`consumed_at` grouping and the future-day cap cannot
observe this change — the identical value/display boundary the zero-padded labels held.

- **In:** `quarterHourOptionGroups()` and `quarterHourGroupIndexFor()` in `lib/domain/datetime.ts` (pure,
  unit-tested, §3.3); three `<optgroup>`s — **Early (12 AM – 6 AM) / Daytime (6 AM – 8 PM) / Late (8 PM – 12 AM)**
  — rendered at all three call sites (`FoodEntryForm`, `LogMealDialog` in both modes, `CopyGroupDialog` with its
  sentinel kept outside the groups); best-effort `text-stone-500` de-emphasis on the Early/Late options; the
  **off-grid injected option routed into its correct group**; and the **direct-child option-locator sweep** in
  `e2e/` in the same change.
- **Out:** removing, reordering, disabling or re-valuing **any** option (Jeff's explicit constraint); changing
  the 15-minute grid, the label format, the floor-of-now default, the smart same-sitting default, or grouping
  semantics; a custom listbox/combobox; a background fill on options; encoding the shading into label text
  (would regress the fixed-width labels); `MealItemForm` (it has no time field at all); and any promise that
  option **colour** renders on macOS or mobile — it will not, and that is expected (§5).
- **§6 scope for qa-reviewer:** unit — `quarterHourOptionGroups`/`quarterHourGroupIndexFor`, with **the identity
  row as the one to hammer**: the groups' options concatenated must deep-equal `quarterHourOptions()`. Acceptance
  — the *"Time-picker grouping"* block in §6, with two further rows to hammer: **96 options still present,
  selectable and undisabled** across all three call sites, and **the off-grid edit invariant** (a legacy `09:07`
  is still injected, still selected, now inside Daytime, and an unrelated save still doesn't rewrite it).
  Carried-forward Phase 3/7/8b time rows must pass unchanged — a regression there means the change reached below
  the label boundary.
- **Manual check (the part CI cannot do):** open the picker on **desktop and a real phone** and record what each
  platform actually renders — group labels expected everywhere, colour on Windows/Linux only. **"No colour on
  iOS" is the documented expected result, not a bug**; "no group labels anywhere" would be the finding worth
  reporting.

### Phase 8f — Saved meals: pinning and duplicating (2026-08-05 addition)

**Why its own phase, and why these two together.** Both are `/meals`-only, both land on the same `MealList` card
action row, and they must be designed against each other (does a duplicate inherit a pin? — §3.3 says no, and
that is a decision, not a detail). Splitting them would mean two phases reopening the same file to re-derive the
same card-expander invariants — 8b's exact reasoning for bundling its two bulk actions. Keeping them **out of
8d** is the other half of the same rule: different screen, and this phase carries **the only schema change in the
batch**, which Phase 2's own precedent says to isolate rather than mix into a UI diff. **Numbered 8f.**

**Dependencies: Phase 7/7c (hard), Phase 8d (soft but real).** It builds on the meals library and its shared
ordering, and its expander uses the `ActionPanel` primitive 8d introduces — building 8f first would mean
building that component twice, the same argument that placed 8c after 8b.

**This is the first migration since Phase 2, and it should be reviewed like one.** One column
(`meals.is_pinned boolean not null default false`), no new table, no backfill, no index, and **no new RLS
policy — because the existing four already cover it** (§3.2). That last claim is the one a reviewer must
**verify by querying the policies**, not by reading the migration: "an ALTER needs no policy" is true here and
would not be true of a new table, and this project's Absolute Rules do not permit assuming it.

- **In:** the migration above and `Meal.is_pinned` in `lib/types.ts`; **`setMealPinned`** and **`duplicateMeal`**
  in `lib/actions/meals.ts` (§3.3 — ownership re-read through the RLS-scoped client, `meal_not_found` reused,
  compensating delete reused, `sort_order` **preserved**, `is_pinned` **not** copied, strictly read-only on the
  source); `sortMealsByName` **partitioning pinned-first** with the existing comparator inside each block, and
  `duplicateMealName`, both in `lib/domain/meals.ts` with unit tests; a **pin toggle** (icon + visually-hidden
  text + `aria-pressed`) and a **"Pinned" status pill** on each `MealList` card; a **"Duplicate"** control opening
  **`components/meals/DuplicateMealDialog.tsx`** (new, wrapped in `ActionPanel`, name prefilled and
  pre-selected); `LogMealDialog`'s picker gaining **`Pinned` / `All meals` optgroups** only when something is
  pinned, with 7c's name-first label invariant intact; **`ActionPanel` applied to `LogMealDialog`'s two call
  sites** so `/meals` doesn't keep a visibly different idiom; **adoption of Phase 8d's icon vocabulary on this
  screen** (§3.4) — `MealList`'s per-**item** rows get icon + `Tooltip` for Edit/Delete, the
  existing ↑/↓ arrows keep their `aria-label` and gain a `Tooltip`, and the pin toggle joins them as an icon-only
  control (`aria-label` + `aria-pressed` + `Tooltip`, with the "Pinned" pill carrying the state in text);
  **amended 2026-08-07** — per the "Icons replace buttons+text entirely" decision these are now **icon-only**,
  not icon + visible label, so this bullet's original "+ visible label" wording is superseded and the pin toggle
  is no longer the app's *only* icon-only control, just its only one with no text equivalent anywhere. Use the
  same ``aria-label={`Delete ${itemName}`}`` disambiguation Phase 8g establishes on `/food`, so the two screens
  ship one vocabulary. Also in: the **named refactor** replacing `MealList`'s
  `renamingMealId`/`loggingMealId` with a single `cardAction: { mealId, kind }` (the `FoodEntryList.groupAction`
  shape) — called out here rather than left to be found in the diff, which is exactly what produced a blocking
  finding in 7b and 7c.
- **Out — say no to all of these explicitly:** `pinned_at`, a pin cap, drag-to-reorder, a manual `meals.sort_order`,
  section headings or a divider between pinned and unpinned, tags/categories/folders (out of scope project-wide —
  this phase must not be their door either); pinning overriding the filter; provenance on the duplicate
  (`duplicated_from_id`); auto-unique naming (`(copy 2)`); duplicating **into** an existing meal, or duplicating
  several at once; any multi-select on `/meals`; any change to the two-flat-queries read strategy, the filter, the
  count readout, or expand-by-default; **any restructure of the card action row beyond adding these two controls**
  (its density is a §5 open question — recommendation recorded, decision Jeff's); and any change to
  `logMealForDay`, `createMealFromEntries` or `copyFoodEntries`.
- **§6 scope for qa-reviewer:** unit — `sortMealsByName`'s pinned-first partition and `duplicateMealName`.
  Acceptance — the whole *"Pinned meals and duplicating a meal"* block in §6, with **three rows to hammer**:
  **(1) RLS on the new column verified by query** — including that user B cannot pin user A's meal, with a
  service-role read proving A's row is untouched; **(2) the duplicate preserves non-contiguous `sort_order`**
  (seed 0/2/5, so an implementation that mechanically reused `mealItemsFromEntries`' 0..N-1 renumbering fails);
  and **(3) the source meal and its items are byte-identical afterwards**, `updated_at` included — Phase 7b's
  read-only invariant, re-proved for the meal→meal direction. Carried-forward Phase 7/7b/7c/8c rows must keep
  passing: meal CRUD, the filter and counts, both empty states, `logMealForDay` from both entry points, and the
  picker's ordering and name-first labels.
- **Manual-browser check:** pin two meals with a filter active and confirm the filter still wins; duplicate a
  meal **with a card expanded and a filter applied** and confirm the refetch preserves both; and confirm the
  pinned state is legible **without relying on the icon's fill** (the "Pinned" pill is the accessible carrier).

### Phase 8g — Delete back on the entry row, icon-only row actions, and a louder editing highlight (2026-08-07 addition)

**Why its own phase, and why these three together.** Jeff's findings 5, 6 and 7 from the 2026-08-07 round all
land in the **same three files** (`FoodEntryList`, `FoodEntryForm`, `FoodDayView`) and, more to the point, in the
**same JSX block** — the row-action conditional. They also have to be designed against each other: the new trash
icon must not fight the stronger highlight, and the highlight's suppression rule is what decides whether a
mid-edit row has a delete affordance at all (it doesn't — §3.4). Splitting them would mean three sessions
re-deriving one interaction rule in one conditional, which is precisely the outcome §4's scoping rule exists to
avoid, and the same reasoning 8b used to bundle its two bulk actions. **Numbered 8g**, the 7b/7c/8b/8c/8d/8e/8f
convention, so no existing "Phase 9" reference moves.

**It also absorbs the `FoodEntryList` half of the 2026-08-07 icon-only decision** (`ai-context/DECISIONS.md`,
"Icons replace buttons+text entirely"), which was already decided and is merely unbuilt. That is not scope creep:
dropping the visible labels from "Log again"/"Edit" edits the identical lines the trash icon is added to, so
doing it in a separate session would have two developers fighting over one block. **The `/meals` half stays in
Phase 8f**, unchanged, so that screen's files are still opened by exactly one phase.

**Dependencies: Phase 8d (hard), nothing else.** It reverses 8d's Delete placement, edits the row actions 8d
built, and reuses 8d's `Tooltip`/`icons.tsx`. 8d has shipped and is qa-reviewed; **8g should not start until Jeff
approves 8d**, or the reversal lands on top of a diff he hasn't accepted yet.

**Adds no server action, no schema, no `lib/domain/` module, and no new `components/ui/` primitive.** Everything
it needs already exists (`deleteFoodEntry`, `TrashIcon`, `Tooltip`, `entryDisplayLabel`). If a migration or a new
action appears, that is a deviation worth questioning.

- **In:**
  - **Delete returns to the entry row** as an icon-only `danger` button inside the **existing**
    `!selectMode && !isEditingRow && !isGroupActive` conditional (no new branch), with a `window.confirm` naming
    the entry, placed in `FoodDayView`'s handler — mirroring `MealList.handleDeleteMeal` exactly (§3.4).
  - **`FoodEntryForm` loses `onDelete`, its "Delete entry" button and its `TrashIcon` import.**
  - **`FoodDayView.handleDeleteEditingEntry()` becomes `handleDelete(entry)`**, keeping Phase 8d's qa **N-4**
    error handling verbatim and additionally clearing `editingEntry` when the deleted row is the one being edited.
  - **All three row actions become icon-only** (repeat / pencil / trash), each with
    ``aria-label={`<Verb> ${entryLabel}`}`` built from the existing `entryDisplayLabel` helper, generous tap
    padding, a hover/focus background, and its existing pointer-only `Tooltip`.
  - **The editing row is promoted to emphasis level 1+** (§3.4): keep the `border-l-4 border-l-sage-deep` bar, add
    `ring-2 ring-inset ring-sage-deep`, and change the "Editing" caption to a filled `bg-sage-deep text-paper`
    pill. **Surface unchanged** — no row fill.
  - **The in-the-same-change test sweep**, named because this is the fourth consecutive phase where an existing
    suite pins something a new phase reverses: Phase 8d's *"the label is never hidden at a phone viewport"* row
    and its *"the row is two actions, not three / Delete is in the edit form"* row both become **false by
    design** and must be rewritten, not deleted or left red. Every existing spec that deletes an entry via
    Edit → "Delete entry" (`food-logging`, `phase3-acceptance`, `phase7b-acceptance`, `phase8b-acceptance` — the
    files Phase 8d itself edited for the opposite reason) goes back to the row control **and must now handle the
    `confirm` dialog**, which is the specific thing that will otherwise hang every one of them.
- **Out — say no to all of these explicitly:** bulk delete or a delete in `EntrySelectionBar` (destructive,
  no undo, its own round — unchanged from 8b); an undo/toast-with-undo (a real feature, not a safeguard, and it
  would change the delete action's contract); a custom confirmation dialog or modal (this codebase has declined a
  modal primitive four times; `window.confirm` is the in-repo pattern); a `bg-sage-pale` or any other **fill** on
  the editing row; renumbering the emphasis ladder; a second `scrollIntoView` targeting the edited row (8b's
  rejection stands — §3.4); any change to select mode, the group expanders, `ActionPanel`, `DayNavigator`, the
  `/meals` icon adoption (8f's), a server action, `lib/domain/*`, or the schema; and **any attempt to fix the
  documented `Day`-input race** (§5, different investigation).
- **§6 scope for qa-reviewer:** no new unit surface. Acceptance — the *"Row delete, icon-only actions, and the
  stronger editing highlight"* block in §6, with **three rows to hammer**: **(1) both halves of the reversal
  asserted together** (row control present **and** form control absent — a one-sided test passes an
  implementation that ships two delete paths); **(2) dismissing the confirm deletes nothing**, proven by a
  service-role read, not by the UI; and **(3) the highlight is louder without collateral damage** — computed
  ring + filled pill present, row background unchanged, and a "From a saved meal" badge in that same row still
  visible and distinguishable. Carried-forward Phase 8/8b/8d rows must keep passing — especially select mode,
  the group expanders and refresh survival, since this phase edits the conditional they all flow through.
- **Manual-browser check (do not skip):** on a **phone-sized viewport**, confirm the three icon buttons are
  individually tappable without hitting a neighbour (this is the density change Jeff asked for, and the trash
  sitting beside "Edit" is exactly the mis-tap 8d was protecting against — the confirm is what makes it
  survivable, so tap it deliberately and confirm the prompt appears); and confirm the editing highlight is
  findable when scrolling back to the list, since that — not the moment of clicking "Edit" — is when it has to
  work (§3.4).

### Phase 8h — Retire the dashboard; last-logged weight moves to `/metrics` (2026-08-07 addition)

**Why its own phase, and why not folded into 8g.** It shares **no files** with 8g and has no interaction with it:
it deletes one route and one component and touches `/metrics`. Bundling a route deletion plus a five-file e2e
sweep into a phase about row buttons would make the diff unattributable, which is the failure mode §4's scoping
rule and two prior blocking findings exist to prevent. It is small enough to ship in an afternoon and is
**independent of 8g in both directions** — either order, or in parallel. **Numbered 8h.**

**Dependencies: none.** Nothing in phases 8d–8g touches `(app)/page.tsx`, `TodaySummary` or `/metrics`'s read.

**Recommendation, since Jeff asked for one rather than options: retire it.** The reasoning is in §3.4 — every
candidate for a dashboard either already exists one click away (`DailyTotals` on `/food`, the charts on
`/trends`) or belongs on the screen it is about (last-logged weight on `/metrics`). The current page is a literal
duplicate of `/food`'s totals behind an extra click, in an app whose stated first priority is that logging must
be fast.

- **In:**
  - **`(app)/page.tsx` becomes `redirect("/food")`** — the route stays so the auth callback, the sign-in redirect
    and the header wordmark all keep working untouched. Its `metadata` goes with the page body.
  - **`components/food/TodaySummary.tsx` is deleted** (nothing else imports it — verified).
  - **A "last logged" line on `/metrics`**, above the form: *"Last logged: 182.4 lb · 18.2% body fat on
    08/05/2026"*, via `weightForDisplay`/`formatWeight` and `formatDateLabel`, **absent entirely** when the user
    has never logged a metric. Read inside `MetricForm`'s existing client fetch so the existing `refetch()` keeps
    it accurate after a save — **its own commit**, since it reaches a Phase 4 file this phase otherwise doesn't
    open (§4's scoping rule).
  - **The e2e sweep, in the same change**: `e2e/auth.spec.ts`, `e2e/phase1-acceptance.spec.ts`,
    `e2e/fetch-error-handling.spec.ts` and `e2e/phase8-acceptance.spec.ts` all assert on the dashboard or
    `TodaySummary` today. `fetch-error-handling`'s dashboard row should **move to another client-read surface**,
    not be dropped — that suite's whole point is that every browser-side read has an error+Retry path.
- **Out — say no to all of these explicitly:** building any dashboard content (charts, streaks, recent entries,
  goal rings); an all-time / "oldest-to-latest" progress chart (that is a `/trends` `All` range — §5, deferred
  with a recommendation, not smuggled in here); any stored or denormalised "progress" value (AGENTS.md's standing
  rule); repointing the wordmark, the auth callback or the sign-in redirect away from `/`; removing or renaming
  any nav item; a Server Component read for the last-logged line (rejected on staleness-after-save — §3.4); and
  any change to `MetricForm`'s tz gate, its upsert, or the `daily_metrics` schema.
- **§6 scope for qa-reviewer:** no new unit surface. Acceptance — the *"Retiring the dashboard"* block in §6, with
  **two rows to hammer**: **(1) `/` genuinely lands on a working `/food`** (assert real rendered content and the
  final URL, since a redirect that 200s on an empty page passes a naive check), and **(2) the last-logged line
  updates after a save without a reload** — the single behaviour the client-read choice exists to guarantee, and
  the one a "simplification" back to a server read would silently break. Carried-forward auth/session rows must
  keep passing: login still lands somewhere sensible, log out still clears the session.
- **Manual-browser check:** log in and confirm the first thing on screen is the day's log, with no intermediate
  flash of a dashboard; click the wordmark from `/settings` and confirm it lands on `/food`; and log a weight on
  `/metrics` and watch the "last logged" line update in place.

### Phase 8i — Visual identity v2: cool canvas, blue/orange accents, no serif (2026-08-09 addition)

**Why a numbered phase this time, when the 2026-07-25 rollout was deliberately *not* one.** That rollout was
framed as cross-cutting precisely because it had no place in the 1→9 dependency chain, and that framing is still
true of the work itself. What changed is the evidence: cross-cutting framing came with *"qa-reviewer reviews it
as a standalone change… not as a numbered §6 phase row"*, and the acceptance suite that pass produced
(`e2e/visual-identity-acceptance.spec.ts`) has now hardened the old palette into the regression suite — so a
successor cannot ship without a real checkpoint that owns rewriting it. It also **reverses two recorded
decisions** and touches essentially every screen. Both are things this project's own rules say get a checkpoint
and Jeff's approval. **Numbered 8i**, continuing the 8b–8h lettering rather than renumbering Phase 9.

**The 2026-07-25 "Visual identity rollout" section at the end of this document is superseded by this phase** and
is kept in place, marked, rather than deleted — the same convention `ai-context/DECISIONS.md` uses.

**Dependencies: none, and it blocks nothing. But see the ordering note.** It touches no data model, no action, no
RLS and no `lib/domain/` module. **Recommendation: land Phase 8h first** (§5) — 8h deletes two files 8i would
otherwise restyle, and both phases must edit `e2e/visual-identity-acceptance.spec.ts`'s dashboard assertions.
Either order works; **concurrently does not**.

**Two passes, at the same seam that worked last time**, because the reasoning still holds: pass A is the
dependency for pass B, and splitting there keeps each half independently reviewable and revertable.

- **Pass A — tokens, fonts, and the eight primitives.** This is where ~80% of the visual change actually happens.
  - **`src/app/globals.css`**: replace the six `:root` custom properties with the nine in §3.4's table
    (`--canvas`, `--surface`, `--ink`, `--muted`, `--line`, `--line-strong`, `--accent`, `--accent-soft`,
    `--accent-warm`); expose each in `@theme inline` as `--color-*`; repoint `--background`→`--canvas` and
    `--foreground`→`--ink`; **remove `--font-serif`** from `@theme inline`. Leave the `@source` directive and the
    `.tooltip-panel` media-query block untouched — both are load-bearing and unrelated (the first is the NB-1
    dead-CSS fix, and this doc's own prose quoting old class names is exactly what it defends against).
  - **`src/app/layout.tsx`**: delete the `Fraunces` import, its instance, and `${fraunces.variable}` from the
    `<html>` className. Geist Sans and Geist Mono stay exactly as they are.
  - **The eight primitives**, per §3.4's mapping table: `Button` (primary → `bg-accent text-white`; secondary
    border → `--line-strong`, the SC 1.4.11 fix; both → `rounded-lg`; focus outline → `--accent`; **`danger`
    unchanged**), `Card` (`rounded-xl`, `border-line`), `NavLink` (active → `bg-accent-soft text-ink`, **still a
    pill**), `styles.ts` (`inputClass` border/focus, `labelClass` → `--ink`, placeholder → `--muted`;
    **`errorTextClass` unchanged**), `StatusMessage`, `ActionPanel`, `Tooltip`, `icons.tsx` (`currentColor`
    already — verify, don't edit).
- **Pass B — the hand-edit list, which is the half that does not propagate.** §3.4 enumerates all seven items;
  the four worth restating as sequencing risks: **(1)** every `font-serif` occurrence (at most sites, deleting
  the single class is the entire edit — the weight/tracking classes are already beside it); **(2)** ~100
  `stone-*` occurrences across ~31 files, where **text and border** uses move to the new **tokens** and only
  fills/hovers may take a raw `slate-*`; **(3)** the sage arc `<svg>` in `(auth)/layout.tsx` is **deleted**;
  **(4)** `chartTheme.ts`'s two hardcoded hexes and the 20 `text-sage-deep`/`text-clay` classNames in
  `WeightChart`/`IntakeChart` — with calories taking `--accent-warm` so the chart agrees with 8j's bar colour.
- **Out — say no to these explicitly:** any layout, copy, component-structure or interaction change (this is
  colour, type and radius only); any change to `lib/domain/`, actions, schema or RLS; adopting a component
  library; adding a second font family (**§5 open question — Jeff's call, not the developer's**); a dark theme
  (still explicitly light-only for v1 — do **not** reintroduce a `prefers-color-scheme` block); restyling the
  semantic reds or the amber auth-callback notice; and building anything from the reference that this doc did
  not ask for (a logo mark, per-item icon chips in the food list, "Unlabeled meal" subtext).
- **§6 scope for qa-reviewer:** the *"Visual identity v2"* block in §6. **The two rows to hammer**: **(1) the
  tokens genuinely compute** in a real browser (a `:root` property never wired into `@theme inline` yields a
  class that silently does nothing), and **(2) no serif survives anywhere**, including that Fraunces is
  un-registered rather than merely unused. **The required in-the-same-change sweep is
  `e2e/visual-identity-acceptance.spec.ts` (rewritten in place — every assertion is false by design) and
  `src/components/food/FoodEntryList.test.tsx` (8 literal class-name assertions).** Fifth consecutive phase to
  carry one of these; two of the previous four shipped without it and produced a blocking finding.
- **Manual-browser check — Jeff's, and it is the only one that tests the actual complaint** ("dull and busy",
  "green buttons and creme background look ugly", "ornate fonts in the summary card"): walk every screen — both
  auth pages, `/food` (including an open `ActionPanel` and a row mid-edit), `/meals`, `/metrics`, `/trends`,
  `/settings` — and confirm no cream, no green, no serif, and that the card borders now read as quiet rather than
  boxed-in. Then check `/food` on a phone, since that is his primary device and the row actions are icon-only.

### Phase 8j — Daily calorie/protein goal progress on `/food` (2026-08-09 addition)

**Why its own phase, and why not folded into 8i.** It is a **feature**, not a restyle: it adds a pure domain
module, a new data read on `/food`, a new shared `ui/` primitive and real user-visible behaviour with its own
edge cases (no goal, one goal, over target). 8i is presentation-only and must stay that way — its whole
verification premise is *"a red test outside the two named files means logic was touched"*, which folding a
feature into it would destroy. This is the same scoping rule that split 8d/8e/8f.

**Dependencies: soft on 8i, hard on nothing.** It could ship first and draw its bars in `--sage-deep`/`--clay`.
**Recommendation: 8i first**, so the bars are born in their final colours and 8i's rewritten acceptance suite
does not have to be touched twice. The two share exactly one file (`DailyTotals.tsx`), so **do not run them
concurrently**.

**Adds no schema and no server action** — confirmed, not assumed: `user_goals` already holds both targets,
`getGoals()` already reads them, `/settings` already edits them, and `daily_food_totals` already supplies the
consumed figures summed on read. If a migration or a new action appears in this diff, the scope was
misunderstood.

- **In:**
  - **`lib/domain/goal-progress.ts`** — one pure function, signature in §3.4. **`pct` unclamped, `barPct`
    clamped**; `null` for a `null`, zero or negative target.
  - **`components/ui/ProgressBar.tsx`** — a thin decorative bar: neutral track, `--accent` or `--accent-warm`
    fill, width from `barPct`, **`aria-hidden="true"`**, no `progressbar` role and no `aria-valuenow`.
  - **`components/food/DailyTotals.tsx`** — three cards in a responsive grid (calories, protein, % from protein);
    bar + `N of M · N remaining` caption on the first two **only when that card's target is set**; **"320 over"**
    wording when over; a single *"Set daily targets"* link to `/settings` **only when both targets are unset**.
  - **The goals read**: `getGoals()` in `food/page.tsx` (Server Component), passed as a prop through
    `FoodDayView` → `FoodDayViewContent` → `DailyTotals`. `food/page.tsx` becomes `async`. **Deliberately
    server-side, against this screen's client-read convention** — reasoning in §3.4/§4, and the asymmetry with
    Phase 8h's client-read last-logged line is recorded so neither gets "simplified" into the other's bug.
- **Out — say no to these explicitly:** any stored/denormalised progress value (AGENTS.md's standing rule); any
  new summation logic (`daily_food_totals` and `sumEntries` already exist); a bar on the protein-% card (there is
  no target for it); goal history or per-day targets (the 2026-07-19 "single current goal" decision stands —
  browsing a past day shows it against **today's** target, §5); editing goals from `/food` (that is `/settings`,
  and a second edit path is exactly what the 2026-07-31 dashboard descope rejected); reviving the dashboard;
  streaks, rings, weekly rollups or "on track" projections; a red over-target bar; and any change to
  `daily_food_totals`, `getGoals`/`updateGoals`, or `/settings`.
- **§6 scope for qa-reviewer:** the *"Daily goal progress"* block in §6. **The two rows to hammer**: **(1) the
  no-goal fallback is byte-for-byte today's behaviour** (assert the *absence* of bar and caption — a 0%-width bar
  passes a presence-only test and looks broken), and **(2) over target keeps the caption truthful while clamping
  only the bar** (`pct 140` / `barPct 100`), the one pairing a single clamped percentage silently breaks. Also:
  partial goals are independent per card; nothing is stored; cross-user isolation through this new read path.
- **Manual-browser check:** with no goals set, confirm `/food` looks exactly as it does today. Set a calorie
  target only, and confirm the protein card is untouched. Log past the target and confirm it reads "over", the
  bar is full, and nothing turns red. Then browse to a past day and confirm the totals change while the targets
  do not.

### Phase 8k — The `/food` day-action surface: one toolbar, one panel outlet, real disclosure affordances (2026-08-11 addition)

**Why one phase for four findings.** Jeff's findings 1–4 from the 2026-08-11 round are all `/food` presentation,
but that is not the reason they are bundled — findings 2, 3 and 4 are the *same surface* (the day-action row,
its panels, and select mode), share the *same files* (`FoodDayView`, `CopyDayDialog`, `LogMealDialog`,
`EntrySelectionBar`), and **have to be designed against each other**: where the panel renders (2) decides
whether the selection bar can be its own accent region (3), and the toolbar container (4) is the thing that
stops existing (2). Splitting them would mean three phases reopening one row to re-derive one layout rule —
the expensive outcome, per the 8b/8f bundling precedent. **Finding 1 (the lookup expander's affordance) reaches
two files this phase does not otherwise open** (`FoodEntryForm`, `FoodLookupPanel`), so it follows the recorded
rule for that case: **still in this phase's checkpoint, but as its own commit**, exactly as Phase 8b handled the
`StatusMessage` restyle. **Numbered 8k**, continuing the 8b–8j lettering.

**Dependencies: 8b (hard), 8d (hard), 8c (soft).** It restructures select mode (8b), moves `ActionPanel`/
`Tooltip` (8d) onto new callers, and must not regress `LogMealDialog`'s fixed-meal mode (8c). It depends on
nothing after 8d and blocks nothing.

**Adds no server action, no schema, no `lib/domain/` module, and no data read.** Two new presentational
components (`food/DayActionBar.tsx`, `ui/DisclosureButton.tsx`), one moved piece of state, and layout. If a
migration, an action, or a query appears in this diff, the scope was misunderstood.

- **In (commit 1 — the day-action surface, findings 2/3/4):**
  - **`components/food/DayActionBar.tsx`** — the three triggers in one quiet container
    (`rounded-xl border border-line bg-white shadow-sm p-2`), each wrapped in `Tooltip` with the strings in
    §3.4. **No `role="toolbar"`, no group `aria-label`.** It renders **no panel**.
  - **`CopyDayDialog` and `LogMealDialog` become panel-only in every mode** — internal `open` state and the
    collapsed-button branch removed; **both `w-full` wrappers deleted**. `MealList`'s fixed-meal call site needs
    **no change**.
  - **`FoodDayView`** owns `dayAction: "logMeal" | "copyDay" | null` (single slot, the `groupAction`/`cardAction`
    shape), renders `DayActionBar` then a **panel outlet** directly beneath it, and keeps `selectMode` separate.
    The N-3 rule holds: `dayAction` changes only from user clicks.
  - **Select mode becomes one `ActionPanel`**, keyed on `bulkAction`, heading `"Select entries"` →
    `"Copy selected"` → `"Save selected as a meal"`, with `EntrySelectionBar` and the chosen bulk form as its
    children, and **the bar's four buttons suppressed while a bulk form is open** (the count stays; the
    checkboxes stay live).
- **In (commit 2 — disclosure affordances, finding 1):**
  - **`components/ui/DisclosureButton.tsx`** — `Button variant="secondary" size="sm"` + the existing
    `ChevronDownIcon` (`rotate-180` when open) + `aria-expanded` + `aria-controls`. No new glyph, no dependency.
  - Applied to **both** `FoodEntryForm` expanders (lookup, and "Add detail"/"Hide detail"); the trigger **stays
    rendered while open** and `FoodLookupPanel`'s separate "Close" link is **removed**.
- **Out — say no to these explicitly:** wrapping `FoodEntryForm`, "Add detail" or `FoodLookupPanel` in
  `ActionPanel` (§3.4's standing rule — these are optional detail, not actions awaiting completion); making the
  lookup trigger a tab; a sticky/floating toolbar (still no sticky pattern in this codebase); any change to the
  lookup, prefill, quantity/unit, grouping or copy behaviour; any change to `MealList`, `/meals`, or the group-
  header action bar in `FoodEntryList`; and adding a fourth emphasis-ladder rung.
- **§6 scope for qa-reviewer:** the *"The `/food` day-action surface"* block in §6. **The row to hammer** is the
  geometric one — with each panel open in turn, all three triggers are still present **and above** the panel
  (compare bounding boxes; a visibility-only assertion passes with the bug present). Also: exactly one accent
  region in select mode, focus landing inside the bulk form, and **re-running the refresh-survival assertion
  against the new structure** — the state changed owners, so the existing passing test proves nothing.
  **This is the first phase in six with no *known* required rewrite of an existing spec — verify that claim,
  do not trust it** (§5): `phase8b`'s `selectionBar()` helper and its `"Copy selected"`-submit lookups, and
  `phase8d`'s "focus lands inside" rows, are the three places most likely to be wrong.
- **Manual-browser check — the actual complaint:** open each of the three panels and confirm the buttons stay
  together above it; enter select mode and confirm the bar reads as an active surface rather than a card; hover
  each trigger on a pointer device and confirm the tooltip explains rather than repeats; then check the same row
  at a phone width, where the three buttons wrap and the panel outlet matters most.

### Phase 8l — The auth screens get the app's name back (2026-08-11 addition)

**Why its own phase.** It shares **no files** with 8k (`(auth)/layout.tsx`, the two auth pages, a new
`ui/Wordmark.tsx`, and one line of `(app)/layout.tsx`), it is presentation-only, and it is the direct consequence
of a Phase 8i decision (deleting the sage arc) rather than part of 8k's interaction work. **Numbered 8l.**

**Dependencies: 8i (hard — it is styling *within* the v2 palette), nothing else.** It blocks nothing except
8m, which should inherit the finished auth treatment rather than be restyled after the fact.

**Adds no route, no action, no schema, and no `lib/domain/` module.**

- **In:**
  - **`components/ui/Wordmark.tsx`** — "Health" in `--ink` + "Tracker" in `--accent`, plain text spans, **no
    `aria-label`** (the header link's accessible name must stay exactly `"Health Tracker"`).
  - **`(auth)/layout.tsx`** — the wordmark above the card, the tagline *"Log food, weight and body fat in
    seconds."* (`text-sm text-muted`) beneath it, and `shadow-lg` on **this** card via `className`.
  - **`(app)/layout.tsx`** — its header link renders `<Wordmark />` instead of the bare string, so there is one
    implementation of the app's name.
- **Out — say no to these explicitly:** **any decorative `<svg>` on the auth screens** (the Phase 8i guard in
  `e2e/visual-identity-acceptance.spec.ts` must keep passing **unedited** — if this phase's diff touches that
  assertion, it has gone out of scope); a logo mark or image asset; changing `Card`, `Button` or `styles.ts`;
  changing either page's `<h1>`, any field label, `autoComplete` value or button text; restyling the amber
  `auth_callback_failed` notice; and any copy change beyond the tagline.
- **The one overrulable call:** the two-tone wordmark. If Jeff prefers plain ink, it is a one-line change in one
  file — which is the argument for the component existing. Likewise the tagline is one deletable line.
- **§6 scope for qa-reviewer:** the *"Auth-screen identity"* block in §6 — the app names itself on both auth
  screens; the header link's accessible name is **exactly** unchanged; the zero-decorative-`<svg>` assertion
  still passes as written; and `e2e/auth.spec.ts` + `e2e/phase1-acceptance.spec.ts` re-run in full, since every
  locator on these two pages lives in them.
- **Manual-browser check:** load `/login` cold and ask the question Jeff asked — does this page say what the app
  is, and does it look deliberate? Then `/signup`, then both at a phone width.

### Phase 8m — Password reset (2026-08-11 addition)

**Why its own phase, and why it is not a small one.** It is the only genuinely **new capability** in this round:
two new routes, two new Server Actions, two new pure validators, and an **email-triggered flow that leaves the
app and comes back**, with a real edge case (a link that arrives with no valid session) that the other findings
do not have. Folding it into a presentation phase would destroy that phase's verification premise, the same
reasoning that split 8j from 8i. **Numbered 8m.**

**Dependencies: 8l (soft but real).** It adds a link to `/login` and two pages inside `(auth)/`, which should be
born with 8l's treatment rather than restyled afterwards; the two also both touch `/login`, so **do not run them
concurrently**. It has no dependency on 8k in either direction.

**Touches no application table, no RLS policy and no migration** — this is Supabase Auth only. `user_id` never
appears; the Absolute Rules in play are "server-side only" (both actions are `'use server'`; no browser-side
Supabase auth calls) and "no user data to third parties" (nothing leaves the system but the address Supabase
already holds).

- **In:**
  - **`lib/domain/auth-validation.ts`** — `validateForgotPasswordInput`, `validateNewPasswordInput`, reusing
    `isValidEmail`/`isValidPassword`/`MIN_PASSWORD_LENGTH`; the `FieldError` union is **unchanged**.
  - **`lib/actions/auth.ts`** — `requestPasswordReset` (neutral confirmation always; a genuine send failure gets
    its own generic message) and `updatePassword` (server-side session re-check, then `updateUser`, then
    `signOut()` + `redirect("/login?reset=success")`).
  - **`(auth)/forgot-password/page.tsx`** + its client form; **`(auth)/reset-password/page.tsx`** + its client
    form, with the page doing a server-side `getUser()` check and rendering an explanatory
    "invalid or has expired" state (and **no form**) when there is no session.
  - **`(auth)/login`** — a "Forgot password?" link, and a `?reset=success` confirmation notice reusing the
    existing `?error=` query-flag pattern.
  - **`auth/callback/route.ts`** — **no logic change**; only the `auth_callback_failed` copy is generalised, and
    it **must keep the substring "invalid or expired"** (an existing assertion depends on it).
- **Out — say no to these explicitly:** changing a password while signed in (a `/settings` feature, §5);
  magic-link or passwordless login; custom SMTP or a branded email template (the 2026-07-19 built-in-sender
  decision stands); a second callback Route Handler; any change to `middleware.ts`, the `(app)/` auth gate, RLS,
  or any table; and any client-side Supabase auth call.
- **§6 scope for qa-reviewer:** the *"Password reset"* block in §6. **The two rows to hammer**: the **full
  round trip against the real local stack** (request → email → link → set → **old password now fails and the new
  one works** — assert both halves), and the **neutral confirmation** (an unknown address renders a byte-identical
  message to a known one). Then: the no-session page state and the action's independent re-check, single-use
  link behaviour, server-side validation, signed-out-on-success, and the `?next=` open-redirect guard.
- **Environment note for the developer, from this repo's own history:** the recovery `redirectTo` is a
  same-origin URL **with a query string**, which nothing exercises today. If the email lands anywhere but
  `/auth/callback`, suspect `supabase/config.toml`'s `additional_redirect_urls` first (see §5 — the 2026-07-25
  `127.0.0.1`-vs-`localhost` bug had this exact shape), and note the hosted project will need the same entry in
  its dashboard. Local `[auth.rate_limit] email_sent = 2` per hour will bite while testing repeatedly.

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

### Visual identity rollout — SUPERSEDED 2026-08-09 by Phase 8i (cross-cutting — two passes, not a numbered feature phase)

> **SUPERSEDED (2026-08-09) by "Phase 8i — Visual identity v2" above.** This section shipped and was
> qa-reviewed; Jeff has since rejected the palette and typography it describes (*"the green buttons and creme
> background of our app look ugly"*; *"I do not like the ornate fonts"*). **Kept in place, not deleted**, per
> this project's convention — it is still the accurate record of how the app looked between 2026-07-26 and
> Phase 8i, and 8i's own scope is defined partly by reversing it. **What still stands, and is reused rather than
> re-decided by 8i:** the *structure* — tokens on `:root` exposed through `@theme inline`, `components/ui/` as
> the single source of truth, no raw hex in components, light-only (no dark theme) — plus the two-pass
> tokens-then-screens sequencing, which worked and is repeated. **What is reversed:** every colour value, the
> Fraunces/serif decision, the pill-button and `rounded-2xl` shape conventions, and the "sage arc" motif (which
> is deleted, not recoloured). **One claim below is now false and is the reason 8i needs a checkpoint of its
> own:** *"no automated test asserts on Tailwind class-names or colors"* was true when written, but this pass's
> own qa produced `e2e/visual-identity-acceptance.spec.ts`, and Phase 8g later added class-name assertions to
> `src/components/food/FoodEntryList.test.tsx` — both now pin this identity and both must be rewritten by 8i.

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
(7) **Phases 8i and 8j (2026-08-09) sit outside the dependency chain entirely and block nothing** — 8i is
presentation-only, 8j adds no schema and no action. But three ordering facts are real rather than preferences:
**8h before 8i** (8h deletes two files 8i would restyle, and both edit `e2e/visual-identity-acceptance.spec.ts`);
**8i before 8j** (so 8j's progress bars are born in their final colours and 8i's rewritten acceptance suite is
not touched twice); and **none of 8h/8i/8j may run concurrently with each other**, because each pair shares at
least one file — 8h↔8i share the dashboard files and that spec, 8i↔8j share `DailyTotals.tsx`. Sequentially, in
that order, is the recommendation; any single one of them can also be deferred indefinitely without blocking
Phase 9.
(8) **Phases 8k, 8l and 8m (2026-08-11) also sit outside the dependency chain and block nothing**, but three
facts are real rather than preferences: **8k depends hard on 8b and 8d** (it restructures select mode and moves
`ActionPanel`/`Tooltip` onto new callers) and must not regress **8c**'s `/meals` call site; **8l depends hard on
8i** (it is styling inside the v2 palette) and shares **no files** with 8k, so those two are a free ordering
choice and may even run in parallel; and **8l before 8m**, because 8m adds two pages and a link to the very
screens 8l restyles — running 8m first means building those pages twice, and running the two **concurrently is
not safe**, since both edit `/login`. Recommended order: **8k, then 8l, then 8m** — but 8k is genuinely
independent of the other two and can be resequenced or deferred on its own.

---
**Definition of Done for this feature:**
All 23 phases in §8 (1–9 plus 7b, 7c and 8b–8m — the count was last accurate at 13, before the 8d–8m
additions; corrected 2026-08-11) implemented and individually approved through their per-phase checkpoint
(developer implementation + unit tests → qa-reviewer's independent acceptance tests for that
phase → Jeff's review and approval); the full §6 acceptance-test suite green in CI; and Jeff has
used the app for real day-to-day food and weight logging for several days with no data loss and
no cross-user RLS leakage observed.
