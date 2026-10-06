/**
 * Shapes of the investment API responses, as the client sees them (types
 * only: the server modules are never bundled into the client).
 */
import type { AllocationClass, AssetClass, IncomeType, InvestmentTransactionType } from "@/generated/prisma";
import type { AporteResponse } from "@capital/server/modules/investments/services/aporte";
import type { ContributionsResponse } from "@capital/server/modules/investments/services/contributions";
import type { AssetSearchResponse, QuotesResponse } from "@capital/server/modules/investments/services/market";
import type { OrdersResponse } from "@capital/server/modules/investments/services/orders";
import type {
  PortfolioSummary,
  PortfolioTargetRow,
  RebalanceSuggestion,
  SerializedHolding,
  SerializedOperation,
} from "@capital/server/modules/investments/services/portfolio";
import type { PortfolioHistory } from "@capital/server/modules/investments/services/portfolio-history";
import type { PriceUpdateResult } from "@capital/server/modules/investments/services/update-prices";
import type { FireGoalPatch, FireGoalResponse, FireSummaryResponse } from "@capital/server/modules/fire/validations/fire";

export type { AllocationClass, AssetClass, IncomeType, InvestmentTransactionType };
export type {
  AporteResponse,
  AssetSearchResponse,
  ContributionsResponse,
  FireGoalPatch,
  FireGoalResponse,
  FireSummaryResponse,
  OrdersResponse,
  PortfolioHistory,
  PortfolioSummary,
  PortfolioTargetRow,
  PriceUpdateResult,
  QuotesResponse,
  RebalanceSuggestion,
};

export type Holding = SerializedHolding;
export type Operation = SerializedOperation;
export type AllocationRow = PortfolioSummary["allocation"][number];
export type BrokerCash = PortfolioSummary["brokers"][number];
export type ContributionMonth = ContributionsResponse["months"][number];
export type ContributionOrigin = ContributionMonth["origins"][number];
export type HistoryMonth = PortfolioHistory["months"][number];
export type AssetSearchItem = AssetSearchResponse["results"][number];
export type RebalanceClass = RebalanceSuggestion["classes"][number];
export type RebalanceAsset = NonNullable<Extract<RebalanceSuggestion, { assets: unknown }>["assets"]>[number];

/** The six classes of the portfolio, in display order (server lib/allocation-class.ts). */
export const ALLOCATION_CLASSES = ["fixed_income", "br_stocks", "fii", "international", "crypto", "cash"] as const satisfies readonly AllocationClass[];

/** The nine asset classes a holding is registered with. */
export const ASSET_CLASSES = ["fixed_income", "stocks", "fii", "etf", "bdr", "international_stocks", "international_etf", "crypto", "savings"] as const satisfies readonly AssetClass[];

/** Asset class → the class it shows under (server allocationClassOf; overrides apart). */
export function allocationClassOf(assetClass: AssetClass, currency?: string | null): AllocationClass {
  switch (assetClass) {
    case "fixed_income":
    case "savings":
      return "fixed_income";
    case "stocks":
      return "br_stocks";
    case "fii":
      return "fii";
    case "etf":
      return !currency || currency.toUpperCase() === "BRL" ? "br_stocks" : "international";
    case "bdr":
    case "international_stocks":
    case "international_etf":
      return "international";
    case "crypto":
      return "crypto";
  }
}

/** Entity scope of the investment screens: Consolidado, PF or PJ (every business entity). */
export const PORTFOLIO_SCOPES = ["all", "pf", "pj"] as const;
export type PortfolioScope = (typeof PORTFOLIO_SCOPES)[number];

export function isPortfolioScope(value: unknown): value is PortfolioScope {
  return typeof value === "string" && (PORTFOLIO_SCOPES as readonly string[]).includes(value);
}
