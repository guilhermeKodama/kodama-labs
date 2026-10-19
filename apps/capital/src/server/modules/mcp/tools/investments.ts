import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { todayIn } from "@capital/server/modules/budgets/lib/today";
import type { InvestmentPosition, AdjustPositionParams } from "../lib/types";
import { holdingAllocationClass } from "../../investments/lib/allocation-class";
import { adjustPosition as adjustHoldingPosition, createHolding, getOwnedHolding, listHoldings, updateHolding } from "../../investments/services/portfolio";

export interface ListInvestmentPositionsParams {
  accountId?: string;
  entityId?: string;
  /** Case-insensitive exact ticker. A closed holding matches only with includeClosed. */
  ticker?: string;
  /** Case-insensitive contains on ticker or name. */
  query?: string;
  /** Sold positions (quantity 0). Default false, so the open book stays as it is. */
  includeClosed?: boolean;
}

const CLOSED_QUANTITY = 1e-9;

/** Active positions with current value and unrealized gain. includeClosed adds quantity 0. */
export async function listInvestmentPositions(
  userId: string,
  db: DbClient,
  params: ListInvestmentPositionsParams = {},
): Promise<{ positions: InvestmentPosition[] }> {
  const holdings = await listHoldings(userId, db, {
    ...(params.accountId && { accountId: params.accountId }),
    ...(params.entityId && { entityIds: [params.entityId] }),
    ...(params.includeClosed && { includeInactive: true }),
    ...(params.ticker && { ticker: params.ticker }),
    ...(params.query && { query: params.query }),
  });
  const closedIds = holdings.filter((h) => Math.abs(h.currentQuantity) <= CLOSED_QUANTITY).map((h) => h.id);
  const lastOps = closedIds.length
    ? await db.investmentOperation.groupBy({
        by: ["holdingId"],
        where: { holdingId: { in: closedIds } },
        _max: { date: true },
      })
    : [];
  const closedAt = new Map(lastOps.map((row) => [row.holdingId, row._max.date ? formatDateOnly(row._max.date) : null]));
  return {
    positions: holdings.map((h) => {
      const currentValue = h.currentPrice !== null ? h.currentQuantity * h.currentPrice : null;
      const closed = Math.abs(h.currentQuantity) <= CLOSED_QUANTITY;
      return {
        id: h.id,
        ticker: h.ticker,
        name: h.name,
        assetClass: h.assetClass,
        allocationClass: holdingAllocationClass(h),
        currentQuantity: h.currentQuantity,
        averageCost: h.averageCost,
        totalInvested: h.totalInvested,
        currentPrice: h.currentPrice,
        currentValue,
        unrealizedGain: currentValue !== null ? currentValue - h.totalInvested : null,
        currency: h.currency,
        accountId: h.accountId,
        accountName: h.account?.name ?? "Unknown",
        entityId: h.account?.entityId ?? "",
        closedAt: closed ? closedAt.get(h.id) ?? null : null,
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
  return {
    id: holding.id,
    ticker: holding.ticker,
    name: holding.name,
    assetClass: holding.assetClass,
    allocationClass: holdingAllocationClass(holding),
    currency: holding.currency,
  };
}

/**
 * Sets the holding's current price and leaves the cost basis alone.
 * `price` is per unit. `totalValue` is the whole position (price = value / quantity).
 * Exactly one of them. Quantity 0 cannot take a total value.
 */
export async function updateHoldingPrice(
  userId: string,
  params: { holdingId: string; price?: number; totalValue?: number; date?: string },
  db: DbClient,
) {
  if ((params.price == null) === (params.totalValue == null)) {
    throw new LedgerError("Pass exactly one of price (per unit) or total value", 422, { code: "holding.price_choice" });
  }
  const holding = await getOwnedHolding(userId, params.holdingId, db);
  let price: number;
  if (params.totalValue != null) {
    if (!(holding.currentQuantity > 1e-9)) {
      throw new LedgerError("A total value needs a quantity so it can be split per unit", 422, { code: "holding.no_units" });
    }
    price = params.totalValue / holding.currentQuantity;
  } else {
    price = params.price ?? 0;
  }
  if (price < 0) {
    throw new LedgerError("Pass exactly one of price (per unit) or total value", 422, { code: "holding.price_choice" });
  }
  if (params.date) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const day = formatDateOnly(new Date(params.date.includes("T") ? params.date : `${params.date}T12:00:00.000Z`));
    if (day > todayIn(user.timezone).iso) {
      throw new LedgerError("The price date cannot be in the future", 422, { code: "holding.future_date" });
    }
  }
  const updated = await updateHolding(userId, holding.id, { currentPrice: price, ...(params.date ? { priceAsOf: params.date } : {}) }, db);
  return {
    holdingId: updated.id,
    currentPrice: updated.currentPrice,
    currentQuantity: updated.currentQuantity,
    averageCost: updated.averageCost,
    totalInvested: updated.totalInvested,
    lastPriceUpdate: updated.lastPriceUpdate?.toISOString() ?? null,
    batchId: updated.batchId,
  };
}
