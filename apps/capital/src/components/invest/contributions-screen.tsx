"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LedgerQueryResult } from "@capital/server/modules/ledger/contracts";
import { useRouter } from "@/i18n/navigation";
import { api, apiPost, apiPut } from "@/lib/api/client";
import { useNames, type Names } from "@/lib/api/catalog";
import { ASSET_CLASS_LABEL, dayLabel, money0, monthName, parseAmount, pct, todayIso } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CHART, CHART_AXIS, CHART_SERIES } from "@/lib/theme/chart-colors";
import { Btn, EmptyRow, Field, Kpi, KpiStrip, Modal, Panel, Segmented, SelectInput, TextInput } from "@/components/shell/chrome";
import { Page } from "@/components/shell/page";
import { TargetsDialog } from "./dialogs";

interface Contributions {
  year: number;
  months: { month: number; deposits: number; withdrawals: number; net: number; byAssetClass: Record<string, number> }[];
  totalNet: number;
  averageMonthly: number;
}

interface FireGoal {
  name: string | null;
  targetMonthlyIncome: number;
  safeWithdrawalRate: number;
  nominalAnnualReturn: number;
  annualInflation: number;
  monthlyIncome: number | null;
  planningMode: string;
  targetYear: number | null;
  phaseProfile: string;
  phases: { fromMonth: number; toMonth: number | null; monthlyContribution: number; label?: string }[];
  currentAge: number | null;
  [key: string]: unknown;
}

interface FireSummary {
  hasGoal: boolean;
  baseCurrency: string;
  goal: FireGoal | null;
  suggestedDefaults: { currentInvested: number; currentMonthlyExpenses: number; suggestedMonthlyContribution: number };
  result: { fireNumber: number; currentInvested: number; progress: number; reached: boolean; monthsToFire: number | null; projectedFireDate: string | null; savingsRate: number | null } | null;
  requiredContribution: { baseContribution: number | null } | null;
}

interface Suggestion {
  amount: number;
  classes?: { assetClass: string; currentShare: number; target: number; amount: number; afterShare: number }[];
  assets?: { holdingId: string; ticker: string | null; name: string; assetClass: string; amount: number; approxQuantity: number | null }[];
}

const CLASS_COLORS = [CHART.bar, ...CHART_SERIES.slice(1, 8), CHART_SERIES[9]];

