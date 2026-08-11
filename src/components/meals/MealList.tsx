"use client";

import { useState, useTransition } from "react";
import { deleteMeal, deleteMealItem, reorderMealItems, setMealPinned } from "@/lib/actions/meals";
import { formatDateLabel, formatTimeLabel, utcToLocalTime } from "@/lib/domain/datetime";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { sumEntries } from "@/lib/domain/totals";
import { roundTo } from "@/lib/domain/units";
import { ActionPanel } from "@/components/ui/ActionPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ChevronDownIcon, PencilIcon, PinIcon, TrashIcon } from "@/components/ui/icons";
import { StatusMessage, SUCCESS_MESSAGE_MS } from "@/components/ui/StatusMessage";
import { Tooltip } from "@/components/ui/Tooltip";
import { LogMealDialog } from "@/components/food/LogMealDialog";
import { DuplicateMealDialog } from "./DuplicateMealDialog";
import { MealForm } from "./MealForm";
import { MealItemForm } from "./MealItemForm";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

export type MealListProps = {
  meals: Meal[];
  itemsByMeal: Record<string, MealItem[]>;
  /** Called after any mutation settles (delete/reorder/pin here, or a save inside MealForm/
   * MealItemForm/DuplicateMealDialog) — the parent (`MealsView`) owns the actual refetch. */
  onChanged: () => void;
  /** Phase 8c (2026-08-01): today's local date / the browser's IANA timezone, resolved by
   * `MealsView` in a mount-only Effect — `null` until resolved. Only the "Log this meal" action
   * depends on these; everything else in this list renders regardless (see `MealsView`'s doc
   * comment for why this is scoped narrowly rather than gating the whole screen). */
  today: string | null;
  tz: string | null;
};

/** Which card-level expander is open, if any -- ONE nullable value for the whole list (not per
 * meal), so opening any one closes any other, on this card or any other (Phase 8f, 2026-08-05/08:
 * "the exact shape `FoodEntryList.groupAction` already uses"). Replaces the earlier separate
 * `renamingMealId`/`loggingMealId` state + hand-written `isLogging && !isRenaming` guard -- named
 * explicitly in the design doc's §8 In-scope list rather than left to be discovered in the diff. */
type CardAction = { mealId: string; kind: "log" | "rename" | "duplicate" } | null;

/**
 * Saved-meals library (design doc §3.1/§8 Phase 7 `meals/MealList.tsx`): one card per meal (name,
 * item count, total calories/protein, ratio-of-sums protein %), expandable to manage its items
 * (add/edit/remove/reorder) via `MealItemForm`, plus rename (`MealForm`), pin/unpin, duplicate
 * (`DuplicateMealDialog`), and delete.
 *
 * Deleting a meal cascades its items at the DB level (`meal_items` FK `ON DELETE CASCADE` — see
 * the Phase 2 migration) and never touches already-logged `food_entries` (those hold copied
 * values, not a live reference — ai-context/DECISIONS.md "Saved meals: items scoped per-meal...").
 * This component itself calls `deleteMeal`/`deleteMealItem`/`reorderMealItems`/`setMealPinned`
 * directly (mirroring how `FoodDayView` owns `deleteFoodEntry`), while create/rename/add/edit/
 * duplicate are delegated to nested `MealForm`/`MealItemForm`/`DuplicateMealDialog` instances,
 * which own their own `useActionState`.
 *
 * **"Log this meal" (Phase 8c, 2026-08-01)** — placed FIRST in each card's action row (logging is
 * the point of a saved meal; rename/manage/pin/duplicate/delete are maintenance), opening an inline
 * expander (wrapped in `ActionPanel`, Phase 8f) that reuses `LogMealDialog` in its fixed-meal mode
 * (`meal` prop) rather than a second hand-copied dialog. Success shows a `StatusMessage` naming the
 * meal/date/time and does **NOT** call `onChanged()` — logging writes only to `food_entries`, which
 * this screen never renders, so there is nothing here to refetch (mirrors Phase 7b's "Save as meal"
 * being read-only in the other direction).
 *
 * **Pinning (2026-08-05/08, Phase 8f)** — a pin/unpin icon-only toggle (`aria-label` + `aria-pressed`
 * + a supplementary `Tooltip`, per the 2026-08-07 "icons replace buttons+text entirely" decision)
 * calls `setMealPinned` and refetches. The card also shows a "Pinned" TEXT pill when pinned — this
 * is the actual accessible carrier of the pinned state (WCAG 1.4.1: never color/icon-fill alone),
 * matching the pill-vs-banner rule `MetricForm`'s "Already logged" and `FoodEntryList`'s "From a
 * saved meal" badge already established. Ordering itself is `sortMealsByName`'s job (`MealsView`),
 * not this component's — a pinned meal simply arrives first in `meals`.
 *
 * **Duplicating (2026-08-05/08, Phase 8f)** — a "Duplicate" control opens `DuplicateMealDialog`
 * (wrapped in `ActionPanel`), which re-reads the source meal server-side and creates an independent,
 * always-unpinned copy. Unlike "Log this meal", success DOES call `onChanged()` — duplicating writes
 * `meals`, which this screen renders, whereas logging writes only `food_entries`, which it doesn't.
 *
 * **Per-item Edit/Delete are icon-only** (2026-08-07 amendment to the Phase 8f design, adopting
 * Phase 8d/8g's vocabulary on this screen): a pencil/trash `<button>` with no visible text, an
 * `aria-label` built as `` `Edit ${item.name}` ``/`` `Delete ${item.name}` `` (the same
 * disambiguation shape Phase 8g establishes on `/food`'s `FoodEntryList`), and a supplementary
 * pointer-only `Tooltip`. The existing ↑/↓ reorder buttons keep their own `aria-label` and gain a
 * `Tooltip` too. Item-level delete carries no `window.confirm` — that behavior is unchanged from
 * before this phase (only the CARD-level delete, a bigger blast radius, has one); adding one here
 * would be new behavior this phase's design doesn't call for.
 */
