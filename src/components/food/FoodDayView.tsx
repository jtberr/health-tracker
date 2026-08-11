"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { browserTimeZone, floorToQuarterHour, formatDateLabel, localDateInTz } from "@/lib/domain/datetime";
import { copyFoodEntries, deleteFoodEntry } from "@/lib/actions/food";
import { errorTextClass } from "@/components/ui/styles";
import { ActionPanel } from "@/components/ui/ActionPanel";
import { DayNavigator } from "@/components/ui/DayNavigator";
import { StatusMessage, SUCCESS_MESSAGE_MS } from "@/components/ui/StatusMessage";
import { CopyDayDialog } from "./CopyDayDialog";
import { CopyGroupDialog } from "./CopyGroupDialog";
import { DailyTotals } from "./DailyTotals";
import { DayActionBar } from "./DayActionBar";
import { EntrySelectionBar } from "./EntrySelectionBar";
import { FoodEntryForm } from "./FoodEntryForm";
import { FoodEntryList } from "./FoodEntryList";
import { LogMealDialog } from "./LogMealDialog";
import { SaveGroupAsMealDialog } from "./SaveGroupAsMealDialog";
import type { DailyFoodTotals, FoodEntry, Meal } from "@/lib/types";

/**
 * Client-side orchestrator for the `/food` day log (design doc §3.1 `food/page.tsx`). Owns:
 * the selected day, the fetched entries/totals for that day, the "smart default" tracking
 * (`lastConsumedAt`, reset to `null` on a day change per §3.4's edge cases), edit state, and
 * (Phase 8b) multi-select state.
 *
 * Reads go through the RLS-scoped browser Supabase client (same anon key + policies the server
 * client uses — never service-role) rather than a Server Component fetch. This is a deliberate
 * Phase 3 implementation choice, not a literal reading of §3.3's "reads via RLS-scoped server
 * client": which local calendar day is "today" is inherently a browser-timezone question (the
 * server has no reliable way to know it), and the smart-default/day-switching state this view
 * manages is itself client state — see the developer's Phase 3 report for the full reasoning.
 * Mutations remain real Server Actions (`lib/actions/food.ts`), resolving `user_id` from the
 * server-side session only, per AGENTS.md's Absolute Rules.
 *
 * **`hasLoadedOnce`** (Phase 7b prerequisite fix — mirrors the identical fix already made to
 * `MealsView.tsx` in Phase 7, see ai-context/DECISIONS.md "The `FoodDayView` `hasLoadedOnce`
 * fix..."). `FoodEntryList` now holds real local UI state of its own for the first time (which
 * group's "Save as meal" expander is open, and its in-flight name) — without this flag, the big
 * "Loading…" placeholder below would swap `FoodEntryList` out on *every* `refresh()` call,
 * including the ones triggered by an unrelated add/edit/delete elsewhere on this same day,
 * silently collapsing whatever expander the user had open mid-typing. The placeholder is now
 * scoped to the true *initial* load only; a background refresh keeps `FoodEntryList` mounted (and
 * its state intact) throughout.
 *
 * **Multi-select (Phase 8b, 2026-08-01)** — `selectMode`/`selectedIds`/`bulkAction` are declared as
 * plain state on THIS component (which a background `refresh()` never unmounts), and the JSX that
 * renders the selection bar + whichever bulk expander is open sits ABOVE the
 * `!hasLoadedOnce && loading` ternary — structurally, not just by convention — so neither the
 * selection nor an open bulk expander can ever be wiped by a background refresh, matching how
 * `savedMessage`/`FoodEntryForm` are already placed outside that ternary. This is the third
 * component in this codebase to hold local UI state a background refresh could wipe (after
 * `MealsView` in Phase 7 and `FoodEntryList` in Phase 7b, both of which shipped broken) — see
 * ai-context/DECISIONS.md's "Phase 8b designed..." entry for the full reasoning.
 *
 * **`tz`/`today` resolved in a mount-only Effect, not at render time (2026-08-06, Phase 8d fix —
 * a real bug found and root-caused during this phase's own verification, not incidental scope
 * creep: see ai-context/PROGRESS.md's Phase 8d entry and ai-context/DECISIONS.md).** Next.js still
 * renders this Client Component once on the server (SSR) before hydrating on the client, and
 * `browserTimeZone()` disagrees between the server's own system tz and the user's actual browser
 * tz whenever they differ (in practice: routinely, since this repo's dev sandbox runs on
 * `America/Chicago` while a test/production browser may be pinned to `UTC` or anything else) —
 * producing a genuine SSR/client hydration mismatch on every value downstream of `today`
 * (`DayNavigator`'s `max`, the date input's `value`, etc.), not just a cosmetic console warning.
 * This is the exact same class of problem `MetricForm.tsx`/`MealsView.tsx`/`TrendsView.tsx` already
 * solve with the established "mount-only Effect + matching placeholder" pattern, and this component
 * now follows the identical shape: `FoodDayView` (below) owns ONLY that resolution, rendering the
 * same "Loading…" placeholder on the server pass and the client's first pass (both see `tz`/`today`
 * as `null`) until the Effect resolves them — so there is nothing for server and client to
 * disagree about on first paint. Everything else (the day-log state machine, all the handlers, the
 * actual UI) is unchanged and now lives in `FoodDayViewContent`, which receives the already-
 * resolved `tz`/`today` as required (non-null) props — mirroring `MetricForm`'s own
 * `MetricForm`/`MetricEntryForm` split exactly, not a new pattern invented for this file.
 */
