"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { api, apiPost } from "@/lib/api";
import { money, monthKey, signedClass } from "@/lib/money";
import { useCategories } from "@/lib/catalog";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MonthBudget {
  id: string;
  categoryId: string;
  category: string;
  entityId: string | null;
  spent: number;
  available: number;
  percentUsed: number;
  pace: { projectedTotal: number };
}

interface MonthOverview {
  summary: { totalBudget: number; totalSpent: number; totalRoom: number; projectedTotal: number };
  budgets: MonthBudget[];
  upcoming: { id: string; description: string; amount: number; nextDueDate: string }[];
}

interface YearCell {
  month: number;
  spent: number;
  percentUsed: number | null;
  isProjected: boolean;
}

interface YearOverview {
  categories: { categoryId: string | null; category: string | null; months: YearCell[] }[];
}

export function BudgetsScreen() {
  const t = useTranslations("app");
  const router = useRouter();
  const session = useSession();
  const categories = useCategories();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(monthKey());
  const [entityId, setEntityId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const currency = session.data?.baseCurrency ?? "BRL";
  const year = month.slice(0, 4);
  const query = mode === "month" ? `month=${month}` : `year=${year}`;
  const entity = entityId ? `&entityId=${entityId}` : "";
  const overview = useQuery({
    queryKey: ["budgets", mode, month, entityId],
    queryFn: () => api<MonthOverview & YearOverview>(`/api/v2/budgets/overview?${query}${entity}`),
  });
  const create = useMutation({
    mutationFn: () => apiPost("/api/v2/budgets", { categoryId, entityId: entityId || null, amount: Number(amount), period, effectiveFrom: period === "yearly" ? `${year}-01-01` : `${month}-01` }),
    onSuccess: async () => {
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success(t("saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t("budgets")}</h1>
        <Tabs value={mode} onValueChange={(value) => setMode(value as "month" | "year")}>
          <TabsList>
            <TabsTrigger value="month">{t("monthly")}</TabsTrigger>
            <TabsTrigger value="year">{t("yearly")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input type="month" className="w-40" value={month} onChange={(event) => setMonth(event.target.value)} />
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
          <option value="">{t("allEntities")}</option>
          {(session.data?.entities ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
      {mode === "month" && overview.data?.summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Kpi label={t("budgeted")} value={money(overview.data.summary.totalBudget, currency)} />
            <Kpi label={t("spent")} value={money(overview.data.summary.totalSpent, currency)} />
            <Kpi label={t("room")} value={money(overview.data.summary.totalRoom, currency)} />
            <Kpi label={t("projected")} value={money(overview.data.summary.projectedTotal, currency)} />
          </div>
          <ul className="divide-y rounded-lg border">
            {overview.data.budgets.map((row) => (
              <li key={row.id}>
                <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm" onClick={() => router.push(`/transactions?category=${row.categoryId}`)}>
                  <span className="flex-1">{row.category}</span>
                  <span className="w-24 text-right font-mono tabular-nums">{row.percentUsed.toFixed(0)}%</span>
                  <span className={`w-32 text-right font-mono tabular-nums ${signedClass(-row.spent)}`}>{money(row.spent)}</span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <span className={`block h-full ${row.percentUsed > 100 ? "bg-red-500" : "bg-foreground"}`} style={{ width: `${Math.min(row.percentUsed, 100)}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section>
            <h2 className="mb-2 text-sm font-medium">{t("fixedCosts")}</h2>
            <ul className="text-sm text-muted-foreground">
              {(overview.data.upcoming ?? []).map((item) => (
                <li key={item.id} className="flex justify-between border-b py-1">
                  <span>{item.description}</span>
                  <span className="font-mono tabular-nums">{item.nextDueDate} · {money(item.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {mode === "year" && overview.data?.categories ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left" />
                {Array.from({ length: 12 }, (_, index) => <th key={index} className="p-1 font-normal text-muted-foreground">{index + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {overview.data.categories.map((row) => (
                <tr key={row.categoryId ?? "none"}>
                  <td className="p-1 whitespace-nowrap">{row.category ?? "—"}</td>
                  {row.months.map((cell) => (
                    <td key={cell.month} className="p-1">
                      <div className="rounded px-1 py-2 text-center font-mono tabular-nums" style={{ background: heat(cell.percentUsed) }}>
                        {cell.percentUsed == null ? "·" : `${Math.round(cell.percentUsed)}%`}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
          <option value="">{t("category")}</option>
          {(categories.data ?? []).filter((item) => !item.isArchived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Input className="w-32" inputMode="decimal" placeholder={t("amount")} value={amount} onChange={(event) => setAmount(event.target.value)} required />
        <select className="h-9 rounded-md border bg-transparent px-2 text-sm" value={period} onChange={(event) => setPeriod(event.target.value as "monthly" | "yearly")}>
          <option value="monthly">{t("monthly")}</option>
          <option value="yearly">{t("yearly")}</option>
        </select>
        <Button type="submit" disabled={create.isPending}>{t("save")}</Button>
      </form>
    </div>
  );
}

function heat(percent: number | null): string {
  if (percent == null) return "transparent";
  if (percent > 100) return "color-mix(in oklch, var(--destructive) 55%, transparent)";
  return `color-mix(in oklch, var(--foreground) ${Math.min(percent, 100) / 2}%, transparent)`;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-lg tabular-nums">{value}</p>
    </div>
  );
}
