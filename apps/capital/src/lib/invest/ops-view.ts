/**
 * The operations views of Carteira (Proventos 12m, Operações): period and
 * filters over GET /v2/investment-operations, and the monthly chart of
 * income. Mirrors the investment_ops saved-view schema (S1's
 * ledger/contracts/datasets.ts).
 */
import type { AllocationClass, Operation } from "./types";

export const OPS_GROUP_KEYS = ["month", "type", "allocationClass", "holdingId", "accountId", "none"] as const;
export type OpsGroupBy = (typeof OPS_GROUP_KEYS)[number];
export const OPS_FILTER_FIELDS = ["type", "incomeType", "accountId", "holdingId", "entityId", "allocationClass"] as const;
export type OpsFilterField = (typeof OPS_FILTER_FIELDS)[number];
export const OPS_COLUMNS = ["date", "type", "holdingId", "accountId", "quantity", "pricePerUnit", "totalAmount"] as const;

/** Operation types that pay income (Proventos). */
export const INCOME_TYPES = ["dividend", "yield_payment"] as const;

export type OpsPeriod = { preset: "this_month" | "last_month" | "last_3m" | "ytd" | "last_12m" | "all"; offset?: number } | { from: string; to: string };

export interface OpsFilter {
  field: OpsFilterField;
  op: "in" | "nin";
  values: string[];
}

export interface OpsViewConfig {
  layout: "table" | "chart";
  period: OpsPeriod;
  filters: OpsFilter[];
  groupBy: OpsGroupBy;
  series: OpsGroupBy;
  columns: string[];
  sort: { field: "date" | "totalAmount"; dir: "asc" | "desc" };
  chart?: unknown;
}

export const INCOME_12M_CONFIG: OpsViewConfig = {
  layout: "chart",
  period: { preset: "last_12m", offset: 0 },
  filters: [{ field: "type", op: "in", values: [...INCOME_TYPES] }],
  groupBy: "month",
  series: "none",
  columns: [...OPS_COLUMNS],
  sort: { field: "date", dir: "desc" },
};

export const OPERATIONS_CONFIG: OpsViewConfig = {
  layout: "table",
  period: { preset: "all", offset: 0 },
  filters: [],
  groupBy: "none",
  series: "none",
  columns: [...OPS_COLUMNS],
  sort: { field: "date", dir: "desc" },
};

export function normalizeOpsConfig(raw: unknown): OpsViewConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<OpsViewConfig>;
  const key = (v: unknown): OpsGroupBy => ((OPS_GROUP_KEYS as readonly string[]).includes(v as string) ? (v as OpsGroupBy) : "none");
  return {
    layout: c.layout === "chart" ? "chart" : "table",
    period: c.period && typeof c.period === "object" ? c.period : { preset: "all", offset: 0 },
    filters: Array.isArray(c.filters)
      ? c.filters.filter((f): f is OpsFilter => !!f && (OPS_FILTER_FIELDS as readonly string[]).includes(f.field) && Array.isArray(f.values) && f.values.length > 0)
      : [],
    groupBy: key(c.groupBy),
    series: key(c.series),
    columns: Array.isArray(c.columns) ? c.columns : [...OPS_COLUMNS],
    sort: { field: c.sort?.field === "totalAmount" ? "totalAmount" : "date", dir: c.sort?.dir === "asc" ? "asc" : "desc" },
    ...(c.chart !== undefined && { chart: c.chart }),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m0: number, d: number) => {
  const date = new Date(Date.UTC(y, m0, d));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const monthStartIso = (y: number, m0: number) => iso(y, m0, 1);
const monthEndIso = (y: number, m0: number) => iso(y, m0 + 1, 0);

/** Date range of a period on `today` ("YYYY-MM-DD"); null for all time. Same rules as the ledger query engine. */
export function opsPeriodRange(period: OpsPeriod, today: string): { from: string; to: string } | null {
  if ("from" in period) return { from: period.from, to: period.to };
  const y = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7)) - 1;
  const off = period.offset ?? 0;
  switch (period.preset) {
    case "all":
      return null;
    case "this_month":
      return { from: monthStartIso(y, m0 + off), to: monthEndIso(y, m0 + off) };
    case "last_month":
      return { from: monthStartIso(y, m0 - 1 + off), to: monthEndIso(y, m0 - 1 + off) };
    case "last_3m":
      return { from: monthStartIso(y, m0 - 2 + off * 3), to: monthEndIso(y, m0 + off * 3) };
    case "ytd":
      // "Este ano" runs from January to the current month; a past year is the whole year (as the ledger engine).
      return off === 0 ? { from: monthStartIso(y, 0), to: monthEndIso(y, m0) } : { from: monthStartIso(y + off, 0), to: monthEndIso(y + off, 11) };
    case "last_12m":
      return { from: monthStartIso(y, m0 - 11 + off * 12), to: monthEndIso(y, m0 + off * 12) };
  }
}

