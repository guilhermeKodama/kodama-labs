import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@/generated/prisma";

interface CreateInvestmentTransactionData {
  holdingId: string;
  type: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount: number;
  fees?: number;
  date: Date;
  notes?: string;
}

export async function insertInvestmentTransaction(
  userId: string,
  data: CreateInvestmentTransactionData,
  db: DbClient
) {
  // Verify user owns the holding through the account
  const holding = await db.investmentHolding.findFirst({
    where: {
      id: data.holdingId,
      account: { userId },
    },
    select: { id: true },
  });

  if (!holding) {
    throw new Error("Investment holding not found or access denied");
  }

  return db.investmentTransaction.create({
    data: {
      ...data,
      fees: data.fees ?? 0,
    },
  });
}
