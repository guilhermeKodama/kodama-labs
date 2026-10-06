import type { Aggregation, GroupKey, LedgerFilter, ViewConfig } from "@capital/server/modules/ledger/contracts";

/**
 * The properties of a ledger view (mockup PROP_META / PROP_ORDER, 646–662):
 * the table's columns, the group and filter choices and the footer calcs.
 *
 * A property is identified by its column id, the string stored in
 * ViewConfig.columns and ViewConfig.calcs: a ledger field ("entityId"), the
 * derived Tipo ("flowKind"), or a date bucket ("date:month"). `label` is the
 * mockup's key, used for the `ledger.props.<label>` message.
 */

export type DateBucketId = "day" | "monthWeek" | "month" | "quarter" | "year";

export const PROP_IDS = [
  "date",
  "description",
  "entityId",
  "accountId",
  "categoryId",
  "flowKind",
  "currency",
  "isRecurring",
  "isTaxDeductible",
  "date:monthWeek",
  "date:month",
  "date:quarter",
  "date:year",
  "amountBase",
] as const;
export type PropId = (typeof PROP_IDS)[number];

/** Message key under ledger.props for each property (the mockup's PropKey). */
export type PropLabel =
  | "date"
  | "desc"
  | "entity"
  | "account"
  | "category"
  | "kind"
  | "currency"
  | "recurring"
  | "deductible"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "amount"
  | "day";

export interface PropMeta {
  label: PropLabel;
  /** Grid track of the table column. */
  width: string;
  groupable: boolean;
}

export const PROP_META: Record<PropId, PropMeta> = {
  date: { label: "date", width: "52px", groupable: false },
  description: { label: "desc", width: "minmax(0, 2.2fr)", groupable: false },
  entityId: { label: "entity", width: "minmax(0, 1.2fr)", groupable: true },
  accountId: { label: "account", width: "minmax(0, 1.1fr)", groupable: true },
  categoryId: { label: "category", width: "minmax(0, 1fr)", groupable: true },
  flowKind: { label: "kind", width: "96px", groupable: true },
  currency: { label: "currency", width: "60px", groupable: true },
  isRecurring: { label: "recurring", width: "80px", groupable: true },
  isTaxDeductible: { label: "deductible", width: "86px", groupable: true },
  "date:monthWeek": { label: "week", width: "96px", groupable: true },
  "date:month": { label: "month", width: "76px", groupable: true },
  "date:quarter": { label: "quarter", width: "80px", groupable: true },
  "date:year": { label: "year", width: "56px", groupable: true },
  amountBase: { label: "amount", width: "150px", groupable: false },
};

export const isPropId = (value: string): value is PropId => (PROP_IDS as readonly string[]).includes(value);

/** Groupable properties, in PROP_ORDER: the "Filtrar por…" list and the group options. */
export const GROUPABLE: PropId[] = PROP_IDS.filter((id) => PROP_META[id].groupable);

/** Columns of a new view (mockup BASE_PROPS). */
export const BASE_COLUMNS: PropId[] = ["date", "description", "entityId", "accountId", "categoryId", "amountBase"];

/** "date:month" → "month"; null for a plain field. */
export function bucketOf(id: string): DateBucketId | null {
  return id.startsWith("date:") ? (id.slice(5) as DateBucketId) : null;
}

/** A date's key for a bucket, the same as the server's group keys ("2026-09-W3", "2026-Q3"). */
export function bucketKeyOf(date: string, bucket: DateBucketId): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  switch (bucket) {
    case "day":
      return date.slice(0, 10);
    case "monthWeek":
      return `${date.slice(0, 7)}-W${Math.ceil(Number(date.slice(8, 10)) / 7)}`;
    case "month":
      return date.slice(0, 7);
    case "quarter":
      return `${year}-Q${Math.ceil(month / 3)}`;
    case "year":
      return year;
  }
}

// ---------------------------------------------------------------------------
// Group keys
// ---------------------------------------------------------------------------

/** Group option id: "none", a groupable property, or "date:day" (charts only, "Data (dia)"). */
export type GroupId = "none" | PropId | "date:day";

export function groupKeyOf(id: string): GroupKey | null {
  if (id === "none") return null;
  const bucket = bucketOf(id);
  if (bucket) return { field: "date", bucket };
  return { field: id as Exclude<GroupKey, { bucket: unknown }>["field"] };
}

export function groupIdOf(key: GroupKey | undefined | null): string {
  if (!key) return "none";
  return "bucket" in key ? `date:${key.bucket}` : key.field;
}

/** Message key under ledger.props for a group id. */
export function groupLabelKey(id: string): PropLabel | "none" {
  if (id === "none") return "none";
  if (id === "date:day") return "day";
  if (id === "date:week") return "week";
  return isPropId(id) ? PROP_META[id].label : "none";
}

/** Options of Agrupar por / Linhas / Eixo / Colunas / Séries (mockup groupOpts 2189). */
export function groupOptions(layout: ViewConfig["layout"]): GroupId[] {
  return ["none", ...(layout === "chart" ? (["date:day"] as const) : []), ...GROUPABLE];
}

