"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { queryTimeoutSignal } from "@/lib/supabase/query-timeout";
import { browserTimeZone, localDateInTz } from "@/lib/domain/datetime";
import { DailyTotals } from "./DailyTotals";
import type { DailyFoodTotals } from "@/lib/types";

/**
 * Dashboard's "today's totals" summary (design doc §3.1 `(app)/page.tsx`: "today's totals (incl.
 * day protein %)"). Same client-fetch rationale as `FoodDayView` — "today" is a browser-timezone
 * question the server can't answer reliably.
 */
export function TodaySummary() {
  const supabase = useMemo(() => createClient(), []);
  const [totals, setTotals] = useState<DailyFoodTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const today = localDateInTz(new Date(), browserTimeZone());
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const { data, error } = await supabase
          .from("daily_food_totals")
          .select("*")
          .eq("consumed_local_date", today)
          .abortSignal(queryTimeoutSignal())
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setError(true);
        } else {
          setTotals((data ?? null) as DailyFoodTotals | null);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, retryCount]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-700">Today so far</h2>
        <Link href="/food" className="text-sm font-medium text-sage-deep hover:text-sage-deep/80">
          Log food →
        </Link>
      </div>
      {loading ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : error ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">Couldn&apos;t load today&apos;s totals.</p>
          <button
            type="button"
            onClick={() => setRetryCount((n) => n + 1)}
            className="text-sm font-medium text-sage-deep hover:text-sage-deep/80"
          >
            Retry
          </button>
        </div>
      ) : (
        <DailyTotals totals={totals} />
      )}
    </div>
  );
}
