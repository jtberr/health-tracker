import { describe, expect, it } from "vitest";
import { proteinCaloriePct } from "./nutrition";

describe("proteinCaloriePct", () => {
  it("computes the conventional (protein*4)/calories*100 formula", () => {
    expect(proteinCaloriePct(50, 800)).toBe(25);
  });

  it("computes a ratio-of-sums example distinct from averaging per-entry percentages", () => {
    // Entry 1: 30g protein / 200 kcal -> 60%. Entry 2: 10g protein / 300 kcal -> 13.3%.
    // Average of the two percentages would be ~36.7%. Ratio-of-sums must NOT match that.
    const entry1Pct = proteinCaloriePct(30, 200);
    const entry2Pct = proteinCaloriePct(10, 300);
    const averageOfEntries = (entry1Pct! + entry2Pct!) / 2;

    const ratioOfSums = proteinCaloriePct(30 + 10, 200 + 300);
    expect(ratioOfSums).toBe(32);
    expect(ratioOfSums).not.toBe(averageOfEntries);
  });

  it("returns null when calories is 0", () => {
    expect(proteinCaloriePct(5, 0)).toBeNull();
  });

  it("returns null when calories is 0 even if protein is also 0", () => {
    expect(proteinCaloriePct(0, 0)).toBeNull();
  });

  it("does not clamp values over 100%", () => {
    // 30g protein * 4 = 120 kcal from protein alone, exceeding a 100 kcal total (bad source data).
    expect(proteinCaloriePct(30, 100)).toBe(120);
  });

  it("rounds to the display precision (1 decimal place)", () => {
    // (4 * 1) / 3 * 100 = 133.333...
    expect(proteinCaloriePct(1, 3)).toBe(133.3);
  });

  it("handles a whole-number result with no rounding artifacts", () => {
    expect(proteinCaloriePct(25, 100)).toBe(100);
  });
});
