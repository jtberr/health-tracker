"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { logMealForDay, type LogMealActionState } from "@/lib/actions/meals";
import { floorToQuarterHour, quarterHourOptionGroups } from "@/lib/domain/datetime";
import { groupMealItemsByMeal } from "@/lib/domain/meal-items";
import { sortMealsByName } from "@/lib/domain/meals";
import { sumEntries } from "@/lib/domain/totals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

const initialActionState: LogMealActionState = { ok: false, error: null };
/** Static — the same 3 <optgroup>s regardless of date/tz (Phase 8e) — built once at module scope. */
const TIME_OPTION_GROUPS = quarterHourOptionGroups();

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
  /** Phase 8k: REQUIRED in every mode now, not just fixed-meal mode. This component is panel-only
   * regardless of `meal` — it owns no `open` state of its own — so every caller supplies the trigger
   * AND owns visibility (`MealList`'s `cardAction` for fixed-meal mode, unchanged since Phase 8c;
   * `FoodDayView`'s `dayAction` for picker mode, new in Phase 8k — see `DayActionBar.tsx` and
   * `ai-context/DECISIONS.md`'s "The `/food` day-action surface..." entry). Previously picker mode
   * self-toggled via an internal `open` boolean and rendered its own collapsed-button branch; that
   * was the root cause of a real layout bug (opening this or `CopyDayDialog` from the same flex row
   * as their own trigger turned that flex item full-width, wrapping every trigger *after* it below
   * the open panel) — moving both onto the panel-only shape `CopyGroupDialog`/`SaveGroupAsMealDialog`
   * already had fixes it structurally rather than with a smarter layout hint. */
  onCancel: () => void;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Logging..." : "Log meal"}
    </Button>
  );
}

/** One picker `<option>` — factored out since it's now rendered from up to two different filtered
 * lists (Phase 8f's pinned/unpinned `<optgroup>`s) as well as the flat no-pinned-meals case, and
 * must render byte-identically in all three so 7c's name-first label invariant can't drift between
 * them. The meal name comes first, before the kcal/item-count parenthetical (native type-ahead
 * prefix-matches the option's text). */
function MealOption({ meal, items }: { meal: Meal; items: MealItem[] }) {
  const totals = sumEntries(items);
  return (
    <option value={meal.id}>
      {meal.name} ({totals.calories} kcal, {items.length} item{items.length === 1 ? "" : "s"})
    </option>
  );
}

/**
 * Pick a saved meal + date/time and log it as a batch of `food_entries` (design doc §3.1/§8
 * Phase 7 `food/LogMealDialog.tsx`), via the `logMealForDay` server action.
 *
 * Implemented as a panel expander — matching the existing `FoodLookupPanel`/"Add detail" expander
 * convention already used on `/food` — rather than a native `<dialog>` or a modal overlay: this
 * codebase has no modal precedent yet, and the expander keeps this screen's interaction pattern
 * consistent instead of introducing a new one for a single feature.
 *
 * Fetches the user's meals independently of `MealsView` on `/meals` (same "each screen owns its
 * own read" convention as `TodaySummary`/`FoodDayView`/`TrendsView`) — only while mounted, so a
 * page load of `/food` never pays for a saved-meals read the user may not use that visit.
 * **Fixed-meal mode (`meal` prop supplied, Phase 8c) skips this fetch entirely** — there is
 * nothing to pick, so there is nothing to load.
 *
 * **Panel-only in EVERY mode (Phase 8k)** — this component owns no `open`/visibility state of its
 * own in either mode and renders no trigger button; the caller mounts it only while it should be
 * shown, and unmounts it (by no longer rendering it) to close it:
 *  - **Picker mode** (`/food`, `meal` omitted): `FoodDayView` renders the "Log a saved meal"
 *    trigger (inside `DayActionBar`) and, only while its own `dayAction === "logMeal"`, this
 *    component wrapped in `ActionPanel heading="Log a saved meal"` — the identical shape
 *    fixed-meal mode already had. Before Phase 8k this self-toggled via an internal `open` boolean
 *    and rendered its own collapsed-button branch and `ActionPanel` wrap; that fused shape (a
 *    component laying out its own trigger AND panel from the same position in `FoodDayView`'s flex
 *    row) was the root cause of a real layout bug — opening this (or `CopyDayDialog`, the other
 *    self-toggling component in that row) turned that row's flex item full-width, wrapping every
 *    trigger *after* it below the open panel. See `DayActionBar.tsx` and
 *    `ai-context/DECISIONS.md`'s "The `/food` day-action surface..." entry.
 *  - **Fixed-meal mode** (`/meals`'s `MealList`, `meal` supplied): unchanged since Phase 8c — the
 *    parent already renders the card chrome, its own toggle button, and its own `ActionPanel`
 *    wrapper (mirroring `FoodEntryList`'s "Save as meal"/"Copy this group" pattern), so this
 *    renders ONLY the form body — the meal's name as static text instead of a picker.
 *
 * Both modes end with the same bottom Submit+Cancel row (`SaveGroupAsMealDialog`/
 * `CopyGroupDialog`'s convention) — Cancel always calls the caller's `onCancel`, which is what
 * closes this panel in either mode now.
 */
