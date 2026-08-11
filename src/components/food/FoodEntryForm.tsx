"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { addFoodEntry, updateFoodEntry, type FoodEntryActionState } from "@/lib/actions/food";
import {
  browserTimeZone,
  defaultConsumedAtForNextEntry,
  formatTimeLabel,
  localDateInTz,
  quarterHourGroupIndexFor,
  quarterHourOptionGroups,
  quarterHourOptions,
  utcToLocalTime,
} from "@/lib/domain/datetime";
import type { FoodCandidate } from "@/lib/domain/lookup";
import { Button } from "@/components/ui/Button";
import { DisclosureButton } from "@/components/ui/DisclosureButton";
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
 * This form no longer has a "Delete" control of any kind (2026-08-07, Phase 8g reverses the
 * 2026-08-05/Phase 8d placement) -- deleting an entry is a `FoodEntryList` row action again, guarded
 * by a `window.confirm` owned by the caller (`FoodDayView.handleDelete`), not a form control here.
 *
 * `prefill` is the seam Phase 3 built for Phase 6 (food lookup) to plug an initial
 * `FoodCandidatePrefill` into at mount -- no caller passes it yet, but it's still wired end-to-end
 * (auto-expands + fills quantity/unit/per-unit). Phase 6 itself plugs in via a second, dynamic
 * path: `FoodLookupPanel` is embedded directly in this form (add mode only -- see below) and its
 * `onPick` calls `handleCandidatePick`, which re-runs the same fill-and-expand logic against a
 * candidate picked *after* the form has already mounted (a barcode/search result), rather than
 * only at construction time. Either path is a prefill for review, never an auto-submit -- the
 * user still explicitly presses "Add entry".
 *
 * **`tz`/`today` resolved in a mount-only Effect, not at render time (2026-08-06, Phase 8d qa-
 * review N-6).** This form previously computed both via plain `useState` initializers
 * (`browserTimeZone()`/`localDateInTz(...)` called directly during render) -- the exact SSR/client
 * hydration-mismatch anti-pattern already found and fixed in `FoodDayView.tsx` (see that file's
 * doc comment and `ai-context/DECISIONS.md`). Today this form is only ever reached through
 * `FoodDayView`'s own mount-only-Effect gate (`FoodDayViewContent` never renders until `FoodDayView`
 * has already resolved client-side, so this component's *own* first render is already client-only,
 * with nothing server-rendered to hydrate against) -- so the bug was latent, not live. Fixed anyway
 * as a tripwire: nothing here should depend on being rendered from behind someone else's gate to be
 * safe, and a future caller that renders this form from a server-rendered path would otherwise
 * silently reintroduce the exact mismatch `FoodDayView` just fixed. Follows the identical shape:
 * `FoodEntryForm` (below) owns ONLY the `tz`/`today` resolution + a matching "Loading…" placeholder
 * on the server pass and the client's first pass; `FoodEntryFormContent` (everything the form used
 * to do directly) receives them as required, already-resolved props -- the same
 * `FoodDayView`/`FoodDayViewContent` and `MetricForm`/`MetricEntryForm` split.
 *
 * **Adapted, not copy-pasted, for this form's edit-mode branch**: when editing, `tz` must still be
 * the entry's OWN originally-captured `consumed_tz` (`editingEntry.consumed_tz`), never the
 * browser's current tz -- load-bearing existing behaviour (§3.4/§4: an unrelated edit, e.g. fixing
 * a typo, must never silently shift `consumed_local_date` just because the editor is in a different
 * tz today, e.g. the user travelled since logging it). That value is already known synchronously
 * from props with no browser API involved, so the mount Effect below still resolves it (uniformly
 * with the add-mode branch, rather than special-casing away the placeholder for edits) but there is
 * no real async wait either way -- `Intl`-based tz/date resolution is synchronous, so in practice
 * this placeholder is visible for at most one paint, not a perceptible loading state on every
 * edit/add/Clear-triggered remount.
 */

const initialActionState: FoodEntryActionState = { ok: false, error: null };

