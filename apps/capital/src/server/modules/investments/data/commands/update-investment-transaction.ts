import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@/generated/prisma";

interface UpdateInvestmentTransactionData {
  type?: InvestmentTransactionType;
  quantity?: number;
  pricePerUnit?: number;
  totalAmount?: number;
  fees?: number;
  date?: Date;
  notes?: string;
}

export async function updateInvestmentTransaction(
  userId: string,
  id: string,
  data: UpdateInvestmentTransactionData,
  db: DbClient
) {
  const transaction = await db.investmentTransaction.findFirst({
    where: {
      id,
      holding: { account: { userId } },
    },
    select: { id: true },
  });

  if (!transaction) {
    throw new Error("Investment transaction not found");
  }

  return db.investmentTransaction.update({
    where: { id },
    data,
  });
}
