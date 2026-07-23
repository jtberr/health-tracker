import { describe, expect, it } from "vitest";
import { lineTotal, perUnitFromTotal } from "./quantity";

describe("lineTotal", () => {
  it("multiplies quantity by per-unit value", () => {
    expect(lineTotal(4, 70)).toBe(280);
  });

  it("handles fractional quantities", () => {
    expect(lineTotal(1.5, 200)).toBe(300);
  });

  it("handles a quantity of 1 (the minimal-form default)", () => {
    expect(lineTotal(1, 42)).toBe(42);
  });

  it("handles a zero per-unit value", () => {
    expect(lineTotal(3, 0)).toBe(0);
  });
});

describe("perUnitFromTotal", () => {
  it("divides a typed total by the current quantity", () => {
    expect(perUnitFromTotal(280, 4)).toBe(70);
  });

  it("round-trips with lineTotal", () => {
    const quantity = 3;
    const perUnit = 65.5;
    const total = lineTotal(quantity, perUnit);
    expect(perUnitFromTotal(total, quantity)).toBeCloseTo(perUnit);
  });

  it("treats a quantity of 1 as an identity conversion (minimal-form path)", () => {
    expect(perUnitFromTotal(550, 1)).toBe(550);
  });

  it("defensively returns 0 for a zero quantity instead of dividing by zero", () => {
    expect(perUnitFromTotal(100, 0)).toBe(0);
  });

  it("defensively returns 0 for a negative quantity", () => {
    expect(perUnitFromTotal(100, -2)).toBe(0);
  });
});
