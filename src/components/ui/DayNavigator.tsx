"use client";

import { shiftIsoDate } from "@/lib/domain/datetime";
import { Tooltip } from "@/components/ui/Tooltip";
import { labelClass } from "@/components/ui/styles";

export type DayNavigatorProps = {
  /** `id` for the underlying date `<input>` (and its `<label htmlFor>`) — the caller supplies it so
   * `/food` and `/metrics` keep their own distinct, pre-existing ids (`food-day` / `metric-day`). */
  id: string;
  /** The currently-viewed local date, YYYY-MM-DD. */
  value: string;
  /** "Today" in the SAME local calendar this control's `max`/disabled rule must agree with — always
   * the caller's own `today`, never re-derived here (design doc §3.4: "must compare against the
   * SAME today value the input's own max uses — never a separately-derived one"). */
  today: string;
  /** Fired with the new date on any of the three ways to change it (Previous, the date input, or
   * Next). Callers on `/food` MUST wire this to the existing `handleDayChange` choke point (which
   * also resets `lastConsumedAt`/`editingEntry`/the selection) rather than `setSelectedDate`
   * directly — a navigator wired straight to `setSelectedDate` would silently resurrect the
   * stale-selection hazard that choke point exists to prevent (§3.4/§6). `/metrics` has no
   * equivalent choke point to bypass, so it wires this straight to its own `setSelectedDate`. */
  onChange: (date: string) => void;
};

/**
 * A compact pill: `‹` / the existing date `<input type="date" max={today}>` / `›` — one shared
 * control for `/food` (`FoodDayView`) and `/metrics` (`MetricForm`), design doc §3.4 "Previous /
 * Next day navigation". Owns no state of its own.
 *
 * **Icon-only chevrons (2026-08-10 amendment — Jeff's direct request, see
 * `ai-context/DECISIONS.md`), superseding the original Phase 8d full-text "Previous day"/"Next
 * day" buttons.** Those read as two oversized controls flanking a tiny date field; a small `‹`/`›`
 * either side of the input, inside one bordered pill, is the same three-part layout at the density
 * this control was always meant to have. The accessible name now comes entirely from `aria-label`,
 * matching the exact word the visible label used to say ("Previous day"/"Next day", never
 * paraphrased) — the same rule this project already applies to `FoodEntryList`/`MealList`'s
 * icon-only row actions and reorder arrows (2026-08-07, "Icons replace buttons+text entirely"),
 * and each chevron keeps a supplementary pointer-only `Tooltip` for the same reason those do.
 *
 * **Exactly two buttons, no "Today" control** (Jeff's call, 2026-08-05 — see
 * `ai-context/DECISIONS.md`): a third control on this row lost out to density, and the date input
 * already reaches today in one interaction.
 *
 * **"Next day" is `disabled`, not hidden, when the viewed day is already `today`** — the same call
 * `EntrySelectionBar` makes for its N=0 bulk buttons and `MealList` makes for its item ↑/↓ arrows
 * at the ends of a list: a control that vanishes teaches nothing, a disabled one shows the boundary
 * exists. This is the one place this control could create a state the rest of the app forbids, so
 * it compares against the exact same `today` prop the input's own `max` uses.
 *
 * **"Previous" has no lower bound** — there is no "earliest entry" concept anywhere in this app,
 * and viewing an empty past day is already a well-defined, harmless state.
 *
 * **This is NOT a fix for the documented `Day`-input race** (`ai-context/PROGRESS.md`, ten
 * reproducing e2e cases) and must never be recorded as one — these buttons change the day via a
 * plain `onClick`, with no native-input round-trip, so tests driven through them are unlikely to
 * hit that flake, but the input itself remains and the underlying bug stays open (§3.4/§5).
 *
 * **Both buttons are `disabled` when `value` isn't a valid `YYYY-MM-DD` date (qa-review N-5,
 * Phase 8d).** The native date input can be left empty (the user clears it, or is mid-typing a new
 * value), and `shiftIsoDate` deliberately returns malformed/empty input UNCHANGED rather than
 * throwing (§3.3) — so without this guard, `value >= today` on an empty string is simply `false`,
 * silently leaving "Next day" enabled, and clicking either button becomes a no-op that presents as
 * a working control. Disabling both when there's no valid date to shift FROM is the honest
 * reflection of that state, consistent with this component's own "disabled, not hidden" rule.
 */
export function DayNavigator({ id, value, today, onChange }: DayNavigatorProps) {
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isOnOrAfterToday = !isValidDate || value >= today;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className={labelClass}>
        Day
      </label>
      <div className="inline-flex items-center gap-0.5 rounded-full border border-line bg-white py-1 pl-1 pr-1 shadow-sm">
        <Tooltip text="Go to the previous day.">
          <button
            type="button"
            aria-label="Previous day"
            disabled={!isValidDate}
            onClick={() => onChange(shiftIsoDate(value, -1))}
            className="rounded-full p-1.5 text-muted hover:bg-slate-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">‹</span>
          </button>
        </Tooltip>
        <input
          id={id}
          type="date"
          max={today}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="rounded-full border-0 bg-transparent px-1 py-0.5 text-sm font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Tooltip text="Go to the next day.">
          <button
            type="button"
            aria-label="Next day"
            disabled={isOnOrAfterToday}
            onClick={() => onChange(shiftIsoDate(value, 1))}
            className="rounded-full p-1.5 text-muted hover:bg-slate-100 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">›</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
