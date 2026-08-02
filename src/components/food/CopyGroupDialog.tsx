"use client";

import { useState, type FormEvent } from "react";
import { copyFoodEntries } from "@/lib/actions/food";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry } from "@/lib/types";

export type CopyGroupDialogProps = {
  /** The exact-`consumed_at` group's entries — display-only preview; the action always re-reads
   * these rows from the DB by id (§3.3), so a stale prop here can never cause the wrong copy. */
  entries: FoodEntry[];
  /** Today's local date (`max` for the target-date input). */
  today: string;
  tz: string;
  onCopied: (entries: FoodEntry[], toDate: string) => void;
  onCancel: () => void;
};

type CopyState = { ok: boolean; error: string | null; entries?: FoodEntry[] };
const initialState: CopyState = { ok: false, error: null };

function friendlyError(error: string): string {
  switch (error) {
    case "no_entries":
      return "Nothing to copy — this group has no entries.";
    case "entries_not_found":
      return "Couldn't find those entries — try reopening this group and copying again.";
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
 * (alongside "Save as meal") — see `ai-context/DECISIONS.md`'s Phase 7b entry.
 *
 * No time field: `toTime` is left unset, so `copyFoodEntries` preserves each entry's own source
 * local time-of-day — since every entry in a group shares the identical source `consumed_at` by
 * definition, they all land on the same new instant and **stay grouped** on the target day
 * (design doc §3.3/§6 "Copy a meal group = exact subset").
 */
export function CopyGroupDialog({ entries, today, tz, onCopied, onCancel }: CopyGroupDialogProps) {
  const [toDate, setToDate] = useState(today);
  const [state, setState] = useState<CopyState>(initialState);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await copyFoodEntries({
      entryIds: entries.map((entry) => entry.id),
      toDate,
      toTz: tz,
    });
    setPending(false);
    setState(result);
    if (result.ok && result.entries) {
      onCopied(result.entries, toDate);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
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

      <div className="flex flex-col gap-1">
        <label htmlFor="copy-group-target-date" className={labelClass}>
          Copy to date
        </label>
        <input
          id="copy-group-target-date"
          type="date"
          max={today}
          required
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className={inputClass}
        />
      </div>

      {state.error && <p className={errorTextClass}>{friendlyError(state.error)}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Copying..." : "Copy group"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
