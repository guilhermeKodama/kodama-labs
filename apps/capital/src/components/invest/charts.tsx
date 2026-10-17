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
import { netWorthTooltipRows, type NetWorthTooltipKey } from "@/lib/invest/portfolio-history-view";
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

/** Patrimônio / Aportado / Posições iniciais. Strokes are the tooltip and legend marks too. */
const NET_WORTH_SERIES = {
  netWorth: { stroke: CHART.ink, fill: CHART.soft, fillOpacity: 0.2, dashed: false },
  aportes: { stroke: CHART.accent, fill: CHART.accent, fillOpacity: 0.35, dashed: false },
  initial: { stroke: CHART_SERIES[6], fill: CHART_SERIES[6], fillOpacity: 0.2, dashed: true },
} as const;

type NetWorthSeriesKey = keyof typeof NET_WORTH_SERIES;

function seriesDot(stroke: string) {
  return { r: 3.5, fill: stroke, stroke, strokeWidth: 0 };
}

/** Swatch shared by the legend and the tooltip. Posições iniciais stay dashed. */
function SeriesMark({ series }: { series: NetWorthSeriesKey }) {
  const { stroke, dashed } = NET_WORTH_SERIES[series];
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-[2px]"
      style={
        dashed
          ? { background: "transparent", border: `1px dashed ${stroke}` }
          : { background: stroke }
      }
    />
  );
}

/**
 * "Patrimônio vs total aportado": filled lines over 12 months, in thousands, not from zero. "Aportado" is
 * stacked from the aportes and, when there are any, the "posições iniciais" (holdings registered without
 * operations), so a portfolio typed in at once never reads as an aporte of that month. The three strokes
 * use distinct chart tokens. The tooltip adds "Capital investido" (initial + aportes), which is the
 * height of the aportes stroke — below the dashed line when net aportes are negative.
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
              animationDuration={0}
              content={(props) => (
                <NetWorthTooltip
                  active={props.active}
                  label={props.label}
                  point={props.payload?.[0]?.payload}
                  showInitial={showInitial}
                />
              )}
            />
            {showInitial ? (
              <Area
                type="monotone"
                dataKey="initial"
                name="initial"
                stackId="contributed"
                stroke={NET_WORTH_SERIES.initial.stroke}
                strokeDasharray="3 3"
                fill={NET_WORTH_SERIES.initial.fill}
                fillOpacity={NET_WORTH_SERIES.initial.fillOpacity}
                strokeWidth={1.5}
                dot={false}
                activeDot={seriesDot(NET_WORTH_SERIES.initial.stroke)}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="aportes"
              name="aportes"
              stackId="contributed"
              stroke={NET_WORTH_SERIES.aportes.stroke}
              fill={NET_WORTH_SERIES.aportes.fill}
              fillOpacity={NET_WORTH_SERIES.aportes.fillOpacity}
              strokeWidth={1.5}
              dot={false}
              activeDot={seriesDot(NET_WORTH_SERIES.aportes.stroke)}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="netWorth"
              name="netWorth"
              stroke={NET_WORTH_SERIES.netWorth.stroke}
              fill={NET_WORTH_SERIES.netWorth.fill}
              fillOpacity={NET_WORTH_SERIES.netWorth.fillOpacity}
              strokeWidth={2}
              dot={false}
              activeDot={seriesDot(NET_WORTH_SERIES.netWorth.stroke)}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <SeriesMark series="netWorth" />
          {t("netWorth")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <SeriesMark series="aportes" />
          {t("contributed")}
        </span>
        {showInitial ? (
          <span className="inline-flex items-center gap-1.5" title={t("initialPositionsHint")}>
            <SeriesMark series="initial" />
            {t("initialPositions")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function tooltipLabel(key: NetWorthTooltipKey, t: (key: "netWorth" | "contributed" | "initialPositions" | "capitalInvested") => string): string {
  if (key === "netWorth") return t("netWorth");
  if (key === "initial") return t("initialPositions");
  if (key === "capitalInvested") return t("capitalInvested");
  return t("contributed");
}

/** Stack order, then the muted capital-investido total with no series mark. */
function NetWorthTooltip({
  active,
  label,
  point,
  showInitial,
}: {
  active?: boolean;
  label?: unknown;
  point?: { netWorth?: unknown; aportes?: unknown; initial?: unknown };
  showInitial: boolean;
}) {
  const t = useTranslations("invest.portfolio.history");
  const fmt = useFmt();
  if (!active || !point) return null;
  if (typeof point.netWorth !== "number" || typeof point.aportes !== "number" || typeof point.initial !== "number") return null;
  const rows = netWorthTooltipRows({ netWorth: point.netWorth, aportes: point.aportes, initial: point.initial }, showInitial);
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: "8px 10px" }}>
      <div style={{ marginBottom: 4 }}>{String(label ?? "")}</div>
      {rows.map((row) => {
        const series = row.key === "capitalInvested" ? null : row.key;
        return (
          <div
            key={row.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              paddingTop: row.derived ? 4 : 1,
              marginTop: row.derived ? 4 : 0,
              borderTop: row.derived ? "1px solid var(--cap-stroke-2)" : undefined,
              color: row.derived ? "var(--cap-text-3)" : "var(--cap-text-1)",
            }}
          >
            {series ? <SeriesMark series={series} /> : <span aria-hidden className="inline-block size-2 shrink-0" />}
            <span>
              {tooltipLabel(row.key, t)}
              {" : "}
              {fmt.number(row.value, { min: 0, max: 1 })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Net new money each month, in thousands. A resgate month is a bar below zero. */
export function ContributionsChart({
  rows,
  goal,
  height = 200,
}: {
  rows: { label: string; net: number }[];
  goal: number | null;
  height?: number;
}) {
  const t = useTranslations("invest.contrib.chart");
  const fmt = useFmt();
  const data = rows.map((r) => ({ label: r.label, net: fmt.thousands(r.net) }));
  return (
    <div className="flex flex-col gap-1.5">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} />
            <YAxis tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${fmt.number(Number(v), 0)}k`} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${fmt.number(Number(v), { min: 0, max: 1 })}k`, t("net")]} />
            <ReferenceLine y={0} stroke={CHART.axis} />
            <Bar dataKey="net" fill={CHART.bar} isAnimationActive={false} />
            {goal !== null && goal > 0 ? (
              <ReferenceLine
                y={fmt.thousands(goal)}
                stroke={CHART.warn}
                strokeDasharray="4 3"
                label={{ value: t("goal"), position: "right", fontSize: textRole("caption"), fill: "var(--cap-chart-warn)" }}
              />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** "Compras": purchases of the month by class, in thousands. */
export function PurchasesChart({
  rows,
  classes,
  height = 160,
}: {
  rows: { label: string; values: Partial<Record<AllocationClass, number>> }[];
  classes: AllocationClass[];
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
