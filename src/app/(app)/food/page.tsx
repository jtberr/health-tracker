import type { Metadata } from "next";
import { getGoals } from "@/lib/actions/goals";
import { FoodDayView } from "@/components/food/FoodDayView";

export const metadata: Metadata = { title: "Food log — Health Tracker" };

/**
 * Food log for a selected day (design doc §3.1/§8 Phase 3): add/edit/delete entries, grouped by
 * exact-`consumed_at` meal group, with day totals. All the interactive/day-switching/smart-default
 * logic lives in the client `FoodDayView` — see its doc comment for why reads happen there rather
 * than in this Server Component.
 *
 * **Goals read (2026-08-09/10 addition, Phase 8j)** — `getGoals()`, the same "ensure-row"
 * Server Action `/settings`/`/trends` already use, called here (making this component `async`)
 * rather than added to `FoodDayView`'s client `Promise.all`: goals don't depend on the browser's
 * local "today" the way every other `/food` read does, can't be changed from this screen, and
 * would otherwise be refetched on every day change for a value that changes monthly. See
 * ai-context/DECISIONS.md's Phase 8j entry for the full reasoning, including the deliberate
 * asymmetry with Phase 8h's client-read "last logged weight" line on `/metrics`.
 */
export default async function FoodPage() {
  const goals = await getGoals();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Food log</h1>
      <FoodDayView
        calorieGoal={goals?.daily_calorie_target ?? null}
        proteinGoal={goals?.daily_protein_target_g ?? null}
      />
    </div>
  );
}
