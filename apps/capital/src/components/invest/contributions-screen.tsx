"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPost } from "@/lib/api";
import { money, todayIso } from "@/lib/money";
import { useAccounts } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Contributions {
  months: { month: number; deposits: number; withdrawals: number; net: number }[];
  totalNet: number;
  averageMonthly: number;
}

interface FireSummary {
  hasGoal: boolean;
  baseCurrency: string;
  goal: { targetMonthlyIncome: number } | null;
  suggestedDefaults: { suggestedMonthlyContribution: number; currentMonthlyExpenses: number };
  projection: { monthsToFire: number | null; fireNumber: number } | null;
}

interface Suggestion {
  classes: { assetClass: string; amount: number; target: number; afterShare: number }[];
}

export function ContributionsScreen() {
  const t = useTranslations("app");
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();
  const flows = useQuery({ queryKey: ["contributions", year], queryFn: () => api<Contributions>(`/api/v2/contributions?year=${year}`) });
  const fire = useQuery({ queryKey: ["fire"], queryFn: () => api<FireSummary>("/api/v1/fire/summary") });
  const [amount, setAmount] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [brokerId, setBrokerId] = useState("");
  const [fromId, setFromId] = useState("");
  const brokers = (accounts.data ?? []).filter((account) => account.type === "brokerage" && !account.archivedAt);
  const sources = (accounts.data ?? []).filter((account) => account.type !== "brokerage" && !account.archivedAt);

  const suggest = useMutation({
    mutationFn: () => apiPost<Suggestion>("/api/v2/portfolio/rebalance-suggestion", { amount: Number(amount), mode: "class" }),
    onSuccess: setSuggestion,
    onError: (error: Error) => toast.error(error.message),
  });
  const deposit = useMutation({
    mutationFn: () => apiPost("/api/v2/brokerage-cash", { accountId: brokerId, counterpartAccountId: fromId, direction: "deposit", amount: Number(amount), date: todayIso() }),
    onSuccess: async () => {
      toast.success(t("saved"));
      await queryClient.invalidateQueries({ queryKey: ["contributions"] });
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const goal = fire.data?.suggestedDefaults.suggestedMonthlyContribution ?? fire.data?.goal?.targetMonthlyIncome;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">{t("contributions")}</h1>
      {fire.data ? (
        <section className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">{t("fireGoal")}</p>
          <p className="font-mono text-2xl tabular-nums">{goal != null ? money(goal, fire.data.baseCurrency) : t("none")}</p>
          {fire.data.projection?.monthsToFire != null ? <p className="text-sm text-muted-foreground">{t("monthsToFire", { count: fire.data.projection.monthsToFire })}</p> : null}
        </section>
      ) : null}
      <div className="grid grid-cols-6 gap-2 text-xs sm:grid-cols-12">
        {(flows.data?.months ?? []).map((item) => (
          <div key={item.month} className="rounded-md border p-2">
            <div className="text-muted-foreground">{item.month}</div>
            <div className="font-mono tabular-nums">{money(item.net)}</div>
          </div>
        ))}
      </div>
      <p className="text-sm">{t("yearNet")} <span className="font-mono tabular-nums">{money(flows.data?.totalNet ?? 0)}</span></p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); suggest.mutate(); }}>
        <Input className="w-36" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={t("amount")} />
        <Button type="submit">{t("suggest")}</Button>
      </form>
      {suggestion ? (
        <ul className="text-sm">
          {suggestion.classes.filter((item) => item.amount > 0).map((item) => (
            <li key={item.assetClass} className="flex justify-between border-b py-1">
              <span>{item.assetClass}</span>
              <span className="font-mono tabular-nums">{money(item.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); deposit.mutate(); }}>
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={fromId} onChange={(event) => setFromId(event.target.value)} required>
          <option value="">{t("fromAccount")}</option>
          {sources.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={brokerId} onChange={(event) => setBrokerId(event.target.value)} required>
          <option value="">{t("broker")}</option>
          {brokers.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <Button type="submit" disabled={deposit.isPending}>{t("contribute")}</Button>
      </form>
    </div>
  );
}
