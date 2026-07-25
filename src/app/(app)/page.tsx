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
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="text-sm text-stone-500">
          You&apos;re logged in as <span className="font-medium text-stone-700">{user?.email}</span>.
        </p>
      </div>
      <div className="relative overflow-hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 400 160"
          className="pointer-events-none absolute -right-10 -top-16 h-56 w-96 text-sage"
        >
          <path
            d="M0 120 C 100 20, 260 20, 400 100"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.3"
          />
        </svg>
        <TodaySummary />
      </div>
    </div>
  );
}