/** Static — the same 96 buckets regardless of date/tz — so it's built once at module scope. */
const TIME_OPTIONS = quarterHourOptions();
/** Static — the same 3 <optgroup>s regardless of date/tz (Phase 8e). */
const TIME_OPTION_GROUPS = quarterHourOptionGroups();

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

export function FoodEntryForm(props: FoodEntryFormProps) {
  const { editingEntry = null } = props;
  const isEditing = editingEntry !== null;
  const [tz, setTz] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);

  // Client-only: resolves post-mount, avoiding the SSR/client hydration mismatch described in the
  // file doc comment above -- the same pattern FoodDayView/MetricForm/MealsView already use. The
  // tz branch preserves the existing edit-mode invariant (an entry's own originally-captured tz,
  // never the browser's current one); `editingEntry`/`isEditing` come from props, so they're valid
  // effect dependencies, not stale closures.
  useEffect(() => {
    const resolvedTz = isEditing ? editingEntry!.consumed_tz : browserTimeZone();
    const resolvedToday = localDateInTz(new Date(), browserTimeZone());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTz(resolvedTz);
    setToday(resolvedToday);
  }, [isEditing, editingEntry]);

  // Same placeholder on the server pass and the client's first pass (both have tz === null),
  // which is what keeps hydration in sync -- see the module doc comment above.
  if (tz === null || today === null) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return <FoodEntryFormContent {...props} tz={tz} today={today} />;
}

/**
 * Everything `FoodEntryForm` used to own directly, unchanged, now receiving the already-resolved
 * `tz`/`today` as required props instead of computing them itself -- see the file doc comment above
 * for why this split exists (the 2026-08-06 Phase 8d qa-review N-6 hydration-mismatch fix).
 */
