import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@prisma/client";
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

export async function updateInvestmentTransactionService(
  userId: string,
  id: string,
  input: UpdateInvestmentTransactionInput,
  db: DbClient
) {
  // Get holding ID before update
  const existing = await db.investmentTransaction.findFirst({
    where: { id, holding: { account: { userId } } },
    select: { holdingId: true },
  });

  if (!existing) {
    throw new Error("Investment transaction not found");
  }

  const transaction = await updateCmd(userId, id, input, db);

  // Recalculate holding
  await recalculateHolding(userId, existing.holdingId, db);

  return transaction;
}
