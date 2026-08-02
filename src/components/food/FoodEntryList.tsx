"use client";

import { useEffect, useState } from "react";
import { groupByConsumedAt } from "@/lib/domain/entry-grouping";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { sumEntries } from "@/lib/domain/totals";
import { formatTimeLabel, utcToLocalTime } from "@/lib/domain/datetime";
import { roundTo } from "@/lib/domain/units";
import { Button } from "@/components/ui/Button";
import { CopyGroupDialog } from "./CopyGroupDialog";
import { SaveGroupAsMealDialog } from "./SaveGroupAsMealDialog";
import type { FoodEntry, Meal } from "@/lib/types";

/** Which group action, if any, is currently open — mutually exclusive per group (see below). */
type GroupAction = { key: string; kind: "save" | "copy" } | null;

/** The rendered label for an entry row -- shared by the visible text and the checkbox's aria-label. */
function entryDisplayLabel(entry: FoodEntry): string {
  return entry.quantity !== 1 || entry.unit
    ? `${entry.quantity}${entry.unit ? ` ${entry.unit}` : "x"} — ${entry.name}`
    : entry.name;
}

/**
 * Renders a day's food entries grouped by exact-`consumed_at` meal groups (§3.4 "FoodEntryList").
 * Each group header shows the group's local time-of-day and its ratio-of-sums protein %; each
 * entry row shows its own per-entry protein % plus a one-tap "Log again" (Phase 8 — "Ease-of-entry
 * extras (copy/repeat)"). Edit/delete are delegated to the caller (which owns the mutation +
 * refetch).
 *
 * **Group header is a small action bar** (Phase 7b built the slot; Phase 8 adds the second
 * button): "Save as meal" opens an inline `SaveGroupAsMealDialog` expander; "Copy this group" opens
 * an inline `CopyGroupDialog` expander. Only one expander per group can be open at a time
 * (`groupAction` tracks which group + which kind) — this is real local UI state, which is exactly
 * why `FoodDayView.tsx`'s `hasLoadedOnce` fix (Phase 7b) matters: a background refresh triggered
 * elsewhere on the page must never unmount this component mid-typing/mid-picking-a-date.
 *
 * **Multi-select mode (Phase 8b, 2026-08-01)** — an explicit mode, not always-visible checkboxes
 * (design doc §3.4/§4): while `selectMode` is true, every per-row ("Log again"/"Edit"/"Delete") and
 * per-group ("Save as meal"/"Copy this group") action is hidden and a checkbox appears on every
 * row instead. Entering select mode closes any open group expander. A checked row gets NO
 * background tint of its own -- the checkbox alone is the indicator, so it never collides with the
 * editing-row highlight below (both are per-row visual states in the same list).
 *
 * **Editing-row highlight (Phase 8b, 2026-08-01)** — `editingEntryId` is the ID of the entry
 * currently open in the edit form above (or `null`), NOT the entry object: `refresh()` replaces
 * every object in `entries` with a fresh row from the DB while the caller's `editingEntry` state
 * still holds the pre-refresh snapshot, so an object-identity comparison would silently stop
 * matching after the first background refresh — comparing ids is the only comparison that can't
 * develop that bug. The matching row gets a left accent bar + an "Editing" label (no background
 * fill — this list already uses a `bg-sage-pale` "From a saved meal" badge, which would vanish on a
 * sage-pale row) and hides its own "Log again"/"Edit"/"Delete" (each is either meaningless or
 * actively wrong while that row's edit form is open — see ai-context/DECISIONS.md's "Sixth
 * manual-testing finding..."). Editing and select mode can coexist: entering select mode does not
 * cancel an in-progress edit, and the edited row can still carry a checkbox alongside its highlight.
 */
