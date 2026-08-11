"use client";

import { useState, type FormEvent } from "react";
import { copyFoodEntries } from "@/lib/actions/food";
import { formatDateLabel } from "@/lib/domain/datetime";
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
  /** Phase 8k: the caller (`FoodDayView`, via `DayActionBar` + its own `dayAction` state) owns the
   * trigger AND the open/closed state — this component is panel-only in every mode now, mounted
   * fresh only while the caller wants it shown. */
  onCancel: () => void;
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
 * Panel-only content (design doc §3.1 `food/CopyDayDialog.tsx`; Phase 8 — "Ease-of-entry extras";
 * restructured Phase 8k — "The `/food` day-action surface") that copies every entry from the
 * currently-viewed day onto a different (or the same) target date, via the shared
 * `copyFoodEntries` primitive.
 *
 * **Phase 8k: this component no longer renders its own trigger or owns its own `open` state.**
 * `FoodDayView` renders the "Copy this day" trigger (inside `DayActionBar`) and this panel body as
 * two SIBLINGS — never from inside one another — so a component that used to lay out its siblings
 * from the inside (opening this used to turn its flex item into a full-width block, wrapping every
 * trigger *after* it onto a line below the open panel) can no longer do that: there is no "inside"
 * to lay siblings out from anymore. `FoodDayView` conditionally renders
 * `<CopyDayDialog .../>` only while its own `dayAction === "copyDay"` and wraps it in `ActionPanel`
 * itself (the same shape `CopyGroupDialog`/`SaveGroupAsMealDialog` have had since Phase 7b/8, and
 * the shape `LogMealDialog`'s own Phase 8c fixed-meal mode already used, with `MealList` owning
 * visibility there). The now-removed `w-full` wrapper on this component's old collapsed-panel
 * branch — and the internal `open` state / `CopyDayPanel` split it needed to fix the N-3
 * stale-error-on-reopen bug — were both the visible scar tissue of the old, fused shape; deleting
 * them (rather than adding a smarter layout hint) is the fix, per `ai-context/DECISIONS.md`'s
 * "The `/food` day-action surface..." entry.
 *
 * **The N-3 "no stale state survives a close/reopen" property still holds, and now holds
 * structurally rather than via an internal open/close split**: `FoodDayView`'s `dayAction` changes
 * only from the user's own clicks (never from `loading`, a fetch nonce, or `entries.length`), so
 * this component mounts fresh every single time it's shown — there is no way for `toDate`/`state`/
 * `pending` to survive a close/reopen, because there is no instance left to survive in.
 *
 * No time field: `toTime` is deliberately left unset, so `copyFoodEntries` preserves each source
 * entry's own local time-of-day on the target date — a copied whole day reproduces its original
 * rhythm rather than collapsing onto one instant (design doc §3.3/§4, "Copies preserve each source
 * entry's local time-of-day when copying a whole day"). Deliberately does NOT get Phase 8b's
 * "Copy to time" override (§3.4): a single override would collapse the whole day onto one instant,
 * defeating the entire point of a whole-day copy — a user who wants "some of today's entries, at
 * one new time" already has multi-select + "Copy selected" for that.
 *
 * **Defensive empty-day fallback**: `DayActionBar` never offers the "Copy this day" trigger on a
 * day with nothing to copy (`hasEntries`), but if the viewed day's last entry is deleted
 * out-of-band while this panel happens to already be open, this renders an explanation instead of
 * a form with nothing meaningful to submit, rather than silently submitting an empty entryIds list.
 */
export function CopyDayDialog({ sourceDate, entries, today, tz, onCopied, onCancel }: CopyDayDialogProps) {
  const [toDate, setToDate] = useState(today);
  const [state, setState] = useState<CopyState>(initialState);
  const [pending, setPending] = useState(false);

  if (entries.length === 0) {
    return (
      <>
        <p className="text-sm text-muted">There&apos;s nothing on this day to copy.</p>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} className="self-start">
          Close
        </Button>
      </>
    );
  }

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
      onCopied(result.entries, toDate);
    }
  }

  return (
    <>
      {/* Bugfix (2026-08-10): a real missing-space defect, confirmed live -- the rendered text
          read "...08/10/2026onto another date...", the space glued away. The literal space
          character written after `</span>` on this same source line does NOT survive JSX's
          whitespace handling once the text node it belongs to wraps onto a following source
          line (as "onto another" did onto the old "date, keeping..." line): JSX trims the
          leading whitespace of a multi-line JSXText node as a whole, the same reason `from{" "}`
          just above needs its own explicit space container. Fixed the same way -- an explicit
          `{" "}` right after the date `<span>`, and the remaining sentence collapsed onto one
          source line so there is no second multi-line JSXText node left to repeat the bug. */}
      <p className="text-sm text-muted">
        Copies all {entries.length} entr{entries.length === 1 ? "y" : "ies"} from{" "}
        <span className="font-medium text-ink">{formatDateLabel(sourceDate)}</span>{" "}
        onto another date, keeping each entry&apos;s original time of day.
      </p>

      {/* qa-review N-3 (Phase 8d): "Close" sits next to the primary action (not a top-corner link),
          matching the Cancel-next-to-Submit placement CopyGroupDialog/SaveGroupAsMealDialog already
          use -- the date input is the first focusable control in this panel. */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate autoComplete="off">
        <div className="flex flex-col gap-1">
          <label htmlFor="copy-day-target-date" className={labelClass}>
            Copy to date
          </label>
          <input
            id="copy-day-target-date"
            type="date"
            max={today}
            required
            autoComplete="off"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={inputClass}
          />
        </div>

        {state.error && <p className={errorTextClass}>{friendlyError(state.error)}</p>}

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={pending}>
            {pending ? "Copying..." : "Copy day"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Close
          </Button>
        </div>
      </form>
    </>
  );
}
