"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslations } from "next-intl";
import { useFmt } from "@/lib/format/provider";
import type { AllocationClass } from "@/lib/invest/types";
import { CHART, CHART_AXIS, CHART_SERIES } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";

const TOOLTIP_STYLE = {
  fontSize: textRole("body-sm"),
  borderRadius: 8,
  border: `1px solid var(--cap-stroke-1)`,
  background: "var(--cap-bg-editor)",
  color: "var(--cap-text-1)",
} as const;

/** Series colors of the six classes (stable, so a class keeps its color in every chart). */
export const CLASS_COLOR: Record<AllocationClass, string> = {
  fixed_income: CHART_SERIES[0],
  br_stocks: CHART_SERIES[1],
  fii: CHART_SERIES[3],
  international: CHART_SERIES[4],
  crypto: CHART_SERIES[5],
  cash: CHART_SERIES[9],
};

/**
 * "Patrimônio vs total aportado": filled lines over 12 months, in thousands, not from zero. "Aportado" is
 * stacked from the aportes and, when there are any, the "posições iniciais" (holdings registered without
 * operations), so a portfolio typed in at once never reads as an aporte of that month.
 */
export function NetWorthChart({
  rows,
  showInitial,
}: {
  rows: { label: string; netWorth: number; aportes: number; initial: number }[];
  showInitial: boolean;
}) {
  const t = useTranslations("invest.portfolio.history");
  const fmt = useFmt();
  const data = rows.map((r) => ({
    label: r.label,
    netWorth: fmt.thousands(r.netWorth),
    aportes: fmt.thousands(r.aportes),
    initial: fmt.thousands(r.initial),
  }));
  const name = (key: unknown) =>
    key === "netWorth"
      ? t("netWorth")
      : key === "initial"
        ? t("initialPositions")
        : t("contributed");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 6, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={CHART_AXIS.tick}
              stroke={CHART_AXIS.stroke}
              tickLine={false}
            />
            <YAxis
              tick={CHART_AXIS.tick}
              stroke={CHART_AXIS.stroke}
              tickLine={false}
              axisLine={false}
              width={48}
              domain={["auto", "auto"]}
              tickFormatter={(v) => fmt.number(Number(v), 0)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v, key) => [
                `${fmt.number(Number(v), { min: 0, max: 1 })}`,
                name(key),
              ]}
            />
            {showInitial ? (
              <Area
                type="monotone"
                dataKey="initial"
                name="initial"
                stackId="contributed"
                stroke={CHART.muted}
                strokeDasharray="3 3"
                fill={CHART.soft}
                fillOpacity={0.5}
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="aportes"
              name="aportes"
              stackId="contributed"
              stroke={CHART.muted}
              fill={CHART.area}
              fillOpacity={0.6}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="netWorth"
              name="netWorth"
              stroke={CHART.ink}
              fill={CHART.soft}
              fillOpacity={0.35}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {showInitial ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-[2px]"
              style={{ background: CHART.ink }}
            />
            {t("netWorth")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-[2px]"
              style={{ background: CHART.area }}
            />
            {t("contributed")}
          </span>
          <span
            className="inline-flex items-center gap-1.5"
            title={t("initialPositionsHint")}
          >
            <span
              aria-hidden
              className="size-2 rounded-[2px] border border-dashed"
              style={{ background: CHART.soft, borderColor: CHART.muted }}
            />
            {t("initialPositions")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** "Aportes por mês e classe": stacked bars in thousands with the goal line. */
export function ContributionsChart({
  rows,
  classes,
  goal,
  height = 200,
}: {
  rows: { label: string; values: Partial<Record<AllocationClass, number>> }[];
  classes: AllocationClass[];
  goal: number | null;
  height?: number;
}) {
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const data = rows.map((r) => ({
    label: r.label,
    ...Object.fromEntries(
      classes.map((c) => [c, fmt.thousands(r.values[c] ?? 0)]),
    ),
  }));
  return (
    <div className="flex flex-col gap-1.5">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={CHART_AXIS.tick}
              stroke={CHART_AXIS.stroke}
              tickLine={false}
            />
            <YAxis
              tick={CHART_AXIS.tick}
              stroke={CHART_AXIS.stroke}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v) => `${fmt.number(Number(v), 0)}k`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v, name) => [
                `${fmt.number(Number(v), { min: 0, max: 1 })}k`,
                ti(`allocationClass.${name as AllocationClass}`),
              ]}
            />
            {classes.map((c) => (
              <Bar
                key={c}
                dataKey={c}
                stackId="a"
                fill={CLASS_COLOR[c]}
                isAnimationActive={false}
              />
            ))}
            {goal !== null && goal > 0 ? (
              <ReferenceLine
                y={fmt.thousands(goal)}
                stroke={CHART.warn}
                strokeDasharray="4 3"
                label={{
                  value: ti("contrib.chart.goal"),
                  position: "right",
                  fontSize: textRole("caption"),
                  fill: "var(--cap-chart-warn)",
                }}
              />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ClassLegend classes={classes} />
    </div>
  );
}

/** Swatch + name of each stacked class, under the plot. */
function ClassLegend({ classes }: { classes: AllocationClass[] }) {
  const ti = useTranslations("invest");
  if (classes.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-fg-3">
      {classes.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-[2px]"
            style={{ background: CLASS_COLOR[c] }}
          />
          {ti(`allocationClass.${c}`)}
        </span>
      ))}
    </div>
  );
}

/** Proventos 12m: monthly bars (one series, or stacked by class). */
export function IncomeChart({
  rows,
  series,
}: {
  rows: { label: string; values: Record<string, number> }[];
  series: string[];
}) {
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const data = rows.map((r) => ({
    label: r.label,
    ...Object.fromEntries(
      series.map((s) => [s, Math.round((r.values[s] ?? 0) * 100) / 100]),
    ),
  }));
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 4, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={CHART_AXIS.tick}
            stroke={CHART_AXIS.stroke}
            tickLine={false}
          />
          <YAxis
            tick={CHART_AXIS.tick}
            stroke={CHART_AXIS.stroke}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v) => fmt.number(Number(v), 0)}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [
              fmt.money(Number(v)),
              name === "total"
                ? ti("portfolio.ops.total")
                : ti(`allocationClass.${name as AllocationClass}`),
            ]}
          />
          {series.map((s) => (
            <Bar
              key={s}
              dataKey={s}
              stackId="a"
              fill={
                s === "total" ? CHART.bar : CLASS_COLOR[s as AllocationClass]
              }
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
