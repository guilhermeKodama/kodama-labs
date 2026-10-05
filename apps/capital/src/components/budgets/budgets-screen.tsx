"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRouter } from "@/i18n/navigation";
import { api, apiDelete, apiPatch, apiPost } from "@/lib/api";
import { useNames, type Names } from "@/lib/catalog";
import { dayLabel, monthKey, monthLabel, monthName, monthRange, money0, parseAmount, shiftMonth } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AppFrame, Badge, Btn, EmptyRow, Field, Kpi, KpiStrip, Modal, Panel, Segmented, SelectInput, TextInput } from "@/components/shell/chrome";

interface BudgetRow {
  id: string;
  entityId: string | null;
  categoryId: string;
  category: string;
  amount: number;
  available: number;
  spent: number;
  committed: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
  status: "over" | "ahead_of_pace" | "on_track";
}

interface MonthOverview {
  period: { year: number; month: number; daysElapsed: number; daysInMonth: number };
  summary: { totalBudget: number; totalSpent: number; totalCommitted: number; totalRoom: number; projectedTotal: number };
  budgets: BudgetRow[];
  yearlyBudgets: { id: string; entityId: string | null; categoryId: string; category: string; amount: number; spent: number }[];
  unbudgeted: { entityId: string; categoryId: string | null; category: string | null; spent: number; count: number }[];
  series: { day: number; cumulative: number; ideal: number }[];
  upcoming: { id: string; description: string; entityId: string; amount: number; currency: string; nextDueDate: string; mode: "auto" | "reminder"; kind: string }[];
}

interface YearOverview {
  year: number;
  currentMonth: number;
  categories: { categoryId: string | null; category: string | null; months: { month: number; spent: number; budget: number | null; percentUsed: number | null; isProjected: boolean; isPartial: boolean }[]; yearTotal: number; trend: number | null; overMonths: number }[];
  monthTotals: number[];
  monthBudgets: number[];
  summary: { spentToDate: number; budgetToDate: number; projectedYear: number; budgetYear: number; overBudgetMonths: number };
  insights: { categoryId: string | null; category: string | null; kind: "recurring_overrun" | "growing" | "shrinking"; overMonths: number; trend: number | null }[];
}

