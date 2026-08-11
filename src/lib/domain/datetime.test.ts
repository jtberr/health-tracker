import { describe, expect, it } from "vitest";
import {
  browserTimeZone,
  defaultConsumedAtForNextEntry,
  floorToQuarterHour,
  formatDateLabel,
  formatTimeLabel,
  isValidTimeZone,
  localDateInTz,
  localDateNotAfterToday,
  localInputToUtcInTz,
  quarterHourGroupIndexFor,
  quarterHourOptionGroups,
  quarterHourOptions,
  shiftIsoDate,
  utcToLocalTime,
} from "./datetime";

describe("floorToQuarterHour", () => {
  it("leaves an on-grid time unchanged (12:00 -> 12:00)", () => {
    const result = floorToQuarterHour(new Date(2026, 6, 15, 12, 0, 30));
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it("floors 12:07 to 12:00", () => {
    const result = floorToQuarterHour(new Date(2026, 6, 15, 12, 7));
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
  });

  it("leaves 12:15 unchanged", () => {
    const result = floorToQuarterHour(new Date(2026, 6, 15, 12, 15));
    expect(result.getMinutes()).toBe(15);
  });

  it("floors 12:44 to 12:30", () => {
    const result = floorToQuarterHour(new Date(2026, 6, 15, 12, 44));
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(30);
  });

  it("floors 12:59 to 12:45", () => {
    const result = floorToQuarterHour(new Date(2026, 6, 15, 12, 59));
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(45);
  });

  it("never rounds up past the injected instant", () => {
    const now = new Date(2026, 6, 15, 9, 1);
    const result = floorToQuarterHour(now);
    expect(result.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("zeroes seconds and milliseconds", () => {
    const result = floorToQuarterHour(new Date(2026, 6, 15, 8, 3, 45, 123));
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe("defaultConsumedAtForNextEntry", () => {
  it("returns the floor of now when lastConsumedAt is null (first entry)", () => {
    const now = new Date(2026, 6, 15, 12, 7);
    const result = defaultConsumedAtForNextEntry(null, now);
    const expected = floorToQuarterHour(now).toISOString();
    expect(result).toBe(expected);
  });

  it("returns lastConsumedAt when within the freshness window (same sitting)", () => {
    const last = "2026-07-15T12:00:00.000Z";
    const now = new Date("2026-07-15T13:30:00.000Z"); // 90 minutes later
    expect(defaultConsumedAtForNextEntry(last, now, 120)).toBe(last);
  });

  it("returns the floor of now when the freshness window has elapsed", () => {
    const last = "2026-07-15T12:00:00.000Z";
    const now = new Date("2026-07-15T14:30:00.000Z"); // 150 minutes later > 120
    const result = defaultConsumedAtForNextEntry(last, now, 120);
    expect(result).not.toBe(last);
    expect(result).toBe(floorToQuarterHour(now).toISOString());
  });

  it("boundary: exactly at the freshness window still counts as the same sitting", () => {
    const last = "2026-07-15T12:00:00.000Z";
    const now = new Date("2026-07-15T14:00:00.000Z"); // exactly 120 minutes later
    expect(defaultConsumedAtForNextEntry(last, now, 120)).toBe(last);
  });

  it("boundary: one minute past the freshness window reverts to floor-of-now", () => {
    const last = "2026-07-15T12:00:00.000Z";
    const now = new Date("2026-07-15T14:01:00.000Z"); // 121 minutes later
    expect(defaultConsumedAtForNextEntry(last, now, 120)).not.toBe(last);
  });

  it("respects a custom freshness window", () => {
    const last = "2026-07-15T12:00:00.000Z";
    const now = new Date("2026-07-15T12:20:00.000Z"); // 20 minutes later; floor(now) = 12:15, distinct from last
    expect(defaultConsumedAtForNextEntry(last, now, 5)).not.toBe(last);
    expect(defaultConsumedAtForNextEntry(last, now, 25)).toBe(last);
  });

  it("treats a lastConsumedAt after now (clock skew) as outside the window", () => {
    const last = "2026-07-15T12:30:00.000Z";
    const now = new Date("2026-07-15T12:00:00.000Z"); // "before" last
    const result = defaultConsumedAtForNextEntry(last, now, 120);
    expect(result).not.toBe(last);
  });
});

describe("localInputToUtcInTz / utcToLocalTime (round trip + known offsets)", () => {
  it("converts a New York summer (EDT, UTC-4) wall time to the correct UTC instant", () => {
    const utc = localInputToUtcInTz("2026-07-15", "12:00", "America/New_York");
    expect(utc).toBe("2026-07-15T16:00:00.000Z");
  });

  it("converts a New York winter (EST, UTC-5) wall time to the correct UTC instant", () => {
    const utc = localInputToUtcInTz("2026-01-15", "12:00", "America/New_York");
    expect(utc).toBe("2026-01-15T17:00:00.000Z");
  });

  it("converts a Tokyo (UTC+9, no DST) wall time to the correct UTC instant", () => {
    const utc = localInputToUtcInTz("2026-07-15", "23:00", "Asia/Tokyo");
    expect(utc).toBe("2026-07-15T14:00:00.000Z");
  });

  it("round-trips utcToLocalTime(localInputToUtcInTz(...)) back to the same wall time", () => {
    const utc = localInputToUtcInTz("2026-03-10", "09:30", "America/New_York");
    const back = utcToLocalTime(utc, "America/New_York");
    expect(back).toEqual({ date: "2026-03-10", time: "09:30" });
  });

  it("handles a UTC-vs-local date rollover (New York evening -> next day UTC)", () => {
    const utc = localInputToUtcInTz("2026-07-15", "23:00", "America/New_York");
    // 23:00 EDT (UTC-4) is 03:00 UTC the *next* day.
    expect(utc).toBe("2026-07-16T03:00:00.000Z");
  });
});

describe("localDateNotAfterToday", () => {
  it("accepts today (in the given tz)", () => {
    const now = new Date("2026-07-15T18:00:00.000Z");
    expect(localDateNotAfterToday("2026-07-15", "UTC", now)).toBe(true);
  });

  it("accepts a past date", () => {
    const now = new Date("2026-07-15T18:00:00.000Z");
    expect(localDateNotAfterToday("2026-07-01", "UTC", now)).toBe(true);
  });

  it("rejects a future date", () => {
    const now = new Date("2026-07-15T18:00:00.000Z");
    expect(localDateNotAfterToday("2026-07-16", "UTC", now)).toBe(false);
  });

  it("does not spuriously reject 'today' for a tz ahead of UTC near midnight UTC", () => {
    // 2026-07-15T23:00:00Z is already 2026-07-16 local in Tokyo (UTC+9).
    const now = new Date("2026-07-15T23:00:00.000Z");
    expect(localDateNotAfterToday("2026-07-16", "Asia/Tokyo", now)).toBe(true);
    expect(localDateNotAfterToday("2026-07-17", "Asia/Tokyo", now)).toBe(false);
  });

  it("does not spuriously accept a UTC 'tomorrow' for a tz behind UTC", () => {
    // 2026-07-15T02:00:00Z is still 2026-07-14 local in New York (UTC-4 in July).
    const now = new Date("2026-07-15T02:00:00.000Z");
    expect(localDateNotAfterToday("2026-07-14", "America/New_York", now)).toBe(true);
    expect(localDateNotAfterToday("2026-07-15", "America/New_York", now)).toBe(false);
  });
});

describe("localDateInTz", () => {
  it("formats an instant as YYYY-MM-DD in the given tz", () => {
    expect(localDateInTz(new Date("2026-07-15T18:00:00.000Z"), "UTC")).toBe("2026-07-15");
  });

  it("rolls over to the next local day ahead of UTC", () => {
    expect(localDateInTz(new Date("2026-07-15T23:00:00.000Z"), "Asia/Tokyo")).toBe("2026-07-16");
  });

  it("stays on the previous local day behind UTC near midnight UTC", () => {
    expect(localDateInTz(new Date("2026-07-15T02:00:00.000Z"), "America/New_York")).toBe("2026-07-14");
  });
});

describe("formatTimeLabel", () => {
  it("formats midnight as 12:00 AM", () => {
    expect(formatTimeLabel("00:00")).toBe("12:00 AM");
  });

  it("formats 12:15 AM just after midnight", () => {
    expect(formatTimeLabel("00:15")).toBe("12:15 AM");
  });

  it("formats a morning time with a zero-padded hour", () => {
    expect(formatTimeLabel("08:15")).toBe("08:15 AM");
  });

  it("formats 11:45 AM just before noon", () => {
    expect(formatTimeLabel("11:45")).toBe("11:45 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatTimeLabel("12:00")).toBe("12:00 PM");
  });

  it("formats 12:15 PM just after noon", () => {
    expect(formatTimeLabel("12:15")).toBe("12:15 PM");
  });

  it("formats an afternoon/evening time with a zero-padded hour", () => {
    expect(formatTimeLabel("18:30")).toBe("06:30 PM");
  });

  it("formats the last bucket of the day", () => {
    expect(formatTimeLabel("23:45")).toBe("11:45 PM");
  });
});

describe("quarterHourOptions", () => {
  const options = quarterHourOptions();

  it("returns exactly 96 options (24 hours x 4 quarter-hours)", () => {
    expect(options).toHaveLength(96);
  });

  it("starts at midnight and ends at 11:45 PM, in ascending order", () => {
    expect(options[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(options[95]).toEqual({ value: "23:45", label: "11:45 PM" });
  });

  it("has all unique, strictly ascending 24-hour HH:MM values", () => {
    const values = options.map((o) => o.value);
    const sorted = [...values].sort();
    expect(values).toEqual(sorted);
    expect(new Set(values).size).toBe(96);
  });

  it("every value matches the HH:MM pattern on a 15-minute boundary", () => {
    for (const { value } of options) {
      expect(value).toMatch(/^([01]\d|2[0-3]):([0-5]\d)$/);
      const minutes = Number(value.slice(3, 5));
      expect(minutes % 15).toBe(0);
    }
  });

  it("crosses the noon AM/PM boundary correctly", () => {
    expect(options.find((o) => o.value === "11:45")).toEqual({ value: "11:45", label: "11:45 AM" });
    expect(options.find((o) => o.value === "12:00")).toEqual({ value: "12:00", label: "12:00 PM" });
    expect(options.find((o) => o.value === "12:15")).toEqual({ value: "12:15", label: "12:15 PM" });
  });

  it("crosses the midnight AM/PM boundary correctly", () => {
    expect(options.find((o) => o.value === "23:45")).toEqual({ value: "23:45", label: "11:45 PM" });
    expect(options.find((o) => o.value === "00:00")).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(options.find((o) => o.value === "00:15")).toEqual({ value: "00:15", label: "12:15 AM" });
  });

  it("labels every option via formatTimeLabel(value)", () => {
    for (const { value, label } of options) {
      expect(label).toBe(formatTimeLabel(value));
    }
  });

  it("every label is exactly 8 characters (zero-padded hh:mm AM|PM), so the list lines up in a column", () => {
    for (const { label } of options) {
      expect(label).toHaveLength(8);
      expect(label).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
    }
  });
});

describe("quarterHourOptionGroups", () => {
  const groups = quarterHourOptionGroups();

  it("returns exactly three groups", () => {
    expect(groups).toHaveLength(3);
  });

  it("has the expected labels, de-emphasis flags, and counts (24/57/15)", () => {
    expect(groups[0]).toMatchObject({ label: "Early (12 AM – 6 AM)", deEmphasized: true });
    expect(groups[0].options).toHaveLength(24);
    expect(groups[1]).toMatchObject({ label: "Daytime (6 AM – 8:00 PM)", deEmphasized: false });
    expect(groups[1].options).toHaveLength(57);
    expect(groups[2]).toMatchObject({ label: "Late (after 8:00 PM – 12 AM)", deEmphasized: true });
    expect(groups[2].options).toHaveLength(15);
  });

  it("24 + 57 + 15 = 96", () => {
    const total = groups.reduce((sum, group) => sum + group.options.length, 0);
    expect(total).toBe(96);
  });

  it("boundaries land exactly at 06:00, and AFTER 20:00 rather than AT it (2026-08-10: 8:00 PM itself stays Daytime)", () => {
    expect(groups[0].options.at(-1)).toEqual({ value: "05:45", label: "05:45 AM" });
    expect(groups[1].options[0]).toEqual({ value: "06:00", label: "06:00 AM" });
    expect(groups[1].options.at(-1)).toEqual({ value: "20:00", label: "08:00 PM" });
    expect(groups[2].options[0]).toEqual({ value: "20:15", label: "08:15 PM" });
  });

  it("THE IDENTITY ROW: concatenating every group's options deep-equals quarterHourOptions() exactly — proves nothing was lost, duplicated, or reordered", () => {
    const concatenated = groups.flatMap((group) => group.options);
    expect(concatenated).toEqual(quarterHourOptions());
  });

  it("is pure/static — calling it twice returns equal (though not necessarily identical) results", () => {
    expect(quarterHourOptionGroups()).toEqual(groups);
  });
});

describe("quarterHourGroupIndexFor", () => {
  it("assigns every one of the 96 on-grid options to the group that actually contains it", () => {
    const groups = quarterHourOptionGroups();
    for (const { value } of quarterHourOptions()) {
      const index = quarterHourGroupIndexFor(value);
      expect(groups[index].options.some((o) => o.value === value)).toBe(true);
    }
  });

  it("resolves the exact boundary values to the correct side", () => {
    expect(quarterHourGroupIndexFor("05:45")).toBe(0);
    expect(quarterHourGroupIndexFor("06:00")).toBe(1);
    expect(quarterHourGroupIndexFor("19:45")).toBe(1);
    // 2026-08-10: 20:00 (8:00 PM) itself is now Daytime -- only strictly AFTER it is Late.
    expect(quarterHourGroupIndexFor("20:00")).toBe(1);
    expect(quarterHourGroupIndexFor("20:15")).toBe(2);
    expect(quarterHourGroupIndexFor("00:00")).toBe(0);
    expect(quarterHourGroupIndexFor("23:45")).toBe(2);
  });

  it("resolves an off-grid (non-quarter-hour) value correctly, e.g. the FoodEntryForm edit invariant's 09:07 -- including the hour-20 special case", () => {
    expect(quarterHourGroupIndexFor("09:07")).toBe(1);
    expect(quarterHourGroupIndexFor("03:33")).toBe(0);
    expect(quarterHourGroupIndexFor("21:59")).toBe(2);
    // Same hour (20) as the boundary, but off-grid and past the exact 20:00 cut -- must be Late,
    // not Daytime, even though a naive hour-only check would have called all of hour 20 Daytime.
    expect(quarterHourGroupIndexFor("20:07")).toBe(2);
    // A malformed/unparseable minute on hour 20 defaults to minute 0 -- the safe Daytime side.
    expect(quarterHourGroupIndexFor("20:xx")).toBe(1);
  });

  it("never throws on malformed input and falls back to the Daytime group", () => {
    expect(() => quarterHourGroupIndexFor("")).not.toThrow();
    expect(quarterHourGroupIndexFor("")).toBe(1);
    expect(() => quarterHourGroupIndexFor("not-a-time")).not.toThrow();
    expect(quarterHourGroupIndexFor("not-a-time")).toBe(1);
  });
});

describe("isValidTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });

  it("accepts UTC", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("accepts another real IANA zone with no DST", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
  });

  it("rejects garbled/tampered input", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidTimeZone("")).toBe(false);
  });

  it("rejects a plain offset string (not an IANA zone name)", () => {
    expect(isValidTimeZone("UTC+9")).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(isValidTimeZone("   ")).toBe(false);
  });

  it("never throws, even on obviously malicious/oversized input", () => {
    expect(() => isValidTimeZone("x".repeat(10_000))).not.toThrow();
    expect(isValidTimeZone("x".repeat(10_000))).toBe(false);
  });
});

describe("formatDateLabel", () => {
  it("reorders YYYY-MM-DD to MM/DD/YYYY", () => {
    expect(formatDateLabel("2026-07-29")).toBe("07/29/2026");
  });

  it("zero-pads single-digit months and days (already zero-padded in the ISO input)", () => {
    expect(formatDateLabel("2026-01-05")).toBe("01/05/2026");
  });

  it("a date is never shifted by a day in a negative-offset timezone (the new Date() off-by-one trap)", () => {
    // This is the case a `new Date(iso).toLocaleDateString()` implementation would get wrong:
    // `new Date("2026-07-29")` parses as UTC midnight, which is still "2026-07-28" evening in
    // America/Chicago (a negative-offset zone) -- confirmed directly below, so the assertion that
    // formatDateLabel does NOT reproduce that shift is meaningful, not vacuous.
    expect(
      new Date("2026-07-29").toLocaleDateString("en-US", { timeZone: "America/Chicago" }),
    ).toBe("7/28/2026");

    const original = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      expect(formatDateLabel("2026-07-29")).toBe("07/29/2026");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("returns malformed/empty input unchanged rather than throwing or producing NaN", () => {
    expect(formatDateLabel("")).toBe("");
    expect(formatDateLabel("not-a-date")).toBe("not-a-date");
    expect(formatDateLabel("2026-7-29")).toBe("2026-7-29");
    expect(formatDateLabel("2026-07-29T00:00:00.000Z")).toBe("2026-07-29T00:00:00.000Z");
  });

  it("never throws", () => {
    expect(() => formatDateLabel("")).not.toThrow();
    expect(() => formatDateLabel("x".repeat(1000))).not.toThrow();
  });
});

describe("shiftIsoDate", () => {
  it("moves one day forward within a month", () => {
    expect(shiftIsoDate("2026-07-15", 1)).toBe("2026-07-16");
  });

  it("moves one day backward within a month", () => {
    expect(shiftIsoDate("2026-07-15", -1)).toBe("2026-07-14");
  });

  it("crosses forward over a month end", () => {
    expect(shiftIsoDate("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("crosses backward over a month start", () => {
    expect(shiftIsoDate("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("crosses forward over a year end", () => {
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses backward over a year start", () => {
    expect(shiftIsoDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("crosses forward over a leap day (2028 is a leap year)", () => {
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftIsoDate("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("skips Feb 29 in a non-leap year", () => {
    expect(shiftIsoDate("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("a delta of 0 returns the same date", () => {
    expect(shiftIsoDate("2026-07-15", 0)).toBe("2026-07-15");
  });

  it("supports multi-day deltas", () => {
    expect(shiftIsoDate("2026-07-15", 30)).toBe("2026-08-14");
    expect(shiftIsoDate("2026-07-15", -30)).toBe("2026-06-15");
  });

  it("is stable under the test runner's configured local timezone (never uses new Date(iso) local-field reads)", () => {
    // The trap this helper must avoid: new Date("2026-03-01") parses as UTC midnight, and reading
    // its LOCAL calendar fields (getDate()/getMonth()) in a negative-offset zone would show
    // 2026-02-28, silently landing one day early. Force a negative-offset TZ and confirm
    // shiftIsoDate still gets the right answer.
    const original = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
      expect(shiftIsoDate("2026-02-28", 1)).toBe("2026-03-01");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("returns malformed/empty input unchanged rather than throwing or producing NaN", () => {
    expect(shiftIsoDate("", 1)).toBe("");
    expect(shiftIsoDate("not-a-date", 1)).toBe("not-a-date");
    expect(shiftIsoDate("2026-7-15", 1)).toBe("2026-7-15");
    expect(shiftIsoDate("2026-07-15T00:00:00.000Z", 1)).toBe("2026-07-15T00:00:00.000Z");
  });

  it("never throws", () => {
    expect(() => shiftIsoDate("", 1)).not.toThrow();
    expect(() => shiftIsoDate("x".repeat(1000), 1)).not.toThrow();
  });
});

describe("browserTimeZone", () => {
  it("returns a non-empty IANA-looking timezone string", () => {
    const tz = browserTimeZone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });
});
