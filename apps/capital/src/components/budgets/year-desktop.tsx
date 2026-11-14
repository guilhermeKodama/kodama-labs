"use client";

import { useTranslations } from "next-intl";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "@/components/cap";
import { flatMonthlyBudget } from "@/lib/budgets/heatmap";
import type { BudgetKindName } from "@/lib/budgets/kind";
import { budgetedMonthsLabel } from "@/lib/budgets/labels";
import { percent, projectionVsBudget } from "@/lib/budgets/pace";
import { kindMonths, kindSummaries, stackedMonthlyBars, type SectionKind } from "@/lib/budgets/year-desktop";
import { useFmt } from "@/lib/format/provider";
import { CHART, CHART_AXIS, SERIES } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";
import { cn } from "@/lib/utils";
import { ChartCaption, ChartLegend, TOOLTIP_STYLE } from "./parts";
import type { YearOverview } from "./use-budgets";
import { MiniBars } from "./year-phone";

/**
 * Anual on a wide window, the alternatives behind `?dv=` (a, b, c). Fixo
 * and variável keep the phone's neutral hues, heartwood and resin; green
 * and red stay for gains and overruns.
 */
export const KIND_COLOR: Record<SectionKind, string> = { fixo: SERIES.cerne, variavel: SERIES.resina, none: SERIES.casca };

type Tense = (month: number) => "actual" | "current" | "projected";

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

/** The phone's split bar: fixo then variável, as a share of what both spent so far. */
function SplitBar({ fixo, variavel }: { fixo: number; variavel: number }) {
  return (
    <span aria-hidden className="flex h-2 overflow-hidden rounded-[3px] bg-fill-3">
      <span style={{ width: `${fixo * 100}%`, background: KIND_COLOR.fixo }} />
      <span style={{ width: `${variavel * 100}%`, background: KIND_COLOR.variavel }} />
    </span>
  );
}

function useSplitLabel(data: YearOverview) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { nElapsed, isPast } = data.period;
  const month = isPast ? null : Math.min(Math.max(nElapsed, 1), 12);
  return month ? t("year.phone.split", { month: fmt.monthAbbr(month) }) : t("year.phone.splitYear", { year: data.year });
}

/**
 * Fixo and variável side by side, each a button for the Tipo filter. They
 * follow the scope on screen; the filter only dims the other kind. "row"
 * is a panel across the page with the split bar and twelve mini-bars per
 * kind; "stack" is the two cards one above the other, without bars.
 */
