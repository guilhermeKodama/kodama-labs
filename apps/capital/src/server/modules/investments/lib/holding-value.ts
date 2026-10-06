import type { AssetClass } from "@/generated/prisma";

/** Fixed income and savings are tracked by amount: with no quantity, the position is the cost basis. */
export const AMOUNT_BASED: readonly AssetClass[] = ["fixed_income", "savings"];

/** What valuing a position reads. */
export interface ValuedPosition {
  assetClass: AssetClass;
  currentQuantity: number;
  currentPrice: number | null;
  totalInvested: number;
}

/**
 * Market value in the holding's currency: quantity x price, or the cost
 * basis while there is no price yet. With no quantity an amount-based asset
 * (fixed income, savings) is worth its cost basis; anything else is worth 0
 * (a sold-out position never falls back to what was invested).
 */
export function marketValue(h: ValuedPosition) {
  if (h.currentQuantity > 0) return h.currentPrice !== null ? h.currentQuantity * h.currentPrice : h.totalInvested;
  return AMOUNT_BASED.includes(h.assetClass) ? h.totalInvested : 0;
}
