import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@prisma/client";
import { insertInvestmentTransaction } from "../data/commands/insert-investment-transaction";
import { recalculateHolding } from "./recalculate-holding";

interface CreateInvestmentTransactionInput {
  holdingId: string;
  type: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount: number;
  fees?: number;
  date: Date;
  notes?: string;
}

/**
 * Get the cash balance impact of an investment transaction.
 * Returns a positive number if cash increases, negative if it decreases.
 *
 * - buy: cash leaves the account to purchase securities → negative
 * - sell: cash enters the account from selling securities → positive
 * - deposit (holding-level, e.g. fixed income): cash goes into the holding → negative
 * - withdrawal (holding-level): cash comes out of the holding → positive
 * - dividend / yield_payment: cash received → positive
 * - split: no cash movement → 0
 */
function getCashBalanceImpact(
  type: InvestmentTransactionType,
  totalAmount: number,
  fees: number
): number {
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
    case "split":
    case "adjustment":
      return 0;
    default:
      return 0;
  }
}

export async function createInvestmentTransaction(
  userId: string,
  input: CreateInvestmentTransactionInput,
  db: DbClient
) {
  const transaction = await insertInvestmentTransaction(userId, input, db);

  // Recalculate holding averageCost, currentQuantity, and totalInvested
  await recalculateHolding(userId, input.holdingId, db);

  // Update the investment account's cash balance
  const cashImpact = getCashBalanceImpact(input.type, input.totalAmount, input.fees ?? 0);
  if (cashImpact !== 0) {
    const holding = await db.investmentHolding.findFirst({
      where: { id: input.holdingId, account: { userId } },
      select: { accountId: true },
    });

    if (holding) {
      await db.investmentAccount.update({
        where: { id: holding.accountId },
        data: { cashBalance: { increment: cashImpact } },
      });
    }
  }

  return transaction;
}
