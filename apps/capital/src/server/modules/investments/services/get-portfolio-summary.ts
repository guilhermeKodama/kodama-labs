import type { DbClient } from "@capital/server/lib/prisma";

export interface PortfolioSummaryResult {
  totalInvested: number;
  totalByAssetClass: Record<string, number>;
  holdingsCount: number;
  accountsCount: number;
}

export async function getPortfolioSummary(
  userId: string,
  db: DbClient
): Promise<PortfolioSummaryResult> {
  const [accounts, holdings] = await Promise.all([
    db.investmentAccount.count({
      where: { userId, isActive: true },
    }),
    db.investmentHolding.findMany({
      where: {
        account: { userId },
        isActive: true,
      },
      select: {
        assetClass: true,
        totalInvested: true,
      },
    }),
  ]);

  const totalInvested = holdings.reduce((sum, h) => sum + h.totalInvested, 0);

  const totalByAssetClass: Record<string, number> = {};
  for (const h of holdings) {
    totalByAssetClass[h.assetClass] =
      (totalByAssetClass[h.assetClass] || 0) + h.totalInvested;
  }

  return {
    totalInvested,
    totalByAssetClass,
    holdingsCount: holdings.length,
    accountsCount: accounts,
  };
}