export function ContributionsScreen() {
  const names = useNames();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [amountText, setAmountText] = useState("");
  const [mode, setMode] = useState<"class" | "asset">("class");
  const [registering, setRegistering] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const cur = names.currency;
  const flows = useQuery({ queryKey: ["contributions", year, "all"], queryFn: () => api<Contributions>(`/api/v2/contributions?year=${year}`) });
  const fire = useQuery({ queryKey: ["fire", "summary"], queryFn: () => api<FireSummary>("/api/v1/fire/summary") });
  const history = useQuery({
    queryKey: ["ledger", "contributions", year],
    queryFn: () =>
      apiPost<LedgerQueryResult>("/api/v2/ledger/query", {
        period: { from: `${year}-01-01`, to: `${year}-12-31` },
        filters: [
          { field: "transferDirection", op: "in", values: ["investment_deposit", "investment_withdrawal"] },
          { field: "accountType", op: "in", values: ["brokerage"] },
        ],
        sort: [{ field: "date", dir: "desc" }],
        page: { limit: 100 },
      }),
  });
  const amount = parseAmount(amountText);
  const suggestion = useQuery({
    queryKey: ["rebalance", amount, mode],
    enabled: Number.isFinite(amount) && amount > 0,
    retry: false,
    queryFn: () => apiPost<Suggestion>("/api/v2/portfolio/rebalance-suggestion", { amount, mode }),
  });

  const goal = fire.data?.goal;
  const goalMonthly = goal?.phases[0]?.monthlyContribution ?? fire.data?.requiredContribution?.baseContribution ?? null;
  const goalLabel = goal ? "Meta (plano FIRE)" : "Sugerido pelo histórico";
  const target = goalMonthly ?? fire.data?.suggestedDefaults.suggestedMonthlyContribution ?? 0;
  const nowMonth = new Date().getFullYear() === year ? new Date().getMonth() + 1 : 12;
  const thisMonth = flows.data?.months.find((m) => m.month === nowMonth)?.net ?? 0;
  const classes = Array.from(new Set((flows.data?.months ?? []).flatMap((m) => Object.keys(m.byAssetClass))));
  const chart = (flows.data?.months ?? []).map((m) => ({
    name: monthName(m.month),
    aportes: m.net,
    ...Object.fromEntries(classes.map((c) => [c, m.byAssetClass[c] ?? 0])),
  }));
  const months12 = (flows.data?.months ?? []).filter((m) => m.month <= nowMonth);
  const total12 = months12.reduce((s, m) => s + m.net, 0);

  return (
    <Page
      crumbs={["Investimentos", "Aportes"]}
      actions={
        <>
          <span className="inline-flex h-[26px] items-center rounded-[6px] border border-stroke-1 bg-editor text-[12px]">
            <button type="button" className="h-full border-r border-stroke-3 px-1.5 hover:bg-fill-4" onClick={() => setYear(year - 1)}>‹</button>
            <span className="px-2 font-medium">{year}</span>
            <button type="button" className="h-full border-l border-stroke-3 px-1.5 hover:bg-fill-4 disabled:text-fg-4" disabled={year >= new Date().getFullYear()} onClick={() => setYear(year + 1)}>›</button>
          </span>
          <Btn primary onClick={() => setRegistering(true)}>+ Registrar aporte</Btn>
        </>
      }
    >
      <KpiStrip>
        <Kpi
          label={`Aportado em ${monthName(nowMonth)}/${String(year).slice(2)}`}
          value={money0(thisMonth, cur)}
          sub={target ? `${goalLabel}: ${money0(target, cur)}` : undefined}
          tone={target ? (thisMonth >= target ? "pos" : "warn") : undefined}
        />
        <Kpi label={`Média ${year}`} value={money0(months12.length ? total12 / months12.length : 0, cur)} />
        <Kpi label={`Total ${year}`} value={money0(flows.data?.totalNet ?? 0, cur)} />
        <Kpi label="Taxa de poupança" value={fire.data?.result?.savingsRate != null ? pct(fire.data.result.savingsRate, 0) : "—"} sub="aportes / renda" />
      </KpiStrip>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title={classes.length ? "Aportes por mês e classe" : "Aportes por mês"}>
          {(flows.data?.months ?? []).some((m) => m.net !== 0 || classes.some((c) => m.byAssetClass[c])) ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="name" tick={CHART_AXIS.tick} stroke={CHART.axis} />
                  <YAxis tick={CHART_AXIS.tick} stroke={CHART.axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
                  <Tooltip formatter={(v, n) => [money0(Number(v), cur), ASSET_CLASS_LABEL[String(n)] ?? (n === "aportes" ? "Aporte líquido" : String(n))]} />
                  {target ? <ReferenceLine y={target} stroke={CHART.warn} strokeDasharray="4 4" label={{ value: "Meta", fontSize: 10, fill: CHART.warn, position: "insideTopRight" }} /> : null}
                  {classes.length ? (
                    <>
                      {classes.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={CLASS_COLORS[i % CLASS_COLORS.length]} />)}
                      <Legend formatter={(v) => ASSET_CLASS_LABEL[String(v)] ?? String(v)} wrapperStyle={{ fontSize: 11 }} />
                    </>
                  ) : (
                    <Bar dataKey="aportes" fill={CHART.bar} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-[12px] text-fg-3">Nenhum aporte em {year}. Registre uma transferência conta → corretora.</p>
          )}
          <p className="text-[11px] text-fg-3">{classes.length ? "Barras = compras por classe" : "Barras = depósitos menos resgates nas corretoras"} · linha = meta mensal</p>
        </Panel>
        <Panel title="Onde aportar este mês" trailing={<Btn ghost onClick={() => setTargetsOpen(true)}>Editar alvos</Btn>}>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-fg-3">Vou aportar R$</span>
              <TextInput value={amountText} onChange={setAmountText} mono className="w-[110px]" placeholder={target ? String(Math.round(target)) : "1.000"} />
              <span className="ml-auto"><Segmented value={mode} options={[{ v: "class", l: "Por classe" }, { v: "asset", l: "Por ativo" }]} onChange={setMode} /></span>
            </div>
            {suggestion.isError ? (
              <p className="text-[12px] text-warn-strong">
                {(suggestion.error as Error).message.includes("targets") ? (
                  <>Defina a alocação alvo primeiro. <button type="button" className="underline" onClick={() => setTargetsOpen(true)}>Definir alvos</button></>
                ) : (
                  (suggestion.error as Error).message
                )}
              </p>
            ) : null}
            {suggestion.data?.classes && mode === "class" ? (
              <table className="w-full text-[12.5px]">
                <thead className="text-[11.5px] text-fg-3">
                  <tr className="h-7"><th className="text-left font-normal">Classe</th><th className="text-right font-normal">Atual</th><th className="text-right font-normal">Alvo</th><th className="text-right font-normal">Aportar</th><th className="text-right font-normal">Depois</th></tr>
                </thead>
                <tbody>
                  {suggestion.data.classes.map((c) => (
                    <tr key={c.assetClass} className="h-8 border-t border-stroke-3">
                      <td>{ASSET_CLASS_LABEL[c.assetClass] ?? c.assetClass}</td>
                      <td className="text-right font-mono tabular-nums">{pct(c.currentShare)}</td>
                      <td className="text-right font-mono text-fg-3 tabular-nums">{pct(c.target, 0)}</td>
                      <td className={cn("text-right font-mono font-semibold tabular-nums", c.amount <= 0 && "font-normal text-fg-4")}>{c.amount > 0 ? money0(c.amount, cur) : "—"}</td>
                      <td className="text-right font-mono tabular-nums">{pct(c.afterShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {suggestion.data?.assets && mode === "asset" ? (
              <table className="w-full text-[12.5px]">
                <thead className="text-[11.5px] text-fg-3">
                  <tr className="h-7"><th className="text-left font-normal">Ativo</th><th className="text-left font-normal">Classe</th><th className="text-right font-normal">Aportar</th><th className="text-right font-normal">≈ Qtd</th></tr>
                </thead>
                <tbody>
                  {suggestion.data.assets.map((a) => (
                    <tr key={a.holdingId} className="h-8 border-t border-stroke-3">
                      <td><span className="font-mono font-semibold">{a.ticker ?? a.name}</span></td>
                      <td className="text-fg-muted">{ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass}</td>
                      <td className="text-right font-mono font-semibold tabular-nums">{money0(a.amount, cur)}</td>
                      <td className="text-right font-mono text-fg-3 tabular-nums">{a.approxQuantity != null ? a.approxQuantity.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {!amountText ? <p className="text-[11px] text-fg-3">Digite o valor para ver a divisão. Só dinheiro novo: nunca sugere vender.</p> : null}
            <div className="flex gap-1.5">
              <Btn primary disabled={!(amount > 0)} onClick={() => setRegistering(true)}>Registrar este aporte</Btn>
            </div>
          </div>
        </Panel>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Histórico de aportes" pad={false}>
          {(history.data?.rows ?? []).map((row) => {
            const deposit = row.amount > 0;
            const status = !target || !deposit ? null : row.amountBase >= target ? "na meta" : "abaixo da meta";
            return (
              <div key={row.id} className="flex h-[34px] items-center gap-2.5 border-t border-stroke-3 px-3 text-[12.5px] first:border-t-0">
                <span className="w-12 font-mono text-[11.5px] text-fg-3">{dayLabel(row.date)}</span>
                <span className={cn("w-[96px] font-mono tabular-nums", !deposit && "text-neg")}>{money0(row.amountBase, cur)}</span>
                <span className="truncate text-fg-2">
                  {deposit ? `${names.account.get(row.counterpartAccountId ?? "") ?? "?"} → ${names.account.get(row.accountId) ?? ""}` : `${names.account.get(row.accountId) ?? ""} → ${names.account.get(row.counterpartAccountId ?? "") ?? "?"} (resgate)`}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-fg-3 hover:text-fg-strong"
                  onClick={() => router.push(`/transactions?drill=${encodeURIComponent(JSON.stringify({ label: row.description, filters: [{ field: "description", op: "contains", value: row.description }], period: { from: row.date, to: row.date } }))}`)}
                >
                  ver em Transações ↗
                </button>
                {status ? <span className={cn("ml-auto shrink-0 text-[12px]", status === "abaixo da meta" ? "text-warn" : "text-fg-3")}>{status}</span> : null}
              </div>
            );
          })}
          {!history.data?.rows.length ? <EmptyRow>{history.isFetching ? "Carregando…" : `Nenhum aporte em ${year}.`}</EmptyRow> : null}
        </Panel>
        <Panel title="Independência financeira" trailing={<Btn ghost onClick={() => setGoalOpen(true)}>{goal ? "Editar meta" : "Definir meta"}</Btn>}>
          {fire.data?.result ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex gap-6">
                <Kpi label="Número FIRE" value={money0(fire.data.result.fireNumber, cur)} sub={goal ? `${money0(goal.targetMonthlyIncome, cur)}/mês · SWR ${pct(goal.safeWithdrawalRate)}` : undefined} />
                <Kpi label="Progresso" value={pct(fire.data.result.progress)} />
              </div>
              <span className="relative h-1.5 rounded-full bg-fill-2">
                <span className="absolute inset-y-0 left-0 rounded-full bg-fg-ink" style={{ width: `${Math.min(fire.data.result.progress, 1) * 100}%` }} />
              </span>
              <p className="text-[12px] text-fg-muted">
                {fire.data.result.reached
                  ? "Meta atingida."
                  : fire.data.result.projectedFireDate
                    ? `Projeção: ${fire.data.result.projectedFireDate.slice(5, 7)}/${fire.data.result.projectedFireDate.slice(0, 4)} mantendo ${money0(goalMonthly ?? 0, cur)}/mês.`
                    : "Com o aporte atual a meta não é atingida."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 text-[12.5px]">
              <p className="text-fg-muted">Sem plano FIRE. Hoje: {money0(fire.data?.suggestedDefaults.currentInvested ?? 0, cur)} investidos e {money0(fire.data?.suggestedDefaults.currentMonthlyExpenses ?? 0, cur)}/mês de gastos.</p>
              <div><Btn primary onClick={() => setGoalOpen(true)}>Definir meta</Btn></div>
            </div>
          )}
        </Panel>
      </div>
      {registering ? <ContributionDialog names={names} initialAmount={amount > 0 ? amount : undefined} onClose={() => setRegistering(false)} /> : null}
      {goalOpen && fire.data ? <FireGoalDialog summary={fire.data} onClose={() => setGoalOpen(false)} /> : null}
      {targetsOpen ? (
        <TargetsDialog
          onClose={() => {
            setTargetsOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["rebalance"] });
          }}
        />
      ) : null}
    </Page>
  );
}

function ContributionDialog({ names, initialAmount, onClose }: { names: Names; initialAmount?: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const cash = names.accounts.filter((a) => a.type !== "brokerage" && a.type !== "credit_card" && !a.archivedAt);
  const brokers = names.accounts.filter((a) => a.type === "brokerage" && !a.archivedAt);
  const [direction, setDirection] = useState<"deposit" | "withdraw">("deposit");
  const [from, setFrom] = useState(cash.find((a) => a.isDefault)?.id ?? cash[0]?.id ?? "");
  const [broker, setBroker] = useState(brokers[0]?.id ?? "");
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount) : "");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const value = parseAmount(amount);
      if (!(value > 0)) throw new Error("Informe o valor");
      if (!broker) throw new Error("Cadastre uma corretora em Ajustes › Contas");
      return apiPost<{ batchId: string | null }>("/api/v2/brokerage-cash", { accountId: broker, counterpartAccountId: from, direction, amount: value, date, description: description || undefined });
    },
    onSuccess: async (res) => {
      await Promise.all(["contributions", "ledger", "portfolio", "accounts", "fire"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast(direction === "deposit" ? "Aporte registrado" : "Resgate registrado", {
        action: res.batchId ? { label: "Desfazer", onClick: () => void apiPost(`/api/v2/mutations/${res.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["contributions"] })) } : undefined,
      });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const option = (a: (typeof cash)[number]) => ({ value: a.id, label: `${a.name} · ${names.entity.get(a.entityId) ?? ""} · ${a.currency}` });
  const fromEntity = names.accounts.find((a) => a.id === from)?.entityId;
  const brokerEntity = names.accounts.find((a) => a.id === broker)?.entityId;
  return (
    <Modal
      title={direction === "deposit" ? "Registrar aporte" : "Registrar resgate"}
      description="Vira uma transferência em Transações: sai da conta e entra no caixa da corretora."
      onClose={onClose}
      footer={<><Btn ghost onClick={onClose}>Cancelar</Btn><Btn primary disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Btn></>}
    >
      <Segmented value={direction} options={[{ v: "deposit", l: "Aporte: conta → corretora" }, { v: "withdraw", l: "Resgate: corretora → conta" }]} onChange={setDirection} />
      <div className="grid grid-cols-[1fr_20px_1fr] items-end gap-2">
        <Field label={direction === "deposit" ? "De (conta)" : "Conta que recebe"}><SelectInput value={from} onChange={setFrom} options={cash.map(option)} /></Field>
        <span className="pb-1 text-center text-fg-3">{direction === "deposit" ? "→" : "←"}</span>
        <Field label="Corretora"><SelectInput value={broker} onChange={setBroker} placeholder={brokers.length ? undefined : "Nenhuma corretora"} options={brokers.map(option)} /></Field>
      </div>
      {fromEntity && brokerEntity && fromEntity !== brokerEntity ? (
        <p className="rounded-lg border border-warn-soft bg-warn-wash px-3 py-2 text-[12px] text-warn-ink">
          A conta é de {names.entity.get(fromEntity)} e a corretora é de {names.entity.get(brokerEntity)}. O aporte também move dinheiro entre as entidades.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Valor"><TextInput value={amount} onChange={setAmount} mono className="text-[15px]" placeholder="0,00" /></Field>
        <Field label="Data"><TextInput type="date" value={date} onChange={setDate} /></Field>
      </div>
      <Field label="Descrição (opcional)"><TextInput value={description} onChange={setDescription} placeholder="Aporte mensal" /></Field>
    </Modal>
  );
}

function FireGoalDialog({ summary, onClose }: { summary: FireSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const goal = summary.goal;
  const pctText = (v: number | undefined, fallback: number) => String(Math.round((v ?? fallback) * 1000) / 10).replace(".", ",");
  const [income, setIncome] = useState(goal ? String(goal.targetMonthlyIncome) : String(Math.round(summary.suggestedDefaults.currentMonthlyExpenses || 10000)));
  const [contribution, setContribution] = useState(String(Math.round(goal?.phases[0]?.monthlyContribution ?? summary.suggestedDefaults.suggestedMonthlyContribution)));
  const [ret, setRet] = useState(pctText(goal?.nominalAnnualReturn, 0.1));
  const [inflation, setInflation] = useState(pctText(goal?.annualInflation, 0.045));
  const [swr, setSwr] = useState(pctText(goal?.safeWithdrawalRate, 0.035));
  const [age, setAge] = useState(goal?.currentAge ? String(goal.currentAge) : "");
  const toFraction = (text: string) => Number(text.replace(",", ".")) / 100;
  const save = useMutation({
    mutationFn: () => {
      const base = goal
        ? Object.fromEntries(Object.entries(goal).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k)))
        : { planningMode: "by_contribution", phaseProfile: "constant", currency: summary.baseCurrency };
      return apiPut("/api/v1/fire/goal", {
        ...base,
        targetMonthlyIncome: parseAmount(income),
        nominalAnnualReturn: toFraction(ret),
        annualInflation: toFraction(inflation),
        safeWithdrawalRate: toFraction(swr),
        currentAge: age ? Number(age) : null,
        planningMode: "by_contribution",
        phaseProfile: "constant",
        phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: parseAmount(contribution) }],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["fire"] });
      toast.success("Meta salva");
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Modal
      title="Meta de independência financeira"
      description="Quanto você quer receber por mês dos investimentos e quanto aporta para chegar lá."
      onClose={onClose}
      width={460}
      footer={<><Btn ghost onClick={onClose}>Cancelar</Btn><Btn primary disabled={save.isPending} onClick={() => save.mutate()}>Salvar meta</Btn></>}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Renda mensal desejada"><TextInput value={income} onChange={setIncome} mono /></Field>
        <Field label="Aporte mensal" hint={`Sugerido pelo histórico: ${money0(summary.suggestedDefaults.suggestedMonthlyContribution, summary.baseCurrency)}`}><TextInput value={contribution} onChange={setContribution} mono /></Field>
        <Field label="Retorno nominal ao ano (%)"><TextInput value={ret} onChange={setRet} mono /></Field>
        <Field label="Inflação ao ano (%)"><TextInput value={inflation} onChange={setInflation} mono /></Field>
        <Field label="Taxa de retirada (%)" hint="3,5% é conservador"><TextInput value={swr} onChange={setSwr} mono /></Field>
        <Field label="Idade atual (opcional)"><TextInput value={age} onChange={setAge} mono /></Field>
      </div>
    </Modal>
  );
}
