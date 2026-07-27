/**
 * Pure, framework-free normalizers for the two food-lookup providers (Phase 6 — "Food lookup:
 * barcode + description search"). No Next.js/React/Supabase/network imports here — this module
 * only turns an already-fetched raw provider response into the app's one common `FoodCandidate`
 * shape. The actual HTTP calls live in `lib/lookup/openfoodfacts.ts` / `lib/lookup/usda.ts`
 * (server-only adapters), invoked only from the auth-gated `/api/lookup/*` Route Handlers — see
 * docs/architecture/food-weight-tracker.md §8 Phase 6 and AGENTS.md's Absolute Rules.
 *
 * A `FoodCandidate` deliberately mirrors `FoodCandidatePrefill` (lib/types.ts) — the seam
 * `FoodEntryForm` already exposed in Phase 3 — plus a couple of provenance fields (`source`,
 * `sourceId`) that the lookup UI can use for display/dedupe but that `FoodEntryForm` itself
 * ignores. Because `FoodCandidate` is a strict superset of `FoodCandidatePrefill`'s fields, a
 * picked candidate can be handed to `FoodEntryForm`'s `prefill`/pick handler as-is — no separate
 * mapping function needed.
 *
 * Both providers report nutrition for "some serving" of the food (a serving-size string / a
 * household serving, or a flat per-100g basis when no serving info exists). Rather than force
 * that serving into `quantity: 1`, each normalizer parses the serving's own quantity+unit (via
 * `unitFromServingLabel`) and divides down to a genuine *per-single-unit* figure
 * (`quantity.perUnitFromTotal`) — e.g. "2 tbsp" per-serving values are halved to a per-tbsp
 * figure, and a bare per-100g figure becomes "quantity 100, unit g, per-gram calories/protein".
 * This keeps every candidate in the same single storage model as manual entry (§4 "Quantity +
 * unit as first-class fields"): quantity is later freely editable and totals keep recalculating
 * correctly, regardless of what basis the source data used.
 *
 * "Candidates with no usable nutrition data should be dropped" (design doc §8 Phase 6): a
 * candidate is dropped (the normalizer returns `null`) when the raw response has no name, or no
 * finite, non-negative calorie figure at all (neither a per-serving nor a per-100g value). A
 * calorie value that is legitimately `0` (e.g. water) is NOT dropped — `0` is a valid, finite
 * number, distinct from "missing". A missing protein figure defaults to `0` rather than dropping
 * the candidate, since many real foods (oils, sugar, water) genuinely have ~0g protein and still
 * have usable calorie data worth prefilling.
 *
 * qa-reviewer N-2 (2026-07-26) hardened this rule after hostile-input testing found three ways a
 * *saveable but silently wrong* candidate could slip through instead of being dropped:
 * (a) a zero-quantity serving/household-serving label (e.g. `"0 g"`, `"0 cup"`) used to parse to
 *     `{ quantity: 0, ... }`, which then divided a real, non-zero source calorie/protein figure by
 *     zero-via-`perUnitFromTotal`'s defensive-zero path, producing a "0 kcal" candidate for a real
 *     food. Fixed at the root in `unitFromServingLabel`, which now rejects a zero quantity exactly
 *     like it already rejected a negative one — callers fall back to their normal "no parseable
 *     serving" basis instead.
 * (b) USDA's `servingSize: 0` (paired with a *parseable* household serving) similarly zeroed the
 *     scale factor (`servingSizeGrams / 100`). Fixed by requiring `servingSizeGrams > 0` (not just
 *     "present") before using the serving-scaled path — a zero/missing serving size now falls back
 *     to the flat per-100g basis instead.
 * (c) a negative calorie or protein figure (garbage/erroneous source data) previously passed
 *     straight through to a saveable candidate, relying on `validateFoodEntryInput`'s save-time
 *     rejection as the only backstop — which surfaces a confusing "can't be negative" error about a
 *     value the user never typed. Both normalizers now treat a negative calorie or protein figure
 *     as unusable at the source: Open Food Facts tries its other basis (serving vs. per-100g)
 *     before giving up; USDA (which only has one basis) drops the candidate outright.
 */

import { perUnitFromTotal } from "./quantity";

export type FoodLookupSource = "openfoodfacts" | "usda";

/** The one common shape both providers' raw responses normalize into. */
export type FoodCandidate = {
  source: FoodLookupSource;
  /** The barcode (Open Food Facts) or FDC id (USDA) the candidate was resolved from. */
  sourceId: string;
  name: string;
  quantity: number;
  unit: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
};

