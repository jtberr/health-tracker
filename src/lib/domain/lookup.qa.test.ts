/**
 * QA-REVIEWER independent Phase 6 normalizer tests. Written from the design doc 8 Phase 6
 * (unit scope: normalizers, unitFromServingLabel, dropping candidates without usable nutrition)
 * and NOT derived from src/lib/domain/lookup.test.ts, which covers the happy paths and the
 * missing-field drops. This file deliberately targets what that file does not: hostile or
 * degenerate provider values (zero, negative, non-finite, huge, string-typed) and whether they
 * produce a sane FoodCandidate or a nonsensical one.
 *
 * Tests originally marked FINDING recorded CURRENT (buggy) behavior that deviated from the spec
 * intent ("drop candidates with no usable nutrition") -- see the QA report's N-2. Per the
 * developer fix-up (2026-07-26), the drop/fallback rule was tightened in `lookup.ts`
 * (`unitFromServingLabel` now rejects a zero quantity, USDA requires `servingSizeGrams > 0`, and
 * both normalizers treat a negative calorie/protein figure as unusable) and the tests below have
 * been updated in place to assert the corrected behavior instead of the bug -- they are no longer
 * "FINDING: current wrong behavior" but "confirms the N-2 fix" assertions.
 */
import { describe, it, expect } from "vitest";
import { normalizeOpenFoodFactsProduct, normalizeUsdaFood, unitFromServingLabel } from "./lookup";

describe("unitFromServingLabel -- degenerate labels", () => {
  it("rejects a negative quantity label outright", () => {
    expect(unitFromServingLabel("-5 g")).toBeNull();
  });

  it("rejects scientific notation rather than mis-parsing it", () => {
    expect(unitFromServingLabel("1e3 g")).toBeNull();
  });

  it("rejects a fraction label (1/2 cup) rather than reading it as 1", () => {
    expect(unitFromServingLabel("1/2 cup")).toBeNull();
  });

  it("rejects a unit-only label", () => {
    expect(unitFromServingLabel("per container")).toBeNull();
  });

  it("accepts an implausibly large quantity as-is (no upper clamp)", () => {
    expect(unitFromServingLabel("100000000 g")).toEqual({ quantity: 100000000, unit: "g" });
  });

  it("N-2 fix: a zero-quantity label is rejected, not parsed to quantity 0", () => {
    expect(unitFromServingLabel("0 g")).toBeNull();
  });
});

describe("normalizeOpenFoodFactsProduct -- degenerate nutrition", () => {
  const base = { product_name: "Test food" };

  it("drops a candidate whose only calorie figures are non-finite (Infinity)", () => {
    expect(
      normalizeOpenFoodFactsProduct(
        { ...base, nutriments: { "energy-kcal_serving": Infinity, "energy-kcal_100g": Infinity } },
        "1",
      ),
    ).toBeNull();
  });

  it("drops a candidate whose calorie figures are NaN", () => {
    expect(normalizeOpenFoodFactsProduct({ ...base, nutriments: { "energy-kcal_100g": NaN } }, "1")).toBeNull();
  });

  it("drops a candidate whose calorie figure is a non-numeric string", () => {
    expect(
      normalizeOpenFoodFactsProduct({ ...base, nutriments: { "energy-kcal_100g": "unknown" } }, "1"),
    ).toBeNull();
  });

  it("accepts string-typed numeric nutriments (OFF really does emit these)", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { ...base, nutriments: { "energy-kcal_100g": "250", proteins_100g: "9" } },
      "1",
    );
    expect(candidate).toMatchObject({ quantity: 100, unit: "g", caloriesPerUnit: 2.5 });
    expect(candidate?.proteinGPerUnit).toBeCloseTo(0.09, 10);
  });

  it("falls back to a whitespace-trimmed brand when the product name is blank", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { product_name: "   ", brands: "  Acme ", nutriments: { "energy-kcal_100g": 10 } },
      "1",
    );
    expect(candidate?.name).toBe("Acme");
  });

  it("keeps a legitimately zero-calorie food (water) rather than dropping it", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { product_name: "Water", nutriments: { "energy-kcal_100g": 0 } },
      "1",
    );
    expect(candidate).toMatchObject({ name: "Water", caloriesPerUnit: 0, proteinGPerUnit: 0 });
  });

  it("scales a large serving size down to a sane per-unit figure", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { ...base, serving_size: "10000 g", nutriments: { "energy-kcal_serving": 500 } },
      "1",
    );
    expect(candidate).toMatchObject({ quantity: 10000, unit: "g", caloriesPerUnit: 0.05 });
  });

  it("N-2 fix: a NEGATIVE serving-basis calorie figure is dropped, not passed through", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { ...base, serving_size: "1 bar", nutriments: { "energy-kcal_serving": -300, proteins_serving: 5 } },
      "1",
    );
    // No other basis (no per-100g figures) is present either, so the whole candidate is dropped.
    expect(candidate).toBeNull();
  });

  it("N-2 fix: a negative serving-basis figure falls back to a usable per-100g basis instead of being lost entirely", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        ...base,
        serving_size: "1 bar",
        nutriments: { "energy-kcal_serving": -300, proteins_serving: 5, "energy-kcal_100g": 400, proteins_100g: 8 },
      },
      "1",
    );
    expect(candidate).toMatchObject({ quantity: 100, unit: "g", caloriesPerUnit: 4, proteinGPerUnit: 0.08 });
  });

  it("N-2 fix: a zero-quantity serving label falls back to a genuine per-serving-as-one-unit figure, not zeroed data", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { ...base, serving_size: "0 g", nutriments: { "energy-kcal_serving": 250, proteins_serving: 10 } },
      "1",
    );
    // The source says 250 kcal. Since "0 g" is no longer a usable parsed serving, this falls back
    // to quantity 1 / unit null (the same "no parseable serving" path an unparsable label like
    // "per bar" already took) and keeps the real 250 kcal / 10 g figures intact.
    expect(candidate).toMatchObject({ quantity: 1, unit: null, caloriesPerUnit: 250, proteinGPerUnit: 10 });
  });
});

