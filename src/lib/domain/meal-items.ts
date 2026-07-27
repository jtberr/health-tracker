import type { MealItem } from "@/lib/types";

/**
 * Pure, framework-free helpers for saved-meal items (Phase 7 — "Saved meals"). No Next.js/React/
 * Supabase imports — primary unit-test target per AGENTS.md.
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
