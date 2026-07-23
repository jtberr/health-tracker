"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { browserTimeZone, localDateInTz } from "@/lib/domain/datetime";
import { deleteFoodEntry } from "@/lib/actions/food";
import { DailyTotals } from "./DailyTotals";
import { FoodEntryForm } from "./FoodEntryForm";
import { FoodEntryList } from "./FoodEntryList";
import type { DailyFoodTotals, FoodEntry } from "@/lib/types";

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
 */
export function FoodDayView() {
  const supabase = useMemo(() => createClient(), []);
  const [tz] = useState(() => browserTimeZone());
  const today = useMemo(() => localDateInTz(new Date(), tz), [tz]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [totals, setTotals] = useState<DailyFoodTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastConsumedAt, setLastConsumedAt] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<FoodEntry | null>(null);
  const [, startTransition] = useTransition();

  const refresh = useCallback(
    async (date: string) => {
      setLoading(true);
      const [entriesRes, totalsRes] = await Promise.all([
        supabase
          .from("food_entries")
          .select("*")
          .eq("consumed_local_date", date)
          .order("consumed_at", { ascending: true }),
        supabase.from("daily_food_totals").select("*").eq("consumed_local_date", date).maybeSingle(),
      ]);
      setEntries((entriesRes.data ?? []) as FoodEntry[]);
      setTotals((totalsRes.data ?? null) as DailyFoodTotals | null);
      setLoading(false);
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
    setSelectedDate(date);
  }

  function handleSaved(entry: FoodEntry) {
    setLastConsumedAt(entry.consumed_at);
    setEditingEntry(null);
    refresh(selectedDate);
  }

  function handleDelete(entry: FoodEntry) {
    startTransition(async () => {
      await deleteFoodEntry(entry.id);
      refresh(selectedDate);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <label htmlFor="food-day" className="text-sm font-medium text-zinc-700">
          Day
        </label>
        <input
          id="food-day"
          type="date"
          max={today}
          value={selectedDate}
          onChange={(e) => handleDayChange(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <DailyTotals totals={totals} />

      <FoodEntryForm
        key={editingEntry ? `edit-${editingEntry.id}` : `add-${selectedDate}-${lastConsumedAt ?? "none"}`}
        editingEntry={editingEntry}
        lastConsumedAt={lastConsumedAt}
        selectedDate={selectedDate}
        onSaved={handleSaved}
        onCancelEdit={() => setEditingEntry(null)}
      />

      {loading ? (
        <p className="text-sm text-zinc-500">Loading...</p>
      ) : (
        <FoodEntryList entries={entries} onEdit={setEditingEntry} onDelete={handleDelete} />
      )}
    </div>
  );
}