export function LogMealDialog({ selectedDate, today, tz, onLogged, meal, onCancel }: LogMealDialogProps) {
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
    // Phase 8k: this component is now mounted by the caller only while it should be shown, so
    // there's no separate `open` gate to check here anymore — every mount of picker mode wants
    // this fetch to run.
    if (isFixedMeal) return;
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
  }, [isFixedMeal, supabase]);

  useEffect(() => {
    if (state.ok && state.entries) {
      // Hands the logged entries up to the caller on a successful submit — the same "react to the
      // action's settled state" pattern `FoodEntryForm`/`MetricForm` use for their own `onSaved`
      // effects. Phase 8k: there's no local `open` state to reset in EITHER mode anymore — the
      // caller owns visibility in both (`FoodDayView`'s `dayAction` for picker mode, `MealList`'s
      // `cardAction` for fixed-meal mode) and closes this from its own `onLogged` handler, the same
      // pattern `FoodEntryList` already uses to close `SaveGroupAsMealDialog`/`CopyGroupDialog` from
      // ITS OWN `onSaved`/`onCopied` handlers rather than from inside those components.
      onLogged(state.entries);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
            {/* Phase 8f: "Pinned" / "All meals" <optgroup>s, ONLY when something is pinned --
                the same portable-content mechanism as Phase 8e's time-picker grouping, for the
                same <option>-CSS reason. `meals` is already sortMealsByName-ordered (pinned-first,
                then alphabetical within each block), so a plain filter below preserves that order
                inside each optgroup -- 7c's name-first label invariant is untouched either way
                (optgroups don't alter option text, so native type-ahead still prefix-matches the
                meal name). */}
            {meals.some((option) => option.is_pinned) ? (
              <>
                <optgroup label="Pinned">
                  {meals.filter((option) => option.is_pinned).map((option) => (
                    <MealOption key={option.id} meal={option} items={itemsByMeal[option.id] ?? []} />
                  ))}
                </optgroup>
                <optgroup label="All meals">
                  {meals.filter((option) => !option.is_pinned).map((option) => (
                    <MealOption key={option.id} meal={option} items={itemsByMeal[option.id] ?? []} />
                  ))}
                </optgroup>
              </>
            ) : (
              meals.map((option) => (
                <MealOption key={option.id} meal={option} items={itemsByMeal[option.id] ?? []} />
              ))
            )}
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
            {/* Bugfix (2026-08-10): <optgroup> dropped entirely (not just its label) -- a
                headless <optgroup> still reserves a blank row in Chromium. See FoodEntryForm.tsx's
                identical comment, the one source of truth for this reasoning; kept in sync
                manually since TIME_OPTION_GROUPS/the option markup is duplicated per call site,
                not shared. */}
            {TIME_OPTION_GROUPS.flatMap((group) =>
              group.options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  className={group.deEmphasized ? "tabular-nums bg-slate-100" : "tabular-nums"}
                >
                  {option.label}
                </option>
              )),
            )}
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
        {/* Cancel/Close is rendered in BOTH modes (unchanged since Phase 8f) -- now ALWAYS calling
            the caller's `onCancel` in both modes (Phase 8k), since neither mode owns any `open`
            state of its own to close anymore. */}
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );

  if (meal) {
    // Fixed-meal mode: the parent (`MealList`) already provides the card chrome, its own toggle
    // button, and its own `ActionPanel` wrapper (see the module doc comment) — render only the
    // form body.
    return formBody;
  }

  // Picker mode: the caller (`FoodDayView`) wraps this in `ActionPanel heading="Log a saved meal"`
  // itself, exactly as it wraps every other day-level/bulk expander (Phase 8k) -- this renders only
  // the loading/error/empty/form content. The loading/error/empty states get a lightweight "Close"
  // fallback (the form's own Cancel row above only exists once `formBody` itself renders), so the
  // panel is always dismissable regardless of fetch state.
  const canShowForm = !loading && !loadError && meals.length > 0;

  return (
    <>
      {loading && <p className="text-sm text-muted">Loading your saved meals…</p>}
      {!loading && loadError && <p className={errorTextClass}>Couldn&apos;t load your saved meals.</p>}
      {!loading && !loadError && meals.length === 0 && (
        <p className="text-sm text-muted">
          You don&apos;t have any saved meals yet — create one on the Meals page.
        </p>
      )}
      {canShowForm ? (
        formBody
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} className="self-start">
          Close
        </Button>
      )}
    </>
  );
}
