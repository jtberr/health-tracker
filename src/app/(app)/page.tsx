import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { TodaySummary } from "@/components/food/TodaySummary";

export const metadata: Metadata = { title: "Dashboard — Health Tracker" };

/**
 * Dashboard. Phase 3 ("Core food logging loop", docs/architecture/food-weight-tracker.md §8)
 * adds today's food totals (incl. day protein %) + a link into the full food log; weight/goals/
 * charts/lookup/meals/copy are still later phases per that section's scope.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Welcome back</h1>
        <p className="text-sm text-zinc-500">
          You&apos;re logged in as <span className="font-medium text-zinc-700">{user?.email}</span>.
        </p>
      </div>
      <TodaySummary />
    </div>
  );
}