export function MealList({ meals, itemsByMeal, onChanged, today, tz }: MealListProps) {
  // Items show by default (Jeff's call, 2026-07-30 — a saved meal's whole point is checking what's
  // in it, so hiding that behind a click every visit was the wrong default). Tracked as a set of
  // explicitly *collapsed* ids, not expanded ones, so a newly created meal is expanded by default
  // too, with no special-casing needed.
  const [collapsedMealIds, setCollapsedMealIds] = useState<Set<string>>(() => new Set());
  const [cardAction, setCardAction] = useState<CardAction>(null);
  const [addingItemToMealId, setAddingItemToMealId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Bumped every time a NEW statusMessage is shown -- forces StatusMessage to remount (and so
  // start a fresh auto-dismiss timer) on a repeat, the same idiom FoodDayView's `savedMessageNonce`/
  // MetricForm's `savedNonce` already use.
  const [statusNonce, setStatusNonce] = useState(0);
  const [, startTransition] = useTransition();

  function showStatus(message: string) {
    setStatusMessage(message);
    setStatusNonce((n) => n + 1);
  }

  function handleMealLogged(meal: Meal, entries: FoodEntry[], loggedTz: string) {
    setCardAction(null);
    // Defensive only -- logMealForDay's `empty_meal` rejection means this can't actually happen on
    // a successful result, but guard against `entries[0]` on an empty array regardless.
    if (entries.length === 0) return;
    const { date, time } = utcToLocalTime(entries[0].consumed_at, loggedTz);
    showStatus(`Logged "${meal.name}" to ${formatDateLabel(date)} at ${formatTimeLabel(time)}.`);
  }

  function handleMealDuplicated(duplicate: Meal) {
    setCardAction(null);
    showStatus(`Duplicated as "${duplicate.name}".`);
    // Unlike handleMealLogged: duplicating writes `meals`, which THIS screen renders, so it refetches.
    onChanged();
  }

  function handleTogglePinned(meal: Meal) {
    startTransition(async () => {
      await setMealPinned(meal.id, !meal.is_pinned);
      onChanged();
    });
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
      {statusMessage && (
        <StatusMessage
          key={statusNonce}
          message={statusMessage}
          autoDismissMs={SUCCESS_MESSAGE_MS}
          onDismiss={() => setStatusMessage(null)}
        />
      )}

      {meals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No saved meals yet. Create one above to get started.
        </div>
      ) : (
        meals.map((meal) => {
        const items = itemsByMeal[meal.id] ?? [];
        const totals = sumEntries(items);
        const pct = proteinCaloriePct(totals.proteinG, totals.calories);
        const isExpanded = !collapsedMealIds.has(meal.id);
        const isRenaming = cardAction?.mealId === meal.id && cardAction.kind === "rename";
        const isLogging = cardAction?.mealId === meal.id && cardAction.kind === "log";
        const isDuplicating = cardAction?.mealId === meal.id && cardAction.kind === "duplicate";

        // Bugfix (2026-08-09): NO `overflow-hidden` here (was `className="overflow-hidden
        // p-4 sm:p-5"`) -- it clipped this card's own Tooltips (pin toggle, item ↑/↓/Edit/
        // Delete) exactly like FoodEntryList's section did (see that file's comment for the
        // root-caused, live-verified mechanism); it wasn't load-bearing for anything else,
        // since every element inside this Card is already inset by the Card's own `p-4 sm:p-5`
        // padding -- nothing here paints flush to the Card's literal edges, so nothing needed
        // overflow-hidden's corner-clipping in the first place.
        return (
          <Card key={meal.id} className="p-4 sm:p-5">
            {isRenaming ? (
              <MealForm
                editingMeal={meal}
                onSaved={() => {
                  setCardAction(null);
                  onChanged();
                }}
                onCancel={() => setCardAction(null)}
              />
            ) : (
              // Bugfix (2026-08-09): a shaded header PANEL (bg-slate-100, inset within the Card's
              // own padding -- not edge-to-edge, so no corner-rounding is needed) so this card's
              // header row visually stands out from the item rows below, matching the strengthened
              // shade FoodEntryList's group headers now use on `/food` for the same complaint.
              //
              // Bugfix (2026-08-10, Jeff's direct request): three changes to how this header's
              // controls are laid out, none functional. (1) The pin toggle no longer sits IN the
              // button row (an icon stranded mid-list of text buttons read as visually broken) --
              // it's now positioned in the header's own top-right corner via `relative` on this
              // container + `absolute right-2 top-2` on a plain WRAPPING `<div>`, so it never
              // competes with the row's flex layout regardless of how many other buttons wrap.
              // **The wrapper is load-bearing, not decorative**: `Tooltip` renders its own
              // `relative inline-flex` span around its child, so putting `absolute` directly on
              // the button positions it against THAT collapsed span (whatever tiny, arbitrary spot
              // the flex layout happened to give an empty inline-flex box), not against this
              // header -- confirmed live (a screenshot showed the pin floating outside the card
              // entirely). An outer, non-Tooltip-owned `div` is what actually establishes the
              // header as the absolute-positioning ancestor. `pr-11`/`sm:pr-12` reserve room so a
              // long meal name never wraps under it. (2) "Hide items"/"Manage items" is no longer a
              // text `Button` -- it's a standard icon-only expand/collapse chevron (rotates 180°
              // via `aria-expanded`-driven `rotate-180`, the conventional accordion treatment),
              // moved to the end of the button row. (3) "Rename" is no longer a text `Button` in
              // that row either -- a small pencil icon sits directly next to the meal name instead,
              // reusing the same `PencilIcon` this app already uses for every other "Edit"
              // affordance (FoodEntryList/this file's own item rows), for one consistent
              // pencil-means-edit vocabulary rather than a second, visually distinct "solid" glyph
              // just for this one spot.
              //
              // Bugfix (2026-08-10): `bg-slate-100` turned out to be EXACTLY `--canvas` (#f1f5f9),
              // Phase 8i's page background -- the header read as blending into the page rather
              // than standing apart from its own white Card. Moved to `bg-accent-soft` (#dbeafe, a
              // real pale blue, Jeff's explicit call to use colour instead of another gray), the
              // same tint this app already uses everywhere for "this is notable" (`ActionPanel`,
              // `StatusMessage`, the active `NavLink`, every status pill) -- and the same shade
              // `FoodEntryList.tsx`'s equivalent group header now uses, for the identical reason.
              <div className="relative flex flex-col gap-3 rounded-xl bg-accent-soft px-3 py-2.5 pr-11 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:pr-12">
                <div className="absolute right-2 top-2">
                  <Tooltip
                    text={
                      meal.is_pinned
                        ? "Remove this meal from your pinned shortlist."
                        : "Pin this meal to the top of your list."
                    }
                  >
                    <button
                      type="button"
                      aria-label={meal.is_pinned ? `Unpin ${meal.name}` : `Pin ${meal.name}`}
                      aria-pressed={meal.is_pinned}
                      onClick={() => handleTogglePinned(meal)}
                      // Bugfix (2026-08-10): the pinned fill was `bg-accent-soft text-accent` --
                      // now that the header ITSELF is `bg-accent-soft` (see above), that made a
                      // pinned meal's pin icon visually vanish into its own header (identical
                      // background). Moved to a solid `bg-accent` fill with white text, the same
                      // "solid accent, not the soft tint" treatment `Button`'s primary variant
                      // already uses, so it now unmistakably stands OUT from the header instead of
                      // matching it. The unpinned state's hover also moved off `bg-slate-100`
                      // (#f1f5f9, barely distinguishable from the header's own #dbeafe) to a
                      // translucent white, which reads as a clear "lighter than the header" hover
                      // regardless of what the header's own fill is.
                      className={`rounded-full p-2 transition-colors ${
                        meal.is_pinned ? "bg-accent text-white" : "text-muted hover:bg-white/60"
                      }`}
                    >
                      <PinIcon />
                    </button>
                  </Tooltip>
                </div>
                <div>
                  {/* Bugfix (2026-08-10): the bare name now lives in its OWN <p>, with nothing
                      else inside it -- `MEAL_NAME_SELECTOR` (`p.text-lg.font-semibold`) is a
                      pre-existing Phase 7c test contract asserting this exact class combination's
                      `.textContent()` equals the meal's name, nothing more. The original code
                      already put the "Pinned" pill inside this same `<p>`, but that never broke
                      anything because no Phase 7c fixture is ever pinned -- unconditionally adding
                      the Rename control here (below) was what first exposed the contract, breaking
                      every one of that suite's `.textContent()`/`.allTextContents()` assertions on
                      this selector. Fixed by moving the flex-row wrapping (icon, pill) to an outer
                      `<div>` that does NOT carry `text-lg font-semibold`, so the selector keeps
                      matching an element containing ONLY the name, exactly as before. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold text-ink">{meal.name}</p>
                    {/* Bugfix (2026-08-10): the tooltip text must NOT embed `meal.name` -- unlike
                        `aria-label` (only exposed via the accessibility tree), `Tooltip`'s own text
                        node stays in the DOM at all times (CSS-hidden, not removed -- see
                        Tooltip.tsx's own doc comment on why), so Playwright's `getByText(mealName)`
                        -- used throughout this project's /meals suite to assert a meal is visible
                        -- can resolve to this HIDDEN node instead of the real, visible name whenever
                        the tooltip text contains it as a substring. Confirmed live: this caused 19
                        genuine (not flaky) test failures across four files, all with the identical
                        shape (`getByText(mealName)` resolving to `role="tooltip"` and failing
                        `toBeVisible()`). Every other tooltip in this app (pin, chevron, item
                        reorder) is already generic/name-free for exactly this reason -- this one is
                        now consistent with that, rather than the one exception. */}
                    <Tooltip text="Rename this meal.">
                      <button
                        type="button"
                        aria-label={`Rename ${meal.name}`}
                        onClick={() => setCardAction({ mealId: meal.id, kind: "rename" })}
                        // Bugfix (2026-08-10): hover moved off `bg-slate-200` (a neutral gray that
                        // reads muddy on the now-blue `bg-accent-soft` header) to the same
                        // translucent-white hover the pin toggle uses, for one consistent "lighter
                        // than the header, whatever the header's own fill is" hover treatment.
                        className="rounded-full p-1 text-muted transition-colors hover:bg-white/60 hover:text-ink"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    {/* The ACTUAL accessible carrier of pinned state (WCAG 1.4.1) -- text, not the
                        toggle icon's fill alone. Same pill vocabulary as MetricForm's "Already
                        logged" / FoodEntryList's "From a saved meal" -- except the fill moved from
                        `bg-accent-soft` to `bg-white` (2026-08-10): with the header itself now
                        `bg-accent-soft` too, the pill's identical fill made it visually vanish into
                        its own header. White-with-accent-text keeps it unmistakably a pill against
                        the blue header while staying clearly legible (accent on white is 6.70:1). */}
                    {meal.is_pinned && (
                      <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-xs font-medium text-accent">
                        Pinned
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted">
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
                      onClick={() =>
                        setCardAction(isLogging ? null : { mealId: meal.id, kind: "log" })
                      }
                    >
                      {isLogging ? "Cancel" : "Log this meal"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setCardAction(isDuplicating ? null : { mealId: meal.id, kind: "duplicate" })
                    }
                  >
                    {isDuplicating ? "Cancel" : "Duplicate"}
                  </Button>
                  <Button type="button" variant="danger" size="sm" onClick={() => handleDeleteMeal(meal)}>
                    Delete
                  </Button>
                </div>
              </div>
            )}

            {/* Bugfix (2026-08-10, Jeff's direct request, second pass): the chevron first landed
                in the header's own bottom-right corner (mirroring the pin), but that corner still
                reads as "up near the buttons" once the header's own height is short -- Jeff's own
                annotation pointed past the header entirely, into the genuinely WHITE gap between
                it and the item list. Moved here: a real sibling row, outside and below the shaded
                header `<div>`, right-aligned on the Card's own white background -- not an
                absolutely-positioned corner of anything. Rendered even while renaming (the header
                above swaps to `MealForm` in that state, but the item list -- and this toggle for
                it -- stays exactly where it was, matching how the item list itself doesn't
                disappear during a rename either). */}
            <div className="flex justify-end pt-1">
              <Tooltip text={isExpanded ? "Hide this meal's items." : "Show this meal's items."}>
                <button
                  type="button"
                  aria-label={isExpanded ? `Hide items for ${meal.name}` : `Show items for ${meal.name}`}
                  aria-expanded={isExpanded}
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
                  className="rounded-full p-2 text-muted transition-colors hover:bg-slate-100"
                >
                  <ChevronDownIcon className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
              </Tooltip>
            </div>

            {/* cardAction is a single value for the WHOLE list, so isLogging/isRenaming/
                isDuplicating can never be simultaneously true for this (or any other) meal --
                opening one closes any other, on this card or any other (design doc §6 "one
                expander per card ... only one card's expander is open across the list"). */}
            {isLogging && today !== null && tz !== null && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <ActionPanel heading={`Log ${meal.name}`}>
                  <LogMealDialog
                    meal={meal}
                    today={today}
                    tz={tz}
                    onLogged={(entries) => handleMealLogged(meal, entries, tz)}
                    onCancel={() => setCardAction(null)}
                  />
                </ActionPanel>
              </div>
            )}

            {isDuplicating && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <ActionPanel heading="Duplicate meal">
                  <DuplicateMealDialog
                    meal={meal}
                    items={items}
                    onDuplicated={handleMealDuplicated}
                    onCancel={() => setCardAction(null)}
                  />
                </ActionPanel>
              </div>
            )}

            {isExpanded && (
              <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
                {items.length === 0 && (
                  <p className="text-sm text-muted">No items yet — add one below.</p>
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
                        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {item.quantity !== 1 || item.unit
                              ? `${item.quantity}${item.unit ? ` ${item.unit}` : "x"} — ${item.name}`
                              : item.name}
                          </p>
                          <p className="text-sm text-muted">
                            {item.calories} kcal · {item.protein_g}g protein
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip text="Move this item earlier in the list.">
                            <button
                              type="button"
                              aria-label={`Move ${item.name} up`}
                              disabled={index === 0}
                              onClick={() => handleMoveItem(meal.id, items, index, -1)}
                              className="rounded-full p-1 text-muted hover:bg-slate-100 disabled:opacity-30"
                            >
                              ↑
                            </button>
                          </Tooltip>
                          <Tooltip text="Move this item later in the list.">
                            <button
                              type="button"
                              aria-label={`Move ${item.name} down`}
                              disabled={index === items.length - 1}
                              onClick={() => handleMoveItem(meal.id, items, index, 1)}
                              className="rounded-full p-1 text-muted hover:bg-slate-100 disabled:opacity-30"
                            >
                              ↓
                            </button>
                          </Tooltip>
                          {/* Icon-only Edit/Delete (2026-08-07 amendment to Phase 8f's design --
                              see the file doc comment): aria-label mirrors the exact
                              `Delete ${itemName}` disambiguation shape Phase 8g establishes on
                              `/food`, so the two screens share one vocabulary. */}
                          <Tooltip text="Edit this item's name, amount or per-unit values.">
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              onClick={() => setEditingItemId(item.id)}
                              aria-label={`Edit ${item.name}`}
                            >
                              <PencilIcon />
                            </Button>
                          </Tooltip>
                          <Tooltip text="Remove this item from the meal.">
                            <Button
                              type="button"
                              variant="danger"
                              size="icon"
                              onClick={() => handleDeleteItem(item)}
                              aria-label={`Delete ${item.name}`}
                            >
                              <TrashIcon />
                            </Button>
                          </Tooltip>
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
                    className="self-start text-sm font-medium text-accent hover:text-accent/80"
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
