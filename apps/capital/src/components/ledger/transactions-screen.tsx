"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import type { GroupKey, LedgerDisplayQueryResult, LedgerFilter, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Btn, TextInput } from "@/components/cap";
import { Page } from "@/components/shell/page";
import { apiDelete, apiPost } from "@/lib/api/client";
import { useNames } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { normalizeLedgerConfig } from "@/lib/ledger/columns";
import { dayDraft, drillDraft, drillFiltersDraft, type DrillCell } from "@/lib/ledger/drill";
import { currentMonth, periodDays, todayIso } from "@/lib/ledger/period";
import { selectionStats } from "@/lib/ledger/selection";
import { useLedgerViews, useViewSaver, type LedgerView } from "@/lib/ledger/use-views";
import { applyViewDraft, decodeViewDraft, encodeViewDraft, isDirty, parseViewParam, type ViewDraft } from "@/lib/ledger/view-draft";
import { boardKey, isPagedLayout, layoutQuery, pivotKeys, viewSelection } from "@/lib/ledger/view-query";
import { planViewUpdate } from "@/lib/ledger/view-update";
import { BulkBar } from "./bulk-bar";
import { useLedgerLabels } from "./fields";
import { TransactionsHeaderActions } from "./header-actions";
import { BoardView, CalendarView, ChartView, PivotView, SankeyView } from "./layouts";
import { LedgerOverlays, useLedgerOverlays } from "./overlays";
import type { DisplayRow } from "./rows";
import { KpiSummary, LedgerTable } from "./table";
import { DisplayMenu, FilterChips, PeriodControl, ViewTabs } from "./toolbar";

const URL_STATE = { view: parseAsString, draft: parseAsString, q: parseAsString };
type SetParams = ReturnType<typeof useQueryStates<typeof URL_STATE>>[1];

/** The value after it has stopped changing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/**
 * Transações › Lançamentos: the saved views as tabs (mockup ViewsScreen
 * 2047–3125). The view comes from ?view (an id, or seed:<key> for a
 * seeded one), the changes on screen that are not saved from ?draft and
 * the transient search from ?q. Each view mounts its own screen, so
 * switching views (tabs, sidebar, links) starts with a clean selection.
 */
export function TransactionsScreen() {
  const t = useTranslations("ledger");
  const tc = useTranslations("common");
  const views = useLedgerViews();
  const overlays = useLedgerOverlays();
  const [params, setParams] = useQueryStates(URL_STATE);
  const list = useMemo(() => views.data ?? [], [views.data]);
  const wanted = parseViewParam(params.view);
  const active =
    (wanted ? list.find((view) => ("viewId" in wanted ? view.id === wanted.viewId : view.seedKey === wanted.seedKey)) : undefined) ??
    list.find((view) => view.isBuiltin) ??
    list[0] ??
    null;

  // ?view=seed:ir (e.g. the old /tax link) becomes the view's own id.
  // A seeded view the user deleted (or one not seeded yet, like PJ before a business entity) falls back to Todas.
  const seedKey = wanted && "seedKey" in wanted ? wanted.seedKey : null;
  const loaded = views.isSuccess;
  useEffect(() => {
    if (!seedKey || !loaded) return;
    void setParams({ view: active?.seedKey === seedKey ? active.id : null }, { history: "replace" });
  }, [seedKey, loaded, active, setParams]);

  const open = (id: string | null) => void setParams({ view: id, draft: null, q: null });
  const create = useAppMutation({
    event: "views.write",
    mutationFn: () => apiPost<LedgerView>("/api/v2/views", { name: t("tabs.newView"), dataset: "ledger", isFavorite: true, config: {} }),
    onSuccess: (view) => {
      open(view.id);
      overlays.setDisplayOpen(true);
    },
  });
  const recreate = useAppMutation({
    event: "views.write",
    mutationFn: (view: LedgerView) => apiPost<LedgerView>("/api/v2/views", { name: view.name, dataset: "ledger", isFavorite: view.isFavorite, config: view.config }),
    onSuccess: (view) => open(view.id),
  });
  const remove = useAppMutation({
    event: "views.write",
    mutationFn: (view: LedgerView) => apiDelete(`/api/v2/views/${view.id}`),
    onSuccess: (_, view) => {
      overlays.setDisplayOpen(false);
      open(null);
      // Views are not in the undo log: "Desfazer" creates the view again from what it was.
      toast(t("display.deleted", { name: view.name }), { action: { label: tc("undo"), onClick: () => recreate.mutate(view) } });
    },
  });

  const tabs = (
    <ViewTabs
      views={list}
      activeId={active?.id ?? null}
      dirty={!!active && isDirty(normalizeLedgerConfig(active.config), decodeViewDraft(params.draft))}
      onPick={(view) => open(view.id)}
      onNew={() => create.mutate()}
      creating={create.isPending}
    />
  );

  if (!active) {
    return (
      <Page crumbs={[t("crumb")]} subheader={tabs}>
        <p className="text-[12.5px] text-fg-3">{views.isError ? t("viewsError") : tc("loading")}</p>
      </Page>
    );
  }
  return <ViewScreen key={active.id} view={active} tabs={tabs} draftParam={params.draft} search={params.q ?? ""} setParams={setParams} onDelete={() => remove.mutate(active)} />;
}

