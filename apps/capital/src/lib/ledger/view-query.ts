import type { GroupKey, LedgerQueryInput, LedgerSelectionQuery, ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { LedgerFlowsInput } from "@capital/server/modules/ledger/services/flows";
import { COUNT_AGG, SERIES_TYPES, SUM_AGG, tableAggregations } from "./columns";
import { groupValueFilters } from "./drill";

/**
 * ViewConfig → POST /v2/ledger/query body, per layout. Every query is in
 * display mode (a transfer is one row, an aporte one counted outflow);
 * pivot, charts and the calendar read counted rows only, so neutral
 * transfers never land in "Sem categoria".
 *
 * The defaults the mockup applies at render time live here too, so the
 * query and the drawing agree: pivot rows Categoria × columns Entidade,
 * chart axis Data (line/area) or Categoria, board columns Categoria.
 */

/** Rows per page of the table (and the board). */
export const TABLE_PAGE = 200;
export const BOARD_PAGE = 500;
export const CALENDAR_PAGE = 500;

const DAY: GroupKey = { field: "date", bucket: "day" };
const CATEGORY: GroupKey = { field: "categoryId" };
const ENTITY: GroupKey = { field: "entityId" };

/** The part of the query that selects rows: period, filters and the transient search. */
export function viewSelection(config: ViewConfig, search?: string | null): LedgerSelectionQuery {
  const q = search?.trim();
  return { period: config.period, dateField: config.dateField, filters: config.filters, ...(q ? { search: q } : {}), deleted: "exclude" };
}

/**
 * What a row selection is made on: the layout and the rows' selection (period, date field, filters,
 * search). Any change to it drops the selection, so "all in view" never reaches rows the user did not
 * see; display changes (sort, columns, calcs, grouping) keep it.
 */
export function selectionScope(config: ViewConfig, search?: string | null): string {
  return JSON.stringify([config.layout, viewSelection(config, search)]);
}

/**
 * A group key on the view's date field: the selects store date buckets as
 * "date" (Data (mês)…), and a view set to "Data de competência"
 * (effectiveDate) buckets on that date instead, like its period. Card
 * purchases then land in the statement's month in a pivot or a chart,
 * and a drill filters the same date.
 */
export function onDateField<K extends GroupKey | null | undefined>(key: K, dateField: ViewConfig["dateField"] | undefined): K {
  if (!key || !("bucket" in key) || !dateField || key.field === dateField) return key;
  return { ...key, field: dateField } as K;
}

/** The view's groupBy with date buckets on its date field (see onDateField). */
export function viewGroupBy(config: Pick<ViewConfig, "groupBy"> & Partial<Pick<ViewConfig, "dateField">>): GroupKey[] {
  return config.groupBy.map((key) => onDateField(key, config.dateField));
}

/** Pivot axes: Linhas (default Categoria) × Colunas (default Entidade). */
export function pivotKeys(config: Pick<ViewConfig, "groupBy"> & Partial<Pick<ViewConfig, "dateField">>): { rows: GroupKey; cols: GroupKey } {
  const groupBy = viewGroupBy(config);
  return { rows: groupBy[0] ?? CATEGORY, cols: groupBy[1] ?? ENTITY };
}

/** Chart axis (Eixo; Data (dia) for line/area, Categoria otherwise) and series (Séries, only for series types). */
export function chartKeys(config: Pick<ViewConfig, "groupBy" | "chart"> & Partial<Pick<ViewConfig, "dateField">>): { axis: GroupKey; series: GroupKey | null } {
  const type = config.chart.type;
  const groupBy = viewGroupBy(config);
  const axis = groupBy[0] ?? onDateField(type === "line" || type === "area" ? DAY : CATEGORY, config.dateField);
  const series = SERIES_TYPES.includes(type) ? (groupBy[1] ?? null) : null;
  return { axis, series };
}

/** Board columns (Colunas; default Categoria). */
export function boardKey(config: Pick<ViewConfig, "groupBy"> & Partial<Pick<ViewConfig, "dateField">>): GroupKey {
  return viewGroupBy(config)[0] ?? CATEGORY;
}

/** Table query (paged by the caller's cursor): groups, calcs, KPI summary, rows in group order. */
export function tableQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  return {
    ...viewSelection(config, search),
    semantics: "display",
    groupBy: viewGroupBy(config).slice(0, 2),
    aggregations: tableAggregations(config),
    sort: config.sort,
    includeRows: true,
    page: { limit: TABLE_PAGE },
  };
}