/** A serving-size string parsed into a leading quantity + a following unit word/phrase. */
export type ParsedServing = { quantity: number; unit: string };

const SERVING_LABEL_PATTERN = /^(\d+(?:\.\d+)?)\s*([a-zA-Z][a-zA-Z .]*?)\s*(?:\(.*\))?$/;

/**
 * Parses a human serving-size label like `"1 cup (240 ml)"`, `"2 tbsp"`, `"30 g"`, or `"100g"`
 * into `{ quantity, unit }`. Returns `null` when the label is missing/blank or doesn't start with
 * a number (e.g. `"Serving"`, `"per container"`) — there's nothing usable to prefill quantity/unit
 * from in that case, and callers fall back to a flat per-100g/per-serving-as-one-unit basis.
 * Any trailing parenthetical (an alternate-unit annotation, e.g. "(240 ml)") is ignored.
 */
export function unitFromServingLabel(label: string | null | undefined): ParsedServing | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;

  const match = SERVING_LABEL_PATTERN.exec(trimmed);
  if (!match) return null;

  const quantity = Number(match[1]);
  const unit = match[2].replace(/\s+/g, " ").trim().toLowerCase();
  // A zero quantity is rejected exactly like a negative one (the pattern itself can't match a
  // leading "-", so only zero needs an explicit check here): "0 g"/"0 cup" is not a usable
  // quantity to divide a real nutrition figure by (qa-reviewer N-2) -- callers fall back to their
  // normal "no parseable serving" basis instead of silently zeroing real data.
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit) return null;

  return { quantity, unit };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// --- Open Food Facts -------------------------------------------------------------------------

type OpenFoodFactsProduct = {
  product_name?: unknown;
  product_name_en?: unknown;
  brands?: unknown;
  serving_size?: unknown;
  nutriments?: unknown;
};

/**
 * Normalizes a single Open Food Facts `product` object (the `.product` field of a successful
 * `GET /api/v2/product/<barcode>.json` response — the caller/adapter is responsible for the
 * `status !== 1` "not found" case, which never reaches this function). Prefers
 * `energy-kcal_serving`/`proteins_serving` (scaled to a genuine per-unit figure via the parsed
 * `serving_size`); falls back to `energy-kcal_100g`/`proteins_100g` (quantity 100, unit "g") when
 * no per-serving figure is present. Returns `null` when neither basis has a usable calorie value,
 * or when the product has no usable name.
 */
export function normalizeOpenFoodFactsProduct(rawProduct: unknown, barcode: string): FoodCandidate | null {
  if (!rawProduct || typeof rawProduct !== "object") return null;
  const product = rawProduct as OpenFoodFactsProduct;

  const name = pickString(product.product_name) ?? pickString(product.product_name_en) ?? pickString(product.brands);
  if (!name) return null;

  const nutriments =
    product.nutriments && typeof product.nutriments === "object"
      ? (product.nutriments as Record<string, unknown>)
      : {};

  const servingCalories = toFiniteNumber(nutriments["energy-kcal_serving"]);
  const servingProtein = toFiniteNumber(nutriments["proteins_serving"]) ?? 0;
  // A negative figure is treated the same as "no usable calorie/protein data on this basis"
  // (qa-reviewer N-2) -- try the per-100g basis below instead of returning a nonsensical
  // negative-calorie/protein candidate.
  if (servingCalories !== null && servingCalories >= 0 && servingProtein >= 0) {
    const parsedServing = unitFromServingLabel(pickString(product.serving_size));
    const quantity = parsedServing?.quantity ?? 1;
    const unit = parsedServing?.unit ?? null;

    return {
      source: "openfoodfacts",
      sourceId: barcode,
      name,
      quantity,
      unit,
      caloriesPerUnit: perUnitFromTotal(servingCalories, quantity),
      proteinGPerUnit: perUnitFromTotal(servingProtein, quantity),
    };
  }

  const per100Calories = toFiniteNumber(nutriments["energy-kcal_100g"]);
  const per100Protein = toFiniteNumber(nutriments["proteins_100g"]) ?? 0;
  if (per100Calories !== null && per100Calories >= 0 && per100Protein >= 0) {
    return {
      source: "openfoodfacts",
      sourceId: barcode,
      name,
      quantity: 100,
      unit: "g",
      caloriesPerUnit: perUnitFromTotal(per100Calories, 100),
      proteinGPerUnit: perUnitFromTotal(per100Protein, 100),
    };
  }

  return null;
}

// --- USDA FoodData Central ---------------------------------------------------------------------

