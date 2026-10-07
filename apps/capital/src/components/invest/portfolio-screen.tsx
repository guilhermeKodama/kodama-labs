"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Badge, Btn, EmptyRow, Kpi, KpiStrip, Menu, MenuItem, Panel, Segmented } from "@/components/cap";
import { Page } from "@/components/shell/page";
import { apiDelete, apiPost } from "@/lib/api/client";
import { useNames } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { allocationBars, hasTargets } from "@/lib/invest/allocation";
import { return12mState } from "@/lib/invest/kpis";
import { NOTE_FILE_ACCEPT } from "@/lib/invest/note-import";
import { netWorthChartRows } from "@/lib/invest/portfolio-history-view";
import { useFxRates, useHoldings, useOperations, usePortfolioHistory, usePortfolioSummary } from "@/lib/invest/api";
import { buildHoldingsTable, type HoldingRow, type HoldingsViewConfig } from "@/lib/invest/holdings-view";
import { filterOps, isIncome, monthlyBars, type OpsViewConfig } from "@/lib/invest/ops-view";
import type { Holding, Operation, PortfolioScope, PortfolioSummary, PriceUpdateResult } from "@/lib/invest/types";
import { openAssistant } from "@/lib/shell/assistant-bridge";
import { cn } from "@/lib/utils";
import { IncomeChart, NetWorthChart } from "./charts";
import { MONO, todayIn, useMonthRange, useScopeParam, useSignedPct } from "./common";
import { EditOperationDialog, HoldingSheet, TargetsDialog, useOpLabel } from "./dialogs";
import { OperationDialog } from "./operation-dialog";
import { pickView, useInvestViews, useInvestViewWrites } from "./use-invest-views";
import { InvestViewTabs } from "./view-controls";

/** Holdings table columns (mockup COLS: Ativo · Classe · Corretora · Entidade · Valor · % cart. · Result.). */
const COLUMN_WIDTH: Record<string, string> = {
  ticker: "minmax(0, 2fr)",
  allocationClass: "minmax(0, 1fr)",
  accountId: "minmax(0, 0.9fr)",
  entityId: "76px",
  marketValue: "110px",
  share: "60px",
  result: "70px",
};
const COLUMN_ORDER = ["ticker", "allocationClass", "accountId", "entityId", "marketValue", "share", "result"] as const;
const RIGHT = new Set<string>(["marketValue", "share", "result"]);

