"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { logMealForDay, type LogMealActionState } from "@/lib/actions/meals";
import { floorToQuarterHour, quarterHourOptions } from "@/lib/domain/datetime";
import { groupMealItemsByMeal } from "@/lib/domain/meal-items";
import { sumEntries } from "@/lib/domain/totals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

const initialActionState: LogMealActionState = { ok: false, error: null };
/** Static — the same 96 buckets regardless of date/tz — so it's built once at module scope. */
const TIME_OPTIONS = quarterHourOptions();

export type LogMealDialogProps = {
  /** The day currently being viewed on `/food` — the dialog's date defaults here. */
  selectedDate: string;
  /** Today's local date (`max` for the date input) — same no-future-day cap as `FoodEntryForm`. */
  today: string;
  tz: string;
  onLogged: (entries: FoodEntry[]) => void;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Logging..." : "Log meal"}
    </Button>
  );
}

/**
 * Pick a saved meal + date/time and log it as a batch of `food_entries` (design doc §3.1/§8
 * Phase 7 `food/LogMealDialog.tsx`), via the `logMealForDay` server action.
 *
 * Implemented as an inline expand/collapse panel — matching the existing `FoodLookupPanel`/
 * "Add detail" expander convention already used on `/food` — rather than a native `<dialog>` or a
 * modal overlay: this codebase has no modal precedent yet, and the expander keeps this screen's
 * interaction pattern consistent instead of introducing a new one for a single feature.
 *
 * Fetches the user's meals independently of `MealsView` on `/meals` (same "each screen owns its
 * own read" convention as `TodaySummary`/`FoodDayView`/`TrendsView`) — only while open, so a page
 * load of `/food` never pays for a saved-meals read the user may not use that visit.
 */
export function LogMealDialog({ selectedDate, today, tz, onLogged }: LogMealDialogProps) {
  const [open, setOpen] = useState(false);
  const [supabase] = useState(() => createClient());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [itemsByMeal, setItemsByMeal] = useState<Record<string, MealItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [state, formAction] = useActionState(logMealForDay, initialActionState);

  const [defaultTime] = useState(() => {
    const floored = floorToQuarterHour(new Date());
    return `${String(floored.getHours()).padStart(2, "0")}:${String(floored.getMinutes()).padStart(2, "0")}`;
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // Inside an async closure, not the synchronous effect body itself, so these setState calls
      // don't trip `react-hooks/set-state-in-effect` (unlike the synchronous case in the effect
      // below) -- no suppression comment needed here.
      setLoading(true);
      setLoadError(false);
      try {
        const [mealsRes, itemsRes] = await Promise.all([
          supabase
            .from("meals")
            .select("*")
            .order("created_at", { ascending: true })
            .abortSignal(queryTimeoutSignal()),
          supabase
            .from("meal_items")
            .select("*")
            .order("sort_order", { ascending: true })
            .abortSignal(queryTimeoutSignal()),
        ]);
        if (cancelled) return;
        if (mealsRes.error || itemsRes.error) {
          setLoadError(true);
        } else {
          setMeals((mealsRes.data ?? []) as Meal[]);
          setItemsByMeal(groupMealItemsByMeal((itemsRes.data ?? []) as MealItem[]));
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  useEffect(() => {
    if (state.ok && state.entries) {
      // Closes this panel and hands the logged entries up to the caller on a successful submit —
      // the same "react to the action's settled state" pattern `FoodEntryForm`/`MetricForm` use
      // for their own `onSaved` effects; `setOpen` is local-only here (unlike those, which only
      // call a callback prop), so it needs its own suppression.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      onLogged(state.entries);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm font-medium text-sage-deep hover:text-sage-deep/80"
      >
        Log a saved meal
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Log a saved meal</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-stone-500 hover:text-stone-700"
        >
          Close
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-stone-500">Loading your saved meals…</p>
      ) : loadError ? (
        <p className={errorTextClass}>Couldn&apos;t load your saved meals.</p>
      ) : meals.length === 0 ? (
        <p className="text-sm text-stone-500">
          You don&apos;t have any saved meals yet — create one on the Meals page.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3" noValidate>
          <input type="hidden" name="logTz" value={tz} />

          <div className="flex flex-col gap-1">
            <label htmlFor="log-meal-select" className={labelClass}>
              Meal
            </label>
            <select id="log-meal-select" name="mealId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Choose a meal...
              </option>
              {meals.map((meal) => {
                const items = itemsByMeal[meal.id] ?? [];
                const totals = sumEntries(items);
                return (
                  <option key={meal.id} value={meal.id}>
                    {meal.name} ({totals.calories} kcal, {items.length} item{items.length === 1 ? "" : "s"})
                  </option>
                );
              })}
            </select>
            {state.fieldErrors?.mealId && <p className={errorTextClass}>{state.fieldErrors.mealId}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="log-meal-date" className={labelClass}>
                Date
              </label>
              <input
                id="log-meal-date"
                name="logDate"
                type="date"
                max={today}
                required
                defaultValue={selectedDate}
                className={inputClass}
              />
              {state.fieldErrors?.logDate && <p className={errorTextClass}>{state.fieldErrors.logDate}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="log-meal-time" className={labelClass}>
                Time
              </label>
              <select
                id="log-meal-time"
                name="logTime"
                required
                defaultValue={defaultTime}
                className={`${inputClass} tabular-nums`}
              >
                {TIME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="tabular-nums">
                    {option.label}
                  </option>
                ))}
              </select>
              {state.fieldErrors?.logTime && <p className={errorTextClass}>{state.fieldErrors.logTime}</p>}
            </div>
          </div>

          {state.error && state.error !== "future_date" && state.error !== "empty_meal" && (
            <p className={errorTextClass}>{state.error}</p>
          )}
          {state.error === "future_date" && (
            <p className={errorTextClass}>
              You can&apos;t log a meal dated later than today. Pick today or an earlier date.
            </p>
          )}
          {state.error === "empty_meal" && (
            <p className={errorTextClass}>
              That meal has no items yet — add some on the Meals page before logging it.
            </p>
          )}

          <div className="pt-1">
            <SubmitButton />
          </div>
        </form>
      )}
    </div>
  );
}
