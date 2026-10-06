"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Btn, Callout, EmptyRow, Kpi, KpiStrip, Panel, Segmented, Table, TextInput } from "@/components/cap";
import { Page } from "@/components/shell/page";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/api/session";
import { useFmt } from "@/lib/format/provider";
import { useContributions, useDebounced, useFireSummary, useFxRates, useRebalance } from "@/lib/invest/api";
import { alternativeContribution, clampEnd, contributionSeries, currentMonth, historyRows, parseMonth, shiftMonth } from "@/lib/invest/contributions-view";
import { approxQuantityLabel, ordersFromSuggestion, parseAporteAmount } from "@/lib/invest/rebalance-view";
import type { RebalanceAsset, RebalanceSuggestion } from "@/lib/invest/types";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { buildTransactionsHref } from "@/lib/ledger/view-draft";
import { cn } from "@/lib/utils";
import { ContributionsChart } from "./charts";
import { MONO, useCompactMoney, useMonthRange, useMonthShort, useScopeParam } from "./common";
import { AporteDialog, FireGoalDialog, OrdersDialog, TargetsDialog } from "./dialogs";

/** Transações filtered to these transfers (the "ver em Transações ↗" drill; transferGroupId is a C3 categorical field). */
function transfersHref(transferGroupIds: string[]): string {
  const draft = { period: { preset: "all", offset: 0 }, filters: [{ field: "transferGroupId", op: "in", values: transferGroupIds }] } as unknown as ViewDraft;
  return buildTransactionsHref({ draft });
}