/** Investimentos › Carteira (mockup PortfolioScreen). */
export function PortfolioScreen() {
  const t = useTranslations("invest.portfolio");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const me = useSession().data;
  const timezone = me?.timezone ?? "America/Sao_Paulo";
  const [scope, setScope] = useScopeParam();
  const [viewParam, setViewParam] = useQueryState("view", parseAsString);
  const summary = usePortfolioSummary(scope);
  const holdings = useHoldings(scope);
  const history = usePortfolioHistory(scope);
  const { views, canCreate } = useInvestViews();
  const writes = useInvestViewWrites();
  const view = pickView(views, viewParam);
  const fx = useFxRates();
  const [opOpen, setOpOpen] = useState<{ holdingId: string | null } | null>(null);
  const [detail, setDetail] = useState<Holding | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const range = useMonthRange();
  const signedPct = useSignedPct();

  const s = summary.data;
  const cur = s?.baseCurrency ?? fx.base;

  const refresh = useAppMutation({
    event: "investments.write",
    mutationFn: () => apiPost<PriceUpdateResult>("/api/v2/holdings/refresh-prices", {}),
    undo: (r) =>
      r.missing.length
        ? t("refreshedMissing", { updated: r.updated, total: r.totalHoldings, tickers: r.missing.join(", ") })
        : t("refreshed", { updated: r.updated, total: r.totalHoldings }),
  });

  // "Cotações de hoje 17:32 · USD 5,41"
  const quotesText = useMemo(() => {
    if (!s) return "";
    const held = new Set([...(holdings.data ?? []).map((h) => h.currency), ...s.brokers.map((b) => b.currency)]);
    held.delete(cur);
    const rates = [...held].sort().map((c) => t("fxRate", { currency: c, rate: fmt.number(fx.rateFor(c), 2) }));
    const at = s.pricesUpdatedAt;
    const when = at ? (fmt.date(at) === fmt.date(todayIn(timezone)) ? t("quotesToday", { time: fmt.time(at) }) : t("quotesOn", { date: fmt.date(at), time: fmt.time(at) })) : t("noQuotes");
    return [when, ...rates].join(" · ");
  }, [s, holdings.data, cur, fx, fmt, t, timezone]);

  const chart = netWorthChartRows(history.data?.months ?? []);
  const historyRows = chart.rows.map((r) => ({ ...r, label: fmt.monthAbbr(Number(r.period.slice(5, 7))) }));
  const historyRange = history.data ? range(history.data.from, history.data.to) : "";
  const ret = s?.return12m;
  const returnState = return12mState(ret);

  return (
    <Page
      crumbs={[ti("crumbs.investments"), ti("crumbs.portfolio")]}
      actions={
        <>
          <Btn disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            {refresh.isPending ? t("refreshing") : t("refreshPrices")}
          </Btn>
          <Btn title={t("importNoteHint")} onClick={() => fileInput.current?.click()}>
            {t("importNote")}
          </Btn>
          <input
            ref={fileInput}
            type="file"
            accept={NOTE_FILE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length) openAssistant({ files, prompt: t("importNotePrompt") });
            }}
          />
          <Btn primary onClick={() => setOpOpen({ holdingId: null })}>
            {t("newOperation")}
          </Btn>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Segmented value={scope} options={(["all", "pf", "pj"] as const).map((v) => ({ v, l: ti(`scope.${v}`) }))} onChange={setScope} />
        <span className="ml-auto truncate text-[12px] text-fg-3">{quotesText}</span>
      </div>
      <KpiStrip>
        <Kpi label={t("kpi.netWorth")} value={fmt.money0(s?.netWorth ?? 0, cur)} />
        <Kpi
          label={t("kpi.contributed")}
          value={fmt.money0(s?.contributed ?? 0, cur)}
          sub={s && s.initialPositions >= 0.005 ? <span title={t("history.initialPositionsHint")}>{t("kpi.contributedInitial", { amount: fmt.money0(s.initialPositions, cur) })}</span> : undefined}
        />
        <Kpi
          label={t("kpi.result")}
          value={fmt.money0(s?.result ?? 0, cur)}
          sub={s?.resultPercent != null ? signedPct(s.resultPercent) : undefined}
          tone={(s?.result ?? 0) >= 0 ? "pos" : "neg"}
        />
        <Kpi label={t("kpi.income12m")} value={fmt.money0(s?.income12m ?? 0, cur)} sub={t("kpi.incomeSub")} />
        <Kpi
          label={t("kpi.return12m")}
          value={
            ret?.value != null ? (
              signedPct(ret.value)
            ) : (
              <span title={returnState === "estimated" ? t("kpi.returnEstimatedHint") : undefined}>—</span>
            )
          }
          tone={ret?.value != null ? (ret.value >= 0 ? "pos" : "neg") : undefined}
          sub={
            ret && (ret.cdi !== null || ret.ipcaPlus6 !== null)
              ? t(returnState === "estimated" ? "kpi.benchmarksEstimated" : "kpi.benchmarks", {
                  cdi: ret.cdi !== null ? fmt.pct(ret.cdi) : "—",
                  ipca: ret.ipcaPlus6 !== null ? fmt.pct(ret.ipcaPlus6) : "—",
                })
              : returnState === "estimated"
                ? t("kpi.returnEstimated")
                : returnState === "pending"
                  ? t("kpi.returnPending")
                  : undefined
          }
        />
      </KpiStrip>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t("history.title")}>
          <div className="flex flex-col gap-2">
            {historyRows.length >= 2 ? (
              <NetWorthChart rows={historyRows} showInitial={chart.hasInitial} />
            ) : (
              <p className="flex h-[180px] items-center justify-center text-[12px] text-fg-3">{history.isLoading ? ti("loading") : t("history.empty")}</p>
            )}
            <span className="text-[11px] text-fg-4">{t("history.caption", { unit: fmt.kUnit(cur), range: historyRange, scope: ti(`scopeCaption.${scope}`) })}</span>
          </div>
        </Panel>
        <Panel
          title={t("allocation.title")}
          trailing={
            <Btn ghost onClick={() => setTargetsOpen(true)}>
              {t("allocation.editTargets")}
            </Btn>
          }
        >
          <AllocationPanel summary={s} onEditTargets={() => setTargetsOpen(true)} />
        </Panel>
      </div>
      <InvestViewTabs views={views} active={view} onSelect={(id) => void setViewParam(id)} writes={writes} canCreate={canCreate} holdings={holdings.data ?? []} summary={s} />
      {view?.dataset === "holdings" ? (
        <HoldingsTable config={view.config} holdings={holdings.data ?? []} summary={s} loading={holdings.isLoading} onOpen={setDetail} />
      ) : view?.dataset === "investment_ops" ? (
        <OpsView config={view.config} scope={scope} timezone={timezone} />
      ) : null}
      {detail ? (
        <HoldingSheet
          key={detail.id}
          holding={(holdings.data ?? []).find((h) => h.id === detail.id) ?? detail}
          onClose={() => setDetail(null)}
          onOperation={() => {
            setOpOpen({ holdingId: detail.id });
            setDetail(null);
          }}
        />
      ) : null}
      {targetsOpen ? <TargetsDialog onClose={() => setTargetsOpen(false)} /> : null}
      {opOpen ? <OperationDialog holdings={holdings.data ?? []} initialHoldingId={opOpen.holdingId} onClose={() => setOpOpen(null)} /> : null}
    </Page>
  );
}

