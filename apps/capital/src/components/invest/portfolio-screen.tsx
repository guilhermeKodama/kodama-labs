"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import { useSession } from "@/lib/session";
import { AppFrame, Btn, Kpi, KpiStrip, Panel, Segmented } from "@/components/shell/chrome";

interface Allocation {
  assetClass: string;
  marketValue: number;
  share: number;
  target: number | null;
}

interface Summary {
  baseCurrency: string;
  marketValue: number;
  invested: number;
  unrealizedGain: number;
  cash: number;
  netWorth: number;
  income12m: number;
  allocation: Allocation[];
}

interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  assetClass: string;
  accountName: string;
  entityId: string;
  marketValue: number;
  unrealizedGainPercent: number | null;
}

const TABS = [
  ["class", "Por classe"],
  ["broker", "Por corretora"],
  ["entity", "Por entidade"],
  ["none", "Lista"],
  ["income", "Proventos 12m"],
  ["ops", "Operações"],
] as const;

export function PortfolioScreen() {
  const session = useSession();
  const [scope, setScope] = useState("all");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("class");
  const entities = useMemo(() => session.data?.entities ?? [], [session.data?.entities]);
  const personal = entities.find((entity) => entity.kind === "personal");
  const entityId = scope === "PF" ? personal?.id : scope === "PJ" ? entities.find((entity) => entity.kind === "business")?.id : undefined;
  const summary = useQuery({
    queryKey: ["portfolio", entityId ?? "all"],
    queryFn: () => api<Summary>(`/api/v2/portfolio/summary${entityId ? `?entityId=${entityId}` : ""}`),
  });
  const holdings = useQuery({
    queryKey: ["holdings", entityId ?? "all"],
    queryFn: async () => (await api<{ holdings: Holding[] }>(`/api/v2/holdings${entityId ? `?entityId=${entityId}` : ""}`)).holdings,
  });
  const currency = summary.data?.baseCurrency ?? "BRL";
  const names = useMemo(() => new Map(entities.map((entity) => [entity.id, entity.kind === "personal" ? "PF" : entity.name])), [entities]);
  const rows = holdings.data ?? [];
  const total = summary.data?.netWorth ?? rows.reduce((sum, row) => sum + row.marketValue, 0);
  const groups = new Map<string, Holding[]>();
  for (const row of rows) {
    const key = tab === "broker" ? row.accountName : tab === "entity" ? names.get(row.entityId) ?? "" : tab === "none" ? "" : row.assetClass;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return (
    <AppFrame crumbs={["Investimentos", "Carteira"]} actions={<><Btn>Atualizar cotações</Btn><Btn>Importar nota</Btn><Btn primary>+ Operação</Btn></>}>
      <div className="flex items-center gap-2">
        <Segmented
          value={scope}
          options={[{ v: "all", l: "Consolidado" }, { v: "PF", l: "PF" }, { v: "PJ", l: "PJ" }]}
          onChange={setScope}
        />
        <span className="ml-auto text-[12px] text-neutral-400">Cotações de hoje</span>
      </div>
      <KpiStrip>
        <Kpi label="Patrimônio" value={money(summary.data?.netWorth ?? 0, currency)} />
        <Kpi label="Total aportado" value={money(summary.data?.invested ?? 0, currency)} />
        <Kpi label="Resultado" value={money(summary.data?.unrealizedGain ?? 0, currency)} tone={(summary.data?.unrealizedGain ?? 0) >= 0 ? "pos" : "neg"} />
        <Kpi label="Proventos 12m" value={money(summary.data?.income12m ?? 0, currency)} sub="dividendos + juros" />
      </KpiStrip>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Patrimônio vs total aportado">
          <p className="py-10 text-center text-[12px] text-neutral-400">Sem série histórica nesta conta.</p>
        </Panel>
        <Panel title="Alocação atual vs alvo">
          <div className="flex flex-col gap-2">
            {(summary.data?.allocation ?? []).map((item) => (
              <div key={item.assetClass} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-[12.5px]">
                <span>{item.assetClass}</span>
                <span className="relative h-1.5 rounded-full bg-neutral-200">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-neutral-800" style={{ width: `${Math.min(item.share * 100, 100)}%` }} />
                  {item.target != null ? <span className="absolute -top-0.5 h-2.5 w-px bg-neutral-950" style={{ left: `${Math.min(item.target * 100, 100)}%` }} /> : null}
                </span>
                <span className="font-mono text-[12px] tabular-nums">{(item.share * 100).toFixed(0)}%{item.target != null ? ` / ${(item.target * 100).toFixed(0)}%` : ""}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-neutral-400">Barra = atual · traço = alvo</p>
        </Panel>
      </div>
      <div className="flex items-center gap-0.5 border-b border-neutral-200">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`inline-flex h-[34px] items-center px-2 text-[12.5px] ${tab === id ? "border-b-2 border-neutral-950 font-medium" : "text-neutral-400"}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto"><Btn dashed>+ Filtro</Btn></span>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <div className="grid h-[34px] grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.9fr)_76px_110px_60px_70px] items-center gap-2.5 px-3 text-[11.5px] text-neutral-400">
          <span>Ativo</span><span>Classe</span><span>Corretora</span><span>Entidade</span>
          <span className="text-right">Valor</span><span className="text-right">% cart.</span><span className="text-right">Result.</span>
        </div>
        {[...groups.entries()].map(([key, items]) => {
          const value = items.reduce((sum, item) => sum + item.marketValue, 0);
          return (
            <div key={key || "all"}>
              {key ? (
                <div className="flex h-8 items-center gap-2 border-t border-neutral-200 bg-neutral-50 px-3 text-[12px]">
                  <span className="font-semibold">{key}</span>
                  <span className="text-neutral-400">{items.length}</span>
                  <span className="ml-auto w-[110px] text-right font-mono font-semibold tabular-nums">{money(value, currency)}</span>
                  <span className="w-[60px] text-right font-mono text-neutral-500 tabular-nums">{total ? `${((value / total) * 100).toFixed(0)}%` : ""}</span>
                  <span className="w-[70px]" />
                </div>
              ) : null}
              {items.map((item) => (
                <div key={item.id} className="grid h-9 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.9fr)_76px_110px_60px_70px] items-center gap-2.5 border-t border-neutral-200 px-3 text-[12.5px]">
                  <span className="flex min-w-0 gap-2"><span className="font-mono text-[12px] font-semibold">{item.ticker ?? "—"}</span><span className="truncate text-[12px] text-neutral-400">{item.name}</span></span>
                  <span className="text-neutral-600">{item.assetClass}</span>
                  <span className="text-neutral-600">{item.accountName}</span>
                  <span><span className="inline-flex h-[18px] items-center rounded border border-neutral-200 px-1.5 text-[11px]">{names.get(item.entityId)}</span></span>
                  <span className="text-right font-mono tabular-nums">{money(item.marketValue, currency)}</span>
                  <span className="text-right font-mono text-neutral-500 tabular-nums">{total ? `${((item.marketValue / total) * 100).toFixed(1)}%` : ""}</span>
                  <span className={`text-right font-mono tabular-nums ${item.unrealizedGainPercent == null ? "text-neutral-400" : item.unrealizedGainPercent >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {item.unrealizedGainPercent == null ? "—" : `${item.unrealizedGainPercent >= 0 ? "+" : "−"}${Math.abs(item.unrealizedGainPercent * 100).toFixed(1)}%`}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </AppFrame>
  );
}
