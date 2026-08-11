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

/** The comparator `sortMealsByName` applies WITHIN a partition (all-pinned or all-unpinned) —
 * factored out so pinning changes only which partition a meal is in, never the order within one. */
function compareMealsByName(a: Meal, b: Meal): number {
  const nameDiff = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  if (nameDiff !== 0) return nameDiff;
  const createdAtDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (createdAtDiff !== 0) return createdAtDiff;
  return a.id.localeCompare(b.id);
}

/**
 * Case-insensitive alphabetical order by `name`. Ties (duplicate names are explicitly legitimate —
 * design doc §5) break on `created_at` then `id`, so the order is deterministic and stable across
 * renders rather than depending on an unstable sort's incidental behavior. Returns a new array —
 * does not mutate the input.
 *
 * **Amended 2026-08-05 (Phase 8f): partitions PINNED meals ahead of unpinned ones, then applies
 * the IDENTICAL comparator within each partition** (design doc §3.3/§6). Pinning a meal changes
 * only which block it's in — the pinned block is alphabetical too, so pinning one meal never
 * reorders any other meal, pinned or not. All-pinned and all-unpinned inputs both degrade to the
 * plain alphabetical order this function always produced. One shared order for both `/meals` and
 * `LogMealDialog`'s picker (Phase 7c's rule), so a pinned meal sits at the top of both.
 */
export function sortMealsByName(meals: Meal[]): Meal[] {
  const pinned = meals.filter((meal) => meal.is_pinned).sort(compareMealsByName);
  const unpinned = meals.filter((meal) => !meal.is_pinned).sort(compareMealsByName);
  return [...pinned, ...unpinned];
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

/**
 * The prefilled name for `DuplicateMealDialog` (2026-08-05, Phase 8f) — `"Weekday breakfast"` →
 * `"Weekday breakfast (copy)"`. Deliberately does NOT try to produce a unique name: `meals.name`
 * has no uniqueness constraint and duplicate names are explicitly legitimate (design doc §5), so
 * hunting for `"(copy 2)"` would be inventing a rule the data model doesn't have. Duplicating a
 * duplicate simply yields `"... (copy) (copy)"` — visibly silly, which is the correct nudge to
 * rename it (asserted, not just tolerated — design doc §6). Whitespace in `name` is preserved,
 * not trimmed, since this is a plain string suffix, not a normalization step.
 *
 * This IS meant to be prefilled and pre-selected in the UI, unlike Phase 7b's deliberately-blank
 * save-as-meal name — see ai-context/DECISIONS.md's Phase 8f entry, "prefill when the derived
 * value cannot be wrong; leave blank when it can": a first-item name can be actively wrong for a
 * multi-item group, but `"<name> (copy)"` can never be wrong in that way.
 */
export function duplicateMealName(name: string): string {
  return `${name} (copy)`;
}
