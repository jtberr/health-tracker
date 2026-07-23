/**
 * Pure, framework-free kg/lb conversion + formatting. No Next.js/React/Supabase imports —
 * primary unit-test target per AGENTS.md.
 *
 * Backs the kg/lb weight-unit preference (`user_goals.weight_unit`) per
 * ai-context/DECISIONS.md "Weight stored canonically in kg; kg/lb is a display/input toggle":
 * `daily_metrics.weight_kg` is ALWAYS kg in the database — the preference only ever affects
 * conversion at the input/display edge, here. Never store a converted value directly; convert on
 * the way in (`weightToKg`) and on the way out (`weightForDisplay`).
 */

export type WeightUnit = "kg" | "lb";

/** International avoirdupois pound, the standard kg-per-lb conversion factor. */
const KG_PER_LB = 0.45359237;

/** Display precision: one decimal place is the conventional granularity for a body-weight readout. */
const DISPLAY_DECIMALS = 1;

/** Storage precision: matches `daily_metrics.weight_kg numeric(5,2)`. */
const STORAGE_DECIMALS = 2;

/** Rounds `value` to `decimals` decimal places (standard half-up rounding via `Math.round`). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Converts a kilogram value to pounds. Pure arithmetic — no rounding. */
export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/** Converts a pound value to kilograms. Pure arithmetic — no rounding. */
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/**
 * Converts a user-entered weight (in `unit`) into the canonical kg value for storage, rounded to
 * the DB column's precision (`numeric(5,2)`). This is the *only* place a display-unit value should
 * be turned into what gets written to `daily_metrics.weight_kg`.
 */
export function weightToKg(value: number, unit: WeightUnit): number {
  const kg = unit === "lb" ? lbToKg(value) : value;
  return roundTo(kg, STORAGE_DECIMALS);
}

/**
 * Converts a canonical stored kg value into the value to show/prefill in `unit`, rounded to a
 * sensible display precision. The stored kg value itself is never mutated — this is a read-time
 * projection only.
 */
export function weightForDisplay(weightKg: number, unit: WeightUnit): number {
  const converted = unit === "lb" ? kgToLb(weightKg) : weightKg;
  return roundTo(converted, DISPLAY_DECIMALS);
}

/** Formats a canonical stored kg value as a `"<value> <unit>"` string in the given display unit. */
export function formatWeight(weightKg: number, unit: WeightUnit): string {
  return `${weightForDisplay(weightKg, unit)} ${unit}`;
}