export function KindCards({ data, kind, onKind, tense, layout }: { data: YearOverview; kind: BudgetKindName | null; onKind?: (kind: BudgetKindName | null) => void; tense: Tense; layout: "row" | "stack" }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const splitLabel = useSplitLabel(data);
  const summary = kindSummaries(data.categories, data.period.nElapsed);
  if (!(summary.total > 0)) return null;
  const current = data.period.isPast ? 0 : data.currentMonth;

  const card = (name: BudgetKindName) => {
    const slice = summary[name];
    const s = slice.summary;
    const span = budgetedMonthsLabel(s.budgetedMonths, fmt.monthAbbr);
    const projection = projectionVsBudget(s.projectedInBudgetedMonths, s.budgetYear);
    const active = kind === name;
    const stat = (label: string, value: string, sub?: string, tone?: string) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-caption text-fg-3">{label}</span>
        <span className={cn("font-mono text-body-lg font-medium tabular-nums", tone)}>{value}</span>
        {sub ? <span className={cn("truncate text-caption", tone ?? "text-fg-3")}>{sub}</span> : null}
      </span>
    );
    return (
      <button
        key={name}
        type="button"
        data-kind-card={name}
        aria-pressed={active}
        title={active ? t("year.desktop.clearFilter") : t("year.desktop.filter", { kind: t(`kind.${name}`) })}
        onClick={() => onKind?.(active ? null : name)}
        className={cn(
          "flex min-w-0 flex-col gap-2.5 rounded-[6px] border px-3.5 py-3 text-left outline-none transition-opacity hover:bg-fill-4 focus-visible:border-fg-3",
          active ? "border-indicator" : "border-transparent",
          kind && !active && "opacity-50",
        )}
      >
        <span className="flex items-center gap-1.5 text-label text-fg-2">
          <Swatch color={KIND_COLOR[name]} />
          <span className="font-medium text-fg-1">{t(`kind.${name}`)}</span>
          <span className="font-mono text-fg-3 tabular-nums">{t("year.desktop.share", { pct: percent(slice.share) })}</span>
        </span>
        <span className="flex items-end justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-kpi font-medium tabular-nums">{fmt.money0(s.spentToDate)}</span>
            {span && s.budgetToDate > 0 ? <span className="text-caption text-fg-3">{t("year.kpi.spentSubSpan", { pct: percent(s.spentInBudgetedMonths / s.budgetToDate), span })}</span> : null}
          </span>
          {layout === "row" ? (
            <span className="w-[46%] max-w-[260px] shrink-0">
              <MiniBars months={kindMonths(slice, (m) => tense(m) === "projected")} current={current} color={KIND_COLOR[name]} />
            </span>
          ) : null}
        </span>
        <span className="grid grid-cols-3 gap-3 border-t border-stroke-3 pt-2.5">
          {stat(span ? t("year.kpi.budgetSpan", { span }) : t("year.kpi.budgetYear", { year: data.year }), fmt.money0(span ? s.budgetToDate : s.budgetYear))}
          {stat(
            t("year.kpi.projection"),
            fmt.money0(s.projectedYear),
            projection ? (projection.kind === "over" ? t("year.desktop.over", { amount: fmt.money0(projection.amount) }) : t("year.kpi.slack", { amount: fmt.money0(projection.amount) })) : undefined,
            projection?.kind === "over" ? "text-warn" : undefined,
          )}
          {stat(t("year.kpi.overMonths"), String(s.overBudgetMonths), t("year.desktop.overMonthsSub", { count: s.budgetedCells }), s.overBudgetMonths > 0 ? "text-neg" : undefined)}
        </span>
      </button>
    );
  };

  if (layout === "stack") {
    return (
      <section data-kind-cards="stack" className="flex flex-col gap-2 rounded-[8px] border border-stroke-3 bg-panel p-1.5 max-md:hidden">
        <span className="flex flex-col gap-2 px-2 pt-1.5">
          <span className="text-caption text-fg-3">{splitLabel}</span>
          <SplitBar fixo={summary.fixo.share} variavel={summary.variavel.share} />
        </span>
        {card("fixo")}
        {card("variavel")}
      </section>
    );
  }
  return (
    <section data-kind-cards="row" className="flex flex-col gap-1.5 rounded-[8px] border border-stroke-3 bg-panel p-1.5 max-md:hidden">
      <span className="flex items-center gap-3 px-2 pt-1.5">
        <span className="shrink-0 text-caption text-fg-3">{splitLabel}</span>
        <span className="flex-1">
          <SplitBar fixo={summary.fixo.share} variavel={summary.variavel.share} />
        </span>
      </span>
      <span className="grid grid-cols-2 gap-1.5">
        {card("fixo")}
        {card("variavel")}
      </span>
    </section>
  );
}

