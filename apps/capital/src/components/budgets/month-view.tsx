"use client";

import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyRow, Kpi, KpiStrip, Panel } from "@/components/cap";
import { useErrorMessage } from "@/lib/api/use-app-mutation";
import { budgetDrill, budgetsDrill, monthPeriod } from "@/lib/budgets/drill";
import { barHeader, monthHeader, resetsLabel } from "@/lib/budgets/labels";
import { monthPace, paceTone, percent, projectionVsBudget, STATUS_KEY, usage } from "@/lib/budgets/pace";
import type { BudgetsScope, BudgetsView } from "@/lib/budgets/url";
import { useFmt } from "@/lib/format/provider";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { CHART, CHART_AXIS } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";
import { cn } from "@/lib/utils";
import type { EditableBudget } from "./budget-dialog";
import { BudgetEntityBadge, ChartCaption, ChartLegend, DrillLink, EntityBadge, PaceBar, RowMenu, ScopeBar, TONE_TEXT, TOOLTIP_STYLE, useEntityNames, ViewState, type BudgetActions } from "./parts";
import { useMonthOverview, type BudgetRow, type MonthOverview, type UpcomingItem } from "./use-budgets";

/**
 * Mensal columns, same tracks as Transações (description 2.2fr, a narrower
 * flexible column, fixed amounts, ⋯ in its own 28px column).
 * Categoria | bar | Orçado | Gasto | Restante | Status | ⋯.
 */
const COLS = "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_80px_80px_80px_110px_28px] items-center gap-2 px-2.5";

