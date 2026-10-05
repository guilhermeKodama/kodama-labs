"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPost } from "@/lib/api";
import type { Names } from "@/lib/catalog";
import { money, todayIso } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge, Btn, EmptyRow, Field, Segmented, SelectInput, TextInput } from "@/components/shell/chrome";

interface Candidate {
  type: "regular_transaction" | "entity_transfer" | "investment_transfer" | "credit_card_payment";
  confidence: string;
  transferDetails?: { suggestedEntityId: string; suggestedEntityName: string; suggestedEntityType: "business" | "personal"; suggestedFlow: "inflow" | "outflow" };
  investmentDetails?: { direction: "investment_deposit" | "investment_withdrawal"; suggestedAccountId?: string };
}

interface AnalyzedRow {
  fitId: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  reconciliationStatus: "new" | "duplicate" | "changed" | "fuzzy_match";
  existingTransactionId?: string;
  diffs?: { field: "amount" | "date" | "description"; existingValue: string; ofxValue: string }[];
  fuzzyMatchedTransaction?: { id: string; description: string; amount: number; date: string };
  candidates: Candidate[];
  resolvedClassification?: Candidate["type"];
  needsResolution: boolean;
}

interface Analysis {
  bankName: string;
  accountId: string;
  currency: string;
  ledgerBalance: number;
  transactions: AnalyzedRow[];
  summary: { totalIncome: number; totalExpenses: number; newCount: number; duplicateCount: number; changedCount: number; fuzzyMatchCount: number; needsResolutionCount: number };
}

/** What to do with each analyzed row. */
type Decision =
  | { as: "skip" }
  | { as: "transaction"; categoryName: string }
  | { as: "transfer"; counterpartyEntityId: string }
  | { as: "investment"; investmentAccountId: string }
  | { as: "link"; existingId: string }
  | { as: "update" };

function defaultDecision(row: AnalyzedRow): Decision {
  if (row.reconciliationStatus === "duplicate") return { as: "skip" };
  if (row.reconciliationStatus === "changed") return { as: "update" };
  if (row.reconciliationStatus === "fuzzy_match" && row.fuzzyMatchedTransaction) return { as: "link", existingId: row.fuzzyMatchedTransaction.id };
  const resolved = row.candidates.find((c) => c.type === row.resolvedClassification);
  if (resolved?.type === "entity_transfer" && resolved.transferDetails) return { as: "transfer", counterpartyEntityId: resolved.transferDetails.suggestedEntityId };
  if (resolved?.type === "investment_transfer" && resolved.investmentDetails?.suggestedAccountId) return { as: "investment", investmentAccountId: resolved.investmentDetails.suggestedAccountId };
  return { as: "transaction", categoryName: "" };
}

/** business→personal is a profit distribution, personal→business a capital injection. */
function directionFor(flow: "inflow" | "outflow", self: "personal" | "business", other: "personal" | "business") {
  if (self === other) return flow === "outflow" ? "capital_injection" : "profit_distribution";
  const fromBusiness = flow === "outflow" ? self === "business" : other === "business";
  return fromBusiness ? "profit_distribution" : "capital_injection";
}

export function ImportsPage({ names }: { names: Names }) {
  const [kind, setKind] = useState<"ofx" | "card">("ofx");
  return (
    <div className="flex max-w-[1040px] flex-col gap-4">
      <Segmented value={kind} options={[{ v: "ofx", l: "Extrato bancário (OFX)" }, { v: "card", l: "Fatura de cartão (CSV/OFX)" }]} onChange={setKind} />
      {kind === "ofx" ? <OfxImport names={names} /> : <CardImport names={names} />}
      <ImportHistory names={names} />
    </div>
  );
}

