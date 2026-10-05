import type { LedgerFilter, LedgerQueryInput, LedgerRow, ViewConfig } from "@capital/server/modules/ledger/contracts";

export interface SavedView {
  id: string;
  name: string;
  dataset: "ledger" | "holdings" | "investment_ops";
  position: number;
  isBuiltin: boolean;
  builtinKey: string | null;
  isFavorite: boolean;
  config: ViewConfig;
}

export function queryFromView(config: ViewConfig, filters: LedgerFilter[]): LedgerQueryInput {
  const chart = config.chart?.type ?? "bar";
  const sankey = config.layout === "chart" && chart === "sankey";
  const groupBy = sankey
    ? [{ field: "kind" as const }, { field: "categoryId" as const }]
    : config.layout === "calendar"
      ? [{ field: "date" as const, bucket: "day" as const }]
      : config.groupBy;
  return {
    period: config.period,
    dateField: config.dateField,
    filters,
    search: config.search,
    groupBy,
    aggregations: [{ fn: "sum", field: "amountBase" }, { fn: "count", field: "amountBase" }],
    sort: config.sort,
    pivot:
      config.layout === "pivot" && groupBy[0] && groupBy[1] && !("bucket" in groupBy[0]) && !("bucket" in groupBy[1])
        ? { rows: groupBy[0], cols: groupBy[1], measure: { fn: "sum", field: "amountBase" } }
        : undefined,
    includeRows: config.layout === "table" || config.layout === "board" || config.layout === "calendar",
    page: { limit: 300 },
  };
}

export function collapseTransfers(rows: LedgerRow[], mode: "group" | "legs"): LedgerRow[] {
  if (mode === "legs") return rows;
  const seen = new Set<string>();
  const out: LedgerRow[] = [];
  for (const row of rows) {
    if (!row.transferGroupId) {
      out.push(row);
      continue;
    }
    if (seen.has(row.transferGroupId)) continue;
    seen.add(row.transferGroupId);
    const legs = rows.filter((item) => item.transferGroupId === row.transferGroupId);
    const outflow = legs.find((item) => item.amount < 0) ?? legs[0];
    out.push({ ...outflow, amount: 0, amountBase: 0, description: outflow.description });
  }
  return out;
}
