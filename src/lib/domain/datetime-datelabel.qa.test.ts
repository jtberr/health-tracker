import { describe, expect, it, vi } from "vitest";
import { formatDateLabel } from "./datetime";

/**
 * QA-REVIEWER independent unit suite for `formatDateLabel` (Phase 8b).
 *
 * Written from docs/architecture/food-weight-tracker.md §3.3 (the helper's contract), §3.4
 * ("Human-readable date format -- MM/DD/YYYY, display only") and §6's own
 * "Human-readable date format (Phase 8b)" unit rows -- NOT from the developer's
 * src/lib/domain/datetime.test.ts, which was read only afterwards to look for gaps.
 *
 * §8 Phase 8b states this is the ONLY new pure function the phase is allowed to add
 * ("if any *other* helper appears in lib/domain/*, that is a deviation worth questioning").
 */

describe("formatDateLabel -- the documented contract", () => {
  it("renders the doc's own worked example", () => {
    expect(formatDateLabel("2026-07-29")).toBe("07/29/2026");
  });

  it("keeps zero-padding for single-digit months and days", () => {
    expect(formatDateLabel("2026-01-05")).toBe("01/05/2026");
    expect(formatDateLabel("2026-09-09")).toBe("09/09/2026");
    expect(formatDateLabel("2000-01-01")).toBe("01/01/2000");
  });

  it("produces a fixed-width 10-character MM/DD/YYYY for every day of a leap year", () => {
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= daysInMonth[m - 1]; d++) {
        const iso = `2024-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const label = formatDateLabel(iso);
        expect(label).toHaveLength(10);
        expect(label).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        // Round-trips: the label carries exactly the same three fields, reordered.
        const [mm, dd, yyyy] = label.split("/");
        expect(`${yyyy}-${mm}-${dd}`).toBe(iso);
      }
    }
  });
});

describe("formatDateLabel -- the off-by-one trap the design doc singles out", () => {
  /**
   * §3.4/§6: the implementation must be a plain string reorder, NOT
   * `new Date(iso).toLocaleDateString()` -- which parses "2026-07-29" as UTC midnight and would
   * therefore render the PREVIOUS day in any negative-offset zone.
   *
   * Asserting "the output is the same under TZ=America/Chicago" is the row §6 asks for, but a
   * test process's TZ is fixed at startup, so this asserts the *stronger, deterministic* property
   * that makes the tz row true by construction: the function never touches Date at all. A
   * `new Date()`-based implementation cannot pass this.
   */
  it("never constructs a Date (so no timezone can shift the rendered day)", () => {
    const RealDate = globalThis.Date;
    const dateSpy = vi.fn(() => {
      throw new Error("formatDateLabel must not use Date -- see design doc §3.4");
    });
    // @ts-expect-error -- deliberately replacing the global for this assertion.
    globalThis.Date = dateSpy;
    try {
      expect(formatDateLabel("2026-07-29")).toBe("07/29/2026");
      expect(formatDateLabel("2026-01-01")).toBe("01/01/2026");
      expect(formatDateLabel("2026-12-31")).toBe("12/31/2026");
    } finally {
      globalThis.Date = RealDate;
    }
    expect(dateSpy).not.toHaveBeenCalled();
  });

  it("reproduces the exact value a negative-offset Date-based implementation would get wrong", () => {
    // The control: this is what the rejected implementation yields in America/Chicago.
    const naive = new Date("2026-07-29").toLocaleDateString("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    expect(naive).toBe("07/28/2026"); // the previous day -- the documented bug
    expect(formatDateLabel("2026-07-29")).toBe("07/29/2026"); // the helper is immune
  });
});

describe("formatDateLabel -- malformed input is returned unchanged, never NaN and never throws", () => {
  const passthrough = [
    "",
    "   ",
    "not-a-date",
    "2026-7-9", // unpadded: not the ISO shape this helper accepts
    "26-07-29",
    "2026/07/29",
    "07/29/2026", // already formatted -- must not be re-reordered
    "2026-07-29T12:00:00.000Z", // an instant, not a calendar date
    "2026-07-29 ",
    " 2026-07-29",
  ];

  for (const input of passthrough) {
    it(`returns ${JSON.stringify(input)} unchanged`, () => {
      expect(() => formatDateLabel(input)).not.toThrow();
      expect(formatDateLabel(input)).toBe(input);
      expect(formatDateLabel(input)).not.toContain("NaN");
    });
  }

  it("is idempotent on its own output only in the sense of leaving it alone", () => {
    const once = formatDateLabel("2026-07-29");
    expect(formatDateLabel(once)).toBe(once);
  });

  it("does not silently accept an out-of-range but shape-valid date (shape is the contract)", () => {
    // Deliberately documenting the actual contract: this is a *display* reorder, not a validator.
    // Shape-valid input is reordered even when the calendar day is nonsense -- correct for a
    // display helper (validation lives in DATE_PATTERN / the DB, per §3.4's value/display split),
    // but worth pinning so a future "improvement" that starts throwing here is caught.
    expect(formatDateLabel("2026-99-99")).toBe("99/99/2026");
  });
});
