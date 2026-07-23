"use client";

import { groupByConsumedAt } from "@/lib/domain/entry-grouping";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { sumEntries } from "@/lib/domain/totals";
import { utcToLocalTime } from "@/lib/domain/datetime";
import type { FoodEntry } from "@/lib/types";

/**
 * Renders a day's food entries grouped by exact-`consumed_at` meal groups (§3.4 "FoodEntryList").
 * Each group header shows the group's local time-of-day and its ratio-of-sums protein %; each
 * entry row shows its own per-entry protein %. Edit/delete are delegated to the caller (which
 * owns the mutation + refetch).
 */
export function FoodEntryList({
  entries,
  onEdit,
  onDelete,
}: {
  entries: FoodEntry[];
  onEdit: (entry: FoodEntry) => void;
  onDelete: (entry: FoodEntry) => void;
}) {
  const groups = groupByConsumedAt(entries);

  if (groups.length === 0) {
    return <p className="text-sm text-zinc-500">No entries logged for this day yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const tz = group.entries[0].consumed_tz;
        const { time } = utcToLocalTime(group.consumedAt, tz);
        const groupTotals = sumEntries(group.entries);
        const groupPct = proteinCaloriePct(groupTotals.proteinG, groupTotals.calories);

        return (
          <section key={group.consumedAt} className="rounded-md border border-zinc-200">
            <header className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-2">
              <span className="text-sm font-medium text-zinc-700">{time}</span>
              <span className="text-sm text-zinc-500">
                {groupTotals.calories} kcal · {groupTotals.proteinG}g protein
                {groupPct !== null && ` · ${groupPct}% from protein`}
              </span>
            </header>
            <ul className="divide-y divide-zinc-100">
              {group.entries.map((entry) => {
                const entryPct = proteinCaloriePct(entry.protein_g, entry.calories);
                return (
                  <li key={entry.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">
                        {entry.quantity !== 1 || entry.unit
                          ? `${entry.quantity}${entry.unit ? ` ${entry.unit}` : "x"} — ${entry.name}`
                          : entry.name}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {entry.calories} kcal · {entry.protein_g}g protein
                        {entryPct !== null ? ` · ${entryPct}%` : " · —"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEdit(entry)}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(entry)}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
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
