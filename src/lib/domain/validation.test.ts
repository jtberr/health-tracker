import { describe, expect, it } from "vitest";
import { validateFoodEntryInput, type FoodEntryInput } from "./validation";

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