type UsdaNutrient = {
  nutrientId?: unknown;
  nutrientName?: unknown;
  unitName?: unknown;
  value?: unknown;
};

type UsdaFood = {
  fdcId?: unknown;
  description?: unknown;
  servingSize?: unknown;
  servingSizeUnit?: unknown;
  householdServingFullText?: unknown;
  foodNutrients?: unknown;
};

/**
 * USDA's `foodNutrients` array carries entries by `nutrientId` (most reliable — e.g. `1008` is
 * always "Energy" in kcal, `1062` is the separate kJ figure for the same nutrient) with
 * `nutrientName`/`unitName` as a fallback match when an id isn't present in a given response
 * shape. Matching by id first (rather than name alone) avoids accidentally picking a same-named
 * nutrient reported in the wrong unit (e.g. the kJ energy entry instead of the kcal one).
 */
function findUsdaNutrientValue(
  nutrients: UsdaNutrient[],
  nutrientId: number,
  name: string,
  unit: string,
): number | null {
  const match = nutrients.find((n) => {
    if (n.nutrientId === nutrientId) return true;
    return (
      typeof n.nutrientName === "string" &&
      n.nutrientName.toLowerCase() === name &&
      typeof n.unitName === "string" &&
      n.unitName.toLowerCase() === unit
    );
  });
  return match ? toFiniteNumber(match.value) : null;
}

/**
 * Normalizes one entry of USDA FoodData Central's `/v1/foods/search` `foods` array. USDA reports
 * `foodNutrients` values per 100g of the food; when a parseable `householdServingFullText` (e.g.
 * "1 cup") is paired with a gram-denominated `servingSize`/`servingSizeUnit`, the per-100g figures
 * are scaled up to that serving and then divided by the parsed quantity to get a genuine per-unit
 * figure (mirroring the Open Food Facts per-serving path); otherwise falls back to a flat
 * quantity-100/unit-"g" basis. Returns `null` when there's no usable name or no finite calorie
 * value at all.
 */
export function normalizeUsdaFood(rawFood: unknown): FoodCandidate | null {
  if (!rawFood || typeof rawFood !== "object") return null;
  const food = rawFood as UsdaFood;

  const name = pickString(food.description);
  if (!name) return null;

  const nutrients = Array.isArray(food.foodNutrients) ? (food.foodNutrients as UsdaNutrient[]) : [];
  const calories100 = findUsdaNutrientValue(nutrients, 1008, "energy", "kcal");
  // USDA reports on a single (per-100g) basis, unlike Open Food Facts' serving/per-100g pair, so
  // there's no second basis to fall back to -- a negative calorie or protein figure means the
  // whole candidate is unusable and gets dropped outright (qa-reviewer N-2).
  if (calories100 === null || calories100 < 0) return null;
  const protein100 = findUsdaNutrientValue(nutrients, 1003, "protein", "g") ?? 0;
  if (protein100 < 0) return null;

  const sourceId =
    typeof food.fdcId === "number" ? String(food.fdcId) : (pickString(food.fdcId) ?? name);

  const servingSizeGrams = toFiniteNumber(food.servingSize);
  const servingSizeUnit = pickString(food.servingSizeUnit)?.toLowerCase() ?? null;
  const parsedServing = unitFromServingLabel(pickString(food.householdServingFullText));

  // qa-reviewer N-2: a zero (or missing) gram serving size can't scale a real per-100g figure to a
  // sane per-serving value -- require a genuinely positive `servingSizeGrams`, not just "present",
  // before trusting the serving-scaled path. A zero/missing serving size falls back to the flat
  // per-100g basis below instead of silently producing a 0-calorie candidate.
  if (parsedServing && servingSizeGrams !== null && servingSizeGrams > 0 && servingSizeUnit === "g") {
    const scale = servingSizeGrams / 100;
    const servingCalories = calories100 * scale;
    const servingProtein = protein100 * scale;

    return {
      source: "usda",
      sourceId,
      name,
      quantity: parsedServing.quantity,
      unit: parsedServing.unit,
      caloriesPerUnit: perUnitFromTotal(servingCalories, parsedServing.quantity),
      proteinGPerUnit: perUnitFromTotal(servingProtein, parsedServing.quantity),
    };
  }

  return {
    source: "usda",
    sourceId,
    name,
    quantity: 100,
    unit: "g",
    caloriesPerUnit: perUnitFromTotal(calories100, 100),
    proteinGPerUnit: perUnitFromTotal(protein100, 100),
  };
}