export function pivotQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  const { rows, cols } = pivotKeys(config);
  return {
    ...viewSelection(config, search),
    semantics: "display",
    rowsScope: "counted",
    groupBy: [],
    aggregations: [SUM_AGG],
    pivot: { rows, cols, measure: SUM_AGG },
    includeRows: false,
  };
}

export function chartQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  const { axis, series } = chartKeys(config);
  return {
    ...viewSelection(config, search),
    semantics: "display",
    rowsScope: "counted",
    groupBy: series ? [axis, series] : [axis],
    aggregations: [SUM_AGG, COUNT_AGG],
    includeRows: false,
  };
}

/** The sankey's body for POST /v2/ledger/flows. */
export function flowsQuery(config: ViewConfig, search?: string | null): LedgerFlowsInput {
  return viewSelection(config, search);
}

export function boardQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  return {
    ...viewSelection(config, search),
    semantics: "display",
    groupBy: [boardKey(config)],
    aggregations: [SUM_AGG, COUNT_AGG],
    sort: config.sort,
    includeRows: true,
    page: { limit: BOARD_PAGE },
  };
}

/**
 * Calendar day totals: Σ and count per day of the whole period (counted
 * rows, on the view's date field), and the period's count for "N de
 * outros meses". No rows: the descriptions come from calendarRowsQuery.
 */
export function calendarQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  return {
    ...viewSelection(config, search),
    semantics: "display",
    rowsScope: "counted",
    groupBy: [{ field: config.dateField, bucket: "day" }],
    aggregations: [SUM_AGG, COUNT_AGG],
    includeRows: false,
  };
}

/** The calendar's descriptions: counted rows of the month on screen ("YYYY-MM"), largest first, paged. */
export function calendarRowsQuery(config: ViewConfig, search: string | null | undefined, month: string): LedgerQueryInput {
  const selection = viewSelection(config, search);
  return {
    ...selection,
    filters: [...selection.filters, { field: config.dateField, op: "inBuckets", bucket: "month", values: [month] }],
    semantics: "display",
    rowsScope: "counted",
    groupBy: [],
    aggregations: [],
    sort: [{ field: "absAmountBase", dir: "desc" }],
    includeRows: true,
    skipTotals: true,
    page: { limit: CALENDAR_PAGE },
  };
}

/** Board column "Carregar mais": the view's rows in one column (its group value), paged on their own. */
export function boardColumnQuery(config: ViewConfig, search: string | null | undefined, value: string | null, limit: number): LedgerQueryInput {
  const key = boardKey(config);
  const selection = viewSelection(config, search);
  return {
    ...selection,
    filters: [...selection.filters, ...groupValueFilters(key, value)],
    semantics: "display",
    groupBy: [key],
    aggregations: [],
    sort: config.sort,
    includeRows: true,
    skipTotals: true,
    page: { limit: Math.min(BOARD_PAGE, Math.max(1, limit)) },
  };
}

/** Distinct bucket keys in the view's period, for the Semana/Mês/Trimestre/Ano filter checklist. */
export function bucketOptionsQuery(config: ViewConfig, bucket: "monthWeek" | "month" | "quarter" | "year"): LedgerQueryInput {
  return {
    period: config.period,
    dateField: config.dateField,
    filters: [],
    deleted: "exclude",
    semantics: "display",
    groupBy: [{ field: config.dateField, bucket }],
    aggregations: [COUNT_AGG],
    includeRows: false,
    skipTotals: true,
  };
}

/** Whether a layout's query pages rows (table, board, calendar). */
export function isPagedLayout(config: Pick<ViewConfig, "layout" | "chart">): boolean {
  return config.layout === "table" || config.layout === "board" || config.layout === "calendar";
}

/** The query of a layout (the sankey has its own endpoint, see flowsQuery; the calendar's rows, calendarRowsQuery). */
export function layoutQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  switch (config.layout) {
    case "pivot":
      return pivotQuery(config, search);
    case "chart":
      return chartQuery(config, search);
    case "board":
      return boardQuery(config, search);
    case "calendar":
      return calendarQuery(config, search);
    default:
      return tableQuery(config, search);
  }
}
