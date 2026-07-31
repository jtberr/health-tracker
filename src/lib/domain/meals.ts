import type { Meal } from "@/lib/types";

/**
 * Pure, framework-free helpers for the saved-meals LIBRARY (meal-level ordering/filtering) —
 * Phase 7c, "Saved-meals library: ordering, filtering, and counts". Deliberately a separate module
 * from `meal-items.ts` (which is item-level), per that file's own doc comment.
 *
 * Both `/meals` (`MealsView`) and `/food`'s `LogMealDialog` picker fetch every one of the user's
 * saved meals with no server-side limit — see `ai-context/DECISIONS.md`'s "Saved-meals list scaling
 * is a findability problem, not a data-volume one..." entry for why that stays true here. These two
 * functions are what turn that already-fully-fetched list into something scannable: one shared
 * alphabetical order for both surfaces, and an in-memory substring filter for `/meals`.
 */

/**
 * Case-insensitive alphabetical order by `name`. Ties (duplicate names are explicitly legitimate —
 * design doc §5) break on `created_at` then `id`, so the order is deterministic and stable across
 * renders rather than depending on an unstable sort's incidental behavior. Returns a new array —
 * does not mutate the input.
 */
export function sortMealsByName(meals: Meal[]): Meal[] {
  return [...meals].sort((a, b) => {
    const nameDiff = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (nameDiff !== 0) return nameDiff;
    const createdAtDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (createdAtDiff !== 0) return createdAtDiff;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Case-insensitive, AND-of-whitespace-separated-tokens SUBSTRING match against `meal.name` only —
 * item/ingredient names are deliberately not searched (design doc §4, deferred). An empty or
 * whitespace-only query returns the input **unchanged, in its given order** (identity — not "no
 * results"), so an untouched or just-cleared filter box never blanks the list. This is a pure
 * in-memory filter over rows already fetched; see `ai-context/DECISIONS.md` for why moving this
 * server-side is the tripwire to watch if the meals query ever gains pagination/`.limit()`.
 */
export function filterMealsByName(meals: Meal[], query: string): Meal[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return meals;

  return meals.filter((meal) => {
    const name = meal.name.toLowerCase();
    return tokens.every((token) => name.includes(token));
  });
}
