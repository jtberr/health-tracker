import type { Metadata } from "next";
import { getGoals } from "@/lib/actions/goals";
import { parseRangeParam } from "@/lib/domain/trends";
import { TrendsView } from "@/components/trends/TrendsView";

export const metadata: Metadata = { title: "Trends — Health Tracker" };

/**
 * Trend charts (design doc §3.1 `trends/page.tsx`, §8 Phase 5). The URL's `?range=` query param is
 * the source of truth for the selected range (not client state) — read here in the Server
 * Component and handed down as a plain prop, so a `RangeSelector` click (a `Link` to
 * `/trends?range=<n>`) round-trips through Next.js navigation rather than any local toggle state.
 * `weightUnit` and the calorie/protein goals come from the same "ensure-row" `getGoals()` Phase 4
 * already established; a `null` goal means "the user hasn't set one" (per `getGoals`'s default),
 * which `IntakeChart` uses to decide whether to draw that goal's `ReferenceLine` at all.
 */
export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range = parseRangeParam(Array.isArray(rangeParam) ? rangeParam[0] : rangeParam);
  const goals = await getGoals();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Trends</h1>
      <TrendsView
        range={range}
        weightUnit={goals?.weight_unit ?? "kg"}
        calorieGoal={goals?.daily_calorie_target ?? null}
        proteinGoal={goals?.daily_protein_target_g ?? null}
      />
    </div>
  );
}
