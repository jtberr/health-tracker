"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { addFoodEntry, updateFoodEntry, type FoodEntryActionState } from "@/lib/actions/food";
import {
  browserTimeZone,
  defaultConsumedAtForNextEntry,
  formatTimeLabel,
  localDateInTz,
  quarterHourOptions,
  utcToLocalTime,
} from "@/lib/domain/datetime";
import type { FoodCandidate } from "@/lib/domain/lookup";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import { FoodLookupPanel } from "./FoodLookupPanel";
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
 * `prefill` is the seam Phase 3 built for Phase 6 (food lookup) to plug an initial
 * `FoodCandidatePrefill` into at mount -- no caller passes it yet, but it's still wired end-to-end
 * (auto-expands + fills quantity/unit/per-unit). Phase 6 itself plugs in via a second, dynamic
 * path: `FoodLookupPanel` is embedded directly in this form (add mode only -- see below) and its
 * `onPick` calls `handleCandidatePick`, which re-runs the same fill-and-expand logic against a
 * candidate picked *after* the form has already mounted (a barcode/search result), rather than
 * only at construction time. Either path is a prefill for review, never an auto-submit -- the
 * user still explicitly presses "Add entry".
 */

const initialActionState: FoodEntryActionState = { ok: false, error: null };

/** Static — the same 96 buckets regardless of date/tz — so it's built once at module scope. */
const TIME_OPTIONS = quarterHourOptions();

type InputMode = "perUnit" | "total";