export function FoodEntryList({
  entries,
  today,
  tz,
  onEdit,
  onDelete,
  onLogAgain,
  onGroupSavedAsMeal,
  onGroupCopied,
  editingEntryId = null,
  selectMode = false,
  selectedIds,
  onToggleSelected,
}: {
  entries: FoodEntry[];
  /** Today's local date — "Log again"/"Copy this group" cap their target date here. */
  today: string;
  tz: string;
  onEdit: (entry: FoodEntry) => void;
  onDelete: (entry: FoodEntry) => void;
  /** Fired when a single entry's "Log again" (`copyFoodEntries`) succeeds. */
  onLogAgain: (entry: FoodEntry) => Promise<void> | void;
  /** Fired after `createMealFromEntries` succeeds for a group. Optional — a caller that doesn't
   * care about surfacing a confirmation (there's nothing on this screen to refetch; the operation
   * is read-only on `food_entries`, per §3.3) can simply omit it. */
  onGroupSavedAsMeal?: (meal: Meal) => void;
  /** Fired after `copyFoodEntries` succeeds for a whole group. */
  onGroupCopied?: (entries: FoodEntry[], toDate: string) => void;
  /** Phase 8b: the id (NOT the entry object — see the file doc comment) of the entry currently
   * being edited, or null. */
  editingEntryId?: string | null;
  /** Phase 8b: multi-select mode. */
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
}) {
  const [groupAction, setGroupAction] = useState<GroupAction>(null);
  const [logAgainPendingId, setLogAgainPendingId] = useState<string | null>(null);
  const groups = groupByConsumedAt(entries);

  // Entering select mode closes any open group expander (design doc §3.4: "entering select mode
  // closes any open group expander") — select mode is a *mode*: while it's on, the only thing the
  // list does is select.
  useEffect(() => {
    if (selectMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGroupAction(null);
    }
  }, [selectMode]);

  async function handleLogAgain(entry: FoodEntry) {
    setLogAgainPendingId(entry.id);
    try {
      await onLogAgain(entry);
    } finally {
      setLogAgainPendingId(null);
    }
  }

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
        const groupTz = group.entries[0].consumed_tz;
        const { time } = utcToLocalTime(group.consumedAt, groupTz);
        const groupTotals = sumEntries(group.entries);
        const groupPct = proteinCaloriePct(groupTotals.proteinG, groupTotals.calories);
        const isSaving = groupAction?.key === group.consumedAt && groupAction.kind === "save";
        const isCopying = groupAction?.key === group.consumedAt && groupAction.kind === "copy";

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
              {/* Phase 8b: per-group actions are hidden entirely in select mode -- two live copy
                  affordances (this and "Copy selected") at once is the exact ambiguity select mode
                  exists to prevent (design doc §3.4/§4). */}
              {!selectMode && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setGroupAction(isSaving ? null : { key: group.consumedAt, kind: "save" })
                    }
                  >
                    {isSaving ? "Cancel" : "Save as meal"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setGroupAction(isCopying ? null : { key: group.consumedAt, kind: "copy" })
                    }
                  >
                    {isCopying ? "Cancel" : "Copy this group"}
                  </Button>
                </div>
              )}
            </header>
            {isSaving && !selectMode && (
              <div className="border-b border-stone-100 bg-white px-4 py-3">
                <SaveGroupAsMealDialog
                  entries={group.entries}
                  onSaved={(meal) => {
                    setGroupAction(null);
                    onGroupSavedAsMeal?.(meal);
                  }}
                  onCancel={() => setGroupAction(null)}
                />
              </div>
            )}
            {isCopying && !selectMode && (
              <div className="border-b border-stone-100 bg-white px-4 py-3">
                <CopyGroupDialog
                  entries={group.entries}
                  today={today}
                  tz={tz}
                  onCopied={(copiedEntries, toDate) => {
                    setGroupAction(null);
                    onGroupCopied?.(copiedEntries, toDate);
                  }}
                  onCancel={() => setGroupAction(null)}
                />
              </div>
            )}
            <ul className="divide-y divide-stone-100">
              {group.entries.map((entry) => {
                const entryPct = proteinCaloriePct(entry.protein_g, entry.calories);
                const isLoggingAgain = logAgainPendingId === entry.id;
                const isEditingRow = editingEntryId !== null && entry.id === editingEntryId;
                const entryLabel = entryDisplayLabel(entry);
                return (
                  <li
                    key={entry.id}
                    aria-current={isEditingRow ? "true" : undefined}
                    className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-stone-50/70 ${
                      isEditingRow ? "border-l-4 border-l-sage-deep" : ""
                    }`}
                  >
                    {selectMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${entryLabel}`}
                        autoComplete="off"
                        checked={selectedIds?.has(entry.id) ?? false}
                        onChange={() => onToggleSelected?.(entry.id)}
                        className="h-4 w-4 flex-none accent-sage-deep"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {entryLabel}
                        {isEditingRow && (
                          <span className="text-xs font-semibold uppercase tracking-wide text-sage-deep">
                            Editing
                          </span>
                        )}
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
                    {/* Phase 8b: per-row actions are hidden while this row is selected-mode-active
                        OR is the row currently being edited -- each is either meaningless or
                        actively wrong in either state (see the file doc comment). */}
                    {!selectMode && !isEditingRow && (
                      <div className="flex flex-none items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={isLoggingAgain}
                          onClick={() => handleLogAgain(entry)}
                        >
                          {isLoggingAgain ? "Logging..." : "Log again"}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(entry)}>
                          Edit
                        </Button>
                        <Button type="button" variant="danger" size="sm" onClick={() => onDelete(entry)}>
                          Delete
                        </Button>
                      </div>
                    )}
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
