import Link from "next/link";
import { goalProgress } from "@/lib/domain/goal-progress";
import { proteinCaloriePct } from "@/lib/domain/nutrition";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { DailyFoodTotals } from "@/lib/types";

/**
 * Day sum + day-level protein % (ratio-of-sums), read from the `daily_food_totals` DB view —
 * summed on read, never re-derived/denormalized in app code (AGENTS.md "What Not To Do").
 * Purely presentational: the caller (`/food`'s `FoodDayView` — its only caller since Phase 8h
 * retired the dashboard) fetches `totals` and passes it down.
 *
 * **Goal-relative progress (2026-08-09/10 addition, Phase 8j)** — design doc §3.4 "Daily goal
 * progress on `/food`". Three cards in a responsive grid (was one card with divided columns):
 * Calories and Protein each get a thin `ProgressBar` + an "N of M · K remaining/over" caption
 * whenever that card's OWN target is set (independent per card — a user with only a calorie
 * target gets a calorie bar and an UNCHANGED protein card); "% from protein" never gets a bar or
 * caption, because there is no protein-% target to be relative to. A card whose target is `null`
 * renders byte-for-byte what it rendered before this phase (label + bold number only) — the
 * behaviour most likely to be got wrong, so it's the one this component is careful to preserve
 * exactly. When BOTH targets are unset (first-run), a single subtle "Set daily targets" link to
 * `/settings` appears once, below the grid — never per card, and never once the user has
 * deliberately set one target and left the other blank.
 *
 * `consumed` is always `daily_food_totals.total_calories`/`total_protein_g` — already summed on
 * read by the view; `goalProgress` adds no new summation logic of its own (AGENTS.md's standing
 * no-denormalised-computed-values rule — nothing here is stored).
 *
 * The over-target bar deliberately does NOT turn red: red is semantic-error in this palette, and
 * exceeding a calorie goal is not an error — see `ProgressBar`'s own doc comment.
 */
export type DailyTotalsProps = {
  totals: DailyFoodTotals | null;
  /** `user_goals.daily_calorie_target` — `null` when the user hasn't set one. */
  calorieGoal?: number | null;
  /** `user_goals.daily_protein_target_g` — `null` when the user hasn't set one. */
  proteinGoal?: number | null;
};

function goalCaption(progress: NonNullable<ReturnType<typeof goalProgress>>): string {
  const consumedStr = progress.consumed.toLocaleString();
  const targetStr = progress.target.toLocaleString();
  return progress.isOver
    ? `${consumedStr} of ${targetStr} · ${Math.abs(progress.remaining).toLocaleString()} over`
    : `${consumedStr} of ${targetStr} · ${progress.remaining.toLocaleString()} remaining`;
}

export function DailyTotals({ totals, calorieGoal = null, proteinGoal = null }: DailyTotalsProps) {
  const calories = totals?.total_calories ?? 0;
  const proteinG = totals?.total_protein_g ?? 0;
  const pct = proteinCaloriePct(proteinG, calories);

  const calorieProgress = goalProgress(calories, calorieGoal);
  const proteinProgress = goalProgress(proteinG, proteinGoal);

  // "Set daily targets" appears once, below the grid, only when NEITHER target is set -- never
  // when the user has deliberately set one and left the other blank.
  const showSetTargetsLink = calorieGoal === null && proteinGoal === null;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-2 p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Calories</p>
          <p className="text-2xl font-semibold tracking-tight text-ink">{calories}</p>
          {calorieProgress && (
            <>
              <ProgressBar barPct={calorieProgress.barPct} color="accent-warm" />
              <p className="text-xs text-muted">{goalCaption(calorieProgress)}</p>
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-2 p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Protein</p>
          <p className="text-2xl font-semibold tracking-tight text-ink">{proteinG}g</p>
          {proteinProgress && (
            <>
              <ProgressBar barPct={proteinProgress.barPct} color="accent" />
              <p className="text-xs text-muted">{goalCaption(proteinProgress)}</p>
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-2 p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">% from protein</p>
          <p className="text-2xl font-semibold tracking-tight text-accent">
            {pct === null ? "—" : `${pct}%`}
          </p>
        </Card>
      </div>
      {showSetTargetsLink && (
        <Link href="/settings" className="self-start text-xs font-medium text-accent hover:text-accent/80">
          Set daily targets
        </Link>
      )}
    </div>
  );
}
