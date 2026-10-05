"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, apiDelete, apiPost } from "@/lib/api";
import { useNames } from "@/lib/catalog";
import { ASSET_CLASS_LABEL, money, money0, monthName, pct } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AppFrame, Badge, Btn, EmptyRow, Kpi, KpiStrip, MenuLabel, Panel, Popover, Segmented } from "@/components/shell/chrome";
import { HoldingSheet, OperationDialog, TargetsDialog } from "./dialogs";
import { OP_LABEL, type Allocation, type Holding, type Operation, type PortfolioSummary } from "./types";

type Scope = "all" | "PF" | "PJ";
type Tab = "class" | "broker" | "entity" | "none" | "income" | "ops";

const TABS: [Tab, string, string][] = [
  ["class", "Por classe", "▦"],
  ["broker", "Por corretora", "▦"],
  ["entity", "Por entidade", "▦"],
  ["none", "Lista", "▦"],
  ["income", "Proventos 12m", "▮"],
  ["ops", "Operações", "▦"],
];

const COLS = "minmax(0,2fr) minmax(0,1fr) minmax(0,0.9fr) 76px 120px 64px 70px";

function combine(summaries: PortfolioSummary[]): PortfolioSummary | null {
  if (!summaries.length) return null;
  if (summaries.length === 1) return summaries[0];
  const sum = (k: keyof PortfolioSummary) => summaries.reduce((s, x) => s + (x[k] as number), 0);
  const netWorth = sum("netWorth");
  const byClass = new Map<string, Allocation>();
  for (const s of summaries) {
    for (const a of s.allocation) {
      const c = byClass.get(a.assetClass) ?? { ...a, marketValue: 0, invested: 0, count: 0, share: 0 };
      c.marketValue += a.marketValue;
      c.invested += a.invested;
      c.count += a.count;
      byClass.set(a.assetClass, c);
    }
  }
  return {
    ...summaries[0],
    marketValue: sum("marketValue"),
    invested: sum("invested"),
    unrealizedGain: sum("unrealizedGain"),
    cash: sum("cash"),
    netWorth,
    income12m: sum("income12m"),
    holdingsCount: sum("holdingsCount"),
    accountsCount: sum("accountsCount"),
    allocation: [...byClass.values()].map((a) => ({ ...a, share: netWorth > 0 ? a.marketValue / netWorth : 0 })).sort((a, b) => b.marketValue - a.marketValue),
    brokers: summaries.flatMap((s) => s.brokers),
  };
}

