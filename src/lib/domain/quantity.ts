/**
 * Pure, framework-free quantity/unit/per-unit <-> total conversion. No Next.js/React/Supabase
 * imports — primary unit-test target per AGENTS.md.
 *
 * Backs the two manual food-entry input modes (see ai-context/DECISIONS.md "Quantity + unit as
 * first-class fields ..."): type per-unit values directly, or type a *total* for the current
 * quantity and convert it to per-unit here before saving. Either mode writes the exact same
 * storage shape (`calories_per_unit` / `protein_g_per_unit` + `quantity`), which is what makes a
 * later quantity edit always recompute the stored total correctly regardless of which mode
 * created the row (the DB's generated `calories`/`protein_g` columns do that recompute).
 */

/** `quantity * perUnit` — the same arithmetic the DB's generated columns perform. */
export function lineTotal(quantity: number, perUnit: number): number {
  return quantity * perUnit;
}

/**
 * `total / quantity` — converts a typed *total* (for the current quantity) into the per-unit
 * value that's actually stored. `quantity` must be > 0 (the DB's `food_entries`/`meal_items`
 * CHECK constraint already requires this); as a defensive default for a quantity that hasn't
 * passed validation yet, this returns 0 rather than `Infinity`/`NaN` from dividing by zero.
 */
export function perUnitFromTotal(total: number, quantity: number): number {
  if (!(quantity > 0)) return 0;
  return total / quantity;
}
