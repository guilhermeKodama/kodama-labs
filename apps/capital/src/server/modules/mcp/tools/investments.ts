import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass } from "@/generated/prisma";
import type { InvestmentPosition, AdjustPositionParams } from "../lib/types";
import { adjustPosition as adjustHoldingPosition, createHolding, listHoldings } from "../../investments/services/portfolio";

/** Active positions with current value and unrealized gain. */
export async function listInvestmentPositions(userId: string, db: DbClient): Promise<{ positions: InvestmentPosition[] }> {
  const holdings = await listHoldings(userId, db);
  return {
    positions: holdings.map((h) => {
      const currentValue = h.currentPrice !== null ? h.currentQuantity * h.currentPrice : null;
      return {
        id: h.id,
        ticker: h.ticker,
        name: h.name,
        assetClass: h.assetClass,
        currentQuantity: h.currentQuantity,
        averageCost: h.averageCost,
        totalInvested: h.totalInvested,
        currentPrice: h.currentPrice,
        currentValue,
        unrealizedGain: currentValue !== null ? currentValue - h.totalInvested : null,
        currency: h.currency,
        accountName: h.account?.name ?? "Unknown",
      };
    }),
  };
}

/** Set a position to the broker's numbers, recording an adjustment operation as the audit trail. */
export async function adjustPosition(userId: string, params: AdjustPositionParams, db: DbClient) {
  const holding = await adjustHoldingPosition(userId, { ...params, notes: params.notes ?? "Manual adjustment via MCP" }, db);
  return {
    success: true,
    holdingId: holding.id,
    newQuantity: holding.currentQuantity,
    newAverageCost: holding.averageCost,
    newTotalInvested: holding.totalInvested,
  };
}

/** Add an asset to an investment (brokerage) account. */
export async function addInvestmentAsset(
  userId: string,
  params: { accountId: string; ticker?: string; name: string; assetClass: AssetClass; currency?: string },
  db: DbClient
) {
  const broker = await db.account.findFirst({ where: { id: params.accountId, userId, type: "brokerage" } });
  if (!broker) throw new Error("Investment account not found or access denied");
  const holding = await createHolding(userId, { ...params, currency: params.currency ?? broker.currency }, db);
  return { id: holding.id, ticker: holding.ticker, name: holding.name, assetClass: holding.assetClass, currency: holding.currency };
}
