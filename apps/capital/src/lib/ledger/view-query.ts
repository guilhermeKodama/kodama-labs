import type { GroupKey, LedgerQueryInput, LedgerSelectionQuery, ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { LedgerFlowsInput } from "@capital/server/modules/ledger/services/flows";
import { COUNT_AGG, SERIES_TYPES, SUM_AGG, tableAggregations } from "./columns";

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

/** Pivot axes: Linhas (default Categoria) × Colunas (default Entidade). */
export function pivotKeys(config: Pick<ViewConfig, "groupBy">): { rows: GroupKey; cols: GroupKey } {
  return { rows: config.groupBy[0] ?? CATEGORY, cols: config.groupBy[1] ?? ENTITY };
}

/** Chart axis (Eixo; Data (dia) for line/area, Categoria otherwise) and series (Séries, only for series types). */
export function chartKeys(config: Pick<ViewConfig, "groupBy" | "chart">): { axis: GroupKey; series: GroupKey | null } {
  const type = config.chart.type;
  const axis = config.groupBy[0] ?? (type === "line" || type === "area" ? DAY : CATEGORY);
  const series = SERIES_TYPES.includes(type) ? (config.groupBy[1] ?? null) : null;
  return { axis, series };
}

/** Board columns (Colunas; default Categoria). */
export function boardKey(config: Pick<ViewConfig, "groupBy">): GroupKey {
  return config.groupBy[0] ?? CATEGORY;
}

/** Table query (paged by the caller's cursor): groups, calcs, KPI summary, rows in group order. */
export function tableQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  return {
    ...viewSelection(config, search),
    semantics: "display",
    groupBy: config.groupBy.slice(0, 2),
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

/** Calendar: day totals from the groups, descriptions from the rows (counted rows only). */
export function calendarQuery(config: ViewConfig, search?: string | null): LedgerQueryInput {
  return {
    ...viewSelection(config, search),
    semantics: "display",
    rowsScope: "counted",
    groupBy: [DAY],
    aggregations: [SUM_AGG, COUNT_AGG],
    sort: [{ field: "absAmountBase", dir: "desc" }],
    includeRows: true,
    page: { limit: CALENDAR_PAGE },
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
    groupBy: [{ field: "date", bucket }],
    aggregations: [COUNT_AGG],
    includeRows: false,
    skipTotals: true,
  };
}

/** Whether a layout's query pages rows (table, board, calendar). */
export function isPagedLayout(config: Pick<ViewConfig, "layout" | "chart">): boolean {
  return config.layout === "table" || config.layout === "board" || config.layout === "calendar";
}

/** The query of a layout (the sankey has its own endpoint, see flowsQuery). */
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
