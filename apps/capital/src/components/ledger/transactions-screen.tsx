"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import type { GroupKey, LedgerDisplayQueryResult, LedgerFilter, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Btn, TextInput } from "@/components/cap";
import { Page } from "@/components/shell/page";
import { apiPost } from "@/lib/api/client";
import { useNames } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useErrorMessage } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { normalizeLedgerConfig } from "@/lib/ledger/columns";
import { dayDraft, drillDraft, drillFiltersDraft, withDrillBanner, type DrillCell } from "@/lib/ledger/drill";
import { currentMonth, periodDays, todayIso } from "@/lib/ledger/period";
import { selectionStats } from "@/lib/ledger/selection";
import { useDuplicateView, useLedgerViewActions, useLedgerViews, useNewView, useViewSaver, type LedgerView } from "@/lib/ledger/use-views";
import { applyViewDraft, decodeViewDraft, draftPatch, encodeViewDraft, canonicalViewParam, isDirty, isViewParamPending, resolveActiveView, type ViewDraft } from "@/lib/ledger/view-draft";
import { boardColumnQuery, boardKey, calendarQuery, calendarRowsQuery, isPagedLayout, layoutQuery, pivotKeys, selectionScope, viewSelection } from "@/lib/ledger/view-query";
import { planViewUpdate } from "@/lib/ledger/view-update";
import { BulkBar } from "./bulk-bar";
import { useImportLabels, useLedgerLabels } from "./fields";
import { TransactionsHeaderActions } from "./header-actions";
import { BoardView, CalendarView, ChartView, PivotView, SankeyView } from "./layouts";
import { LedgerOverlays, useLedgerOverlays } from "./overlays";
import type { DisplayRow } from "./rows";
import { KpiSummary, LedgerTable } from "./table";
import { DisplayMenu, FilterChips, PeriodControl, ViewTabs } from "./toolbar";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/** Pages of the calendar month's rows read at most (500 each). */
const CALENDAR_MAX_PAGES = 4;

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
  const [params, setParams] = useQueryStates(URL_STATE);
  const list = useMemo(() => views.data ?? [], [views.data]);
  // A view created a moment ago (or a link to one) may not be in the list yet: wait for it instead of showing Todas,
  // where its first filter would go to Todas' draft and never be saved.
  const waiting = isViewParamPending(list, params.view, views.isSuccess && !views.isFetching);
  const active = waiting ? null : resolveActiveView(list, params.view);

  // ?view=seed:ir (e.g. the old /tax link) becomes the view's own id.
  // A seeded view the user deleted (or one not seeded yet, like PJ before a business entity) falls back to Todas.
  const canonical = canonicalViewParam(list, params.view, views.isSuccess);
  useEffect(() => {
    if (canonical !== undefined) void setParams({ view: canonical }, { history: "replace" });
  }, [canonical, setParams]);

  const open = (id: string | null) => void setParams({ view: id, draft: null, q: null });
  // "+", the sidebar's "+ Nova view" and ⌘K: the same hook (the view is in the list before it opens, with Exibição).
  const newView = useNewView();
  // The view menu (tabs, Exibição): deleting the view on screen opens Todas; the delete is undoable under the same id.
  const actions = useLedgerViewActions({ activeId: active?.id ?? null });

  const tabs = (
    <ViewTabs
      views={list}
      activeId={active?.id ?? null}
      dirty={!!active && isDirty(normalizeLedgerConfig(active.config), decodeViewDraft(params.draft))}
      onPick={(view) => open(view.id)}
      onNew={newView.mutate}
      creating={newView.isPending}
      actions={actions}
    />
  );

  if (!active) {
    return (
      <Page crumbs={[t("crumb")]} subheader={tabs}>
        <p className="text-[12.5px] text-fg-3">{views.isError && !waiting ? t("viewsError") : tc("loading")}</p>
      </Page>
    );
  }
  return <ViewScreen key={active.id} view={active} tabs={tabs} draftParam={params.draft} search={params.q ?? ""} setParams={setParams} onDelete={() => actions.remove(active)} />;
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
  const overlays = useLedgerOverlays();
  const errorText = useErrorMessage();
  const saveView = useViewSaver();

  const saved = useMemo(() => normalizeLedgerConfig(view.config), [view.config]);
  const draft = useMemo(() => decodeViewDraft(draftParam), [draftParam]);
  const config = useMemo(() => applyViewDraft(saved, draft), [saved, draft]);
  const importNames = useImportLabels(config.filters);
  const labels = useLedgerLabels(names, importNames);
  const dirty = isDirty(saved, draft);

  const [searchText, setSearchText] = useState(search);
  const q = useDebounced(searchText.trim(), 250);
  // A selection belongs to the rows it was made on: whatever changes them (a filter, the period, the search,
  // "Limpar", "voltar à view", the browser's Back over a drill) drops it, so "all in view" never widens.
  const selectionKey = selectionScope(config, q);
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string>; all: boolean }>(() => ({ key: selectionKey, ids: new Set(), all: false }));
  const current = selection.key === selectionKey;
  const selected = current ? selection.ids : EMPTY_SELECTION;
  const allInView = current && selection.all;
  const setSelected = useCallback(
    (ids: ReadonlySet<string>) => setSelection((s) => ({ key: selectionKey, ids, all: s.key === selectionKey && s.all })),
    [selectionKey],
  );
  const setAllInView = useCallback(
    (all: boolean) => setSelection((s) => ({ key: selectionKey, ids: s.key === selectionKey ? s.ids : EMPTY_SELECTION, all })),
    [selectionKey],
  );
  const clearSelection = useCallback(() => setSelection({ key: selectionKey, ids: EMPTY_SELECTION, all: false }), [selectionKey]);

  const setDraft = (next: ViewDraft | null, history: "push" | "replace" = "replace") => void setParams({ draft: encodeViewDraft(next) }, { history });
  /** Every change on screen: saved at once, or kept in the draft (see planViewUpdate). */
  const update = (patch: Partial<ViewConfig>) => {
    const plan = planViewUpdate({ saved, draft, isBuiltin: view.isBuiltin, patch });
    if (plan.save) saveView(view.id, { config: plan.save });
    if (encodeViewDraft(plan.draft) !== draftParam) setDraft(plan.draft);
  };
  /** A drill opens the table with that slice as a draft, with its banner; the browser's Back also returns. */
  const openDrill = (next: ViewDraft, label: string) => setDraft(withDrillBanner(next, label, draft), "push");
  const drill = (cells: DrillCell[]) =>
    openDrill(drillDraft(saved, config, cells), cells.length ? cells.map((cell) => labels.groupValue(cell.key, cell.value)).join(" · ") : t("pivot.total"));
  const drillFilters = (groupKeys: GroupKey[], filters: LedgerFilter[]) => openDrill(drillFiltersDraft(saved, config, groupKeys, filters), t("charts.others"));

  // ---- period ----
  const timezone = fmt.prefs.timezone;
  const days = periodDays(config.period, currentMonth(timezone));
  const rangeLabel = days ? fmt.periodRangeLabel(days.from, days.to) : t("period.whole");
  const today = todayIso(timezone);
  /** The calendar shows the last month of the period (this month for "Todo o período"). */
  const calendarMonth = (days?.to ?? today).slice(0, 7);

  // ---- data ----
  const calendar = config.layout === "calendar";
  const body = useMemo(() => (calendar ? calendarRowsQuery(config, q, calendarMonth) : layoutQuery(config, q)), [calendar, config, q, calendarMonth]);
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
  const calendarBody = useMemo(() => calendarQuery(config, q), [config, q]);
  const calendarDays = useQuery({
    queryKey: keys.ledgerQuery(calendarBody),
    enabled: calendar,
    queryFn: () => apiPost<LedgerDisplayQueryResult>("/api/v2/ledger/query", calendarBody),
    placeholderData: keepPreviousData,
  });
  const result = paged ? pages : single;
  const first = paged ? pages.data?.pages[0] : single.data;
  const rows = useMemo<DisplayRow[]>(() => (paged ? (pages.data?.pages.flatMap((page) => page.rows) ?? []) : []), [paged, pages.data]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = pages;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  // The calendar reads every row of its month (for the descriptions), a few pages at most.
  const calendarPages = pages.data?.pages.length ?? 0;
  useEffect(() => {
    if (calendar && hasNextPage && !isFetchingNextPage && calendarPages < CALENDAR_MAX_PAGES) void fetchNextPage();
  }, [calendar, hasNextPage, isFetchingNextPage, calendarPages, fetchNextPage]);
  const totalCount = first?.summary?.count ?? first?.totals?.count ?? 0;

  // "Duplicar" and "Salvar como nova": the copy takes the config on screen (draft included) and opens, already in the list.
  const duplicateMutation = useDuplicateView();
  const duplicate = {
    isPending: duplicateMutation.isPending,
    mutate: () => duplicateMutation.mutate({ view, config: applyViewDraft(saved, draft) }, { onSuccess: (copy) => void setParams({ view: copy.id, draft: null, q: null }) }),
  };

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
          loading={result.isFetching}
          columnQuery={(value, limit) => boardColumnQuery(config, q, value, limit)}
          onOpen={(row) => overlays.openEntry(row.id)}
        />
      );
      break;
    case "calendar": {
      layout = (
        <CalendarView
          month={calendarMonth}
          today={today}
          dateField={config.dateField}
          rows={rows}
          groups={calendarDays.data?.groups ?? []}
          periodCount={calendarDays.data?.totals?.count ?? 0}
          onOpen={(row) => overlays.openEntry(row.id)}
          onDay={(day) => openDrill(dayDraft(saved, config, day), fmt.date(day))}
        />
      );
      break;
    }
  }

  return (
    <Page crumbs={[t("crumb"), view.name]} subheader={tabs} actions={<TransactionsHeaderActions />} overlay={<LedgerOverlays names={names} rows={rows} />}>
      {filterBar}
      {draft?.label ? (
        <p className="text-[12px] text-fg-3">
          {t("drill.detail", { label: draft.label })} ·{" "}
          <button type="button" onClick={() => setDraft(draftPatch(draft.back))} className="underline underline-offset-[3px] hover:text-fg-1">
            {t("drill.back")}
          </button>
        </p>
      ) : null}
      {result.isError ? <p className="text-[12.5px] text-neg">{errorText(result.error)}</p> : null}
      {calendar && calendarDays.isError ? <p className="text-[12.5px] text-neg">{errorText(calendarDays.error)}</p> : null}
      {/* A failed first load shows the error, not an empty table that reads "Nenhum lançamento…". */}
      {result.isError && !first && !sankey ? null : layout}
    </Page>
  );
}
