"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiPatch, apiPost } from "@/lib/api";
import { money } from "@/lib/money";
import { useAccounts, useCategories } from "@/lib/catalog";
import { useSession } from "@/lib/session";
import { AppFrame, Btn } from "@/components/shell/chrome";

const PAGES = ["Contas", "Categorias", "Regras", "Moedas", "Lixeira", "Importações"] as const;

export function SettingsScreen() {
  const [page, setPage] = useState<(typeof PAGES)[number]>("Contas");
  return (
    <AppFrame crumbs={["Ajustes", page]}>
      <div className="flex gap-1">
        {PAGES.map((item) => (
          <button key={item} type="button" onClick={() => setPage(item)} className={`inline-flex h-[26px] items-center rounded-[6px] px-2 text-[12px] ${page === item ? "bg-neutral-100 font-medium" : "text-neutral-500"}`}>{item}</button>
        ))}
      </div>
      {page === "Contas" ? <AccountsPane /> : null}
      {page === "Categorias" ? <CategoriesPane /> : null}
      {page === "Regras" ? <RulesPane /> : null}
      {page === "Moedas" ? <CurrenciesPane /> : null}
      {page === "Lixeira" ? <TrashPane /> : null}
      {page === "Importações" ? <ImportsPane /> : null}
    </AppFrame>
  );
}

function AccountsPane() {
  const session = useSession();
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState("");
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]">
      {(session.data?.entities ?? []).map((entity) => (
        <div key={entity.id} className="border-t border-neutral-200 px-3 py-2 first:border-t-0">
          <p className="font-medium">{entity.name}</p>
          {(accounts.data ?? []).filter((account) => account.entityId === entity.id).map((account) => (
            <p key={account.id} className="text-neutral-500">{account.name} · {account.type}</p>
          ))}
        </div>
      ))}
      <form className="flex gap-1.5 border-t border-neutral-200 p-2" onSubmit={(event) => {
        event.preventDefault();
        void apiPost("/api/v2/accounts", { name, entityId, type: "checking" }).then(() => { setName(""); queryClient.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Salvo"); });
      }}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Conta" className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required />
        <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required>
          <option value="">Entidade</option>
          {(session.data?.entities ?? []).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
        <Btn primary type="submit">Salvar</Btn>
      </form>
    </div>
  );
}

function CategoriesPane() {
  const categories = useCategories(true);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]">
      {(categories.data ?? []).map((category) => (
        <div key={category.id} className="flex h-8 items-center justify-between border-t border-neutral-200 px-3 first:border-t-0">
          <span className={category.isArchived ? "text-neutral-400 line-through" : ""}>{category.name}</span>
          {!category.isArchived ? <button type="button" className="text-[12px] text-neutral-500" onClick={() => void apiPatch(`/api/v2/categories/${category.id}`, { isArchived: true }).then(() => queryClient.invalidateQueries({ queryKey: ["categories"] }))}>Arquivar</button> : null}
        </div>
      ))}
      <form className="flex gap-1.5 border-t border-neutral-200 p-2" onSubmit={(event) => { event.preventDefault(); void apiPost("/api/v2/categories", { name, type: "expense" }).then(() => { setName(""); queryClient.invalidateQueries({ queryKey: ["categories"] }); }); }}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Categoria" className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required />
        <Btn primary type="submit">Salvar</Btn>
      </form>
    </div>
  );
}

function RulesPane() {
  const categories = useCategories();
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api<{ id: string; pattern: string; category: { name: string } | null }[]>("/api/v2/rules") });
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]">
      {(rules.data ?? []).map((rule) => (
        <div key={rule.id} className="flex h-8 items-center border-t border-neutral-200 px-3 first:border-t-0">{rule.pattern} → {rule.category?.name}</div>
      ))}
      <form className="flex gap-1.5 border-t border-neutral-200 p-2" onSubmit={(event) => { event.preventDefault(); void apiPost("/api/v2/rules", { matchType: "contains", pattern, categoryId }).then(() => queryClient.invalidateQueries({ queryKey: ["rules"] })); }}>
        <input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="contém" className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required />
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" required>
          <option value="">Categoria</option>
          {(categories.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Btn primary type="submit">Salvar</Btn>
      </form>
    </div>
  );
}

