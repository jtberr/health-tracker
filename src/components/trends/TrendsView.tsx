"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { browserTimeZone, localDateInTz } from "@/lib/domain/datetime";
import {
  buildIntakeSeries,
  buildWeightSeries,
  startDateForRange,
  type IntakeSeriesPoint,
  type TrendRange,
  type WeightSeriesPoint,
} from "@/lib/domain/trends";
import type { DailyFoodTotals, DailyMetric, WeightUnit } from "@/lib/types";
import { RangeSelector } from "./RangeSelector";
import { WeightChart } from "./WeightChart";
import { IntakeChart } from "./IntakeChart";

/**
 * Client orchestrator for `/trends` (design doc §3.1 `trends/page.tsx`, §8 Phase 5). Owns: the
 * browser's tz/"today" (resolved the same mount-only-Effect way `MetricForm` does, to avoid an
 * SSR/client hydration mismatch — see that component's doc comment), the date window derived from
 * the `range` prop (itself sourced from the URL's `?range=` via `trends/page.tsx` +
 * `RangeSelector`), and the fetched+built chart series.
 *
 * Reads go through the RLS-scoped *browser* Supabase client, not a Server Component fetch — same
 * rationale as `FoodDayView`/`MetricForm`/`TodaySummary`: the end of the date window is "today in
 * the user's local timezone", which the server can't determine reliably, so this whole view is
 * inherently client-driven. `getWeightSeries`/`getIntakeSeries` below are the functions named in
 * the design doc's §8 Phase 5 "In" bullet; they live here (not a separate query-layer module),
 * mirroring how the earlier phases' equivalent reads were inlined next to the client component
 * that needs them rather than factored into a shared data-access file.
 */

type SupabaseBrowserClient = ReturnType<typeof createClient>;

async function getWeightSeries(
  supabase: SupabaseBrowserClient,
  startDate: string,
  endDate: string,
): Promise<{ series: WeightSeriesPoint[]; error: boolean }> {
  const { data, error } = await supabase
    .from("daily_metrics")
    .select("*")
    .gte("metric_date", startDate)
    .lte("metric_date", endDate)
    .order("metric_date", { ascending: true });
  if (error) return { series: [], error: true };
  return { series: buildWeightSeries((data ?? []) as DailyMetric[], startDate, endDate), error: false };
}

async function getIntakeSeries(
  supabase: SupabaseBrowserClient,
  startDate: string,
  endDate: string,
): Promise<{ series: IntakeSeriesPoint[]; error: boolean }> {
  const { data, error } = await supabase
    .from("daily_food_totals")
    .select("*")
    .gte("consumed_local_date", startDate)
    .lte("consumed_local_date", endDate)
    .order("consumed_local_date", { ascending: true });
  if (error) return { series: [], error: true };
  return {
    series: buildIntakeSeries((data ?? []) as DailyFoodTotals[], startDate, endDate),
    error: false,
  };
}

export type TrendsViewProps = {
  range: TrendRange;
  weightUnit: WeightUnit;
  calorieGoal: number | null;
  proteinGoal: number | null;
};

export function TrendsView({ range, weightUnit, calorieGoal, proteinGoal }: TrendsViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [today, setToday] = useState<string | null>(null);
  const [weightSeries, setWeightSeries] = useState<WeightSeriesPoint[]>([]);
  const [intakeSeries, setIntakeSeries] = useState<IntakeSeriesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Client-only: resolves the browser's actual "today" post-mount, avoiding the SSR/client
  // hydration mismatch `MetricForm` documents (this component renders once on the server under
  // the server's tz before hydrating under the browser's real one).
  useEffect(() => {
    const resolvedTz = browserTimeZone();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(localDateInTz(new Date(), resolvedTz));
  }, []);

  // Fetch-on-mount / fetch-on-dependency-change — same justified pattern/suppression as
  // `FoodDayView`/`MetricForm` (see their doc comments): no data-fetching library in this stack.
  useEffect(() => {
    if (today === null) return;
    const startDate = startDateForRange(today, range);
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [weightResult, intakeResult] = await Promise.all([
          getWeightSeries(supabase, startDate, today),
          getIntakeSeries(supabase, startDate, today),
        ]);
        if (cancelled) return;
        if (weightResult.error || intakeResult.error) {
          setLoadError(true);
        } else {
          setWeightSeries(weightResult.series);
          setIntakeSeries(intakeResult.series);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, today, range, retryCount]);

  return (
    <div className="flex flex-col gap-6">
      <RangeSelector range={range} />

      {today === null || loading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : loadError ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">Couldn&apos;t load trend data.</p>
          <button
            type="button"
            onClick={() => setRetryCount((n) => n + 1)}
            className="text-sm font-medium text-sage-deep hover:text-sage-deep/80"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <WeightChart series={weightSeries} weightUnit={weightUnit} />
          <IntakeChart series={intakeSeries} calorieGoal={calorieGoal} proteinGoal={proteinGoal} />
        </>
      )}
    </div>
  );
}
