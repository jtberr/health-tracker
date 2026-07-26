import { describe, expect, it } from "vitest";
import {
  TREND_RANGES,
  buildIntakeSeries,
  buildWeightSeries,
  dateRange,
  parseRangeParam,
  startDateForRange,
} from "./trends";

/**
 * QA-REVIEWER independent unit tests for lib/domain/trends.ts.
 *
 * Written from the design doc section 6/8 Phase 5 unit scope (trends: isReal flags,
 * connect-across-gaps, range filtering) and ai-context/DECISIONS.md "Chart gaps: connect across
 * missing days, mark real entries with a dot" -- deliberately NOT derived from the developer's
 * trends.test.ts, and aimed at edges that file does not cover:
 *   - rows OUTSIDE the requested window (does the builder actually range-filter, or just merge?)
 *   - a genuinely-logged day whose totals are ZERO (a 0-kcal entry): must stay isReal true, the
 *     case that proves isReal is not a disguised "value !== null" check
 *   - the structural "no missing calendar day" invariant asserted directly (consecutive dates
 *     exactly one day apart), not just by eyeballing a 5-element literal
 *   - leap day, month/year rollover, DST windows
 *   - duplicate rows for one date (defensive: must not crash or drop the day)
 */

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000;
}

function expectDense(dates: string[], start: string, end: string) {
  expect(dates[0]).toBe(start);
  expect(dates[dates.length - 1]).toBe(end);
  expect(dates).toHaveLength(dayDiff(start, end) + 1);
  expect(new Set(dates).size).toBe(dates.length);
  for (let i = 1; i < dates.length; i++) {
    expect(dayDiff(dates[i - 1], dates[i])).toBe(1);
  }
}

describe("QA trends: range windows are exactly 7/30/90 calendar days, endDate inclusive", () => {
  it.each(TREND_RANGES)("a %i-day window contains exactly that many dense days", (range) => {
    const end = "2026-07-25";
    const start = startDateForRange(end, range);
    const dates = dateRange(start, end);
    expect(dates).toHaveLength(range);
    expectDense(dates, start, end);
  });

  it.each(TREND_RANGES)("a %i-day window stays exact across a leap day", (range) => {
    const end = "2028-03-05";
    const start = startDateForRange(end, range);
    const dates = dateRange(start, end);
    expect(dates).toHaveLength(range);
    expectDense(dates, start, end);
    expect(dates).toContain("2028-02-29");
  });

  it("a 90-day window spanning a year boundary is still exactly 90 dense days", () => {
    const end = "2027-01-15";
    const start = startDateForRange(end, 90);
    expect(start).toBe("2026-10-18");
    expectDense(dateRange(start, end), start, end);
  });

  it("is unaffected by DST transitions (pure calendar math, not instant math)", () => {
    expectDense(dateRange("2026-03-05", "2026-03-12"), "2026-03-05", "2026-03-12");
    expectDense(dateRange("2026-10-29", "2026-11-04"), "2026-10-29", "2026-11-04");
  });
});

