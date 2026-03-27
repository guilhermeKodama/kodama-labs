import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@/generated/prisma";
import { updateInvestmentTransaction as updateCmd } from "../data/commands/update-investment-transaction";
import { recalculateHolding } from "./recalculate-holding";

interface UpdateInvestmentTransactionInput {
  type?: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount?: number;
  fees?: number;
  date?: Date;
  notes?: string;
}

function getCashImpact(type: string, totalAmount: number, fees: number): number {
  switch (type) {
    case "buy":
    case "deposit":
      return -(totalAmount + fees);
    case "sell":
    case "withdrawal":
      return totalAmount - fees;
    case "dividend":
    case "yield_payment":
      return totalAmount;
    default:
      return 0;
  }
}

export async function updateInvestmentTransactionService(
  userId: string,
  id: string,
  input: UpdateInvestmentTransactionInput,
  db: DbClient
) {
  // Get existing transaction
  const existing = await db.investmentTransaction.findFirst({
    where: { id, holding: { account: { userId } } },
    select: {
      holdingId: true,
      type: true,
      totalAmount: true,
      fees: true,
      holding: { select: { accountId: true } },
    },
  });

  if (!existing) {
    throw new Error("Investment transaction not found");
  }

  // Calculate old cash impact to reverse it
  const oldCashImpact = getCashImpact(existing.type, existing.totalAmount, existing.fees);

  const transaction = await updateCmd(userId, id, input, db);

  // Calculate new cash impact
  const newType = input.type ?? existing.type;
  const newAmount = input.totalAmount ?? existing.totalAmount;
  const newFees = input.fees ?? existing.fees;
  const newCashImpact = getCashImpact(newType, newAmount, newFees);

  // Apply the difference to cash balance
  const diff = newCashImpact - oldCashImpact;
  if (diff !== 0) {
    await db.investmentAccount.update({
      where: { id: existing.holding.accountId },
      data: { cashBalance: { increment: diff } },
    });
  }

  // Recalculate holding
  await recalculateHolding(userId, existing.holdingId, db);

  return transaction;
}