/**
 * Mockup AllocationBars: 92px label, bar (0–50%) with the target tick, "pct ±pp".
 * A class without a target shows only its bar; with no target at all the
 * panel asks for them ("Defina alvos para comparar · Editar alvos").
 */
function AllocationPanel({ summary, onEditTargets }: { summary: PortfolioSummary | undefined; onEditTargets: () => void }) {
  const t = useTranslations("invest.portfolio.allocation");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  if (!summary?.allocation.length) return <p className="py-6 text-center text-[12px] text-fg-3">{t("empty")}</p>;
  const targeted = hasTargets(summary.allocation);
  return (
    <div className="flex flex-col gap-2.5">
      {allocationBars(summary.allocation).map((bar) => (
        <div key={bar.allocationClass} className="grid grid-cols-[92px_minmax(0,1fr)_84px] items-center gap-2.5 text-[12px]">
          <span className="truncate">{ti(`allocationClass.${bar.allocationClass}`)}</span>
          <span className="relative h-2 rounded-[4px] bg-fill-3">
            <span className="absolute inset-y-0 left-0 rounded-[4px] bg-fg-2" style={{ width: `${bar.barWidth}%` }} />
            {bar.tickLeft !== null ? <span className="absolute -top-[3px] h-3.5 w-0.5 bg-fg-1" style={{ left: `${bar.tickLeft}%` }} /> : null}
          </span>
          <span className={cn(MONO, "text-right text-[11.5px]")}>
            {fmt.pct(bar.share, 0)}
            {bar.diffLabel !== null ? <span className={bar.highlight ? "text-cat-yellow" : "text-fg-4"}> {bar.diffLabel}</span> : null}
          </span>
        </div>
      ))}
      {targeted ? (
        <span className="text-[11px] text-fg-4">{t("legend")}</span>
      ) : (
        <span className="text-[11px] text-fg-3">
          {t("noTargets")} ·{" "}
          <button type="button" className="underline underline-offset-[3px] hover:text-fg-1" onClick={onEditTargets}>
            {t("editTargets")}
          </button>
        </span>
      )}
    </div>
  );
}

