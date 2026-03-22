import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass, FixedIncomeSubType } from "@/generated/prisma";

interface CreateInvestmentHoldingData {
  accountId: string;
  assetClass: AssetClass;
  subType?: FixedIncomeSubType;
  ticker?: string;
  name: string;
  currency: string;
}

export async function insertInvestmentHolding(
  userId: string,
  data: CreateInvestmentHoldingData,
  db: DbClient
) {
  // Verify user owns the account
  const account = await db.investmentAccount.findFirst({
    where: { id: data.accountId, userId },
    select: { id: true },
  });

  if (!account) {
    throw new Error("Investment account not found or access denied");
  }

  return db.investmentHolding.create({
    data,
  });
}
