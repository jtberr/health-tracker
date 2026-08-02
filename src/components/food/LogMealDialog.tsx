"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { logMealForDay, type LogMealActionState } from "@/lib/actions/meals";
import { floorToQuarterHour, quarterHourOptions } from "@/lib/domain/datetime";
import { groupMealItemsByMeal } from "@/lib/domain/meal-items";
import { sortMealsByName } from "@/lib/domain/meals";
import { sumEntries } from "@/lib/domain/totals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

const initialActionState: LogMealActionState = { ok: false, error: null };
/** Static — the same 96 buckets regardless of date/tz — so it's built once at module scope. */
const TIME_OPTIONS = quarterHourOptions();

export type LogMealDialogProps = {
  /** The day currently being viewed on `/food` — the dialog's date defaults here. Omit (fixed-meal
   * mode only, see `meal` below) to default to `today` instead — `/meals` has no "day currently
   * being viewed" concept (design doc §3.4 Phase 8c: "defaulting to today"). */
  selectedDate?: string;
  /** Today's local date (`max` for the date input) — same no-future-day cap as `FoodEntryForm`. */
  today: string;
  tz: string;
  onLogged: (entries: FoodEntry[]) => void;
  /** Phase 8c (2026-08-01): when supplied, this instance is scoped to exactly one meal — it skips
   * its own meals/items fetch and its `<select>` meal picker entirely, renders the meal's name as
   * static text, and submits that meal's id via a hidden field. Used by `MealList`'s per-card "Log
   * this meal" action on `/meals`; the `/food` picker usage (`FoodDayView`) omits this prop and is
   * completely unchanged. Keeping one component (rather than a second hand-copied dialog) is what
   * keeps the date/time fields, the `logMealForDay` error-code→message mapping, the cap wiring and
   * the tz handling in exactly one place — see ai-context/DECISIONS.md's Phase 8c entry. */
  meal?: Meal;
  /** Phase 8c: the parent (`MealList`) owns whether this expander is rendered at all — mirroring
   * `FoodEntryList`'s group-action expanders (`SaveGroupAsMealDialog`/`CopyGroupDialog`) — so a
   * dismiss click calls this instead of an internal open/close toggle. Only meaningful (and only
   * read) when `meal` is supplied; `/food`'s self-toggling usage manages its own open/close state
   * internally and does not pass this. */
  onCancel?: () => void;
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
 * load of `/food` never pays for a saved-meals read the user may not use that visit. **Fixed-meal
 * mode (`meal` prop supplied, Phase 8c) skips this fetch entirely** — there is nothing to pick,
 * so there is nothing to load.
 *
 * Two distinct rendering shapes, controlled by whether `meal` is supplied:
 *  - **Picker mode** (`/food`, `meal` omitted): self-toggling — renders its own "Log a saved meal"
 *    trigger button, then (once clicked) a bordered card with a header/"Close" button, a meals
 *    fetch with its own loading/error/empty states, and the `<select>` meal picker.
 *  - **Fixed-meal mode** (`/meals`'s `MealList`, `meal` supplied): the parent already renders the
 *    card chrome and its own toggle button (mirroring `FoodEntryList`'s "Save as meal"/"Cancel"
 *    toggle for `SaveGroupAsMealDialog`), so this renders ONLY the form body — the meal's name as
 *    static text instead of a picker, plus a bottom "Cancel" button (calling `onCancel`) alongside
 *    Submit, matching `SaveGroupAsMealDialog`/`CopyGroupDialog`'s own bottom Submit+Cancel row
 *    rather than duplicating a second dismiss affordance inside this component.
 */
export function LogMealDialog({ selectedDate, today, tz, onLogged, meal, onCancel }: LogMealDialogProps) {
  const [open, setOpen] = useState(false);
  const [supabase] = useState(() => createClient());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [itemsByMeal, setItemsByMeal] = useState<Record<string, MealItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [state, formAction] = useActionState(logMealForDay, initialActionState);

  /** `/meals` has no "day currently being viewed" — always today (design doc §3.4 Phase 8c). */
  const effectiveDate = selectedDate ?? today;

  const [defaultTime] = useState(() => {
    const floored = floorToQuarterHour(new Date());
    return `${String(floored.getHours()).padStart(2, "0")}:${String(floored.getMinutes()).padStart(2, "0")}`;
  });

  const isFixedMeal = meal !== undefined;

  useEffect(() => {
    // Fixed-meal mode never fetches — there's no picker to populate (see the module doc comment).
    if (isFixedMeal || !open) return;
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
            // Deterministic base order from the DB (Phase 7c) -- belt-and-suspenders alongside
            // `sortMealsByName` below, which remains the actual authority so this picker and
            // `/meals` can't disagree over case-insensitive/tie-break semantics.
            .order("name", { ascending: true })
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
          // Shared ordering with /meals (design doc §3.4 Phase 7c) -- a meal sits in the same
          // place in both surfaces, independent of the database's own collation.
          setMeals(sortMealsByName((mealsRes.data ?? []) as Meal[]));
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
  }, [isFixedMeal, open, supabase]);

  useEffect(() => {
    if (state.ok && state.entries) {
      // Closes this panel and hands the logged entries up to the caller on a successful submit —
      // the same "react to the action's settled state" pattern `FoodEntryForm`/`MetricForm` use
      // for their own `onSaved` effects. In picker mode `setOpen` is local-only (unlike those,
      // which only call a callback prop), so it needs its own suppression; in fixed-meal mode
      // there's no `open` state to reset — the parent (`MealList`) owns visibility and closes this
      // itself in its own `onLogged` handler, mirroring how `FoodEntryList` closes
      // `SaveGroupAsMealDialog`/`CopyGroupDialog` from ITS OWN `onSaved`/`onCopied` handlers rather
      // than from inside those components.
      if (!isFixedMeal) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOpen(false);
      }
      onLogged(state.entries);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!isFixedMeal && !open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="self-start">
        Log a saved meal
      </Button>
    );
  }

  // Shared between both modes — the ONLY thing that differs between them is the meal picker vs.
  // static name (below) and the surrounding chrome (further below). Assembled once so the
  // date/time fields, the error mapping, and the tz/cap wiring stay in exactly one place
  // regardless of which mode renders it.
  const formBody = (
    <form action={formAction} className="flex flex-col gap-3" noValidate autoComplete="off">
      <input type="hidden" name="logTz" value={tz} autoComplete="off" />

      {meal ? (
        <div className="flex flex-col gap-1">
          <p className={labelClass}>Meal</p>
          <p className="text-sm font-medium text-ink">{meal.name}</p>
          <input type="hidden" name="mealId" value={meal.id} autoComplete="off" />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="log-meal-select" className={labelClass}>
            Meal
          </label>
          <select
            id="log-meal-select"
            name="mealId"
            required
            autoComplete="off"
            defaultValue=""
            className={inputClass}
          >
            <option value="" disabled>
              Choose a meal...
            </option>
            {meals.map((option) => {
              const items = itemsByMeal[option.id] ?? [];
              const totals = sumEntries(items);
              return (
                <option key={option.id} value={option.id}>
                  {option.name} ({totals.calories} kcal, {items.length} item{items.length === 1 ? "" : "s"})
                </option>
              );
            })}
          </select>
          {state.fieldErrors?.mealId && <p className={errorTextClass}>{state.fieldErrors.mealId}</p>}
        </div>
      )}

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
            autoComplete="off"
            defaultValue={effectiveDate}
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
            autoComplete="off"
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
          {meal
            ? "This meal has no items yet — add some to this card before logging it."
            : "That meal has no items yet — add some on the Meals page before logging it."}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <SubmitButton />
        {meal && (
          <Button type="button" variant="secondary" onClick={() => onCancel?.()}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  if (meal) {
    // Fixed-meal mode: the parent (`MealList`) already provides the card chrome and its own
    // toggle button (see the module doc comment) — render only the form body.
    return formBody;
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
        formBody
      )}
    </div>
  );
}
