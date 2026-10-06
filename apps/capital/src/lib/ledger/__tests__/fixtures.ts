import type { LedgerGroup, ViewConfig } from "@capital/server/modules/ledger/contracts";

/** A blank ledger view config (the server's defaults). */
export function viewConfig(patch: Partial<ViewConfig> = {}): ViewConfig {
  return {
    layout: "table",
    period: { preset: "this_month", offset: 0 },
    dateField: "date",
    filters: [],
    groupBy: [],
    sort: [{ field: "date", dir: "desc" }],
    columns: ["date", "description", "entityId", "accountId", "categoryId", "amountBase"],
    calcs: { amountBase: "sum" },
    chart: { type: "bar", metric: "sum", cumulative: false, top: 0 },
    transferDisplay: "group",
    ...patch,
  };
}

/** A query group with Σ and count. */
export function group(key: string | null, sum: number, count: number, children?: LedgerGroup[]): LedgerGroup {
  return { key, count, values: { "sum:amountBase": sum, "count:amountBase": count }, ...(children ? { children } : {}) };
}
