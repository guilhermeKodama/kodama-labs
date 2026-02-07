import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@prisma/client";

interface FetchInvestmentTransactionsFilters {
  holdingId?: string;
  accountId?: string;
  type?: InvestmentTransactionType;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function fetchInvestmentTransactions(
  userId: string,
  filters: FetchInvestmentTransactionsFilters,
  db: DbClient
) {
  return db.investmentTransaction.findMany({
    where: {
      holding: {
        account: { userId },
        ...(filters.accountId && { accountId: filters.accountId }),
      },
      ...(filters.holdingId && { holdingId: filters.holdingId }),
      ...(filters.type && { type: filters.type }),
      ...(filters.dateFrom || filters.dateTo
        ? {
            date: {
              ...(filters.dateFrom && { gte: filters.dateFrom }),
              ...(filters.dateTo && { lte: filters.dateTo }),
            },
          }
        : {}),
    },
    include: {
      holding: {
        select: {
          id: true,
          name: true,
          ticker: true,
          assetClass: true,
        },
      },
    },
    orderBy: { date: "desc" },
  });
}

export async function fetchInvestmentTransactionById(
  userId: string,
  id: string,
  db: DbClient
) {
  return db.investmentTransaction.findFirst({
    where: {
      id,
      holding: { account: { userId } },
    },
    include: {
      holding: {
        select: {
          id: true,
          name: true,
          ticker: true,
          assetClass: true,
        },
      },
    },
  });
}