export type FoodDayViewProps = {
  /** `user_goals.daily_calorie_target`, read server-side by `food/page.tsx` (Phase 8j) — `null`
   * when the user hasn't set one. Threaded straight through to `DailyTotals`; this component makes
   * no decisions based on it itself. */
  calorieGoal?: number | null;
  /** `user_goals.daily_protein_target_g` — see `calorieGoal` above. */
  proteinGoal?: number | null;
};

export function FoodDayView({ calorieGoal = null, proteinGoal = null }: FoodDayViewProps) {
  const [tz, setTz] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);

  // Client-only: resolves the browser's actual timezone/date post-mount, avoiding the SSR/client
  // hydration mismatch described above. Reads a client-only browser API (Intl timezone) on mount;
  // there's no external subscription to attach a callback to instead, so the setState calls below
  // are justifiably synchronous — the same pattern MetricForm/MealsView/TrendsView already use.
  useEffect(() => {
    const resolvedTz = browserTimeZone();
    const resolvedToday = localDateInTz(new Date(), resolvedTz);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTz(resolvedTz);
    setToday(resolvedToday);
  }, []);

  // Same placeholder on the server pass and the client's first pass (both have tz === null),
  // which is what keeps hydration in sync — see the module doc comment above.
  if (tz === null || today === null) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  return (
    <FoodDayViewContent
      tz={tz}
      today={today}
      calorieGoal={calorieGoal}
      proteinGoal={proteinGoal}
    />
  );
}

/**
 * Everything `FoodDayView` used to own directly, unchanged, now receiving the already-resolved
 * `tz`/`today` as required props instead of computing them itself — see the file doc comment above
 * for why this split exists (the 2026-08-06 Phase 8d hydration-mismatch fix).
 */
