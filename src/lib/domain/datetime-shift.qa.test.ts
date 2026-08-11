import { describe, it, expect } from "vitest";
import { shiftIsoDate } from "./datetime";

/**
 * QA-REVIEWER independent unit tests for Phase 8d's single new pure helper.
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3/3.4 and 8 Phase 8d ("unit --
 * shiftIsoDate only, including the negative-offset-timezone row"), NOT from the developer's own
 * datetime.test.ts cases, which were read only afterwards to look for gaps.
 */
describe("shiftIsoDate (Phase 8d, qa-reviewer independent)", () => {
  it("moves one day forward and back within a month", () => {
    expect(shiftIsoDate("2026-07-29", 1)).toBe("2026-07-30");
    expect(shiftIsoDate("2026-07-29", -1)).toBe("2026-07-28");
  });

  it("crosses month ends in both directions", () => {
    expect(shiftIsoDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftIsoDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftIsoDate("2026-06-30", 1)).toBe("2026-07-01");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses year ends in both directions", () => {
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftIsoDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles leap and non-leap Februaries, including the century rule", () => {
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29"); // leap
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftIsoDate("2026-02-28", 1)).toBe("2026-03-01"); // non-leap
    expect(shiftIsoDate("2100-02-28", 1)).toBe("2100-03-01"); // divisible by 100, not 400
    expect(shiftIsoDate("2000-02-28", 1)).toBe("2000-02-29"); // divisible by 400
  });

  it("is exactly the identity for a zero delta, and composes/round-trips", () => {
    expect(shiftIsoDate("2026-07-29", 0)).toBe("2026-07-29");
    expect(shiftIsoDate(shiftIsoDate("2026-03-01", -1), 1)).toBe("2026-03-01");
    let d = "2026-01-31";
    for (let i = 0; i < 400; i++) d = shiftIsoDate(d, 1);
    for (let i = 0; i < 400; i++) d = shiftIsoDate(d, -1);
    expect(d).toBe("2026-01-31");
  });

  it("always returns a zero-padded YYYY-MM-DD (never NaN-NaN-NaN, never a 1-digit month/day)", () => {
    let d = "2025-12-25";
    for (let i = 0; i < 800; i++) {
      d = shiftIsoDate(d, 1);
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("returns malformed input unchanged rather than throwing or emitting garbage", () => {
    for (const bad of ["", "not-a-date", "2026-7-9", "20260729", "2026-07-29T00:00:00Z", "2026-07"]) {
      expect(shiftIsoDate(bad, 1)).toBe(bad);
    }
  });

  it("THE NEGATIVE-OFFSET ROW: does not use new Date(iso) local-getter arithmetic (the documented off-by-one)", () => {
    // The trap: `new Date("2026-03-01")` is UTC midnight, so in ANY negative-offset zone its LOCAL
    // calendar fields already read as the previous day -- a setDate(-1) then reading local getters
    // lands two days back. Reproduce the wrong implementation here and require it to differ from
    // the shipped one whenever the runner is in a negative-offset zone (this sandbox: UTC-5/6).
    const naive = (iso: string, delta: number) => {
      const d = new Date(iso);
      d.setDate(d.getDate() + delta);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const offsetMinutes = new Date("2026-03-01T00:00:00Z").getTimezoneOffset();
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    if (offsetMinutes > 0) {
      // Negative UTC offset (getTimezoneOffset is positive there): the naive version is wrong,
      // proving this assertion is not vacuous on this runner.
      expect(naive("2026-03-01", -1)).not.toBe("2026-02-28");
    }
    // Independent of the runner's zone, the result must match pure UTC calendar arithmetic.
    for (const iso of ["2026-01-01", "2026-03-08", "2026-11-01", "2026-06-15", "2028-02-29"]) {
      for (const delta of [-2, -1, 1, 2]) {
        const [y, m, d] = iso.split("-").map(Number);
        const expected = new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
        expect(shiftIsoDate(iso, delta)).toBe(expected);
      }
    }
  });

  it("crosses a US DST transition without drifting (2026-03-08 spring forward, 2026-11-01 fall back)", () => {
    expect(shiftIsoDate("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftIsoDate("2026-03-08", 1)).toBe("2026-03-09");
    expect(shiftIsoDate("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftIsoDate("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftIsoDate("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("handles multi-day deltas", () => {
    expect(shiftIsoDate("2026-07-29", 7)).toBe("2026-08-05");
    expect(shiftIsoDate("2026-07-29", -30)).toBe("2026-06-29");
    expect(shiftIsoDate("2026-01-15", 365)).toBe("2027-01-15");
  });
});
