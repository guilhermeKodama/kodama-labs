import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Recalculate a holding's currentQuantity, averageCost, and totalInvested
 * based on all its transactions.
 *
 * Uses weighted average cost method:
 * - buy/deposit: increases quantity and updates average cost
 * - sell/withdrawal: decreases quantity (average cost stays same)
 * - dividend/yield_payment: doesn't affect quantity or average cost (income only)
 * - split: adjusts quantity without changing total cost (average cost recalculated)
 */
export async function recalculateHolding(
  userId: string,
  holdingId: string,
  db: DbClient
) {
  const transactions = await db.investmentTransaction.findMany({
    where: {
      holdingId,
      holding: { account: { userId } },
    },
    orderBy: { date: "asc" },
  });

  let currentQuantity = 0;
  let totalCost = 0; // Total cost of current position (for average cost calc)
  let totalInvested = 0; // Cumulative invested amount (buys + deposits)

  for (const tx of transactions) {
    const qty = tx.quantity ?? 0;
    const price = tx.pricePerUnit ?? 0;
    const amount = tx.totalAmount;

    switch (tx.type) {
      case "buy":
      case "deposit": {
        currentQuantity += qty;
        totalCost += qty * price || amount;
        totalInvested += amount;
        break;
      }
      case "sell":
      case "withdrawal": {
        if (qty > 0) {
          // Quantity-based asset (stocks, BDRs, ETFs)
          const prevQuantity = currentQuantity;
          currentQuantity -= qty;
          if (currentQuantity > 0 && prevQuantity > 0) {
            totalCost = totalCost * (currentQuantity / prevQuantity);
          } else {
            totalCost = 0;
          }
        } else {
          // Amount-based asset (fixed income / renda fixa): no quantity,
          // the position IS the monetary amount. Reduce both totalInvested
          // and totalCost by the withdrawal amount.
          totalInvested -= amount;
          totalCost = Math.max(0, totalCost - amount);
        }
        break;
      }
      case "split": {
        // Split adjusts quantity but total cost stays the same
        currentQuantity += qty;
        break;
      }
      case "dividend":
      case "yield_payment": {
        // These are income events - don't affect position
        break;
      }
    }
  }

  const averageCost = currentQuantity > 0 ? totalCost / currentQuantity : 0;

  await db.investmentHolding.update({
    where: { id: holdingId },
    data: {
      currentQuantity: Math.max(0, currentQuantity),
      averageCost,
      totalInvested: Math.max(0, totalInvested),
    },
  });
}
