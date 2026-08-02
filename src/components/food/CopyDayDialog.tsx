"use client";

import { useState, type FormEvent } from "react";
import { copyFoodEntries } from "@/lib/actions/food";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { FoodEntry } from "@/lib/types";

export type CopyDayDialogProps = {
  /** The day currently being viewed on `/food` — the source of the copy. */
  sourceDate: string;
  /** That day's entries — display-only (the action always re-reads them from the DB by id, §3.3). */
  entries: FoodEntry[];
  /** Today's local date (`max` for the target-date input) — same no-future-day cap as everywhere else. */
  today: string;
  tz: string;
  onCopied: (entries: FoodEntry[], toDate: string) => void;
};

type CopyState = { ok: boolean; error: string | null; entries?: FoodEntry[] };
const initialState: CopyState = { ok: false, error: null };

function friendlyError(error: string): string {
  switch (error) {
    case "no_entries":
      return "There's nothing on this day to copy.";
    case "entries_not_found":
      return "Couldn't find those entries — try reloading the page and copying again.";
    case "future_date":
      return "You can't copy to a date later than today. Pick today or an earlier date.";
    case "unauthenticated":
      return "You've been signed out — please log in again.";
    default:
      // Never echo an unrecognized code or a raw Postgres error string verbatim to the UI (same
      // posture as SaveGroupAsMealDialog's friendlyError, qa-review N-1).
      return "Something went wrong copying this day. Please try again.";
  }
}

/**
 * Inline expander (design doc §3.1 `food/CopyDayDialog.tsx`; Phase 8 — "Ease-of-entry extras") that
 * copies every entry from the currently-viewed day onto a different (or the same) target date, via
 * the shared `copyFoodEntries` primitive. Same idiom as `LogMealDialog`/`SaveGroupAsMealDialog` —
 * this codebase has no modal precedent, so a single feature isn't the place to introduce one.
 *
 * No time field: `toTime` is deliberately left unset, so `copyFoodEntries` preserves each source
 * entry's own local time-of-day on the target date — a copied whole day reproduces its original
 * rhythm rather than collapsing onto one instant (design doc §3.3/§4, "Copies preserve each source
 * entry's local time-of-day when copying a whole day").
 *
 * Hidden entirely when there is nothing to copy (`entries.length === 0`) — mirrors how
 * `LogMealDialog` still renders (with an explanatory message) even with zero saved meals, but here
 * there's no action at all to offer, so there's nothing useful to show.
 */
export function CopyDayDialog({ sourceDate, entries, today, tz, onCopied }: CopyDayDialogProps) {
  const [open, setOpen] = useState(false);
  const [toDate, setToDate] = useState(today);
  const [state, setState] = useState<CopyState>(initialState);
  const [pending, setPending] = useState(false);

  // copyFoodEntries takes a plain object, not FormData (design doc §3.3's exact signature) — so
  // this is a plain async handler, not a `useActionState`-driven `<form action>` like
  // LogMealDialog/SaveGroupAsMealDialog (both of which call FormData-shaped Server Actions).
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
      setOpen(false);
      onCopied(result.entries, toDate);
    }
  }

  if (entries.length === 0) {
    return null;
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="self-start">
        Copy this day
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Copy this day</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-stone-500 hover:text-stone-700"
        >
          Close
        </button>
      </div>

      <p className="text-sm text-stone-500">
        Copies all {entries.length} entr{entries.length === 1 ? "y" : "ies"} from{" "}
        <span className="font-medium text-ink">{sourceDate}</span> onto another date, keeping each
        entry&apos;s original time of day.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="copy-day-target-date" className={labelClass}>
            Copy to date
          </label>
          <input
            id="copy-day-target-date"
            type="date"
            max={today}
            required
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={inputClass}
          />
        </div>

        {state.error && <p className={errorTextClass}>{friendlyError(state.error)}</p>}

        <div className="pt-1">
          <Button type="submit" disabled={pending}>
            {pending ? "Copying..." : "Copy day"}
          </Button>
        </div>
      </form>
    </div>
  );
}
