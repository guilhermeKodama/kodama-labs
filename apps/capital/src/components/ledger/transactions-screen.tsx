"use client";

import { useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";
import type { LedgerFilter, LedgerQueryInput, LedgerQueryResult, LedgerSelectionQuery, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { useRouter } from "@/i18n/navigation";
import { api, apiDelete, apiPatch, apiPost } from "@/lib/api";
import { useNames } from "@/lib/catalog";
import { AppFrame, Btn, TextInput } from "@/components/shell/chrome";
import { BulkBar } from "./bulk-bar";
import { EntryDialog, type QuickDraft } from "./entry-dialog";
import { EntrySheet } from "./entry-sheet";
import { filterLabel } from "./fields";
import { BoardView, CalendarView, ChartView, PivotView, SankeyView } from "./layouts";
import { selectionStats, toDisplayRows, type DisplayRow } from "./rows";
import { LedgerTable } from "./table";
import { DisplayMenu, FilterChips, PeriodControl, rangeLabel } from "./toolbar";

interface SavedView {
  id: string;
  name: string;
  isBuiltin: boolean;
  isFavorite: boolean;
  config: ViewConfig;
}

/** A temporary narrowing (click-through from a total), never saved into the view. */
interface Drill {
  label?: string;
  filters: LedgerFilter[];
  period?: ViewConfig["period"];
}

const LAYOUT_GLYPH: Record<string, string> = { table: "▦", pivot: "▤", chart: "▮", board: "▥", calendar: "▣" };

function selectionOf(config: ViewConfig): LedgerSelectionQuery {
  return { period: config.period, dateField: config.dateField, filters: config.filters, search: config.search || undefined, deleted: "exclude" };
}

function queryOf(config: ViewConfig, cursor?: string): LedgerQueryInput {
  const base = { ...selectionOf(config), aggregations: [{ fn: "sum" as const, field: "amountBase" as const }, { fn: "count" as const, field: "amountBase" as const }], sort: config.sort };
  switch (config.layout) {
    case "pivot": {
      const [rows, cols] = config.groupBy;
      return { ...base, includeRows: false, groupBy: rows ? [rows] : [], ...(rows && cols ? { pivot: { rows, cols, measure: { fn: "sum", field: "amountBase" } } } : {}) };
    }
    case "chart":
      if (config.chart.type === "sankey") return { ...base, includeRows: false, groupBy: [{ field: "kind" }, { field: "categoryId" }] };
      return { ...base, includeRows: false, groupBy: [config.groupBy[0] ?? { field: "date", bucket: "month" }] };
    case "calendar":
      return { ...base, includeRows: true, groupBy: [], page: { limit: 500, cursor } };
    case "board":
      return { ...base, includeRows: true, groupBy: config.groupBy.slice(0, 1), page: { limit: 300, cursor } };
    default:
      return { ...base, includeRows: true, groupBy: config.groupBy, page: { limit: 200, cursor } };
  }
}

export function TransactionsScreen() {
  const names = useNames();
  const router = useRouter();
  const queryClient = useQueryClient();
  const views = useQuery({ queryKey: ["views", "ledger"], queryFn: () => api<SavedView[]>("/api/v2/views?dataset=ledger") });
  const [viewId, setViewId] = useQueryState("view", parseAsString);
  const [drillParam, setDrillParam] = useQueryState("drill", parseAsString);
  const [createParam, setCreateParam] = useQueryState("create", parseAsString);
  const active = views.data?.find((view) => view.id === viewId) ?? views.data?.[0];
  const [overrides, setOverrides] = useState<Record<string, ViewConfig>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allInView, setAllInView] = useState(false);
  const [detail, setDetail] = useState<DisplayRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saved = active ? overrides[active.id] ?? active.config : null;
  const drill = useMemo<Drill | null>(() => {
    if (!drillParam) return null;
    try {
      return JSON.parse(drillParam) as Drill;
    } catch {
      return null;
    }
  }, [drillParam]);
  const draft = useMemo<QuickDraft | null>(() => {
    if (!createParam) return null;
    try {
      return JSON.parse(createParam) as QuickDraft;
    } catch {
      return null;
    }
  }, [createParam]);
  const config: ViewConfig | null = saved
    ? drill
      ? { ...saved, filters: [...saved.filters, ...drill.filters], period: drill.period ?? saved.period, layout: "table" }
      : saved
    : null;

  const patchView = useMutation({
    mutationFn: (body: { id: string; patch: Record<string, unknown> }) => apiPatch<SavedView>(`/api/v2/views/${body.id}`, body.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["views", "ledger"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  function resetSelection() {
    setSelected(new Set());
    setAllInView(false);
  }

  /** Every display change auto-saves into the view; "Todas" keeps only display preferences server-side. */
  function update(patch: Partial<ViewConfig>) {
    if (!active || !saved) return;
    const next = { ...saved, ...patch };
    setOverrides((current) => ({ ...current, [active.id]: next }));
    patchView.mutate({ id: active.id, patch: { config: next } });
    resetSelection();
  }

  function onSearch(text: string) {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update({ search: text.trim() || undefined }), 350);
  }

  const result = useInfiniteQuery({
    queryKey: ["ledger", "view", active?.id, config],
    enabled: !!config,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiPost<LedgerQueryResult>("/api/v2/ledger/query", queryOf(config!, pageParam)),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? last.pageInfo.nextCursor ?? undefined : undefined),
  });
  const first = result.data?.pages[0];
  const rawRows = useMemo(() => result.data?.pages.flatMap((p) => p.rows) ?? [], [result.data]);
  const rows = useMemo(() => toDisplayRows(rawRows, config?.transferDisplay ?? "group"), [rawRows, config?.transferDisplay]);
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const totals = { count: first?.totals.count ?? 0, sum: first?.totals.values["sum:amountBase"] ?? 0 };

  async function bulk(op: Record<string, unknown>, message: string) {
    const selection = allInView && config ? { query: selectionOf(config) } : { ids: selectedRows.flatMap((row) => row.legIds) };
    try {
      const res = await apiPost<{ batchId: string | null; affected: number }>("/api/v2/ledger/bulk", { ...op, selection });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["ledger"] }), queryClient.invalidateQueries({ queryKey: ["budgets"] })]);
      toast(`${message} · ${res.affected}`, {
        action: res.batchId
          ? {
              label: "Desfazer",
              onClick: () =>
                void apiPost(`/api/v2/mutations/${res.batchId}/undo`, {})
                  .then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] }))
                  .catch((error: Error) => toast.error(error.message)),
            }
          : undefined,
      });
      resetSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falhou");
    }
  }

  async function removeRow(row: DisplayRow) {
    setDetail(null);
    try {
      const res = await apiPost<{ batchId: string | null }>("/api/v2/ledger/bulk", { op: "delete", selection: { ids: row.legIds } });
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
      toast(`“${row.description}” foi para a lixeira`, {
        action: res.batchId ? { label: "Desfazer", onClick: () => void apiPost(`/api/v2/mutations/${res.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] })) } : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falhou");
    }
  }

  async function setCategory(row: DisplayRow, categoryId: string | null) {
    try {
      const res = await apiPatch<{ batchId: string | null }>(`/api/v2/ledger/entries/${row.id}`, { categoryId });
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
      toast(`Categoria de “${row.description}” alterada`, {
        action: res.batchId ? { label: "Desfazer", onClick: () => void apiPost(`/api/v2/mutations/${res.batchId}/undo`, {}).then(() => queryClient.invalidateQueries({ queryKey: ["ledger"] })) } : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falhou");
    }
  }

  async function newView() {
    const view = await apiPost<SavedView>("/api/v2/views", { name: "Nova view", dataset: "ledger", isFavorite: true, config: {} });
    await queryClient.invalidateQueries({ queryKey: ["views", "ledger"] });
    void setViewId(view.id);
    setDisplayOpen(true);
  }

  async function exportCsv() {
    if (!config) return;
    try {
      const csv = await api<string>("/api/v2/ledger/export", { method: "POST", body: JSON.stringify({ query: selectionOf(config) }) });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `capital-${active?.name ?? "lancamentos"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar");
    }
  }

  function drillInto(filters: LedgerFilter[], period?: ViewConfig["period"]) {
    resetSelection();
    void setDrillParam(JSON.stringify({ filters, period }));
  }

  const tabs = (
    <div className="flex h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-stroke-3 px-2.5">
      {(views.data ?? []).map((view) => {
        const on = view.id === active?.id;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => {
              void setViewId(view.id);
              void setDrillParam(null);
              resetSelection();
              setSearch(null);
            }}
            className={`inline-flex h-full items-center gap-1.5 border-b-2 px-2 text-[12.5px] whitespace-nowrap ${on ? "border-fg-1 font-medium text-fg-1" : "border-transparent text-fg-3 hover:text-fg-strong"}`}
          >
            <span className="text-[11px] text-fg-3">{LAYOUT_GLYPH[view.config.layout] ?? "▦"}</span>
            {view.name}
            {view.isBuiltin ? <span className="text-[10px] text-fg-4">fixa</span> : null}
          </button>
        );
      })}
      <button type="button" title="Nova view" onClick={() => void newView()} className="px-2 text-[14px] text-fg-3 hover:text-fg-strong">
        +
      </button>
    </div>
  );

  if (!active || !config || !saved) {
    return (
      <AppFrame crumbs={["Transações", "Lançamentos"]} subheader={tabs}>
        <p className="text-[12.5px] text-fg-3">{views.isError ? "Não foi possível carregar as views." : "Carregando…"}</p>
      </AppFrame>
    );
  }

  const searchValue = search ?? saved.search ?? "";

  return (
    <AppFrame
      crumbs={["Transações", active.name]}
      subheader={tabs}
      actions={
        <>
          <Btn onClick={() => router.push("/settings?page=imports")}>Importar extrato</Btn>
          <Btn primary onClick={() => setCreating(true)}>+ Nova</Btn>
        </>
      }
      overlay={detail ? <EntrySheet key={detail.id} row={detail} names={names} onClose={() => setDetail(null)} onDelete={(row) => void removeRow(row)} /> : null}
    >
      <div className="relative flex flex-wrap items-center gap-1.5">
        <PeriodControl config={saved} label={rangeLabel(first?.range, "preset" in saved.period ? saved.period.preset : "")} onChange={(period) => update({ period })} />
        <FilterChips filters={saved.filters} names={names} onChange={(filters) => update({ filters })} />
        <span className="flex-1" />
        <TextInput value={searchValue} onChange={onSearch} placeholder="Buscar nesta view…" className="w-[180px]" />
        <span className="relative">
          <Btn onClick={() => setDisplayOpen((v) => !v)}>Exibição</Btn>
          <DisplayMenu
            key={`${active.id}:${active.name}`}
            open={displayOpen}
            onClose={() => setDisplayOpen(false)}
            name={active.name}
            isBuiltin={active.isBuiltin}
            isFavorite={active.isFavorite}
            config={saved}
            onRename={(name) => patchView.mutate({ id: active.id, patch: { name } })}
            onFavorite={(isFavorite) => patchView.mutate({ id: active.id, patch: { isFavorite } })}
            onConfig={update}
            onDuplicate={() =>
              void apiPost<SavedView>(`/api/v2/views/${active.id}/duplicate`, { name: `${active.name} (cópia)` }).then(async (view) => {
                await queryClient.invalidateQueries({ queryKey: ["views", "ledger"] });
                void setViewId(view.id);
                setDisplayOpen(false);
              })
            }
            onDelete={() => {
              if (!window.confirm(`Excluir a view “${active.name}”? Os lançamentos não são afetados.`)) return;
              void apiDelete(`/api/v2/views/${active.id}`).then(async () => {
                await queryClient.invalidateQueries({ queryKey: ["views", "ledger"] });
                void setViewId(null);
                setDisplayOpen(false);
              });
            }}
            onExport={() => void exportCsv()}
          />
        </span>
      </div>
      {drill ? (
        <div className="flex items-center gap-2 rounded-lg border border-stroke-3 bg-fill-4 px-3 py-1.5 text-[12px]">
          <span className="text-fg-3">Detalhe:</span>
          <span className="truncate">{drill.label ?? drill.filters.map((f) => filterLabel(f, names)).join(" · ")}</span>
          <button type="button" className="ml-auto text-fg-muted underline" onClick={() => void setDrillParam(null)}>voltar à view</button>
        </div>
      ) : null}
      {result.isError ? <p className="text-[12.5px] text-neg">{(result.error as Error).message}</p> : null}
      {config.layout === "table" ? (
        <LedgerTable
          rows={rows}
          groups={first?.groups ?? []}
          config={config}
          names={names}
          selected={selected}
          onSelect={(ids, on) => {
            setAllInView(false);
            setSelected((current) => {
              const next = new Set(current);
              for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
              }
              return next;
            });
          }}
          onOpen={setDetail}
          onCategory={(row, categoryId) => void setCategory(row, categoryId)}
          totals={totals}
          hasMore={!!result.hasNextPage}
          onMore={() => void result.fetchNextPage()}
          loading={result.isFetching}
        />
      ) : null}
      {config.layout === "pivot" ? (
        first?.pivot ? <PivotView pivot={first.pivot} config={config} names={names} onDrill={(filters) => drillInto(filters)} /> : <p className="text-[12.5px] text-fg-3">Escolha Linhas e Colunas em Exibição.</p>
      ) : null}
      {config.layout === "chart" && config.chart.type !== "sankey" ? <ChartView groups={first?.groups ?? []} config={config} names={names} onDrill={(filters) => drillInto(filters)} /> : null}
      {config.layout === "chart" && config.chart.type === "sankey" ? <SankeyView groups={first?.groups ?? []} names={names} /> : null}
      {config.layout === "board" ? <BoardView rows={rows} groups={first?.groups ?? []} config={config} names={names} onOpen={setDetail} /> : null}
      {config.layout === "calendar" ? (
        <CalendarView rows={rows} range={first?.range ?? { from: null, to: null }} names={names} onDay={(day) => drillInto([], { from: day, to: day })} />
      ) : null}
      {selected.size > 0 || allInView ? (
        <BulkBar
          stats={selectionStats(selectedRows)}
          names={names}
          allInView={allInView}
          canSelectAll={selected.size === rows.length && totals.count > rows.length}
          totalInView={totals.count}
          onSelectAll={() => setAllInView(true)}
          onClear={resetSelection}
          onCategory={(categoryId, createRule) => void bulk({ op: "update", patch: { categoryId }, createRule }, "Categoria alterada")}
          onEntity={(entityId) => void bulk({ op: "update", patch: { entityId } }, `Movido para ${names.entity.get(entityId)}`)}
          onToggleTax={() => void bulk({ op: "update", patch: { toggleTaxDeductible: true } }, "Marcação de IR alternada")}
          onDuplicate={() => void bulk({ op: "duplicate" }, "Duplicadas")}
          onDelete={() => {
            const n = allInView ? totals.count : selected.size;
            if (n > 20 && !window.confirm(`Mandar ${n} lançamentos para a lixeira?`)) return;
            void bulk({ op: "delete" }, "Na lixeira");
          }}
        />
      ) : null}
      {creating || draft ? (
        <EntryDialog
          names={names}
          draft={draft}
          onClose={() => {
            setCreating(false);
            void setCreateParam(null);
          }}
        />
      ) : null}
    </AppFrame>
  );
}
