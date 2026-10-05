"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";
import type { LedgerFilter, LedgerQueryResult, LedgerRow, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { api, apiPatch, apiPost } from "@/lib/api";
import { money, todayIso } from "@/lib/money";
import { useAccounts, useCategories } from "@/lib/catalog";
import { useSession } from "@/lib/session";
import { AppFrame, Btn } from "@/components/shell/chrome";

interface SavedView {
  id: string;
  name: string;
  isBuiltin: boolean;
  isFavorite: boolean;
  config: ViewConfig;
}

const PERIOD_LABEL: Record<string, string> = {
  this_month: "Este mês",
  last_month: "Mês passado",
  last_3m: "3 meses",
  ytd: "Ano",
  last_12m: "12 meses",
  all: "Tudo",
};

export function TransactionsScreen() {
  const session = useSession();
  const accounts = useAccounts();
  const categories = useCategories(true);
  const queryClient = useQueryClient();
  const views = useQuery({ queryKey: ["views", "ledger"], queryFn: () => api<SavedView[]>("/api/v2/views?dataset=ledger") });
  const [viewId, setViewId] = useQueryState("view", parseAsString);
  const [createParam, setCreateParam] = useQueryState("create", parseAsString);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<LedgerRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const active = views.data?.find((view) => view.id === viewId) ?? views.data?.[0];
  const [edits, setEdits] = useState<Record<string, { config: ViewConfig; filters: LedgerFilter[] }>>({});
  const edited = active ? edits[active.id] : undefined;
  const config = edited?.config ?? active?.config;
  const filters = edited?.filters ?? active?.config.filters ?? [];

  const save = useMutation({
    mutationFn: (next: { config: ViewConfig; filters: LedgerFilter[] }) =>
      apiPatch(`/api/v2/views/${active!.id}`, { config: { ...next.config, filters: active!.isBuiltin ? [] : next.filters } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["views", "ledger"] }),
  });

  function update(next: ViewConfig, nextFilters = filters) {
    if (!active) return;
    setEdits((current) => ({ ...current, [active.id]: { config: next, filters: nextFilters } }));
    save.mutate({ config: next, filters: nextFilters });
  }

  const result = useQuery({
    queryKey: ["ledger", active?.id, config, filters, search],
    enabled: !!config,
    queryFn: () => apiPost<LedgerQueryResult>("/api/v2/ledger/query", {
      period: config!.period,
      dateField: config!.dateField,
      filters,
      search: search || undefined,
      groupBy: config!.groupBy,
      aggregations: [{ fn: "sum", field: "amountBase" }, { fn: "count", field: "amountBase" }],
      sort: config!.sort,
      includeRows: true,
      page: { limit: 300 },
    }),
  });

  const names = useMemo(() => ({
    entity: new Map((session.data?.entities ?? []).map((item) => [item.id, item.name])),
    account: new Map((accounts.data ?? []).map((item) => [item.id, item.name])),
    category: new Map((categories.data ?? []).map((item) => [item.id, item.name])),
  }), [session.data, accounts.data, categories.data]);

  const draft = useMemo(() => {
    if (!createParam) return null;
    try { return JSON.parse(createParam) as { description: string; amount: number; date: string }; } catch { return null; }
  }, [createParam]);

  if (!config || !active) return <AppFrame crumbs={["Transações", "Lançamentos"]}>…</AppFrame>;
  const period = "preset" in config.period ? config.period : { preset: "this_month" as const, offset: 0 };
  const rows = result.data?.rows ?? [];
  const currency = session.data?.baseCurrency ?? "BRL";

  return (
    <AppFrame
      crumbs={["Transações", "Lançamentos"]}
      actions={
        <>
          <span className="inline-flex h-[26px] items-center overflow-hidden rounded-[6px] border border-neutral-300 text-[12px]">
            <button type="button" className="px-2" onClick={() => update({ ...config, period: { preset: period.preset, offset: period.offset - 1 } })}>‹</button>
            <span className="border-x border-neutral-200 px-2">{PERIOD_LABEL[period.preset]}</span>
            <button type="button" className="px-2 disabled:text-neutral-300" disabled={period.offset >= 0} onClick={() => update({ ...config, period: { preset: period.preset, offset: period.offset + 1 } })}>›</button>
          </span>
          <Btn onClick={() => window.location.assign("/settings")}>Importar extrato</Btn>
          <Btn primary onClick={() => setCreating(true)}>+ Nova</Btn>
        </>
      }
    >
      <div className="-mx-3.5 -mt-3.5 flex items-center gap-0.5 overflow-x-auto border-b border-neutral-200 px-2.5">
        {(views.data ?? []).map((view) => (
          <button key={view.id} type="button" onClick={() => void setViewId(view.id)} className={`inline-flex h-[38px] items-center px-2 text-[12.5px] whitespace-nowrap ${view.id === active.id ? "border-b-2 border-neutral-950 font-medium" : "text-neutral-400"}`}>
            {view.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((filter, index) => (
          <button key={index} type="button" className="inline-flex h-6 items-center rounded-[6px] border border-neutral-200 bg-neutral-50 px-2 text-[12px]" onClick={() => update(config, filters.filter((_, item) => item !== index))}>
            {"field" in filter ? String(filter.field) : ""} ✕
          </button>
        ))}
        <Btn dashed onClick={() => update(config, [...filters, { field: "kind", op: "in", values: ["expense"] }])}>+ Filtro</Btn>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nesta view…" className="ml-auto h-[26px] w-[170px] rounded-[6px] border border-neutral-300 px-2 text-[12px] outline-none" />
        <Btn>Exibição</Btn>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <div className="grid h-[34px] grid-cols-[28px_48px_minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_150px] items-center gap-2 px-2.5 text-[11.5px] text-neutral-400">
          <span /><span>Data</span><span>Descrição</span><span>Entidade</span><span>Conta</span><span>Categoria</span><span className="text-right">Valor</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="grid h-[34px] grid-cols-[28px_48px_minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_150px] items-center gap-2 border-t border-neutral-200 px-2.5 text-[12.5px]">
            <input type="checkbox" checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
            <span className="font-mono text-[11.5px] text-neutral-400">{row.date.slice(5, 10)}</span>
            <button type="button" className="truncate text-left" onClick={() => setDetail(row)}>{row.description}</button>
            <span><span className="inline-flex h-[18px] items-center rounded border border-neutral-200 px-1.5 text-[11px]">{names.entity.get(row.entityId)}</span></span>
            <span className="truncate text-neutral-600">{names.account.get(row.accountId)}</span>
            <span className="truncate text-neutral-600">{row.categoryId ? names.category.get(row.categoryId) : "—"}</span>
            <span className={`text-right font-mono tabular-nums ${row.amountBase > 0 ? "text-emerald-700" : ""}`}>{money(row.amountBase, currency)}</span>
          </div>
        ))}
        <div className="grid h-[34px] grid-cols-[28px_48px_minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_150px] items-center border-t border-neutral-200 px-2.5 text-[12px]">
          <span className="col-span-6 text-neutral-400">{result.data?.totals.count ?? 0}</span>
          <span className="text-right font-mono font-medium tabular-nums">{money(result.data?.totals.values["sum:amountBase"] ?? 0, currency)}</span>
        </div>
      </div>
      {selected.length > 0 ? (
        <div className="flex items-center gap-2 text-[12px]">
          <span>{selected.length} selecionadas</span>
          <Btn onClick={() => void remove(selected, queryClient, () => setSelected([]))}>Excluir</Btn>
        </div>
      ) : null}
      {detail ? (
        <aside className="fixed top-0 right-0 bottom-0 z-30 flex w-[320px] flex-col gap-3.5 border-l border-neutral-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{detail.description}</span>
            <button type="button" className="ml-auto text-neutral-400" onClick={() => setDetail(null)}>✕</button>
          </div>
          <span className="font-mono text-[22px] font-medium tabular-nums">{money(detail.amountBase, currency)}</span>
          <div className="grid grid-cols-2 gap-3 text-[12.5px]">
            <Field k="Data" v={detail.date.slice(0, 10)} />
            <Field k="Entidade" v={names.entity.get(detail.entityId) ?? ""} />
            <Field k="Conta" v={names.account.get(detail.accountId) ?? ""} />
            <Field k="Categoria" v={detail.categoryId ? names.category.get(detail.categoryId) ?? "—" : "—"} />
          </div>
          <div className="mt-auto flex gap-1.5">
            <Btn ghost onClick={() => void remove([detail.id], queryClient, () => setDetail(null))}>Excluir</Btn>
          </div>
        </aside>
      ) : null}
      {(creating || draft) ? (
        <CreateDialog
          initial={draft}
          accounts={accounts.data ?? []}
          onClose={() => { setCreating(false); void setCreateParam(null); }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["ledger"] })}
        />
      ) : null}
    </AppFrame>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><p className="text-[11px] text-neutral-400">{k}</p><p>{v}</p></div>;
}