function HoldingsTable({
  config,
  holdings,
  summary,
  loading,
  onOpen,
}: {
  config: HoldingsViewConfig;
  holdings: Holding[];
  summary: PortfolioSummary | undefined;
  loading: boolean;
  onOpen: (h: Holding) => void;
}) {
  const t = useTranslations("invest.portfolio");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const names = useNames();
  const cur = summary?.baseCurrency;
  const table = useMemo(() => buildHoldingsTable(holdings, summary?.brokers ?? [], config), [holdings, summary, config]);
  const columns = COLUMN_ORDER.filter((c) => config.columns.includes(c));
  const grid = columns.map((c) => COLUMN_WIDTH[c]).join(" ");
  const targetOf = (cls: string) => summary?.allocation.find((a) => a.allocationClass === cls)?.target ?? null;
  const groupLabel = (key: string) =>
    config.groupBy === "allocationClass"
      ? ti(`allocationClass.${key as HoldingRow["allocationClass"]}`)
      : config.groupBy === "accountId"
        ? (names.account.get(key) ?? key)
        : config.groupBy === "entityId"
          ? (names.entity.get(key) ?? key)
          : "";
  const cell = (row: HoldingRow, column: (typeof COLUMN_ORDER)[number]) => {
    switch (column) {
      case "ticker":
        return (
          <span key={column} className="flex min-w-0 items-baseline gap-2">
            <span className={cn(MONO, "text-[12px] font-semibold")}>{row.kind === "cash" ? t("cashTicker") : (row.ticker ?? "—")}</span>
            <span className="truncate text-[12px] text-fg-3">{row.kind === "cash" ? t("cashName") : row.name}</span>
          </span>
        );
      case "allocationClass":
        return (
          <span key={column} className="truncate text-fg-2">
            {ti(`allocationClass.${row.allocationClass}`)}
          </span>
        );
      case "accountId":
        return (
          <span key={column} className="truncate text-fg-2">
            {row.accountName ?? t("severalBrokers")}
          </span>
        );
      case "entityId":
        return (
          <span key={column} className="min-w-0">
            <Badge>{row.entityId ? (names.entity.get(row.entityId) ?? "—") : t("severalEntities")}</Badge>
          </span>
        );
      case "marketValue":
        return (
          <span key={column} className={cn(MONO, "text-right")}>
            {fmt.money0(row.value, cur)}
          </span>
        );
      case "share":
        return (
          <span key={column} className={cn(MONO, "text-right text-fg-2")}>
            {fmt.pct(row.share, 1)}
          </span>
        );
      case "result":
        return (
          <span key={column} className={cn(MONO, "text-right", !row.result ? "text-fg-3" : row.result > 0 ? "text-cat-green" : "text-cat-red")}>
            {!row.result ? "—" : `${row.result > 0 ? "+" : "−"}${fmt.number(Math.abs(row.result * 100), 1)}%`}
          </span>
        );
    }
  };
  return (
    <div className="overflow-hidden rounded-[8px] border border-stroke-3">
      <div className="grid h-[34px] items-center gap-2.5 px-3 text-[11.5px] text-fg-3" style={{ gridTemplateColumns: grid }}>
        {columns.map((c) => (
          <span key={c} className={RIGHT.has(c) ? "text-right" : undefined}>
            {t(`columns.${c}`)}
          </span>
        ))}
      </div>
      {table.groups.map((g) => (
        <div key={g.key || "all"}>
          {g.key ? (
            <div className="flex h-8 items-center gap-2 border-t border-stroke-3 bg-fill-4 px-3 text-[12px]">
              <span className="text-fg-3">▾</span>
              <span className="font-semibold">{groupLabel(g.key)}</span>
              <span className="text-fg-3">{g.rows.length}</span>
              <span className="ml-auto" />
              {config.groupBy === "allocationClass" && targetOf(g.key) !== null ? (
                <span className="text-[11.5px] text-fg-3">{t("target", { pct: fmt.pct(targetOf(g.key)!, 0) })}</span>
              ) : null}
              <span className={cn(MONO, "w-[110px] text-right font-semibold")}>{fmt.money0(g.value, cur)}</span>
              <span className={cn(MONO, "w-[60px] text-right text-fg-2")}>{fmt.pct(g.share, 0)}</span>
              <span className="w-[70px]" />
            </div>
          ) : null}
          {g.rows.map((row) => {
            const holding = row.holding;
            const content = columns.map((c) => cell(row, c));
            const className = "grid h-9 w-full items-center gap-2.5 border-t border-stroke-3 px-3 text-left text-[12.5px]";
            return holding ? (
              <button key={row.key} type="button" onClick={() => onOpen(holding)} className={cn(className, "hover:bg-fill-4")} style={{ gridTemplateColumns: grid }}>
                {content}
              </button>
            ) : (
              <div key={row.key} className={className} style={{ gridTemplateColumns: grid }}>
                {content}
              </div>
            );
          })}
        </div>
      ))}
      {!table.count ? <EmptyRow>{loading ? ti("loading") : t("emptyHoldings")}</EmptyRow> : null}
    </div>
  );
}

