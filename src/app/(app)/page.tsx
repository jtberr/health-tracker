import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard — Health Tracker" };

/**
 * Placeholder dashboard. Phase 1 ("Foundation", docs/architecture/food-weight-tracker.md §8) is
 * explicitly scoped to auth + routing only — no tables, tracking data, or feature UI yet. This
 * page exists so the auth gate in `(app)/layout.tsx` has somewhere to land a logged-in user;
 * today's totals / quick-add (per the design doc's eventual dashboard) arrive in later phases.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-zinc-900">Welcome back</h1>
      <p className="text-sm text-zinc-600">
        You&apos;re logged in as <span className="font-medium">{user?.email}</span>. Food, weight,
        and body-fat tracking land in later implementation phases.
      </p>
    </div>
  );
}
