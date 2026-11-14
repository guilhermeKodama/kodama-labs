"use client";

import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyRow, Kpi, KpiStrip, Panel } from "@/components/cap";
import { apiPatch } from "@/lib/api/client";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import { budgetDrill, budgetsDrill, monthPeriod } from "@/lib/budgets/drill";
import { budgetKind, showsBudgetKind } from "@/lib/budgets/kind";
import { columnTense, flatMonthlyBudget, heatLevel, heatPercent, isClickable, monthlyBars, totalTone, trendOf, type HeatLevel } from "@/lib/budgets/heatmap";
import { filteredYearFigures } from "@/lib/budgets/slices";
import { heatmapLegend, insightCopy, trendBasis, yearHeader, yearToDateMonth } from "@/lib/budgets/labels";
import { percent, projectionVsBudget, usage, yearlyTone } from "@/lib/budgets/pace";
import { monthKey, type YearMonth } from "@/lib/budgets/period";
import type { BudgetsScope, BudgetsView } from "@/lib/budgets/url";
import { parsePhoneLayout, type PhoneLayout } from "@/lib/budgets/year-phone";
import { useFmt } from "@/lib/format/provider";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { CHART, CHART_AXIS } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";
import { cn } from "@/lib/utils";
import type { EditableBudget } from "./budget-dialog";
import { BudgetEntityBadge, ChartCaption, ChartLegend, DrillLink, PaceBar, RowMenu, ScopeBar, TOOLTIP_STYLE, useEntityNames, ViewState, type BudgetActions } from "./parts";
import { useYearOverview, type HeatmapRow, type YearOverview } from "./use-budgets";
import { KindSplit, PhoneYear } from "./year-phone";

/**
 * Categoria | jan…dez | Ano (proj.) | Tendência.
 * The category track is at least 11rem, so the name survives next to
 * "Variável" and the entity badge. Below md it is exactly 11rem, the name
 * sits above "Variável · PF", and the column sticks while the months scroll.
 */
const HEAT_COLS =
  "grid grid-cols-[minmax(11rem,1.1fr)_repeat(12,minmax(3rem,1fr))_92px_76px] items-center gap-1 px-3 max-md:grid-cols-[11rem_repeat(12,minmax(3rem,1fr))_92px_76px] max-md:items-stretch max-md:px-0";
/** Covers the grid gap so a scrolled month paints under the name, not beside it. */
const STICKY_CAT = "max-md:sticky max-md:left-0 max-md:z-10 max-md:-mr-1 max-md:self-stretch max-md:overflow-hidden max-md:py-1 max-md:pr-2 max-md:pl-3";
const STICKY_PANEL = "max-md:bg-panel";
/** fill-4 is translucent in the dark theme, so the panel sits behind it. */
const STICKY_TOTAL = "max-md:[background:linear-gradient(var(--cap-fill-4),var(--cap-fill-4)),var(--cap-bg-panel)]";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const HEAT_CLASS: Record<HeatLevel, string> = {
  over: "bg-fill-1 font-semibold text-neg",
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
  onKind,
  onOpenMonth,
  actions,
}: {
  view: BudgetsView;
  today: YearMonth;
  onScope: (scope: BudgetsScope) => void;
  onKind: (kind: BudgetsView["kind"]) => void;
  onOpenMonth: (month: number) => void;
  actions: BudgetActions;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const errorText = useErrorMessage();
  const overview = useYearOverview(view.year, view.scope);
  const data = overview.data;
  const [mv] = useQueryState("mv");
  const header = data ? yearHeader(data.period, fmt.monthAbbr) : null;
  return (
    <>
      <ScopeBar scope={view.scope} onScope={onScope} kind={view.kind} onKind={onKind}>
        {header ? t(header.key, header.values) : null}
      </ScopeBar>
      {data ? (
        <div className={cn("flex flex-col gap-3 transition-opacity", overview.isPlaceholderData && "opacity-60")}>
          <YearBody data={data} today={today} kind={view.kind} onOpenMonth={onOpenMonth} actions={actions} phone={parsePhoneLayout(mv)} />
        </div>
      ) : (
        <ViewState error={overview.isError ? errorText(overview.error) : null} onRetry={() => void overview.refetch()} />
      )}
    </>
  );
}

