"use client";

import { useState, type FormEvent } from "react";
import { copyFoodEntries } from "@/lib/actions/food";
import { formatTimeLabel, quarterHourOptions } from "@/lib/domain/datetime";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry } from "@/lib/types";

/** Static — the same 96 buckets regardless of date/tz — so it's built once at module scope. */
const TIME_OPTIONS = quarterHourOptions();

export type CopyGroupDialogProps = {
  /** The entries to copy — display-only preview; the action always re-reads these rows from the
   * DB by id (§3.3), so a stale prop here can never cause the wrong copy. Also serves the
   * multi-select "Copy selected" bulk action (Phase 8b) — this prop may span more than one
   * exact-`consumed_at` group in that case, which is exactly what makes multi-select able to do
   * something the three Phase 8 mechanisms can't. */
  entries: FoodEntry[];
  /** Today's local date (`max` for the target-date input). */
  today: string;
  tz: string;
  onCopied: (entries: FoodEntry[], toDate: string) => void;
  onCancel: () => void;
  /** Phase 8b: parameterizes the submit-button label so this one component can serve both
   * "Copy this group" (default) and the multi-select "Copy selected" bulk action, without
   * duplicating the dialog (design doc §3.4 "Both bulk actions reuse the existing dialogs"). */
  submitLabel?: string;
  /** Phase 8b: parameterizes the two "this group" error strings for the same reason — defaults
   * preserve the existing group call site's rendered text byte-for-byte. */
  noEntriesMessage?: string;
  entriesNotFoundMessage?: string;
};

type CopyState = { ok: boolean; error: string | null; entries?: FoodEntry[] };
const initialState: CopyState = { ok: false, error: null };

function friendlyError(
  error: string,
  noEntriesMessage: string,
  entriesNotFoundMessage: string,
): string {
  switch (error) {
    case "no_entries":
      return noEntriesMessage;
    case "entries_not_found":
      return entriesNotFoundMessage;
    case "future_date":
      return "You can't copy to a date later than today. Pick today or an earlier date.";
    case "unauthenticated":
      return "You've been signed out — please log in again.";
    default:
      return "Something went wrong copying this group. Please try again.";
  }
}

/**
 * Inline expander (design doc §3.4 "Group headers offer 'Copy this group'"; Phase 8) that copies an
 * already-logged exact-`consumed_at` meal group onto a target date, via the shared `copyFoodEntries`
 * primitive. This is the second button the Phase 7b group-header action bar was built to hold
 * (alongside "Save as meal") — see `ai-context/DECISIONS.md`'s Phase 7b entry. Phase 8b (2026-08-01)
 * reuses this exact component, parameterized (`submitLabel`/the two message props), for the
 * multi-select "Copy selected" bulk action, rather than a hand-copied twin.
 *
 * **Optional "Copy to time" override (2026-08-01, Finding 4)** — the design doc's §3.4 "Optional
 * time override when copying a group or a selection": a `<select>` of the same 96 quarter-hour
 * values every other time control in this app uses, preceded by a `value=""` "Keep original
 * time(s)" sentinel that is the DEFAULT, so today's behaviour (preserve each source entry's own
 * local time-of-day) is unchanged unless the user deliberately opts in. Deliberately NOT
 * pre-filled with the group's own current time: this control is shared with the multi-select bulk
 * action, where a cross-group selection has no single "current time" to pre-fill, and a rejected
 * pre-fill would silently change default behaviour for that case. Labeled "Copy to time" (not a
 * bare "Time") so it can't collide with `FoodEntryForm`'s own "Time" label on the same `/food` page
 * (`getByLabel("Time")` is used that way in `e2e/phase3-acceptance.spec.ts`).
 */
export function CopyGroupDialog({
  entries,
  today,
  tz,
  onCopied,
  onCancel,
  submitLabel = "Copy group",
  noEntriesMessage = "Nothing to copy — this group has no entries.",
  entriesNotFoundMessage = "Couldn't find those entries — try reopening this group and copying again.",
}: CopyGroupDialogProps) {
  const [toDate, setToDate] = useState(today);
  // "" is the sentinel meaning "no override" — copyFoodEntries already normalizes an empty string
  // exactly as an omitted `toTime` (confirmed against the implementation, §3.3), so no
  // special-casing is needed beyond not passing it through when blank.
  const [toTime, setToTime] = useState("");
  const [state, setState] = useState<CopyState>(initialState);
  const [pending, setPending] = useState(false);

  const distinctInstants = new Set(entries.map((entry) => entry.consumed_at)).size;
  const spansMultipleInstants = distinctInstants > 1;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await copyFoodEntries({
      entryIds: entries.map((entry) => entry.id),
      toDate,
      toTime: toTime || undefined,
      toTz: tz,
    });
    setPending(false);
    setState(result);
    if (result.ok && result.entries) {
      onCopied(result.entries, toDate);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate autoComplete="off">
      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <p className="text-xs font-medium text-stone-500">
          {entries.length} item{entries.length === 1 ? "" : "s"} to copy
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="copy-group-target-date" className={labelClass}>
            Copy to date
          </label>
          <input
            id="copy-group-target-date"
            type="date"
            max={today}
            required
            autoComplete="off"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="copy-group-target-time" className={labelClass}>
            Copy to time
          </label>
          <select
            id="copy-group-target-time"
            autoComplete="off"
            value={toTime}
            onChange={(e) => setToTime(e.target.value)}
            className={`${inputClass} tabular-nums`}
          >
            <option value="">{spansMultipleInstants ? "Keep original times" : "Keep original time"}</option>
            {TIME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="tabular-nums">
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Disclose the grouping consequence ONLY when it can actually differ -- a single-group
          copy produces one group either way, so the note would be vacuous there (§3.4). */}
      {spansMultipleInstants && (
        <p className="text-xs text-stone-500">
          {toTime
            ? `All ${entries.length} entries will be copied to ${formatTimeLabel(toTime)} as a single meal group.`
            : "Each entry keeps its own time of day."}
        </p>
      )}

      {state.error && (
        <p className={errorTextClass}>{friendlyError(state.error, noEntriesMessage, entriesNotFoundMessage)}</p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Copying..." : submitLabel}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
