"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DotItemDotProps } from "recharts";
import { weightForDisplay } from "@/lib/domain/units";
import type { WeightSeriesPoint } from "@/lib/domain/trends";
import type { WeightUnit } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { CHART_GRID_COLOR, CHART_TICK_COLOR, formatAxisDate, formatTooltipDate } from "./chartTheme";

/**
 * Weight (+ optional body-fat %) trend chart (design doc §3.1 `trends/WeightChart.tsx`, §8 Phase
 * 5). Renders `WeightChart`'s input series — already a dense, gap-filled `WeightSeriesPoint[]`
 * from `lib/domain/trends.buildWeightSeries` — as a single continuous line (`connectNulls`) with a
 * dot marker only on days that series actually has a logged value, per the "chart gaps: connect
 * across missing days, mark real entries with a dot" decision (ai-context/DECISIONS.md). Stored
 * `weightKg` is converted to the user's display unit here (via `lib/domain/units.ts` — never
 * reimplemented) since the series itself stays unit-agnostic.
 *
 * The body-fat % series/axis is optional: it's only rendered at all when at least one point in the
 * current range actually has a `bodyFatPct` value, matching §3.1's "optional second axis/series".
 *
 * Dot suppression is keyed off **each series' own value being non-null**, not the point's
 * `isReal` flag — `isReal` means "a `daily_metrics` row exists for this day", which is true for a
 * weight-only day with no body fat % recorded (`bodyFatPct: null`, per
 * `lib/domain/trends.buildWeightSeries`'s doc comment). Using `isReal` alone would (incorrectly)
 * draw a body-fat dot with no real value on those days; checking the plotted value directly is
 * correct for both series and doesn't depend on `cx`/`cy` happening to come back `null` from
 * Recharts for a `null` data point.
 */

type ChartPoint = {
  date: string;
  weight: number | null;
  bodyFatPct: number | null;
  isReal: boolean;
};

type SeriesDotProps = DotItemDotProps & { payload: ChartPoint };

function makeDot(colorClassName: string, valueKey: "weight" | "bodyFatPct") {
  function ChartDot(props: DotItemDotProps) {
    const { cx, cy, payload } = props as SeriesDotProps;
    if (payload[valueKey] == null || cx == null || cy == null) return null;
    return <circle cx={cx} cy={cy} r={3} className={colorClassName} fill="currentColor" stroke="currentColor" />;
  }
  return ChartDot;
}

export type WeightChartProps = {
  series: WeightSeriesPoint[];
  weightUnit: WeightUnit;
};

export function WeightChart({ series, weightUnit }: WeightChartProps) {
  const data: ChartPoint[] = series.map((point) => ({
    date: point.date,
    weight: point.weightKg === null ? null : weightForDisplay(point.weightKg, weightUnit),
    bodyFatPct: point.bodyFatPct,
    isReal: point.isReal,
  }));
  const hasBodyFat = data.some((point) => point.bodyFatPct !== null);
  const hasAnyWeight = data.some((point) => point.weight !== null);

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-lg font-semibold text-ink">
          Weight{hasBodyFat ? " & body fat" : ""}
        </h2>
        <div className="flex flex-wrap gap-4 text-xs text-stone-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sage-deep" aria-hidden="true" />
            Weight ({weightUnit})
          </span>
          {hasBodyFat && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-clay" aria-hidden="true" />
              Body fat %
            </span>
          )}
        </div>
      </div>

      {hasAnyWeight ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: hasBodyFat ? 8 : 20, left: 0, bottom: 0 }}>
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
                yAxisId="weight"
                tick={{ fontSize: 12, fill: CHART_TICK_COLOR }}
                width={44}
                domain={["auto", "auto"]}
                axisLine={false}
                tickLine={false}
              />
              {hasBodyFat && (
                <YAxis
                  yAxisId="bodyFat"
                  orientation="right"
                  tick={{ fontSize: 12, fill: CHART_TICK_COLOR }}
                  width={40}
                  domain={["auto", "auto"]}
                  axisLine={false}
                  tickLine={false}
                />
              )}
              <Tooltip
                labelFormatter={(label) => (typeof label === "string" ? formatTooltipDate(label) : label)}
                formatter={(value, name) =>
                  name === "weight" ? [`${value} ${weightUnit}`, "Weight"] : [`${value}%`, "Body fat"]
                }
              />
              <Line
                yAxisId="weight"
                type="monotone"
                dataKey="weight"
                name="weight"
                className="text-sage-deep"
                stroke="currentColor"
                strokeWidth={2}
                dot={makeDot("text-sage-deep", "weight")}
                connectNulls
                isAnimationActive={false}
              />
              {hasBodyFat && (
                <Line
                  yAxisId="bodyFat"
                  type="monotone"
                  dataKey="bodyFatPct"
                  name="bodyFatPct"
                  className="text-clay"
                  stroke="currentColor"
                  strokeWidth={2}
                  dot={makeDot("text-clay", "bodyFatPct")}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-stone-500">
          No weight logged in this range yet.{" "}
          <a href="/metrics" className="font-medium text-sage-deep hover:text-sage-deep/80">
            Log your weight
          </a>{" "}
          to see a trend.
        </p>
      )}
    </Card>
  );
}
