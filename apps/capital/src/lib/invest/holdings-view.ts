/**
 * The Carteira table (holdings dataset): filters, grouping and sorting of
 * the holdings plus one "Caixa · Saldo em corretoras" row for the brokers'
 * cash, all in the base currency. The view configs mirror the saved-view
 * schema of the holdings dataset (ledger/contracts/datasets.ts on S1).
 */
import type { AllocationClass, BrokerCash, Holding } from "./types";
import { ALLOCATION_CLASSES } from "./types";

export const HOLDINGS_GROUP_KEYS = ["allocationClass", "accountId", "entityId", "none"] as const;
export type HoldingsGroupBy = (typeof HOLDINGS_GROUP_KEYS)[number];

export const HOLDINGS_FILTER_FIELDS = ["allocationClass", "accountId", "entityId"] as const;
export type HoldingsFilterField = (typeof HOLDINGS_FILTER_FIELDS)[number];

/** Ativo, Classe, Corretora, Entidade, Valor, % cart., Result. */
export const HOLDINGS_COLUMNS = ["ticker", "allocationClass", "accountId", "entityId", "marketValue", "share", "result"] as const;
export type HoldingsColumn = (typeof HOLDINGS_COLUMNS)[number];

export const HOLDINGS_SORT_FIELDS = ["marketValue", "invested", "result", "share", "ticker"] as const;
export type HoldingsSortField = (typeof HOLDINGS_SORT_FIELDS)[number];

export interface HoldingsFilter {
  field: HoldingsFilterField;
  op: "in" | "nin";
  values: string[];
}

export interface HoldingsViewConfig {
  layout: "table" | "chart";
  groupBy: HoldingsGroupBy;
  filters: HoldingsFilter[];
  columns: string[];
  sort: { field: HoldingsSortField; dir: "asc" | "desc" };
  chart?: unknown;
}

export const DEFAULT_HOLDINGS_CONFIG: HoldingsViewConfig = {
  layout: "table",
  groupBy: "none",
  filters: [],
  columns: [...HOLDINGS_COLUMNS],
  sort: { field: "marketValue", dir: "desc" },
};

/** A stored config with every field present (unknown values fall back to the defaults). */
export function normalizeHoldingsConfig(raw: unknown): HoldingsViewConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<HoldingsViewConfig>;
  const groupBy = (HOLDINGS_GROUP_KEYS as readonly string[]).includes(c.groupBy as string) ? (c.groupBy as HoldingsGroupBy) : DEFAULT_HOLDINGS_CONFIG.groupBy;
  const filters = Array.isArray(c.filters)
    ? c.filters.filter(
        (f): f is HoldingsFilter =>
          !!f && (HOLDINGS_FILTER_FIELDS as readonly string[]).includes(f.field) && (f.op === "in" || f.op === "nin") && Array.isArray(f.values) && f.values.length > 0,
      )
    : [];
  const columns = Array.isArray(c.columns) ? c.columns.filter((col) => (HOLDINGS_COLUMNS as readonly string[]).includes(col)) : [...HOLDINGS_COLUMNS];
  const sortField = (HOLDINGS_SORT_FIELDS as readonly string[]).includes(c.sort?.field as string) ? (c.sort!.field as HoldingsSortField) : "marketValue";
  return {
    layout: c.layout === "chart" ? "chart" : "table",
    groupBy,
    filters,
    columns: columns.includes("ticker") ? columns : ["ticker", ...columns],
    sort: { field: sortField, dir: c.sort?.dir === "asc" ? "asc" : "desc" },
    ...(c.chart !== undefined && { chart: c.chart }),
  };
}

/** One line of the table: a position, or the brokers' cash. */
export interface HoldingRow {
  key: string;
  kind: "holding" | "cash";
  holdingId: string | null;
  ticker: string | null;
  name: string | null;
  allocationClass: AllocationClass;
  /** null on a cash row that sums several brokers ("Várias"). */
  accountId: string | null;
  accountName: string | null;
  /** null on a cash row that sums several entities. */
  entityId: string | null;
  /** Base currency. */
  value: number;
  invested: number;
  /** Unrealized result as a fraction of the cost (null without cost; 0 for cash). */
  result: number | null;
  /** Share of the scope's total (holdings + broker cash). */
  share: number;
  /** The holding, for the detail sheet. */
  holding: Holding | null;
}

export interface HoldingGroup {
  /** Group value (class, account id or entity id); "" when ungrouped. */
  key: string;
  rows: HoldingRow[];
  value: number;
  share: number;
}

export interface HoldingsTable {
  /** Holdings + broker cash of the scope, before filters (the % cart. base). */
  total: number;
  groups: HoldingGroup[];
  /** Rows after filters. */
  count: number;
}

function cashRows(brokers: readonly BrokerCash[]): HoldingRow[] {
  return brokers
    .filter((b) => Math.abs(b.cashBase) >= 0.005)
    .map((b) => ({
      key: `cash:${b.accountId}`,
      kind: "cash" as const,
      holdingId: null,
      ticker: null,
      name: null,
      allocationClass: "cash" as const,
      accountId: b.accountId,
      accountName: b.name,
      entityId: b.entityId,
      value: b.cashBase,
      invested: b.cashBase,
      result: 0,
      share: 0,
      holding: null,
    }));
}

