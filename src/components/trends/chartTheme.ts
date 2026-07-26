/**
 * Recharts chart-chrome color constants.
 *
 * `WeightChart`/`IntakeChart` draw their *data* series (the weight/body-fat/calories/protein
 * lines, their dot markers, and goal `ReferenceLine`s) using the project's real `--sage-deep`/
 * `--clay` brand tokens — via the same `className="text-sage-deep"` + `stroke="currentColor"`
 * technique the dashboard's "sage arc" motif already uses (`(app)/page.tsx`), so those elements
 * have exactly one source of truth in `globals.css`, per
 * ai-context/DECISIONS.md ("Visual-identity tokens live in globals.css...").
 *
 * `CartesianGrid`/`XAxis`/`YAxis`, however, do NOT accept a `className` prop (checked against the
 * installed `recharts` type declarations) — they only take literal color strings for `stroke`/
 * `tick.fill`. The two constants below are that unavoidable exception, and are deliberately NOT a
 * second copy of the brand palette: they're Tailwind's own built-in neutral `stone-200`/`stone-500`
 * shades (already used elsewhere in this codebase as `border-stone-200`/`text-stone-500` classes),
 * repeated here only because this handful of props can't consume a class at all.
 */
export const CHART_GRID_COLOR = "#e7e5e4"; // Tailwind's stone-200
export const CHART_TICK_COLOR = "#78716c"; // Tailwind's stone-500

/** Parses a `YYYY-MM-DD` string as a UTC calendar date, avoiding local-tz off-by-one shifts. */
function parseCalendarDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Short axis-tick label for a `YYYY-MM-DD` date, e.g. "Jul 25". */
export function formatAxisDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    parseCalendarDate(dateStr),
  );
}

/** Full tooltip label for a `YYYY-MM-DD` date, e.g. "Jul 25, 2026". */
export function formatTooltipDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseCalendarDate(dateStr));
}
