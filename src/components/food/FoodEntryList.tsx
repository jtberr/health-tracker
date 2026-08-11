"use client";

import { useEffect, useState } from "react";
import { groupByConsumedAt } from "@/lib/domain/entry-grouping";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { sumEntries } from "@/lib/domain/totals";
import { formatTimeLabel, utcToLocalTime } from "@/lib/domain/datetime";
import { roundTo } from "@/lib/domain/units";
import { ActionPanel } from "@/components/ui/ActionPanel";
import { Button } from "@/components/ui/Button";
import { PencilIcon, RepeatIcon, TrashIcon } from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/Tooltip";
import { CopyGroupDialog } from "./CopyGroupDialog";
import { SaveGroupAsMealDialog } from "./SaveGroupAsMealDialog";
import type { FoodEntry, Meal } from "@/lib/types";

/** Which group action, if any, is currently open — mutually exclusive per group (see below). */
type GroupAction = { key: string; kind: "save" | "copy" } | null;

/** The rendered label for an entry row -- shared by the visible name/quantity text and every
 * per-row action's aria-label (the select-mode checkbox, and, since 2026-08-07/Phase 8g, the
 * icon-only "Log again"/"Edit"/"Delete" buttons -- see the file doc comment). */
function entryDisplayLabel(entry: FoodEntry): string {
  return entry.quantity !== 1 || entry.unit
    ? `${entry.quantity}${entry.unit ? ` ${entry.unit}` : "x"} — ${entry.name}`
    : entry.name;
}

