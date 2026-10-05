"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { api, apiPost } from "@/lib/api/client";
import { money, monthKey } from "@/lib/money";
import { useCategories } from "@/lib/api/catalog";
import { useSession } from "@/lib/api/session";
import { HEAT_OVER, heatColor } from "@/lib/theme/chart-colors";
import { AppFrame, Btn, Kpi, KpiStrip, Segmented } from "@/components/shell/chrome";

interface MonthOverview {
  summary: { totalBudget: number; totalSpent: number; totalRoom: number; projectedTotal: number };
  budgets: { id: string; categoryId: string; category: string; spent: number; percentUsed: number }[];
  upcoming: { id: string; description: string; amount: number; nextDueDate: string }[];
}

interface YearOverview {
  categories: { categoryId: string | null; category: string | null; months: { month: number; percentUsed: number | null }[] }[];
}

export function BudgetsScreen() {
  const router = useRouter();
  const session = useSession();
  const categories = useCategories();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState("month");
  const [month, setMonth] = useState(monthKey());
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const currency = session.data?.baseCurrency ?? "BRL";
  const year = month.slice(0, 4);
  const overview = useQuery({
    queryKey: ["budgets", mode, month],
    queryFn: () => api<MonthOverview & YearOverview>(`/api/v2/budgets/overview?${mode === "month" ? `month=${month}` : `year=${year}`}`),
  });
  const create = useMutation({
    mutationFn: () => apiPost("/api/v2/budgets", { categoryId, amount: Number(amount), period: mode === "year" ? "yearly" : "monthly", effectiveFrom: mode === "year" ? `${year}-01-01` : `${month}-01` }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budgets"] }),
  });

  return (
    <AppFrame crumbs={["Transações", "Orçamentos"]} actions={<Btn primary onClick={() => create.mutate()}>+ Orçamento</Btn>}>
      <div className="flex items-center gap-2">
        <Segmented value={mode} options={[{ v: "month", l: "Mês" }, { v: "year", l: "Ano" }]} onChange={setMode} />
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-[26px] rounded-[6px] border border-stroke-1 px-2 text-[12px]" />
      </div>
      {mode === "month" && overview.data?.summary ? (
        <>
          <KpiStrip>
            <Kpi label="Orçado" value={money(overview.data.summary.totalBudget, currency)} />
            <Kpi label="Gasto" value={money(overview.data.summary.totalSpent, currency)} />
            <Kpi label="Folga" value={money(overview.data.summary.totalRoom, currency)} />
            <Kpi label="Projeção" value={money(overview.data.summary.projectedTotal, currency)} />
          </KpiStrip>
          <div className="overflow-hidden rounded-lg border border-stroke-3">
            {overview.data.budgets.map((row) => (
              <button key={row.id} type="button" className="grid h-9 w-full grid-cols-[1fr_80px_120px] items-center border-t border-stroke-3 px-3 text-left text-[12.5px] first:border-t-0" onClick={() => router.push(`/transactions?category=${row.categoryId}`)}>
                <span>{row.category}</span>
                <span className="text-right font-mono tabular-nums">{row.percentUsed.toFixed(0)}%</span>
                <span className="text-right font-mono tabular-nums">{money(row.spent, currency)}</span>
              </button>
            ))}
          </div>
          <section className="overflow-hidden rounded-lg border border-stroke-3">
            <header className="flex h-9 items-center px-3 text-[12.5px] font-medium">Contas fixas</header>
            {(overview.data.upcoming ?? []).map((item) => (
              <div key={item.id} className="flex h-8 items-center justify-between border-t border-stroke-3 px-3 text-[12.5px]">
                <span>{item.description}</span>
                <span className="font-mono tabular-nums">{item.nextDueDate} · {money(item.amount, currency)}</span>
              </div>
            ))}
          </section>
        </>
      ) : null}
      {mode === "year" && overview.data?.categories ? (
        <div className="overflow-hidden rounded-lg border border-stroke-3">
          {overview.data.categories.map((row) => (
            <div key={row.categoryId ?? "none"} className="grid grid-cols-[8rem_repeat(12,minmax(0,1fr))] items-center border-t border-stroke-3 px-2 first:border-t-0">
              <span className="truncate py-1 text-[12px]">{row.category ?? "—"}</span>
              {row.months.map((cell) => (
                <span key={cell.month} className="m-0.5 rounded py-2 text-center font-mono text-[10px] tabular-nums" style={{ background: heat(cell.percentUsed) }}>
                  {cell.percentUsed == null ? "·" : `${Math.round(cell.percentUsed)}%`}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <form className="flex items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-[26px] rounded-[6px] border border-stroke-1 px-2 text-[12px]" required>
          <option value="">Categoria</option>
          {(categories.data ?? []).filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Valor" className="h-[26px] w-28 rounded-[6px] border border-stroke-1 px-2 text-[12px]" required />
        <Btn primary type="submit">Salvar</Btn>
      </form>
    </AppFrame>
  );
}

function heat(percent: number | null): string {
  if (percent == null) return "transparent";
  if (percent > 100) return HEAT_OVER;
  const alpha = Math.min(percent, 100) / 100;
  return heatColor(alpha * 0.35);
}
