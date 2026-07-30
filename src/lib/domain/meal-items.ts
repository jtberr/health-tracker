import type { FoodEntry, MealItem } from "@/lib/types";

/**
 * Pure, framework-free helpers for saved-meal items (Phase 7 — "Saved meals"; `mealItemsFromEntries`
 * added in Phase 7b — "Save a logged meal group as a Saved Meal"). No Next.js/React/Supabase
 * imports — primary unit-test target per AGENTS.md.
 */

/**
 * Groups a flat list of meal items by their `meal_id`, preserving each item's relative order
 * within its group (callers typically pass items already ordered by `sort_order`, e.g. straight
 * from a `.order("sort_order")` query). A meal with no items simply has no key in the result —
 * callers should default to an empty array for a meal id that isn't present.
 */
export function groupMealItemsByMeal(items: MealItem[]): Record<string, MealItem[]> {
  const grouped: Record<string, MealItem[]> = {};

  for (const item of items) {
    const existing = grouped[item.meal_id];
    if (existing) {
      existing.push(item);
    } else {
      grouped[item.meal_id] = [item];
    }
  }

  return grouped;
}

/**
 * Computes the `sort_order` each item should be assigned after a reorder, from its new position
 * in `orderedIds` (0-based index = new sort_order). Pure — the caller (the `reorderMealItems`
 * server action) is responsible for actually persisting these assignments.
 */
export function computeReorderedSortOrders(orderedIds: string[]): { id: string; sortOrder: number }[] {
  return orderedIds.map((id, index) => ({ id, sortOrder: index }));
}

/**
 * The by-value copy from a logged `food_entries` group into draft `meal_items` rows (design doc
 * §3.3 "createMealFromEntries"; Phase 7b — "Save a logged meal group as a Saved Meal"). Copies
 * ONLY the five value columns a saved-meal item actually needs — `name`, `quantity`, `unit`, and
 * the per-unit calorie/protein figures — plus a freshly assigned `sortOrder` of `0..N-1`.
 *
 * Deliberately drops everything else an entry carries: `id`, `user_id`, `consumed_at`/
 * `consumed_tz`/`consumed_local_date` (a saved-meal item has no notion of when it was eaten — only
 * `logMealForDay` stamps a time, at *log* time), `logged_from_meal_id` (this operation is strictly
 * read-only on `food_entries` — see §3.2/§3.3 — so a source entry's own meal back-reference is left
 * untouched, not repointed at the new meal), and the generated `calories`/`protein_g` totals (the
 * DB recomputes those from `quantity × per-unit` on insert — see §3.2 — so copying them would be
 * both redundant and, if the DB's rounding ever differs from a naive copy, wrong).
 *
 * Orders by `created_at` then `id` (ties broken by the immutable, unique `id`) rather than trusting
 * the caller's input order — a real meal *group*'s entries share one identical `consumed_at` by
 * definition (exact-timestamp grouping, `entry-grouping.ts`), so `consumed_at` itself cannot be
 * used to recover the order the items were actually logged in; `created_at` (the row-insert
 * timestamp) can.
 */
export type MealItemDraft = {
  name: string;
  quantity: number;
  unit: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  sortOrder: number;
};

export function mealItemsFromEntries(entries: FoodEntry[]): MealItemDraft[] {
  const sorted = [...entries].sort((a, b) => {
    const createdAtDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((entry, index) => ({
    name: entry.name,
    quantity: entry.quantity,
    unit: entry.unit,
    caloriesPerUnit: entry.calories_per_unit,
    proteinGPerUnit: entry.protein_g_per_unit,
    sortOrder: index,
  }));
}
