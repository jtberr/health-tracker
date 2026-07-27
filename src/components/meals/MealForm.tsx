"use client";

import { useActionState, useEffect, useId } from "react";
import { useFormStatus } from "react-dom";
import { createMeal, updateMeal, type MealActionState } from "@/lib/actions/meals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { Meal } from "@/lib/types";

/**
 * Create/rename a saved meal (design doc §3.1/§8 Phase 7 `meals/MealForm.tsx`) — name only; items
 * are managed separately via `MealItemForm`. Mirrors `FoodEntryForm`'s add-vs-edit dual-action
 * shape: `editingMeal` present -> `updateMeal`, absent -> `createMeal`.
 */

const initialActionState: MealActionState = { ok: false, error: null };

export type MealFormProps = {
  editingMeal?: Meal | null;
  onSaved: (meal: Meal) => void;
  onCancel?: () => void;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function MealForm({ editingMeal = null, onSaved, onCancel }: MealFormProps) {
  const isEditing = editingMeal !== null;
  const action = isEditing ? updateMeal : createMeal;
  const [state, formAction] = useActionState(action, initialActionState);
  const idPrefix = useId();

  useEffect(() => {
    if (state.ok && state.meal) {
      onSaved(state.meal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      action={formAction}
      className="flex flex-col items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:p-5"
      noValidate
    >
      {isEditing && <input type="hidden" name="id" value={editingMeal!.id} />}
      <div className="flex w-full flex-1 flex-col gap-1">
        <label htmlFor={`${idPrefix}-meal-name`} className={labelClass}>
          Meal name
        </label>
        <input
          id={`${idPrefix}-meal-name`}
          name="name"
          type="text"
          required
          defaultValue={editingMeal?.name ?? ""}
          placeholder="e.g. Breakfast burrito"
          className={inputClass}
        />
        {state.fieldErrors?.name && <p className={errorTextClass}>{state.fieldErrors.name}</p>}
        {state.error && !state.fieldErrors && <p className={errorTextClass}>{state.error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton label={isEditing ? "Save" : "Create meal"} pendingLabel="Saving..." />
        {isEditing && (
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
