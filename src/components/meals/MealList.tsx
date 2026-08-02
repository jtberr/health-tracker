"use client";

import { useState, useTransition } from "react";
import { deleteMeal, deleteMealItem, reorderMealItems } from "@/lib/actions/meals";
import { formatDateLabel, formatTimeLabel, utcToLocalTime } from "@/lib/domain/datetime";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { sumEntries } from "@/lib/domain/totals";
import { roundTo } from "@/lib/domain/units";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusMessage, SUCCESS_MESSAGE_MS } from "@/components/ui/StatusMessage";
import { LogMealDialog } from "@/components/food/LogMealDialog";
import { MealForm } from "./MealForm";
import { MealItemForm } from "./MealItemForm";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

export type MealListProps = {
  meals: Meal[];
  itemsByMeal: Record<string, MealItem[]>;
  /** Called after any mutation settles (delete/reorder here, or a save inside MealForm/MealItemForm) — the parent (`MealsView`) owns the actual refetch. */
  onChanged: () => void;
  /** Phase 8c (2026-08-01): today's local date / the browser's IANA timezone, resolved by
   * `MealsView` in a mount-only Effect — `null` until resolved. Only the new "Log this meal" action
   * depends on these; everything else in this list renders regardless (see `MealsView`'s doc
   * comment for why this is scoped narrowly rather than gating the whole screen). */
  today: string | null;
  tz: string | null;
};

/**
 * Saved-meals library (design doc §3.1/§8 Phase 7 `meals/MealList.tsx`): one card per meal (name,
 * item count, total calories/protein, ratio-of-sums protein %), expandable to manage its items
 * (add/edit/remove/reorder) via `MealItemForm`, plus rename (`MealForm`) and delete.
 *
 * Deleting a meal cascades its items at the DB level (`meal_items` FK `ON DELETE CASCADE` — see
 * the Phase 2 migration) and never touches already-logged `food_entries` (those hold copied
 * values, not a live reference — ai-context/DECISIONS.md "Saved meals: items scoped per-meal...").
 * This component itself calls `deleteMeal`/`deleteMealItem`/`reorderMealItems` directly (mirroring
 * how `FoodDayView` owns `deleteFoodEntry`), while create/rename/add/edit are delegated to nested
 * `MealForm`/`MealItemForm` instances, which own their own `useActionState`.
 *
 * **"Log this meal" (Phase 8c, 2026-08-01)** — placed FIRST in each card's action row (logging is
 * the point of a saved meal; rename/manage/delete are maintenance), opening an inline expander that
 * reuses `LogMealDialog` in its fixed-meal mode (`meal` prop) rather than a second hand-copied
 * dialog. `loggingMealId` tracks which card's expander is open — a single nullable id, not a set,
 * so at most one is open across the whole list at a time (the same mutual-exclusion rule
 * `FoodEntryList` applies to its own group actions). Success shows a `StatusMessage` naming the
 * meal/date/time and does **NOT** call `onChanged()` — logging writes only to `food_entries`, which
 * this screen never renders, so there is nothing here to refetch (mirrors Phase 7b's "Save as meal"
 * being read-only in the other direction). Kept self-contained in this component (not bubbled up to
 * `MealsView`) since, unlike `/food`'s analogous `handleMealLogged`, there's no cross-cutting
 * refetch or other side effect for a parent to own here.
 */
