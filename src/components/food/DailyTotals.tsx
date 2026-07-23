import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { Card } from "@/components/ui/Card";
import type { DailyFoodTotals } from "@/lib/types";

/**
 * Day sum + day-level protein % (ratio-of-sums), read from the `daily_food_totals` DB view —
 * summed on read, never re-derived/denormalized in app code (AGENTS.md "What Not To Do").
 * Purely presentational: the caller (food/page, dashboard) fetches `totals` and passes it down.
 */
export function DailyTotals({ totals }: { totals: DailyFoodTotals | null }) {
  const calories = totals?.total_calories ?? 0;
  const proteinG = totals?.total_protein_g ?? 0;
  const pct = proteinCaloriePct(proteinG, calories);

  return (
    <Card className="grid grid-cols-3 divide-x divide-zinc-100 p-4 sm:p-5">
      <div className="flex flex-col gap-0.5 pr-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Calories</p>
        <p className="text-2xl font-semibold tracking-tight text-zinc-900">{calories}</p>
      </div>
      <div className="flex flex-col gap-0.5 px-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Protein</p>
        <p className="text-2xl font-semibold tracking-tight text-zinc-900">{proteinG}g</p>
      </div>
      <div className="flex flex-col gap-0.5 pl-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">% from protein</p>
        <p className="text-2xl font-semibold tracking-tight text-indigo-600">
          {pct === null ? "—" : `${pct}%`}
        </p>
      </div>
    </Card>
  );
}
