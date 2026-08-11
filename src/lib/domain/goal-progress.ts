/**
 * Pure, framework-free daily-goal progress math (Phase 8j, 2026-08-09/10 addition —
 * docs/architecture/food-weight-tracker.md §3.4 "Daily goal progress on `/food`";
 * ai-context/DECISIONS.md's "Daily calorie/protein goal progress surfaces in `DailyTotals`..."
 * entry). No Next.js/React/Supabase imports — primary unit-test target per AGENTS.md.
 *
 * `consumed` is always `daily_food_totals.total_calories`/`total_protein_g` — already summed on
 * read by the DB view (AGENTS.md's standing "no denormalised computed values" rule; this module
 * adds no new summation logic of its own).
 */

export type GoalProgress = {
  consumed: number;
  target: number;
  /** target - consumed. SIGNED — negative when over target (the wording, e.g. "320 over" vs.
   * "760 remaining", lives in the component, not here). */
  remaining: number;
  /** consumed/target*100, rounded to a whole number, UNCLAMPED. Deliberately unlike
   * `proteinCaloriePct`'s one decimal place -- this is a rough "how far along am I", not a ratio
   * compared precisely across meals. */
  pct: number;
  /** `pct` clamped to 0..100 -- feeds the progress bar's WIDTH only. A bar cannot render past
   * 100%, but the TEXT must stay truthful, which is why this is a separate field from `pct` rather
   * than one clamped number (see the module doc comment below and the DECISIONS entry for the full
   * "why two fields" reasoning -- the same stance already taken for `proteinCaloriePct`, which
   * returns >100% as-is rather than clamping). */
  barPct: number;
  /** true when `consumed > target` (strictly over) -- exactly ON target is NOT over. */
  isOver: boolean;
};

/**
 * Returns `null` when `target` is `null`, zero, or negative -- so a nonsensical stored target
 * degrades to the plain no-goal treatment (the caller renders exactly what it renders with no goal
 * set at all) instead of dividing by zero or producing an infinite/negative-width bar. Three
 * separate guard cases on purpose: a naive `if (!target) return null` would correctly catch `null`
 * and `0` but let a negative target (never expected from the app's own `/settings` form, which
 * enforces `min={0}`, but not something this pure function should trust blindly) through to divide
 * by a negative number and produce a nonsensical negative `pct`/`barPct`.
 */
export function goalProgress(consumed: number, target: number | null): GoalProgress | null {
  if (target === null || target <= 0) {
    return null;
  }

  const remaining = target - consumed;
  const pct = Math.round((consumed / target) * 100);
  const barPct = Math.min(100, Math.max(0, pct));
  const isOver = consumed > target;

  return { consumed, target, remaining, pct, barPct, isOver };
}
