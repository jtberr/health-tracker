"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { browserTimeZone, localDateInTz } from "@/lib/domain/datetime";
import { deleteFoodEntry } from "@/lib/actions/food";
import { inputClass, labelClass } from "@/components/ui/styles";
import { DailyTotals } from "./DailyTotals";
import { FoodEntryForm } from "./FoodEntryForm";
import { FoodEntryList } from "./FoodEntryList";
import { LogMealDialog } from "./LogMealDialog";
import type { DailyFoodTotals, FoodEntry, Meal } from "@/lib/types";

/**
 * Client-side orchestrator for the `/food` day log (design doc §3.1 `food/page.tsx`). Owns:
 * the selected day, the fetched entries/totals for that day, the "smart default" tracking
 * (`lastConsumedAt`, reset to `null` on a day change per §3.4's edge cases), and edit state.
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
 */
export function FoodDayView() {
  const supabase = useMemo(() => createClient(), []);
  const [tz] = useState(() => browserTimeZone());
  const today = useMemo(() => localDateInTz(new Date(), tz), [tz]);
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

  // Auto-dismiss the save confirmation after a few seconds.
  useEffect(() => {
    if (!savedMessage) return;
    const timeout = setTimeout(() => setSavedMessage(null), 4000);
    return () => clearTimeout(timeout);
  }, [savedMessage]);

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
    setSavedMessage(wasEditing ? "Changes saved." : "Entry added.");
    refresh(selectedDate);
  }

  function handleClear() {
    setResetReason("clear");
    setAddFormResetNonce((n) => n + 1);
    setSavedMessage(null);
  }

  function handleDelete(entry: FoodEntry) {
    startTransition(async () => {
      await deleteFoodEntry(entry.id);
      refresh(selectedDate);
    });
  }

  // Phase 7b: saving a logged group as a meal is strictly read-only on food_entries (§3.3), so
  // there is nothing on this day to refetch -- just surface the existing transient confirmation,
  // the same mechanism a save/edit/meal-log already uses.
  function handleGroupSavedAsMeal(meal: Meal) {
    setSavedMessage(`Saved as "${meal.name}".`);
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
    setSavedMessage("Meal logged.");
    refresh(selectedDate);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <label htmlFor="food-day" className={labelClass}>
          Day
        </label>
        <input
          id="food-day"
          type="date"
          max={today}
          value={selectedDate}
          onChange={(e) => handleDayChange(e.target.value)}
          className={inputClass}
        />
      </div>

      <DailyTotals totals={totals} />

      <LogMealDialog selectedDate={selectedDate} today={today} tz={tz} onLogged={handleMealLogged} />

      {savedMessage && (
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sage-pale px-3 py-1 text-xs font-medium text-ink">
          {savedMessage}
        </p>
      )}

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

      {!hasLoadedOnce && loading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : loadError ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">Couldn&apos;t load this day&apos;s entries.</p>
          <button
            type="button"
            onClick={() => refresh(selectedDate)}
            className="text-sm font-medium text-sage-deep hover:text-sage-deep/80"
          >
            Retry
          </button>
        </div>
      ) : (
        <FoodEntryList
          entries={entries}
          onEdit={setEditingEntry}
          onDelete={handleDelete}
          onGroupSavedAsMeal={handleGroupSavedAsMeal}
        />
      )}
    </div>
  );
}
