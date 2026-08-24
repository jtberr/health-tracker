import { describe, it, expect } from "vitest";
import {
  quarterHourOptions,
  quarterHourOptionGroups,
  quarterHourGroupIndexFor,
} from "./datetime";

/**
 * QA-REVIEWER independent Phase 8e unit suite -- "Scanning the time picker: quarter-hour option
 * groups".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3 (the QuarterHourGroup type comment and
 * the two exported signatures), 3.4's "Shading early and late hours in the time <select>" block,
 * 6's unit bullet and 8's Phase 8e section -- NOT from the developer's own datetime.test.ts, which
 * was read only afterwards to look for gaps.
 *
 * THE ROW TO HAMMER (6, verbatim): "the groups' options concatenated must deep-equal
 * quarterHourOptions()". That identity is what mechanically proves nothing was lost, duplicated,
 * disabled or reordered by the partition -- Jeff's constraint was explicit.
 */

describe("Phase 8e -- quarterHourOptionGroups: the identity that proves nothing was lost", () => {
  it("THE ROW TO HAMMER: concatenating every group deep-equals quarterHourOptions() exactly", () => {
    const flat = quarterHourOptionGroups().flatMap((g) => g.options);
    expect(flat).toEqual(quarterHourOptions());
  });

  it("preserves all 96 options, their exact HH:MM values, and chronological order", () => {
    const flat = quarterHourOptionGroups().flatMap((g) => g.options);
    expect(flat).toHaveLength(96);
    const values = flat.map((o) => o.value);
    expect(new Set(values).size).toBe(96); // no duplicates
    expect([...values].sort()).toEqual(values); // zero-padded HH:MM sorts == chronological
    expect(values[0]).toBe("00:00");
    expect(values[95]).toBe("23:45");
    for (const v of values) expect(v).toMatch(/^\d{2}:(00|15|30|45)$/);
  });

  it("preserves the zero-padded 12-hour labels unchanged (the 2026-07-26 alignment fix)", () => {
    const flat = quarterHourOptionGroups().flatMap((g) => g.options);
    for (const o of flat) expect(o.label).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
    // Every label is exactly 8 characters, which is what makes the column line up.
    expect(new Set(flat.map((o) => o.label.length))).toEqual(new Set([8]));
  });

  it("is pure/static: repeated calls produce equal, independent arrays", () => {
    const a = quarterHourOptionGroups();
    const b = quarterHourOptionGroups();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a[0].options.push({ value: "99:99", label: "bogus" });
    expect(quarterHourOptionGroups()[0].options).toHaveLength(b[0].options.length);
  });

  it("returns exactly three groups, of which the first and last are the de-emphasized ones", () => {
    const groups = quarterHourOptionGroups();
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.deEmphasized)).toEqual([true, false, true]);
    // Every group carries a non-empty label string (kept as a stable React key even though the
    // rendered <optgroup label> text was deliberately dropped in the 2026-08-09 bugfix).
    for (const g of groups) expect(g.label.length).toBeGreaterThan(0);
    // No group is empty, and none overlaps another.
    const seen = new Set<string>();
    for (const g of groups) {
      expect(g.options.length).toBeGreaterThan(0);
      for (const o of g.options) {
        expect(seen.has(o.value)).toBe(false);
        seen.add(o.value);
      }
    }
  });
});

describe("Phase 8e -- group boundaries", () => {
  it("the Early/Daytime boundary is exactly at 06:00, per 3.3/3.4", () => {
    const [early, daytime] = quarterHourOptionGroups();
    expect(early.options.map((o) => o.value)).toContain("05:45");
    expect(early.options.map((o) => o.value)).not.toContain("06:00");
    expect(daytime.options.map((o) => o.value)).toContain("06:00");
    expect(early.options).toHaveLength(24); // 12 AM -- 6 AM
  });

  /**
   * FINDING (pinned, NOT endorsed) -- an UNRECORDED post-implementation change to a spec'd contract.
   *
   * The design doc says the three groups are 24 / 56 / 16 with "boundaries exactly at 06:00 and
   * 20:00" (3.3's unit bullet and 3.4's "Late (8 PM - 12 AM)" (16)), and 6 asks that "19:45/20:00
   * fall on the expected sides" -- i.e. on OPPOSITE sides.
   *
   * The shipped code is 24 / 57 / 15: `20:00` itself was moved INTO Daytime on 2026-08-10 at
   * Jeff's direct request ("shade the entries AFTER 8:00 PM, leave 8:00 PM unshaded"), recorded
   * ONLY in a code comment -- there is no ai-context/DECISIONS.md entry, no PROGRESS.md note, and
   * the design doc still states the old numbers.
   *
   * The change itself is reasonable and traceable to Jeff. What is missing is the paperwork, which
   * is the exact gap that produced blocking findings in Phases 7b and 7c. This test pins the
   * SHIPPED behaviour so it can't drift again silently, and names the divergence so the doc can be
   * corrected rather than the code changed back by someone reading the doc.
   */
  it("FINDING: the Daytime/Late boundary is AFTER 20:00 (24/57/15), not the doc's 24/56/16", () => {
    const [early, daytime, late] = quarterHourOptionGroups();
    expect([early.options.length, daytime.options.length, late.options.length]).toEqual([24, 57, 15]);
    expect(daytime.options.map((o) => o.value)).toContain("19:45");
    expect(daytime.options.map((o) => o.value)).toContain("20:00"); // doc says this is Late
    expect(late.options.map((o) => o.value)).toContain("20:15");
    expect(late.options[late.options.length - 1].value).toBe("23:45");
  });
});

describe("Phase 8e -- quarterHourGroupIndexFor", () => {
  it("agrees with quarterHourOptionGroups() for every one of the 96 real options", () => {
    const groups = quarterHourOptionGroups();
    groups.forEach((group, index) => {
      for (const option of group.options) {
        expect(quarterHourGroupIndexFor(option.value), option.value).toBe(index);
      }
    });
  });

  it("places an OFF-GRID legacy time in the group that would contain it", () => {
    // The 6 row: a legacy 09:07 must land inside Daytime, so FoodEntryForm's defensive injection
    // puts it in the right place instead of dropping it or appending it outside every group.
    expect(quarterHourGroupIndexFor("09:07")).toBe(1);
    expect(quarterHourGroupIndexFor("03:07")).toBe(0);
    expect(quarterHourGroupIndexFor("22:07")).toBe(2);
    // Straddling the moved boundary, consistent with the FINDING above.
    expect(quarterHourGroupIndexFor("20:01")).toBe(2);
    expect(quarterHourGroupIndexFor("19:59")).toBe(1);
  });

  it("never throws on malformed input and falls back to Daytime", () => {
    for (const bad of ["", "   ", "abc", ":", "not-a-time", "9", "::::"]) {
      expect(() => quarterHourGroupIndexFor(bad)).not.toThrow();
    }
    // Specifically NOT Early -- a naive Number("".slice(0,2)) === 0 would misclassify "" as Early.
    expect(quarterHourGroupIndexFor("")).toBe(1);
    expect(quarterHourGroupIndexFor("abc")).toBe(1);
  });
});
