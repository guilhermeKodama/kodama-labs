"use client";

import { useTranslations } from "next-intl";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyRow, Kpi, KpiStrip, Panel } from "@/components/cap";
import { apiPatch } from "@/lib/api/client";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import { budgetDrill, budgetsDrill, monthPeriod } from "@/lib/budgets/drill";
import { columnTense, flatMonthlyBudget, heatLevel, heatPercent, isClickable, monthlyBars, totalTone, trendOf, type HeatLevel } from "@/lib/budgets/heatmap";
import { heatmapLegend, insightCopy, yearHeader, yearToDateMonth } from "@/lib/budgets/labels";
import { percent, projectionVsBudget, usage, yearlyTone } from "@/lib/budgets/pace";
import { monthKey, type YearMonth } from "@/lib/budgets/period";
import type { BudgetsScope, BudgetsView } from "@/lib/budgets/url";
import { useFmt } from "@/lib/format/provider";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { CHART, CHART_AXIS } from "@/lib/theme/chart-colors";
import { cn } from "@/lib/utils";
import type { EditableBudget } from "./budget-dialog";
import { BudgetEntityBadge, ChartCaption, ChartLegend, DrillLink, PaceBar, RowMenu, ScopeBar, TOOLTIP_STYLE, useEntityNames, ViewState, type BudgetActions } from "./parts";
import { useYearOverview, type YearOverview } from "./use-budgets";

/** Mockup AnnualBudget heatmap: Categoria | jan…dez | Ano (proj.) | Tendência. */
const HEAT_COLS = "grid grid-cols-[minmax(0,1.1fr)_repeat(12,minmax(0,1fr))_92px_76px] items-center gap-1 px-3";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const HEAT_CLASS: Record<HeatLevel, string> = {
  over: "bg-fill-1 font-semibold text-cat-red",
  high: "bg-fill-2 text-fg-2",
  mid: "bg-fill-3 text-fg-2",
  low: "bg-fill-4 text-fg-2",
  projected: "border-dashed border-stroke-2 text-fg-4",
  empty: "text-fg-3",
};

