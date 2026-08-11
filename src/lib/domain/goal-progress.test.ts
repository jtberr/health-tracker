import { describe, expect, it } from "vitest";
import { goalProgress } from "./goal-progress";

describe("goalProgress", () => {
  it("under target -- explicit field values", () => {
    const result = goalProgress(1240, 2000);
    expect(result?.consumed).toBe(1240);
    expect(result?.target).toBe(2000);
    expect(result?.remaining).toBe(760);
    expect(result?.pct).toBe(62);
    expect(result?.barPct).toBe(62);
    expect(result?.isOver).toBe(false);
  });

  // The row that must not be got wrong: over target keeps `pct` truthful while clamping only the
  // bar. A single clamped number would silently make the app claim "exactly on target" at 40% over.
  it("over target: pct is UNCLAMPED (140), barPct is clamped to 100, remaining goes negative", () => {
    const result = goalProgress(2800, 2000);
    expect(result?.remaining).toBe(-800);
    expect(result?.pct).toBe(140);
    expect(result?.barPct).toBe(100);
    expect(result?.isOver).toBe(true);
  });

  it("exactly on target: remaining 0, pct 100, isOver FALSE (equal is not over)", () => {
    const result = goalProgress(2000, 2000);
    expect(result?.remaining).toBe(0);
    expect(result?.pct).toBe(100);
    expect(result?.barPct).toBe(100);
    expect(result?.isOver).toBe(false);
  });

  it("zero consumed: pct 0, barPct 0, remaining equals the full target", () => {
    const result = goalProgress(0, 2000);
    expect(result?.remaining).toBe(2000);
    expect(result?.pct).toBe(0);
    expect(result?.barPct).toBe(0);
    expect(result?.isOver).toBe(false);
  });

  it("returns null for a null target", () => {
    expect(goalProgress(1500, null)).toBeNull();
  });

  it("returns null for a zero target (divide-by-zero guard)", () => {
    expect(goalProgress(1500, 0)).toBeNull();
  });

  it("returns null for a negative target (infinite/negative-bar guard)", () => {
    expect(goalProgress(1500, -100)).toBeNull();
  });

  it("pct rounds to the nearest whole number", () => {
    // 1233/2000 = 61.65% -> rounds to 62.
    expect(goalProgress(1233, 2000)?.pct).toBe(62);
    // 1230/2000 = 61.5% -> rounds to 62 (standard half-up rounding).
    expect(goalProgress(1230, 2000)?.pct).toBe(62);
  });

  it("barPct never goes below 0 even for a negative consumed value (defensive)", () => {
    expect(goalProgress(-100, 2000)?.barPct).toBe(0);
  });
});
