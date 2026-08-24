import { describe, it, expect } from "vitest";
import { goalProgress } from "./goal-progress";

/**
 * QA-REVIEWER independent Phase 8j unit suite -- "Daily calorie/protein goal progress on /food".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4's "Daily goal progress on /food" block
 * (the GoalProgress type and its field-by-field comments), 6's unit bullet and 8's Phase 8j
 * section -- NOT from the developer's own goal-progress.test.ts.
 *
 * THE LOAD-BEARING DETAIL (3.4, verbatim): "`pct` and `barPct` are two fields on purpose... A bar
 * cannot render past 100%, but the TEXT must tell the truth. Collapsing them into one clamped
 * number is the obvious simplification and it silently makes the app claim you are exactly on
 * target when you are 40% over."
 */

describe("Phase 8j -- goalProgress: the pct/barPct split", () => {
  it("under target: the doc's own worked example", () => {
    expect(goalProgress(1240, 2000)).toEqual({
      consumed: 1240,
      target: 2000,
      remaining: 760,
      pct: 62,
      barPct: 62,
      isOver: false,
    });
  });

  it("THE PAIRING TO HAMMER: over target keeps pct UNCLAMPED while barPct clamps to 100", () => {
    const r = goalProgress(2800, 2000)!;
    expect(r.pct).toBe(140); // the text must tell the truth...
    expect(r.barPct).toBe(100); // ...while the bar cannot render past 100%
    expect(r.remaining).toBe(-800); // SIGNED, negative when over
    expect(r.isOver).toBe(true);
    // A single clamped number would make these two equal -- the exact silent failure 3.4 names.
    expect(r.pct).not.toBe(r.barPct);
  });

  it("exactly ON target is NOT over", () => {
    const r = goalProgress(2000, 2000)!;
    expect(r).toEqual({
      consumed: 2000,
      target: 2000,
      remaining: 0,
      pct: 100,
      barPct: 100,
      isOver: false,
    });
  });

  it("one unit over IS over", () => {
    const r = goalProgress(2001, 2000)!;
    expect(r.isOver).toBe(true);
    expect(r.remaining).toBe(-1);
  });

  it("zero consumed gives a zero-width bar, not a null result", () => {
    expect(goalProgress(0, 2000)).toEqual({
      consumed: 0,
      target: 2000,
      remaining: 2000,
      pct: 0,
      barPct: 0,
      isOver: false,
    });
  });

  it("pct is a WHOLE number (deliberately unlike proteinCaloriePct's one decimal)", () => {
    for (const [c, t] of [
      [1, 3],
      [1234, 2000],
      [7, 9],
      [999, 1000],
    ] as const) {
      const r = goalProgress(c, t)!;
      expect(Number.isInteger(r.pct), `${c}/${t}`).toBe(true);
      expect(Number.isInteger(r.barPct)).toBe(true);
    }
    expect(goalProgress(1234, 2000)!.pct).toBe(62); // 61.7 -> 62, rounded not truncated
  });

  it("barPct is always within 0..100 across a wide sweep, while pct is free to exceed it", () => {
    let sawOver100 = false;
    for (let consumed = 0; consumed <= 6000; consumed += 137) {
      const r = goalProgress(consumed, 2000)!;
      expect(r.barPct).toBeGreaterThanOrEqual(0);
      expect(r.barPct).toBeLessThanOrEqual(100);
      if (r.pct > 100) sawOver100 = true;
      expect(r.remaining).toBe(2000 - consumed);
    }
    expect(sawOver100, "the sweep must actually reach the over-target region").toBe(true);
  });
});

describe("Phase 8j -- goalProgress: the three separate null guards", () => {
  it("returns null for a null target (no goal set)", () => {
    expect(goalProgress(1500, null)).toBeNull();
  });

  it("returns null for a ZERO target -- no divide-by-zero, no Infinity", () => {
    expect(goalProgress(1500, 0)).toBeNull();
  });

  it("returns null for a NEGATIVE target -- the case a naive `if (!target)` would let through", () => {
    // This is the guard the doc calls out as needing its own case: `!target` catches null and 0
    // but passes -1 straight through to divide by a negative and produce a nonsensical pct.
    expect(goalProgress(1500, -1)).toBeNull();
    expect(goalProgress(1500, -2000)).toBeNull();
  });

  it("a null result is returned for ALL consumed values, so the no-goal card never varies", () => {
    for (const consumed of [0, 1, 999999]) {
      expect(goalProgress(consumed, null)).toBeNull();
      expect(goalProgress(consumed, 0)).toBeNull();
    }
  });
});

describe("Phase 8j -- goalProgress is pure", () => {
  it("is deterministic and allocates a fresh object each call", () => {
    const a = goalProgress(1240, 2000);
    const b = goalProgress(1240, 2000);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("handles fractional consumed values (protein grams are not integers)", () => {
    const r = goalProgress(112.5, 150)!;
    expect(r.consumed).toBe(112.5);
    expect(r.remaining).toBe(37.5);
    expect(r.pct).toBe(75);
    expect(r.isOver).toBe(false);
  });
});