function ViewScreen({
  view,
  tabs,
  draftParam,
  search,
  setParams,
  onDelete,
}: {
  view: LedgerView;
  tabs: ReactNode;
  draftParam: string | null;
  search: string;
  setParams: SetParams;
  onDelete: () => void;
}) {
  const t = useTranslations("ledger");
  const fmt = useFmt();
  const names = useNames();
  const labels = useLedgerLabels(names);
  const overlays = useLedgerOverlays();
  const errorText = useErrorMessage();
  const saveView = useViewSaver();

  const saved = useMemo(() => normalizeLedgerConfig(view.config), [view.config]);
  const draft = useMemo(() => decodeViewDraft(draftParam), [draftParam]);
  const config = useMemo(() => applyViewDraft(saved, draft), [saved, draft]);
  const dirty = isDirty(saved, draft);

  const [searchText, setSearchText] = useState(search);
  const q = useDebounced(searchText.trim(), 250);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [allInView, setAllInView] = useState(false);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAllInView(false);
  }, []);

  const setDraft = (next: ViewDraft | null) => void setParams({ draft: encodeViewDraft(next) });
  /** Every change on screen: saved at once, or kept in the draft (see planViewUpdate). */
  const update = (patch: Partial<ViewConfig>) => {
    const plan = planViewUpdate({ saved, draft, isBuiltin: view.isBuiltin, patch });
    if (plan.save) saveView(view.id, { config: plan.save });
    if (encodeViewDraft(plan.draft) !== draftParam) setDraft(plan.draft);
    if ("filters" in patch || "period" in patch || "layout" in patch || "dateField" in patch) clearSelection();
  };
  const drill = (cells: DrillCell[]) => {
    clearSelection();
    setDraft(drillDraft(saved, config, cells));
  };
  const drillFilters = (groupKeys: GroupKey[], filters: LedgerFilter[]) => {
    clearSelection();
    setDraft(drillFiltersDraft(saved, config, groupKeys, filters));
  };

  // ---- data ----
  const body = useMemo(() => layoutQuery(config, q), [config, q]);
  const paged = isPagedLayout(config);
  const sankey = config.layout === "chart" && config.chart.type === "sankey";
  const pages = useInfiniteQuery({
    queryKey: keys.ledgerQuery({ ...body, paged: true }),
    enabled: paged,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiPost<LedgerDisplayQueryResult>("/api/v2/ledger/query", { ...body, page: { ...body.page, cursor: pageParam } }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    placeholderData: keepPreviousData,
  });
  const single = useQuery({
    queryKey: keys.ledgerQuery(body),
    enabled: !paged && !sankey,
    queryFn: () => apiPost<LedgerDisplayQueryResult>("/api/v2/ledger/query", body),
    placeholderData: keepPreviousData,
  });
  const result = paged ? pages : single;
  const first = paged ? pages.data?.pages[0] : single.data;
  const rows = useMemo<DisplayRow[]>(() => (paged ? (pages.data?.pages.flatMap((page) => page.rows) ?? []) : []), [paged, pages.data]);
  const { fetchNextPage } = pages;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const totalCount = first?.summary?.count ?? first?.totals?.count ?? 0;

  // ---- period ----
  const timezone = fmt.prefs.timezone;
  const days = periodDays(config.period, currentMonth(timezone));
  const rangeLabel = days ? fmt.periodRangeLabel(days.from, days.to) : t("period.whole");

  const duplicate = useAppMutation({
    event: "views.write",
    mutationFn: () => apiPost<LedgerView>(`/api/v2/views/${view.id}/duplicate`, { config: applyViewDraft(saved, draft) }),
    onSuccess: (copy) => void setParams({ view: copy.id, draft: null, q: null }),
  });

  const selectedRows = rows.filter((row) => selected.has(row.id));
  const summary = first?.summary ?? null;
  const everyLoaded = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const filterBar = (
    <div className="relative flex flex-wrap items-center gap-1.5">
      <PeriodControl period={config.period} rangeLabel={rangeLabel} onChange={(period) => update({ period })} />
      <FilterChips config={config} names={names} labels={labels} onChange={(filters) => update({ filters })} />
      <span className="flex-1" />
      <TextInput
        value={searchText}
        placeholder={t("search")}
        aria-label={t("search")}
        className="w-[170px]"
        onChange={(text) => {
          setSearchText(text);
          clearSelection();
          void setParams({ q: text || null });
        }}
      />
      <DisplayMenu
        open={overlays.displayOpen}
        onOpenChange={overlays.setDisplayOpen}
        name={view.name}
        isBuiltin={view.isBuiltin}
        isFavorite={view.isFavorite}
        config={config}
        labels={labels}
        onRename={(name) => saveView(view.id, { name })}
        onFavorite={(isFavorite) => saveView(view.id, { isFavorite })}
        onConfig={update}
        onDuplicate={() => duplicate.mutate()}
        onDelete={onDelete}
      />
      {dirty ? (
        <>
          <Btn ghost onClick={() => setDraft(null)}>
            {t("clear")}
          </Btn>
          <Btn onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
            {t("saveAsNew")}
          </Btn>
        </>
      ) : !view.isBuiltin ? (
        <span className="text-[11px] text-fg-4">{t("autosaved")}</span>
      ) : null}
    </div>
  );

  let layout: ReactNode = null;
  switch (config.layout) {
    case "table":
      layout = (
        <>
          <KpiSummary summary={summary} />
          <LedgerTable
            rows={rows}
            groups={first?.groups ?? []}
            config={config}
            totals={first?.totals?.values ?? {}}
            totalCount={totalCount}
            names={names}
            labels={labels}
            periodLabel={rangeLabel}
            loading={result.isFetching}
            hasMore={!!pages.hasNextPage}
            onLoadMore={loadMore}
            selected={selected}
            onSelected={setSelected}
            allInView={allInView}
            onAllInView={setAllInView}
            onConfig={update}
          />
          {selected.size > 0 || allInView ? (
            <BulkBar
              selection={allInView ? { query: viewSelection(config, q) } : { ids: selectedRows.flatMap((row) => row.legIds) }}
              stats={allInView ? { count: totalCount, sum: summary?.net ?? 0, avg: 0, min: 0, max: 0 } : selectionStats(selectedRows)}
              names={names}
              allInView={allInView}
              canSelectAll={everyLoaded && totalCount > rows.length}
              totalInView={totalCount}
              onSelectAll={() => setAllInView(true)}
              onClear={clearSelection}
            />
          ) : null}
        </>
      );
      break;
    case "pivot": {
      const { rows: rowsKey, cols: colsKey } = pivotKeys(config);
      layout = <PivotView pivot={first?.pivot} rowsKey={rowsKey} colsKey={colsKey} labels={labels} onDrill={drill} />;
      break;
    }
    case "chart":
      layout = (
        <ChartView
          groups={first?.groups ?? []}
          config={config}
          viewName={view.name}
          rangeLabel={rangeLabel}
          labels={labels}
          onType={(type) => update({ chart: { ...config.chart, type } })}
          onDrill={drill}
          onDrillFilters={drillFilters}
          sankey={sankey ? <SankeyView config={config} search={q} names={names} rangeLabel={rangeLabel} onDrill={drill} /> : null}
        />
      );
      break;
    case "board":
      layout = (
        <BoardView
          rows={rows}
          groups={first?.groups ?? []}
          groupKey={boardKey(config)}
          config={config}
          labels={labels}
          totalCount={totalCount}
          hasMore={!!pages.hasNextPage}
          loading={result.isFetching}
          onMore={loadMore}
          onOpen={(row) => overlays.openEntry(row.id)}
        />
      );
      break;
    case "calendar": {
      const today = todayIso(timezone);
      layout = (
        <CalendarView
          month={(days?.to ?? today).slice(0, 7)}
          today={today}
          rows={rows}
          groups={first?.groups ?? []}
          totalCount={first?.totals?.count ?? 0}
          onOpen={(row) => overlays.openEntry(row.id)}
          onDay={(day) => {
            clearSelection();
            setDraft(dayDraft(saved, config, day));
          }}
        />
      );
      break;
    }
  }

  return (
    <Page crumbs={[t("crumb"), view.name]} subheader={tabs} actions={<TransactionsHeaderActions />} overlay={<LedgerOverlays names={names} rows={rows} />}>
      {filterBar}
      {result.isError ? <p className="text-[12.5px] text-neg">{errorText(result.error)}</p> : null}
      {layout}
    </Page>
  );
}