describe("normalizeUsdaFood -- degenerate nutrition", () => {
  const energy = (value: unknown) => ({ nutrientId: 1008, value });

  it("drops a food whose foodNutrients is not an array", () => {
    expect(normalizeUsdaFood({ fdcId: 1, description: "Bad", foodNutrients: "nope" })).toBeNull();
  });

  it("drops a food that only reports energy in kJ (never mis-reads kJ as kcal)", () => {
    expect(
      normalizeUsdaFood({
        fdcId: 1,
        description: "kJ only",
        foodNutrients: [{ nutrientName: "Energy", unitName: "kJ", value: 900 }],
      }),
    ).toBeNull();
  });

  it("accepts a string-typed nutrient value", () => {
    const candidate = normalizeUsdaFood({ fdcId: 7, description: "StrVal", foodNutrients: [energy("165")] });
    expect(candidate).toMatchObject({ quantity: 100, unit: "g", caloriesPerUnit: 1.65 });
  });

  it("drops a food with a non-finite energy value", () => {
    expect(normalizeUsdaFood({ fdcId: 1, description: "Inf", foodNutrients: [energy(Infinity)] })).toBeNull();
  });

  it("ignores a household serving when servingSizeUnit is not grams", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 1,
      description: "MlServing",
      servingSize: 240,
      servingSizeUnit: "ml",
      householdServingFullText: "1 cup",
      foodNutrients: [energy(40)],
    });
    expect(candidate).toMatchObject({ quantity: 100, unit: "g", caloriesPerUnit: 0.4 });
  });

  it("N-2 fix: a negative energy value is dropped, not turned into a negative candidate", () => {
    const candidate = normalizeUsdaFood({ fdcId: 2, description: "NegE", foodNutrients: [energy(-100)] });
    expect(candidate).toBeNull();
  });

  it("N-2 fix: a negative protein value drops the whole candidate rather than passing through", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 3,
      description: "NegP",
      foodNutrients: [energy(100), { nutrientId: 1003, value: -7 }],
    });
    expect(candidate).toBeNull();
  });

  it("N-2 fix: servingSize 0 falls back to the flat per-100g basis instead of a fake 0-calorie candidate", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 4,
      description: "Zero serving",
      servingSize: 0,
      servingSizeUnit: "g",
      householdServingFullText: "1 cup",
      foodNutrients: [energy(200), { nutrientId: 1003, value: 10 }],
    });
    // A zero gram serving size can't scale anything, so this now falls back to the ordinary
    // quantity-100/unit-g basis and keeps the real 200 kcal / 10 g figures.
    expect(candidate).toMatchObject({ quantity: 100, unit: "g", caloriesPerUnit: 2, proteinGPerUnit: 0.1 });
  });

  it("N-2 fix: a zero-quantity household serving falls back to the flat per-100g basis, not zeroed data", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 5,
      description: "ZeroHH",
      servingSize: 50,
      servingSizeUnit: "g",
      householdServingFullText: "0 cup",
      foodNutrients: [energy(200)],
    });
    expect(candidate).toMatchObject({ quantity: 100, unit: "g", caloriesPerUnit: 2 });
  });

  it("a missing fdcId still falls back to the description as sourceId (unchanged, correct domain behavior)", () => {
    // Two same-named foods with no fdcId legitimately produce the same sourceId here -- that's
    // fine at this pure-domain layer. The React-key collision this could cause in the list UI is
    // fixed separately at the presentation layer (N-5, FoodLookupPanel's list key), not here.
    const candidate = normalizeUsdaFood({ description: "NoId", foodNutrients: [energy(100)] });
    expect(candidate?.sourceId).toBe("NoId");
  });
});
