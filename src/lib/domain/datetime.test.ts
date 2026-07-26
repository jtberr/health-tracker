import { describe, expect, it } from "vitest";
import {
  browserTimeZone,
  defaultConsumedAtForNextEntry,
  floorToQuarterHour,
  formatTimeLabel,
  localDateInTz,
  localDateNotAfterToday,
  localInputToUtcInTz,
  quarterHourOptions,
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

describe("browserTimeZone", () => {
  it("returns a non-empty IANA-looking timezone string", () => {
    const tz = browserTimeZone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });
});