describe("QA trends: buildWeightSeries range-filters and flags isReal correctly", () => {
  const start = "2026-07-10";
  const end = "2026-07-16";

  it("produces a dense 7-day series with no missing calendar days", () => {
    const series = buildWeightSeries(
      [{ metric_date: "2026-07-13", weight_kg: 80, body_fat_pct: null }],
      start,
      end,
    );
    expectDense(series.map((p) => p.date), start, end);
  });

  it("EXCLUDES rows outside the window entirely (range filtering, not a plain merge)", () => {
    const series = buildWeightSeries(
      [
        { metric_date: "2026-07-09", weight_kg: 100, body_fat_pct: null },
        { metric_date: "2026-07-13", weight_kg: 80, body_fat_pct: null },
        { metric_date: "2026-07-17", weight_kg: 60, body_fat_pct: null },
      ],
      start,
      end,
    );
    expect(series).toHaveLength(7);
    expect(series.filter((p) => p.isReal).map((p) => p.date)).toEqual(["2026-07-13"]);
    expect(series.some((p) => p.weightKg === 100 || p.weightKg === 60)).toBe(false);
  });

  it("gap days carry null values AND isReal false, endpoints stay real", () => {
    const series = buildWeightSeries(
      [
        { metric_date: "2026-07-10", weight_kg: 82, body_fat_pct: null },
        { metric_date: "2026-07-16", weight_kg: 80, body_fat_pct: null },
      ],
      start,
      end,
    );
    const gaps = series.filter((p) => p.date > "2026-07-10" && p.date < "2026-07-16");
    expect(gaps).toHaveLength(5);
    for (const gap of gaps) {
      expect(gap.isReal).toBe(false);
      expect(gap.weightKg).toBeNull();
      expect(gap.bodyFatPct).toBeNull();
    }
    expect(series[0].isReal).toBe(true);
    expect(series[6].isReal).toBe(true);
  });

  it("does not crash or drop the day when two rows share one date (defensive)", () => {
    const series = buildWeightSeries(
      [
        { metric_date: "2026-07-13", weight_kg: 80, body_fat_pct: null },
        { metric_date: "2026-07-13", weight_kg: 81, body_fat_pct: 22 },
      ],
      start,
      end,
    );
    expect(series).toHaveLength(7);
    const day = series.find((p) => p.date === "2026-07-13")!;
    expect(day.isReal).toBe(true);
    expect([80, 81]).toContain(day.weightKg);
  });

  it("returns an empty series (not a throw) when the window is inverted", () => {
    const series = buildWeightSeries(
      [{ metric_date: "2026-07-13", weight_kg: 80, body_fat_pct: null }],
      end,
      start,
    );
    expect(series).toEqual([]);
  });
});

describe("QA trends: buildIntakeSeries range-filters and flags isReal correctly", () => {
  const start = "2026-07-10";
  const end = "2026-07-16";

  it("EXCLUDES rows outside the window entirely", () => {
    const series = buildIntakeSeries(
      [
        { consumed_local_date: "2026-07-09", total_calories: 9999, total_protein_g: 999 },
        { consumed_local_date: "2026-07-11", total_calories: 1800, total_protein_g: 120 },
        { consumed_local_date: "2026-07-17", total_calories: 8888, total_protein_g: 888 },
      ],
      start,
      end,
    );
    expect(series).toHaveLength(7);
    expect(series.filter((p) => p.isReal).map((p) => p.date)).toEqual(["2026-07-11"]);
    expect(series.some((p) => p.calories === 9999 || p.calories === 8888)).toBe(false);
  });

  it("a day that WAS logged but totals ZERO is isReal true with 0, not a gap", () => {
    const series = buildIntakeSeries(
      [{ consumed_local_date: "2026-07-13", total_calories: 0, total_protein_g: 0 }],
      start,
      end,
    );
    const day = series.find((p) => p.date === "2026-07-13")!;
    expect(day.isReal).toBe(true);
    expect(day.calories).toBe(0);
    expect(day.proteinG).toBe(0);
    expect(series.filter((p) => p.isReal)).toHaveLength(1);
  });

  it("produces a dense 30-day series from sparse rows", () => {
    const end30 = "2026-07-25";
    const start30 = startDateForRange(end30, 30);
    const series = buildIntakeSeries(
      [
        { consumed_local_date: start30, total_calories: 2000, total_protein_g: 150 },
        { consumed_local_date: "2026-07-04", total_calories: 2100, total_protein_g: 160 },
        { consumed_local_date: end30, total_calories: 1900, total_protein_g: 140 },
      ],
      start30,
      end30,
    );
    expect(series).toHaveLength(30);
    expectDense(series.map((p) => p.date), start30, end30);
    expect(series.filter((p) => p.isReal)).toHaveLength(3);
    expect(
      series.filter((p) => !p.isReal).every((p) => p.calories === null && p.proteinG === null),
    ).toBe(true);
  });
});

describe("QA trends: parseRangeParam never breaks the page on a hostile or stale URL", () => {
  const badInputs = ["999", "7d", "  ", "NaN", "Infinity", "1e400", "-30", "30.5", "null"];

  it.each(badInputs)("range=%s falls back to the 30-day default", (input) => {
    expect(parseRangeParam(input)).toBe(30);
  });

  it("always returns one of the three declared ranges", () => {
    const inputs: (string | undefined)[] = ["7", "30", "90", "abc", undefined, ""];
    for (const input of inputs) {
      expect(TREND_RANGES).toContain(parseRangeParam(input));
    }
  });
});