async function remove(ids: string[], queryClient: ReturnType<typeof useQueryClient>, done: () => void) {
  const response = await apiPost<{ batchId: string | null }>("/api/v2/ledger/bulk", { op: "delete", selection: { ids } });
  await queryClient.invalidateQueries({ queryKey: ["ledger"] });
  toast("Excluído", { action: { label: "Desfazer", onClick: () => { if (response.batchId) void apiPost(`/api/v2/mutations/${response.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] })); } } });
  done();
}

function CreateDialog({
  initial,
  accounts,
  onClose,
  onSaved,
}: {
  initial: { description: string; amount: number; date: string } | null;
  accounts: { id: string; name: string; archivedAt: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [accountId, setAccountId] = useState(accounts.find((account) => !account.archivedAt)?.id ?? "");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={onClose}>
      <form
        className="w-[420px] space-y-3 rounded-[10px] border border-neutral-200 bg-white p-4"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void apiPost("/api/v2/ledger/entries", { kind: "expense", accountId, amount: Number(amount), description, date }).then(() => { onSaved(); onClose(); });
        }}
      >
        <p className="text-[14px] font-semibold">Nova</p>
        <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrição" className="h-[26px] w-full rounded-[6px] border border-neutral-300 px-2 text-[12px]" />
        <div className="flex gap-2">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Valor" className="h-[26px] flex-1 rounded-[6px] border border-neutral-300 px-2 text-[12px]" />
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-[26px] rounded-[6px] border border-neutral-300 px-2 text-[12px]" />
        </div>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="h-[26px] w-full rounded-[6px] border border-neutral-300 px-2 text-[12px]">
          {accounts.filter((account) => !account.archivedAt).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <div className="flex justify-end gap-1.5"><Btn onClick={onClose}>Cancelar</Btn><Btn primary type="submit">Salvar</Btn></div>
      </form>
    </div>
  );
}
