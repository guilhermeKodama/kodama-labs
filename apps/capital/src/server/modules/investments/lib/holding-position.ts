import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Weighted-average position from all operations, oldest first. Lives apart
 * from the portfolio service so the undo log (ledger/services/mutations.ts)
 * can recalculate holdings without importing the service that records into it.
 */
export async function recalculateHolding(holdingId: string, db: DbClient) {
  const ops = await db.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  let qty = 0;
  let cost = 0;
  let invested = 0;
  for (const op of ops) {
    const q = op.quantity ?? 0;
    const p = op.pricePerUnit ?? 0;
    switch (op.type) {
      case "buy":
      case "deposit":
        qty += q;
        cost += q * p || op.totalAmount;
        invested += op.totalAmount;
        break;
      case "sell":
      case "withdrawal":
        if (q > 0) {
          const prev = qty;
          qty -= q;
          cost = qty > 0 && prev > 0 ? cost * (qty / prev) : 0;
        } else {
          invested -= op.totalAmount;
          cost = Math.max(0, cost - op.totalAmount);
        }
        break;
      case "split":
        qty += q;
        break;
      case "adjustment":
        if (q > 0 && p > 0) {
          // An adjustment carrying quantity and price resets the position.
          qty = q;
          cost = q * p;
          invested = op.totalAmount;
        } else {
          invested += op.totalAmount;
          cost = Math.max(0, cost + op.totalAmount);
        }
        break;
      default:
        break;
    }
  }
  return db.investmentHolding.update({
    where: { id: holdingId },
    data: { currentQuantity: Math.max(0, qty), averageCost: qty > 0 ? cost / qty : 0, totalInvested: Math.max(0, invested) },
  });
}