/** Proventos 12m (chart) and Operações (table with edit and undoable delete). */
function OpsView({ config, scope, timezone }: { config: OpsViewConfig; scope: PortfolioScope; timezone: string }) {
  const t = useTranslations("invest.portfolio.ops");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const fx = useFxRates();
  const opLabel = useOpLabel();
  const range = useMonthRange();
  const ops = useOperations({ scope });
  const today = todayIn(timezone);
  const rows = useMemo(() => filterOps(ops.data ?? [], config, today), [ops.data, config, today]);
  const [editing, setEditing] = useState<Operation | null>(null);
  const remove = useAppMutation({
    event: "investments.write",
    mutationFn: (op: Operation) => apiDelete<{ batchId: string }>(`/api/v2/investment-operations/${op.id}?withFunding=true`),
    undo: (_data, op) => t("deleted", { label: opLabel(op) }),
  });

  if (config.layout === "chart") {
    const bars = monthlyBars(rows, config, today, fx.rateFor);
    return (
      <div className="flex flex-col gap-2 rounded-[8px] border border-stroke-3 p-3">
        <IncomeChart rows={bars.rows.map((r) => ({ label: fmt.monthAbbr(Number(String(r.month).slice(5, 7))), values: r as unknown as Record<string, number> }))} series={bars.series} />
        <div className="flex items-center text-[11px] text-fg-4">
          <span>{t("chartCaption", { unit: fmt.currencySymbol(fx.base), range: bars.months.length ? range(bars.months[0], bars.months.at(-1)!) : "" })}</span>
          <span className={cn(MONO, "ml-auto text-[12px] font-semibold text-fg-1")}>{t("totalValue", { amount: fmt.money(bars.total, fx.base) })}</span>
        </div>
      </div>
    );
  }

  const grid = "64px minmax(0,2fr) 120px 90px 120px 28px";
  const incomeOnly = rows.length > 0 && rows.every(isIncome);
  return (
    <div className="overflow-hidden rounded-[8px] border border-stroke-3">
      <div className="grid h-[34px] items-center gap-2.5 px-3 text-[11.5px] text-fg-3" style={{ gridTemplateColumns: grid }}>
        <span>{t("columns.date")}</span>
        <span>{t("columns.asset")}</span>
        <span>{t("columns.type")}</span>
        <span className="text-right">{t("columns.quantity")}</span>
        <span className="text-right">{t("columns.amount")}</span>
        <span />
      </div>
      {rows.map((op) => (
        <div key={op.id} className="grid h-9 items-center gap-2.5 border-t border-stroke-3 px-3 text-[12.5px]" style={{ gridTemplateColumns: grid }}>
          <span className={cn(MONO, "text-[11.5px] text-fg-3")}>{fmt.date(op.date)}</span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn(MONO, "text-[12px] font-semibold")}>{op.ticker ?? "—"}</span>
            <span className="truncate text-[12px] text-fg-3">{op.name}</span>
          </span>
          <span className="truncate text-fg-2">{opLabel({ ...op, ticker: null, name: null })}</span>
          <span className={cn(MONO, "text-right")}>{op.quantity !== null ? fmt.number(op.quantity, { min: 0, max: 8 }) : ""}</span>
          <span className={cn(MONO, "text-right", (isIncome(op) || op.type === "sell") && "text-pos")}>
            {fmt.money(isIncome(op) ? op.totalAmount - op.taxWithheld : op.totalAmount, op.currency)}
          </span>
          <Menu
            trigger={
              <button type="button" aria-label={t("actions")} className="text-center text-fg-3 hover:text-fg-1">
                ⋯
              </button>
            }
            align="end"
            width={160}
          >
            <MenuItem label={t("edit")} onSelect={() => setEditing(op)} />
            <MenuItem label={t("delete")} danger onSelect={() => remove.mutate(op)} />
          </Menu>
        </div>
      ))}
      {!rows.length ? <EmptyRow>{ops.isLoading ? ti("loading") : config.filters.some((f) => f.field === "type") ? t("emptyIncome") : t("empty")}</EmptyRow> : null}
      {incomeOnly ? (
        <div className="flex h-[34px] items-center border-t border-stroke-1 bg-fill-4 px-3 text-[12px] font-semibold">
          <span>{t("total")}</span>
          <span className={cn(MONO, "ml-auto")}>{fmt.money(rows.reduce((sum, op) => sum + (op.totalAmount - op.taxWithheld) * fx.rateFor(op.currency), 0), fx.base)}</span>
          <span className="w-[38px]" />
        </div>
      ) : null}
      {editing ? <EditOperationDialog operation={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
