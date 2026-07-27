"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { addMealItem, updateMealItem, type MealItemActionState } from "@/lib/actions/meals";
import type { FoodCandidate } from "@/lib/domain/lookup";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import { FoodLookupPanel } from "@/components/food/FoodLookupPanel";
import type { MealItem } from "@/lib/types";

/**
 * Add/edit form for one saved-meal item (design doc §3.1/§8 Phase 7 `meals/MealItemForm.tsx`).
 * Unlike `FoodEntryForm`, quantity/unit/per-unit fields are **always visible** — no progressive
 * disclosure — since building a saved meal is a deliberate, lower-frequency action (the 2026-07-19
 * "Progressive disclosure" decision explicitly carves this out), and there is **no date/time field
 * at all**: a saved-meal item carries no `consumed_at` — time-of-day is chosen only once, at log
 * time, in `LogMealDialog`.
 *
 * Reuses `FoodLookupPanel` exactly as `FoodEntryForm` does — add mode only (editing already shows
 * the item's real saved values; overwriting them from a fresh pick would be a bigger, more
 * surprising change than the panel's "quick prefill" is meant to be, same rationale Phase 6 used
 * for `FoodEntryForm`). `FoodLookupPanel` renders no `<form>` of its own (fixed in Phase 6 for
 * exactly this reason — see ai-context/PROGRESS.md's "Nested `<form>` elements silently break"
 * note), so embedding it inside this form's own `<form>` is safe.
 */

const initialActionState: MealItemActionState = { ok: false, error: null };

type InputMode = "perUnit" | "total";

export type MealItemFormProps = {
  mealId: string;
  editingItem?: MealItem | null;
  onSaved: (item: MealItem) => void;
  onCancel: () => void;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Same rounding rationale as `FoodEntryForm.formatPrefillNumber` — kills float noise from
 * real provider data (e.g. `390.15000000000003`) in what's *shown* right after a pick. */
function formatPrefillNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function MealItemForm({ mealId, editingItem = null, onSaved, onCancel }: MealItemFormProps) {
  const isEditing = editingItem !== null;
  const action = isEditing ? updateMealItem : addMealItem;
  const [state, formAction] = useActionState(action, initialActionState);
  const idPrefix = useId();

  const [mode, setMode] = useState<InputMode>(() => (isEditing ? "perUnit" : "total"));
  const [name, setName] = useState(() => editingItem?.name ?? "");
  const [quantity, setQuantity] = useState(() => String(editingItem?.quantity ?? 1));
  const [unit, setUnit] = useState(() => editingItem?.unit ?? "");
  const [calories, setCalories] = useState(() =>
    editingItem ? String(editingItem.calories_per_unit) : "",
  );
  const [protein, setProtein] = useState(() =>
    editingItem ? String(editingItem.protein_g_per_unit) : "",
  );

  useEffect(() => {
    if (state.ok && state.item) {
      onSaved(state.item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleCandidatePick(candidate: FoodCandidate) {
    setName(candidate.name);
    setQuantity(String(candidate.quantity));
    setUnit(candidate.unit ?? "");
    setCalories(formatPrefillNumber(candidate.caloriesPerUnit));
    setProtein(formatPrefillNumber(candidate.proteinGPerUnit));
    setMode("perUnit");
  }

  const caloriesLabel = mode === "perUnit" ? "Calories per unit" : "Total calories";
  const proteinLabel = mode === "perUnit" ? "Protein per unit (g)" : "Total protein (g)";

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3.5"
      noValidate
    >
      {isEditing && <input type="hidden" name="id" value={editingItem!.id} />}
      <input type="hidden" name="mealId" value={mealId} />
      <input type="hidden" name="mode" value={mode} />

      {!isEditing && <FoodLookupPanel onPick={handleCandidatePick} />}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-name`} className={labelClass}>
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        {state.fieldErrors?.name && <p className={errorTextClass}>{state.fieldErrors.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-quantity`} className={labelClass}>
            Quantity
          </label>
          <input
            id={`${idPrefix}-quantity`}
            name="quantity"
            type="number"
            step="any"
            min={0}
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
          {state.fieldErrors?.quantity && <p className={errorTextClass}>{state.fieldErrors.quantity}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-unit`} className={labelClass}>
            Unit (optional)
          </label>
          <input
            id={`${idPrefix}-unit`}
            name="unit"
            type="text"
            placeholder="eggs, cup, serving..."
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-calories`} className={labelClass}>
            {caloriesLabel}
          </label>
          <input
            id={`${idPrefix}-calories`}
            name="calories"
            type="number"
            step="any"
            min={0}
            required
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            className={inputClass}
          />
          {state.fieldErrors?.caloriesPerUnit && (
            <p className={errorTextClass}>{state.fieldErrors.caloriesPerUnit}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-protein`} className={labelClass}>
            {proteinLabel}
          </label>
          <input
            id={`${idPrefix}-protein`}
            name="protein"
            type="number"
            step="any"
            min={0}
            required
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            className={inputClass}
          />
          {state.fieldErrors?.proteinGPerUnit && (
            <p className={errorTextClass}>{state.fieldErrors.proteinGPerUnit}</p>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={labelClass}>
          Are the calories/protein above per unit, or a total for this quantity?
        </legend>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="radio"
            checked={mode === "total"}
            onChange={() => setMode("total")}
            className="h-4 w-4 accent-sage-deep"
          />
          Total for the whole quantity
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="radio"
            checked={mode === "perUnit"}
            onChange={() => setMode("perUnit")}
            className="h-4 w-4 accent-sage-deep"
          />
          Per unit
        </label>
      </fieldset>

      {state.error && <p className={errorTextClass}>{state.error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <SubmitButton label={isEditing ? "Save item" : "Add item"} pendingLabel="Saving..." />
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
