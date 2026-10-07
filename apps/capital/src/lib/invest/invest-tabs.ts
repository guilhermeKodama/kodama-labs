import { DEFAULT_HOLDINGS_CONFIG, normalizeHoldingsConfig, type HoldingsViewConfig } from "./holdings-view";
import { INCOME_12M_CONFIG, normalizeOpsConfig, OPERATIONS_CONFIG, type OpsViewConfig } from "./ops-view";

export type InvestDataset = "holdings" | "investment_ops";

/** A view as GET /v2/views returns it (only what the Carteira tabs read). */
export interface StoredInvestView {
  id: string;
  name: string;
  dataset: string;
  seedKey?: string | null;
  config: unknown;
}

/** A Carteira tab: a saved view of positions or of operations. */
export type InvestView =
  | { id: string; name: string; seedKey: string | null; persisted: boolean; dataset: "holdings"; config: HoldingsViewConfig }
  | { id: string; name: string; seedKey: string | null; persisted: boolean; dataset: "investment_ops"; config: OpsViewConfig };

/** What the tabs know of one dataset's GET /v2/views. */
export interface InvestViewsRead {
  data: readonly StoredInvestView[] | undefined;
  isError: boolean;
}

/** The read-only stand-ins' names (invest.portfolio.tabs.<key>). */
export type InvestTabName = (key: "byClass" | "byBroker" | "byEntity" | "list" | "income12m" | "operations") => string;

/**
 * The Carteira tabs: the user's holdings views, then the operations views,
 * exactly as stored. An empty list is an empty strip (the user deleted
 * every view; "+" adds one), never the defaults again. Only a read that
 * failed with nothing to show yet puts the default tabs in, read-only
 * (persisted: false), so the screen still works.
 */
export function investTabs(holdings: InvestViewsRead, ops: InvestViewsRead, name: InvestTabName): InvestView[] {
  const holdingsView = (seedKey: "byClass" | "byBroker" | "byEntity" | "list", groupBy: HoldingsViewConfig["groupBy"]): InvestView => ({
    id: `seed:${seedKey}`,
    name: name(seedKey),
    seedKey,
    persisted: false,
    dataset: "holdings",
    config: { ...DEFAULT_HOLDINGS_CONFIG, groupBy },
  });
  const holdingsViews: InvestView[] =
    holdings.isError && !holdings.data
      ? [holdingsView("byClass", "allocationClass"), holdingsView("byBroker", "accountId"), holdingsView("byEntity", "entityId"), holdingsView("list", "none")]
      : (holdings.data ?? [])
          .filter((v) => v.dataset === "holdings")
          .map((v) => ({ id: v.id, name: v.name, seedKey: v.seedKey ?? null, persisted: true, dataset: "holdings" as const, config: normalizeHoldingsConfig(v.config) }));
  const opsViews: InvestView[] =
    ops.isError && !ops.data
      ? [
          { id: "seed:income12m", name: name("income12m"), seedKey: "income12m", persisted: false, dataset: "investment_ops", config: INCOME_12M_CONFIG },
          { id: "seed:operations", name: name("operations"), seedKey: "operations", persisted: false, dataset: "investment_ops", config: OPERATIONS_CONFIG },
        ]
      : (ops.data ?? [])
          .filter((v) => v.dataset === "investment_ops")
          .map((v) => ({ id: v.id, name: v.name, seedKey: v.seedKey ?? null, persisted: true, dataset: "investment_ops" as const, config: normalizeOpsConfig(v.config) }));
  return [...holdingsViews, ...opsViews];
}
