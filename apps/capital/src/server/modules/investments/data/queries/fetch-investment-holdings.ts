import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass } from "@prisma/client";

interface FetchInvestmentHoldingsFilters {
  accountId?: string;
  assetClass?: AssetClass;
  isActive?: boolean;
}

export async function fetchInvestmentHoldings(
  userId: string,
  filters: FetchInvestmentHoldingsFilters,
  db: DbClient
) {
  return db.investmentHolding.findMany({
    where: {
      account: { userId },
      ...(filters.accountId && { accountId: filters.accountId }),
      ...(filters.assetClass && { assetClass: filters.assetClass }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    include: {
      account: {
        select: {
          id: true,
          name: true,
          broker: true,
          entityType: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function fetchInvestmentHoldingById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.investmentHolding.findFirst({
    where: {
      id,
      account: { userId },
    },
    include: {
      account: {
        select: {
          id: true,
          name: true,
          broker: true,
          entityType: true,
        },
      },
      transactions: {
        orderBy: { date: "desc" },
      },
    },
  });
}
