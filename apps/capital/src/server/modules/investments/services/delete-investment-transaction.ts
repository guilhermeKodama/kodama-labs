import type { DbClient } from "@capital/server/lib/prisma";
import { deleteInvestmentTransaction as deleteCmd } from "../data/commands/delete-investment-transaction";
import { recalculateHolding } from "./recalculate-holding";

/**
 * Reverse cash balance impact when deleting an investment transaction.
 */
function getReverseCashImpact(
  type: string,
  totalAmount: number,
  fees: number
): number {
  switch (type) {
    case "buy":
    case "deposit":
      // Original was negative, reverse is positive
      return totalAmount + fees;
    case "sell":
    case "withdrawal":
      // Original was positive, reverse is negative
      return -(totalAmount - fees);
    case "dividend":
    case "yield_payment":
      return -totalAmount;
    default:
      return 0;
  }
}

export async function deleteInvestmentTransactionService(
  userId: string,
  id: string,
  db: DbClient
) {
  // Get transaction data before delete
  const existing = await db.investmentTransaction.findFirst({
    where: { id, holding: { account: { userId } } },
    select: {
      holdingId: true,
      linkedTransactionId: true,
      type: true,
      totalAmount: true,
      fees: true,
      holding: { select: { accountId: true } },
    },
  });

  if (!existing) {
    throw new Error("Investment transaction not found");
  }

  // Delete the investment transaction
  await deleteCmd(userId, id, db);

  // Also delete the linked entity transaction if it exists
  // (from fund/withdraw operations)
  if (existing.linkedTransactionId) {
    await db.transaction
      .delete({ where: { id: existing.linkedTransactionId } })
      .catch(() => {
        // Linked transaction may already be deleted
      });
  }

  // Reverse the cash balance impact on the investment account
  const reverseImpact = getReverseCashImpact(
    existing.type,
    existing.totalAmount,
    existing.fees
  );
  if (reverseImpact !== 0) {
    await db.investmentAccount.update({
      where: { id: existing.holding.accountId },
      data: { cashBalance: { increment: reverseImpact } },
    });
  }

  // Recalculate holding
  await recalculateHolding(userId, existing.holdingId, db);
}
