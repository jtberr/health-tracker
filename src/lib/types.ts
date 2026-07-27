/**
 * Shared row/DTO types (see AGENTS.md repo structure: `lib/types.ts`). Mirrors the columns of
 * `supabase/migrations/20260721000000_food_weight_tracker_schema.sql` for the tables this phase
 * touches. Numeric Postgres columns (`numeric`, `integer`) come back from PostgREST as JS
 * `number`s (confirmed against the running local instance — not strings), so no string-parsing
 * is needed at the client boundary.
 */

import type { WeightUnit } from "@/lib/domain/units";
// Re-exported so callers can import the DB-row-adjacent `WeightUnit` type from `lib/types`
// alongside `UserGoals`/`DailyMetric`, without needing to know it's actually defined in `units.ts`.
export type { WeightUnit };

/** One row of `public.food_entries`. */
export type FoodEntry = {
  id: string;
  user_id: string;
  name: string;
  quantity: number;
  unit: string | null;
  calories_per_unit: number;
  protein_g_per_unit: number;
  /** STORED generated column: round(quantity * calories_per_unit). Read-only. */
  calories: number;
  /** STORED generated column: round(quantity * protein_g_per_unit, 2). Read-only. */
  protein_g: number;
  /** UTC instant, ISO 8601. */
  consumed_at: string;
  /** IANA zone captured at write time (e.g. "America/New_York"). */
  consumed_tz: string;
  /** Trigger-derived local calendar day (YYYY-MM-DD); the grouping/totals key. Read-only. */
  consumed_local_date: string;
  logged_from_meal_id: string | null;
  created_at: string;
  updated_at: string;
};

/** One row of the `public.daily_food_totals` view. */
export type DailyFoodTotals = {
  user_id: string;
  consumed_local_date: string;
  total_calories: number;
  total_protein_g: number;
  entry_count: number;
};

/**
 * The shape a food-lookup pick (Open Food Facts / USDA — Phase 6) will hand to `FoodEntryForm`
 * to silently prefill + auto-expand the "add detail" section. Not produced by anything in this
 * phase — this type exists now purely as the seam Phase 6 plugs into, per
 * docs/architecture/food-weight-tracker.md §8 Phase 3 ("Out ... build FoodEntryForm with a clean
 * seam to accept an external FoodCandidate prefill + auto-expand later").
 */
export type FoodCandidatePrefill = {
  name: string;
  quantity: number;
  unit: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
};

/**
 * One row of `public.daily_metrics` (Phase 4). Exactly one row per `(user_id, metric_date)` —
 * an upsert overwrites rather than inserting a new row. `weight_kg` is always canonical kg,
 * regardless of the user's `weight_unit` display preference (see `lib/domain/units.ts`).
 */
export type DailyMetric = {
  id: string;
  user_id: string;
  metric_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * One row of `public.user_goals` (Phase 4). One row per user (`user_id` is the PK) — the
 * "ensure-row" access pattern (`lib/actions/goals.ts`'s `getGoals`) creates a default row on
 * first access rather than treating "no row yet" as an error.
 */
export type UserGoals = {
  user_id: string;
  daily_calorie_target: number | null;
  daily_protein_target_g: number | null;
  weight_unit: WeightUnit;
  created_at: string;
  updated_at: string;
};

/**
 * One row of `public.meals` (Phase 7 -- "Saved meals"). A named, reusable combination of food
 * items; see `MealItem` for the items themselves. Deleting a meal cascades its items at the DB
 * level (`meal_items` FK `ON DELETE CASCADE`) but never touches already-logged `food_entries` --
 * those hold copied values, not a live reference (ai-context/DECISIONS.md "Saved meals: items
 * scoped per-meal, logged by copying values into independent food_entries rows").
 */
export type Meal = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

/**
 * One row of `public.meal_items` (Phase 7). Scoped to exactly one meal -- no shared cross-meal
 * food library (per the decision above). Same quantity/unit/per-unit + generated-total shape as
 * `FoodEntry`, minus the `consumed_at`/tz/date fields a saved-meal item doesn't have (time-of-day
 * is chosen only at log time, in `LogMealDialog`). `sort_order` persists user-controlled item
 * order within the meal.
 */
export type MealItem = {
  id: string;
  meal_id: string;
  user_id: string;
  name: string;
  quantity: number;
  unit: string | null;
  calories_per_unit: number;
  protein_g_per_unit: number;
  /** STORED generated column: round(quantity * calories_per_unit). Read-only. */
  calories: number;
  /** STORED generated column: round(quantity * protein_g_per_unit, 2). Read-only. */
  protein_g: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
