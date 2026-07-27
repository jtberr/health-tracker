import { describe, expect, it } from "vitest";
import { normalizeOpenFoodFactsProduct, normalizeUsdaFood, unitFromServingLabel } from "./lookup";

describe("unitFromServingLabel", () => {
  it("parses a quantity + unit with a trailing parenthetical", () => {
    expect(unitFromServingLabel("1 cup (240 ml)")).toEqual({ quantity: 1, unit: "cup" });
  });

  it("parses a multi-word unit", () => {
    expect(unitFromServingLabel("1 fl oz (30 ml)")).toEqual({ quantity: 1, unit: "fl oz" });
  });

  it("parses a plain 'qty unit' label with no parenthetical", () => {
    expect(unitFromServingLabel("2 tbsp")).toEqual({ quantity: 2, unit: "tbsp" });
  });

  it("parses a label with no space between the number and the unit", () => {
    expect(unitFromServingLabel("100g")).toEqual({ quantity: 100, unit: "g" });
  });

  it("parses decimal quantities", () => {
    expect(unitFromServingLabel("0.5 cup")).toEqual({ quantity: 0.5, unit: "cup" });
  });

  it("lowercases the unit", () => {
    expect(unitFromServingLabel("1 Cup")).toEqual({ quantity: 1, unit: "cup" });
  });

  it("collapses internal whitespace in the unit", () => {
    expect(unitFromServingLabel("1   fl   oz")).toEqual({ quantity: 1, unit: "fl oz" });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(unitFromServingLabel("  2 slices  ")).toEqual({ quantity: 2, unit: "slices" });
  });

  it("returns null for a label with no leading number", () => {
    expect(unitFromServingLabel("Serving")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(unitFromServingLabel("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(unitFromServingLabel("   ")).toBeNull();
  });

  it("returns null for null", () => {
    expect(unitFromServingLabel(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(unitFromServingLabel(undefined)).toBeNull();
  });
});

describe("normalizeOpenFoodFactsProduct", () => {
  it("prefers per-serving nutrition, scaling down to a genuine per-unit figure", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        product_name: "Peanut Butter",
        serving_size: "2 tbsp (32 g)",
        nutriments: {
          "energy-kcal_serving": 190,
          proteins_serving: 8,
          "energy-kcal_100g": 590,
          proteins_100g: 25,
        },
      },
      "0000000000001",
    );

    expect(candidate).toEqual({
      source: "openfoodfacts",
      sourceId: "0000000000001",
      name: "Peanut Butter",
      quantity: 2,
      unit: "tbsp",
      caloriesPerUnit: 95,
      proteinGPerUnit: 4,
    });
  });

  it("falls back to per-100g when there is no per-serving figure, using a quantity-100/unit-g basis", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        product_name: "Rolled Oats",
        nutriments: {
          "energy-kcal_100g": 380,
          proteins_100g: 13,
        },
      },
      "0000000000002",
    );

    expect(candidate).toEqual({
      source: "openfoodfacts",
      sourceId: "0000000000002",
      name: "Rolled Oats",
      quantity: 100,
      unit: "g",
      caloriesPerUnit: 3.8,
      proteinGPerUnit: 0.13,
    });
  });

  it("defaults quantity 1 / unit null when a per-serving figure exists but the serving label can't be parsed", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        product_name: "Mystery Bar",
        serving_size: "per bar",
        nutriments: {
          "energy-kcal_serving": 200,
          proteins_serving: 10,
        },
      },
      "0000000000003",
    );

    expect(candidate).toEqual({
      source: "openfoodfacts",
      sourceId: "0000000000003",
      name: "Mystery Bar",
      quantity: 1,
      unit: null,
      caloriesPerUnit: 200,
      proteinGPerUnit: 10,
    });
  });

  it("defaults missing protein to 0 rather than dropping the candidate", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        product_name: "Sparkling Water",
        nutriments: {
          "energy-kcal_100g": 0,
        },
      },
      "0000000000004",
    );

    expect(candidate).toEqual({
      source: "openfoodfacts",
      sourceId: "0000000000004",
      name: "Sparkling Water",
      quantity: 100,
      unit: "g",
      caloriesPerUnit: 0,
      proteinGPerUnit: 0,
    });
  });

  it("does NOT drop a legitimately zero calorie value (distinct from missing)", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        product_name: "Water",
        nutriments: { "energy-kcal_serving": 0, proteins_serving: 0 },
      },
      "0000000000005",
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.caloriesPerUnit).toBe(0);
  });

  it("falls back to product_name_en when product_name is missing", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        product_name_en: "Fallback Name",
        nutriments: { "energy-kcal_100g": 100 },
      },
      "barcode",
    );

    expect(candidate?.name).toBe("Fallback Name");
  });

  it("falls back to brands when no product name is present at all", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      {
        brands: "Acme Co.",
        nutriments: { "energy-kcal_100g": 100 },
      },
      "barcode",
    );

    expect(candidate?.name).toBe("Acme Co.");
  });

  it("drops a candidate with no usable name at all", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { nutriments: { "energy-kcal_100g": 100, proteins_100g: 5 } },
      "barcode",
    );

    expect(candidate).toBeNull();
  });

  it("drops a candidate with no nutriments object at all", () => {
    const candidate = normalizeOpenFoodFactsProduct({ product_name: "No Data Item" }, "barcode");
    expect(candidate).toBeNull();
  });

  it("drops a candidate whose nutriments have no finite calorie figure on either basis", () => {
    const candidate = normalizeOpenFoodFactsProduct(
      { product_name: "Bad Data Item", nutriments: { proteins_100g: 5 } },
      "barcode",
    );

    expect(candidate).toBeNull();
  });

  it("returns null for a non-object product", () => {
    expect(normalizeOpenFoodFactsProduct(null, "barcode")).toBeNull();
    expect(normalizeOpenFoodFactsProduct("not an object", "barcode")).toBeNull();
    expect(normalizeOpenFoodFactsProduct(undefined, "barcode")).toBeNull();
  });
});

