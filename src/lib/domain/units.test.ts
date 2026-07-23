import { describe, expect, it } from "vitest";
import {
  formatWeight,
  kgToLb,
  lbToKg,
  roundTo,
  weightForDisplay,
  weightToKg,
} from "./units";

describe("kgToLb / lbToKg", () => {
  it("converts a known kg value to the expected lb value", () => {
    // 1 kg ~= 2.20462 lb
    expect(kgToLb(1)).toBeCloseTo(2.20462, 4);
  });

  it("converts a known lb value to the expected kg value", () => {
    // 1 lb ~= 0.453592 kg
    expect(lbToKg(1)).toBeCloseTo(0.453592, 5);
  });

  it("round-trips kg -> lb -> kg", () => {
    const originalKg = 82.4;
    expect(lbToKg(kgToLb(originalKg))).toBeCloseTo(originalKg, 9);
  });

  it("round-trips lb -> kg -> lb", () => {
    const originalLb = 181.5;
    expect(kgToLb(lbToKg(originalLb))).toBeCloseTo(originalLb, 9);
  });

  it("treats 0 as a fixed point", () => {
    expect(kgToLb(0)).toBe(0);
    expect(lbToKg(0)).toBe(0);
  });
});

describe("roundTo", () => {
  it("rounds to the requested decimal places", () => {
    expect(roundTo(1.2345, 2)).toBe(1.23);
    expect(roundTo(1.2355, 2)).toBe(1.24);
  });

  it("rounds to zero decimal places", () => {
    expect(roundTo(4.6, 0)).toBe(5);
  });
});

describe("weightToKg (storage conversion)", () => {
  it("passes kg input through unchanged (aside from rounding)", () => {
    expect(weightToKg(68.204, "kg")).toBe(68.2);
  });

  it("converts lb input into kg for storage", () => {
    // 150 lb ~= 68.04 kg
    expect(weightToKg(150, "lb")).toBeCloseTo(68.04, 1);
  });

  it("rounds the stored value to 2 decimal places (numeric(5,2))", () => {
    const stored = weightToKg(200, "lb");
    const decimalPlaces = String(stored).split(".")[1]?.length ?? 0;
    expect(decimalPlaces).toBeLessThanOrEqual(2);
  });
});

describe("weightForDisplay (read-time projection)", () => {
  it("returns the kg value unchanged (aside from rounding) when unit is kg", () => {
    expect(weightForDisplay(68.2, "kg")).toBe(68.2);
  });

  it("converts a stored kg value into lb for display", () => {
    // 68.2 kg ~= 150.4 lb
    expect(weightForDisplay(68.2, "lb")).toBeCloseTo(150.4, 0);
  });

  it("rounds the displayed value to 1 decimal place", () => {
    const displayed = weightForDisplay(68.2039, "kg");
    const decimalPlaces = String(displayed).split(".")[1]?.length ?? 0;
    expect(decimalPlaces).toBeLessThanOrEqual(1);
  });
});

describe("weightToKg / weightForDisplay round-trip (the key correctness property)", () => {
  it("storing a kg-entered value and displaying it back in kg returns the same value", () => {
    const enteredKg = 75.5;
    const storedKg = weightToKg(enteredKg, "kg");
    expect(weightForDisplay(storedKg, "kg")).toBeCloseTo(enteredKg, 1);
  });

  it("storing an lb-entered value and displaying it back in lb round-trips within display precision", () => {
    const enteredLb = 165.3;
    const storedKg = weightToKg(enteredLb, "lb");
    expect(weightForDisplay(storedKg, "lb")).toBeCloseTo(enteredLb, 1);
  });

  it("a value stored in kg displays correctly back in lb and vice versa", () => {
    const storedKg = 90;
    const displayedLb = weightForDisplay(storedKg, "lb");
    // Converting the displayed lb figure back should land close to the original kg value —
    // "close to" because both the stored kg and the displayed lb are each rounded once.
    expect(weightToKg(displayedLb, "lb")).toBeCloseTo(storedKg, 1);
  });

  it("switching the display unit never changes the canonical stored kg value", () => {
    const storedKg = 68.2;
    // Reading the same stored value in both units must be internally consistent: converting the
    // lb display value back to kg should reproduce the original stored kg (within rounding).
    const asLb = weightForDisplay(storedKg, "lb");
    expect(weightToKg(asLb, "lb")).toBeCloseTo(storedKg, 1);
    expect(weightForDisplay(storedKg, "kg")).toBe(storedKg);
  });
});

describe("formatWeight", () => {
  it("formats a kg value with a kg suffix", () => {
    expect(formatWeight(68.2, "kg")).toBe("68.2 kg");
  });

  it("formats a converted lb value with an lb suffix", () => {
    expect(formatWeight(68.2, "lb")).toBe(`${weightForDisplay(68.2, "lb")} lb`);
  });
});