/** Mensal: Todas / PF / PJ and today, KPIs, the budget table, the month's pace chart and Contas fixas. */
export function MonthView({
  view,
  onScope,
  actions,
  onOpenRule,
  onAllRules,
}: {
  view: BudgetsView;
  onScope: (scope: BudgetsScope) => void;
  actions: BudgetActions;
  onOpenRule: (id: string) => void;
  onAllRules: () => void;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const errorText = useErrorMessage();
  const overview = useMonthOverview(view.month, view.scope);
  const data = overview.data;
  const header = data ? monthHeader(data.period, fmt.monthAbbr) : null;
  return (
    <>
      <ScopeBar scope={view.scope} onScope={onScope}>
        {header ? t(header.key, header.values) : null}
      </ScopeBar>
      {data ? (
        <div className={cn("flex flex-col gap-3 transition-opacity", overview.isPlaceholderData && "opacity-60")}>
          <MonthBody data={data} actions={actions} onOpenRule={onOpenRule} onAllRules={onAllRules} />
        </div>
      ) : (
        <ViewState error={overview.isError ? errorText(overview.error) : null} onRetry={() => void overview.refetch()} />
      )}
    </>
  );
}

export function MonthBody({ data, actions, onOpenRule, onAllRules }: { data: MonthOverview; actions: BudgetActions; onOpenRule: (id: string) => void; onAllRules: () => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { names, kinds } = useEntityNames();
  const { period, summary, budgets } = data;
  const pace = monthPace(period);
  const monthLabel = fmt.monthLabel({ year: period.year, month: period.month });
  const projection = projectionVsBudget(summary.projectedTotal, summary.totalBudget);
  const bar = barHeader(period);
  const resets = resetsLabel(period.month, fmt.monthAbbr);
  // "Gasto" is spend to date (card purchases by purchase date). The drill widens the month so a statement that closes later still matches. The whole month is the committed spend.
  const spentPeriod = period.isCurrent ? monthPeriod(period.year, period.month, period.daysElapsed) : period.isPast ? monthPeriod(period.year, period.month) : null;
  const wholeMonth = monthPeriod(period.year, period.month);
  const drill = (row: BudgetRow, range: ReturnType<typeof monthPeriod> | null): ViewDraft | null =>
    range ? { label: t("drillLabel", { category: row.category, period: monthLabel }), ...budgetDrill(row, data.scope.entityIds, range) } : null;
  // KPIs and the Total row: every budgeted category at once ("todo número leva à tabela filtrada").
  const totals = (label: string, range: ReturnType<typeof monthPeriod> | null): ViewDraft | null => {
    const found = range ? budgetsDrill(budgets, data.scope.entityIds, range) : null;
    return found ? { label: t("drillLabel", { category: label, period: monthLabel }), ...found } : null;
  };

  return (
    <>
      <KpiStrip>
        <Kpi label={t("month.kpi.budget")} value={<DrillLink draft={totals(t("month.kpi.budget"), wholeMonth)}>{fmt.money0(summary.totalBudget)}</DrillLink>} />
        <Kpi
          label={t("month.kpi.spent")}
          value={<DrillLink draft={totals(t("month.kpi.spent"), spentPeriod)}>{fmt.money0(summary.totalSpent)}</DrillLink>}
          sub={summary.totalBudget > 0 ? t("month.kpi.spentSub", { pct: percent(summary.totalSpent / summary.totalBudget) }) : undefined}
        />
        <Kpi label={t("month.kpi.remaining")} value={<DrillLink draft={totals(t("month.kpi.remaining"), spentPeriod)}>{fmt.money0(summary.totalRoom)}</DrillLink>} />
        <Kpi
          label={t("month.kpi.projection")}
          value={<DrillLink draft={totals(t("month.kpi.projection"), wholeMonth)}>{fmt.money0(summary.projectedTotal)}</DrillLink>}
          sub={projection ? t(`month.kpi.${projection.kind}`, { amount: fmt.money0(projection.amount) }) : undefined}
          tone={projection?.kind === "over" ? "warn" : undefined}
        />
      </KpiStrip>
      <div className="grid items-start gap-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-x-auto rounded-[8px] border border-stroke-3">
          <div className={cn(COLS, "h-(--cap-row-h) text-label text-fg-3")}>
            <span>{t("month.table.category")}</span>
            <span className="truncate">{t(bar.key, bar.values)}</span>
            <span className="text-right whitespace-nowrap">{t("month.table.budgeted")}</span>
            <span className="text-right whitespace-nowrap">{t("month.table.spent")}</span>
            <span className="text-right whitespace-nowrap">{t("month.table.remaining")}</span>
            <span className="whitespace-nowrap">{t("month.table.status")}</span>
            <span />
          </div>
          {budgets.map((row) => {
            const ratio = usage(row.spent, row.available);
            const tone = paceTone(row.status);
            const spent = drill(row, spentPeriod);
            const editable: EditableBudget = {
              id: row.id,
              category: row.category,
              entityId: row.entityId,
              amount: row.amount,
              notes: row.notes,
              effectiveFrom: row.effectiveFrom,
              period: "monthly",
            };
            return (
              <div key={row.id} className={cn(COLS, "group h-10 border-t border-stroke-3 text-body")}>
                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <DrillLink draft={drill(row, wholeMonth)} title={row.category} className="min-w-0 truncate">
                    {row.category}
                  </DrillLink>
                  <BudgetEntityBadge entityId={row.entityId} kinds={kinds} />
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <PaceBar ratio={ratio} tone={tone} marker={pace} label={row.category} />
                  <span className="w-[34px] shrink-0 text-right font-mono text-caption text-fg-3 tabular-nums">{percent(ratio)}%</span>
                </span>
                <button
                  type="button"
                  aria-label={t("month.table.editAmount", { category: row.category, amount: fmt.money0(row.amount) })}
                  onClick={() => actions.onEdit(editable)}
                  className="w-full text-right font-mono whitespace-nowrap tabular-nums outline-none hover:underline focus-visible:underline"
                >
                  {fmt.money0(row.amount)}
                </button>
                <DrillLink draft={spent} className="text-right font-mono whitespace-nowrap tabular-nums">
                  {fmt.money0(row.spent)}
                </DrillLink>
                <DrillLink draft={spent} className={cn("text-right font-mono whitespace-nowrap tabular-nums", row.remaining < 0 ? "text-cat-red" : "text-fg-2")}>
                  {fmt.money0(row.remaining)}
                </DrillLink>
                <span className={cn("text-body-sm whitespace-nowrap", TONE_TEXT[tone])}>{t(`month.status.${STATUS_KEY[tone]}`)}</span>
                <span className="flex justify-center">
                  <RowMenu className="ml-0" category={row.category} onEdit={() => actions.onEdit(editable)} onDelete={() => actions.onDelete(editable)} />
                </span>
              </div>
            );
          })}
          {budgets.length ? (
            <div className={cn(COLS, "h-9 border-t border-stroke-2 bg-fill-4 text-body font-semibold")}>
              <span>{t("month.table.total")}</span>
              <span className="truncate text-label font-normal text-fg-3">{t(resets.key, resets.values)}</span>
              <span />
              <DrillLink draft={totals(t("month.table.total"), spentPeriod)} className="text-right font-mono whitespace-nowrap tabular-nums">
                {fmt.money0(summary.totalSpent)}
              </DrillLink>
              <DrillLink draft={totals(t("month.table.total"), spentPeriod)} className="text-right font-mono whitespace-nowrap tabular-nums">
                {fmt.money0(summary.totalRoom)}
              </DrillLink>
              <span />
              <span />
            </div>
          ) : (
            <EmptyRow>{t("month.table.empty", { month: monthLabel })}</EmptyRow>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <PaceChart data={data} monthLabel={monthLabel} />
          <Panel
            title={t("month.upcoming.title")}
            pad={false}
            trailing={
              <button type="button" onClick={onAllRules} className="text-label font-normal text-fg-3 outline-none hover:text-fg-1 focus-visible:text-fg-1">
                {t("month.upcoming.seeAll")}
              </button>
            }
          >
            {data.upcoming.map((item) => (
              <UpcomingLine key={`${item.source}:${item.id}`} item={item} names={names} onOpenRule={onOpenRule} />
            ))}
            {!data.upcoming.length ? <EmptyRow>{t("month.upcoming.empty")}</EmptyRow> : null}
          </Panel>
        </div>
      </div>
    </>
  );
}

function PaceChart({ data, monthLabel }: { data: MonthOverview; monthLabel: string }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const unit = fmt.kUnit();
  const { series, summary, period, budgets } = data;
  const empty = !budgets.length ? t("month.chart.empty") : !series.length ? t("month.chart.notStarted") : null;
  const names = { cumulative: t("month.chart.cumulative", { unit }), ideal: t("month.chart.ideal", { unit }), budget: t("month.chart.budget") };
  return (
    <Panel title={t("month.chart.title")}>
      {empty ? (
        <p className="py-6 text-center text-body-sm text-fg-3">{empty}</p>
      ) : (
        <>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={(day: number) => String(day).padStart(2, "0")} tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} minTickGap={12} />
                <YAxis tickFormatter={(v: number) => fmt.number(v / 1000, { min: 0, max: 1 })} tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} width={34} />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value) => fmt.money0(Number(value))}
                  labelFormatter={(day) => t("month.chart.day", { day: String(day).padStart(2, "0"), month: fmt.monthAbbr(period.month) })}
                />
                {summary.totalBudget > 0 ? (
                  <ReferenceLine
                    y={summary.totalBudget}
                    stroke={CHART.muted}
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{ value: names.budget, position: "insideTopRight", fontSize: textRole("micro"), fill: CHART.muted }}
                  />
                ) : null}
                <Line dataKey="ideal" name={names.ideal} stroke={CHART.soft} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="cumulative" name={names.cumulative} stroke={CHART.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend
            items={[
              { label: names.cumulative, color: CHART.ink },
              { label: names.ideal, color: CHART.soft },
              { label: names.budget, color: CHART.muted, dashed: true },
            ]}
          />
          <ChartCaption>{t("month.chart.caption", { unit, month: monthLabel })}</ChartCaption>
        </>
      )}
    </Panel>
  );
}