export function MealList({ meals, itemsByMeal, onChanged, today, tz }: MealListProps) {
  // Items show by default (Jeff's call, 2026-07-30 — a saved meal's whole point is checking what's
  // in it, so hiding that behind a click every visit was the wrong default). Tracked as a set of
  // explicitly *collapsed* ids, not expanded ones, so a newly created meal is expanded by default
  // too, with no special-casing needed.
  const [collapsedMealIds, setCollapsedMealIds] = useState<Set<string>>(() => new Set());
  const [renamingMealId, setRenamingMealId] = useState<string | null>(null);
  const [addingItemToMealId, setAddingItemToMealId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [loggingMealId, setLoggingMealId] = useState<string | null>(null);
  const [logStatusMessage, setLogStatusMessage] = useState<string | null>(null);
  // Bumped every time a NEW logStatusMessage is shown -- forces StatusMessage to remount (and so
  // start a fresh auto-dismiss timer) on a repeat, the same idiom FoodDayView's `savedMessageNonce`/
  // MetricForm's `savedNonce` already use.
  const [logStatusNonce, setLogStatusNonce] = useState(0);
  const [, startTransition] = useTransition();

  function handleMealLogged(meal: Meal, entries: FoodEntry[], loggedTz: string) {
    setLoggingMealId(null);
    // Defensive only -- logMealForDay's `empty_meal` rejection means this can't actually happen on
    // a successful result, but guard against `entries[0]` on an empty array regardless.
    if (entries.length === 0) return;
    const { date, time } = utcToLocalTime(entries[0].consumed_at, loggedTz);
    setLogStatusMessage(`Logged "${meal.name}" to ${formatDateLabel(date)} at ${formatTimeLabel(time)}.`);
    setLogStatusNonce((n) => n + 1);
  }

  function handleDeleteMeal(meal: Meal) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete "${meal.name}"? This removes all its items. Entries already logged from it are not affected.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteMeal(meal.id);
      onChanged();
    });
  }

  function handleDeleteItem(item: MealItem) {
    startTransition(async () => {
      await deleteMealItem(item.id);
      onChanged();
    });
  }

  function handleMoveItem(mealId: string, items: MealItem[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const orderedIds = reordered.map((item) => item.id);
    startTransition(async () => {
      await reorderMealItems(mealId, orderedIds);
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {logStatusMessage && (
        <StatusMessage
          key={logStatusNonce}
          message={logStatusMessage}
          autoDismissMs={SUCCESS_MESSAGE_MS}
          onDismiss={() => setLogStatusMessage(null)}
        />
      )}

      {meals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
          No saved meals yet. Create one above to get started.
        </div>
      ) : (
        meals.map((meal) => {
        const items = itemsByMeal[meal.id] ?? [];
        const totals = sumEntries(items);
        const pct = proteinCaloriePct(totals.proteinG, totals.calories);
        const isExpanded = !collapsedMealIds.has(meal.id);
        const isRenaming = renamingMealId === meal.id;
        const isLogging = loggingMealId === meal.id;

        return (
          <Card key={meal.id} className="overflow-hidden p-4 sm:p-5">
            {isRenaming ? (
              <MealForm
                editingMeal={meal}
                onSaved={() => {
                  setRenamingMealId(null);
                  onChanged();
                }}
                onCancel={() => setRenamingMealId(null)}
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-serif text-lg font-semibold text-ink">{meal.name}</p>
                  <p className="text-sm text-stone-500">
                    {/* Round only for display -- see the identical note in FoodEntryList.tsx. */}
                    {items.length} item{items.length === 1 ? "" : "s"} · {totals.calories} kcal ·{" "}
                    {roundTo(totals.proteinG, 2)}g protein
                    {pct !== null && ` · ${pct}% from protein`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Phase 8c: "Log this meal" is placed FIRST -- logging is the point of a saved
                      meal, the rest are maintenance. Hidden entirely until today/tz resolve (this
                      screen's first-ever browser-tz dependency -- see MealsView's doc comment),
                      rather than rendering a disabled/placeholder button for a window that's
                      normally imperceptible. */}
                  {today !== null && tz !== null && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setLoggingMealId(isLogging ? null : meal.id)}
                    >
                      {isLogging ? "Cancel" : "Log this meal"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setCollapsedMealIds((prev) => {
                        const next = new Set(prev);
                        if (isExpanded) {
                          next.add(meal.id);
                        } else {
                          next.delete(meal.id);
                        }
                        return next;
                      })
                    }
                  >
                    {isExpanded ? "Hide items" : "Manage items"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setRenamingMealId(meal.id)}
                  >
                    Rename
                  </Button>
                  <Button type="button" variant="danger" size="sm" onClick={() => handleDeleteMeal(meal)}>
                    Delete
                  </Button>
                </div>
              </div>
            )}

            {/* Phase 8c: only one meal's "Log this meal" expander is ever open at a time
                (`loggingMealId` is a single nullable id) -- the same mutual-exclusion rule
                FoodEntryList applies to its own group actions. Hidden while renaming this same
                card, so the two forms can never show at once. */}
            {isLogging && !isRenaming && today !== null && tz !== null && (
              <div className="mt-4 border-t border-stone-100 pt-4">
                <LogMealDialog
                  meal={meal}
                  today={today}
                  tz={tz}
                  onLogged={(entries) => handleMealLogged(meal, entries, tz)}
                  onCancel={() => setLoggingMealId(null)}
                />
              </div>
            )}

            {isExpanded && (
              <div className="mt-4 flex flex-col gap-3 border-t border-stone-100 pt-4">
                {items.length === 0 && (
                  <p className="text-sm text-stone-500">No items yet — add one below.</p>
                )}
                <ul className="flex flex-col gap-2">
                  {items.map((item, index) =>
                    editingItemId === item.id ? (
                      <li key={item.id}>
                        <MealItemForm
                          mealId={meal.id}
                          editingItem={item}
                          onSaved={() => {
                            setEditingItemId(null);
                            onChanged();
                          }}
                          onCancel={() => setEditingItemId(null)}
                        />
                      </li>
                    ) : (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {item.quantity !== 1 || item.unit
                              ? `${item.quantity}${item.unit ? ` ${item.unit}` : "x"} — ${item.name}`
                              : item.name}
                          </p>
                          <p className="text-sm text-stone-500">
                            {item.calories} kcal · {item.protein_g}g protein
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Move ${item.name} up`}
                            disabled={index === 0}
                            onClick={() => handleMoveItem(meal.id, items, index, -1)}
                            className="rounded-full p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${item.name} down`}
                            disabled={index === items.length - 1}
                            onClick={() => handleMoveItem(meal.id, items, index, 1)}
                            className="rounded-full p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingItemId(item.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeleteItem(item)}
                          >
                            Delete
                          </Button>
                        </div>
                      </li>
                    ),
                  )}
                </ul>

                {addingItemToMealId === meal.id ? (
                  <MealItemForm
                    mealId={meal.id}
                    onSaved={() => {
                      setAddingItemToMealId(null);
                      onChanged();
                    }}
                    onCancel={() => setAddingItemToMealId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingItemToMealId(meal.id)}
                    className="self-start text-sm font-medium text-sage-deep hover:text-sage-deep/80"
                  >
                    + Add item
                  </button>
                )}
              </div>
            )}
          </Card>
        );
        })
      )}
    </div>
  );
}
