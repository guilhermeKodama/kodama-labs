"use client";

import { useTranslations } from "next-intl";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyRow, Kpi, KpiStrip, Panel } from "@/components/cap";
import { useErrorMessage } from "@/lib/api/use-app-mutation";
import { budgetDrill, budgetsDrill, monthPeriod } from "@/lib/budgets/drill";
import { budgetKind } from "@/lib/budgets/kind";
import { filteredKindTotals, paceForKind } from "@/lib/budgets/slices";
import { barHeader, monthHeader, resetsLabel } from "@/lib/budgets/labels";
import { monthPace, paceTone, percent, projectionVsBudget, STATUS_KEY, usage } from "@/lib/budgets/pace";
import type { BudgetsScope, BudgetsView } from "@/lib/budgets/url";
import { useFmt } from "@/lib/format/provider";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { CHART, CHART_AXIS, SERIES } from "@/lib/theme/chart-colors";
import { textRole } from "@/lib/theme/type-scale";
import { cn } from "@/lib/utils";
import type { EditableBudget } from "./budget-dialog";
import { BudgetEntityBadge, ChartCaption, ChartLegend, DrillLink, EntityBadge, PaceBar, RowMenu, ScopeBar, SeriesMark, TONE_TEXT, TOOLTIP_STYLE, useEntityNames, ViewState, type BudgetActions } from "./parts";
import { useMonthOverview, type BudgetRow, type MonthOverview, type UpcomingItem } from "./use-budgets";

/**
 * Mensal columns. From md up, the same tracks as Transações: the name is
 * the widest flexible column (2.2fr) and truncates only past that, the
 * pace bar takes 1.8fr, and Orçado / Gasto / Restante / Status / ⋯ stay
 * fixed. Below md the fixed tracks are wider than the screen, so each row
 * stacks instead: name + badge, the bar full width, then the four figures
 * two by two, read from the left like the KPIs above them.
 */
const COLS =
  "grid-cols-4 gap-x-2 gap-y-1 px-2.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.8fr)_80px_80px_80px_110px_28px] md:items-center md:gap-2";
const NAME_CELL = "order-1 col-span-3 flex min-w-0 items-center gap-1.5 overflow-hidden md:order-0 md:col-span-1";
const BAR_CELL = "order-3 col-span-4 flex min-w-0 items-center gap-2 md:order-0 md:col-span-1";
const MENU_CELL = "order-2 col-span-1 flex items-center justify-end md:order-0 md:col-span-1 md:justify-center";
const STAT_CELL = "col-span-2 flex flex-col items-start gap-0.5 text-left md:col-span-1 md:block md:text-right";

/**
 * One hue each, from the Cerne chart board. Heartwood stays the cumulative
 * line (it is the primary ink). Fixo is musgo, the green in the series;
 * ardósia reads as blue on the wood paper. Variável is resina. The ideal
 * pace is jacarandá, which still reads on charcoal. Orçado is the ipê
 * already reserved for reference marks, drawn dashed. Ember stays with loss.
 */
const PACE_COLOR = {
  fixo: SERIES.musgo,
  variavel: SERIES.resina,
  cumulative: CHART.ink,
  ideal: SERIES.jacaranda,
  budget: CHART.warn,
} as const;

function kindLabel(text: string, color: string) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SeriesMark color={color} />
      {text}
    </span>
  );
}

/** Mensal: Todas / PF / PJ and today, KPIs, the budget table, the month's pace chart and Contas fixas. */
export function MonthView({
  view,
  onScope,
  onKind,
  actions,
  onOpenRule,
  onAllRules,
}: {
  view: BudgetsView;
  onScope: (scope: BudgetsScope) => void;
  onKind: (kind: BudgetsView["kind"]) => void;
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
      <ScopeBar scope={view.scope} onScope={onScope} kind={view.kind} onKind={onKind}>
        {header ? t(header.key, header.values) : null}
      </ScopeBar>
      {data ? (
        <div className={cn("flex flex-col gap-3 transition-opacity", overview.isPlaceholderData && "opacity-60")}>
          <MonthBody data={data} kind={view.kind} actions={actions} onOpenRule={onOpenRule} onAllRules={onAllRules} />
        </div>
      ) : (
        <ViewState error={overview.isError ? errorText(overview.error) : null} onRetry={() => void overview.refetch()} />
      )}
    </>
  );
}