/** A Contas fixas row: a rule opens its editor; a card bill opens its purchases in Transações. */
function UpcomingLine({ item, names, onOpenRule }: { item: UpcomingItem; names: ReadonlyMap<string, string>; onOpenRule: (id: string) => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const description = item.mode === "fatura" ? t("month.upcoming.bill", { account: item.description }) : item.description;
  const className =
    "flex h-8 w-full items-center gap-2 border-t border-stroke-3 px-3 text-left text-control outline-none first:border-t-0 hover:bg-fill-4 focus-visible:bg-fill-4";
  const content = (
    <>
      <span className={cn("w-[38px] shrink-0 font-mono text-label", item.overdue ? "text-cat-red" : "text-fg-3")} title={item.overdue ? t("month.upcoming.overdue") : undefined}>
        {fmt.date(item.dueDate)}
      </span>
      <span className="min-w-0 truncate">{description}</span>
      <EntityBadge entityId={item.entityId} names={names} />
      <span className="ml-auto shrink-0 text-caption text-fg-4">{t(`month.upcoming.mode.${item.mode}`)}</span>
      <span className="w-[74px] shrink-0 text-right font-mono tabular-nums">{fmt.money0(item.amount, item.currency)}</span>
    </>
  );
  if (item.source === "statement" && item.statementId) {
    return (
      <DrillLink
        className={cn(className, "hover:no-underline")}
        draft={{ label: description, filters: [{ field: "cardStatementId", op: "in", values: [item.statementId] }], period: { preset: "all", offset: 0 } }}
      >
        {content}
      </DrillLink>
    );
  }
  return (
    <button type="button" className={className} onClick={() => item.ruleId && onOpenRule(item.ruleId)}>
      {content}
    </button>
  );
}