// ---------------------------------------------------------------------------
// Footer calcs
// ---------------------------------------------------------------------------

export type CalcFn = "none" | "sum" | "avg" | "median" | "min" | "max" | "count" | "countDistinct";

/** Click order of the footer cell (mockup CALC_CYCLE_AMOUNT / CALC_CYCLE_OTHER; "unique" is countDistinct). */
export const CALC_CYCLE_AMOUNT: CalcFn[] = ["sum", "avg", "median", "min", "max", "count", "none"];
export const CALC_CYCLE_OTHER: CalcFn[] = ["none", "count", "countDistinct"];

export function calcCycle(column: string): CalcFn[] {
  return column === "amountBase" ? CALC_CYCLE_AMOUNT : CALC_CYCLE_OTHER;
}

/** The calc after `current` when its footer cell is clicked. */
export function nextCalc(column: string, current: string | undefined): CalcFn {
  const cycle = calcCycle(column);
  const index = cycle.indexOf((current ?? "none") as CalcFn);
  return cycle[(index + 1) % cycle.length];
}

/** The calc a column shows: unknown or unfit ones (sum on a text column) read as none. */
export function calcOf(config: Pick<ViewConfig, "calcs">, column: string): CalcFn {
  const calc = (config.calcs[column] ?? "none") as CalcFn;
  return calcCycle(column).includes(calc) ? calc : "none";
}

/**
 * The query aggregation behind a column's calc; null for none. A date bucket
 * column counts distinct buckets of the view's date field, the same date its
 * cells and groups read.
 */
export function calcAggregation(column: string, calc: CalcFn, dateField: ViewConfig["dateField"] = "date"): Aggregation | null {
  if (calc === "none") return null;
  if (calc === "count") return { fn: "count", field: "amountBase" };
  if (calc === "countDistinct") {
    const bucket = bucketOf(column);
    if (bucket) return { fn: "countDistinct", field: dateField, bucket };
    if (column === "amountBase") return { fn: "countDistinct", field: "amountBase" };
    return { fn: "countDistinct", field: column as Aggregation["field"] };
  }
  return column === "amountBase" ? { fn: calc, field: "amountBase" } : null;
}

/** Key of an aggregation's value in totals.values / group values ("sum:amountBase", "countDistinct:date:month"). */
export function aggKey(agg: Pick<Aggregation, "fn" | "field" | "bucket">): string {
  return agg.bucket ? `${agg.fn}:${agg.field}:${agg.bucket}` : `${agg.fn}:${agg.field}`;
}

export const SUM_AGG: Aggregation = { fn: "sum", field: "amountBase" };
export const COUNT_AGG: Aggregation = { fn: "count", field: "amountBase" };
export const SUM_KEY = aggKey(SUM_AGG);
export const COUNT_KEY = aggKey(COUNT_AGG);