/** Investimentos › Aportes (mockup ContributionsScreen): trailing 12 months ending at ?end=YYYY-MM. */
export function ContributionsScreen() {
  const t = useTranslations("invest.contrib");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const me = useSession().data;
  const [scope] = useScopeParam();
  const [endParam, setEndParam] = useQueryState("end", parseAsString);
  const thisMonth = currentMonth(me?.timezone ?? "America/Sao_Paulo");
  const end = clampEnd(endParam, thisMonth);
  const short = useMonthShort();
  const range = useMonthRange();
  const compact = useCompactMoney();
  const fx = useFxRates();

  const flows = useContributions(end, scope);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [mode, setMode] = useState<"class" | "asset">("class");
  const [dialog, setDialog] = useState<null | "aporte" | "goal" | "targets" | "orders">(null);

  const fireBase = useFireSummary(null);
  const goal = fireBase.data?.currentMonthContribution ?? null;
  const alt = alternativeContribution(goal);
  const fireAlt = useFireSummary(alt);
  const fire = fireAlt.data ?? fireBase.data;

  // "Vou aportar R$": prefilled with the month's goal until the user types.
  const amount = amountText === null ? Math.round(goal ?? 0) : parseAporteAmount(amountText);
  const debounced = useDebounced(amount, 350);
  const suggestion = useRebalance(debounced, scope);

  const data = flows.data;
  const cur = data?.baseCurrency ?? fx.base;
  const months = data?.months ?? [];
  const last = months.at(-1);
  const series = contributionSeries(months);
  const history = historyRows(months, goal);
  const year = parseMonth(end).year;

  return (
    <Page
      crumbs={[ti("crumbs.investments"), ti("crumbs.contributions")]}
      actions={
        <>
          <span className="inline-flex h-[26px] items-center rounded-[6px] border border-stroke-1 bg-editor text-[12px]">
            <button type="button" aria-label={t("prev")} className="h-full border-r border-stroke-3 px-1.5 hover:bg-fill-4" onClick={() => void setEndParam(shiftMonth(end, -12))}>
              ‹
            </button>
            <span className="px-2 font-medium">{year}</span>
            <button
              type="button"
              aria-label={t("next")}
              className="h-full border-l border-stroke-3 px-1.5 hover:bg-fill-4 disabled:text-fg-4"
              disabled={end >= thisMonth}
              onClick={() => {
                const next = shiftMonth(end, 12);
                void setEndParam(next >= thisMonth ? null : next);
              }}
            >
              ›
            </button>
          </span>
          <Btn primary onClick={() => setDialog("aporte")}>
            {t("register")}
          </Btn>
        </>
      }
    >
      <KpiStrip>
        <Kpi
          label={t("kpi.month", { month: short(end) })}
          value={fmt.money0(last?.net ?? 0, cur)}
          sub={goal !== null ? t("kpi.goalFire", { amount: fmt.money0(goal, cur) }) : t("kpi.noGoal")}
          tone={goal !== null ? ((last?.net ?? 0) >= goal ? "pos" : "warn") : undefined}
        />
        <Kpi label={t("kpi.avg")} value={fmt.money0(data?.averageMonthly ?? 0, cur)} />
        <Kpi label={t("kpi.total")} value={fmt.money0(data?.totalNet ?? 0, cur)} />
        <Kpi label={t("kpi.savings")} value={data?.savingsRate.rate != null ? fmt.pct(data.savingsRate.rate, 0) : "—"} sub={t("kpi.savingsSub")} />
      </KpiStrip>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title={t("chart.title")}>
          <div className="flex flex-col gap-2">
            {series.classes.length ? (
              <ContributionsChart rows={series.rows.map((r) => ({ label: fmt.monthAbbr(Number(r.period.slice(5, 7))), values: r.values }))} classes={series.classes} goal={goal} />
            ) : (
              <p className="flex h-[200px] items-center justify-center text-[12px] text-fg-3">{flows.isLoading ? ti("loading") : t("chart.empty")}</p>
            )}
            <span className="text-[11px] text-fg-4">{t("chart.caption", { unit: fmt.kUnit(cur), range: data ? range(data.from, data.to) : "" })}</span>
          </div>
        </Panel>
        <Panel title={t("where.title")}>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-fg-3">{t("where.amount", { symbol: fmt.currencySymbol(cur) })}</span>
              <TextInput value={amountText ?? (amount ? String(amount) : "")} onChange={setAmountText} mono inputMode="numeric" className="w-[110px]" />
              <Segmented
                className="ml-auto"
                value={mode}
                options={[
                  { v: "class", l: t("where.byClass") },
                  { v: "asset", l: t("where.byAsset") },
                ]}
                onChange={setMode}
              />
            </div>
            <SuggestionTable suggestion={suggestion.data} error={suggestion.error} amount={debounced} mode={mode} onTargets={() => setDialog("targets")} />
            <span className="text-[11px] text-fg-4">{t("where.caption")}</span>
            <div className="flex gap-1.5">
              <Btn primary disabled={!suggestion.data?.assets} onClick={() => setDialog("orders")}>
                {t("where.generate")}
              </Btn>
              <Btn onClick={() => setDialog("targets")}>{t("where.editTargets")}</Btn>
            </div>
          </div>
        </Panel>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title={t("history.title")} pad={false}>
          {history.map((row) => (
            <div key={row.period} className="flex h-[34px] items-center gap-2.5 border-t border-stroke-3 px-3 text-[12.5px] first:border-t-0">
              <span className={cn(MONO, "w-[46px] shrink-0 text-[11.5px] text-fg-3")}>{short(row.period)}</span>
              <span className={cn(MONO, "w-[90px] shrink-0")}>{fmt.money0(row.net, cur)}</span>
              <Link href={transfersHref(row.transferGroupIds)} className="flex min-w-0 items-center gap-1.5 text-fg-2 hover:text-fg-1">
                <span className="truncate">{row.origin}</span>
                <span className="shrink-0 text-fg-4">{t("history.link")}</span>
              </Link>
              {row.status ? <span className={cn("ml-auto shrink-0 text-[12px]", row.status === "below" ? "text-cat-yellow" : "text-fg-3")}>{t(`history.status.${row.status}`)}</span> : null}
            </div>
          ))}
          {!history.length ? <EmptyRow>{flows.isLoading ? ti("loading") : t("history.empty")}</EmptyRow> : null}
        </Panel>
        <Panel
          title={t("fire.title")}
          trailing={
            fire ? (
              <Btn ghost onClick={() => setDialog("goal")}>
                {fire.goal ? t("fire.edit") : t("fire.define")}
              </Btn>
            ) : null
          }
        >
          {fire?.result && fire.goal ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-6">
                <Kpi
                  label={t("fire.number")}
                  value={compact(fire.result.fireNumber, cur)}
                  sub={t("fire.numberSub", { income: fmt.money0(fire.goal.targetMonthlyIncome, cur), swr: fmt.pct(fire.goal.safeWithdrawalRate, 1) })}
                />
                <Kpi label={t("fire.progress")} value={fmt.pct(fire.result.progress, 1)} />
              </div>
              <span className="relative h-1.5 rounded-[3px] bg-fill-3">
                <span className="absolute inset-y-0 left-0 rounded-[3px] bg-fg-1" style={{ width: `${Math.min(Math.max(fire.result.progress, 0), 1) * 100}%` }} />
              </span>
              <span className="text-[11px] text-fg-3">
                {fire.result.reached
                  ? t("fire.reached")
                  : fire.result.projectedFireDate
                    ? t("fire.projection", { date: fmt.monthLabel(fire.result.projectedFireDate.slice(0, 10)), amount: fmt.money0(goal ?? 0, cur) })
                    : t("fire.unreachable")}
                {!fire.result.reached && alt !== null && fire.altProjection
                  ? fire.altProjection.projectedFireDate
                    ? t("fire.alt", { amount: fmt.money0(alt, cur), date: fmt.monthLabel(fire.altProjection.projectedFireDate.slice(0, 10)) })
                    : t("fire.altUnreachable", { amount: fmt.money0(alt, cur) })
                  : null}
              </span>
            </div>
          ) : (
            <span className="text-[12.5px] text-fg-2">
              {t("fire.noPlan", { invested: fmt.money0(fire?.suggestedDefaults.currentInvested ?? 0, cur), expenses: fmt.money0(fire?.suggestedDefaults.currentMonthlyExpenses ?? 0, cur) })}
            </span>
          )}
        </Panel>
      </div>
      {dialog === "aporte" ? <AporteDialog initialAmount={amount > 0 ? amount : undefined} onClose={() => setDialog(null)} /> : null}
      {dialog === "goal" && fire ? <FireGoalDialog summary={fire} onClose={() => setDialog(null)} /> : null}
      {dialog === "targets" ? <TargetsDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "orders" && suggestion.data?.assets ? <Orders assets={suggestion.data.assets} rateFor={fx.rateFor} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}

function Orders({ assets, rateFor, onClose }: { assets: RebalanceAsset[]; rateFor: (currency: string) => number; onClose: () => void }) {
  const orders = ordersFromSuggestion(assets, rateFor);
  return <OrdersDialog orders={orders} skipped={assets.length - orders.length} onClose={onClose} />;
}

function SuggestionTable({
  suggestion,
  error,
  amount,
  mode,
  onTargets,
}: {
  suggestion: RebalanceSuggestion | undefined;
  error: unknown;
  amount: number;
  mode: "class" | "asset";
  onTargets: () => void;
}) {
  const t = useTranslations("invest.contrib.where");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  if (!(amount > 0)) return <Callout tone="neutral">{t("typeAmount")}</Callout>;
  if (error instanceof ApiError && error.code === "rebalance.no_targets") {
    return (
      <Callout tone="info">
        {t("noTargets")}{" "}
        <button type="button" className="underline" onClick={onTargets}>
          {t("editTargets")}
        </button>
      </Callout>
    );
  }
  if (!suggestion) return <EmptyRow>{ti("loading")}</EmptyRow>;
  if (mode === "class") {
    return (
      <Table
        headers={[t("headers.class"), t("headers.current"), t("headers.target"), t("headers.put"), t("headers.after")]}
        columnAlign={["left", "right", "right", "right", "right"]}
        rows={suggestion.classes
          .filter((c) => c.target > 0 || c.value > 0)
          .map((c) => [
            ti(`allocationClass.${c.allocationClass}`),
            <span key="a" className={MONO}>
              {fmt.pct(c.currentShare)}
            </span>,
            <span key="t" className={cn(MONO, "text-fg-3")}>
              {fmt.pct(c.target, 0)}
            </span>,
            <span key="p" className={cn(MONO, "font-semibold", c.amount > 0 ? "text-fg-1" : "text-fg-4")}>
              {c.amount > 0 ? fmt.money0(c.amount) : "—"}
            </span>,
            <span key="d" className={MONO}>
              {fmt.pct(c.afterShare)}
            </span>,
          ])}
      />
    );
  }
  const assets = suggestion.assets ?? [];
  return (
    <Table
      headers={[t("headers.asset"), t("headers.class"), t("headers.broker"), t("headers.put"), t("headers.qty")]}
      columnAlign={["left", "left", "left", "right", "right"]}
      rows={assets.map((a) => [
        <span key="tk" className={cn(MONO, "font-semibold")}>
          {a.kind === "holding" ? (a.ticker ?? a.name) : a.kind === "new" ? t("newAsset") : t("cashKeep")}
        </span>,
        ti(`allocationClass.${a.allocationClass}`),
        a.accountName ?? "—",
        <span key="p" className={cn(MONO, "font-semibold")}>
          {fmt.money0(a.amount)}
        </span>,
        <span key="q" className={cn(MONO, "text-fg-3")}>
          {approxQuantityLabel(a, fmt, (count) => t("units", { count })) ?? "—"}
        </span>,
      ])}
    />
  );
}
