export type ProgressBarProps = {
  /** Bar fill width, 0..100 -- always `GoalProgress.barPct`, never the unclamped `pct` (a bar
   * cannot render past 100%; see `lib/domain/goal-progress.ts`'s doc comment for why the two
   * fields exist). */
  barPct: number;
  /** `"accent"` (protein) or `"accent-warm"` (calories) -- the two roles this bar is used for on
   * `/food`'s `DailyTotals` (Phase 8j). No other colour is offered; being over target must NOT
   * turn the bar red (red is semantic-error in this palette, and exceeding a calorie goal is not
   * an error -- see ai-context/DECISIONS.md's Phase 8j entry). */
  color: "accent" | "accent-warm";
};

const fillClass: Record<ProgressBarProps["color"], string> = {
  accent: "bg-accent",
  "accent-warm": "bg-accent-warm",
};

/**
 * Thin decorative goal-progress bar (Phase 8j, 2026-08-09/10 addition — design doc §3.4 "Daily
 * goal progress on `/food`"). `aria-hidden="true"`, no `role="progressbar"`, no `aria-valuenow` --
 * the caption text rendered alongside it (by the caller, `DailyTotals`) already states consumed,
 * target and remaining in prose, so a screen reader would otherwise hear the same fact twice, the
 * second time as a bare, less meaningful percentage. This also settles WCAG 1.4.11 by
 * construction: nothing depends on perceiving the track/fill contrast, since the bar carries no
 * information the text doesn't already carry.
 */
export function ProgressBar({ barPct, color }: ProgressBarProps) {
  return (
    <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${fillClass[color]}`}
        style={{ width: `${barPct}%` }}
      />
    </div>
  );
}