/** The phone's split card inside the KPI strip: the bar and each kind's spend, each a button for the Tipo filter. */
export function KindSplitInline({ data, kind, onKind }: { data: YearOverview; kind: BudgetKindName | null; onKind?: (kind: BudgetKindName | null) => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const splitLabel = useSplitLabel(data);
  const summary = kindSummaries(data.categories, data.period.nElapsed);
  if (!(summary.total > 0)) return null;
  const side = (name: BudgetKindName) => {
    const slice = summary[name];
    const active = kind === name;
    return (
      <button
        type="button"
        data-kind-split-side={name}
        aria-pressed={active}
        title={active ? t("year.desktop.clearFilter") : t("year.desktop.filter", { kind: t(`kind.${name}`) })}
        onClick={() => onKind?.(active ? null : name)}
        className={cn("flex min-w-0 flex-col gap-0.5 rounded-[4px] text-left outline-none hover:underline focus-visible:underline", kind && !active && "opacity-50")}
      >
        <span className="flex items-center gap-1.5 text-caption text-fg-3">
          <Swatch color={KIND_COLOR[name]} />
          <span className={cn(active && "font-medium text-fg-1")}>{t(`kind.${name}`)}</span>
          <span className="font-mono tabular-nums">{percent(slice.share)}%</span>
        </span>
        <span className="font-mono text-body-lg font-medium tabular-nums">{fmt.money0(slice.summary.spentToDate)}</span>
        {slice.summary.budgetToDate > 0 ? <span className="text-caption text-fg-3">{t("year.phone.of", { amount: fmt.money0(slice.summary.budgetToDate) })}</span> : null}
      </button>
    );
  };
  return (
    <div data-kind-split-inline="" className="ml-auto flex min-w-[300px] max-w-[440px] flex-1 flex-col gap-1.5 border-l border-stroke-3 pl-7 max-md:hidden">
      <span className="text-caption text-fg-3">{splitLabel}</span>
      <SplitBar fixo={summary.fixo.share} variavel={summary.variavel.share} />
      <span className="grid grid-cols-2 gap-4">
        {side("fixo")}
        {side("variavel")}
      </span>
    </div>
  );
}

/** "Gasto mensal vs orçado" stacked by kind; a projected month or part of a month is the same hue, lighter. */
export function StackedMonthlyChart({
  sections,
  monthBudgets,
  year,
  isProjected,
}: {
  sections: readonly { kind: SectionKind; monthTotals: readonly number[]; monthProjected: readonly number[] }[];
  monthBudgets: readonly number[];
  year: number;
  isProjected: (month: number) => boolean;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const unit = fmt.kUnit();
  const flat = flatMonthlyBudget(monthBudgets);
  const kinds = sections.map((s) => s.kind);
  const rows = stackedMonthlyBars(sections, isProjected, (v) => v).map((bar, i) => ({
    name: fmt.monthAbbr(bar.month),
    ...Object.fromEntries(kinds.flatMap((k) => [[`real_${k}`, bar.real[k] || null], [`proj_${k}`, bar.proj[k] || null]])),
    budget: monthBudgets[i] || null,
  }));
  const label = (k: SectionKind) => (k === "none" ? t("year.desktop.section.none") : t(`kind.${k}`));
  const budgetName = t("year.chart.budget");
  return (
    <Panel title={t("year.chart.title")} className="h-full">
      <div data-stacked-chart="" className="h-[236px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="name" tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} interval={0} />
            <YAxis tickFormatter={(v: number) => `${fmt.number(v / 1000, { min: 0, max: 1 })}k`} tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} width={38} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value) => fmt.money0(Number(value))} cursor={{ fill: "var(--cap-fill-3)" }} />
            {/* Each kind's projected part sits on its own realized part, so a kind stays one block in the running month. */}
            {kinds.flatMap((k) => [
              <Bar key={`real_${k}`} dataKey={`real_${k}`} name={label(k)} stackId="spend" fill={KIND_COLOR[k]} isAnimationActive={false} />,
              <Bar key={`proj_${k}`} dataKey={`proj_${k}`} name={t("year.desktop.projectedOf", { kind: label(k) })} stackId="spend" fill={KIND_COLOR[k]} fillOpacity={0.32} isAnimationActive={false} />,
            ])}
            {flat !== null ? (
              <ReferenceLine y={flat} stroke={CHART.muted} strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: budgetName, position: "insideTopRight", fontSize: textRole("micro"), fill: CHART.muted }} />
            ) : (
              <Line dataKey="budget" name={budgetName} type="stepAfter" stroke={CHART.muted} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={[
          ...kinds.map((k) => ({ label: label(k), color: KIND_COLOR[k] })),
          ...(monthBudgets.some((v) => v > 0) ? [{ label: budgetName, color: CHART.muted, dashed: true }] : []),
        ]}
      />
      <ChartCaption>{t("year.desktop.chartCaption", { unit, year })}</ChartCaption>
    </Panel>
  );
}
