"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DotItemDotProps } from "recharts";
import type { IntakeSeriesPoint } from "@/lib/domain/trends";
import { Card } from "@/components/ui/Card";
import { CHART_GRID_COLOR, CHART_TICK_COLOR, formatAxisDate, formatTooltipDate } from "./chartTheme";

/**
 * Daily calories + protein trend chart with goal `ReferenceLine`s (design doc §3.1
 * `trends/IntakeChart.tsx`, §8 Phase 5). Same dense-series / dot-only-on-a-logged-day rendering as
 * `WeightChart` — see its doc comment for the full "chart gaps" rationale and for why dot
 * suppression is keyed off each series' own plotted value being non-null rather than `isReal`.
 *
 * A goal `ReferenceLine` is rendered **only when that goal is actually set** —
 * `user_goals.daily_calorie_target`/`daily_protein_target_g` are `null` for a user who hasn't set
 * one (the "ensure-row" default in `lib/actions/goals.ts`'s `getGoals` leaves both null), so a
 * `null` goal here means "don't draw a line", never "draw a line at 0". A goal that sits above the
 * highest plotted value in the visible range still draws its line — `ifOverflow="extendDomain"`
 * on each `ReferenceLine` extends the axis to include it, since Recharts' `"auto"` Y-axis domain is
 * otherwise computed only from the `Line` data and would silently discard (not clip) a
 * `ReferenceLine` outside that range (its default `ifOverflow` is `"discard"`).
 */

type ChartPoint = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  isReal: boolean;
};

type SeriesDotProps = DotItemDotProps & { payload: ChartPoint };

// Dot suppression is keyed off each series' own plotted value being non-null (not `isReal`) — see
// the equivalent note in `WeightChart.tsx`. For this series `calories`/`proteinG` are always set
// together (both come from one `daily_food_totals` row), so this is equivalent to `isReal` in
// practice here, but checking the value directly keeps both charts consistent and doesn't depend
// on `cx`/`cy` happening to come back `null` from Recharts for a `null` data point.
function makeDot(colorClassName: string, valueKey: "calories" | "proteinG") {
  function ChartDot(props: DotItemDotProps) {
    const { cx, cy, payload } = props as SeriesDotProps;
    if (payload[valueKey] == null || cx == null || cy == null) return null;
    return <circle cx={cx} cy={cy} r={3} className={colorClassName} fill="currentColor" stroke="currentColor" />;
  }
  return ChartDot;
}

export type IntakeChartProps = {
  series: IntakeSeriesPoint[];
  /** `user_goals.daily_calorie_target` — `null` when the user hasn't set one. */
  calorieGoal: number | null;
  /** `user_goals.daily_protein_target_g` — `null` when the user hasn't set one. */
  proteinGoal: number | null;
};

export function IntakeChart({ series, calorieGoal, proteinGoal }: IntakeChartProps) {
  const data: ChartPoint[] = series.map((point) => ({
    date: point.date,
    calories: point.calories,
    proteinG: point.proteinG,
    isReal: point.isReal,
  }));
  const hasAnyData = data.some((point) => point.isReal);

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-lg font-semibold text-ink">Calories &amp; protein</h2>
        <div className="flex flex-wrap gap-4 text-xs text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sage-deep" aria-hidden="true" />
            Calories
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-clay" aria-hidden="true" />
            Protein (g)
          </span>
          {calorieGoal !== null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-dashed border-sage-deep" aria-hidden="true" />
              Calorie goal
            </span>
          )}
          {proteinGoal !== null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-dashed border-clay" aria-hidden="true" />
              Protein goal
            </span>
          )}
        </div>
      </div>

      {hasAnyData ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatAxisDate}
                tick={{ fontSize: 12, fill: CHART_TICK_COLOR }}
                minTickGap={24}
                axisLine={{ stroke: CHART_GRID_COLOR }}
                tickLine={false}
              />
              <YAxis
                yAxisId="calories"
                tick={{ fontSize: 12, fill: CHART_TICK_COLOR }}
                width={44}
                domain={[0, "auto"]}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="protein"
                orientation="right"
                tick={{ fontSize: 12, fill: CHART_TICK_COLOR }}
                width={40}
                domain={[0, "auto"]}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(label) => (typeof label === "string" ? formatTooltipDate(label) : label)}
                formatter={(value, name) =>
                  name === "calories" ? [`${value} kcal`, "Calories"] : [`${value} g`, "Protein"]
                }
              />
              {calorieGoal !== null && (
                <ReferenceLine
                  yAxisId="calories"
                  y={calorieGoal}
                  className="text-sage-deep"
                  stroke="currentColor"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              )}
              {proteinGoal !== null && (
                <ReferenceLine
                  yAxisId="protein"
                  y={proteinGoal}
                  className="text-clay"
                  stroke="currentColor"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              )}
              <Line
                yAxisId="calories"
                type="monotone"
                dataKey="calories"
                name="calories"
                className="text-sage-deep"
                stroke="currentColor"
                strokeWidth={2}
                dot={makeDot("text-sage-deep", "calories")}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="protein"
                type="monotone"
                dataKey="proteinG"
                name="proteinG"
                className="text-clay"
                stroke="currentColor"
                strokeWidth={2}
                dot={makeDot("text-clay", "proteinG")}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-stone-500">
          No food logged in this range yet.{" "}
          <a href="/food" className="font-medium text-sage-deep hover:text-sage-deep/80">
            Log some food
          </a>{" "}
          to see a trend.
        </p>
      )}
    </Card>
  );
}
