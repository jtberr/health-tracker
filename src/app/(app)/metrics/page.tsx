import type { Metadata } from "next";
import { getGoals } from "@/lib/actions/goals";
import { MetricForm } from "@/components/metrics/MetricForm";

export const metadata: Metadata = { title: "Weight & body fat — Health Tracker" };

/**
 * Weight + body-fat daily entry (design doc §3.1/§8 Phase 4). The weight-unit preference is
 * fetched here (Server Component, via the "ensure-row" `getGoals`) and passed down so `MetricForm`
 * knows which unit to display/accept input in — the day-switching/fetch-existing-entry logic
 * itself lives in the client `MetricForm` (see its doc comment for why, mirroring Phase 3's
 * `FoodDayView`).
 */
export default async function MetricsPage() {
  const goals = await getGoals();
  const weightUnit = goals?.weight_unit ?? "kg";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900">Weight &amp; body fat</h1>
      <MetricForm weightUnit={weightUnit} />
    </div>
  );
}
