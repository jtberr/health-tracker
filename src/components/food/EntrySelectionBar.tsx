"use client";

import { Button } from "@/components/ui/Button";

export type EntrySelectionBarProps = {
  /** The EFFECTIVE selected count -- already intersected against the currently loaded entries by
   * the caller (`FoodDayView`), so a stale id that vanished out-of-band never inflates this number
   * (design doc §3.4 "the effective selection is derived by intersecting..."). */
  selectedCount: number;
  onCopySelected: () => void;
  onSaveSelectedAsMeal: () => void;
  /** Deselects everything but stays in select mode. */
  onClear: () => void;
  /** Exits select mode entirely. */
  onDone: () => void;
};

/**
 * "N selected" + the two bulk-action triggers + Clear/Done (design doc §3.1
 * `food/EntrySelectionBar.tsx`; Phase 8b "Multi-select bulk actions on the day's log"). Rendered by
 * `FoodDayView` directly above `FoodEntryList`, hoisted structurally above the loading/error
 * branch so a background refresh can never unmount it (§3.4) -- deliberately NOT sticky/floating
 * (this codebase has no sticky-toolbar pattern anywhere; see §4).
 *
 * Both bulk actions are `disabled` at N=0 so the affordance stays discoverable and its own
 * enablement explains the precondition, rather than hiding the buttons outright.
 */
export function EntrySelectionBar({
  selectedCount,
  onCopySelected,
  onSaveSelectedAsMeal,
  onClear,
  onDone,
}: EntrySelectionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-medium text-ink">
        {selectedCount} selected
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCopySelected} disabled={selectedCount === 0}>
          Copy selected
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onSaveSelectedAsMeal}
          disabled={selectedCount === 0}
        >
          Save selected as a meal
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onClear}>
          Clear
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
