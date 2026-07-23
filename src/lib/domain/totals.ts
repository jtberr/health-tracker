import type { FoodEntry } from "@/lib/types";

/**
 * Pure, framework-free total aggregation over food entries. No Next.js/React/Supabase imports —
 * primary unit-test target per AGENTS.md.
 *
 * Used for per-meal-group rollups (summing the entries in one `entry-grouping.EntryGroup` so
 * `nutrition.proteinCaloriePct` can compute the group's ratio-of-sums %). Day-level totals are
 * NOT computed here — those are read from the `daily_food_totals` DB view (sum-on-read from the
 * source rows, per AGENTS.md "What Not To Do": never denormalize/re-derive in app code what a
 * view already computes).
 */

export type NutrientTotals = {
  calories: number;
  proteinG: number;
};

/** Sums `calories`/`protein_g` across a list of entries (or meal items with the same shape). */
export function sumEntries(entries: Pick<FoodEntry, "calories" | "protein_g">[]): NutrientTotals {
  return entries.reduce<NutrientTotals>(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      proteinG: acc.proteinG + entry.protein_g,
    }),
    { calories: 0, proteinG: 0 },
  );
}
