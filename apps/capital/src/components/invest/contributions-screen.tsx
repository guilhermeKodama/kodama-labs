"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPost } from "@/lib/api";
import { money, todayIso } from "@/lib/money";
import { useAccounts } from "@/lib/catalog";
import { AppFrame, Btn, Kpi, KpiStrip, Panel } from "@/components/shell/chrome";

interface Contributions {
  months: { month: number; net: number }[];
  totalNet: number;
}

interface FireSummary {
  baseCurrency: string;
  suggestedDefaults: { suggestedMonthlyContribution: number };
  projection: { monthsToFire: number | null } | null;
}

interface Suggestion {
  classes: { assetClass: string; amount: number }[];
}

export function ContributionsScreen() {
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();
  const flows = useQuery({ queryKey: ["contributions", year], queryFn: () => api<Contributions>(`/api/v2/contributions?year=${year}`) });
  const fire = useQuery({ queryKey: ["fire"], queryFn: () => api<FireSummary>("/api/v1/fire/summary") });
  const [amount, setAmount] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [fromId, setFromId] = useState("");
  const [brokerId, setBrokerId] = useState("");
  const currency = fire.data?.baseCurrency ?? "BRL";
  const sources = (accounts.data ?? []).filter((account) => account.type !== "brokerage" && !account.archivedAt);
  const brokers = (accounts.data ?? []).filter((account) => account.type === "brokerage" && !account.archivedAt);
  const suggest = useMutation({
    mutationFn: () => apiPost<Suggestion>("/api/v2/portfolio/rebalance-suggestion", { amount: Number(amount), mode: "class" }),
    onSuccess: setSuggestion,
    onError: (error: Error) => toast.error(error.message),
  });
  const deposit = useMutation({
    mutationFn: () => apiPost("/api/v2/brokerage-cash", { accountId: brokerId, counterpartAccountId: fromId, direction: "deposit", amount: Number(amount), date: todayIso() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contributions"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppFrame crumbs={["Investimentos", "Aportes"]} actions={<Btn primary onClick={() => deposit.mutate()}>+ Aporte</Btn>}>
      <KpiStrip>
        <Kpi label="Meta mensal" value={money(fire.data?.suggestedDefaults.suggestedMonthlyContribution ?? 0, currency)} sub={fire.data?.projection?.monthsToFire != null ? `${fire.data.projection.monthsToFire} meses até a meta` : undefined} />
        <Kpi label="Líquido no ano" value={money(flows.data?.totalNet ?? 0, currency)} />
      </KpiStrip>
      <Panel title="Histórico">
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {(flows.data?.months ?? []).map((item) => (
            <div key={item.month} className="rounded-[6px] border border-neutral-200 p-2">
              <div className="text-[11px] text-neutral-400">{item.month}</div>
              <div className="font-mono text-[12px] tabular-nums">{money(item.net, currency)}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Onde aportar">
        <form className="mb-3 flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); suggest.mutate(); }}>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Valor" className="h-[26px] w-28 rounded-[6px] border border-neutral-300 px-2 text-[12px]" />
          <Btn type="submit">Sugerir</Btn>
        </form>
        {(suggestion?.classes ?? []).filter((item) => item.amount > 0).map((item) => (
          <div key={item.assetClass} className="flex h-8 items-center justify-between border-t border-neutral-200 text-[12.5px]">
            <span>{item.assetClass}</span>
            <span className="font-mono tabular-nums">{money(item.amount, currency)}</span>
          </div>
        ))}
        <form className="mt-3 flex flex-wrap items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); deposit.mutate(); }}>
          <select value={fromId} onChange={(event) => setFromId(event.target.value)} className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required>
            <option value="">Conta</option>
            {sources.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <select value={brokerId} onChange={(event) => setBrokerId(event.target.value)} className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required>
            <option value="">Corretora</option>
            {brokers.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <Btn primary type="submit">Aportar</Btn>
        </form>
      </Panel>
    </AppFrame>
  );
}
