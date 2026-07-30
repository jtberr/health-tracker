"use client";

import { useState } from "react";
import { groupByConsumedAt } from "@/lib/domain/entry-grouping";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { sumEntries } from "@/lib/domain/totals";
import { formatTimeLabel, utcToLocalTime } from "@/lib/domain/datetime";
import { roundTo } from "@/lib/domain/units";
import { Button } from "@/components/ui/Button";
import { SaveGroupAsMealDialog } from "./SaveGroupAsMealDialog";
import type { FoodEntry, Meal } from "@/lib/types";

/**
 * Renders a day's food entries grouped by exact-`consumed_at` meal groups (§3.4 "FoodEntryList").
 * Each group header shows the group's local time-of-day and its ratio-of-sums protein %; each
 * entry row shows its own per-entry protein %. Edit/delete are delegated to the caller (which
 * owns the mutation + refetch).
 *
 * **Group header is a small action bar** (Phase 7b, design doc §3.4): "Save as meal" opens an
 * inline `SaveGroupAsMealDialog` expander for that group (this is the slot Phase 8's "Copy this
 * group" will later add a second button to). This is the first time this component holds real
 * local UI state (`savingGroupKey` — which group's expander, if any, is open) — see
 * `FoodDayView.tsx`'s `hasLoadedOnce` fix, a required prerequisite so a background refresh
 * triggered elsewhere on the page never unmounts this component mid-typing.
 */
export function FoodEntryList({
  entries,
  onEdit,
  onDelete,
  onGroupSavedAsMeal,
}: {
  entries: FoodEntry[];
  onEdit: (entry: FoodEntry) => void;
  onDelete: (entry: FoodEntry) => void;
  /** Fired after `createMealFromEntries` succeeds for a group. Optional — a caller that doesn't
   * care about surfacing a confirmation (there's nothing on this screen to refetch; the operation
   * is read-only on `food_entries`, per §3.3) can simply omit it. */
  onGroupSavedAsMeal?: (meal: Meal) => void;
}) {
  const [savingGroupKey, setSavingGroupKey] = useState<string | null>(null);
  const groups = groupByConsumedAt(entries);

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
        No entries logged for this day yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const tz = group.entries[0].consumed_tz;
        const { time } = utcToLocalTime(group.consumedAt, tz);
        const groupTotals = sumEntries(group.entries);
        const groupPct = proteinCaloriePct(groupTotals.proteinG, groupTotals.calories);
        const isSaving = savingGroupKey === group.consumedAt;

        return (
          <section
            key={group.consumedAt}
            className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-stone-700">{formatTimeLabel(time)}</span>
                <span className="text-sm text-stone-500">
                  {/* Summing protein_g in JS (float addition, e.g. 1.98 + 1.98 + 1.98) can produce
                      trailing-digit noise like 5.9399999999999995 -- round only for display; the
                      unrounded sum still feeds groupPct's ratio-of-sums math above. */}
                  {groupTotals.calories} kcal · {roundTo(groupTotals.proteinG, 2)}g protein
                  {groupPct !== null && ` · ${groupPct}% from protein`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setSavingGroupKey(isSaving ? null : group.consumedAt)}
                >
                  {isSaving ? "Cancel" : "Save as meal"}
                </Button>
              </div>
            </header>
            {isSaving && (
              <div className="border-b border-stone-100 bg-white px-4 py-3">
                <SaveGroupAsMealDialog
                  entries={group.entries}
                  onSaved={(meal) => {
                    setSavingGroupKey(null);
                    onGroupSavedAsMeal?.(meal);
                  }}
                  onCancel={() => setSavingGroupKey(null)}
                />
              </div>
            )}
            <ul className="divide-y divide-stone-100">
              {group.entries.map((entry) => {
                const entryPct = proteinCaloriePct(entry.protein_g, entry.calories);
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-stone-50/70"
                  >
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {entry.quantity !== 1 || entry.unit
                          ? `${entry.quantity}${entry.unit ? ` ${entry.unit}` : "x"} — ${entry.name}`
                          : entry.name}
                        {/* Meal-batch rows (Phase 7): `logMealForDay` shares one `consumed_at`
                            per batch and stamps `logged_from_meal_id` on every row it writes —
                            labeled here per design doc §3.4 "Meal-batch rows ... are labeled". */}
                        {entry.logged_from_meal_id !== null && (
                          <span className="inline-flex items-center rounded-full bg-sage-pale px-2 py-0.5 text-xs font-medium text-ink">
                            From a saved meal
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-stone-500">
                        {entry.calories} kcal · {entry.protein_g}g protein
                        {entryPct !== null ? ` · ${entryPct}%` : " · —"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(entry)}>
                        Edit
                      </Button>
                      <Button type="button" variant="danger" size="sm" onClick={() => onDelete(entry)}>
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
