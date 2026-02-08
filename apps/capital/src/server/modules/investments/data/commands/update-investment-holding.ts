import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass, FixedIncomeSubType } from "@prisma/client";

interface UpdateInvestmentHoldingData {
  name?: string;
  ticker?: string;
  assetClass?: AssetClass;
  subType?: FixedIncomeSubType;
  currency?: string;
  isActive?: boolean;
  currentQuantity?: number;
  averageCost?: number;
  totalInvested?: number;
}

export async function updateInvestmentHolding(
  userId: string,
  id: string,
  data: UpdateInvestmentHoldingData,
  db: DbClient
) {
  const holding = await db.investmentHolding.findFirst({
    where: {
      id,
      account: { userId },
    },
    select: { id: true },
  });

  if (!holding) {
    throw new Error("Investment holding not found");
  }

  return db.investmentHolding.update({
    where: { id },
    data,
  });
}
