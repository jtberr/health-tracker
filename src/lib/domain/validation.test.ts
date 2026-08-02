import { describe, expect, it } from "vitest";
import {
  validateCopyFoodEntriesInput,
  validateDailyMetricInput,
  validateFoodEntryInput,
  validateGoalsInput,
  validateLogMealInput,
  validateMealInput,
  validateMealItemInput,
  type CopyFoodEntriesInput,
  type DailyMetricInput,
  type FoodEntryInput,
  type GoalsInput,
  type LogMealInput,
  type MealInput,
  type MealItemInput,
} from "./validation";

const base: FoodEntryInput = {
  name: "Eggs",
  quantity: 4,
  caloriesPerUnit: 70,
  proteinGPerUnit: 6,
  consumedDate: "2026-07-15",
  consumedTime: "08:00",
};

describe("validateFoodEntryInput", () => {
  it("accepts fully valid input", () => {
    expect(validateFoodEntryInput(base).ok).toBe(true);
  });

  it("accepts the minimal-form shape (quantity 1, whole minutes on the grid)", () => {
    const result = validateFoodEntryInput({
      name: "Snack",
      quantity: 1,
      caloriesPerUnit: 200,
      proteinGPerUnit: 5,
      consumedDate: "2026-07-15",
      consumedTime: "12:30",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = validateFoodEntryInput({ ...base, name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects a whitespace-only name", () => {
    const result = validateFoodEntryInput({ ...base, name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects a zero quantity", () => {
    const result = validateFoodEntryInput({ ...base, quantity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "quantity")).toBe(true);
  });

  it("rejects a negative quantity", () => {
    const result = validateFoodEntryInput({ ...base, quantity: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "quantity")).toBe(true);
  });

  it("rejects a non-finite quantity (NaN from an empty numeric input)", () => {
    const result = validateFoodEntryInput({ ...base, quantity: NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "quantity")).toBe(true);
  });

  it("rejects negative calories per unit", () => {
    const result = validateFoodEntryInput({ ...base, caloriesPerUnit: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "caloriesPerUnit")).toBe(true);
  });

  it("accepts zero calories per unit (e.g. water)", () => {
    const result = validateFoodEntryInput({ ...base, caloriesPerUnit: 0 });
    expect(result.ok).toBe(true);
  });

  it("rejects negative protein per unit", () => {
    const result = validateFoodEntryInput({ ...base, proteinGPerUnit: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "proteinGPerUnit")).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = validateFoodEntryInput({ ...base, consumedDate: "07/15/2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "consumedDate")).toBe(true);
  });

  it("rejects a malformed time", () => {
    const result = validateFoodEntryInput({ ...base, consumedTime: "8am" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "consumedTime")).toBe(true);
  });

  it("rejects a time not on the 15-minute grid", () => {
    const result = validateFoodEntryInput({ ...base, consumedTime: "08:07" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "consumedTime")).toBe(true);
  });

  it("accepts every quarter-hour grid value", () => {
    for (const time of ["00:00", "08:00", "08:15", "08:30", "08:45", "23:45"]) {
      expect(validateFoodEntryInput({ ...base, consumedTime: time }).ok).toBe(true);
    }
  });

  it("reports multiple errors at once", () => {
    const result = validateFoodEntryInput({
      name: "",
      quantity: -1,
      caloriesPerUnit: -1,
      proteinGPerUnit: -1,
      consumedDate: "bad",
      consumedTime: "bad",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(
        [
          "caloriesPerUnit",
          "consumedDate",
          "consumedTime",
          "name",
          "proteinGPerUnit",
          "quantity",
        ].sort(),
      );
    }
  });
});

const baseMetric: DailyMetricInput = {
  metricDate: "2026-07-15",
  weight: 68.2,
  bodyFatPct: 22.5,
};

describe("validateDailyMetricInput", () => {
  it("accepts fully valid input", () => {
    expect(validateDailyMetricInput(baseMetric).ok).toBe(true);
  });

  it("accepts a null body fat % (weight-only day)", () => {
    expect(validateDailyMetricInput({ ...baseMetric, bodyFatPct: null }).ok).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = validateDailyMetricInput({ ...baseMetric, metricDate: "07/15/2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "metricDate")).toBe(true);
  });

  it("rejects a zero weight", () => {
    const result = validateDailyMetricInput({ ...baseMetric, weight: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "weight")).toBe(true);
  });

  it("rejects a negative weight", () => {
    const result = validateDailyMetricInput({ ...baseMetric, weight: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "weight")).toBe(true);
  });

  it("rejects a non-finite weight (NaN from an empty numeric input)", () => {
    const result = validateDailyMetricInput({ ...baseMetric, weight: NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "weight")).toBe(true);
  });

  it("rejects a negative body fat %", () => {
    const result = validateDailyMetricInput({ ...baseMetric, bodyFatPct: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "bodyFatPct")).toBe(true);
  });

  it("rejects a body fat % over 100", () => {
    const result = validateDailyMetricInput({ ...baseMetric, bodyFatPct: 100.1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "bodyFatPct")).toBe(true);
  });

  it("accepts the boundary values 0 and 100 for body fat %", () => {
    expect(validateDailyMetricInput({ ...baseMetric, bodyFatPct: 0 }).ok).toBe(true);
    expect(validateDailyMetricInput({ ...baseMetric, bodyFatPct: 100 }).ok).toBe(true);
  });
});

const baseGoals: GoalsInput = {
  dailyCalorieTarget: 2000,
  dailyProteinTargetG: 150,
};

describe("validateGoalsInput", () => {
  it("accepts fully valid input", () => {
    expect(validateGoalsInput(baseGoals).ok).toBe(true);
  });

  it("accepts both targets being null (no goal set)", () => {
    expect(validateGoalsInput({ dailyCalorieTarget: null, dailyProteinTargetG: null }).ok).toBe(true);
  });

  it("accepts a zero calorie target", () => {
    expect(validateGoalsInput({ ...baseGoals, dailyCalorieTarget: 0 }).ok).toBe(true);
  });

  it("rejects a negative calorie target", () => {
    const result = validateGoalsInput({ ...baseGoals, dailyCalorieTarget: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "dailyCalorieTarget")).toBe(true);
  });

  it("rejects a non-integer calorie target", () => {
    const result = validateGoalsInput({ ...baseGoals, dailyCalorieTarget: 2000.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "dailyCalorieTarget")).toBe(true);
  });

  it("rejects a negative protein target", () => {
    const result = validateGoalsInput({ ...baseGoals, dailyProteinTargetG: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "dailyProteinTargetG")).toBe(true);
  });

  it("accepts a fractional protein target (numeric(6,2) column)", () => {
    expect(validateGoalsInput({ ...baseGoals, dailyProteinTargetG: 150.5 }).ok).toBe(true);
  });
});

const baseMeal: MealInput = { name: "Breakfast burrito" };

describe("validateMealInput", () => {
  it("accepts a valid name", () => {
    expect(validateMealInput(baseMeal).ok).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = validateMealInput({ name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects a whitespace-only name", () => {
    const result = validateMealInput({ name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });
});

const baseMealItem: MealItemInput = {
  name: "Eggs",
  quantity: 4,
  caloriesPerUnit: 70,
  proteinGPerUnit: 6,
};

describe("validateMealItemInput", () => {
  it("accepts fully valid input", () => {
    expect(validateMealItemInput(baseMealItem).ok).toBe(true);
  });

  it("accepts the minimal-form shape (quantity 1)", () => {
    expect(
      validateMealItemInput({ name: "Snack", quantity: 1, caloriesPerUnit: 200, proteinGPerUnit: 5 }).ok,
    ).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = validateMealItemInput({ ...baseMealItem, name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects a zero quantity", () => {
    const result = validateMealItemInput({ ...baseMealItem, quantity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "quantity")).toBe(true);
  });

  it("rejects a negative quantity", () => {
    const result = validateMealItemInput({ ...baseMealItem, quantity: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "quantity")).toBe(true);
  });

  it("rejects negative calories per unit", () => {
    const result = validateMealItemInput({ ...baseMealItem, caloriesPerUnit: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "caloriesPerUnit")).toBe(true);
  });

  it("accepts zero calories per unit (e.g. water)", () => {
    expect(validateMealItemInput({ ...baseMealItem, caloriesPerUnit: 0 }).ok).toBe(true);
  });

  it("rejects negative protein per unit", () => {
    const result = validateMealItemInput({ ...baseMealItem, proteinGPerUnit: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "proteinGPerUnit")).toBe(true);
  });

  it("reports multiple errors at once", () => {
    const result = validateMealItemInput({ name: "", quantity: -1, caloriesPerUnit: -1, proteinGPerUnit: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["caloriesPerUnit", "name", "proteinGPerUnit", "quantity"].sort());
    }
  });
});

const baseLogMeal: LogMealInput = {
  mealId: "11111111-1111-1111-1111-111111111111",
  logDate: "2026-07-15",
  logTime: "08:00",
};

describe("validateLogMealInput", () => {
  it("accepts fully valid input", () => {
    expect(validateLogMealInput(baseLogMeal).ok).toBe(true);
  });

  it("rejects an empty mealId", () => {
    const result = validateLogMealInput({ ...baseLogMeal, mealId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "mealId")).toBe(true);
  });

  it("rejects a whitespace-only mealId", () => {
    const result = validateLogMealInput({ ...baseLogMeal, mealId: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "mealId")).toBe(true);
  });

  it("rejects a malformed date", () => {
    const result = validateLogMealInput({ ...baseLogMeal, logDate: "07/15/2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "logDate")).toBe(true);
  });

  it("rejects a malformed time", () => {
    const result = validateLogMealInput({ ...baseLogMeal, logTime: "8am" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "logTime")).toBe(true);
  });

  it("rejects a time not on the 15-minute grid", () => {
    const result = validateLogMealInput({ ...baseLogMeal, logTime: "08:07" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "logTime")).toBe(true);
  });

  it("accepts every quarter-hour grid value", () => {
    for (const time of ["00:00", "08:00", "08:15", "08:30", "08:45", "23:45"]) {
      expect(validateLogMealInput({ ...baseLogMeal, logTime: time }).ok).toBe(true);
    }
  });

  it("reports multiple errors at once", () => {
    const result = validateLogMealInput({ mealId: "", logDate: "bad", logTime: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["logDate", "logTime", "mealId"].sort());
    }
  });
});

const baseCopy: CopyFoodEntriesInput = {
  entryIds: ["11111111-1111-1111-1111-111111111111"],
  toDate: "2026-07-15",
};

describe("validateCopyFoodEntriesInput", () => {
  it("accepts a valid input with no toTime (preserves each entry's own time-of-day)", () => {
    expect(validateCopyFoodEntriesInput(baseCopy).ok).toBe(true);
  });

  it("accepts a valid input with an explicit on-grid toTime", () => {
    expect(validateCopyFoodEntriesInput({ ...baseCopy, toTime: "08:15" }).ok).toBe(true);
  });

  it("rejects an empty entryIds list", () => {
    const result = validateCopyFoodEntriesInput({ ...baseCopy, entryIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "entryIds")).toBe(true);
  });

  it("accepts multiple entryIds (whole-day / group copies)", () => {
    const result = validateCopyFoodEntriesInput({
      ...baseCopy,
      entryIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed toDate", () => {
    const result = validateCopyFoodEntriesInput({ ...baseCopy, toDate: "07/15/2026" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "toDate")).toBe(true);
  });

  it("rejects a malformed toTime when one is supplied", () => {
    const result = validateCopyFoodEntriesInput({ ...baseCopy, toTime: "8am" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "toTime")).toBe(true);
  });

  it("rejects a toTime not on the 15-minute grid", () => {
    const result = validateCopyFoodEntriesInput({ ...baseCopy, toTime: "08:07" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "toTime")).toBe(true);
  });

  it("does not validate toTime at all when omitted, null, or empty", () => {
    expect(validateCopyFoodEntriesInput({ ...baseCopy, toTime: undefined }).ok).toBe(true);
    expect(validateCopyFoodEntriesInput({ ...baseCopy, toTime: null }).ok).toBe(true);
    expect(validateCopyFoodEntriesInput({ ...baseCopy, toTime: "" }).ok).toBe(true);
  });

  it("accepts every quarter-hour grid value for toTime", () => {
    for (const time of ["00:00", "08:00", "08:15", "08:30", "08:45", "23:45"]) {
      expect(validateCopyFoodEntriesInput({ ...baseCopy, toTime: time }).ok).toBe(true);
    }
  });

  it("reports multiple errors at once", () => {
    const result = validateCopyFoodEntriesInput({ entryIds: [], toDate: "bad", toTime: "bad" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["entryIds", "toDate", "toTime"].sort());
    }
  });
});