function opValue(op: Operation, field: OpsFilterField): string | null {
  switch (field) {
    case "type":
      return op.type;
    case "incomeType":
      return op.incomeType;
    case "accountId":
      return op.accountId;
    case "holdingId":
      return op.holdingId;
    case "entityId":
      return op.entityId;
    case "allocationClass":
      return op.allocationClass;
  }
}

/** Operations of the view: in its period, matching its filters, sorted. */
export function filterOps(ops: readonly Operation[], config: OpsViewConfig, today: string): Operation[] {
  const range = opsPeriodRange(config.period, today);
  const dir = config.sort.dir === "asc" ? 1 : -1;
  return ops
    .filter((op) => !range || (op.date >= range.from && op.date <= range.to))
    .filter((op) =>
      config.filters.every((f) => {
        const value = opValue(op, f.field);
        const hit = value !== null && f.values.includes(value);
        return f.op === "in" ? hit : !hit;
      }),
    )
    .sort((a, b) => dir * (config.sort.field === "totalAmount" ? a.totalAmount - b.totalAmount : a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
}

export const isIncome = (op: Pick<Operation, "type">) => (INCOME_TYPES as readonly string[]).includes(op.type);

/** What an operation is worth in the base currency: income net of tax withheld, other operations their gross amount. */
export function opBaseValue(op: Operation, rateFor: (currency: string | null) => number): number {
  const amount = isIncome(op) ? op.totalAmount - op.taxWithheld : op.totalAmount;
  return amount * rateFor(op.currency);
}

/** "YYYY-MM" of every month in a range, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${pad(m)}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface MonthlyBars {
  /** "YYYY-MM", oldest first, zero-filled. */
  months: string[];
  /** Series keys (allocation classes, or "total"), in display order. */
  series: string[];
  /** One row per month: { month, [series]: value }. */
  rows: ({ month: string } & Record<string, number | string>)[];
  total: number;
}

const CLASS_ORDER: readonly AllocationClass[] = ["fixed_income", "br_stocks", "fii", "international", "crypto", "cash"];

/**
 * Monthly bars of the view's operations (Proventos 12m): months of the
 * period zero-filled (the last 12 when the period is open), stacked by
 * allocation class when the view's series says so.
 */
export function monthlyBars(ops: readonly Operation[], config: OpsViewConfig, today: string, rateFor: (currency: string | null) => number): MonthlyBars {
  const range = opsPeriodRange(config.period, today) ?? opsPeriodRange({ preset: "last_12m" }, today)!;
  const months = monthsBetween(range.from, range.to);
  const byClass = config.series === "allocationClass";
  const series = byClass ? CLASS_ORDER.filter((c) => ops.some((op) => op.allocationClass === c)) : ["total"];
  const rows = months.map((month) => {
    const row: { month: string } & Record<string, number | string> = { month };
    for (const s of series) row[s] = 0;
    return row;
  });
  const index = new Map(months.map((m, i) => [m, i]));
  let total = 0;
  for (const op of ops) {
    const i = index.get(op.date.slice(0, 7));
    if (i === undefined) continue;
    const key = byClass ? (op.allocationClass ?? "cash") : "total";
    const value = opBaseValue(op, rateFor);
    rows[i][key] = Number(rows[i][key] ?? 0) + value;
    total += value;
  }
  return { months, series, rows, total };
}