describe("normalizeUsdaFood", () => {
  it("scales per-100g nutrients to a parsed household serving, dividing down to a per-unit figure", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 12345,
      description: "Milk, whole",
      servingSize: 244,
      servingSizeUnit: "g",
      householdServingFullText: "1 cup",
      foodNutrients: [
        { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 61 },
        { nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 3.2 },
      ],
    });

    expect(candidate?.source).toBe("usda");
    expect(candidate?.sourceId).toBe("12345");
    expect(candidate?.name).toBe("Milk, whole");
    expect(candidate?.quantity).toBe(1);
    expect(candidate?.unit).toBe("cup");
    // 61 kcal/100g * (244/100) = 148.84 kcal per cup, / 1 unit = 148.84
    expect(candidate?.caloriesPerUnit).toBeCloseTo(148.84, 5);
    // 3.2 g/100g * 2.44 = 7.808 g per cup
    expect(candidate?.proteinGPerUnit).toBeCloseTo(7.808, 5);
  });

  it("falls back to quantity 100 / unit g when there's no parseable household serving", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 999,
      description: "Chicken breast, raw",
      foodNutrients: [
        { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 120 },
        { nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 22 },
      ],
    });

    expect(candidate).toEqual({
      source: "usda",
      sourceId: "999",
      name: "Chicken breast, raw",
      quantity: 100,
      unit: "g",
      caloriesPerUnit: 1.2,
      proteinGPerUnit: 0.22,
    });
  });

  it("falls back to quantity 100 / unit g when servingSizeUnit isn't grams", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 1,
      description: "Some Liquid",
      servingSize: 8,
      servingSizeUnit: "ml",
      householdServingFullText: "1 cup",
      foodNutrients: [{ nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 50 }],
    });

    expect(candidate?.quantity).toBe(100);
    expect(candidate?.unit).toBe("g");
  });

  it("matches the kcal energy entry by nutrientId even when a kJ entry for the same name is present first", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 2,
      description: "Test Food",
      foodNutrients: [
        { nutrientId: 1062, nutrientName: "Energy", unitName: "kJ", value: 500 },
        { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 120 },
      ],
    });

    expect(candidate?.caloriesPerUnit).toBe(1.2); // 120 kcal / 100g basis, not 500
  });

  it("defaults missing protein to 0 rather than dropping the candidate", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 3,
      description: "Sugar",
      foodNutrients: [{ nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 387 }],
    });

    expect(candidate?.proteinGPerUnit).toBe(0);
  });

  it("drops a candidate with no usable name", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 4,
      foodNutrients: [{ nutrientId: 1008, value: 100 }],
    });

    expect(candidate).toBeNull();
  });

  it("drops a candidate with no finite energy value at all", () => {
    const candidate = normalizeUsdaFood({
      fdcId: 5,
      description: "No Energy Data",
      foodNutrients: [{ nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 5 }],
    });

    expect(candidate).toBeNull();
  });

  it("drops a candidate with an empty/missing foodNutrients array", () => {
    const candidate = normalizeUsdaFood({ fdcId: 6, description: "Empty" });
    expect(candidate).toBeNull();
  });

  it("returns null for a non-object food", () => {
    expect(normalizeUsdaFood(null)).toBeNull();
    expect(normalizeUsdaFood("nope")).toBeNull();
  });
});
