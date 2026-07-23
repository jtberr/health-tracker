"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { addFoodEntry, updateFoodEntry, type FoodEntryActionState } from "@/lib/actions/food";
import {
  browserTimeZone,
  defaultConsumedAtForNextEntry,
  localDateInTz,
  utcToLocalTime,
} from "@/lib/domain/datetime";
import type { FoodCandidatePrefill, FoodEntry } from "@/lib/types";

/**
 * Add/edit form for a single food entry — progressive disclosure + smart time default + 15-min
 * grid, per docs/architecture/food-weight-tracker.md §3.4.
 *
 * Default view = name + total calories + total protein + date/time (quantity defaults to 1, unit
 * blank). The "Add detail" expander reveals quantity/unit and an explicit per-unit-vs-total input
 * mode. Editing an existing entry always shows full detail (there's no ambiguity to progressively
 * disclose once real per-unit values already exist).
 *
 * `prefill` is the seam Phase 6 (food lookup) plugs a picked `FoodCandidate` into — unused by any
 * caller in this phase, but wired end-to-end here (auto-expands + fills quantity/unit/per-unit)
 * so Phase 6 can slot in without reworking this component.
 */

const initialActionState: FoodEntryActionState = { ok: false, error: null };

type InputMode = "perUnit" | "total";

