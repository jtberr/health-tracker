/**
 * Shared row/DTO types (see AGENTS.md repo structure: `lib/types.ts`). Mirrors the columns of
 * `supabase/migrations/20260721000000_food_weight_tracker_schema.sql` for the tables this phase
 * touches. Numeric Postgres columns (`numeric`, `integer`) come back from PostgREST as JS
 * `number`s (confirmed against the running local instance — not strings), so no string-parsing
 * is needed at the client boundary.
 */

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
