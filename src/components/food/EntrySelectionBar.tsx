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
  /** Phase 8k: true while a bulk form ("Copy selected"/"Save selected as a meal") is open beneath
   * this bar, inside the same `ActionPanel` -- collapses the bar to just its "N selected" count and
   * hides its four buttons. This is not a new rule: it is *a surface in a special state yields its
   * ordinary actions to whatever now owns them*, the same rule the editing row, select mode itself,
   * and the active group already follow. Ticking/unticking entries stays live regardless -- the
   * checkboxes live in the list, not in this bar, so this suppression never touches them. */
  bulkFormOpen?: boolean;
};

/**
 * "N selected" + the two bulk-action triggers + Clear/Done (design doc §3.1
 * `food/EntrySelectionBar.tsx`; Phase 8b "Multi-select bulk actions on the day's log"). Rendered by
 * `FoodDayView` INSIDE one shared `ActionPanel` for the whole of select mode (Phase 8k) -- this
 * component no longer carries its own card-like chrome (`ActionPanel` already supplies the
 * region/ring/fill); it is now just the bar's own row of text + buttons. Hoisted, together with
 * that `ActionPanel`, structurally above the loading/error branch below `FoodDayView`'s entry list,
 * so a background refresh can never unmount it (§3.4) -- deliberately NOT sticky/floating (this
 * codebase has no sticky-toolbar pattern anywhere; see §4).
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
  bulkFormOpen = false,
}: EntrySelectionBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm font-medium text-ink">{selectedCount} selected</p>
      {!bulkFormOpen && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCopySelected}
            disabled={selectedCount === 0}
          >
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
      )}
    </div>
  );
}