export function PortfolioScreen() {
  const names = useNames();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<Scope>("all");
  const [tab, setTab] = useState<Tab>("class");
  const [opDialog, setOpDialog] = useState<string | null>(null);
  const [targets, setTargets] = useState(false);
  const [detail, setDetail] = useState<Holding | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [classFilter, setClassFilter] = useState<string[]>([]);
  const [brokerFilter, setBrokerFilter] = useState<string[]>([]);

  const scopeEntities = useMemo(
    () => (scope === "all" ? [] : names.entities.filter((e) => (scope === "PF" ? e.kind === "personal" : e.kind === "business"))),
    [scope, names.entities],
  );
  const summaries = useQueries({
    queries: (scope === "all" ? [undefined] : scopeEntities.map((e) => e.id)).map((entityId) => ({
      queryKey: ["portfolio", entityId ?? "all"],
      queryFn: () => api<PortfolioSummary>(`/api/v2/portfolio/summary${entityId ? `?entityId=${entityId}` : ""}`),
    })),
  });
  const summary = combine(summaries.map((q) => q.data).filter(Boolean) as PortfolioSummary[]);
  const holdingsQuery = useQuery({ queryKey: ["holdings", "all"], queryFn: async () => (await api<{ holdings: Holding[] }>("/api/v2/holdings")).holdings });
  const yearAgo = useMemo(() => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 365);
    return date.toISOString().slice(0, 10);
  }, []);
  const opsQuery = useQuery({
    queryKey: ["operations", "all"],
    enabled: tab === "income" || tab === "ops",
    queryFn: async () => (await api<{ operations: Operation[] }>("/api/v2/investment-operations")).operations,
  });
  const snapshots = useQuery({ queryKey: ["fire", "snapshots"], queryFn: () => api<{ period: number; currentInvested: number }[]>("/api/v1/fire/snapshots") });
  const thisYear = new Date().getFullYear();
  const contributions = useQueries({
    queries: [thisYear - 1, thisYear].map((year) => ({
      queryKey: ["contributions", year, "all"],
      queryFn: () => api<{ months: { month: number; net: number }[] }>(`/api/v2/contributions?year=${year}`),
    })),
  });

  const refresh = useMutation({
    mutationFn: () => apiPost<{ updated: number; totalHoldings: number; failed: number }>("/api/v2/holdings/refresh-prices", {}),
    onSuccess: async (r) => {
      await Promise.all(["portfolio", "holdings"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(`${r.updated} de ${r.totalHoldings} cotações atualizadas${r.failed ? ` · ${r.failed} sem cotação` : ""}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const snapshot = useMutation({
    mutationFn: () => apiPost("/api/v1/fire/snapshot", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fire"] }),
    onError: (error: Error) => toast.error(error.message.includes("No FIRE") ? "Defina a meta em Aportes › Independência financeira para registrar o patrimônio mensal." : error.message),
  });

  const entityIds = new Set(scopeEntities.map((e) => e.id));
  const holdings = (holdingsQuery.data ?? []).filter(
    (h) =>
      (scope === "all" || entityIds.has(h.entityId)) &&
      (!classFilter.length || classFilter.includes(h.assetClass)) &&
      (!brokerFilter.length || brokerFilter.includes(h.accountId)),
  );
  const cur = summary?.baseCurrency ?? names.currency;
  const total = summary?.netWorth ?? 0;

  const snaps = snapshots.data ?? [];
  const points = [...snaps].sort((a, b) => a.period - b.period).slice(-12);
  const flowByPeriod = new Map<number, number>();
  contributions.forEach((q, i) => q.data?.months.forEach((m) => flowByPeriod.set((thisYear - 1 + i) * 100 + m.month, m.net)));
  const series = !points.length || !summary
    ? []
    : points.map((s, index) => {
        const later = points.slice(index + 1).reduce((sum, next) => sum + (flowByPeriod.get(next.period) ?? 0), 0);
        return {
          period: s.period,
          patrimonio: s.currentInvested,
          aportado: Math.max(0, summary.invested - later),
          name: `${monthName(s.period % 100)}/${String(Math.floor(s.period / 100)).slice(2)}`,
        };
      });

  const groups = useMemo(() => {
    if (tab === "income" || tab === "ops") return [];
    const map = new Map<string, Holding[]>();
    for (const h of holdings) {
      const key = tab === "class" ? ASSET_CLASS_LABEL[h.assetClass] ?? h.assetClass : tab === "broker" ? h.accountName : tab === "entity" ? names.entity.get(h.entityId) ?? "—" : "";
      map.set(key, [...(map.get(key) ?? []), h]);
    }
    return [...map.entries()].sort((a, b) => b[1].reduce((s, h) => s + h.marketValue, 0) - a[1].reduce((s, h) => s + h.marketValue, 0));
  }, [holdings, tab, names.entity]);

  const targetOf = (label: string) => summary?.allocation.find((a) => (ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass) === label)?.target ?? null;
  const ops = (opsQuery.data ?? []).filter((op) => (tab === "income" ? (op.type === "dividend" || op.type === "yield_payment") && op.date >= yearAgo : true));
  const brokers = names.accounts.filter((a) => a.type === "brokerage");

  return (
    <AppFrame
      crumbs={["Investimentos", "Carteira"]}
      actions={
        <>
          <Btn disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? "Atualizando…" : "Atualizar cotações"}</Btn>
          <Btn onClick={() => window.dispatchEvent(new CustomEvent("capital:assistant", { detail: { attach: true, prompt: "Importe esta nota de corretagem na minha carteira." } }))}>Importar nota</Btn>
          <Btn primary onClick={() => setOpDialog("")}>+ Operação</Btn>
        </>
      }
      overlay={detail ? <HoldingSheet key={detail.id} holding={detail} names={names} onClose={() => setDetail(null)} onOperation={() => setOpDialog(detail.id)} /> : null}
    >
      <div className="flex items-center gap-2">
        <Segmented value={scope} options={[{ v: "all", l: "Consolidado" }, { v: "PF", l: "PF" }, { v: "PJ", l: "PJ" }]} onChange={setScope} />
        <span className="ml-auto text-[12px] text-neutral-400">
          {holdings.some((h) => h.lastPriceUpdate)
            ? `Cotações de ${new Date(Math.max(...holdings.filter((h) => h.lastPriceUpdate).map((h) => new Date(h.lastPriceUpdate!).getTime()))).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : "Sem cotações automáticas ainda"}
        </span>
      </div>
      <KpiStrip>
        <Kpi label="Patrimônio" value={money0(total, cur)} />
        <Kpi label="Total aportado" value={money0(summary?.invested ?? 0, cur)} />
        <Kpi
          label="Resultado"
          value={money0(summary?.unrealizedGain ?? 0, cur)}
          sub={summary?.invested ? pct(summary.unrealizedGain / summary.invested) : undefined}
          tone={(summary?.unrealizedGain ?? 0) >= 0 ? "pos" : "neg"}
        />
        <Kpi label="Proventos 12m" value={money0(summary?.income12m ?? 0, cur)} sub="dividendos + juros" />
        <Kpi label="Caixa nas corretoras" value={money0(summary?.cash ?? 0, cur)} sub={`${summary?.accountsCount ?? 0} corretoras`} />
      </KpiStrip>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Patrimônio vs total aportado" trailing={<Btn ghost disabled={snapshot.isPending} onClick={() => snapshot.mutate()}>Registrar mês atual</Btn>}>
          {series.length >= 2 ? (
            <>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series}>
                    <CartesianGrid stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#a3a3a3" }} stroke="#e5e5e5" />
                    <YAxis tick={{ fontSize: 11, fill: "#a3a3a3" }} stroke="#e5e5e5" tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} domain={["auto", "auto"]} />
                    <Tooltip formatter={(v) => money0(Number(v), cur)} />
                    <Area dataKey="patrimonio" name="Patrimônio" stroke="#0f766e" fill="#ccfbf1" fillOpacity={0.5} strokeWidth={2} />
                    <Line dataKey="aportado" name="Aportado" stroke="#a3a3a3" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-neutral-400">Patrimônio: foto mensal do plano FIRE · Aportado: custo atual menos os aportes dos meses seguintes</p>
            </>
          ) : (
            <p className="py-10 text-center text-[12px] text-neutral-400">
              O histórico começa com as fotos mensais do patrimônio{snapshots.data?.length === 1 ? " (já existe uma; a curva aparece a partir da segunda)" : ""}. Use “Registrar mês atual”.
            </p>
          )}
        </Panel>
        <Panel title="Alocação atual vs alvo" trailing={<Btn ghost onClick={() => setTargets(true)}>Editar alvos</Btn>}>
          {summary?.allocation.length ? (
            <div className="flex flex-col gap-2">
              {summary.allocation.map((a) => {
                const diff = a.target != null ? (a.share - a.target) * 100 : null;
                return (
                  <div key={a.assetClass} className="grid grid-cols-[7.5rem_1fr_44px_48px] items-center gap-3 text-[12.5px]">
                    <span className="truncate">{ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass}</span>
                    <span className="relative h-1.5 rounded-full bg-neutral-200">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-neutral-700" style={{ width: `${Math.min(a.share * 100, 100)}%` }} />
                      {a.target != null ? <span className="absolute -top-[3px] h-3 w-0.5 bg-neutral-950" style={{ left: `${Math.min(a.target * 100, 100)}%` }} /> : null}
                    </span>
                    <span className="text-right font-mono tabular-nums">{Math.round(a.share * 100)}%</span>
                    <span className={cn("text-right font-mono text-[11.5px] tabular-nums", diff == null ? "text-neutral-300" : Math.abs(diff) >= 5 ? "text-amber-600" : "text-neutral-400")}>
                      {diff == null ? "sem alvo" : `${diff >= 0 ? "+" : "−"}${Math.abs(Math.round(diff))}pp`}
                    </span>
                  </div>
                );
              })}
              <p className="mt-1 text-[11px] text-neutral-400">Barra = atual · traço = alvo · pp = diferença para o alvo</p>
            </div>
          ) : (
            <p className="py-6 text-center text-[12px] text-neutral-400">Sem posições. Registre uma operação para começar.</p>
          )}
        </Panel>
      </div>
      <div className="flex items-center gap-0.5 border-b border-neutral-200">
        {TABS.map(([id, label, glyph]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn("inline-flex h-[34px] items-center gap-1.5 border-b-2 px-2 text-[12.5px]", tab === id ? "border-neutral-950 font-medium" : "border-transparent text-neutral-400 hover:text-neutral-700")}>
            <span className="text-[11px] text-neutral-400">{glyph}</span>
            {label}
          </button>
        ))}
        <span className="relative ml-auto">
          <Btn dashed onClick={() => setFilterOpen((v) => !v)}>+ Filtro{classFilter.length + brokerFilter.length ? ` · ${classFilter.length + brokerFilter.length}` : ""}</Btn>
          <Popover open={filterOpen} onClose={() => setFilterOpen(false)} align="right" width={240}>
            <MenuLabel>Classe</MenuLabel>
            {Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => (
              <label key={value} className="flex h-7 items-center gap-2 rounded-[5px] px-2 hover:bg-neutral-100">
                <input type="checkbox" className="size-3.5 accent-neutral-900" checked={classFilter.includes(value)} onChange={(e) => setClassFilter(e.target.checked ? [...classFilter, value] : classFilter.filter((v) => v !== value))} />
                {label}
              </label>
            ))}
            <MenuLabel>Corretora</MenuLabel>
            {brokers.map((b) => (
              <label key={b.id} className="flex h-7 items-center gap-2 rounded-[5px] px-2 hover:bg-neutral-100">
                <input type="checkbox" className="size-3.5 accent-neutral-900" checked={brokerFilter.includes(b.id)} onChange={(e) => setBrokerFilter(e.target.checked ? [...brokerFilter, b.id] : brokerFilter.filter((v) => v !== b.id))} />
                {b.name}
              </label>
            ))}
            {classFilter.length + brokerFilter.length ? <div className="px-1 pt-1"><Btn ghost onClick={() => { setClassFilter([]); setBrokerFilter([]); }}>Limpar filtros</Btn></div> : null}
          </Popover>
        </span>
      </div>
      {tab === "income" || tab === "ops" ? (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <div className="grid h-[34px] grid-cols-[64px_minmax(0,2fr)_110px_90px_120px_60px] items-center gap-2.5 px-3 text-[11.5px] text-neutral-400">
            <span>Data</span><span>Ativo</span><span>Tipo</span><span className="text-right">Qtd.</span><span className="text-right">Valor</span><span />
          </div>
          {ops.map((op) => (
            <div key={op.id} className="grid h-9 grid-cols-[64px_minmax(0,2fr)_110px_90px_120px_60px] items-center gap-2.5 border-t border-neutral-200 px-3 text-[12.5px]">
              <span className="font-mono text-[11.5px] text-neutral-400">{op.date.slice(5).split("-").reverse().join("/")}/{op.date.slice(2, 4)}</span>
              <span className="flex min-w-0 gap-2"><span className="font-mono text-[12px] font-semibold">{op.ticker ?? "—"}</span><span className="truncate text-neutral-400">{op.name}</span></span>
              <span className="text-neutral-600">{OP_LABEL[op.type]}</span>
              <span className="text-right font-mono tabular-nums">{op.quantity ?? ""}</span>
              <span className={cn("text-right font-mono tabular-nums", (op.type === "dividend" || op.type === "yield_payment" || op.type === "sell") && "text-emerald-700")}>{money(op.totalAmount, cur)}</span>
              <button
                type="button"
                className="text-right text-[11px] text-neutral-400 hover:text-red-600"
                onClick={() => {
                  if (!window.confirm("Excluir esta operação e o lançamento de caixa dela?")) return;
                  void apiDelete(`/api/v2/investment-operations/${op.id}`)
                    .then(() => Promise.all(["operations", "portfolio", "holdings", "ledger"].map((key) => queryClient.invalidateQueries({ queryKey: [key] }))))
                    .catch((error: Error) => toast.error(error.message));
                }}
              >
                excluir
              </button>
            </div>
          ))}
          {!ops.length ? <EmptyRow>{opsQuery.isFetching ? "Carregando…" : tab === "income" ? "Nenhum provento nos últimos 12 meses." : "Nenhuma operação registrada."}</EmptyRow> : null}
          {tab === "income" && ops.length ? (
            <div className="flex h-[34px] items-center border-t border-neutral-300 bg-neutral-50 px-3 text-[12px] font-semibold">
              <span>Total 12m</span>
              <span className="ml-auto font-mono tabular-nums">{money(ops.reduce((s, op) => s + op.totalAmount, 0), cur)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <div className="grid h-[34px] items-center gap-2.5 px-3 text-[11.5px] text-neutral-400" style={{ gridTemplateColumns: COLS }}>
            <span>Ativo</span><span>Classe</span><span>Corretora</span><span>Entidade</span>
            <span className="text-right">Valor</span><span className="text-right">% cart.</span><span className="text-right">Result.</span>
          </div>
          {groups.map(([key, items]) => {
            const value = items.reduce((s, h) => s + h.marketValue, 0);
            const target = tab === "class" ? targetOf(key) : null;
            return (
              <div key={key || "all"}>
                {key ? (
                  <div className="flex h-8 items-center gap-2 border-t border-neutral-200 bg-neutral-50 px-3 text-[12px]">
                    <span className="text-neutral-400">▾</span>
                    <span className="font-semibold">{key}</span>
                    <span className="text-neutral-400">{items.length}</span>
                    {target != null ? <span className="ml-auto text-[11.5px] text-neutral-400">alvo {pct(target, 0)}</span> : <span className="ml-auto" />}
                    <span className="w-[120px] text-right font-mono font-semibold tabular-nums">{money0(value, cur)}</span>
                    <span className="w-[64px] text-right font-mono text-neutral-500 tabular-nums">{total ? pct(value / total, 0) : ""}</span>
                    <span className="w-[70px]" />
                  </div>
                ) : null}
                {items.map((h) => (
                  <button key={h.id} type="button" onClick={() => setDetail(h)} className="grid h-9 w-full items-center gap-2.5 border-t border-neutral-200 px-3 text-left text-[12.5px] hover:bg-neutral-50" style={{ gridTemplateColumns: COLS }}>
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-[12px] font-semibold">{h.ticker ?? "—"}</span>
                      <span className="truncate text-[12px] text-neutral-400">{h.name}</span>
                    </span>
                    <span className="truncate text-neutral-600">{ASSET_CLASS_LABEL[h.assetClass] ?? h.assetClass}</span>
                    <span className="truncate text-neutral-600">{h.accountName}</span>
                    <span className="min-w-0"><Badge>{names.entity.get(h.entityId) ?? "—"}</Badge></span>
                    <span className="text-right font-mono tabular-nums">{money0(h.marketValue, h.currency)}</span>
                    <span className="text-right font-mono text-neutral-500 tabular-nums">{total ? pct(h.marketValue / total) : ""}</span>
                    <span className={cn("text-right font-mono tabular-nums", h.unrealizedGainPercent == null || h.unrealizedGainPercent === 0 ? "text-neutral-400" : h.unrealizedGainPercent > 0 ? "text-emerald-700" : "text-red-600")}>
                      {h.unrealizedGainPercent == null || h.unrealizedGainPercent === 0 ? "—" : `${h.unrealizedGainPercent > 0 ? "+" : "−"}${Math.abs(h.unrealizedGainPercent * 100).toFixed(1)}%`}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          {!groups.length ? <EmptyRow>{holdingsQuery.isFetching ? "Carregando…" : "Nenhuma posição neste recorte."}</EmptyRow> : null}
        </div>
      )}
      {opDialog !== null ? <OperationDialog names={names} holdings={holdingsQuery.data ?? []} initialHoldingId={opDialog || undefined} onClose={() => setOpDialog(null)} /> : null}
      {targets ? <TargetsDialog onClose={() => setTargets(false)} /> : null}
    </AppFrame>
  );
}
