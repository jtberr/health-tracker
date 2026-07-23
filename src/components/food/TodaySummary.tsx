"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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

  useEffect(() => {
    const today = localDateInTz(new Date(), browserTimeZone());
    let cancelled = false;
    supabase
      .from("daily_food_totals")
      .select("*")
      .eq("consumed_local_date", today)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setTotals((data ?? null) as DailyFoodTotals | null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">Today so far</h2>
        <Link href="/food" className="text-sm font-medium text-zinc-900 underline">
          Log food
        </Link>
      </div>
      {loading ? <p className="text-sm text-zinc-500">Loading...</p> : <DailyTotals totals={totals} />}
    </div>
  );
}