export type FoodEntryFormProps = {
  /** When set, the form edits this entry (via `updateFoodEntry`) instead of adding a new one. */
  editingEntry?: FoodEntry | null;
  /** The most recently *saved* entry's `consumed_at` for the day being logged — smart-default context. */
  lastConsumedAt?: string | null;
  /** The day being logged for (YYYY-MM-DD); the form's date field defaults to this. */
  selectedDate: string;
  /** Phase 6 seam (unused this phase) — see file doc comment. */
  prefill?: FoodCandidatePrefill | null;
  onSaved: (entry: FoodEntry) => void;
  onCancelEdit?: () => void;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/** Pure, module-level so it isn't subject to the render-body declaration-order lint rule. */
function computeInitialDateTime(params: {
  editingEntry: FoodEntry | null;
  lastConsumedAt: string | null;
  selectedDate: string;
  tz: string;
}): { date: string; time: string } {
  const { editingEntry, lastConsumedAt, selectedDate, tz } = params;
  if (editingEntry) return utcToLocalTime(editingEntry.consumed_at, editingEntry.consumed_tz);
  const defaultIso = defaultConsumedAtForNextEntry(lastConsumedAt, new Date());
  return { date: selectedDate, time: utcToLocalTime(defaultIso, tz).time };
}

export function FoodEntryForm({
  editingEntry = null,
  lastConsumedAt = null,
  selectedDate,
  prefill = null,
  onSaved,
  onCancelEdit,
}: FoodEntryFormProps) {
  const isEditing = editingEntry !== null;
  const action = isEditing ? updateFoodEntry : addFoodEntry;
  const [state, formAction] = useActionState(action, initialActionState);
  const idPrefix = useId();

  // The tz used for a *new* entry is always the current browser tz. When editing, we keep the
  // entry's originally-captured tz (`editingEntry.consumed_tz`) so an unrelated edit (e.g. fixing
  // a typo in the name) can't silently shift consumed_local_date just because the editor happens
  // to be in a different tz today (e.g. the user travelled since logging it).
  const [tz] = useState(() => (isEditing ? editingEntry!.consumed_tz : browserTimeZone()));
  const [today] = useState(() => localDateInTz(new Date(), browserTimeZone()));

  const [expanded, setExpanded] = useState(
    () => isEditing || Boolean(prefill && (prefill.quantity !== 1 || prefill.unit)),
  );
  const [mode, setMode] = useState<InputMode>(() => (isEditing || prefill ? "perUnit" : "total"));
  const [name, setName] = useState(() => editingEntry?.name ?? prefill?.name ?? "");
  const [quantity, setQuantity] = useState(() => String(editingEntry?.quantity ?? prefill?.quantity ?? 1));
  const [unit, setUnit] = useState(() => editingEntry?.unit ?? prefill?.unit ?? "");
  const [calories, setCalories] = useState(() => {
    if (editingEntry) return String(editingEntry.calories_per_unit);
    if (prefill) return String(prefill.caloriesPerUnit);
    return "";
  });
  const [protein, setProtein] = useState(() => {
    if (editingEntry) return String(editingEntry.protein_g_per_unit);
    if (prefill) return String(prefill.proteinGPerUnit);
    return "";
  });

  const [consumedDate, setConsumedDate] = useState(
    () => computeInitialDateTime({ editingEntry, lastConsumedAt, selectedDate, tz }).date,
  );
  const [consumedTime, setConsumedTime] = useState(
    () => computeInitialDateTime({ editingEntry, lastConsumedAt, selectedDate, tz }).time,
  );

  // On a successful save, just notify the parent — it's the parent's responsibility (via a `key`
  // change on this component; see FoodDayView) to give the next "add" form a fresh mount rather
  // than this effect imperatively resetting a dozen fields itself (React's "resetting state with
  // a key" pattern: https://react.dev/learn/preserving-and-resetting-state).
  useEffect(() => {
    if (state.ok && state.entry) {
      onSaved(state.entry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const caloriesLabel = mode === "perUnit" ? "Calories per unit" : "Total calories";
  const proteinLabel = mode === "perUnit" ? "Protein per unit (g)" : "Total protein (g)";

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4" noValidate>
      {isEditing && <input type="hidden" name="id" value={editingEntry!.id} />}
      <input type="hidden" name="consumedTz" value={tz} />
      <input type="hidden" name="mode" value={mode} />
      {!expanded && (
        <>
          <input type="hidden" name="quantity" value="1" />
          <input type="hidden" name="unit" value="" />
        </>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium text-zinc-700">
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {state.fieldErrors?.name && <p className="text-sm text-red-600">{state.fieldErrors.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-calories`} className="text-sm font-medium text-zinc-700">
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {state.fieldErrors?.caloriesPerUnit && (
            <p className="text-sm text-red-600">{state.fieldErrors.caloriesPerUnit}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-protein`} className="text-sm font-medium text-zinc-700">
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {state.fieldErrors?.proteinGPerUnit && (
            <p className="text-sm text-red-600">{state.fieldErrors.proteinGPerUnit}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-date`} className="text-sm font-medium text-zinc-700">
            Date
          </label>
          <input
            id={`${idPrefix}-date`}
            name="consumedDate"
            type="date"
            max={today}
            required
            value={consumedDate}
            onChange={(e) => setConsumedDate(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {state.fieldErrors?.consumedDate && (
            <p className="text-sm text-red-600">{state.fieldErrors.consumedDate}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-time`} className="text-sm font-medium text-zinc-700">
            Time
          </label>
          <input
            id={`${idPrefix}-time`}
            name="consumedTime"
            type="time"
            step={900}
            required
            value={consumedTime}
            onChange={(e) => setConsumedTime(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {state.fieldErrors?.consumedTime && (
            <p className="text-sm text-red-600">{state.fieldErrors.consumedTime}</p>
          )}
        </div>
      </div>

      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-sm font-medium text-zinc-600 underline"
        >
          Add detail (quantity, unit)
        </button>
      )}

      {expanded && (
        <div className="flex flex-col gap-3 rounded-md bg-zinc-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idPrefix}-quantity`} className="text-sm font-medium text-zinc-700">
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
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
              {state.fieldErrors?.quantity && (
                <p className="text-sm text-red-600">{state.fieldErrors.quantity}</p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${idPrefix}-unit`} className="text-sm font-medium text-zinc-700">
                Unit (optional)
              </label>
              <input
                id={`${idPrefix}-unit`}
                name="unit"
                type="text"
                placeholder="eggs, cup, serving..."
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-zinc-700">
              Are the calories/protein above per unit, or a total for this quantity?
            </legend>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="radio"
                checked={mode === "total"}
                onChange={() => setMode("total")}
                className="h-4 w-4"
              />
              Total for the whole quantity
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="radio"
                checked={mode === "perUnit"}
                onChange={() => setMode("perUnit")}
                className="h-4 w-4"
              />
              Per unit
            </label>
          </fieldset>

          {!isEditing && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="self-start text-sm font-medium text-zinc-600 underline"
            >
              Hide detail
            </button>
          )}
        </div>
      )}

      {state.error && state.error !== "future_date" && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state.error === "future_date" && (
        <p className="text-sm text-red-600">
          You can&apos;t log an entry dated later than today. Pick today or an earlier date.
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton
          label={isEditing ? "Save changes" : "Add entry"}
          pendingLabel={isEditing ? "Saving..." : "Adding..."}
        />
        {isEditing && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
