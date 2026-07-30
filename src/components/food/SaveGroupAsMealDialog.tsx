"use client";

import { useActionState, useEffect, useId } from "react";
import { useFormStatus } from "react-dom";
import { createMealFromEntries, type MealActionState } from "@/lib/actions/meals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry, Meal } from "@/lib/types";

const initialActionState: MealActionState = { ok: false, error: null };

export type SaveGroupAsMealDialogProps = {
  /** The exact-`consumed_at` group's entries — this dialog's "source". Display/preview only; the
   * action itself always re-reads these rows from the DB by id (§3.3), so a stale prop here can
   * never cause the wrong thing to be saved. */
  entries: FoodEntry[];
  onSaved: (meal: Meal) => void;
  onCancel: () => void;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving..." : "Save meal"}
    </Button>
  );
}

function friendlyError(error: string): string {
  switch (error) {
    case "no_entries":
      return "Nothing to save — this group has no entries.";
    case "entries_not_found":
      return "Couldn't find those entries — try reopening this group and saving again.";
    case "unauthenticated":
      return "You've been signed out — please log in again.";
    default:
      // Any other code is an unrecognized short-code OR (qa-review N-1) a raw Postgres/Supabase
      // error string that reached this far (e.g. a malformed id past validation) — never echo it
      // to the UI verbatim, since that's an internal detail with no actionable meaning to a user.
      return "Something went wrong saving this meal. Please try again.";
  }
}

/**
 * Inline expander (design doc §3.4 "Save as meal on a group header"; Phase 7b) that names and
 * saves an already-logged exact-`consumed_at` meal group as a new Saved Meal, via the
 * `createMealFromEntries` server action. Same idiom as `LogMealDialog`/`FoodLookupPanel` — this
 * codebase has no modal precedent, so a single feature isn't the place to introduce one.
 *
 * **The name field starts blank** (settled 2026-07-30, Jeff's call — see
 * ai-context/DECISIONS.md "The save-as-meal name field starts blank..."): no prefill from the
 * group's items, autofocused, with a `placeholder` for shape only (a placeholder is never a
 * value, so submitting untouched is a real field error, not a silently-accepted default).
 *
 * The item preview below the name field is read-only and purely presentational — it renders
 * straight from the `entries` prop already fetched for the day. That's safe even if it were ever
 * stale, because the action itself always re-reads the entries from the DB by id regardless
 * (§3.3) — this preview never feeds the write.
 *
 * **No day refetch on success** — this operation is read-only on `food_entries`, so nothing on
 * `/food` changed; the caller (`FoodEntryList` -> `FoodDayView`) just closes this expander and
 * shows a transient confirmation.
 *
 * This renders its own `<form>` — legal here because `FoodEntryList` (this component's parent) is
 * a sibling of `FoodEntryForm`, not nested inside it (confirmed, not assumed — this repo has
 * already lost time once to the opposite case: the Phase 6 `FoodLookupPanel`/`BarcodeScanner`
 * nested-`<form>` bug, see ai-context/PROGRESS.md).
 */
export function SaveGroupAsMealDialog({ entries, onSaved, onCancel }: SaveGroupAsMealDialogProps) {
  const [state, formAction] = useActionState(createMealFromEntries, initialActionState);
  const idPrefix = useId();

  useEffect(() => {
    if (state.ok && state.meal) {
      onSaved(state.meal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      {entries.map((entry) => (
        <input key={entry.id} type="hidden" name="entryIds" value={entry.id} />
      ))}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-meal-name`} className={labelClass}>
          Meal name
        </label>
        <input
          id={`${idPrefix}-meal-name`}
          name="name"
          type="text"
          required
          autoFocus
          defaultValue=""
          placeholder="e.g. Weekday breakfast"
          className={inputClass}
        />
        {state.fieldErrors?.name && <p className={errorTextClass}>{state.fieldErrors.name}</p>}
      </div>

      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <p className="text-xs font-medium text-stone-500">
          {entries.length} item{entries.length === 1 ? "" : "s"} to save
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm text-stone-600">
          {entries.map((entry) => (
            <li key={entry.id}>
              {entry.quantity !== 1 || entry.unit
                ? `${entry.quantity}${entry.unit ? ` ${entry.unit}` : "x"} — ${entry.name}`
                : entry.name}{" "}
              ({entry.calories} kcal)
            </li>
          ))}
        </ul>
      </div>

      {state.error && !state.fieldErrors && <p className={errorTextClass}>{friendlyError(state.error)}</p>}

      <div className="flex items-center gap-2">
        <SubmitButton />
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