function OfxImport({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const [entityId, setEntityId] = useState(names.entities[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState(false);
  const entity = names.entities.find((e) => e.id === entityId);
  const brokers = names.accounts.filter((a) => a.type === "brokerage" && !a.archivedAt);
  const categoryNames = (type: "income" | "expense") => names.categories.filter((c) => !c.isArchived && c.type === type).map((c) => c.name).sort((a, b) => a.localeCompare(b));

  async function analyze(files: FileList) {
    setBusy(true);
    try {
      const payload = await Promise.all([...files].map(async (f) => ({ name: f.name, content: await f.text() })));
      const result = await apiPost<Analysis>("/api/v2/imports/analyze", { files: payload });
      setFileName([...files].map((f) => f.name).join(", "));
      setAnalysis(result);
      setDecisions(Object.fromEntries(result.transactions.map((row) => [row.fitId, defaultDecision(row)])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler o arquivo");
    } finally {
      setBusy(false);
    }
  }

  const commit = useMutation({
    mutationFn: () => {
      if (!analysis || !entity) throw new Error("Escolha a entidade e o arquivo");
      const self = entity.kind === "business" ? "business" : "personal";
      const rows = analysis.transactions;
      const d = (row: AnalyzedRow) => decisions[row.fitId] ?? defaultDecision(row);
      const plan = {
        entityType: self,
        entityId: entity.id,
        currency: analysis.currency || names.currency,
        bankName: analysis.bankName || undefined,
        fileName: fileName || undefined,
        ledgerBalance: analysis.ledgerBalance,
        transactions: rows
          .filter((row) => d(row).as === "transaction")
          .map((row) => {
            const decision = d(row) as Extract<Decision, { as: "transaction" }>;
            return { externalId: row.fitId, date: row.date, description: row.description, amount: Math.abs(row.amount), type: row.type, ...(decision.categoryName ? { category: decision.categoryName } : {}) };
          }),
        transfers: rows
          .filter((row) => d(row).as === "transfer")
          .map((row) => {
            const decision = d(row) as Extract<Decision, { as: "transfer" }>;
            const other = names.entities.find((e) => e.id === decision.counterpartyEntityId);
            const otherType = other?.kind === "business" ? "business" : "personal";
            const flow = row.type === "expense" ? "outflow" : "inflow";
            return {
              externalId: row.fitId,
              date: row.date,
              amount: Math.abs(row.amount),
              description: row.description,
              flow,
              direction: directionFor(flow, self, otherType),
              counterpartyEntityType: otherType,
              counterpartyEntityId: decision.counterpartyEntityId,
            };
          }),
        investmentTransfers: rows
          .filter((row) => d(row).as === "investment")
          .map((row) => ({
            externalId: row.fitId,
            date: row.date,
            amount: Math.abs(row.amount),
            description: row.description,
            direction: row.type === "expense" ? "investment_deposit" : "investment_withdrawal",
            investmentAccountId: (d(row) as Extract<Decision, { as: "investment" }>).investmentAccountId,
          })),
        reconciliations: rows
          .filter((row) => d(row).as === "update" && row.existingTransactionId)
          .map((row) => ({
            existingTransactionId: row.existingTransactionId!,
            externalId: row.fitId,
            updates: Object.fromEntries((row.diffs ?? []).map((diff) => [diff.field, diff.field === "amount" ? Math.abs(Number(diff.ofxValue)) : diff.ofxValue])),
          })),
        duplicateDecisions: rows
          .filter((row) => row.reconciliationStatus !== "new" && ["skip", "link", "transaction"].includes(d(row).as))
          .map((row) => {
            const decision = d(row);
            return decision.as === "link"
              ? { externalId: row.fitId, resolution: "link_fuzzy", existingTransactionId: decision.existingId }
              : decision.as === "transaction"
                ? { externalId: row.fitId, resolution: "import_anyway" }
                : { externalId: row.fitId, resolution: "skip_duplicate" };
          }),
      };
      return apiPost<{ imported: number; duplicatesSkipped: number; transfersCreated: number; reconciled: number }>("/api/v2/imports", plan);
    },
    onSuccess: async (r) => {
      await Promise.all(["ledger", "imports", "accounts", "budgets", "contributions"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(`${r.imported} lançamentos, ${r.transfersCreated} transferências, ${r.reconciled} atualizados · ${r.duplicatesSkipped} duplicados ignorados`);
      setAnalysis(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const set = (fitId: string, decision: Decision) => setDecisions((current) => ({ ...current, [fitId]: decision }));
  const counts = analysis ? Object.values(decisions).reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.as]: (acc[d.as] ?? 0) + 1 }), {}) : {};

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Extrato de">
          <SelectInput value={entityId} onChange={setEntityId} options={names.entities.map((e) => ({ value: e.id, label: names.entity.get(e.id) ?? e.name }))} />
        </Field>
        <label className="inline-flex h-[26px] cursor-pointer items-center rounded-[6px] border border-neutral-300 px-2.5 text-[12px] font-medium hover:bg-neutral-50">
          {busy ? "Lendo…" : analysis ? "Trocar arquivo" : "Escolher arquivo OFX"}
          <input type="file" accept=".ofx,.qfx" multiple className="hidden" onChange={(event) => { if (event.target.files?.length) void analyze(event.target.files); event.target.value = ""; }} />
        </label>
        {analysis ? <span className="text-[12px] text-neutral-500">{fileName} · {analysis.bankName} · {analysis.transactions.length} linhas</span> : null}
      </div>
      {analysis ? (
        <>
          <div className="flex flex-wrap gap-1.5 text-[12px]">
            <Badge>{analysis.summary.newCount} novas</Badge>
            <Badge>{analysis.summary.duplicateCount} já existem</Badge>
            {analysis.summary.changedCount ? <Badge tone="warn">{analysis.summary.changedCount} mudaram</Badge> : null}
            {analysis.summary.fuzzyMatchCount ? <Badge tone="warn">{analysis.summary.fuzzyMatchCount} parecidas</Badge> : null}
            <span className="text-neutral-400">Entradas {money(analysis.summary.totalIncome, analysis.currency)} · Saídas {money(analysis.summary.totalExpenses, analysis.currency)}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <div className="grid h-[34px] grid-cols-[52px_minmax(0,2fr)_120px_96px_minmax(0,1.6fr)] items-center gap-2 px-3 text-[11.5px] text-neutral-400">
              <span>Data</span><span>Descrição</span><span className="text-right">Valor</span><span>Situação</span><span>Importar como</span>
            </div>
            {analysis.transactions.map((row) => {
              const decision = decisions[row.fitId] ?? defaultDecision(row);
              const value = decision.as === "transaction" ? `tx:${decision.categoryName}` : decision.as === "transfer" ? `tr:${decision.counterpartyEntityId}` : decision.as === "investment" ? `inv:${decision.investmentAccountId}` : decision.as;
              return (
                <div key={row.fitId} className={cn("grid min-h-[34px] grid-cols-[52px_minmax(0,2fr)_120px_96px_minmax(0,1.6fr)] items-center gap-2 border-t border-neutral-200 px-3 text-[12.5px]", decision.as === "skip" && "text-neutral-400")}>
                  <span className="font-mono text-[11.5px] text-neutral-400">{row.date.slice(5).split("-").reverse().join("/")}</span>
                  <span className="truncate" title={row.description}>{row.description}</span>
                  <span className={cn("text-right font-mono tabular-nums", row.type === "income" && "text-emerald-700")}>{money(row.type === "income" ? Math.abs(row.amount) : -Math.abs(row.amount), analysis.currency)}</span>
                  <span className="text-[11.5px]">
                    {{ new: "nova", duplicate: "já existe", changed: "mudou", fuzzy_match: "parecida" }[row.reconciliationStatus]}
                  </span>
                  <select
                    value={value}
                    onChange={(event) => {
                      const v = event.target.value;
                      if (v === "skip" || v === "update") set(row.fitId, { as: v });
                      else if (v.startsWith("tx:")) set(row.fitId, { as: "transaction", categoryName: v.slice(3) });
                      else if (v.startsWith("tr:")) set(row.fitId, { as: "transfer", counterpartyEntityId: v.slice(3) });
                      else if (v.startsWith("inv:")) set(row.fitId, { as: "investment", investmentAccountId: v.slice(4) });
                      else if (v === "link" && row.fuzzyMatchedTransaction) set(row.fitId, { as: "link", existingId: row.fuzzyMatchedTransaction.id });
                    }}
                    className="h-[26px] min-w-0 rounded-[6px] border border-neutral-300 bg-white px-1.5 text-[12px]"
                  >
                    <option value="skip">Não importar</option>
                    {row.reconciliationStatus === "changed" ? <option value="update">Atualizar o lançamento existente</option> : null}
                    {row.fuzzyMatchedTransaction ? <option value="link">É o mesmo que “{row.fuzzyMatchedTransaction.description}”</option> : null}
                    <optgroup label={row.type === "income" ? "Receita" : "Despesa"}>
                      <option value="tx:">{row.type === "income" ? "Receita" : "Despesa"} · categoria pelas regras</option>
                      {categoryNames(row.type).map((c) => <option key={c} value={`tx:${c}`}>{c}</option>)}
                    </optgroup>
                    <optgroup label="Transferência com outra entidade">
                      {names.entities.filter((e) => e.id !== entityId).map((e) => <option key={e.id} value={`tr:${e.id}`}>{row.type === "expense" ? "Para" : "De"} {names.entity.get(e.id)}</option>)}
                    </optgroup>
                    {brokers.length ? (
                      <optgroup label={row.type === "expense" ? "Aporte em corretora" : "Resgate de corretora"}>
                        {brokers.map((b) => <option key={b.id} value={`inv:${b.id}`}>{b.name}</option>)}
                      </optgroup>
                    ) : null}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Btn primary disabled={commit.isPending || !entity} onClick={() => commit.mutate()}>{commit.isPending ? "Importando…" : "Importar"}</Btn>
            <Btn ghost onClick={() => setAnalysis(null)}>Cancelar</Btn>
            <span className="text-[12px] text-neutral-400">
              {counts.transaction ?? 0} lançamentos · {counts.transfer ?? 0} transferências · {counts.investment ?? 0} aportes · {(counts.update ?? 0) + (counts.link ?? 0)} conciliados · {counts.skip ?? 0} ignorados
            </span>
          </div>
        </>
      ) : (
        <p className="text-[12px] text-neutral-400">O extrato é comparado com o que já existe: duplicados ficam de fora e você revisa cada linha antes de importar. Para PDFs e prints, use o assistente (⌘K).</p>
      )}
    </div>
  );
}

function CardImport({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const cards = names.accounts.filter((a) => a.type === "credit_card" && !a.archivedAt);
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const card = cards.find((c) => c.id === cardId);
  const now = todayIso();
  const guess = (day: number | null | undefined) => (day ? `${now.slice(0, 8)}${String(Math.min(day, 28)).padStart(2, "0")}` : now);
  const [closing, setClosing] = useState(guess(card?.closingDay));
  const [due, setDue] = useState(guess(card?.dueDay));
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      if (!card || !file) throw new Error("Escolha o cartão e o arquivo");
      return apiPost<{ created: number; skipped: number; projectedReplaced?: number }>(`/api/v2/accounts/${card.id}/statements/import-file`, { closingDate: closing, dueDate: due, content: await file.text(), fileName: file.name });
    },
    onSuccess: async (r) => {
      await Promise.all(["ledger", "imports", "accounts", "budgets"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success(`${r.created} compras importadas · ${r.skipped} já existiam`);
      setFile(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!cards.length) return <p className="text-[12.5px] text-neutral-500">Cadastre um cartão em “Cartões de crédito” para importar a fatura.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Cartão">
          <SelectInput value={cardId} onChange={(id) => { setCardId(id); const c = cards.find((x) => x.id === id); setClosing(guess(c?.closingDay)); setDue(guess(c?.dueDay)); }} options={cards.map((c) => ({ value: c.id, label: `${c.name} · ${names.entity.get(c.entityId) ?? ""}` }))} />
        </Field>
        <Field label="Fechamento"><TextInput type="date" value={closing} onChange={setClosing} /></Field>
        <Field label="Vencimento"><TextInput type="date" value={due} onChange={setDue} /></Field>
        <label className="inline-flex h-[26px] cursor-pointer items-center rounded-[6px] border border-neutral-300 px-2.5 text-[12px] font-medium hover:bg-neutral-50">
          {file ? file.name : "Escolher arquivo"}
          <input type="file" accept=".csv,.ofx,.qfx,.txt" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <Btn primary disabled={!file || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Importando…" : "Importar fatura"}</Btn>
      </div>
      <p className="text-[12px] text-neutral-400">Reimportar a mesma fatura não duplica: compras iguais são reconhecidas, e parcelas futuras ficam projetadas até a fatura delas chegar.</p>
    </div>
  );
}

function ImportHistory({ names }: { names: Names }) {
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ["imports"],
    queryFn: async () =>
      (await api<{ imports: { id: string; entity: { name: string; kind: string } | null; accountId: string | null; bankName: string | null; fileName: string | null; source: string; transactionCount: number; entries: number; transfers: number; revertedAt: string | null; createdAt: string }[] }>("/api/v2/imports")).imports,
  });
  const revert = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v2/imports/${id}/revert`, {}),
    onSuccess: async () => {
      await Promise.all(["ledger", "imports", "accounts", "budgets"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      toast.success("Importação desfeita: os lançamentos foram para a lixeira");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium">Histórico</span>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <div className="grid h-[34px] grid-cols-[70px_minmax(0,1.6fr)_minmax(0,1fr)_80px_90px_70px] items-center gap-2 px-3 text-[11.5px] text-neutral-400">
          <span>Data</span><span>Arquivo</span><span>Conta</span><span className="text-right">Lanç.</span><span>Status</span><span />
        </div>
        {(history.data ?? []).map((i) => (
          <div key={i.id} className="grid h-[34px] grid-cols-[70px_minmax(0,1.6fr)_minmax(0,1fr)_80px_90px_70px] items-center gap-2 border-t border-neutral-200 px-3 text-[12.5px]">
            <span className="font-mono text-[11.5px] text-neutral-400">{i.createdAt.slice(5, 10).split("-").reverse().join("/")}</span>
            <span className="truncate">{i.fileName ?? (i.source === "assistant" ? "via assistente" : i.bankName ?? "—")}</span>
            <span className="truncate text-neutral-500">{i.accountId ? names.account.get(i.accountId) : i.entity?.name ?? "—"}</span>
            <span className="text-right font-mono tabular-nums">{i.entries + i.transfers}</span>
            <span className={cn("text-[12px]", i.revertedAt ? "text-neutral-400" : "text-neutral-600")}>{i.revertedAt ? "Desfeita" : "Importada"}</span>
            {!i.revertedAt ? (
              <button type="button" className="text-right text-[12px] underline" onClick={() => { if (window.confirm("Desfazer esta importação? Tudo o que ela criou vai para a lixeira.")) revert.mutate(i.id); }}>
                Desfazer
              </button>
            ) : <span />}
          </div>
        ))}
        {!history.data?.length ? <EmptyRow>Nenhuma importação ainda.</EmptyRow> : null}
      </div>
    </div>
  );
}
