"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { money, parseAmount, todayIso } from "@/lib/money";
import { Btn, Check, Field, Modal, Segmented, SelectInput, TextInput } from "@/components/shell/chrome";
import { CategorySelect } from "./categories";

type Kind = "expense" | "income" | "transfer" | "invest";

export interface QuickDraft {
  description?: string;
  amount?: number;
  date?: string;
  kind?: "expense" | "income";
}

interface FormState {
  kind: Kind;
  amount: string;
  currency: string;
  rate: string;
  date: string;
  description: string;
  accountId: string;
  toAccountId: string;
  brokerId: string;
  investDir: "deposit" | "withdraw";
  categoryId: string;
  recurring: boolean;
  frequency: "weekly" | "monthly" | "yearly";
  autoGenerate: boolean;
  installments: boolean;
  nInstallments: string;
  deductible: boolean;
  reimbursement: boolean;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "ifood 86,90 nubank ontem" / "+5000 invoice acme mercury" → form fields. */
export function parseQuick(input: string, names: Names): Partial<FormState> {
  const out: Partial<FormState> = {};
  let rest = ` ${input.trim()} `;
  const amount = rest.match(/\s([+-]?)(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s/);
  if (amount) {
    out.amount = amount[2];
    out.kind = amount[1] === "+" ? "income" : "expense";
    rest = rest.replace(amount[0], " ");
  }
  if (/\sontem\s/i.test(rest)) {
    out.date = yesterday();
    rest = rest.replace(/\sontem\s/i, " ");
  } else if (/\shoje\s/i.test(rest)) {
    out.date = todayIso();
    rest = rest.replace(/\shoje\s/i, " ");
  } else {
    const dm = rest.match(/\s(\d{1,2})\/(\d{1,2})\s/);
    if (dm) {
      out.date = `${new Date().getFullYear()}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
      rest = rest.replace(dm[0], " ");
    }
  }
  const cur = rest.match(/\s(usd|eur|brl|gbp)\s/i);
  if (cur) {
    out.currency = cur[1].toUpperCase();
    rest = rest.replace(cur[0], " ");
  }
  const lowered = rest.toLowerCase();
  const account = names.accounts.filter((a) => !a.archivedAt && a.type !== "brokerage").find((a) => lowered.includes(` ${a.name.toLowerCase().split(/[\s·]+/)[0]} `));
  if (account) {
    out.accountId = account.id;
    rest = rest.replace(new RegExp(`\\s${account.name.split(/[\s·]+/)[0]}\\s`, "i"), " ");
  }
  const description = rest.trim().replace(/\s+/g, " ");
  if (description) out.description = description.charAt(0).toUpperCase() + description.slice(1);
  return out;
}

export function EntryDialog({ names, draft, onClose }: { names: Names; draft: QuickDraft | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const liveAccounts = names.accounts.filter((a) => !a.archivedAt);
  const cashAccounts = liveAccounts.filter((a) => a.type !== "brokerage");
  const brokers = liveAccounts.filter((a) => a.type === "brokerage");
  const initial = (): FormState => ({
    kind: draft?.kind ?? "expense",
    amount: draft?.amount ? String(draft.amount).replace(".", ",") : "",
    currency: "",
    rate: "",
    date: draft?.date ?? todayIso(),
    description: draft?.description ?? "",
    accountId: cashAccounts.find((a) => a.isDefault)?.id ?? cashAccounts[0]?.id ?? "",
    toAccountId: "",
    brokerId: brokers[0]?.id ?? "",
    investDir: "deposit",
    categoryId: "",
    recurring: false,
    frequency: "monthly",
    autoGenerate: true,
    installments: false,
    nInstallments: "3",
    deductible: false,
    reimbursement: false,
  });
  const [f, setF] = useState<FormState>(initial);
  const [quick, setQuick] = useState("");
  const [another, setAnother] = useState(false);
  const [suggested, setSuggested] = useState<{ id: string; name: string } | null>(null);
  const up = (patch: Partial<FormState>) => setF((current) => ({ ...current, ...patch }));
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<{ baseCurrency: string; currencies: { code: string }[] }>("/api/v2/currencies") });
  const account = liveAccounts.find((a) => a.id === f.accountId);
  const accountCurrency = account?.currency ?? names.currency;
  const currency = f.currency || accountCurrency;
  const amount = parseAmount(f.amount);

  async function suggestCategory(description: string) {
    if (!description.trim() || f.categoryId) return;
    try {
      const result = await apiPost<{ category: { id: string; name: string } | null }>("/api/v2/rules/test", { description });
      setSuggested(result.category ? { id: result.category.id, name: result.category.name } : null);
    } catch {
      setSuggested(null);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero");
      const rate = f.rate ? parseAmount(f.rate) : undefined;
      if (f.kind === "invest") {
        if (!f.brokerId || !f.accountId) throw new Error("Escolha a conta e a corretora");
        if (f.recurring) {
          return apiPost("/api/v2/recurring", {
            kind: "transfer",
            accountId: f.investDir === "deposit" ? f.accountId : f.brokerId,
            toAccountId: f.investDir === "deposit" ? f.brokerId : f.accountId,
            transferDirection: f.investDir === "deposit" ? "investment_deposit" : "investment_withdrawal",
            amount,
            description: f.description || (f.investDir === "deposit" ? "Aporte" : "Resgate"),
            frequency: f.frequency,
            startDate: f.date,
            autoGenerate: f.autoGenerate,
          });
        }
        return apiPost("/api/v2/brokerage-cash", {
          accountId: f.brokerId,
          counterpartAccountId: f.accountId,
          direction: f.investDir,
          amount,
          date: f.date,
          description: f.description || undefined,
        });
      }
      if (f.kind === "transfer") {
        if (!f.toAccountId || f.toAccountId === f.accountId) throw new Error("Escolha contas de origem e destino diferentes");
        if (f.recurring) {
          return apiPost("/api/v2/recurring", {
            kind: "transfer",
            accountId: f.accountId,
            toAccountId: f.toAccountId,
            transferDirection: f.reimbursement ? "reimbursement" : undefined,
            amount,
            description: f.description || "Transferência",
            frequency: f.frequency,
            startDate: f.date,
            autoGenerate: f.autoGenerate,
          });
        }
        return apiPost("/api/v2/ledger/entries", {
          kind: "transfer",
          fromAccountId: f.accountId,
          toAccountId: f.toAccountId,
          amount,
          date: f.date,
          description: f.description || undefined,
          ...(f.reimbursement ? { direction: "reimbursement" } : {}),
          ...(f.currency ? { currency: f.currency } : {}),
          ...(rate ? { exchangeRate: rate } : {}),
        });
      }
      if (!f.description.trim()) throw new Error("Descreva o lançamento");
      if (f.recurring) {
        return apiPost("/api/v2/recurring", {
          kind: f.kind,
          accountId: f.accountId,
          amount,
          currency: f.currency || undefined,
          exchangeRate: rate,
          description: f.description,
          categoryId: f.categoryId || suggested?.id || null,
          frequency: f.frequency,
          startDate: f.date,
          autoGenerate: f.autoGenerate,
        });
      }
      return apiPost("/api/v2/ledger/entries", {
        kind: f.kind,
        accountId: f.accountId,
        amount,
        date: f.date,
        description: f.description,
        categoryId: f.categoryId || null,
        isTaxDeductible: f.deductible || undefined,
        installments: f.installments ? Number(f.nInstallments) : undefined,
        ...(f.currency ? { currency: f.currency } : {}),
        ...(rate ? { exchangeRate: rate } : {}),
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["budgets"] }),
        queryClient.invalidateQueries({ queryKey: ["contributions"] }),
      ]);
      const batchId = (result as { batchId?: string | null } | undefined)?.batchId;
      toast(f.recurring ? "Recorrência criada" : "Lançamento criado", {
        action: batchId
          ? { label: "Desfazer", onClick: () => void apiPost(`/api/v2/mutations/${batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] })) }
          : undefined,
      });
      if (another) {
        setF({ ...initial(), kind: f.kind, accountId: f.accountId, date: f.date });
        setSuggested(null);
      } else onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isTransfer = f.kind === "transfer";
  const isInvest = f.kind === "invest";
  const accountOptions = (list: typeof liveAccounts) => list.map((a) => ({ value: a.id, label: `${a.name} · ${names.entity.get(a.entityId) ?? ""} · ${a.currency}` }));

  return (
    <Modal
      title="Nova transação"
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="mr-auto"><Check checked={another} onChange={setAnother} label="Criar outra" /></span>
          <Btn ghost onClick={onClose}>Cancelar</Btn>
          <Btn primary disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Salvando…" : "Salvar"}</Btn>
        </>
      }
    >
      <form
        className="flex items-center gap-1.5 rounded-lg border border-stroke-3 bg-fill-4 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseQuick(quick, names);
          up(parsed);
          if (parsed.description) void suggestCategory(parsed.description);
        }}
      >
        <TextInput value={quick} onChange={setQuick} placeholder="ex.: uber 23,40 ontem · +5000 invoice acme mercury" className="flex-1" />
        <Btn primary type="submit" disabled={!quick.trim()}>Preencher ↵</Btn>
      </form>
      <Segmented
        value={f.kind}
        options={[
          { v: "expense", l: "Saída" },
          { v: "income", l: "Entrada" },
          { v: "transfer", l: "Transferência" },
          { v: "invest", l: "Aporte" },
        ]}
        onChange={(kind) => up({ kind, categoryId: "" })}
      />
      {isInvest ? (
        <>
          <Segmented value={f.investDir} options={[{ v: "deposit", l: "Aporte: conta → corretora" }, { v: "withdraw", l: "Resgate: corretora → conta" }]} onChange={(investDir) => up({ investDir })} />
          {brokers.length === 0 ? <p className="text-[12px] text-warn-strong">Cadastre uma corretora em Ajustes › Contas para registrar aportes.</p> : null}
          <div className="grid grid-cols-[1fr_20px_1fr] items-end gap-2">
            <Field label={f.investDir === "deposit" ? "De (conta)" : "De (corretora)"}>
              {f.investDir === "deposit"
                ? <SelectInput value={f.accountId} onChange={(accountId) => up({ accountId })} options={accountOptions(cashAccounts)} />
                : <SelectInput value={f.brokerId} onChange={(brokerId) => up({ brokerId })} options={accountOptions(brokers)} />}
            </Field>
            <span className="pb-1 text-center text-fg-3">→</span>
            <Field label={f.investDir === "deposit" ? "Para (corretora)" : "Para (conta)"}>
              {f.investDir === "deposit"
                ? <SelectInput value={f.brokerId} onChange={(brokerId) => up({ brokerId })} options={accountOptions(brokers)} />
                : <SelectInput value={f.accountId} onChange={(accountId) => up({ accountId })} options={accountOptions(cashAccounts)} />}
            </Field>
          </div>
        </>
      ) : null}
      {isTransfer ? (
        <div className="grid grid-cols-[1fr_20px_1fr] items-end gap-2">
          <Field label="De">
            <SelectInput value={f.accountId} onChange={(accountId) => up({ accountId })} options={accountOptions(liveAccounts)} />
          </Field>
          <span className="pb-1 text-center text-fg-3">→</span>
          <Field label="Para">
            <SelectInput value={f.toAccountId} onChange={(toAccountId) => up({ toAccountId })} placeholder="Escolha a conta" options={accountOptions(liveAccounts.filter((a) => a.id !== f.accountId))} />
          </Field>
          <span className="col-span-3"><Check checked={f.reimbursement} onChange={(reimbursement) => up({ reimbursement })} label="É reembolso" /></span>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1fr)] items-end gap-2.5">
        <Field label={`Valor (${currency})`} hint={f.installments && amount > 0 ? `${f.nInstallments}× de ${money(amount / Math.max(1, Number(f.nInstallments) || 1), currency)}` : undefined}>
          <TextInput value={f.amount} onChange={(v) => up({ amount: v })} placeholder="0,00" mono className="text-[15px]" autoFocus={!draft} />
        </Field>
        <Field label="Moeda">
          <SelectInput value={currency} onChange={(v) => up({ currency: v === accountCurrency ? "" : v })} options={(currencies.data?.currencies ?? [{ code: accountCurrency }]).map((c) => ({ value: c.code, label: c.code }))} />
        </Field>
        <Field label="Data">
          <TextInput type="date" value={f.date} onChange={(date) => up({ date })} />
        </Field>
      </div>
      {currency !== accountCurrency && !isInvest ? (
        <Field label={`Câmbio (${accountCurrency} por 1 ${currency}, opcional)`} hint="Vazio usa a cotação cadastrada em Ajustes › Moedas">
          <TextInput value={f.rate} onChange={(rate) => up({ rate })} mono className="w-32" />
        </Field>
      ) : null}
      <Field label={isTransfer || isInvest ? "Descrição (opcional)" : "Descrição"}>
        <TextInput value={f.description} onChange={(description) => up({ description })} onBlur={() => void suggestCategory(f.description)} placeholder="Ex.: iFood, Invoice #0142, Aluguel" />
      </Field>
      {!isTransfer && !isInvest ? (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Conta" hint={account ? `${names.entity.get(account.entityId) ?? ""}${account.type === "credit_card" ? " · cai na fatura pelo dia de fechamento" : ""}` : undefined}>
            <SelectInput value={f.accountId} onChange={(accountId) => up({ accountId })} options={accountOptions(cashAccounts)} />
          </Field>
          <Field
            label="Categoria"
            hint={
              suggested && !f.categoryId ? (
                <span>
                  Sugerido pelas regras: <b className="font-medium text-fg-strong">{suggested.name}</b> ·{" "}
                  <button type="button" className="underline" onClick={() => up({ categoryId: suggested.id })}>usar</button>
                </span>
              ) : undefined
            }
          >
            <CategorySelect value={f.categoryId} onChange={(categoryId) => up({ categoryId })} categories={names.categories} kind={f.kind === "income" ? "income" : "expense"} className="w-full" />
          </Field>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-stroke-3 pt-2.5">
        <div className="flex flex-wrap gap-4">
          <Check checked={f.recurring} onChange={(recurring) => up({ recurring, installments: recurring ? false : f.installments })} label={isInvest ? "Aporte recorrente" : "Recorrente"} />
          {f.kind === "expense" ? <Check checked={f.installments} onChange={(installments) => up({ installments, recurring: installments ? false : f.recurring })} label="Parcelado" /> : null}
          {!isTransfer && !isInvest ? <Check checked={f.deductible} onChange={(deductible) => up({ deductible })} label="Dedutível no IR" /> : null}
        </div>
        {f.recurring ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Frequência">
              <SelectInput value={f.frequency} onChange={(v) => up({ frequency: v as FormState["frequency"] })} options={[{ value: "weekly", label: "Semanal" }, { value: "monthly", label: "Mensal" }, { value: "yearly", label: "Anual" }]} />
            </Field>
            <Field label="Modo">
              <SelectInput value={f.autoGenerate ? "auto" : "remind"} onChange={(v) => up({ autoGenerate: v === "auto" })} options={[{ value: "auto", label: "Lançar automaticamente" }, { value: "remind", label: "Só lembrar no dia" }]} />
            </Field>
          </div>
        ) : null}
        {f.installments ? (
          <Field label="Parcelas" hint="Cria um lançamento por mês (por fatura, no cartão)">
            <TextInput value={f.nInstallments} onChange={(nInstallments) => up({ nInstallments })} mono className="w-20" />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