function FoodDayViewContent({
  tz,
  today,
  calorieGoal,
  proteinGoal,
}: {
  tz: string;
  today: string;
  calorieGoal: number | null;
  proteinGoal: number | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [totals, setTotals] = useState<DailyFoodTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lastConsumedAt, setLastConsumedAt] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<FoodEntry | null>(null);
  const [, startTransition] = useTransition();
  // Forces a fresh mount of the "add" FoodEntryForm — both after a successful save (so the fields
  // clear even when two entries in a row share the same smart-defaulted consumed_at, which used to
  // leave the key, and therefore the form, unchanged — see handleSaved) and on an explicit "Clear".
  const [addFormResetNonce, setAddFormResetNonce] = useState(0);
  // Distinguishes *why* the add form is remounting, since the two cases want different starting
  // date/times: a post-save remount should still offer the same-sitting smart default (so adding
  // several items in a row keeps grouping together), while a "Clear" click means "start over" and
  // should show today's real time on the day being viewed, not resume whatever was just cleared.
  // Read only once, at the moment the freshly-keyed instance mounts (see FoodEntryForm's
  // `resetToNow` prop), so there's no need to reset it back after either case.
  const [resetReason, setResetReason] = useState<"save" | "clear">("save");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  // Bumped every time a NEW savedMessage is shown (Phase 8b) -- used as StatusMessage's `key` so a
  // repeated identical message forces a fresh mount (and so a fresh auto-dismiss timer) instead of
  // silently inheriting whatever remained of the previous occurrence's timer (a real, previously-
  // unknown bug fixed alongside the pill->banner restyle -- see ai-context/DECISIONS.md).
  const [savedMessageNonce, setSavedMessageNonce] = useState(0);
  // Phase 8 -- surfaces a failure from "Log again"/"Copy this day"/"Copy this group", none of
  // which go through useActionState (copyFoodEntries takes a plain object, not FormData, per
  // design doc §3.3) so there's no per-field error slot to render them into the way the form-backed
  // actions do.
  const [actionError, setActionError] = useState<string | null>(null);

  // Phase 8b -- multi-select. Declared here (not in FoodEntryList) so a background refresh can
  // never destroy it -- see the module doc comment above and ai-context/DECISIONS.md's "Phase 8b
  // designed..." entry.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"copy" | "save" | null>(null);

  // Phase 8k -- "The /food day-action surface". Which day-level panel (if any) is open, driven
  // ONLY by the user's own clicks -- never by `loading`, a fetch nonce, `entries.length`, or the
  // selection (the standing N-3/Phase 8b unmount rule, restated here because moving this state to
  // a new owner is exactly the moment it gets re-derived wrong -- see
  // ai-context/DECISIONS.md's "The /food day-action surface..." entry). `DayActionBar` renders the
  // three triggers with NO panel of its own; this is the single slot deciding which panel (if any)
  // renders as a SIBLING beneath it -- the same shape `FoodEntryList.groupAction` and
  // `MealList.cardAction` already use, so opening one closes any other for free.
  const [dayAction, setDayAction] = useState<"logMeal" | "copyDay" | null>(null);

  // The EFFECTIVE selection: intersected against the currently-loaded entries, so an id that
  // vanished out-of-band (deleted elsewhere, then a refresh pulls in the change) simply drops out
  // of the count/bulk-action input instead of the whole bulk action failing with a confusing
  // "entries not found" (design doc §3.4, "the effective selection is derived by intersecting...").
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedIds.has(entry.id)),
    [entries, selectedIds],
  );

  function showSavedMessage(message: string) {
    setSavedMessage(message);
    setSavedMessageNonce((n) => n + 1);
  }

  // Auto-dismiss a copy/log-again error the same way it always has (this is an ERROR, not a
  // success message, so it's deliberately NOT routed through StatusMessage -- see design doc §3.4's
  // "Transient success feedback", which only restyles confirmations).
  useEffect(() => {
    if (!actionError) return;
    const timeout = setTimeout(() => setActionError(null), 6000);
    return () => clearTimeout(timeout);
  }, [actionError]);

  const refresh = useCallback(
    async (date: string) => {
      setLoading(true);
      setLoadError(false);
      try {
        const [entriesRes, totalsRes] = await Promise.all([
          supabase
            .from("food_entries")
            .select("*")
            .eq("consumed_local_date", date)
            .order("consumed_at", { ascending: true })
            .abortSignal(queryTimeoutSignal()),
          supabase
            .from("daily_food_totals")
            .select("*")
            .eq("consumed_local_date", date)
            .abortSignal(queryTimeoutSignal())
            .maybeSingle(),
        ]);
        if (entriesRes.error || totalsRes.error) {
          setLoadError(true);
        } else {
          setEntries((entriesRes.data ?? []) as FoodEntry[]);
          setTotals((totalsRes.data ?? null) as DailyFoodTotals | null);
        }
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    },
    [supabase],
  );

  // Fetch-on-mount / fetch-on-dependency-change is React's own documented Effect use case
  // (https://react.dev/learn/synchronizing-with-effects#fetching-data). `refresh` calls
  // `setLoading(true)` synchronously (before its first `await`) so the UI can show a loading
  // state immediately — the newer `react-hooks/set-state-in-effect` rule flags any setState it
  // can trace as reachable synchronously from an Effect body, with no exception for that
  // legitimate case; there's no data-fetching library in this stack (not part of the design doc)
  // to move this into instead, so this is a deliberate, justified suppression rather than a
  // pattern this project otherwise avoids.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh(selectedDate);
  }, [selectedDate, refresh]);

  function handleDayChange(date: string) {
    // Changing the selected day resets the smart default to null (floor-of-now on that day),
    // regardless of what the newly-selected day already contains — §3.4's edge cases. This lives
    // in the event handler (not an effect) since it's a direct response to the user's own action.
    setLastConsumedAt(null);
    setEditingEntry(null);
    setSavedMessage(null);
    // Phase 8b -- the one existing choke point for "day changed" also clears the selection: stale
    // ids from a different day must never silently survive into today's bulk action.
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkAction(null);
    // Phase 8k -- an open day panel (e.g. a picked "Copy to date") must not survive a day switch
    // either; this choke point already resets everything else this component's action UI owns.
    setDayAction(null);
    setSelectedDate(date);
  }

  function handleSaved(entry: FoodEntry) {
    const wasEditing = editingEntry !== null;
    // Only an *added* entry should move the "same sitting" smart-default forward -- editing an
    // existing entry (however old) isn't a new eating occasion, and letting it overwrite
    // lastConsumedAt could snap the next new entry's default time backward to whatever was just
    // edited, undoing forward progress from actual adds made earlier in the sitting.
    if (!wasEditing) {
      setLastConsumedAt(entry.consumed_at);
    }
    setEditingEntry(null);
    setResetReason("save");
    setAddFormResetNonce((n) => n + 1);
    showSavedMessage(wasEditing ? "Changes saved." : "Entry added.");
    refresh(selectedDate);
  }

  function handleClear() {
    setResetReason("clear");
    setAddFormResetNonce((n) => n + 1);
    setSavedMessage(null);
  }

  // 2026-08-07 (Phase 8g): "Delete" moves back onto the entry row -- an explicit reversal of
  // Phase 8d, not a bug report against it (ai-context/DECISIONS.md, "Delete returns to the
  // food-entry row..."). Jeff's read, after actually using the edit-form placement, is that "edit
  // an item in order to delete it" is an unintuitive extra step, not a safety feature. The mis-tap
  // risk Phase 8d was protecting against moves to a `window.confirm()` naming the entry, owned
  // HERE (not in FoodEntryList, the presentational list) -- mirroring MealList.handleDeleteMeal's
  // exact shape, the same pattern already used for this exact class of action.
  //
  // qa-review N-4 (Phase 8d, kept verbatim): the original version discarded deleteFoodEntry's
  // { ok, error } result and unconditionally cleared editingEntry -- so a FAILED delete silently
  // closed the user's open edit form while the entry survived untouched, with zero feedback. Still
  // routed through the same `actionError` channel every other action-failure already uses, and
  // `editingEntry` is only cleared on actual success -- and only when the just-deleted entry is the
  // one currently open for edit (new in Phase 8g: any row can now be deleted, not just the one
  // being edited, so a plain unconditional clear would be wrong).
  function handleDelete(entry: FoodEntry) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${entry.name}"? This can't be undone.`)
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteFoodEntry(entry.id);
      if (!result.ok) {
        // Never echo a raw Postgres error string verbatim to the UI (same posture as
        // friendlyCopyError and every other friendlyError in this codebase).
        setActionError(
          result.error === "unauthenticated"
            ? "You've been signed out — please log in again."
            : "Couldn't delete this entry. Please try again.",
        );
        return;
      }
      setActionError(null);
      if (editingEntry?.id === entry.id) {
        setEditingEntry(null);
      }
      refresh(selectedDate);
    });
  }

  // Phase 7b: saving a logged group as a meal is strictly read-only on food_entries (§3.3), so
  // there is nothing on this day to refetch -- just surface the existing transient confirmation,
  // the same mechanism a save/edit/meal-log already uses.
  function handleGroupSavedAsMeal(meal: Meal) {
    showSavedMessage(`Saved as "${meal.name}".`);
  }

  // Phase 7: logging a saved meal shares one `consumed_at` across its whole batch (already an
  // exact-timestamp meal group with no extra work — see `logMealForDay`'s doc comment), so it
  // updates the smart-default `lastConsumedAt` exactly like a single manual save does, letting a
  // subsequently-added item default into the same group.
  function handleMealLogged(entries: FoodEntry[]) {
    if (entries.length > 0) {
      setLastConsumedAt(entries[0].consumed_at);
    }
    setEditingEntry(null);
    // Phase 8k -- a successful log "spends" the day panel; close it, mirroring how a successful
    // day/group copy already closes CopyDayDialog's own panel below.
    setDayAction(null);
    showSavedMessage("Meal logged.");
    refresh(selectedDate);
  }

  // Phase 8 -- shared success handler for whole-day copies (CopyDayDialog), single-group copies
  // (CopyGroupDialog from a FoodEntryList group header), AND (Phase 8b) the multi-select "Copy
  // selected" bulk action -- all three funnel through the one shared copyFoodEntries primitive, so
  // one handler serves all of them. The copy may land on the day currently being viewed (refresh
  // it) or on a different date entirely (nothing on screen changed, so just confirm).
  // copyFoodEntries is a plain async function (not a `<form action>`), so this is called directly
  // from each dialog's own onCopied prop rather than reacted to via useActionState.
  function handleCopied(copiedEntries: FoodEntry[], toDate: string) {
    setActionError(null);
    showSavedMessage(
      `Copied ${copiedEntries.length} entr${copiedEntries.length === 1 ? "y" : "ies"} to ${formatDateLabel(toDate)}.`,
    );
    if (toDate === selectedDate) {
      refresh(selectedDate);
    }
  }

  // Phase 8b -- "Copy selected"/"Save selected as a meal" both clear the selection and exit select
  // mode on success (design doc §3.4: "the selection has been spent; leaving boxes ticked invites
  // an accidental second copy, which silently creates duplicate entries and has no undo").
  function handleBulkCopied(copiedEntries: FoodEntry[], toDate: string) {
    handleCopied(copiedEntries, toDate);
    handleExitSelectMode();
  }

  function handleBulkSaved(meal: Meal) {
    handleGroupSavedAsMeal(meal);
    handleExitSelectMode();
  }

  function toggleEntrySelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleExitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkAction(null);
  }

  function friendlyCopyError(error: string | null): string {
    switch (error) {
      case "no_entries":
        return "There's nothing to copy.";
      case "entries_not_found":
        return "Couldn't find that entry — try reloading the page and trying again.";
      case "future_date":
        return "You can't log an entry dated later than today.";
      case "unauthenticated":
        return "You've been signed out — please log in again.";
      default:
        // Never echo an unrecognized code or a raw Postgres error string verbatim to the UI (same
        // posture as SaveGroupAsMealDialog/CopyDayDialog/CopyGroupDialog's own friendlyError).
        return "Something went wrong. Please try again.";
    }
  }

  // Phase 8 -- "Log again": one tap re-logs a single past entry to right now (today's real clock
  // time, floored to the 15-minute grid like every other smart default in this app), via the
  // shared copyFoodEntries primitive -- always targets "now", regardless of which day is currently
  // being viewed (design doc §2: "one tap re-logs that exact entry ... to now, no pre-saving").
  //
  // N-4 fix (Phase 8b, qa note from Phase 8): when the day being viewed ISN'T today, nothing
  // visibly changes in the list (the new row lands on today, not the viewed day) so the toast now
  // names the destination -- mirroring handleCopied's own "Copied N entries to <date>." wording --
  // rather than leaving the user with no indication of where the entry went. The view deliberately
  // STAYS on the browsed day (switching it was considered and rejected, §4) -- naming the
  // destination is the fix, navigating is not.
  async function handleLogAgain(entry: FoodEntry) {
    setActionError(null);
    const floored = floorToQuarterHour(new Date());
    const toTime = `${String(floored.getHours()).padStart(2, "0")}:${String(floored.getMinutes()).padStart(2, "0")}`;

    const result = await copyFoodEntries({
      entryIds: [entry.id],
      toDate: today,
      toTime,
      toTz: tz,
    });

    if (!result.ok || !result.entries || result.entries.length === 0) {
      setActionError(friendlyCopyError(result.error));
      return;
    }

    const destinationNote =
      today === selectedDate ? "" : ` It was logged to ${formatDateLabel(today)}.`;
    showSavedMessage(`Logged "${entry.name}" again.${destinationNote}`);
    if (today === selectedDate) {
      // "Log again" is unrelated to any edit currently in progress -- unlike handleSaved/
      // handleMealLogged (which respond to *this* form's own submit), don't cancel it here.
      setLastConsumedAt(result.entries[0].consumed_at);
      refresh(selectedDate);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <DayNavigator id="food-day" value={selectedDate} today={today} onChange={handleDayChange} />

      <DailyTotals totals={totals} calorieGoal={calorieGoal} proteinGoal={proteinGoal} />

      {/* Phase 8k -- "The /food day-action surface". DayActionBar renders ONLY the three triggers,
          never a panel of its own; whichever panel is open (if any) renders as a SIBLING directly
          beneath it, never as DayActionBar's own child -- see DayActionBar.tsx's doc comment and
          ai-context/DECISIONS.md's "The /food day-action surface..." entry for the layout bug this
          structure fixes by construction. Hidden entirely while `selectMode` is true: "Select
          entries" and the other two triggers are mutually exclusive states of the same bar. */}
      {!selectMode && (
        <>
          <DayActionBar
            hasEntries={entries.length > 0}
            onOpenLogMeal={() => setDayAction("logMeal")}
            onOpenCopyDay={() => setDayAction("copyDay")}
            onEnterSelectMode={() => {
              setSelectMode(true);
              // Entering select mode closes any open day panel -- select mode and the day panels
              // are mutually exclusive (design doc §3.4).
              setDayAction(null);
            }}
          />
          {dayAction === "logMeal" && (
            <ActionPanel heading="Log a saved meal">
              <LogMealDialog
                selectedDate={selectedDate}
                today={today}
                tz={tz}
                onLogged={handleMealLogged}
                onCancel={() => setDayAction(null)}
              />
            </ActionPanel>
          )}
          {dayAction === "copyDay" && (
            <ActionPanel heading="Copy this day">
              <CopyDayDialog
                sourceDate={selectedDate}
                entries={entries}
                today={today}
                tz={tz}
                onCopied={(copiedEntries, toDate) => {
                  handleCopied(copiedEntries, toDate);
                  setDayAction(null);
                }}
                onCancel={() => setDayAction(null)}
              />
            </ActionPanel>
          )}
        </>
      )}

      {savedMessage && (
        <StatusMessage
          key={savedMessageNonce}
          message={savedMessage}
          autoDismissMs={SUCCESS_MESSAGE_MS}
          onDismiss={() => setSavedMessage(null)}
        />
      )}
      {actionError && <p className={errorTextClass}>{actionError}</p>}

      <FoodEntryForm
        key={editingEntry ? `edit-${editingEntry.id}` : `add-${selectedDate}-${addFormResetNonce}`}
        editingEntry={editingEntry}
        lastConsumedAt={lastConsumedAt}
        selectedDate={selectedDate}
        resetToNow={resetReason === "clear"}
        onSaved={handleSaved}
        onCancelEdit={() => setEditingEntry(null)}
        onClear={handleClear}
      />

      {/* Phase 8b -- hoisted structurally ABOVE the loading/error ternary below (not nested inside
          any of its branches), so select mode, the selection, and an open bulk expander can never
          be unmounted by a background refresh -- see the module doc comment.
          Phase 8k: the WHOLE of select mode is now ONE `ActionPanel`, not `EntrySelectionBar` plus
          a second, separately-ringed bulk panel underneath it -- level 3 of the emphasis ladder
          means "an action is waiting for you to finish it", and rendering it twice, nested, for one
          action would dilute that exactly as a permanently-accented toolbar would (the same
          reasoning that keeps `ActionPanel` off `FoodEntryForm`). Keyed on `bulkAction` so choosing
          a bulk action REMOUNTS this panel -- which is what makes `ActionPanel`'s own
          scroll-into-view + focus-first-control fire for the newly-opened FORM, not the bar. The
          heading names the step you're on. `bulkAction` (like `dayAction`/`selectMode` above)
          changes only from a user click, so this does not violate the N-3 unmount rule. */}
      {selectMode && (
        <ActionPanel
          key={bulkAction ?? "select"}
          heading={
            bulkAction === "copy"
              ? "Copy selected"
              : bulkAction === "save"
                ? "Save selected as a meal"
                : "Select entries"
          }
        >
          <EntrySelectionBar
            selectedCount={selectedEntries.length}
            onCopySelected={() => setBulkAction("copy")}
            onSaveSelectedAsMeal={() => setBulkAction("save")}
            onClear={() => setSelectedIds(new Set())}
            onDone={handleExitSelectMode}
            bulkFormOpen={bulkAction !== null}
          />
          {bulkAction === "copy" && (
            <CopyGroupDialog
              entries={selectedEntries}
              today={today}
              tz={tz}
              onCopied={handleBulkCopied}
              onCancel={() => setBulkAction(null)}
              submitLabel="Copy selected"
              noEntriesMessage="Nothing to copy — nothing is selected."
              entriesNotFoundMessage="Couldn't find those entries — try reselecting and copying again."
            />
          )}
          {bulkAction === "save" && (
            <SaveGroupAsMealDialog
              entries={selectedEntries}
              onSaved={handleBulkSaved}
              onCancel={() => setBulkAction(null)}
              noEntriesMessage="Nothing to save — nothing is selected."
              entriesNotFoundMessage="Couldn't find those entries — try reselecting and saving again."
            />
          )}
        </ActionPanel>
      )}

      {!hasLoadedOnce && loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : loadError ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">Couldn&apos;t load this day&apos;s entries.</p>
          <button
            type="button"
            onClick={() => refresh(selectedDate)}
            className="text-sm font-medium text-accent hover:text-accent/80"
          >
            Retry
          </button>
        </div>
      ) : (
        <FoodEntryList
          entries={entries}
          today={today}
          tz={tz}
          onEdit={setEditingEntry}
          onLogAgain={handleLogAgain}
          onDelete={handleDelete}
          onGroupSavedAsMeal={handleGroupSavedAsMeal}
          onGroupCopied={handleCopied}
          editingEntryId={editingEntry ? editingEntry.id : null}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelected={toggleEntrySelected}
        />
      )}
    </div>
  );
}