export function MonthBody({
  data,
  kind = null,
  actions,
  onOpenRule,
  onAllRules,
}: {
  data: MonthOverview;
  kind?: BudgetsView["kind"];
  actions: BudgetActions;
  onOpenRule: (id: string) => void;
  onAllRules: () => void;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { names, kinds } = useEntityNames();
  const { period, budgets: allBudgets } = data;
  const slices = filteredKindTotals(allBudgets, kind ?? null);
  const budgets = slices.rows;
  const { total } = slices;
  const gasto = total.net;
  const pace = monthPace(period);
  const monthLabel = fmt.monthLabel({ year: period.year, month: period.month });
  const projection = projectionVsBudget(total.projected, total.available);
  const bar = barHeader(period);
  const resets = resetsLabel(period.month, fmt.monthAbbr);
  // "Gasto" is spend to date (card purchases by purchase date). The drill widens the month so a statement that closes later still matches. The whole month is the committed spend.
  const spentPeriod = period.isCurrent ? monthPeriod(period.year, period.month, period.daysElapsed) : period.isPast ? monthPeriod(period.year, period.month) : null;
  const wholeMonth = monthPeriod(period.year, period.month);
  const drill = (row: BudgetRow, range: ReturnType<typeof monthPeriod> | null): ViewDraft | null =>
    range ? { label: t("drillLabel", { category: row.category, period: monthLabel }), ...budgetDrill(row, data.scope.entityIds, range) } : null;
  // KPIs and the footer: the rows that survive the active filters ("todo número leva à tabela filtrada").
  const totals = (label: string, range: ReturnType<typeof monthPeriod> | null, rows: BudgetRow[]): ViewDraft | null => {
    const found = range ? budgetsDrill(rows, data.scope.entityIds, range) : null;
    return found ? { label: t("drillLabel", { category: label, period: monthLabel }), ...found } : null;
  };
  const rowsOf = (filter: "fixo" | "variavel" | null) => (filter ? budgets.filter((row) => budgetKind(row.kind) === filter) : budgets);
  const spentSub = (net: number, reimbursed: number, available: number) =>
    reimbursed > 0 ? t("month.kpi.spentNet", { amount: fmt.money0(reimbursed) }) : available > 0 ? t("month.kpi.spentSub", { pct: percent(net / available) }) : undefined;

  return (
    <>
      <KpiStrip>
        <div data-budget-kpi="budget">
          <Kpi label={t("month.kpi.budget")} value={<DrillLink draft={totals(t("month.kpi.budget"), wholeMonth, budgets)}>{fmt.money0(total.available)}</DrillLink>} />
        </div>
        <div data-budget-kpi="spent">
          <Kpi label={t("month.kpi.spent")} value={<DrillLink draft={totals(t("month.kpi.spent"), spentPeriod, budgets)}>{fmt.money0(gasto)}</DrillLink>} sub={spentSub(gasto, total.reimbursed, total.available)} />
        </div>
        <div data-budget-kpi="fixo">
          <Kpi
            label={kindLabel(t("month.kpi.fixed"), PACE_COLOR.fixo)}
            value={<DrillLink draft={totals(t("month.kpi.fixed"), spentPeriod, rowsOf("fixo"))}>{fmt.money0(slices.fixo.net)}</DrillLink>}
            sub={spentSub(slices.fixo.net, slices.fixo.reimbursed, slices.fixo.available)}
          />
        </div>
        <div data-budget-kpi="variavel">
          <Kpi
            label={kindLabel(t("month.kpi.variable"), PACE_COLOR.variavel)}
            value={<DrillLink draft={totals(t("month.kpi.variable"), spentPeriod, rowsOf("variavel"))}>{fmt.money0(slices.variavel.net)}</DrillLink>}
            sub={spentSub(slices.variavel.net, slices.variavel.reimbursed, slices.variavel.available)}
          />
        </div>
        <div data-budget-kpi="remaining">
          <Kpi label={t("month.kpi.remaining")} value={<DrillLink draft={totals(t("month.kpi.remaining"), spentPeriod, budgets)}>{fmt.money0(total.remaining)}</DrillLink>} />
        </div>
        <div data-budget-kpi="projection">
          <Kpi
            label={t("month.kpi.projection")}
            value={<DrillLink draft={totals(t("month.kpi.projection"), wholeMonth, budgets)}>{fmt.money0(total.projected)}</DrillLink>}
            sub={projection ? t(`month.kpi.${projection.kind}`, { amount: fmt.money0(projection.amount) }) : undefined}
            tone={projection?.kind === "over" ? "warn" : undefined}
          />
        </div>
      </KpiStrip>
      {/* Side by side only once the month body is wide enough for a 2.2fr name and a 1.8fr bar. At a 1280px window the sidebar leaves ~1050px, and the 1.7fr pane would ellipsize Contas de Consumo. */}
      <div className="@container">
        <div className="grid items-start gap-3 @min-[1280px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-x-auto rounded-[8px] border border-stroke-3 bg-panel">
          <div className={cn("hidden md:grid", COLS, "h-(--cap-row-h) text-label text-fg-3")}>
            <span>{t("month.table.category")}</span>
            <span className="truncate">{t(bar.key, bar.values)}</span>
            <span className="text-right whitespace-nowrap">{t("month.table.budgeted")}</span>
            <span className="text-right whitespace-nowrap">{t("month.table.spent")}</span>
            <span className="text-right whitespace-nowrap">{t("month.table.remaining")}</span>
            <span className="whitespace-nowrap">{t("month.table.status")}</span>
            <span />
          </div>
          {budgets.map((row) => {
            const net = row.net ?? row.spent;
            const reimbursed = row.reimbursed ?? 0;
            const ratio = usage(net, row.available);
            const tone = paceTone(row.status);
            const spent = drill(row, spentPeriod);
            const showOffset = reimbursed !== 0;
            const editable: EditableBudget = {
              id: row.id,
              category: row.category,
              entityId: row.entityId,
              amount: row.amount,
              notes: row.notes,
              effectiveFrom: row.effectiveFrom,
              period: "monthly",
              kind: row.kind ?? null,
            };
            return (
              <div key={row.id} className={cn("grid", COLS, "group border-t border-stroke-3 py-2 text-body md:py-0", showOffset ? "md:h-auto md:min-h-10 md:py-1" : "md:h-10")}>
                <span className={cn(NAME_CELL, showOffset && "md:flex-wrap md:py-1")}>
                  <DrillLink draft={drill(row, wholeMonth)} title={row.category} className="min-w-0 truncate">
                    {row.category}
                  </DrillLink>
                  <span className="shrink-0 text-caption text-fg-3">{t(`kind.${budgetKind(row.kind)}`)}</span>
                  <BudgetEntityBadge entityId={row.entityId} kinds={kinds} />
                  {showOffset ? (
                    <span className="hidden basis-full text-caption font-normal text-fg-3 md:block">
                      <DrillLink draft={spent}>{t("month.table.gross", { amount: fmt.money0(row.spent) })}</DrillLink>
                      {" · "}
                      {t("month.table.reimbursed", { amount: fmt.money0(reimbursed) })}
                    </span>
                  ) : null}
                </span>
                <span className={BAR_CELL}>
                  <PaceBar ratio={ratio} tone={tone} marker={pace} label={row.category} />
                  <span className="w-[34px] shrink-0 text-right font-mono text-caption text-fg-3 tabular-nums">{percent(ratio)}%</span>
                </span>
                <button
                  type="button"
                  aria-label={t("month.table.editAmount", { category: row.category, amount: fmt.money0(row.amount) })}
                  onClick={() => actions.onEdit(editable)}
                  className={cn(STAT_CELL, "order-4 w-full font-mono whitespace-nowrap tabular-nums outline-none hover:underline focus-visible:underline md:order-0")}
                >
                  <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.budgeted")}</span>
                  {fmt.money0(row.amount)}
                </button>
                <span className={cn(STAT_CELL, "order-5 font-mono whitespace-nowrap tabular-nums md:order-0")}>
                  <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.spent")}</span>
                  <DrillLink draft={showOffset ? null : spent}>{fmt.money0(net)}</DrillLink>
                  {showOffset ? (
                    <span className="text-caption font-normal text-fg-3 md:hidden">
                      <DrillLink draft={spent}>{t("month.table.gross", { amount: fmt.money0(row.spent) })}</DrillLink>
                      {" · "}
                      {t("month.table.reimbursed", { amount: fmt.money0(reimbursed) })}
                    </span>
                  ) : null}
                </span>
                <DrillLink draft={spent} className={cn(STAT_CELL, "order-6 font-mono whitespace-nowrap tabular-nums md:order-0", row.remaining < 0 ? "text-neg" : "text-fg-2")}>
                  <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.remaining")}</span>
                  {fmt.money0(row.remaining)}
                </DrillLink>
                <span className={cn(STAT_CELL, "order-7 md:order-0 md:text-left")}>
                  <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.status")}</span>
                  <span className={cn("text-body-sm whitespace-nowrap", TONE_TEXT[tone])}>{t(`month.status.${STATUS_KEY[tone]}`)}</span>
                </span>
                <span className={MENU_CELL}>
                  <RowMenu className="ml-0" category={row.category} onEdit={() => actions.onEdit(editable)} onDelete={() => actions.onDelete(editable)} />
                </span>
              </div>
            );
          })}
          {allBudgets.length ? (
            (["fixo", "variavel", null] as const).map((filter) => {
              const slice = filter ? slices[filter] : slices.total;
              const id = filter ?? "total";
              return (
                <div key={id} data-budget-subtotal={id} className={cn("grid", COLS, "border-t border-stroke-2 bg-fill-4 py-2 text-body font-semibold md:h-9 md:py-0")}>
                  <span className="order-1 col-span-4 md:order-0 md:col-span-1">{filter ? t(`kind.${filter}`) : t("month.table.total")}</span>
                  <span className="order-2 col-span-4 truncate text-label font-normal text-fg-3 md:order-0 md:col-span-1">{filter ? null : t(resets.key, resets.values)}</span>
                  <span className={cn(STAT_CELL, "order-3 font-mono whitespace-nowrap tabular-nums md:order-0")}>
                    <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.budgeted")}</span>
                    {fmt.money0(slice.budget)}
                  </span>
                  <DrillLink draft={totals(t("month.table.total"), spentPeriod, rowsOf(filter))} className={cn(STAT_CELL, "order-4 font-mono whitespace-nowrap tabular-nums md:order-0")}>
                    <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.spent")}</span>
                    {fmt.money0(slice.net)}
                  </DrillLink>
                  <span className={cn(STAT_CELL, "order-5 font-mono whitespace-nowrap tabular-nums md:order-0", slice.remaining < 0 ? "text-neg" : undefined)}>
                    <span className="text-caption font-normal text-fg-3 md:hidden">{t("month.table.remaining")}</span>
                    {fmt.money0(slice.remaining)}
                  </span>
                  <span className="hidden md:block" />
                  <span className="hidden md:block" />
                </div>
              );
            })
          ) : (
            <EmptyRow>{t("month.table.empty", { month: monthLabel })}</EmptyRow>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <PaceChart data={data} budgets={budgets} monthLabel={monthLabel} kind={kind ?? null} />
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
      </div>
    </>
  );
}

function PaceChart({ data, budgets, monthLabel, kind }: { data: MonthOverview; budgets: MonthOverview["budgets"]; monthLabel: string; kind: BudgetsView["kind"] }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const unit = fmt.kUnit();
  const { series, period } = data;
  const points = paceForKind(series, budgets, kind, period.daysInMonth);
  const available = filteredKindTotals(budgets, kind).total.available;
  const empty = !budgets.length ? t("month.chart.empty") : !series.length ? t("month.chart.notStarted") : null;
  const showFixo = kind !== "variavel";
  const showVariavel = kind !== "fixo";
  const names = {
    fixed: t("month.kpi.fixed"),
    variable: t("month.kpi.variable"),
    cumulative: t("month.chart.cumulative", { unit }),
    ideal: t("month.chart.ideal", { unit }),
    budget: t("month.chart.budget"),
  };
  return (
    <Panel title={t("month.chart.title")} className="budget-pace-chart">
      {empty ? (
        <p className="py-6 text-center text-body-sm text-fg-3">{empty}</p>
      ) : (
        <>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={(day: number) => String(day).padStart(2, "0")} tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} minTickGap={12} />
                <YAxis tickFormatter={(v: number) => fmt.number(v / 1000, { min: 0, max: 1 })} tick={CHART_AXIS.tick} stroke={CHART_AXIS.stroke} tickLine={false} width={34} />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value) => fmt.money0(Number(value))}
                  labelFormatter={(day) => t("month.chart.day", { day: String(day).padStart(2, "0"), month: fmt.monthAbbr(period.month) })}
                />
                {available > 0 ? (
                  <ReferenceLine
                    y={available}
                    stroke={PACE_COLOR.budget}
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{ value: names.budget, position: "insideTopRight", fontSize: textRole("micro"), fill: PACE_COLOR.budget }}
                  />
                ) : null}
                {showFixo ? <Area type="monotone" dataKey="fixo" name={names.fixed} stackId="kind" stroke={PACE_COLOR.fixo} fill={PACE_COLOR.fixo} fillOpacity={0.8} strokeWidth={1.5} dot={false} isAnimationActive={false} /> : null}
                {showVariavel ? <Area type="monotone" dataKey="variavel" name={names.variable} stackId="kind" stroke={PACE_COLOR.variavel} fill={PACE_COLOR.variavel} fillOpacity={0.8} strokeWidth={1.5} dot={false} isAnimationActive={false} /> : null}
                <Line dataKey="ideal" name={names.ideal} stroke={PACE_COLOR.ideal} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="cumulative" name={names.cumulative} stroke={PACE_COLOR.cumulative} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ChartLegend
            items={[
              ...(showFixo ? [{ label: names.fixed, color: PACE_COLOR.fixo }] : []),
              ...(showVariavel ? [{ label: names.variable, color: PACE_COLOR.variavel }] : []),
              { label: names.cumulative, color: PACE_COLOR.cumulative },
              { label: names.ideal, color: PACE_COLOR.ideal },
              { label: names.budget, color: PACE_COLOR.budget, dashed: true },
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
      <span className={cn("w-[38px] shrink-0 font-mono text-label", item.overdue ? "text-neg" : "text-fg-3")} title={item.overdue ? t("month.upcoming.overdue") : undefined}>
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