function holdingRow(h: Holding): HoldingRow {
  return {
    key: h.id,
    kind: "holding",
    holdingId: h.id,
    ticker: h.ticker,
    name: h.name,
    allocationClass: h.allocationClass,
    accountId: h.accountId,
    accountName: h.accountName,
    entityId: h.entityId,
    value: h.marketValueBase,
    invested: h.investedBase,
    result: h.unrealizedGainPercent,
    share: 0,
    holding: h,
  };
}

function matches(row: HoldingRow, filter: HoldingsFilter): boolean {
  const value = row[filter.field];
  const hit = value !== null && filter.values.includes(value);
  return filter.op === "in" ? hit : !hit;
}

function groupKeyOf(row: HoldingRow, groupBy: HoldingsGroupBy): string {
  if (groupBy === "none") return "";
  return row[groupBy] ?? "";
}

/** Cash rows that land in the same group become one (one "Saldo em corretoras" per class/entity/list). */
function mergeCash(rows: HoldingRow[]): HoldingRow {
  if (rows.length === 1) return rows[0];
  const accounts = new Set(rows.map((r) => r.accountId));
  const entities = new Set(rows.map((r) => r.entityId));
  const value = rows.reduce((s, r) => s + r.value, 0);
  return {
    ...rows[0],
    key: "cash",
    accountId: accounts.size === 1 ? rows[0].accountId : null,
    accountName: accounts.size === 1 ? rows[0].accountName : null,
    entityId: entities.size === 1 ? rows[0].entityId : null,
    value,
    invested: value,
  };
}

function compareRows(sort: HoldingsViewConfig["sort"]) {
  const dir = sort.dir === "asc" ? 1 : -1;
  return (a: HoldingRow, b: HoldingRow): number => {
    // Cash closes its group.
    if (a.kind !== b.kind) return a.kind === "cash" ? 1 : -1;
    switch (sort.field) {
      case "ticker":
        return dir * (a.ticker ?? a.name ?? "").localeCompare(b.ticker ?? b.name ?? "");
      case "invested":
        return dir * (a.invested - b.invested);
      case "result":
        return dir * ((a.result ?? -Infinity) - (b.result ?? -Infinity));
      case "share":
      case "marketValue":
        return dir * (a.value - b.value);
    }
  };
}

/**
 * The table of a holdings view. Values are in the base currency; shares
 * divide by the whole scope (holdings + broker cash), as the mockup's
 * "% cart.", so filtering does not inflate them. Groups are ordered by
 * value (largest first), class groups by value too, as in the mockup.
 */
export function buildHoldingsTable(holdings: readonly Holding[], brokers: readonly BrokerCash[], config: HoldingsViewConfig): HoldingsTable {
  const all = [...holdings.filter((h) => h.isActive).map(holdingRow), ...cashRows(brokers)];
  const total = all.reduce((s, r) => s + r.value, 0);
  const visible = all.filter((row) => config.filters.every((f) => matches(row, f)));

  const byKey = new Map<string, HoldingRow[]>();
  for (const row of visible) {
    const key = groupKeyOf(row, config.groupBy);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const sorter = compareRows(config.sort);
  const groups: HoldingGroup[] = [...byKey.entries()].map(([key, rows]) => {
    const cash = rows.filter((r) => r.kind === "cash");
    const merged = [...rows.filter((r) => r.kind === "holding"), ...(cash.length ? [mergeCash(cash)] : [])]
      .map((r) => ({ ...r, share: total > 0 ? r.value / total : 0 }))
      .sort(sorter);
    const value = merged.reduce((s, r) => s + r.value, 0);
    return { key, rows: merged, value, share: total > 0 ? value / total : 0 };
  });
  groups.sort((a, b) => b.value - a.value);
  return { total, groups, count: groups.reduce((s, g) => s + g.rows.length, 0) };
}

/** Values a filter can take, from the rows in the scope (classes in display order). */
export function filterOptions(holdings: readonly Holding[], brokers: readonly BrokerCash[], field: HoldingsFilterField): string[] {
  const rows = [...holdings.filter((h) => h.isActive).map(holdingRow), ...cashRows(brokers)];
  const values = [...new Set(rows.map((r) => r[field]).filter((v): v is string => v !== null))];
  if (field === "allocationClass") return ALLOCATION_CLASSES.filter((c) => values.includes(c));
  return values;
}

/** Adds a value to the filter on `field` (creating it), or removes it; empty filters go away. */
export function toggleFilterValue(filters: readonly HoldingsFilter[], field: HoldingsFilterField, value: string): HoldingsFilter[] {
  const current = filters.find((f) => f.field === field);
  if (!current) return [...filters, { field, op: "in", values: [value] }];
  const values = current.values.includes(value) ? current.values.filter((v) => v !== value) : [...current.values, value];
  return values.length ? filters.map((f) => (f === current ? { ...f, values } : f)) : filters.filter((f) => f !== current);
}