export function BudgetsScreen() {
  const names = useNames();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(monthKey());
  const [entity, setEntity] = useState("all");
  const [creating, setCreating] = useState<{ categoryId?: string; amount?: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const year = Number(month.slice(0, 4));
  const entityParam = entity === "all" ? "" : `&entityId=${entity}`;
  const monthly = useQuery({
    queryKey: ["budgets", "month", month, entity],
    enabled: mode === "month",
    queryFn: () => api<MonthOverview>(`/api/v2/budgets/overview?month=${month}${entityParam}`),
  });
  const yearly = useQuery({
    queryKey: ["budgets", "year", year, entity],
    enabled: mode === "year",
    queryFn: () => api<YearOverview>(`/api/v2/budgets/overview?year=${year}${entityParam}`),
  });
  const cur = names.currency;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["budgets"] });

  const updateAmount = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => apiPatch(`/api/v2/budgets/${id}`, { amount }),
    onSuccess: async () => {
      setEditing(null);
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function drill(categoryId: string | null, entityId: string | null, label: string) {
    const range = monthRange(month);
    const filters = [
      categoryId ? { field: "categoryId", op: "in", values: [categoryId] } : { field: "categoryId", op: "isNull" },
      { field: "kind", op: "in", values: ["expense"] },
      ...(entityId ? [{ field: "entityId", op: "in", values: [entityId] }] : []),
    ];
    router.push(`/transactions?drill=${encodeURIComponent(JSON.stringify({ label: `${label} · ${monthLabel(month)}`, filters, period: range }))}`);
  }

  async function payRule(id: string, skip: boolean) {
    try {
      await apiPost(`/api/v2/recurring/${id}/${skip ? "skip" : "pay"}`, {});
      await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ["ledger"] })]);
      toast.success(skip ? "Ocorrência pulada" : "Lançado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falhou");
    }
  }

  const data = monthly.data;
  const pace = data ? data.period.daysElapsed / data.period.daysInMonth : 0;
  const entityOptions = [{ v: "all", l: "Todas" }, ...names.entities.map((e) => ({ v: e.id, l: names.entity.get(e.id) ?? e.name }))];

  return (
    <AppFrame
      crumbs={["Transações", "Orçamentos"]}
      actions={
        <>
          <Segmented value={mode} options={[{ v: "month", l: "Mensal" }, { v: "year", l: "Anual" }]} onChange={setMode} />
          <span className="inline-flex h-[26px] items-center rounded-[6px] border border-neutral-300 bg-white text-[12px]">
            <button type="button" className="h-full border-r border-neutral-200 px-1.5 hover:bg-neutral-50" onClick={() => setMonth(shiftMonth(month, mode === "year" ? -12 : -1))}>‹</button>
            <span className="px-2 font-medium">{mode === "year" ? year : monthLabel(month)}</span>
            <button type="button" className="h-full border-l border-neutral-200 px-1.5 hover:bg-neutral-50" onClick={() => setMonth(shiftMonth(month, mode === "year" ? 12 : 1))}>›</button>
          </span>
          <Btn primary onClick={() => setCreating({})}>+ Orçamento</Btn>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Segmented value={entity} options={entityOptions} onChange={setEntity} />
        <span className="ml-auto text-[12px] text-neutral-400">
          {mode === "month" && data
            ? data.period.daysElapsed === 0
              ? "Mês ainda não começou"
              : data.period.daysElapsed === data.period.daysInMonth
                ? "Mês fechado"
                : `Hoje: dia ${data.period.daysElapsed} · ${Math.round(pace * 100)}% do mês`
            : mode === "year" && yearly.data
              ? `${yearly.data.currentMonth ? `jan–${monthName(yearly.data.currentMonth)} realizado` : "ano futuro"} · meses seguintes projetados pela média dos últimos 3`
              : ""}
        </span>
      </div>
      {mode === "month" ? (
        data ? (
          <>
            <KpiStrip>
              <Kpi label="Orçado" value={money0(data.summary.totalBudget, cur)} />
              <Kpi label="Gasto" value={money0(data.summary.totalSpent, cur)} sub={data.summary.totalBudget ? `${Math.round((data.summary.totalSpent / data.summary.totalBudget) * 100)}% do orçado` : undefined} />
              <Kpi label="Restante" value={money0(data.summary.totalRoom, cur)} tone={data.summary.totalRoom < 0 ? "neg" : undefined} />
              <Kpi
                label="Projeção fim do mês"
                value={money0(data.summary.projectedTotal, cur)}
                sub={data.summary.totalBudget ? (data.summary.projectedTotal > data.summary.totalBudget ? `${money0(data.summary.projectedTotal - data.summary.totalBudget, cur)} acima` : `${money0(data.summary.totalBudget - data.summary.projectedTotal, cur)} de folga`) : undefined}
                tone={data.summary.projectedTotal > data.summary.totalBudget && data.summary.totalBudget > 0 ? "warn" : undefined}
              />
            </KpiStrip>
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="overflow-hidden rounded-lg border border-neutral-200">
                  <div className="grid h-[34px] grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_96px_96px_110px_24px] items-center gap-3 px-3 text-[11.5px] text-neutral-400">
                    <span>Categoria</span>
                    <span>Gasto / orçado{data.period.daysElapsed && data.period.daysElapsed < data.period.daysInMonth ? ` · marca = hoje (dia ${data.period.daysElapsed})` : ""}</span>
                    <span className="text-right">Gasto</span>
                    <span className="text-right">Restante</span>
                    <span>Status</span>
                    <span />
                  </div>
                  {data.budgets.map((b) => {
                    const r = b.available > 0 ? b.spent / b.available : 0;
                    const status = b.isOverBudget ? { l: "Estourado", c: "text-red-600" } : b.status === "ahead_of_pace" ? { l: "Acima do ritmo", c: "text-amber-600" } : { l: "No ritmo", c: "text-neutral-400" };
                    return (
                      <div key={b.id} className="grid h-10 grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_96px_96px_110px_24px] items-center gap-3 border-t border-neutral-200 px-3 text-[12.5px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <button type="button" className="truncate text-left hover:underline" onClick={() => drill(b.categoryId, b.entityId, b.category)}>{b.category}</button>
                          <Badge>{b.entityId ? names.entity.get(b.entityId) ?? "—" : "Todas"}</Badge>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="relative h-1.5 flex-1 rounded-full bg-neutral-200">
                            <span className={cn("absolute inset-y-0 left-0 rounded-full", b.isOverBudget ? "bg-red-500" : b.status === "ahead_of_pace" ? "bg-amber-500" : "bg-neutral-600")} style={{ width: `${Math.min(r, 1) * 100}%` }} />
                            {pace > 0 && pace < 1 ? <span className="absolute -top-[3px] h-3 w-px bg-neutral-950" style={{ left: `${pace * 100}%` }} /> : null}
                          </span>
                          <span className="w-9 text-right font-mono text-[11px] text-neutral-400 tabular-nums">{Math.round(r * 100)}%</span>
                        </span>
                        <span className="text-right font-mono tabular-nums">{money0(b.spent, cur)}</span>
                        {editing?.id === b.id ? (
                          <form onSubmit={(event) => { event.preventDefault(); const amount = parseAmount(editing.value); if (amount > 0) updateAmount.mutate({ id: b.id, amount }); }}>
                            <TextInput autoFocus value={editing.value} onChange={(value) => setEditing({ id: b.id, value })} onBlur={() => setEditing(null)} mono className="w-full text-right" />
                          </form>
                        ) : (
                          <button type="button" title="Clique para mudar o valor orçado" className={cn("text-right font-mono tabular-nums hover:underline", b.remaining < 0 ? "text-red-600" : "text-neutral-600")} onClick={() => setEditing({ id: b.id, value: String(b.amount) })}>
                            {money0(b.remaining, cur)}
                          </button>
                        )}
                        <span className={cn("text-[12px]", status.c)}>{status.l}</span>
                        <button
                          type="button"
                          title="Remover orçamento"
                          className="text-neutral-300 hover:text-red-600"
                          onClick={() => {
                            if (!window.confirm(`Remover o orçamento de ${b.category}?`)) return;
                            void apiDelete(`/api/v2/budgets/${b.id}`).then(invalidate).catch((error: Error) => toast.error(error.message));
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  {!data.budgets.length ? <EmptyRow>Nenhum orçamento para este mês. Crie em “+ Orçamento” ou a partir dos gastos sem orçamento abaixo.</EmptyRow> : null}
                  {data.budgets.length ? (
                    <div className="grid h-9 grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_96px_96px_110px_24px] items-center gap-3 border-t border-neutral-300 bg-neutral-50 px-3 text-[12.5px] font-semibold">
                      <span>Total</span>
                      <span className="text-[11.5px] font-normal text-neutral-400">Orçamento zera no dia 1º · clique no restante para mudar o valor</span>
                      <span className="text-right font-mono tabular-nums">{money0(data.summary.totalSpent, cur)}</span>
                      <span className="text-right font-mono tabular-nums">{money0(data.summary.totalRoom, cur)}</span>
                      <span />
                      <span />
                    </div>
                  ) : null}
                </div>
                {data.unbudgeted.length ? (
                  <Panel title="Gastos sem orçamento" pad={false}>
                    {data.unbudgeted.slice(0, 10).map((u) => (
                      <div key={`${u.entityId}:${u.categoryId}`} className="flex h-8 items-center gap-2 border-t border-neutral-200 px-3 text-[12.5px] first:border-t-0">
                        <button type="button" className="truncate hover:underline" onClick={() => drill(u.categoryId, u.entityId, u.category ?? "Sem categoria")}>{u.category ?? "Sem categoria"}</button>
                        <Badge>{names.entity.get(u.entityId) ?? "—"}</Badge>
                        <span className="text-[11px] text-neutral-400">{u.count} lanç.</span>
                        <span className="ml-auto font-mono tabular-nums">{money0(u.spent, cur)}</span>
                        {u.categoryId ? <Btn ghost onClick={() => setCreating({ categoryId: u.categoryId!, amount: Math.ceil(u.spent / 50) * 50 })}>Orçar</Btn> : <span className="w-[52px]" />}
                      </div>
                    ))}
                  </Panel>
                ) : null}
                {data.yearlyBudgets.length ? (
                  <Panel title={`Orçamentos anuais · ${year}`} pad={false}>
                    {data.yearlyBudgets.map((b) => {
                      const r = b.amount > 0 ? b.spent / b.amount : 0;
                      return (
                        <div key={b.id} className="grid h-10 grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_96px_96px] items-center gap-3 border-t border-neutral-200 px-3 text-[12.5px] first:border-t-0">
                          <span className="flex items-center gap-1.5 truncate">{b.category}<Badge>{b.entityId ? names.entity.get(b.entityId) ?? "—" : "Todas"}</Badge></span>
                          <span className="relative h-1.5 rounded-full bg-neutral-200"><span className={cn("absolute inset-y-0 left-0 rounded-full", r > 0.9 ? "bg-amber-500" : "bg-neutral-600")} style={{ width: `${Math.min(r, 1) * 100}%` }} /></span>
                          <span className="text-right font-mono tabular-nums">{money0(b.spent, cur)}</span>
                          <span className="text-right font-mono text-neutral-500 tabular-nums">de {money0(b.amount, cur)}</span>
                        </div>
                      );
                    })}
                  </Panel>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <Panel title="Gasto acumulado vs ritmo ideal">
                  {data.series.some((p) => p.cumulative > 0) ? (
                    <div className="h-[150px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.series}>
                          <CartesianGrid stroke="#f0f0f0" vertical={false} />
                          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#a3a3a3" }} stroke="#e5e5e5" />
                          <YAxis tick={{ fontSize: 11, fill: "#a3a3a3" }} stroke="#e5e5e5" tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} width={40} />
                          <Tooltip formatter={(v) => money0(Number(v), cur)} labelFormatter={(d) => `dia ${d}`} />
                          {data.summary.totalBudget ? <ReferenceLine y={data.summary.totalBudget} stroke="#a3a3a3" strokeDasharray="4 4" label={{ value: "Orçado", fontSize: 10, fill: "#a3a3a3", position: "insideTopRight" }} /> : null}
                          <Line dataKey="ideal" name="Ritmo ideal" stroke="#d4d4d4" dot={false} strokeWidth={2} />
                          <Line dataKey="cumulative" name="Gasto acumulado" stroke="#171717" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className="py-8 text-center text-[12px] text-neutral-400">Sem gastos em categorias orçadas neste mês.</p>
                  )}
                </Panel>
                <Panel title="Contas fixas · próximos dias" pad={false}>
                  {data.upcoming.map((u) => (
                    <div key={u.id} className="flex h-8 items-center gap-2 border-t border-neutral-200 px-3 text-[12.5px] first:border-t-0">
                      <span className="w-10 font-mono text-[11.5px] text-neutral-400">{dayLabel(u.nextDueDate)}</span>
                      <span className="truncate">{u.description}</span>
                      <Badge>{names.entity.get(u.entityId) ?? "—"}</Badge>
                      <span className="ml-auto text-[11px] text-neutral-400">{u.mode === "auto" ? "auto" : "lembrete"}</span>
                      <span className="w-[76px] text-right font-mono tabular-nums">{money0(u.amount, u.currency)}</span>
                      <Btn ghost onClick={() => void payRule(u.id, false)}>Lançar</Btn>
                      <Btn ghost onClick={() => void payRule(u.id, true)}>Pular</Btn>
                    </div>
                  ))}
                  {!data.upcoming.length ? <EmptyRow>Nenhuma recorrência nos próximos dias. Marque “Recorrente” ao criar um lançamento.</EmptyRow> : null}
                </Panel>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-neutral-400">{monthly.isError ? (monthly.error as Error).message : "Carregando…"}</p>
        )
      ) : yearly.data ? (
        <AnnualView data={yearly.data} names={names} onMonth={(m) => { setMonth(`${year}-${String(m).padStart(2, "0")}`); setMode("month"); }} />
      ) : (
        <p className="text-[12.5px] text-neutral-400">{yearly.isError ? (yearly.error as Error).message : "Carregando…"}</p>
      )}
      {creating ? <BudgetDialog names={names} month={month} initial={creating} entity={entity} onClose={() => setCreating(null)} /> : null}
    </AppFrame>
  );
}

function AnnualView({ data, names, onMonth }: { data: YearOverview; names: Names; onMonth: (month: number) => void }) {
  const cur = names.currency;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const cols = "minmax(0,1.1fr) repeat(12,minmax(0,1fr)) 92px 76px";
  const chart = months.map((m, i) => ({
    name: monthName(m),
    real: m <= data.currentMonth ? data.monthTotals[i] : 0,
    proj: m > data.currentMonth ? data.monthTotals[i] : 0,
    budget: data.monthBudgets[i] || null,
  }));
  return (
    <>
      <KpiStrip>
        <Kpi label={`Gasto em ${data.year}${data.currentMonth ? ` (até ${monthName(data.currentMonth)})` : ""}`} value={money0(data.summary.spentToDate, cur)} sub={data.summary.budgetToDate ? `${Math.round((data.summary.spentToDate / data.summary.budgetToDate) * 100)}% do orçado no período` : undefined} />
        <Kpi label="Orçado no período" value={money0(data.summary.budgetToDate, cur)} />
        <Kpi
          label="Projeção do ano"
          value={money0(data.summary.projectedYear, cur)}
          sub={data.summary.budgetYear ? (data.summary.projectedYear > data.summary.budgetYear ? `${money0(data.summary.projectedYear - data.summary.budgetYear, cur)} acima de ${money0(data.summary.budgetYear, cur)}` : `${money0(data.summary.budgetYear - data.summary.projectedYear, cur)} de folga`) : undefined}
          tone={data.summary.budgetYear && data.summary.projectedYear > data.summary.budgetYear ? "warn" : undefined}
        />
        <Kpi label="Meses estourados" value={String(data.summary.overBudgetMonths)} sub="categoria × mês" />
      </KpiStrip>
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <div className="grid h-[34px] min-w-[860px] items-center gap-1 px-3 text-[11.5px] text-neutral-400" style={{ gridTemplateColumns: cols }}>
          <span>Categoria</span>
          {months.map((m) => <span key={m} className={cn("text-center", m > data.currentMonth && "text-neutral-300", m === data.currentMonth && "text-neutral-900")}>{monthName(m)}{m === data.currentMonth ? "*" : ""}</span>)}
          <span className="text-right">Ano (proj.)</span>
          <span className="text-right">Tendência</span>
        </div>
        {data.categories.map((row) => (
          <div key={row.categoryId ?? "none"} className="grid h-[34px] min-w-[860px] items-center gap-1 border-t border-neutral-200 px-3 text-[12.5px]" style={{ gridTemplateColumns: cols }}>
            <span className="truncate">{row.category ?? "Sem categoria"}</span>
            {row.months.map((c) => {
              const r = c.percentUsed != null ? c.percentUsed / 100 : null;
              return (
                <button
                  key={c.month}
                  type="button"
                  disabled={c.isProjected}
                  onClick={() => onMonth(c.month)}
                  className={cn(
                    "inline-flex h-[26px] items-center justify-center rounded font-mono text-[11px] tabular-nums",
                    c.isProjected ? "border border-dashed border-neutral-300 text-neutral-300" : r == null ? "text-neutral-500" : r > 1 ? "bg-neutral-300 font-semibold text-red-600" : r >= 0.9 ? "bg-neutral-200 text-neutral-700" : r >= 0.7 ? "bg-neutral-100 text-neutral-700" : "bg-neutral-50 text-neutral-600",
                  )}
                >
                  {r != null ? `${Math.round(r * 100)}%` : c.spent ? `${(c.spent / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}k` : "·"}
                </button>
              );
            })}
            <span className="text-right font-mono text-[12px] tabular-nums">{money0(row.yearTotal, cur)}</span>
            <span className={cn("text-right font-mono text-[11.5px]", row.trend == null ? "text-neutral-300" : row.trend > 0.1 ? "text-amber-600" : row.trend < -0.1 ? "text-emerald-700" : "text-neutral-400")}>
              {row.trend == null ? "—" : row.trend > 0.1 ? `↑ ${Math.round(row.trend * 100)}%` : row.trend < -0.1 ? `↓ ${Math.round(-row.trend * 100)}%` : "→ estável"}
            </span>
          </div>
        ))}
        {!data.categories.length ? <EmptyRow>Nenhum gasto nem orçamento neste ano.</EmptyRow> : null}
      </div>
      <p className="text-[11px] text-neutral-400">% do orçado quando há orçamento, senão o valor gasto · tracejado = projeção · * mês em andamento · clique numa célula para abrir o mês</p>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Gasto mensal vs orçado">
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart}>
                <CartesianGrid stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#a3a3a3" }} stroke="#e5e5e5" />
                <YAxis tick={{ fontSize: 11, fill: "#a3a3a3" }} stroke="#e5e5e5" tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
                <Tooltip formatter={(v) => money0(Number(v), cur)} />
                <Bar dataKey="real" name="Realizado" stackId="a" fill="#262626" />
                <Bar dataKey="proj" name="Projeção" stackId="a" fill="#d4d4d4" />
                <Line dataKey="budget" name="Orçado" stroke="#b45309" strokeDasharray="4 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Tendências do ano" pad={false}>
          {data.insights.map((ins) => (
            <div key={`${ins.categoryId}:${ins.kind}`} className="flex flex-col gap-0.5 border-t border-neutral-200 px-3 py-2.5 first:border-t-0">
              <span className="text-[12.5px] font-medium">
                {ins.category ?? "Sem categoria"}:{" "}
                {ins.kind === "recurring_overrun" ? `passou do orçado em ${ins.overMonths} meses` : ins.kind === "growing" ? `subiu ${Math.round((ins.trend ?? 0) * 100)}% no ano` : `caiu ${Math.round(-(ins.trend ?? 0) * 100)}% no ano`}
              </span>
              <span className="text-[12px] text-neutral-400">{ins.kind === "recurring_overrun" ? "Vale ajustar o valor orçado." : "Comparação dos últimos 3 meses fechados com os 3 primeiros."}</span>
            </div>
          ))}
          {!data.insights.length ? <EmptyRow>Sem estouros recorrentes nem mudanças fortes.</EmptyRow> : null}
        </Panel>
      </div>
    </>
  );
}

function BudgetDialog({ names, month, initial, entity, onClose }: { names: Names; month: string; initial: { categoryId?: string; amount?: number }; entity: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [entityId, setEntityId] = useState(entity === "all" ? "" : entity);
  const [amount, setAmount] = useState(initial.amount ? String(initial.amount) : "");
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [from, setFrom] = useState(month);
  const save = useMutation({
    mutationFn: () => {
      const value = parseAmount(amount);
      if (!categoryId) throw new Error("Escolha a categoria");
      if (!(value > 0)) throw new Error("Informe o valor");
      return apiPost("/api/v2/budgets", { categoryId, entityId: entityId || null, amount: value, period, effectiveFrom: period === "yearly" ? `${from.slice(0, 4)}-01` : from });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Orçamento criado");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Modal
      title="Novo orçamento"
      onClose={onClose}
      width={440}
      footer={<><Btn ghost onClick={onClose}>Cancelar</Btn><Btn primary disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Btn></>}
    >
      <Field label="Categoria">
        <SelectInput
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Escolha"
          options={names.categories.filter((c) => c.type === "expense" && !c.isArchived).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))}
        />
      </Field>
      <Field label="Entidade" hint="“Todas” soma os gastos de PF e PJ nessa categoria">
        <SelectInput value={entityId} onChange={setEntityId} options={[{ value: "", label: "Todas" }, ...names.entities.map((e) => ({ value: e.id, label: names.entity.get(e.id) ?? e.name }))]} />
      </Field>
      <div className="grid grid-cols-3 gap-2.5">
        <Field label="Valor"><TextInput value={amount} onChange={setAmount} mono placeholder="1.500" /></Field>
        <Field label="Período">
          <SelectInput value={period} onChange={(v) => setPeriod(v as "monthly" | "yearly")} options={[{ value: "monthly", label: "Mensal" }, { value: "yearly", label: "Anual" }]} />
        </Field>
        <Field label="A partir de"><TextInput type="month" value={from} onChange={setFrom} /></Field>
      </div>
    </Modal>
  );
}
