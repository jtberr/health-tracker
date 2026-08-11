"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { duplicateMeal, type MealActionState } from "@/lib/actions/meals";
import { duplicateMealName } from "@/lib/domain/meals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { Meal, MealItem } from "@/lib/types";

const initialActionState: MealActionState = { ok: false, error: null };

export type DuplicateMealDialogProps = {
  meal: Meal;
  /** Display/preview only ("N items will be copied") -- the action itself always re-reads the
   * source meal's items from the DB by id (§3.3), so a stale prop here can never cause the wrong
   * thing to be copied. */
  items: MealItem[];
  onDuplicated: (meal: Meal) => void;
  onCancel: () => void;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Duplicating..." : "Duplicate meal"}
    </Button>
  );
}

function friendlyError(error: string): string {
  switch (error) {
    case "meal_not_found":
      return "Couldn't find that meal — try reopening it and duplicating again.";
    case "unauthenticated":
      return "You've been signed out — please log in again.";
    default:
      // Same posture as SaveGroupAsMealDialog's friendlyError -- never echo an unrecognized code
      // or a raw Postgres error string to the UI verbatim.
      return "Something went wrong duplicating this meal. Please try again.";
  }
}

/**
 * Inline expander (design doc §3.4 "Duplicating"; Phase 8f) that creates an independent copy of an
 * existing saved meal via the `duplicateMeal` server action. Wrapped in `ActionPanel` by the
 * caller (`MealList`), mirroring `FoodEntryList`'s `SaveGroupAsMealDialog`/`CopyGroupDialog`
 * expanders -- this codebase still has no modal precedent, so a single feature isn't the place to
 * introduce one.
 *
 * **The name field IS prefilled** — `"<source name> (copy)"` via `duplicateMealName` — autofocused
 * with the text pre-selected so typing immediately replaces it. This deliberately does NOT match
 * `SaveGroupAsMealDialog`'s blank-name convention (Phase 7b): that decision rejected a prefill
 * because a first-item name can be actively wrong on a multi-item group; a duplicate's name can
 * never be wrong in that way ("<name> (copy)" is always a faithful description of what it is), so
 * the general rule is "prefill when the derived value cannot be wrong, leave blank when it can" —
 * see ai-context/DECISIONS.md's Phase 8f entry for the full reasoning.
 *
 * Renders its own `<form>` — legal here for the same reason `SaveGroupAsMealDialog` documents:
 * `MealList` (this component's parent) is a sibling of, not nested inside, any other `<form>`.
 */
export function DuplicateMealDialog({ meal, items, onDuplicated, onCancel }: DuplicateMealDialogProps) {
  const [state, formAction] = useActionState(duplicateMeal, initialActionState);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Pre-selects the prefilled name so the first keystroke replaces it rather than appending to it
  // -- `autoFocus` alone focuses the input but does not select its text. React commits `autoFocus`
  // before this effect runs, so the element is already focused by the time `.select()` fires.
  useEffect(() => {
    nameInputRef.current?.select();
  }, []);

  useEffect(() => {
    if (state.ok && state.meal) {
      onDuplicated(state.meal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate autoComplete="off">
      <input type="hidden" name="mealId" value={meal.id} autoComplete="off" />

      <div className="flex flex-col gap-1">
        <label htmlFor="duplicate-meal-name" className={labelClass}>
          Meal name
        </label>
        <input
          id="duplicate-meal-name"
          name="name"
          type="text"
          required
          autoFocus
          ref={nameInputRef}
          autoComplete="off"
          defaultValue={duplicateMealName(meal.name)}
          className={inputClass}
        />
        {state.fieldErrors?.name && <p className={errorTextClass}>{state.fieldErrors.name}</p>}
      </div>

      <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
        <p className="text-xs font-medium text-muted">
          {items.length} item{items.length === 1 ? "" : "s"} will be copied
        </p>
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
