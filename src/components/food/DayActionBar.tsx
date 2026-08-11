"use client";

import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";

export type DayActionBarProps = {
  /** Whether the currently-viewed day has any entries at all. "Copy this day" and "Select entries"
   * both need something to act on and are hidden without it; "Log a saved meal" doesn't (it's
   * always offered, even on an empty day, per `LogMealDialog`'s own explanatory empty-state
   * contract when the user has zero saved meals). */
  hasEntries: boolean;
  onOpenLogMeal: () => void;
  onOpenCopyDay: () => void;
  onEnterSelectMode: () => void;
};

/**
 * The three `/food` day-level triggers, in one quiet, visually-grouped row (design doc §3.1
 * `food/DayActionBar.tsx`; Phase 8k — "The `/food` day-action surface"). Renders ONLY the three
 * buttons — **no panel of its own, ever**. `FoodDayView` renders whichever panel is open (if any)
 * as a SIBLING directly beneath this component, never as this component's own child, which is
 * exactly what makes "the trigger row never splits, whichever panel is open" a structural property
 * rather than a layout hint that has to keep being correct — see
 * `ai-context/DECISIONS.md`'s "The `/food` day-action surface..." entry for the bug this replaces
 * (two of the three former triggers — `LogMealDialog` picker mode and `CopyDayDialog` — each used
 * to render their own trigger AND their own open panel from the same position in a shared
 * `flex flex-wrap` row, so opening one turned that flex item full-width and wrapped every sibling
 * trigger *after* it onto a line below the open panel).
 *
 * **Visually grouped, deliberately NOT accented** — `rounded-xl border border-line bg-white
 * shadow-sm`, the decorative-container neutral (`--line`) per Phase 8i's standing rule, not the
 * `ActionPanel` accent vocabulary. The emphasis ladder's levels all mean "something is happening or
 * waiting for you"; this row is on screen every second of every visit to `/food`, so accenting it
 * permanently would say nothing — the same "a treatment applied everywhere carries no information"
 * test that keeps `ActionPanel` off `FoodEntryForm`.
 *
 * **No `role="toolbar"`, no group `aria-label`.** `role="toolbar"` promises a roving-tabindex
 * arrow-key keyboard contract this codebase has no pattern for — declaring the role without
 * implementing it announces a widget whose expected keys don't work, worse than no role at all. A
 * group `aria-label` would add another accessible-name string to a page with this project's worst
 * `getByLabel`/`getByRole` locator-collision history (four separate documented instances — see
 * `ai-context/DECISIONS.md`'s "Copy to time does not avoid a Playwright `getByLabel` collision..."
 * entry and its addenda) for no benefit over three plainly-labelled buttons. This is a purely
 * VISUAL grouping; the ARIA tree is unaffected.
 *
 * **Each trigger carries a supplementary `Tooltip`** that explains rather than repeats, per the
 * recorded rule that a tooltip is never the sole source of a control's meaning. "Select entries"'s
 * tooltip is the actual answer to the complaint that the button reads as disconnected from what it
 * acts on — it names the target ("the day's log below") in words, on the control itself; the
 * `ActionPanel`'s own scroll-into-view (once select mode opens) answers the same complaint by
 * behaviour.
 *
 * **Hidden entirely while `selectMode` is true** — the caller conditionally renders this component
 * only outside select mode, per the design's "'Select entries' and the other two triggers are
 * mutually exclusive states of the same bar" rule: entering select mode replaces this whole row
 * with the select-mode `ActionPanel`, rather than leaving "Log a saved meal"/"Copy this day" live
 * alongside a day panel that select mode's own entry already closes.
 */
export function DayActionBar({
  hasEntries,
  onOpenLogMeal,
  onOpenCopyDay,
  onEnterSelectMode,
}: DayActionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-2 shadow-sm">
      <Tooltip text="Add a saved meal's items to this day, at a time you pick.">
        <Button type="button" variant="secondary" onClick={onOpenLogMeal}>
          Log a saved meal
        </Button>
      </Tooltip>
      {hasEntries && (
        <Tooltip text="Copy every entry on this day to another date.">
          <Button type="button" variant="secondary" onClick={onOpenCopyDay}>
            Copy this day
          </Button>
        </Tooltip>
      )}
      {hasEntries && (
        <Tooltip text="Tick individual entries in the day's log below, then copy them or save them as a meal.">
          <Button type="button" variant="secondary" onClick={onEnterSelectMode}>
            Select entries
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
