/**
 * Pure, framework-free trend-chart series builders. No Next.js/React/Supabase imports — primary
 * unit-test target per AGENTS.md.
 *
 * Backs Phase 5 ("Trend charts", docs/architecture/food-weight-tracker.md §8 Phase 5) and the
 * "chart gaps: connect across missing days, mark real entries with a dot" decision
 * (ai-context/DECISIONS.md): given a start/end date and the rows a user actually logged, produce a
 * DENSE day-by-day series — every calendar day in the range is present, with `null` values (and
 * `isReal: false`) standing in for days with nothing logged. `WeightChart`/`IntakeChart` render
 * that array as a single continuous line (Recharts `connectNulls`) while pointing dot markers only
 * at `isReal` days, matching the decision exactly.
 *
 * Dates are plain `YYYY-MM-DD` local-calendar-day strings throughout (matching
 * `daily_metrics.metric_date` / `daily_food_totals.consumed_local_date`) — no per-row timezone math
 * is needed here (that already happened once, upstream, when `consumed_local_date` was derived;
 * see `datetime.ts` / DECISIONS.md "Food-entry timestamps..."). All date arithmetic below uses
 * `Date.UTC` purely as a calendar calculator (never as an instant/timezone conversion), so results
 * are deterministic regardless of the host machine's local timezone — required for these tests to
 * be stable in CI regardless of the runner's tz.
 */

/** The three selectable chart ranges (design doc §2/§8 Phase 5: "selectable range (7/30/90 days)"). */
export const TREND_RANGES = [7, 30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

/** 30 days is the default when `?range=` is absent or not one of the three valid values. */
const DEFAULT_TREND_RANGE: TrendRange = 30;

function isTrendRange(value: number): value is TrendRange {
  return (TREND_RANGES as readonly number[]).includes(value);
}

/**
 * Parses the `RangeSelector`/`trends/page.tsx` `?range=` query-param value into a `TrendRange`,
 * defaulting to 30 days for anything missing or invalid (not exactly "7"/"30"/"90") rather than
 * throwing — a mistyped, stale, or hand-edited URL should never break the page.
 */
export function parseRangeParam(value: string | undefined): TrendRange {
  if (value === undefined) return DEFAULT_TREND_RANGE;
  const parsed = Number(value);
  return isTrendRange(parsed) ? parsed : DEFAULT_TREND_RANGE;
}

/** Adds `days` (may be negative) to a `YYYY-MM-DD` calendar date, returning a `YYYY-MM-DD` string. */
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/**
 * The inclusive start date of a `range`-day window ending on `endDate` (typically "today" in the
 * user's local timezone, resolved by the caller via `datetime.browserTimeZone`/`localDateInTz`).
 * E.g. a 7-day range ending "2026-07-25" starts "2026-07-19" — 7 calendar days total, `endDate`
 * included.
 */
export function startDateForRange(endDate: string, range: TrendRange): string {
  return addDays(endDate, -(range - 1));
}

/**
 * Every `YYYY-MM-DD` calendar date from `startDate` to `endDate` inclusive, in chronological
 * order. Returns an empty array if `startDate` is after `endDate` (defensive — callers shouldn't
 * construct that, but an empty series is a safer failure mode than an infinite loop).
 */
export function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  if (startDate > endDate) return dates;
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

/** One point of the weight/body-fat trend series — see the module doc comment for the dense-fill rule. */
export type WeightSeriesPoint = {
  date: string;
  /** Canonical kg, exactly as stored. Display-unit (kg/lb) conversion is a `WeightChart` render concern — see `lib/domain/units.ts`. */
  weightKg: number | null;
  bodyFatPct: number | null;
  /** True iff the user actually logged a `daily_metrics` row for this date (drives the dot marker — never derive it from `weightKg !== null` at the call site). */
  isReal: boolean;
};

/** One point of the calories/protein trend series — see the module doc comment for the dense-fill rule. */
export type IntakeSeriesPoint = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  /** True iff `daily_food_totals` has a row (at least one entry logged) for this date. */
  isReal: boolean;
};

/**
 * Builds a dense `WeightSeriesPoint[]` for every day in `[startDate, endDate]`, filling any day
 * with no `daily_metrics` row with `null` values and `isReal: false`. `rows` need not be sorted or
 * cover every day — only real rows for days actually logged; a weight-only day (no body fat %
 * recorded) still has `isReal: true` with `bodyFatPct: null`.
 */
export function buildWeightSeries(
  rows: readonly { metric_date: string; weight_kg: number; body_fat_pct: number | null }[],
  startDate: string,
  endDate: string,
): WeightSeriesPoint[] {
  const byDate = new Map(rows.map((row) => [row.metric_date, row]));
  return dateRange(startDate, endDate).map((date) => {
    const row = byDate.get(date);
    return row
      ? { date, weightKg: row.weight_kg, bodyFatPct: row.body_fat_pct, isReal: true }
      : { date, weightKg: null, bodyFatPct: null, isReal: false };
  });
}

/**
 * Builds a dense `IntakeSeriesPoint[]` for every day in `[startDate, endDate]`, filling any day
 * with no `daily_food_totals` row with `null` values and `isReal: false`. `rows` need not be
 * sorted or cover every day — only real rows for days with at least one logged entry.
 */
export function buildIntakeSeries(
  rows: readonly { consumed_local_date: string; total_calories: number; total_protein_g: number }[],
  startDate: string,
  endDate: string,
): IntakeSeriesPoint[] {
  const byDate = new Map(rows.map((row) => [row.consumed_local_date, row]));
  return dateRange(startDate, endDate).map((date) => {
    const row = byDate.get(date);
    return row
      ? { date, calories: row.total_calories, proteinG: row.total_protein_g, isReal: true }
      : { date, calories: null, proteinG: null, isReal: false };
  });
}
