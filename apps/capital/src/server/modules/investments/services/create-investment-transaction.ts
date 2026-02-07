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

export async function createInvestmentTransaction(
  userId: string,
  input: CreateInvestmentTransactionInput,
  db: DbClient
) {
  const transaction = await insertInvestmentTransaction(userId, input, db);

  // Recalculate holding averageCost, currentQuantity, and totalInvested
  await recalculateHolding(userId, input.holdingId, db);

  return transaction;
}