function CurrenciesPane() {
  const currencies = useQuery({ queryKey: ["currencies"], queryFn: () => api<{ currencies: { code: string; name: string; manualRate: number }[] }>("/api/v2/currencies") });
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]">
      {(currencies.data?.currencies ?? []).map((currency) => (
        <div key={currency.code} className="flex h-8 items-center justify-between border-t border-neutral-200 px-3 first:border-t-0">
          <span>{currency.code} · {currency.name}</span>
          <span className="font-mono tabular-nums">{currency.manualRate}</span>
        </div>
      ))}
    </div>
  );
}

function TrashPane() {
  const queryClient = useQueryClient();
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => api<{ rows: { id: string; description: string; amountBase: number }[] }>("/api/v2/trash") });
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]">
      {(trash.data?.rows ?? []).map((row) => (
        <div key={row.id} className="flex h-8 items-center justify-between border-t border-neutral-200 px-3 first:border-t-0">
          <span>{row.description}</span>
          <span className="flex items-center gap-3"><span className="font-mono tabular-nums">{money(row.amountBase)}</span><button type="button" onClick={() => void apiPost("/api/v2/trash/restore", { ids: [row.id] }).then(() => queryClient.invalidateQueries({ queryKey: ["trash"] }))}>Restaurar</button></span>
        </div>
      ))}
    </div>
  );
}

function ImportsPane() {
  const session = useSession();
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: ["imports"], queryFn: async () => (await api<{ imports: { id: string; fileName: string | null }[] }>("/api/v2/imports")).imports });
  const [entityId, setEntityId] = useState("");
  const [rows, setRows] = useState<{ fitId: string; date: string; description: string; amount: number; type: "income" | "expense"; isDuplicate: boolean }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [currency, setCurrency] = useState("BRL");

  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="flex items-center gap-1.5">
        <select value={entityId} onChange={(event) => setEntityId(event.target.value)} className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]">
          <option value="">Entidade</option>
          {(session.data?.entities ?? []).map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
        <input type="file" accept=".ofx,.qfx" className="text-[12px]" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void file.text().then((content) => apiPost<{ currency: string; transactions: typeof rows }>("/api/v2/imports/analyze", { files: [{ name: file.name, content }] })).then((analyzed) => {
            setRows(analyzed.transactions);
            setPicked(analyzed.transactions.filter((row) => !row.isDuplicate).map((row) => row.fitId));
            setCurrency(analyzed.currency || "BRL");
          });
        }} />
        <Btn primary onClick={() => {
          const entity = session.data?.entities.find((item) => item.id === entityId);
          const chosen = rows.filter((row) => picked.includes(row.fitId) && !row.isDuplicate);
          void apiPost("/api/v2/imports", {
            entityType: entity?.kind === "business" ? "business" : "personal",
            entityId,
            currency,
            transactions: chosen.map((row) => ({ externalId: row.fitId, date: row.date, description: row.description, amount: Math.abs(row.amount), type: row.type })),
            duplicateDecisions: rows.filter((row) => row.isDuplicate).map((row) => ({ externalId: row.fitId, resolution: "skip_duplicate" })),
          }).then(() => { setRows([]); queryClient.invalidateQueries({ queryKey: ["imports"] }); toast.success("Importado"); });
        }}>Importar selecionadas</Btn>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        {rows.map((row) => (
          <label key={row.fitId} className="flex h-8 items-center gap-2 border-t border-neutral-200 px-3 first:border-t-0">
            <input type="checkbox" checked={picked.includes(row.fitId)} disabled={row.isDuplicate} onChange={(event) => setPicked(event.target.checked ? [...picked, row.fitId] : picked.filter((id) => id !== row.fitId))} />
            <span className="w-24 font-mono text-[11px]">{row.date}</span>
            <span className="flex-1 truncate">{row.description}</span>
            <span className="font-mono tabular-nums">{money(row.amount)}</span>
          </label>
        ))}
      </div>
      {(history.data ?? []).map((item) => (
        <div key={item.id} className="flex h-8 items-center justify-between text-neutral-500">
          <span>{item.fileName ?? item.id}</span>
          <button type="button" onClick={() => void apiPost(`/api/v2/imports/${item.id}/revert`, {})}>Desfazer</button>
        </div>
      ))}
    </div>
  );
}