/** Aggregations of a table query: the group subtotal (Σ) plus each visible column's calc, deduplicated, at most 8. */
export function tableAggregations(config: Pick<ViewConfig, "calcs" | "columns"> & Partial<Pick<ViewConfig, "dateField">>): Aggregation[] {
  const out: Aggregation[] = [SUM_AGG, COUNT_AGG];
  for (const column of visibleColumns(config)) {
    const agg = calcAggregation(column, calcOf(config, column), config.dateField);
    if (agg && !out.some((a) => aggKey(a) === aggKey(agg))) out.push(agg);
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Columns and sort
// ---------------------------------------------------------------------------

/** The visible columns in PROP_ORDER (unknown ids dropped). */
export function visibleColumns(config: Pick<ViewConfig, "columns">): PropId[] {
  return PROP_IDS.filter((id) => config.columns.includes(id));
}

/** Toggles a property in "Propriedades visíveis", keeping PROP_ORDER. */
export function toggleColumn(columns: readonly string[], id: PropId): PropId[] {
  const on = columns.includes(id);
  return PROP_IDS.filter((p) => (p === id ? !on : columns.includes(p)));
}

/** Grid template of the table: checkbox, the columns, the ⋯ menu. */
export function gridTemplate(columns: readonly PropId[]): string {
  return ["28px", ...columns.map((id) => PROP_META[id].width), "28px"].join(" ");
}

export const SORT_IDS = ["date_desc", "date_asc", "abs_desc"] as const;
export type SortId = (typeof SORT_IDS)[number];

export const SORTS: Record<SortId, ViewConfig["sort"]> = {
  date_desc: [{ field: "date", dir: "desc" }],
  date_asc: [{ field: "date", dir: "asc" }],
  abs_desc: [{ field: "absAmountBase", dir: "desc" }],
};

/** The mockup sort of a stored sort; null for one the mockup does not offer. */
export function sortIdOf(sort: ViewConfig["sort"]): SortId | null {
  const first = sort[0];
  if (!first) return "date_desc";
  if (first.field === "date") return first.dir === "asc" ? "date_asc" : "date_desc";
  if (first.field === "absAmountBase" && first.dir === "desc") return "abs_desc";
  return null;
}

// ---------------------------------------------------------------------------
// Layouts and charts
// ---------------------------------------------------------------------------

export const LAYOUTS = ["table", "pivot", "chart", "board", "calendar"] as const satisfies readonly ViewConfig["layout"][];

export type ChartType = ViewConfig["chart"]["type"];

/** Chart types in the mockup's order (CHART_TYPES 621–632), plus the sankey (decision sankey=v1). */
export const CHART_TYPE_META: { type: ChartType; glyph: string }[] = [
  { type: "bar", glyph: "▮" },
  { type: "hbar", glyph: "▬" },
  { type: "bar100", glyph: "▥" },
  { type: "line", glyph: "⟋" },
  { type: "area", glyph: "◢" },
  { type: "pie", glyph: "◔" },
  { type: "donut", glyph: "◯" },
  { type: "treemap", glyph: "▦" },
  { type: "waterfall", glyph: "▙" },
  { type: "sankey", glyph: "⇶" },
];

/** Types that draw a second grouping as series ("Séries"). */
export const SERIES_TYPES: ChartType[] = ["bar", "hbar", "bar100", "line", "area"];
/** Types that take "Acumulado". */
export const CUMULATIVE_TYPES: ChartType[] = ["bar", "line", "area"];
export const METRICS = ["sum", "count", "avg"] as const;
export const TOPS = [0, 5, 8] as const;

/** Which Exibição controls a layout and chart type show (mockup 2419–2504). */
export function displayFields(config: Pick<ViewConfig, "layout" | "chart">) {
  const { layout } = config;
  const type = config.chart.type;
  const chart = layout === "chart";
  const sankey = chart && type === "sankey";
  return {
    group: layout !== "calendar" && !sankey,
    chartType: chart,
    metric: chart && type !== "waterfall" && !sankey,
    top: chart && type !== "line" && type !== "area" && !sankey,
    cumulative: chart && CUMULATIVE_TYPES.includes(type),
    sub: layout === "table" || layout === "pivot" || (chart && SERIES_TYPES.includes(type)),
    sort: layout === "table" || layout === "board",
    props: layout === "table" || layout === "board",
  };
}

/** Label key of the group select per layout (ledger.display.group.<key>). */
export function groupTitleKey(layout: ViewConfig["layout"]): "group" | "rows" | "axis" | "columns" {
  return layout === "pivot" ? "rows" : layout === "chart" ? "axis" : layout === "board" ? "columns" : "group";
}

/** Label key of the second group select per layout. */
export function subTitleKey(layout: ViewConfig["layout"]): "sub" | "columns" | "series" {
  return layout === "pivot" ? "columns" : layout === "chart" ? "series" : "sub";
}

// ---------------------------------------------------------------------------
// Configs from before the new UI
// ---------------------------------------------------------------------------

const KIND_TO_FLOW: Record<string, string> = { income: "in", expense: "out", transfer: "transfer", investment: "invest" };

/**
 * Brings a stored config to this vocabulary: "kind" (the ledger kind) becomes
 * the derived Tipo (flowKind) in columns, groups, calcs and in/nin filters;
 * columns keep PROP_ORDER. Everything else is kept as stored.
 */
export function normalizeLedgerConfig(config: ViewConfig): ViewConfig {
  const columns = config.columns.map((c) => (c === "kind" ? "flowKind" : c));
  const groupBy = config.groupBy.map((g) => ("bucket" in g || g.field !== "kind" ? g : { field: "flowKind" as const }));
  const filters = config.filters.map((f): LedgerFilter => {
    if (f.field !== "kind" || (f.op !== "in" && f.op !== "nin")) return f;
    return { field: "flowKind", op: f.op, values: f.values.map((v) => (typeof v === "string" ? (KIND_TO_FLOW[v] ?? v) : v)) };
  });
  const calcs = { ...config.calcs };
  if ("kind" in calcs) {
    calcs.flowKind = calcs.kind;
    delete calcs.kind;
  }
  return {
    ...config,
    columns: [...PROP_IDS.filter((id) => columns.includes(id)), ...columns.filter((c) => !isPropId(c))],
    groupBy,
    filters,
    calcs,
  };
}

/**
 * groupBy from the two selects (group and sub). The second needs the
 * first: in a pivot or chart a sub without a group keeps the layout's
 * default rows/axis (Categoria, or Data (dia) for line and area); in a
 * table it becomes the group.
 */
export function groupByOf(layout: ViewConfig["layout"], chartType: ChartType, first: string, second: string): GroupKey[] {
  const a = groupKeyOf(first);
  const b = groupKeyOf(second);
  if (a) return b ? [a, b] : [a];
  if (!b) return [];
  if (layout === "pivot") return [{ field: "categoryId" }, b];
  if (layout === "chart") return [chartType === "line" || chartType === "area" ? { field: "date", bucket: "day" } : { field: "categoryId" }, b];
  return [b];
}
