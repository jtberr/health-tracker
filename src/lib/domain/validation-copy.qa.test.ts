import { describe, expect, it } from "vitest";
import { validateCopyFoodEntriesInput } from "./validation";

/**
 * QA-REVIEWER independent unit coverage for Phase 8's `validateCopyFoodEntriesInput`.
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3 ("validation still rejects empty
 * entryIds / future toDate for copyFoodEntries") and the 15-minute-grid rule the rest of the
 * time model already enforces -- NOT from src/lib/domain/validation.test.ts.
 *
 * Contract under test, stated explicitly because two of these are easy to get backwards:
 *  - an OMITTED toTime is legal (it means "preserve each source entry's own time-of-day");
 *  - the no-future-day cap is deliberately NOT this function's job (it is tz-aware and lives in
 *    the action), so a future date must NOT be rejected here -- only a malformed one.
 */

const OK_DATE = "2026-07-20";

function fieldsOf(result: ReturnType<typeof validateCopyFoodEntriesInput>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.field);
}

describe("QA: validateCopyFoodEntriesInput", () => {
  it("accepts a minimal valid input with toTime omitted (the copy-day / copy-group case)", () => {
    expect(validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: OK_DATE }).ok).toBe(true);
  });

  it("accepts an explicitly null/undefined toTime the same as an omitted one", () => {
    expect(validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: OK_DATE, toTime: null }).ok).toBe(true);
    expect(validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: OK_DATE, toTime: undefined }).ok).toBe(true);
  });

  it("rejects an empty entryIds list, flagged on the entryIds field", () => {
    const result = validateCopyFoodEntriesInput({ entryIds: [], toDate: OK_DATE });
    expect(result.ok).toBe(false);
    expect(fieldsOf(result)).toContain("entryIds");
  });

  it("rejects a malformed toDate", () => {
    for (const bad of ["", "2026-7-20", "20-07-2026", "not-a-date", "2026/07/20"]) {
      const result = validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: bad });
      expect(result.ok, "should reject " + JSON.stringify(bad)).toBe(false);
      expect(fieldsOf(result)).toContain("toDate");
    }
  });

  it("does NOT reject a future toDate -- the tz-aware cap is the action's job, not this pure function's", () => {
    expect(validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: "2999-12-31" }).ok).toBe(true);
  });

  it("accepts every on-grid quarter-hour toTime, including both boundaries", () => {
    for (const hour of [0, 9, 12, 23]) {
      for (const minute of ["00", "15", "30", "45"]) {
        const t = String(hour).padStart(2, "0") + ":" + minute;
        expect(validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: OK_DATE, toTime: t }).ok, t).toBe(true);
      }
    }
  });

  it("rejects an OFF-GRID toTime (a copy must not route around the 15-minute grid)", () => {
    for (const bad of ["12:07", "00:01", "23:59", "08:14", "08:16"]) {
      const result = validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: OK_DATE, toTime: bad });
      expect(result.ok, "should reject " + bad).toBe(false);
      expect(fieldsOf(result)).toContain("toTime");
    }
  });

  it("rejects a malformed toTime shape before considering the grid", () => {
    for (const bad of ["24:00", "9:30", "12:60", "noon", "12:30:00"]) {
      const result = validateCopyFoodEntriesInput({ entryIds: ["a"], toDate: OK_DATE, toTime: bad });
      expect(result.ok, "should reject " + bad).toBe(false);
      expect(fieldsOf(result)).toContain("toTime");
    }
  });

  it("reports EVERY failing field at once, not just the first", () => {
    const result = validateCopyFoodEntriesInput({ entryIds: [], toDate: "nope", toTime: "12:07" });
    expect(result.ok).toBe(false);
    expect(fieldsOf(result).sort()).toEqual(["entryIds", "toDate", "toTime"]);
  });

  it("is pure -- it does not mutate the input", () => {
    const input = { entryIds: ["a", "b"], toDate: OK_DATE, toTime: "12:15" };
    const snapshot = JSON.parse(JSON.stringify(input));
    validateCopyFoodEntriesInput(input);
    expect(input).toEqual(snapshot);
  });
});
