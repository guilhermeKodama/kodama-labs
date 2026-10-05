"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LedgerFilter, LedgerQueryResult, LedgerRow, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { api, apiPatch, apiPost } from "@/lib/api";
import { money, signedClass } from "@/lib/money";
import { useAccounts, useCategories } from "@/lib/catalog";
import { useSession } from "@/lib/session";
import { collapseTransfers, queryFromView, type SavedView } from "@/components/ledger/model";
import { EntryDialog, type QuickDraft } from "@/components/ledger/entry-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const PERIODS = ["this_month", "last_month", "last_3m", "ytd", "last_12m", "all"] as const;
const LAYOUTS = ["table", "pivot", "chart", "board", "calendar"] as const;
const CHARTS = ["bar", "line", "pie", "sankey"] as const;

export function TransactionsScreen() {
  const t = useTranslations("app");
  const session = useSession();
  const accounts = useAccounts();
  const categories = useCategories(true);
  const queryClient = useQueryClient();
  const views = useQuery({
    queryKey: ["views", "ledger"],
    queryFn: () => api<SavedView[]>("/api/v2/views?dataset=ledger"),
  });
  const [viewId, setViewId] = useQueryState("view", parseAsString);
  const [createParam, setCreateParam] = useQueryState("create", parseAsString);
  const active = views.data?.find((view) => view.id === viewId) ?? views.data?.[0];
  const [edits, setEdits] = useState<Record<string, { config: ViewConfig; filters: LedgerFilter[] }>>({});
  const [selectedByView, setSelectedByView] = useState<Record<string, string[]>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const edited = active ? edits[active.id] : undefined;
  const config = edited?.config ?? active?.config ?? null;
  const filters = edited?.filters ?? active?.config.filters ?? [];
  const selected = active ? selectedByView[active.id] ?? [] : [];
  const draft = useMemo(() => {
    if (!createParam) return null;
    try {
      return JSON.parse(createParam) as QuickDraft;
    } catch {
      return null;
    }
  }, [createParam]);
  const open = manualOpen || draft != null;

  const save = useMutation({
    mutationFn: (next: { config: ViewConfig; filters: LedgerFilter[] }) =>
      apiPatch(`/api/v2/views/${active!.id}`, {
        config: { ...next.config, filters: active!.isBuiltin ? [] : next.filters, search: active!.isBuiltin ? undefined : next.config.search },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["views", "ledger"] }),
  });

  function setSelected(ids: string[]) {
    if (!active) return;
    setSelectedByView((current) => ({ ...current, [active.id]: ids }));
  }

  function update(nextConfig: ViewConfig, nextFilters = filters, persist = true) {
    if (!active) return;
    setEdits((current) => ({ ...current, [active.id]: { config: nextConfig, filters: nextFilters } }));
    if (persist) save.mutate({ config: nextConfig, filters: nextFilters });
  }

  const result = useQuery({
    queryKey: ["ledger", active?.id, config, filters],
    enabled: !!config,
    queryFn: () => apiPost<LedgerQueryResult>("/api/v2/ledger/query", queryFromView(config!, filters)),
  });

  const names = useMemo(() => {
    const entity = new Map((session.data?.entities ?? []).map((item) => [item.id, item.name]));
    const account = new Map((accounts.data ?? []).map((item) => [item.id, item.name]));
    const category = new Map((categories.data ?? []).map((item) => [item.id, item.name]));
    return { entity, account, category };
  }, [session.data, accounts.data, categories.data]);

  const rows = collapseTransfers(result.data?.rows ?? [], config?.transferDisplay ?? "group");

  async function remove(ids: string[]) {
    const response = await apiPost<{ batchId: string | null }>("/api/v2/ledger/bulk", { op: "delete", selection: { ids } });
    await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    toast(t("deleted"), {
      action: {
        label: t("undo"),
        onClick: () => {
          if (!response.batchId) return;
          void apiPost(`/api/v2/mutations/${response.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] }));
        },
      },
    });
    setSelected([]);
  }

  if (!config || !active) return <p className="p-6 text-sm text-muted-foreground">{t("loading")}</p>;
  const period = "preset" in config.period ? config.period : { preset: "this_month" as const, offset: 0 };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="flex gap-1 overflow-x-auto">
          {(views.data ?? []).map((view) => (
            <button key={view.id} type="button" className={`rounded-md px-3 py-1.5 text-sm ${view.id === active.id ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => void setViewId(view.id)}>
              {view.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => update({ ...config, period: { preset: period.preset, offset: period.offset - 1 } })}>‹</Button>
          <span className="text-sm">{t(period.preset)}{period.offset ? ` ${period.offset}` : ""}</span>
          <Button variant="outline" size="sm" disabled={period.offset >= 0} onClick={() => update({ ...config, period: { preset: period.preset, offset: period.offset + 1 } })}>›</Button>
          <Select value={period.preset} onValueChange={(preset) => update({ ...config, period: { preset: preset as typeof period.preset, offset: 0 } })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((item) => <SelectItem key={item} value={item}>{t(item)}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={config.layout} onValueChange={(layout) => update({ ...config, layout: layout as ViewConfig["layout"], groupBy: layout === "board" && config.groupBy.length === 0 ? [{ field: "accountId" }] : config.groupBy })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{LAYOUTS.map((item) => <SelectItem key={item} value={item}>{t(item)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" onClick={() => setManualOpen(true)}>{t("newEntry")}</Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {filters.map((filter, index) => (
          <button key={index} type="button" className="rounded-full border px-2 py-1 text-xs" onClick={() => update(config, filters.filter((_, item) => item !== index), !active.isBuiltin)}>
            {"field" in filter ? filter.field : ""} ×
          </button>
        ))}
        <FilterAdd
          entities={session.data?.entities ?? []}
          accounts={accounts.data ?? []}
          categories={categories.data ?? []}
          onAdd={(filter) => update(config, [...filters, filter], !active.isBuiltin)}
        />
        <Select
          value={config.groupBy[0] && "field" in config.groupBy[0] ? config.groupBy[0].field : "none"}
          onValueChange={(field) => update({ ...config, groupBy: field === "none" ? [] : [{ field: field as "entityId" }] })}
        >
          <SelectTrigger className="w-40"><SelectValue placeholder={t("group")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("noGroup")}</SelectItem>
            <SelectItem value="entityId">{t("entity")}</SelectItem>
            <SelectItem value="accountId">{t("account")}</SelectItem>
            <SelectItem value="categoryId">{t("category")}</SelectItem>
            <SelectItem value="kind">{t("kind")}</SelectItem>
          </SelectContent>
        </Select>
        {config.layout === "chart" ? (
          <Select value={config.chart?.type ?? "bar"} onValueChange={(type) => update({ ...config, chart: { ...config.chart, type: type as "bar", metric: config.chart?.metric ?? "sum" } })}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{CHARTS.map((item) => <SelectItem key={item} value={item}>{t(item)}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={async () => {
            const csv = await api<string>("/api/v2/ledger/export", { method: "POST", body: JSON.stringify({ query: { period: config.period, dateField: config.dateField, filters, search: config.search } }) });
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "capital.csv";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          CSV
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {config.layout === "table" ? (
          <EntryTable
            rows={rows}
            names={names}
            currency={session.data?.baseCurrency}
            selected={selected}
            onSelected={setSelected}
            onOpen={setDetailId}
            onPatch={async (id, patch) => {
              const response = await apiPatch<{ batchId: string | null }>(`/api/v2/ledger/entries/${id}`, patch);
              await queryClient.invalidateQueries({ queryKey: ["ledger"] });
              if (response.batchId) toast(t("saved"), { action: { label: t("undo"), onClick: () => void apiPost(`/api/v2/mutations/${response.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] })) } });
            }}
            categories={categories.data ?? []}
          />
        ) : null}
        {config.layout === "pivot" && result.data?.pivot ? <PivotTable pivot={result.data.pivot} names={names} /> : null}
        {config.layout === "chart" && config.chart?.type !== "sankey" ? <ChartView groups={result.data?.groups ?? []} names={names} /> : null}
        {config.layout === "chart" && config.chart?.type === "sankey" ? <SankeyView groups={result.data?.groups ?? []} names={names} /> : null}
        {config.layout === "board" ? <BoardView groups={result.data?.groups ?? []} rows={rows} names={names} onOpen={setDetailId} /> : null}
        {config.layout === "calendar" ? <CalendarView rows={rows} /> : null}
      </div>
      <footer className="flex items-center justify-between border-t px-4 py-2 font-mono text-sm tabular-nums">
        <span>{result.data?.totals.count ?? 0}</span>
        <span className={signedClass(result.data?.totals.values["sum:amountBase"] ?? 0)}>{money(result.data?.totals.values["sum:amountBase"] ?? 0, session.data?.baseCurrency)}</span>
      </footer>
      {selected.length > 0 ? (
        <div className="flex items-center gap-2 border-t bg-muted/40 px-4 py-2 text-sm">
          <span>{selected.length}</span>
          <Button size="sm" variant="outline" onClick={() => void apiPost("/api/v2/ledger/bulk", { op: "duplicate", selection: { ids: selected } }).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] }))}>{t("duplicate")}</Button>
          <Button size="sm" variant="destructive" onClick={() => void remove(selected)}>{t("delete")}</Button>
        </div>
      ) : null}
      <EntryDialog open={open} onOpenChange={(next) => { setManualOpen(next); if (!next) void setCreateParam(null); }} draft={draft} />
      <EntrySheet id={detailId} onClose={() => setDetailId(null)} onDelete={(id) => void remove([id])} names={names} currency={session.data?.baseCurrency} />
    </div>
  );
}

function labelOf(field: string, key: string | null, names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> }) {
  if (!key) return "—";
  if (field === "entityId") return names.entity.get(key) ?? key;
  if (field === "accountId") return names.account.get(key) ?? key;
  if (field === "categoryId") return names.category.get(key) ?? key;
  return key;
}

function EntryTable({
  rows,
  names,
  currency = "BRL",
  selected,
  onSelected,
  onOpen,
  onPatch,
  categories,
}: {
  rows: LedgerRow[];
  names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> };
  currency?: string;
  selected: string[];
  onSelected: (ids: string[]) => void;
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  categories: { id: string; name: string }[];
}) {
  const t = useTranslations("app");
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
        <tr>
          <th className="w-8 p-2" />
          <th className="p-2">{t("date")}</th>
          <th className="p-2">{t("description")}</th>
          <th className="p-2">{t("entity")}</th>
          <th className="p-2">{t("account")}</th>
          <th className="p-2">{t("category")}</th>
          <th className="p-2 text-right">{t("amount")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const neutral = row.transferGroupId != null && row.amountBase === 0;
          return (
            <tr key={row.id} className="border-t hover:bg-muted/40">
              <td className="p-2">
                <Checkbox checked={selected.includes(row.id)} onCheckedChange={(checked) => onSelected(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
              </td>
              <td className="p-2 font-mono text-xs">{row.date.slice(0, 10)}</td>
              <td className="p-2">
                <button type="button" className="text-left hover:underline" onClick={() => onOpen(row.id)}>{row.description}</button>
              </td>
              <td className="p-2">{names.entity.get(row.entityId)}</td>
              <td className="p-2">{names.account.get(row.accountId)}</td>
              <td className="p-2">
                <select className="bg-transparent" value={row.categoryId ?? ""} onChange={(event) => void onPatch(row.id, { categoryId: event.target.value || null })}>
                  <option value="">—</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </td>
              <td className={`p-2 text-right font-mono tabular-nums ${signedClass(row.amountBase, neutral)}`}>{neutral ? "↔" : money(row.amountBase, currency)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PivotTable({ pivot, names }: { pivot: NonNullable<LedgerQueryResult["pivot"]>; names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> } }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>{["", ...pivot.colKeys].map((key, index) => <th key={index} className="p-2 text-right font-normal text-muted-foreground">{index === 0 ? "" : labelOf("", key, names)}</th>)}</tr>
      </thead>
      <tbody>
        {pivot.rowKeys.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-t">
            <td className="p-2">{labelOf("", row, names)}</td>
            {pivot.cells[rowIndex].map((cell, colIndex) => <td key={colIndex} className="p-2 text-right font-mono tabular-nums">{cell == null ? "" : money(cell)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartView({ groups, names }: { groups: LedgerQueryResult["groups"]; names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> } }) {
  const data = groups.map((group) => ({ name: labelOf("", group.key, names), value: Math.abs(group.values["sum:amountBase"] ?? 0) }));
  return (
    <div className="h-80 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" hide={data.length > 8} />
          <YAxis />
          <Tooltip />
          <Bar dataKey="value" fill="currentColor" className="text-foreground" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SankeyView({ groups, names }: { groups: LedgerQueryResult["groups"]; names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> } }) {
  const income = groups.find((group) => group.key === "income")?.children ?? [];
  const expense = groups.find((group) => group.key === "expense")?.children ?? [];
  const column = (items: typeof income) => (
    <div className="flex flex-1 flex-col gap-1">
      {items.map((item) => (
        <div key={item.key} className="rounded-md bg-muted px-2 py-1 text-xs" style={{ flexGrow: Math.abs(item.values["sum:amountBase"] ?? 1) }}>
          {labelOf("categoryId", item.key, names)} · {money(item.values["sum:amountBase"] ?? 0)}
        </div>
      ))}
    </div>
  );
  return <div className="flex h-full gap-8 p-6">{column(income)}{column(expense)}</div>;
}

function BoardView({
  groups,
  rows,
  names,
  onOpen,
}: {
  groups: LedgerQueryResult["groups"];
  rows: LedgerRow[];
  names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> };
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto p-4">
      {groups.map((group) => (
        <section key={group.key} className="w-64 shrink-0 rounded-lg border">
          <header className="border-b px-3 py-2 text-sm font-medium">{labelOf("accountId", group.key, names)}</header>
          <div className="space-y-2 p-2">
            {rows.filter((row) => row.accountId === group.key || row.entityId === group.key || row.categoryId === group.key).slice(0, 30).map((row) => (
              <button key={row.id} type="button" className="block w-full rounded-md border px-2 py-2 text-left text-sm" onClick={() => onOpen(row.id)}>
                <span className="block truncate">{row.description}</span>
                <span className={`font-mono text-xs tabular-nums ${signedClass(row.amountBase)}`}>{money(row.amountBase)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CalendarView({ rows }: { rows: LedgerRow[] }) {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.date.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + row.amountBase);
  }
  return (
    <div className="grid grid-cols-7 gap-1 p-4 text-xs">
      {[...byDay.entries()].map(([day, total]) => (
        <div key={day} className="rounded-md border p-2">
          <div className="text-muted-foreground">{day.slice(8)}</div>
          <div className={`font-mono tabular-nums ${signedClass(total)}`}>{money(total)}</div>
        </div>
      ))}
    </div>
  );
}

function FilterAdd({
  entities,
  accounts,
  categories,
  onAdd,
}: {
  entities: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; isArchived: boolean }[];
  onAdd: (filter: LedgerFilter) => void;
}) {
  const t = useTranslations("app");
  const [field, setField] = useState<"entityId" | "accountId" | "categoryId" | "kind">("entityId");
  const [value, setValue] = useState("");
  const options = field === "entityId" ? entities : field === "accountId" ? accounts : field === "categoryId" ? categories.filter((item) => !item.isArchived) : [{ id: "expense", name: "expense" }, { id: "income", name: "income" }, { id: "transfer", name: "transfer" }, { id: "investment", name: "investment" }];
  return (
    <div className="flex items-center gap-1">
      <Select value={field} onValueChange={(next) => { setField(next as typeof field); setValue(""); }}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="entityId">{t("entity")}</SelectItem>
          <SelectItem value="accountId">{t("account")}</SelectItem>
          <SelectItem value="categoryId">{t("category")}</SelectItem>
          <SelectItem value="kind">{t("kind")}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="w-40"><SelectValue placeholder={t("filter")} /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={!value} onClick={() => onAdd({ field, op: "in", values: [value] })}>+</Button>
    </div>
  );
}

function EntrySheet({
  id,
  onClose,
  onDelete,
  names,
  currency,
}: {
  id: string | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  names: { entity: Map<string, string>; account: Map<string, string>; category: Map<string, string> };
  currency?: string;
}) {
  const t = useTranslations("app");
  const entry = useQuery({
    queryKey: ["entry", id],
    enabled: !!id,
    queryFn: () => api<LedgerRow>(`/api/v2/ledger/entries/${id}`),
  });
  const row = entry.data;
  return (
    <Sheet open={!!id} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{row?.description ?? t("loading")}</SheetTitle>
        </SheetHeader>
        {row ? (
          <div className="space-y-2 p-4 text-sm">
            <p className={`font-mono text-lg tabular-nums ${signedClass(row.amountBase)}`}>{money(row.amountBase, currency)}</p>
            <p>{row.date.slice(0, 10)}</p>
            <p>{names.entity.get(row.entityId)}</p>
            <p>{names.account.get(row.accountId)}</p>
            <p>{row.categoryId ? names.category.get(row.categoryId) : "—"}</p>
            <p className="text-muted-foreground">{row.notes}</p>
            <Button variant="destructive" onClick={() => { onDelete(row.id); onClose(); }}>{t("delete")}</Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
