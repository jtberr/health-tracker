import { describe, expect, it } from "vitest";
import {
  TREND_RANGES,
  buildIntakeSeries,
  buildWeightSeries,
  dateRange,
  parseRangeParam,
  startDateForRange,
} from "./trends";

describe("parseRangeParam", () => {
  it.each(TREND_RANGES)("passes a valid range (%i) through unchanged", (range) => {
    expect(parseRangeParam(String(range))).toBe(range);
  });

  it("defaults to 30 when the param is undefined (no ?range= at all)", () => {
    expect(parseRangeParam(undefined)).toBe(30);
  });

  it("defaults to 30 for a value that isn't 7/30/90", () => {
    expect(parseRangeParam("14")).toBe(30);
    expect(parseRangeParam("0")).toBe(30);
    expect(parseRangeParam("-7")).toBe(30);
  });

  it("defaults to 30 for a non-numeric value", () => {
    expect(parseRangeParam("abc")).toBe(30);
    expect(parseRangeParam("")).toBe(30);
  });
});

describe("dateRange", () => {
  it("returns every calendar day inclusive of both ends", () => {
    expect(dateRange("2026-07-01", "2026-07-05")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  it("returns a single-element array when start === end", () => {
    expect(dateRange("2026-07-01", "2026-07-01")).toEqual(["2026-07-01"]);
  });

  it("returns an empty array when start is after end (defensive)", () => {
    expect(dateRange("2026-07-05", "2026-07-01")).toEqual([]);
  });

  it("crosses a month boundary correctly", () => {
    expect(dateRange("2026-07-30", "2026-08-02")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("crosses a year boundary correctly", () => {
    expect(dateRange("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});

describe("startDateForRange", () => {
  it("computes the correct 7-day window start (inclusive of endDate)", () => {
    expect(startDateForRange("2026-07-25", 7)).toBe("2026-07-19");
  });

  it("computes the correct 30-day window start", () => {
    expect(startDateForRange("2026-07-25", 30)).toBe("2026-06-26");
  });

  it("computes the correct 90-day window start", () => {
    expect(startDateForRange("2026-07-25", 90)).toBe("2026-04-27");
  });

  it("every range produces a dateRange of exactly `range` days", () => {
    for (const range of TREND_RANGES) {
      const start = startDateForRange("2026-07-25", range);
      expect(dateRange(start, "2026-07-25")).toHaveLength(range);
    }
  });
});

describe("buildWeightSeries", () => {
  const startDate = "2026-07-01";
  const endDate = "2026-07-05";

  it("is dense: every day in range is present even with no rows at all", () => {
    const series = buildWeightSeries([], startDate, endDate);
    expect(series.map((p) => p.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    expect(series.every((p) => p.isReal === false)).toBe(true);
    expect(series.every((p) => p.weightKg === null && p.bodyFatPct === null)).toBe(true);
  });

  it("flags isReal true only on days with an actual logged row, connecting across a gap", () => {
    const rows = [
      { metric_date: "2026-07-01", weight_kg: 80, body_fat_pct: 20 },
      // 07-02, 07-03, 07-04 are gap days (no row) — must still appear, isReal: false.
      { metric_date: "2026-07-05", weight_kg: 79, body_fat_pct: 19.5 },
    ];
    const series = buildWeightSeries(rows, startDate, endDate);

    expect(series).toHaveLength(5);
    expect(series[0]).toEqual({ date: "2026-07-01", weightKg: 80, bodyFatPct: 20, isReal: true });
    expect(series[1]).toEqual({ date: "2026-07-02", weightKg: null, bodyFatPct: null, isReal: false });
    expect(series[2]).toEqual({ date: "2026-07-03", weightKg: null, bodyFatPct: null, isReal: false });
    expect(series[3]).toEqual({ date: "2026-07-04", weightKg: null, bodyFatPct: null, isReal: false });
    expect(series[4]).toEqual({ date: "2026-07-05", weightKg: 79, bodyFatPct: 19.5, isReal: true });
  });

  it("a weight-only day (no body fat %) is still isReal: true, with bodyFatPct null", () => {
    const rows = [{ metric_date: "2026-07-03", weight_kg: 80, body_fat_pct: null }];
    const series = buildWeightSeries(rows, startDate, endDate);
    const day = series.find((p) => p.date === "2026-07-03")!;
    expect(day.isReal).toBe(true);
    expect(day.weightKg).toBe(80);
    expect(day.bodyFatPct).toBeNull();
  });

  it("does not require rows to be pre-sorted", () => {
    const rows = [
      { metric_date: "2026-07-05", weight_kg: 79, body_fat_pct: null },
      { metric_date: "2026-07-01", weight_kg: 80, body_fat_pct: null },
    ];
    const series = buildWeightSeries(rows, startDate, endDate);
    expect(series[0].weightKg).toBe(80);
    expect(series[4].weightKg).toBe(79);
  });
});

describe("buildIntakeSeries", () => {
  const startDate = "2026-07-01";
  const endDate = "2026-07-03";

  it("is dense: every day in range is present even with no rows at all", () => {
    const series = buildIntakeSeries([], startDate, endDate);
    expect(series.map((p) => p.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(series.every((p) => p.isReal === false)).toBe(true);
    expect(series.every((p) => p.calories === null && p.proteinG === null)).toBe(true);
  });

  it("flags isReal true only on days with a daily_food_totals row, connecting across a gap", () => {
    const rows = [
      { consumed_local_date: "2026-07-01", total_calories: 1800, total_protein_g: 120 },
      // 07-02 is a gap day — no entries logged.
      { consumed_local_date: "2026-07-03", total_calories: 2100, total_protein_g: 140 },
    ];
    const series = buildIntakeSeries(rows, startDate, endDate);

    expect(series[0]).toEqual({ date: "2026-07-01", calories: 1800, proteinG: 120, isReal: true });
    expect(series[1]).toEqual({ date: "2026-07-02", calories: null, proteinG: null, isReal: false });
    expect(series[2]).toEqual({ date: "2026-07-03", calories: 2100, proteinG: 140, isReal: true });
  });
});
