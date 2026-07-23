/**
 * Pure, framework-free date/time helpers. No Next.js/React/Supabase imports — primary
 * unit-test target per AGENTS.md.
 *
 * Backs three related mechanisms from docs/architecture/food-weight-tracker.md §3.4/§4 and
 * ai-context/DECISIONS.md:
 *  - the 15-minute time grid + floor-to-past "now" default (never a future bucket, so it
 *    composes cleanly with the no-future-day cap);
 *  - the smart `consumed_at` default that makes exact-`consumed_at` meal grouping "free" for
 *    items logged in the same sitting;
 *  - the no-future-day cap on the *local calendar day* (not the raw UTC instant).
 *
 * Uses only `Intl`/`Date` — no date library — since the project has none installed and this is a
 * small, self-contained amount of tz math.
 */

/** Returns the browser's IANA time zone (e.g. "America/New_York"). */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Floors a Date's time-of-day to the previous 15-minute boundary (:00/:15/:30/:45), zeroing
 * seconds/ms. Operates on the Date's own local wall-clock fields (`getHours`/`getMinutes`) —
 * when called client-side with `new Date()`, that's the user's device-local time, which is what
 * the 15-minute grid default needs. Never rounds up: the result is always <= the input instant,
 * so a floored "now" can never land on a not-yet-loggable future bucket.
 */
export function floorToQuarterHour(instant: Date): Date {
  const floored = new Date(instant);
  const flooredMinutes = Math.floor(instant.getMinutes() / 15) * 15;
  floored.setMinutes(flooredMinutes, 0, 0);
  return floored;
}

/**
 * The smart default for a food entry's `consumed_at` (see §3.4): while adding items in the same
 * sitting, default to the previous entry's exact `consumed_at` (so they land in the same
 * exact-timestamp meal group); otherwise default to the quarter-hour floor of `now`.
 *
 * @param lastConsumedAt ISO UTC instant of the most recently *saved* entry for the day being
 *   logged, or `null` for "no recent context" (first entry of a sitting, or the selected day just
 *   changed — callers reset this to `null` on a day change per §3.4's edge cases).
 * @param now The real clock, injected for testability.
 * @param freshnessMinutes The "same sitting" window. Defaults to 120 (design doc §3.4/§4).
 * @returns An ISO UTC instant string: either `lastConsumedAt` unchanged, or the floored `now`.
 */
export function defaultConsumedAtForNextEntry(
  lastConsumedAt: string | null,
  now: Date,
  freshnessMinutes = 120,
): string {
  if (lastConsumedAt !== null) {
    const last = new Date(lastConsumedAt);
    const diffMinutes = (now.getTime() - last.getTime()) / 60_000;
    if (diffMinutes >= 0 && diffMinutes <= freshnessMinutes) {
      return lastConsumedAt;
    }
  }
  return floorToQuarterHour(now).toISOString();
}

/**
 * Converts a wall-clock date + time entered *as if local to `tz`* into a UTC ISO instant.
 * E.g. `localInputToUtcInTz("2026-07-15", "12:00", "America/New_York")` -> the UTC instant that
 * is noon in New York on that date (accounting for whatever DST rule applies that day).
 *
 * No date library is installed, so this uses the standard `Intl.DateTimeFormat`-based technique:
 * guess the instant assuming the wall-clock numbers were already UTC, ask `Intl` what wall-clock
 * time *that guess* shows in `tz`, and correct the guess by the difference. Converges in at most
 * two passes for any real IANA zone (including on/around a DST transition).
 */
export function localInputToUtcInTz(dateStr: string, timeStr: string, tz: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const wallClockAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let guessMs = wallClockAsUtcMs;
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = tzOffsetMinutesAt(guessMs, tz);
    const correctedMs = wallClockAsUtcMs - offsetMinutes * 60_000;
    if (correctedMs === guessMs) break;
    guessMs = correctedMs;
  }

  return new Date(guessMs).toISOString();
}

/**
 * Converts a UTC ISO instant into the wall-clock date/time it represents in `tz` — the inverse
 * direction of `localInputToUtcInTz`, used to prefill a `<input type="date">` / `<input
 * type="time">` pair (e.g. when editing an existing entry, or deriving the smart default's
 * displayable date/time from an ISO instant).
 */
export function utcToLocalTime(isoUtc: string, tz: string): { date: string; time: string } {
  const instant = new Date(isoUtc);
  const parts = formatPartsInTz(instant, tz);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Formats `instant` as the YYYY-MM-DD local calendar date it falls on in `tz`. */
export function localDateInTz(instant: Date, tz: string): string {
  const parts = formatPartsInTz(instant, tz);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * True when `dateStr` (a YYYY-MM-DD local calendar day) is not later than "today" as of `now`,
 * in the local calendar of `tz`. Backs the no-future-day cap (§2/§4): applies to add/edit for
 * food entries here; the same helper is reused for weight/body-fat (`metricTz`) and, in a later
 * phase, copy's `toDate`.
 */
export function localDateNotAfterToday(dateStr: string, tz: string, now: Date = new Date()): boolean {
  return dateStr <= localDateInTz(now, tz);
}

// ---------------------------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------------------------

function formatPartsInTz(
  instant: Date,
  tz: string,
): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  // Some environments render midnight as "24" with hour12: false; normalize to "00".
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/**
 * The offset `tz` observes at `instantMs`, in minutes, as (local wall-clock reading minus the
 * true UTC instant) — e.g. -240 for America/New_York in EDT (UTC-4): local reads 4 hours
 * "earlier" than the UTC instant number. Negative west of UTC, positive east.
 */
function tzOffsetMinutesAt(instantMs: number, tz: string): number {
  const instant = new Date(instantMs);
  const parts = formatPartsInTz(instant, tz);
  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtcMs - instantMs) / 60_000;
}
