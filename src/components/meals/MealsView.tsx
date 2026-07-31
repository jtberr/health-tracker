"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { groupMealItemsByMeal } from "@/lib/domain/meal-items";
import { filterMealsByName, sortMealsByName } from "@/lib/domain/meals";
import { inputClass, labelClass } from "@/components/ui/styles";
import { MealForm } from "./MealForm";
import { MealList } from "./MealList";
import type { Meal, MealItem } from "@/lib/types";

/**
 * Client-side orchestrator for the `/meals` saved-meals library (design doc §3.1 `meals/page.tsx`,
 * §8 Phase 7: "Saved-meals library CRUD"). Reads go through the RLS-scoped browser Supabase
 * client rather than a Server Component fetch — mirroring `FoodDayView`/`MetricForm`/`TrendsView`'s
 * "each screen owns its own read + refetch-after-mutation loop" convention, kept here for
 * consistency across the app even though a saved meal itself has no timezone-dependent "today".
 *
 * Two flat queries (meals, then all of the user's meal items) rather than one PostgREST embedded
 * select — `meal_items`' FK to `meals` is the composite `(meal_id, user_id)` key (not a plain
 * single-column FK), and grouping the two flat, independently-RLS-scoped result sets client-side
 * via the pure `groupMealItemsByMeal` avoids relying on PostgREST's embedding behavior for a
 * composite relationship, which isn't exercised anywhere else in this codebase.
 *
 * **`hasLoadedOnce` — found by actually driving this screen in a browser, not by the automated
 * suite.** `MealList` owns real local UI state (which meal is expanded, which item is being
 * edited). `onChanged` (called after every add/edit/delete/reorder) calls this `refresh()`, which
 * — if it swapped to a "Loading…" placeholder on *every* call, the same way `FoodDayView`'s
 * loading branch does — would unmount `MealList` on every single mutation and remount a fresh
 * instance afterward, silently collapsing the just-expanded meal card the user was working in
 * right after they added the item they were adding. `FoodDayView`'s equivalent swap is safe
 * because `FoodEntryList` holds no comparable local UI state (its edit target lives in
 * `FoodDayView` itself) — `MealList` isn't in that position, so the big "Loading…" replacement is
 * now scoped to the *initial* load only; a background refresh after a mutation keeps `MealList`
 * mounted (and its state intact) throughout.
 */
export function MealsView() {
  const [supabase] = useState(() => createClient());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [items, setItems] = useState<MealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  // Transient view state, deliberately not a URL param (unlike /trends' `?range=`, which is a
  // server-rendered shareable view) -- design doc §3.4 Phase 7c. Typing never refetches; it only
  // narrows the rows already in `meals`.
  const [filterQuery, setFilterQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [mealsRes, itemsRes] = await Promise.all([
        supabase
          .from("meals")
          .select("*")
          // Deterministic base order from the DB (Phase 7c) -- belt-and-suspenders alongside
          // `sortMealsByName` below, which remains the actual authority so `/meals` and
          // `LogMealDialog`'s picker can't disagree over case-insensitive/tie-break semantics.
          .order("name", { ascending: true })
          .abortSignal(queryTimeoutSignal()),
        supabase
          .from("meal_items")
          .select("*")
          .order("sort_order", { ascending: true })
          .abortSignal(queryTimeoutSignal()),
      ]);
      if (mealsRes.error || itemsRes.error) {
        setLoadError(true);
      } else {
        setMeals((mealsRes.data ?? []) as Meal[]);
        setItems((itemsRes.data ?? []) as MealItem[]);
        setLoadError(false);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [supabase]);

  // Fetch-on-mount (React's own documented Effect use case). Same justified
  // `react-hooks/set-state-in-effect` suppression as `FoodDayView`/`MealsView`'s siblings — this
  // project has no data-fetching library to move the synchronous `setLoading(true)` into instead.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const itemsByMeal = groupMealItemsByMeal(items);

  // sortMealsByName is the single authoritative order (design doc §3.4 Phase 7c) -- applied here
  // regardless of the DB's own `.order("name")` above, so this screen and LogMealDialog's picker
  // can never disagree over case-insensitive/tie-break semantics. filterMealsByName then narrows
  // the already-sorted, already-fetched rows in memory -- no refetch, no debounce, no loading state.
  const sortedMeals = sortMealsByName(meals);
  const isFiltering = filterQuery.trim().length > 0;
  const visibleMeals = filterMealsByName(sortedMeals, filterQuery);
  // Distinguishes "genuinely zero saved meals" (MealList's own empty state fires below) from "has
  // meals, but none match the filter" (MealsView's own message, MealList not rendered at all) --
  // getting these confused is the most likely defect in this phase (design doc §6).
  const noMatches = meals.length > 0 && visibleMeals.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {creating ? (
        <MealForm
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start text-sm font-medium text-sage-deep hover:text-sage-deep/80"
        >
          + New meal
        </button>
      )}

      {!hasLoadedOnce && loading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : loadError ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">Couldn&apos;t load your saved meals.</p>
          <button
            type="button"
            onClick={() => refresh()}
            className="text-sm font-medium text-sage-deep hover:text-sage-deep/80"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {meals.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1 sm:max-w-xs sm:flex-1">
                <label htmlFor="meal-filter" className={labelClass}>
                  Filter meals
                </label>
                <input
                  id="meal-filter"
                  type="search"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="e.g. chicken"
                  className={inputClass}
                />
              </div>
              <p className="text-sm text-stone-500">
                {isFiltering
                  ? `Showing ${visibleMeals.length} of ${meals.length}`
                  : `${meals.length} saved meal${meals.length === 1 ? "" : "s"}`}
              </p>
            </div>
          )}

          {noMatches ? (
            <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
              No meals match &quot;{filterQuery.trim()}&quot;.
            </div>
          ) : (
            <MealList meals={visibleMeals} itemsByMeal={itemsByMeal} onChanged={refresh} />
          )}
        </div>
      )}
    </div>
  );
}