function FoodEntryFormContent({
  editingEntry = null,
  lastConsumedAt = null,
  selectedDate,
  resetToNow = false,
  prefill = null,
  onSaved,
  onCancelEdit,
  onClear,
  tz,
  today,
}: FoodEntryFormProps & { tz: string; today: string }) {
  const isEditing = editingEntry !== null;
  const action = isEditing ? updateFoodEntry : addFoodEntry;
  const [state, formAction] = useActionState(action, initialActionState);
  const idPrefix = useId();

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
  //
  // Known follow-up, NOT fixed here (qa-review N-7, Phase 8d): this `behavior: "smooth"` has the
  // same missing `prefers-reduced-motion` guard `ActionPanel.tsx` was just given -- flagged by
  // qa-reviewer as informational/pre-existing, not required for this phase. Left as-is rather than
  // expanding this fix's scope unprompted; worth picking up alongside any future work that touches
  // this effect.
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
  //
  // Phase 8e (2026-08-08): with the options now partitioned into three <optgroup>s, the injected
  // option must land INSIDE the group that actually contains its hour (`quarterHourGroupIndexFor`)
  // — appending it outside every group, or dropping it, would silently reintroduce the exact
  // time-rewriting bug this invariant exists to prevent (design doc §3.4/§6 Phase 8e).
  const isOnGrid = TIME_OPTIONS.some((option) => option.value === consumedTime);
  const timeOptionGroups = isOnGrid
    ? TIME_OPTION_GROUPS
    : TIME_OPTION_GROUPS.map((group, index) =>
        index === quarterHourGroupIndexFor(consumedTime)
          ? {
              ...group,
              options: [...group.options, { value: consumedTime, label: formatTimeLabel(consumedTime) }].sort(
                (a, b) => a.value.localeCompare(b.value),
              ),
            }
          : group,
      );

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5"
      noValidate
      autoComplete="off"
    >
      {isEditing && <input type="hidden" name="id" value={editingEntry!.id} autoComplete="off" />}
      <input type="hidden" name="consumedTz" value={tz} autoComplete="off" />
      <input type="hidden" name="mode" value={mode} autoComplete="off" />
      {/* When the detail section is collapsed, the visible quantity/unit inputs below aren't
          rendered, but the form must still submit whatever quantity/unit the user (or a lookup
          pick) actually set -- collapsing only hides the inputs, it must never reset the values
          back to the fast-entry default. Bug fixed 2026-07-26 (qa-reviewer B-1): this used to
          hardcode value="1"/value="" here, which silently discarded a picked/typed quantity the
          moment "Hide detail" was clicked after it had been changed. */}
      {!expanded && (
        <>
          <input type="hidden" name="quantity" value={quantity} autoComplete="off" />
          <input type="hidden" name="unit" value={unit} autoComplete="off" />
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
          autoComplete="off"
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
            autoComplete="off"
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
            autoComplete="off"
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
            autoComplete="off"
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
            autoComplete="off"
            value={consumedTime}
            onChange={(e) => setConsumedTime(e.target.value)}
            className={`${inputClass} tabular-nums`}
          >
            {/* Bugfix (2026-08-10): the <optgroup> ELEMENT ITSELF is now dropped entirely, not just
                its `label` text -- the 2026-08-09 fix removed the `label` attribute but kept the
                <optgroup> wrapper, on the belief it left "only a small blank gap between groups".
                Confirmed live (headed Chromium) that this understated it: an <optgroup> with no
                `label` still reserves a full BLANK, non-selectable ROW in the rendered popup --
                visually indistinguishable from a broken/missing option, which is what Jeff flagged
                from a screenshot. Since the visible header text is already gone (superseded, not
                wanted per that same 2026-08-09 call) and de-emphasis is carried entirely by each
                <option>'s own background class below, the <optgroup> grouping itself was providing
                no remaining visual benefit -- only this artifact -- so it's flattened away with
                `.flatMap()` into one flat run of 96 <option>s, identical in effect to
                `quarterHourOptions()`. `quarterHourOptionGroups()`/`group.deEmphasized` are still
                what decide each option's shading; only the DOM structure changed. */}
            {timeOptionGroups.flatMap((group) =>
              group.options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  // Bugfix (2026-08-09): de-emphasis shades the option's BACKGROUND, not its
                  // text color (was `text-stone-500`) -- Jeff's explicit call, reversing the
                  // 2026-08-05 "a background fill was rejected in favour of colour" reasoning in
                  // ai-context/DECISIONS.md. Still presentation-only and still a best-effort
                  // bonus, not the load-bearing mechanism -- unaffected platforms (mobile pickers,
                  // macOS Safari/Chrome, which ignore <option> CSS) simply show all 96 options
                  // undecorated, same as before.
                  className={group.deEmphasized ? "tabular-nums bg-slate-100" : "tabular-nums"}
                >
                  {option.label}
                </option>
              )),
            )}
          </select>
          {state.fieldErrors?.consumedTime && (
            <p className={errorTextClass}>{state.fieldErrors.consumedTime}</p>
          )}
        </div>
      </div>

      {/* Phase 8k: a single `DisclosureButton` (real button chrome + a rotating chevron +
          `aria-expanded`/`aria-controls`) replaces the old pair of bare accent-text links
          ("+ Add detail (quantity, unit)" when collapsed, "Hide detail" — only in add mode — inside
          the expanded box). The trigger now stays rendered while open (toggling it again closes
          it) and always shows the SAME label -- the chevron alone carries the open/closed state,
          the same "trigger stays rendered while open" pattern `FoodLookupPanel`'s own trigger now
          uses. Hidden entirely in edit mode: editing already always shows full detail with no
          toggle at all (there's no ambiguity to progressively disclose once real per-unit values
          already exist) -- unchanged from before this phase. */}
      {!isEditing && (
        <DisclosureButton
          label="Add detail (quantity, unit)"
          open={expanded}
          onToggle={() => setExpanded((prev) => !prev)}
          controls={`${idPrefix}-detail`}
        />
      )}

      {expanded && (
        <div id={`${idPrefix}-detail`} className="flex flex-col gap-3 rounded-lg bg-slate-50 p-3.5">
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
                autoComplete="off"
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
                autoComplete="off"
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
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                autoComplete="off"
                checked={mode === "total"}
                onChange={() => setMode("total")}
                className="h-4 w-4 accent-accent"
              />
              Total for the whole quantity
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                autoComplete="off"
                checked={mode === "perUnit"}
                onChange={() => setMode("perUnit")}
                className="h-4 w-4 accent-accent"
              />
              Per unit
            </label>
          </fieldset>
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

      <div className="flex flex-wrap items-center gap-3 pt-1">
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
