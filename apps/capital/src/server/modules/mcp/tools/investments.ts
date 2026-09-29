import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentPosition, AdjustPositionParams } from "../lib/types";
import { listInvestmentHoldings } from "../../investments/services/list-investment-holdings";
import { createInvestmentHolding } from "../../investments/services/create-investment-holding";
import type { AssetClass } from "@/generated/prisma";

/**
 * List investment positions with their current status.
 */
export async function listInvestmentPositions(
  userId: string,
  db: DbClient
): Promise<{ positions: InvestmentPosition[] }> {
  const holdings = await listInvestmentHoldings(
    userId,
    { isActive: true },
    db
  );

  // Load account names
  const accountIds = holdings.map((h) => h.accountId);
  const accounts = await db.investmentAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true },
  });

  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  const positions: InvestmentPosition[] = holdings.map((h) => {
    const currentValue =
      h.currentPrice !== null ? h.currentQuantity * h.currentPrice : null;
    const unrealizedGain =
      currentValue !== null ? currentValue - h.totalInvested : null;

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
      unrealizedGain,
      currency: h.currency,
      accountName: accountMap.get(h.accountId) ?? "Unknown",
    };
  });

  return { positions };
}

/**
 * Adjust a position's quantity and average cost.
 * 
 * This is used to manually correct positions when the broker statement
 * shows different values than what's recorded.
 */
export async function adjustPosition(
  userId: string,
  params: AdjustPositionParams,
  db: DbClient
) {
  // Verify holding exists and user owns it
  const holding = await db.investmentHolding.findFirst({
    where: {
      id: params.holdingId,
      account: { userId },
    },
  });

  if (!holding) {
    throw new Error("Holding not found or access denied");
  }

  // Update quantity, average cost, and total invested
  const totalInvested = params.currentQuantity * params.averageCost;

  await db.investmentHolding.update({
    where: { id: params.holdingId },
    data: {
      currentQuantity: params.currentQuantity,
      averageCost: params.averageCost,
      totalInvested,
    },
  });

  // Record an adjustment transaction for audit trail
  await db.investmentTransaction.create({
    data: {
      holdingId: params.holdingId,
      type: "adjustment",
      quantity: params.currentQuantity,
      pricePerUnit: params.averageCost,
      totalAmount: totalInvested,
      fees: 0,
      date: new Date(),
      notes: params.notes ?? "Manual adjustment via MCP",
    },
  });

  return {
    success: true,
    holdingId: params.holdingId,
    newQuantity: params.currentQuantity,
    newAverageCost: params.averageCost,
    newTotalInvested: totalInvested,
  };
}

/**
 * Add a new asset/position to an investment account.
 */
export async function addInvestmentAsset(
  userId: string,
  params: {
    accountId: string;
    ticker?: string;
    name: string;
    assetClass: AssetClass;
    currency?: string;
  },
  db: DbClient
) {
  // Verify account exists and user owns it
  const account = await db.investmentAccount.findFirst({
    where: {
      id: params.accountId,
      userId,
    },
  });

  if (!account) {
    throw new Error("Investment account not found or access denied");
  }

  const holding = await createInvestmentHolding(
    userId,
    {
      accountId: params.accountId,
      ticker: params.ticker,
      name: params.name,
      assetClass: params.assetClass,
      currency: params.currency ?? account.currency,
    },
    db
  );

  return {
    id: holding.id,
    ticker: holding.ticker,
    name: holding.name,
    assetClass: holding.assetClass,
    currency: holding.currency,
  };
}