export function YearBody({
  data,
  today,
  kind,
  onOpenMonth,
  actions,
  phone = "table",
}: {
  data: YearOverview;
  today: YearMonth;
  kind: BudgetsView["kind"];
  onOpenMonth: (month: number) => void;
  actions: BudgetActions;
  /** Below md: the heatmap, or one of the phone layouts being compared. */
  phone?: PhoneLayout;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { kinds } = useEntityNames();
  const { period } = data;
  const figures = filteredYearFigures(data.categories, kind, period.nElapsed);
  const categories = figures.rows;
  const { monthTotals, monthBudgets, summary } = figures;
  const yearlyBudgets = data.yearlyBudgets.filter((row) => showsBudgetKind(row, kind));
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
    const found = range ? budgetsDrill(categories, data.scope.entityIds, range) : null;
    return found ? { label: t("drillLabel", { category: label, period: periodLabel }), ...found } : null;
  };
  // A month of the Total row: complete months whole, the current one through today.
  const monthRange = (month: number) => {
    const tensed = tense(month);
    if (tensed === "projected") return null;
    return tensed === "current" ? monthPeriod(data.year, month, Number(period.today.slice(8, 10))) : monthPeriod(data.year, month);
  };
  const totalLabel = t("year.heatmap.total");
  const monthDrill = (row: HeatmapRow, category: string, month: number): ViewDraft | null => {
    const range = monthRange(month);
    return range ? { label: t("drillLabel", { category, period: fmt.monthLabel({ year: data.year, month }) }), ...budgetDrill(row, data.scope.entityIds, range) } : null;
  };
  const onPhone = phone !== "table";

  return (
    <>
      <KpiStrip className={cn(onPhone && "max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3")}>
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

      {onPhone ? (
        <>
          <KindSplit data={data} kind={kind} />
          <PhoneYear
            layout={phone}
            data={data}
            categories={categories}
            monthTotals={monthTotals}
            monthBudgets={monthBudgets}
            tense={tense}
            drill={drill}
            monthDrill={monthDrill}
            onOpenMonth={onOpenMonth}
          />
        </>
      ) : null}

      <div data-budget-heat="" className={cn("overflow-x-auto rounded-[8px] border border-stroke-3 bg-panel", onPhone && "max-md:hidden")}>
        <div className="min-w-[1004px] max-md:min-w-[980px]">
          <div className={cn(HEAT_COLS, "h-(--cap-row-h) text-label text-fg-3")}>
            <span className={cn(STICKY_CAT, STICKY_PANEL, "max-md:flex max-md:items-center")}>{t("year.heatmap.category")}</span>
            {MONTHS.map((m) => (
              <span key={m} className={cn("text-center max-md:self-center", tense(m) === "projected" && "text-fg-4", tense(m) === "current" && "text-fg-1")}>
                {fmt.monthAbbr(m)}
                {tense(m) === "current" ? "*" : ""}
              </span>
            ))}
            <span className="text-right max-md:self-center max-md:pr-1">{t("year.heatmap.yearTotal")}</span>
            <span className="text-right max-md:self-center max-md:pr-3">{t("year.heatmap.trend")}</span>
          </div>
          {categories.map((row) => {
            const category = row.category ?? t("uncategorized");
            const trend = trendOf(row.trend);
            const kindLabel = row.isBudgeted ? t(`kind.${budgetKind(row.kind)}`) : null;
            return (
              <div key={`${row.entityId}:${row.categoryId}`} className={cn(HEAT_COLS, "h-(--cap-row-h) border-t border-stroke-3 text-body max-md:h-auto max-md:min-h-14")}>
                <span data-budget-category={category} className={cn(STICKY_CAT, STICKY_PANEL, "flex min-w-0 items-center gap-1.5 max-md:flex-col max-md:items-start max-md:justify-center max-md:gap-0.5")}>
                  <DrillLink draft={drill(row, category)} title={category} className="min-w-0 max-w-full truncate max-md:font-medium">
                    {category}
                  </DrillLink>
                  {kindLabel ? <span className="shrink-0 text-caption text-fg-3 max-md:hidden">{kindLabel}</span> : null}
                  <span className="max-md:hidden">
                    <BudgetEntityBadge entityId={row.entityId} kinds={kinds} />
                  </span>
                  <span className="hidden max-w-full min-w-0 items-center gap-1 truncate text-caption font-normal text-fg-3 max-md:flex">
                    {kindLabel ? (
                      <>
                        <span className="shrink-0">{kindLabel}</span>
                        <span aria-hidden>·</span>
                      </>
                    ) : null}
                    <BudgetEntityBadge entityId={row.entityId} kinds={kinds} />
                  </span>
                </span>
                {row.months.map((cell) => {
                  const level = heatLevel(cell);
                  const pct = heatPercent(cell);
                  const text = pct !== null ? `${pct}%` : cell.spent > 0 ? fmt.k(cell.spent, { minDigits: 1 }) : "·";
                  const className = cn("inline-flex h-(--cap-control-h) min-w-0 items-center justify-center rounded border border-transparent font-mono text-caption tabular-nums max-md:self-center", HEAT_CLASS[level]);
                  if (!isClickable(cell)) return (
                    <span key={cell.month} data-budget-month={cell.month} className={className}>
                      {text}
                    </span>
                  );
                  return (
                    <button
                      key={cell.month}
                      type="button"
                      data-budget-month={cell.month}
                      title={t("year.heatmap.open", { month: fmt.monthLabel({ year: data.year, month: cell.month }) })}
                      onClick={() => onOpenMonth(cell.month)}
                      className={cn(className, "outline-none hover:border-stroke-1 focus-visible:border-fg-3")}
                    >
                      {text}
                    </button>
                  );
                })}
                <DrillLink draft={drill(row, category)} className="text-right font-mono text-body-sm tabular-nums max-md:self-center max-md:pr-1">
                  {fmt.money0(row.yearTotal)}
                </DrillLink>
                <span
                  className={cn(
                    "text-right font-mono text-label max-md:self-center max-md:pr-3",
                    trend.kind === "up" ? "text-warn" : trend.kind === "down" ? "text-pos" : trend.kind === "stable" ? "text-fg-3" : "text-fg-4",
                  )}
                >
                  {trend.kind === "none" ? "—" : t(`year.heatmap.trend_${trend.kind}`, { pct: trend.pct })}
                </span>
              </div>
            );
          })}
          {categories.length ? (
            <div className={cn(HEAT_COLS, "h-9 border-t border-stroke-2 bg-fill-4 text-body-sm font-semibold")}>
              <span className={cn(STICKY_CAT, STICKY_TOTAL, "max-md:flex max-md:items-center")}>{t("year.heatmap.total")}</span>
              {monthTotals.map((total, i) => {
                const tone = totalTone(total, monthBudgets[i] ?? 0, tense(i + 1) === "projected");
                return (
                  <DrillLink
                    key={i}
                    draft={totals(totalLabel, monthRange(i + 1), fmt.monthLabel({ year: data.year, month: i + 1 }))}
                    className={cn("text-center font-mono text-hint tabular-nums max-md:self-center", tone === "projected" ? "text-fg-4" : tone === "over" ? "text-neg" : "text-fg-1")}
                  >
                    {fmt.k(total, { minDigits: 1 })}
                  </DrillLink>
                );
              })}
              <DrillLink draft={totals(totalLabel, ytdRange)} className="text-right font-mono tabular-nums max-md:self-center max-md:pr-1">
                {fmt.money0(summary.projectedYear)}
              </DrillLink>
              <span />
            </div>
          ) : (
            <EmptyRow>{t("year.heatmap.empty", { year: data.year })}</EmptyRow>
          )}
        </div>
      </div>
      <p className={cn("text-body-sm text-fg-4", onPhone && "max-md:hidden")}>{t(legend.key, legend.values)}</p>

      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <MonthlyChart monthTotals={monthTotals} monthBudgets={monthBudgets} year={data.year} isProjected={(m) => tense(m) === "projected"} />
        <Insights data={data} today={today} categories={categories} />
      </div>

      {yearlyBudgets.length ? (
        <Panel title={t("year.yearly.title")} pad={false}>
          {yearlyBudgets.map((b) => {
            const cost = b.net ?? b.spent;
            const ratio = usage(cost, b.amount);
            const editable: EditableBudget = { id: b.id, category: b.category, entityId: b.entityId, amount: b.amount, notes: b.notes, effectiveFrom: b.effectiveFrom, period: "yearly", kind: b.kind ?? null };
            return (
              <div key={b.id} className="group grid h-10 grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_96px_96px] items-center gap-3 border-t border-stroke-3 px-3 text-body first:border-t-0 max-md:h-auto max-md:grid-cols-1 max-md:gap-1.5 max-md:py-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 max-md:min-w-0 max-md:shrink max-md:truncate">{b.category}</span>
                  <BudgetEntityBadge entityId={b.entityId} kinds={kinds} />
                  {b.notes ? <span className="min-w-0 truncate text-caption text-fg-4">{b.notes}</span> : null}
                  <RowMenu category={b.category} onEdit={() => actions.onEdit(editable)} onDelete={() => actions.onDelete(editable)} />
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <PaceBar ratio={ratio} tone={yearlyTone(ratio)} marker={b.yearPace} label={b.category} />
                  <span className="w-[34px] shrink-0 text-right font-mono text-caption text-fg-3 tabular-nums">{percent(ratio)}%</span>
                </span>
                <DrillLink draft={drill(b, b.category)} className="text-right font-mono tabular-nums">
                  {fmt.money0(cost)}
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

function MonthlyChart({
  monthTotals,
  monthBudgets,
  year,
  isProjected,
}: {
  monthTotals: readonly number[];
  monthBudgets: readonly number[];
  year: number;
  isProjected: (month: number) => boolean;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const unit = fmt.kUnit();
  const flat = flatMonthlyBudget(monthBudgets);
  // Zeros as null: the tooltip leaves out the series a month does not have (realized or projected).
  const rows = monthlyBars(monthTotals, isProjected, (v) => v).map((bar, i) => ({
    name: fmt.monthAbbr(bar.month),
    real: bar.real || null,
    proj: bar.proj || null,
    budget: monthBudgets[i] || null,
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
              <ReferenceLine y={flat} stroke={CHART.muted} strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: names.budget, position: "insideTopRight", fontSize: textRole("micro"), fill: CHART.muted }} />
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
          ...(monthBudgets.some((v) => v > 0) ? [{ label: names.budget, color: CHART.muted, dashed: true }] : []),
        ]}
      />
      <ChartCaption>{t("year.chart.caption", { unit, year })}</ChartCaption>
    </Panel>
  );
}

/** Tendências do ano; an overrun offers "Ajustar para R$ X?", a new version of the budget from this month on. */
function Insights({ data, today, categories }: { data: YearOverview; today: YearMonth; categories: YearOverview["categories"] }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { kinds } = useEntityNames();
  const from = monthKey(today);
  const adjust = useAppMutation({
    event: "budgets.write",
    mutationFn: ({ budgetId, amount }: { budgetId: string; amount: number; category: string }) =>
      apiPatch<{ batchId: string | null }>(`/api/v2/budgets/${budgetId}`, { amount, currency: fmt.prefs.baseCurrency, applyFrom: from }),
    undo: (_result, { amount, category }) => t("year.insights.adjusted", { category, amount: fmt.money0(amount), month: fmt.monthLabel(today) }),
  });
  const visible = new Set(categories.map((row) => `${row.entityId ?? ""}:${row.categoryId ?? ""}`));
  const insights = data.insights.filter((insight) => visible.has(`${insight.entityId ?? ""}:${insight.categoryId ?? ""}`));
  return (
    <Panel title={t("year.insights.title")} pad={false}>
      {insights.map((insight) => {
        const category = insight.category ?? t("uncategorized");
        const copy = insightCopy(insight, category, fmt.monthAbbr, (v) => fmt.money0(v), trendBasis(data.period.completeMonths));
        return (
          <div key={`${insight.budgetId}:${insight.kind}`} className="flex flex-col gap-0.5 border-t border-stroke-3 px-3 py-2.5 first:border-t-0">
            <span className="flex min-w-0 items-center gap-1.5 text-body font-medium">
              <span className="min-w-0">{t(copy.title.key, copy.title.values)}</span>
              <BudgetEntityBadge entityId={insight.entityId} kinds={kinds} />
            </span>
            <span className="text-body-sm text-fg-3">
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
      {!insights.length ? <EmptyRow>{t("year.insights.empty")}</EmptyRow> : null}
    </Panel>
  );
}