export type FoodEntryFormProps = {
  /** When set, the form edits this entry (via `updateFoodEntry`) instead of adding a new one. */
  editingEntry?: FoodEntry | null;
  /** The most recently *saved* entry's `consumed_at` for the day being logged — smart-default context. */
  lastConsumedAt?: string | null;
  /** The day being logged for (YYYY-MM-DD); the form's date field defaults to this. */
  selectedDate: string;
  /** True right when this instance mounts from a "Clear" click — see `computeInitialDateTime`. */
  resetToNow?: boolean;
  /** Phase 6 seam (unused this phase) — see file doc comment. */
  prefill?: FoodCandidatePrefill | null;
  onSaved: (entry: FoodEntry) => void;
  onCancelEdit?: () => void;
  /** Add-mode only: clears the entry fields without saving. See the "Clear" button below. */
  onClear?: () => void;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * Rounds a candidate's per-unit figure to 2 decimal places for display right after a lookup pick
 * (qa-reviewer N-4) -- real provider data can come back as e.g. `390.15000000000003`. Returns a
 * plain decimal string (never scientific notation) suitable for a controlled `<input>` value.
 */
function formatPrefillNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Pure, module-level so it isn't subject to the render-body declaration-order lint rule. */
function computeInitialDateTime(params: {
  editingEntry: FoodEntry | null;
  lastConsumedAt: string | null;
  selectedDate: string;
  tz: string;
  /** "Clear" wants a true blank slate (today's real clock time), not the same-sitting smart
      default -- passing this bypasses `lastConsumedAt` entirely, as if this were the first entry. */
  resetToNow?: boolean;
}): { date: string; time: string } {
  const { editingEntry, lastConsumedAt, selectedDate, tz, resetToNow = false } = params;
  if (editingEntry) return utcToLocalTime(editingEntry.consumed_at, editingEntry.consumed_tz);
  const defaultIso = defaultConsumedAtForNextEntry(resetToNow ? null : lastConsumedAt, new Date());
  return { date: selectedDate, time: utcToLocalTime(defaultIso, tz).time };
}

export function FoodEntryForm({
  editingEntry = null,
  lastConsumedAt = null,
  selectedDate,
  resetToNow = false,
  prefill = null,
  onSaved,
  onCancelEdit,
  onClear,
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
    () => computeInitialDateTime({ editingEntry, lastConsumedAt, selectedDate, tz, resetToNow }).date,
  );
  const [consumedTime, setConsumedTime] = useState(
    () => computeInitialDateTime({ editingEntry, lastConsumedAt, selectedDate, tz, resetToNow }).time,
  );

  const formRef = useRef<HTMLFormElement>(null);

  // Clicking "Edit" on an entry lower down the entries list (FoodEntryList, rendered below this
  // form) updates state correctly but otherwise leaves the page scrolled wherever it already was
  // -- the user has no visual cue the form above just changed to editing their entry. Scroll it
  // into view once, right when this instance mounts in edit mode. FoodDayView remounts this
  // component (a fresh key) every time the edit target changes, so a plain mount-only effect
  // (empty deps) fires exactly once per "Edit" click, not on every keystroke/re-render.
  useEffect(() => {
    if (isEditing) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Phase 6 (food lookup): a picked barcode/search candidate silently fills quantity/unit/
  // per-unit calories+protein and auto-expands the detail section, exactly like an initial
  // `prefill` prop would at mount -- see the file doc comment above. `FoodCandidate` is a strict
  // superset of `FoodCandidatePrefill`'s fields, so no mapping is needed here.
  function handleCandidatePick(candidate: FoodCandidate) {
    setName(candidate.name);
    setQuantity(String(candidate.quantity));
    setUnit(candidate.unit ?? "");
    // qa-reviewer N-4: real provider data (esp. USDA's per-100g scaling) routinely produces float
    // noise like 390.15000000000003. Round to 2 decimal places for what's *shown* right after a
    // pick -- this is purely a prefill-display nicety; it doesn't change what gets stored if the
    // user edits the field further before submitting.
    setCalories(formatPrefillNumber(candidate.caloriesPerUnit));
    setProtein(formatPrefillNumber(candidate.proteinGPerUnit));
    setMode("perUnit");
    setExpanded(true);
  }

  const caloriesLabel = mode === "perUnit" ? "Calories per unit" : "Total calories";
  const proteinLabel = mode === "perUnit" ? "Protein per unit (g)" : "Total protein (g)";

  // Edit invariant (§3.4/§4): a <select> can only display a value present in its own <option>
  // list. If an entry's stored time is off-grid (shouldn't normally happen given server-side
  // validation, but must be handled defensively — e.g. legacy data), the fixed 96-value list alone
  // would cause the select to silently fall back to its first option, silently rewriting the time
  // on save. Inject the current value as an extra option whenever it isn't already one of the 96.
  const timeOptions = TIME_OPTIONS.some((option) => option.value === consumedTime)
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { value: consumedTime, label: formatTimeLabel(consumedTime) }].sort(
        (a, b) => a.value.localeCompare(b.value),
      );

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
      noValidate
    >
      {isEditing && <input type="hidden" name="id" value={editingEntry!.id} />}
      <input type="hidden" name="consumedTz" value={tz} />
      <input type="hidden" name="mode" value={mode} />
      {/* When the detail section is collapsed, the visible quantity/unit inputs below aren't
          rendered, but the form must still submit whatever quantity/unit the user (or a lookup
          pick) actually set -- collapsing only hides the inputs, it must never reset the values
          back to the fast-entry default. Bug fixed 2026-07-26 (qa-reviewer B-1): this used to
          hardcode value="1"/value="" here, which silently discarded a picked/typed quantity the
          moment "Hide detail" was clicked after it had been changed. */}
      {!expanded && (
        <>
          <input type="hidden" name="quantity" value={quantity} />
          <input type="hidden" name="unit" value={unit} />
        </>
      )}

      {/* Phase 6: lookup is offered for new entries only -- an edit form already shows the
          entry's real, previously-saved values, and overwriting them from a fresh lookup pick
          would be a bigger, more surprising change than this panel's "quick prefill" is meant
          to be. */}
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-date`} className={labelClass}>
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
            className={inputClass}
          />
          {state.fieldErrors?.consumedDate && (
            <p className={errorTextClass}>{state.fieldErrors.consumedDate}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-time`} className={labelClass}>
            Time
          </label>
          <select
            id={`${idPrefix}-time`}
            name="consumedTime"
            required
            value={consumedTime}
            onChange={(e) => setConsumedTime(e.target.value)}
            className={`${inputClass} tabular-nums`}
          >
            {timeOptions.map((option) => (
              <option key={option.value} value={option.value} className="tabular-nums">
                {option.label}
              </option>
            ))}
          </select>
          {state.fieldErrors?.consumedTime && (
            <p className={errorTextClass}>{state.fieldErrors.consumedTime}</p>
          )}
        </div>
      </div>

      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-sm font-medium text-sage-deep hover:text-sage-deep/80"
        >
          + Add detail (quantity, unit)
        </button>
      )}

      {expanded && (
        <div className="flex flex-col gap-3 rounded-lg bg-stone-50 p-3.5">
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
              {state.fieldErrors?.quantity && (
                <p className={errorTextClass}>{state.fieldErrors.quantity}</p>
              )}
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

          {!isEditing && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="self-start text-sm font-medium text-sage-deep hover:text-sage-deep/80"
            >
              Hide detail
            </button>
          )}
        </div>
      )}

      {state.error && state.error !== "future_date" && (
        <p className={errorTextClass}>{state.error}</p>
      )}
      {state.error === "future_date" && (
        <p className={errorTextClass}>
          You can&apos;t log an entry dated later than today. Pick today or an earlier date.
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <SubmitButton
          label={isEditing ? "Save changes" : "Add entry"}
          pendingLabel={isEditing ? "Saving..." : "Adding..."}
        />
        {isEditing && (
          <Button type="button" variant="secondary" onClick={onCancelEdit}>
            Cancel
          </Button>
        )}
        {!isEditing && onClear && (
          <Button type="button" variant="secondary" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
