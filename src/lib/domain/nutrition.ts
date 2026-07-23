/**
 * Pure, framework-free "% of calories from protein" math. No Next.js/React/Supabase imports —
 * primary unit-test target per AGENTS.md.
 *
 * One function serves the per-entry, per-group, and per-day figures (see
 * docs/architecture/food-weight-tracker.md §2/§3.3): callers pass either a single entry's
 * protein/calories, or the *sum* of a group/day's protein/calories for the ratio-of-sums rollup
 * — ratio-of-sums, not an average of per-entry percentages (see
 * ai-context/DECISIONS.md "'% of calories from protein' metric ...").
 */

/** Conventional protein-calorie conversion: 4 kcal per gram of protein. */
const KCAL_PER_GRAM_PROTEIN = 4;

/**
 * Display precision for the returned percentage. Rounding lives here (not in the caller) so
 * every render site — per-entry, per-group, per-day — shows a consistently-rounded figure from
 * one place.
 */
const DISPLAY_DECIMALS = 1;

/**
 * `(proteinG * 4) / calories * 100`, rounded to `DISPLAY_DECIMALS`. Returns `null` when
 * `calories` is 0 (the ratio is undefined) — callers render `—`. Values over 100% (possible with
 * inconsistent source data, e.g. protein calories exceeding total calories) are returned as-is,
 * not clamped — see ai-context/DECISIONS.md and §5 "Risks & Open Questions".
 */
export function proteinCaloriePct(proteinG: number, calories: number): number | null {
  if (calories === 0) return null;
  const pct = (proteinG * KCAL_PER_GRAM_PROTEIN) / calories * 100;
  const factor = 10 ** DISPLAY_DECIMALS;
  return Math.round(pct * factor) / factor;
}