/**
 * Renders a day's food entries grouped by exact-`consumed_at` meal groups (§3.4 "FoodEntryList").
 * Each group header shows the group's local time-of-day and its ratio-of-sums protein %; each
 * entry row shows its own per-entry protein % plus a one-tap "Log again" (Phase 8 — "Ease-of-entry
 * extras (copy/repeat)"). Edit is delegated to the caller (which owns the mutation + refetch).
 * "Delete" lives on the row too (back again as of Phase 8g — see below) — the caller supplies
 * `onDelete`, which owns the confirmation and the actual mutation; this component never calls
 * `deleteFoodEntry` or `window.confirm` itself.
 *
 * **Group header is a small action bar** (Phase 7b built the slot; Phase 8 adds the second
 * button): "Save as meal" opens an inline `SaveGroupAsMealDialog` expander; "Copy this group" opens
 * an inline `CopyGroupDialog` expander. Only one expander per group can be open at a time
 * (`groupAction` tracks which group + which kind) — this is real local UI state, which is exactly
 * why `FoodDayView.tsx`'s `hasLoadedOnce` fix (Phase 7b) matters: a background refresh triggered
 * elsewhere on the page must never unmount this component mid-typing/mid-picking-a-date.
 *
 * **Multi-select mode (Phase 8b, 2026-08-01)** — an explicit mode, not always-visible checkboxes
 * (design doc §3.4/§4): while `selectMode` is true, every per-row ("Log again"/"Edit") and
 * per-group ("Save as meal"/"Copy this group") action is hidden and a checkbox appears on every
 * row instead. Entering select mode closes any open group expander. A checked row gets NO
 * background tint of its own -- the checkbox alone is the indicator, so it never collides with the
 * editing-row highlight below (both are per-row visual states in the same list).
 *
 * **Editing-row highlight (Phase 8b, 2026-08-01; strengthened 2026-08-07, Phase 8g; tokens swapped
 * 2026-08-09/10, Phase 8i)** —
 * `editingEntryId` is the ID of the entry currently open in the edit form above (or `null`), NOT
 * the entry object: `refresh()` replaces every object in `entries` with a fresh row from the DB
 * while the caller's `editingEntry` state still holds the pre-refresh snapshot, so an
 * object-identity comparison would silently stop matching after the first background refresh —
 * comparing ids is the only comparison that can't develop that bug. The matching row gets a left
 * accent bar, an inset `accent` ring around the whole row, and a FILLED `bg-accent text-white`
 * "Editing" pill — emphasis ladder "level 1+" (§3.4) — still with NO background fill (this list
 * already uses a `bg-accent-soft` "From a saved meal" badge, which would vanish on an accent-soft
 * row; the filled dark pill is also visually unmistakable next to that pale badge, which a
 * same-colored row fill would have destroyed). It hides its own row actions (each is either
 * meaningless or
 * actively wrong while that row's edit form is open — see ai-context/DECISIONS.md's "Sixth
 * manual-testing finding..." and "The editing-row highlight escalates by enclosure..."). Editing
 * and select mode can coexist: entering select mode does not cancel an in-progress edit, and the
 * edited row can still carry a checkbox alongside its highlight (a checked row still gets no tint
 * of its own — the checkbox is the indicator — so the two states never compete for the same
 * surface).
 *
 * **Active-group suppression (2026-08-05, Phase 8d)** — design doc §3.4 "An active group
 * suppresses its rows' actions and is visually marked": this is the same rule as the editing row
 * and select mode, applied one level up. While a group's own expander ("Save as meal" or "Copy
 * this group") is open, every row inside THAT group hides its own actions, and the header's
 * SIBLING action (the one that isn't open) is hidden too — the header's active toggle itself stays
 * visible but its label flips from the idle verb to "Close", closing the long-deferred duplicate-
 * "Cancel" note (Phase 7b N-3 / Phase 8 N-5: with the toggle now reading "Close", there is exactly
 * one "Cancel" left in an open panel — the dialog's own). The active `<section>` gets the level-1
 * `border-l-4 border-l-accent` accent (no surface fill, same reasoning as the editing row: a
 * `bg-accent-soft` section would swallow the `bg-accent-soft` "From a saved meal" badges inside it).
 * The open dialog itself is wrapped in `ActionPanel` — level 3 of the emphasis ladder (§3.4) — so
 * it visibly pulls the eye and receives focus on open.
 *
 * **Icon-ONLY row actions, all three (2026-08-07, Phase 8g)** — "Log again" (repeat glyph), "Edit"
 * (pencil glyph) and "Delete" (trash glyph, `danger` variant). This SUPERSEDES Phase 8d's
 * icon+always-visible-label treatment (`ai-context/DECISIONS.md`'s "Icons replace buttons+text
 * entirely..." — Jeff reviewed the touch-explainability tradeoff that motivated the visible label
 * and confirmed he still wants it gone). Each button carries NO visible text — just the glyph, a
 * generous tap-target (`size="icon"` on `Button`), a hover/focus background, an `aria-label` built
 * from `entryDisplayLabel` (`"Log again <entry>"` / `"Edit <entry>"` / `"Delete <entry>"` — the
 * verb is never paraphrased, so voice control's "click Delete" still resolves and a screen-reader
 * user tabbing ten rows doesn't hear ten bare "Delete, button"s), and the existing supplementary
 * pointer-only `Tooltip` (unchanged — still hover/focus-triggered, still absent on touch, still
 * never the SOLE source of a control's meaning since the aria-label now carries that role in place
 * of the removed visible text).
 *
 * **"Delete" is back on the row (reversing Phase 8d, not a bug report against it)** — Jeff's read,
 * after actually using the edit-form placement, is that "edit an item in order to delete it" is an
 * unintuitive extra step, not a safety feature. The mis-tap risk moves to a `window.confirm()`
 * naming the entry, owned by the CALLER's `onDelete` handler (`FoodDayView`), never by this
 * presentational component — mirroring `MealList.handleDeleteMeal`'s exact shape. See
 * `ai-context/DECISIONS.md`'s "Delete returns to the food-entry row...".
 *
 * **Suppression is inherited, not re-derived**: the trash button sits inside the SAME
 * `!selectMode && !isEditingRow && !isGroupActive` conditional as the other two — no new branch.
 * The row being edited hides all three actions, so a mid-edit row has NO delete affordance at all
 * (deleting the row whose form is open would leave a form that can't save) — deleting an entry
 * you're part-way through editing is Cancel → trash, by design.
 */
