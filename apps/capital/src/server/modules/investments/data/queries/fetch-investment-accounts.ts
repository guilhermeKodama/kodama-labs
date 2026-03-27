import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

interface FetchInvestmentAccountsFilters {
  entityType?: EntityType;
  isActive?: boolean;
}

export async function fetchInvestmentAccounts(
  userId: string,
  filters: FetchInvestmentAccountsFilters,
  db: DbClient
) {
  return db.investmentAccount.findMany({
    where: {
      userId,
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    include: {
      holdings: {
        where: { isActive: true },
        select: {
          id: true,
          assetClass: true,
          totalInvested: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function fetchInvestmentAccountById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.investmentAccount.findFirst({
    where: { id, userId },
    include: {
      holdings: {
        orderBy: { name: "asc" },
      },
    },
  });
}