/** Anual: KPIs, the category × month heatmap, monthly spend vs budget, the year's trends and yearly budgets. */
export function YearView({
  view,
  today,
  onScope,
  onOpenMonth,
  actions,
}: {
  view: BudgetsView;
  today: YearMonth;
  onScope: (scope: BudgetsScope) => void;
  onOpenMonth: (month: number) => void;
  actions: BudgetActions;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const errorText = useErrorMessage();
  const overview = useYearOverview(view.year, view.scope);
  const data = overview.data;
  const header = data ? yearHeader(data.period, fmt.monthAbbr) : null;
  return (
    <>
      <ScopeBar scope={view.scope} onScope={onScope}>
        {header ? t(header.key, header.values) : null}
      </ScopeBar>
      {data ? (
        <div className={cn("flex flex-col gap-3 transition-opacity", overview.isPlaceholderData && "opacity-60")}>
          <YearBody data={data} today={today} onOpenMonth={onOpenMonth} actions={actions} />
        </div>
      ) : (
        <ViewState error={overview.isError ? errorText(overview.error) : null} onRetry={() => void overview.refetch()} />
      )}
    </>
  );
}

function YearBody({ data, today, onOpenMonth, actions }: { data: YearOverview; today: YearMonth; onOpenMonth: (month: number) => void; actions: BudgetActions }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { kinds } = useEntityNames();
  const { period, summary } = data;
  const ytd = yearToDateMonth(period);
  const ytdAbbr = ytd ? fmt.monthAbbr(ytd) : null;
  const projection = projectionVsBudget(summary.projectedYear, summary.budgetYear);
  const legend = heatmapLegend(data.currentMonth, period.isPast, fmt.monthAbbr);
  const tense = (month: number) => columnTense(month, data.currentMonth, period.isPast);
  // The year so far: through today in the current year, the whole year once it is over.
  const ytdRange = ytd ? { from: `${data.year}-01-01`, to: period.isPast ? `${data.year}-12-31` : period.today } : null;
  const drill = (row: { entityId: string | null; categoryId: string | null; excludeEntityIds?: readonly string[] }, category: string): ViewDraft | null =>
    ytdRange ? { label: t("drillLabel", { category, period: String(data.year) }), ...budgetDrill(row, data.scope.entityIds, ytdRange) } : null;
  // KPIs and the Total row: every row of the heatmap at once, over the actual months only (projected months have no entries yet).
  const totals = (label: string, range: { from: string; to: string } | null, periodLabel = String(data.year)): ViewDraft | null => {
    const found = range ? budgetsDrill(data.categories, data.scope.entityIds, range) : null;
    return found ? { label: t("drillLabel", { category: label, period: periodLabel }), ...found } : null;
  };
  // A month of the Total row: complete months whole, the current one through today.
  const monthRange = (month: number) => {
    const tensed = tense(month);
    if (tensed === "projected") return null;
    return tensed === "current" ? monthPeriod(data.year, month, Number(period.today.slice(8, 10))) : monthPeriod(data.year, month);
  };
  const totalLabel = t("year.heatmap.total");

  return (
    <>
      <KpiStrip>
        <Kpi
          label={ytdAbbr ? t("year.kpi.spent", { year: data.year, month: ytdAbbr }) : t("year.kpi.spentNoMonth", { year: data.year })}
          value={<DrillLink draft={totals(totalLabel, ytdRange)}>{fmt.money0(summary.spentToDate)}</DrillLink>}
          sub={ytdAbbr && summary.budgetToDate > 0 ? t("year.kpi.spentSub", { pct: percent(summary.spentToDate / summary.budgetToDate), month: ytdAbbr }) : undefined}
        />
        <Kpi
          label={ytdAbbr ? t("year.kpi.budget", { month: ytdAbbr }) : t("year.kpi.budgetYear", { year: data.year })}
          value={<DrillLink draft={totals(totalLabel, ytdRange)}>{fmt.money0(ytdAbbr ? summary.budgetToDate : summary.budgetYear)}</DrillLink>}
        />
        <Kpi
          label={t("year.kpi.projection")}
          value={<DrillLink draft={totals(totalLabel, ytdRange)}>{fmt.money0(summary.projectedYear)}</DrillLink>}
          sub={
            projection
              ? projection.kind === "over"
                ? t("year.kpi.over", { amount: fmt.money0(projection.amount), budget: fmt.money0(summary.budgetYear) })
                : t("year.kpi.slack", { amount: fmt.money0(projection.amount) })
              : undefined
          }
          tone={projection?.kind === "over" ? "warn" : undefined}
        />
        <Kpi label={t("year.kpi.overMonths")} value={<DrillLink draft={totals(totalLabel, ytdRange)}>{String(summary.overBudgetMonths)}</DrillLink>} sub={t("year.kpi.overMonthsSub", { count: summary.budgetedCells })} />
      </KpiStrip>

      <div className="overflow-x-auto rounded-[8px] border border-stroke-3">
        <div className="min-w-[860px]">
          <div className={cn(HEAT_COLS, "h-[34px] text-[11.5px] text-fg-3")}>
            <span>{t("year.heatmap.category")}</span>
            {MONTHS.map((m) => (
              <span key={m} className={cn("text-center", tense(m) === "projected" && "text-fg-4", tense(m) === "current" && "text-fg-1")}>
                {fmt.monthAbbr(m)}
                {tense(m) === "current" ? "*" : ""}
              </span>
            ))}
            <span className="text-right">{t("year.heatmap.yearTotal")}</span>
            <span className="text-right">{t("year.heatmap.trend")}</span>
          </div>
          {data.categories.map((row) => {
            const category = row.category ?? t("uncategorized");
            const trend = trendOf(row.trend);
            return (
              <div key={`${row.entityId}:${row.categoryId}`} className={cn(HEAT_COLS, "h-[34px] border-t border-stroke-3 text-[12.5px]")}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <DrillLink draft={drill(row, category)} title={category} className="min-w-0 truncate">
                    {category}
                  </DrillLink>
                  <BudgetEntityBadge entityId={row.entityId} kinds={kinds} />
                </span>
                {row.months.map((cell) => {
                  const level = heatLevel(cell);
                  const pct = heatPercent(cell);
                  const text = pct !== null ? `${pct}%` : cell.spent > 0 ? fmt.k(cell.spent, { minDigits: 1 }) : "·";
                  const className = cn("inline-flex h-[26px] min-w-0 items-center justify-center rounded border border-transparent font-mono text-[11px] tabular-nums", HEAT_CLASS[level]);
                  if (!isClickable(cell)) return <span key={cell.month} className={className}>{text}</span>;
                  return (
                    <button
                      key={cell.month}
                      type="button"
                      title={t("year.heatmap.open", { month: fmt.monthLabel({ year: data.year, month: cell.month }) })}
                      onClick={() => onOpenMonth(cell.month)}
                      className={cn(className, "outline-none hover:border-stroke-1 focus-visible:border-fg-3")}
                    >
                      {text}
                    </button>
                  );
                })}
                <DrillLink draft={drill(row, category)} className="text-right font-mono text-[12px] tabular-nums">
                  {fmt.money0(row.yearTotal)}
                </DrillLink>
                <span
                  className={cn(
                    "text-right font-mono text-[11.5px]",
                    trend.kind === "up" ? "text-cat-yellow" : trend.kind === "down" ? "text-cat-green" : trend.kind === "stable" ? "text-fg-3" : "text-fg-4",
                  )}
                >
                  {trend.kind === "none" ? "—" : t(`year.heatmap.trend_${trend.kind}`, { pct: trend.pct })}
                </span>
              </div>
            );
          })}
          {data.categories.length ? (
            <div className={cn(HEAT_COLS, "h-9 border-t border-stroke-2 bg-fill-4 text-[12px] font-semibold")}>
              <span>{t("year.heatmap.total")}</span>
              {data.monthTotals.map((total, i) => {
                const tone = totalTone(total, data.monthBudgets[i] ?? 0, tense(i + 1) === "projected");
                return (
                  <DrillLink
                    key={i}
                    draft={totals(totalLabel, monthRange(i + 1), fmt.monthLabel({ year: data.year, month: i + 1 }))}
                    className={cn("text-center font-mono text-[10.5px] tabular-nums", tone === "projected" ? "text-fg-4" : tone === "over" ? "text-cat-red" : "text-fg-1")}
                  >
                    {fmt.k(total, { minDigits: 1 })}
                  </DrillLink>
                );
              })}
              <DrillLink draft={totals(totalLabel, ytdRange)} className="text-right font-mono tabular-nums">
                {fmt.money0(summary.projectedYear)}
              </DrillLink>
              <span />
            </div>
          ) : (
            <EmptyRow>{t("year.heatmap.empty", { year: data.year })}</EmptyRow>
          )}
        </div>
      </div>
      <p className="text-[12px] text-fg-4">{t(legend.key, legend.values)}</p>

      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <MonthlyChart data={data} isProjected={(m) => tense(m) === "projected"} />
        <Insights data={data} today={today} />
      </div>

      {data.yearlyBudgets.length ? (
        <Panel title={t("year.yearly.title")} pad={false}>
          {data.yearlyBudgets.map((b) => {
            const ratio = usage(b.spent, b.amount);
            const editable: EditableBudget = { id: b.id, category: b.category, entityId: b.entityId, amount: b.amount, notes: b.notes, effectiveFrom: b.effectiveFrom, period: "yearly" };
            return (
              <div key={b.id} className="group grid h-10 grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_96px_96px] items-center gap-3 border-t border-stroke-3 px-3 text-[12.5px] first:border-t-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0">{b.category}</span>
                  <BudgetEntityBadge entityId={b.entityId} kinds={kinds} />
                  {b.notes ? <span className="min-w-0 truncate text-[11px] text-fg-4">{b.notes}</span> : null}
                  <RowMenu category={b.category} onEdit={() => actions.onEdit(editable)} onDelete={() => actions.onDelete(editable)} />
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <PaceBar ratio={ratio} tone={yearlyTone(ratio)} marker={b.yearPace} label={b.category} />
                  <span className="w-[34px] shrink-0 text-right font-mono text-[11px] text-fg-3 tabular-nums">{percent(ratio)}%</span>
                </span>
                <DrillLink draft={drill(b, b.category)} className="text-right font-mono tabular-nums">
                  {fmt.money0(b.spent)}
                </DrillLink>
                <span className="text-right font-mono text-fg-2 tabular-nums">{t("year.yearly.of", { amount: fmt.money0(b.amount) })}</span>
              </div>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}

function MonthlyChart({ data, isProjected }: { data: YearOverview; isProjected: (month: number) => boolean }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const unit = fmt.kUnit();
  const flat = flatMonthlyBudget(data.monthBudgets);
  // Zeros as null: the tooltip leaves out the series a month does not have (realized or projected).
  const rows = monthlyBars(data.monthTotals, isProjected, (v) => v).map((bar, i) => ({
    name: fmt.monthAbbr(bar.month),
    real: bar.real || null,
    proj: bar.proj || null,
    budget: data.monthBudgets[i] || null,
  }));
  const names = { real: t("year.chart.real", { unit }), proj: t("year.chart.projected", { unit }), budget: t("year.chart.budget") };
  return (
    <Panel title={t("year.chart.title")}>
      <div className="h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="name" tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} interval={0} />
            <YAxis tickFormatter={(v: number) => `${fmt.number(v / 1000, { min: 0, max: 1 })}k`} tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} width={38} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value) => fmt.money0(Number(value))}
              cursor={{ fill: "var(--cap-fill-3)" }}
            />
            <Bar dataKey="real" name={names.real} stackId="spend" fill={CHART.bar} isAnimationActive={false} />
            <Bar dataKey="proj" name={names.proj} stackId="spend" fill={CHART.soft} isAnimationActive={false} />
            {flat !== null ? (
              <ReferenceLine y={flat} stroke={CHART.muted} strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: names.budget, position: "insideTopRight", fontSize: 10, fill: CHART.muted }} />
            ) : (
              <Line dataKey="budget" name={names.budget} type="stepAfter" stroke={CHART.muted} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={[
          { label: names.real, color: CHART.bar },
          { label: names.proj, color: CHART.soft },
          ...(data.monthBudgets.some((v) => v > 0) ? [{ label: names.budget, color: CHART.muted, dashed: true }] : []),
        ]}
      />
      <ChartCaption>{t("year.chart.caption", { unit, year: data.year })}</ChartCaption>
    </Panel>
  );
}

/** Tendências do ano; an overrun offers "Ajustar para R$ X?", a new version of the budget from this month on. */
function Insights({ data, today }: { data: YearOverview; today: YearMonth }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { kinds } = useEntityNames();
  const from = monthKey(today);
  const adjust = useAppMutation({
    event: "budgets.write",
    mutationFn: ({ budgetId, amount }: { budgetId: string; amount: number; category: string }) =>
      apiPatch<{ batchId: string | null }>(`/api/v2/budgets/${budgetId}`, { amount, applyFrom: from }),
    undo: (_result, { amount, category }) => t("year.insights.adjusted", { category, amount: fmt.money0(amount), month: fmt.monthLabel(today) }),
  });
  return (
    <Panel title={t("year.insights.title")} pad={false}>
      {data.insights.map((insight) => {
        const category = insight.category ?? t("uncategorized");
        const copy = insightCopy(insight, category, fmt.monthAbbr, (v) => fmt.money0(v), data.period.projectionBasis);
        return (
          <div key={`${insight.budgetId}:${insight.kind}`} className="flex flex-col gap-0.5 border-t border-stroke-3 px-3 py-2.5 first:border-t-0">
            <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium">
              <span className="min-w-0">{t(copy.title.key, copy.title.values)}</span>
              <BudgetEntityBadge entityId={insight.entityId} kinds={kinds} />
            </span>
            <span className="text-[12px] text-fg-3">
              {t(copy.body.key, copy.body.values)}
              {copy.adjust ? (
                <>
                  {" "}
                  <button
                    type="button"
                    disabled={adjust.isPending}
                    onClick={() => copy.adjust && adjust.mutate({ budgetId: insight.budgetId, amount: copy.adjust.amount, category })}
                    className="text-fg-1 underline-offset-2 outline-none hover:underline focus-visible:underline disabled:opacity-40"
                  >
                    {t(copy.adjust.label.key, copy.adjust.label.values)}
                  </button>
                </>
              ) : null}
            </span>
          </div>
        );
      })}
      {!data.insights.length ? <EmptyRow>{t("year.insights.empty")}</EmptyRow> : null}
    </Panel>
  );
}