export function FoodEntryList({
  entries,
  today,
  tz,
  onEdit,
  onLogAgain,
  onDelete,
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
  /** Fired when a single entry's "Log again" (`copyFoodEntries`) succeeds. */
  onLogAgain: (entry: FoodEntry) => Promise<void> | void;
  /** Phase 8g: deletes this entry. Owns the `window.confirm` and the actual `deleteFoodEntry`
   * mutation itself — this component only ever calls it, never confirms or deletes on its own. */
  onDelete: (entry: FoodEntry) => void;
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
      <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
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
        const isGroupActive = isSaving || isCopying;

        return (
          // NO `overflow-hidden` here (bugfix, 2026-08-09): this section used to clip its own
          // rounded corners with `overflow-hidden`, which also silently clipped the row-action
          // `Tooltip`s (`components/ui/Tooltip.tsx`, "no portal, no positioning library" by
          // design) whenever a tooltip's absolutely-positioned box extended past this card's own
          // right edge -- confirmed live (a real hover, not just code reading): the tooltip text
          // was cut off mid-sentence at this section's right edge, well before the viewport edge.
          // Fixed by rounding the two DIRECT CHILDREN that actually paint flush to this box's
          // edges instead (the header's own `rounded-t-xl` below, and the last `<li>`'s own
          // `last:rounded-b-xl`) -- CSS border-radius always clips an element's OWN background
          // regardless of overflow, so this reproduces the same visual rounding without clipping
          // anything positioned outside this box, like a tooltip.
          <section
            key={group.consumedAt}
            className={`rounded-xl border border-line bg-white shadow-sm ${
              isGroupActive ? "border-l-4 border-l-accent" : ""
            }`}
          >
            {/* Bugfix (2026-08-09): header shading bumped from a very light fill to a visibly
                stronger one -- the lighter shade read as too subtle against the white item rows
                below (Jeff).
                Bugfix (2026-08-10): `bg-slate-100` turned out to be EXACTLY `--canvas` (#f1f5f9 --
                Phase 8i's page background), a coincidence from the "incidental fills/hovers may
                use raw slate" rule that made the header read as blending into the page rather than
                standing apart from its own white card, once the whole palette moved to that cooler
                neutral family. Moved to `bg-accent-soft` (#dbeafe, a real pale blue, not a neutral)
                -- Jeff's explicit call to use colour, not another shade of gray -- reusing the
                exact tint this app already uses everywhere else for "this is notable"
                (`ActionPanel`, `StatusMessage`, the active `NavLink`, every status pill), rather
                than inventing a one-off colour for this one spot. Kept consistent with
                `MealList.tsx`'s equivalent meal-card header panel, same shade. */}
            <header className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-line bg-accent-soft px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-ink">{formatTimeLabel(time)}</span>
                <span className="text-sm text-muted">
                  {/* Summing protein_g in JS (float addition, e.g. 1.98 + 1.98 + 1.98) can produce
                      trailing-digit noise like 5.9399999999999995 -- round only for display; the
                      unrounded sum still feeds groupPct's ratio-of-sums math above. */}
                  {groupTotals.calories} kcal · {roundTo(groupTotals.proteinG, 2)}g protein
                  {groupPct !== null && ` · ${groupPct}% from protein`}
                </span>
              </div>
              {/* Phase 8b: per-group actions are hidden entirely in select mode -- two live copy
                  affordances (this and "Copy selected") at once is the exact ambiguity select mode
                  exists to prevent (design doc §3.4/§4). Phase 8d: while ONE of these is active,
                  its sibling is hidden too (an open copy panel leaves no "Save as meal" on this
                  header, and vice versa) -- the active one's own label flips to "Close". */}
              {!selectMode && (
                <div className="flex items-center gap-2">
                  {!isCopying && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setGroupAction(isSaving ? null : { key: group.consumedAt, kind: "save" })
                      }
                    >
                      {isSaving ? "Close" : "Save as meal"}
                    </Button>
                  )}
                  {!isSaving && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setGroupAction(isCopying ? null : { key: group.consumedAt, kind: "copy" })
                      }
                    >
                      {isCopying ? "Close" : "Copy this group"}
                    </Button>
                  )}
                </div>
              )}
            </header>
            {isSaving && !selectMode && (
              <div className="border-b border-slate-100 px-4 py-3">
                <ActionPanel heading="Save as meal">
                  <SaveGroupAsMealDialog
                    entries={group.entries}
                    onSaved={(meal) => {
                      setGroupAction(null);
                      onGroupSavedAsMeal?.(meal);
                    }}
                    onCancel={() => setGroupAction(null)}
                  />
                </ActionPanel>
              </div>
            )}
            {isCopying && !selectMode && (
              <div className="border-b border-slate-100 px-4 py-3">
                <ActionPanel heading="Copy this group">
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
                </ActionPanel>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {group.entries.map((entry) => {
                const entryPct = proteinCaloriePct(entry.protein_g, entry.calories);
                const isLoggingAgain = logAgainPendingId === entry.id;
                const isEditingRow = editingEntryId !== null && entry.id === editingEntryId;
                const entryLabel = entryDisplayLabel(entry);
                return (
                  <li
                    key={entry.id}
                    aria-current={isEditingRow ? "true" : undefined}
                    className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors last:rounded-b-xl hover:bg-slate-50/70 ${
                      isEditingRow ? "border-l-4 border-l-accent ring-2 ring-inset ring-accent" : ""
                    }`}
                  >
                    {selectMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${entryLabel}`}
                        autoComplete="off"
                        checked={selectedIds?.has(entry.id) ?? false}
                        onChange={() => onToggleSelected?.(entry.id)}
                        className="h-4 w-4 flex-none accent-accent"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        {entryLabel}
                        {/* Level 1+ (2026-08-07, Phase 8g; tokens swapped 2026-08-09/10, Phase 8i):
                            the bar + ring above are reinforced by a FILLED pill (not the bar-only
                            "Editing" caption Phase 8b shipped) -- also visually unmistakable next
                            to the pale "From a saved meal" badge below, which a same-colored fill
                            would have made indistinguishable. */}
                        {isEditingRow && (
                          <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
                            Editing
                          </span>
                        )}
                        {/* Meal-batch rows (Phase 7): `logMealForDay` shares one `consumed_at`
                            per batch and stamps `logged_from_meal_id` on every row it writes —
                            labeled here per design doc §3.4 "Meal-batch rows ... are labeled". */}
                        {entry.logged_from_meal_id !== null && (
                          <span className="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-ink">
                            From a saved meal
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted">
                        {entry.calories} kcal · {entry.protein_g}g protein
                        {entryPct !== null ? ` · ${entryPct}%` : " · —"}
                      </p>
                    </div>
                    {/* Phase 8b/8d/8g: per-row actions are hidden while this row is selected-mode-
                        active, is the row currently being edited, OR its group's own expander is
                        open -- each is either meaningless or actively wrong in any of those states
                        (see the file doc comment). The row is three ICON-ONLY actions (2026-08-07,
                        Phase 8g): "Delete" is back on the row alongside "Log again"/"Edit", and none
                        of the three carry visible text anymore -- each is an aria-labeled icon
                        button plus a supplementary pointer-only Tooltip. */}
                    {!selectMode && !isEditingRow && !isGroupActive && (
                      <div className="flex flex-none items-center gap-1">
                        <Tooltip text="Log this entry again at the current time.">
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            disabled={isLoggingAgain}
                            onClick={() => handleLogAgain(entry)}
                            aria-label={`Log again ${entryLabel}`}
                          >
                            <RepeatIcon />
                          </Button>
                        </Tooltip>
                        <Tooltip text="Edit this entry's name, amount or time.">
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            onClick={() => onEdit(entry)}
                            aria-label={`Edit ${entryLabel}`}
                          >
                            <PencilIcon />
                          </Button>
                        </Tooltip>
                        <Tooltip text="Delete this entry. This can't be undone.">
                          <Button
                            type="button"
                            variant="danger"
                            size="icon"
                            onClick={() => onDelete(entry)}
                            aria-label={`Delete ${entryLabel}`}
                          >
                            <TrashIcon />
                          </Button>
                        </Tooltip>
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
