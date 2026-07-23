"use client";

import { useActionState, useEffect, useId, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { deleteDailyMetric, upsertDailyMetric, type DailyMetricActionState } from "@/lib/actions/metrics";
import { browserTimeZone, localDateInTz } from "@/lib/domain/datetime";
import { weightForDisplay } from "@/lib/domain/units";
import type { DailyMetric, WeightUnit } from "@/lib/types";

/**
 * Weight + body-fat daily entry (design doc §3.1 `metrics/MetricForm.tsx`, §8 Phase 4): date
 * (`max=today`, no time-of-day field — `daily_metrics` has no per-row timezone/time column,
 * unlike `food_entries`), weight (in the user's `weightUnit` preference, converted to canonical kg
 * on submit via `lib/domain/units.ts`), and optional body fat %. One row per user per day —
 * `upsertDailyMetric` overwrites an existing day rather than creating a second row, so picking an
 * already-logged date pre-fills that day's values and an explicit "Delete" removes it.
 *
 * Reads (fetching whether the selected day already has an entry) go through the RLS-scoped
 * *browser* Supabase client rather than a Server Component fetch — same rationale as Phase 3's
 * `FoodDayView`: the date picker's `max=today` and the day being edited are inherently
 * browser-timezone-driven, and the day-switching state here is client state regardless.
 *
 * `tz`/`today` are deliberately resolved in a mount-only Effect rather than during render: this
 * component is a Client Component, but Next.js still renders it once on the server (SSR) before
 * hydrating on the client, and `browserTimeZone()` would disagree between the server's tz and the
 * user's actual browser tz — producing a hydration mismatch on the date input's `max`/`value`
 * whenever the two differ (routinely true near a user's local midnight, always true for far-UTC
 * users). Rendering the same "resolving..." placeholder on both the server pass and the client's
 * first pass keeps hydration in sync; the real, browser-accurate date only appears after mount.
 */

const initialActionState: DailyMetricActionState = { ok: false, error: null };

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export type MetricFormProps = {
  /** The user's current display/input unit preference (`user_goals.weight_unit`). */
  weightUnit: WeightUnit;
};

export function MetricForm({ weightUnit }: MetricFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const [tz, setTz] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [existing, setExisting] = useState<DailyMetric | null>(null);
  const [loading, setLoading] = useState(true);

  // Client-only: resolves the browser's actual timezone/date post-mount, avoiding an SSR/client
  // hydration mismatch (see the module doc comment above).
  // Reads a client-only browser API (Intl timezone) on mount; there's no external subscription
  // to attach a callback to instead, so the setState calls below are justifiably synchronous.
  useEffect(() => {
    const resolvedTz = browserTimeZone();
    const resolvedToday = localDateInTz(new Date(), resolvedTz);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTz(resolvedTz);
    setToday(resolvedToday);
    setSelectedDate(resolvedToday);
  }, []);

  // Fetch-on-mount / fetch-on-dependency-change (React's own documented Effect use case:
  // https://react.dev/learn/synchronizing-with-effects#fetching-data). Same justified
  // `react-hooks/set-state-in-effect` suppression as Phase 3's `FoodDayView` — this project has
  // no data-fetching library to move the synchronous `setLoading(true)` into instead.
  useEffect(() => {
    if (selectedDate === null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    supabase
      .from("daily_metrics")
      .select("*")
      .eq("metric_date", selectedDate)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setExisting((data ?? null) as DailyMetric | null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedDate]);

  function refetch() {
    if (selectedDate === null) return;
    setLoading(true);
    supabase
      .from("daily_metrics")
      .select("*")
      .eq("metric_date", selectedDate)
      .maybeSingle()
      .then(({ data }) => {
        setExisting((data ?? null) as DailyMetric | null);
        setLoading(false);
      });
  }

  // Same placeholder on the server pass and the client's first pass (both have tz === null),
  // which is what keeps hydration in sync — see the module doc comment.
  if (tz === null || today === null || selectedDate === null) {
    return <p className="text-sm text-zinc-500">Loading...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <label htmlFor="metric-day" className="text-sm font-medium text-zinc-700">
          Day
        </label>
        <input
          id="metric-day"
          type="date"
          max={today}
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading...</p>
      ) : (
        <MetricEntryForm
          key={selectedDate}
          selectedDate={selectedDate}
          today={today}
          tz={tz}
          weightUnit={weightUnit}
          existing={existing}
          onSaved={(metric) => setExisting(metric)}
          onDeleted={() => refetch()}
        />
      )}
    </div>
  );
}

/**
 * Keyed by `selectedDate` from the parent so switching days remounts this with a fresh
 * `useActionState` and fresh local input state — the same "reset state with a key" pattern
 * Phase 3's `FoodDayView` uses for `FoodEntryForm`, rather than an effect imperatively resetting
 * a handful of fields (https://react.dev/learn/preserving-and-resetting-state).
 */
function MetricEntryForm({
  selectedDate,
  today,
  tz,
  weightUnit,
  existing,
  onSaved,
  onDeleted,
}: {
  selectedDate: string;
  today: string;
  tz: string;
  weightUnit: WeightUnit;
  existing: DailyMetric | null;
  onSaved: (metric: DailyMetric) => void;
  onDeleted: () => void;
}) {
  const [state, formAction] = useActionState(upsertDailyMetric, initialActionState);
  const [isDeleting, startDeleteTransition] = useTransition();
  const idPrefix = useId();

  const [weight, setWeight] = useState(() =>
    existing ? String(weightForDisplay(existing.weight_kg, weightUnit)) : "",
  );
  const [bodyFatPct, setBodyFatPct] = useState(() =>
    existing?.body_fat_pct != null ? String(existing.body_fat_pct) : "",
  );

  useEffect(() => {
    if (state.ok && state.metric) {
      onSaved(state.metric);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleDelete() {
    if (!existing) return;
    startDeleteTransition(async () => {
      await deleteDailyMetric(existing.id);
      onDeleted();
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4" noValidate>
      <input type="hidden" name="metricDate" value={selectedDate} />
      <input type="hidden" name="metricTz" value={tz} />
      <input type="hidden" name="weightUnit" value={weightUnit} />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-weight`} className="text-sm font-medium text-zinc-700">
            Weight ({weightUnit})
          </label>
          <input
            id={`${idPrefix}-weight`}
            name="weight"
            type="number"
            step="any"
            min={0}
            required
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {state.fieldErrors?.weight && <p className="text-sm text-red-600">{state.fieldErrors.weight}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-bodyfat`} className="text-sm font-medium text-zinc-700">
            Body fat % (optional)
          </label>
          <input
            id={`${idPrefix}-bodyfat`}
            name="bodyFatPct"
            type="number"
            step="any"
            min={0}
            max={100}
            value={bodyFatPct}
            onChange={(e) => setBodyFatPct(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          {state.fieldErrors?.bodyFatPct && (
            <p className="text-sm text-red-600">{state.fieldErrors.bodyFatPct}</p>
          )}
        </div>
      </div>

      {state.error && state.error !== "future_date" && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
      {state.error === "future_date" && (
        <p className="text-sm text-red-600">
          You can&apos;t log a metric dated later than today. Pick today or an earlier date.
        </p>
      )}

      {existing && (
        <p className="text-xs text-zinc-500">
          Already logged for {selectedDate === today ? "today" : "this day"} — saving overwrites it.
        </p>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton label={existing ? "Save changes" : "Log entry"} pendingLabel="Saving..." />
        {existing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete this day's entry"}
          </button>
        )}
      </div>
    </form>
  );
}
