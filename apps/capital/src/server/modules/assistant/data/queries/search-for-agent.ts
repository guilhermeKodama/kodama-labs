import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransactionType } from "@/generated/prisma";

export interface SearchBillTransactionsFilters {
  creditCardId?: string;
  billId?: string;
  category?: string;
  descriptionContains?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  offset?: number;
}

/**
 * Search a user's credit card bill line items, with the category breakdown
 * pre-aggregated - there is no REST endpoint for "spend by category" today
 * (the credit cards page computes it client-side), so the agent needs the
 * numbers computed here rather than summing rows itself from a capped page.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function searchBillTransactionsForAgent(
  userId: string,
  filters: SearchBillTransactionsFilters,
  db: DbClient
) {
  const where = {
    bill: {
      creditCard: { OR: [{ business: { userId } }, { personalAccount: { userId } }] },
      ...(filters.creditCardId && { creditCardId: filters.creditCardId }),
    },
    ...(filters.billId && { billId: filters.billId }),
    ...(filters.category && { category: filters.category }),
    ...(filters.descriptionContains && {
      description: { contains: filters.descriptionContains, mode: "insensitive" as const },
    }),
    ...((filters.dateFrom || filters.dateTo) && {
      transactionDate: {
        ...(filters.dateFrom && { gte: filters.dateFrom }),
        ...(filters.dateTo && { lte: filters.dateTo }),
      },
    }),
  };

  const [total, rows, byCategory] = await Promise.all([
    db.billTransaction.count({ where }),
    db.billTransaction.findMany({
      where,
      orderBy: { transactionDate: "desc" },
      take: filters.limit,
      skip: filters.offset ?? 0,
      select: {
        id: true,
        billId: true,
        transactionDate: true,
        description: true,
        merchantName: true,
        amount: true,
        category: true,
        installmentNumber: true,
        totalInstallments: true,
      },
    }),
    db.billTransaction.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    total,
    rows,
    byCategory: byCategory
      .map((c) => ({
        category: c.category,
        totalAmount: c._sum.amount ?? 0,
        count: c._count._all,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
  };
}

export interface SearchTransactionsFilters {
  entityType?: EntityType;
  entityId?: string;
  type?: TransactionType;
  dateFrom?: Date;
  dateTo?: Date;
  descriptionContains?: string;
  amountMin?: number;
  amountMax?: number;
  externalIds?: string[];
  statementImportId?: string;
  limit: number;
  offset?: number;
}

/**
 * Search transactions with the wider filter set the agent needs (free-text
 * description, amount range, batch externalId lookup) that the plain REST
 * listing doesn't expose. Still scoped by userId through the polymorphic
 * business/personalAccount ownership check, same as every other query.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function searchTransactionsForAgent(
  userId: string,
  filters: SearchTransactionsFilters,
  db: DbClient
) {
  const where = {
    OR: [{ business: { userId } }, { personalAccount: { userId } }],
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.entityId &&
      (filters.entityType === "business"
        ? { businessId: filters.entityId }
        : filters.entityType === "personal"
          ? { personalAccountId: filters.entityId }
          : { OR: [{ businessId: filters.entityId }, { personalAccountId: filters.entityId }] })),
    ...(filters.type && { type: filters.type }),
    ...(filters.statementImportId && { statementImportId: filters.statementImportId }),
    ...(filters.externalIds?.length && { externalId: { in: filters.externalIds } }),
    ...(filters.descriptionContains && {
      description: { contains: filters.descriptionContains, mode: "insensitive" as const },
    }),
    ...((filters.amountMin !== undefined || filters.amountMax !== undefined) && {
      amount: {
        ...(filters.amountMin !== undefined && { gte: filters.amountMin }),
        ...(filters.amountMax !== undefined && { lte: filters.amountMax }),
      },
    }),
    ...((filters.dateFrom || filters.dateTo) && {
      date: {
        ...(filters.dateFrom && { gte: filters.dateFrom }),
        ...(filters.dateTo && { lte: filters.dateTo }),
      },
    }),
  };

  const [total, rows] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      take: filters.limit,
      skip: filters.offset ?? 0,
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        type: true,
        category: true,
        externalId: true,
        statementImportId: true,
      },
    }),
  ]);

  return { total, rows };
}

export interface SearchTransfersFilters {
  entityType?: EntityType;
  entityId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  externalIds?: string[];
  limit: number;
  offset?: number;
}

/**
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function searchTransfersForAgent(
  userId: string,
  filters: SearchTransfersFilters,
  db: DbClient
) {
  const entityFilter = filters.entityId
    ? {
        OR: [
          { fromBusinessId: filters.entityId },
          { fromPersonalAccountId: filters.entityId },
          { toBusinessId: filters.entityId },
          { toPersonalAccountId: filters.entityId },
        ],
      }
    : {};

  const where = {
    OR: [
      { fromBusiness: { userId } },
      { fromPersonalAccount: { userId } },
      { toBusiness: { userId } },
      { toPersonalAccount: { userId } },
    ],
    ...entityFilter,
    ...(filters.externalIds?.length && { externalId: { in: filters.externalIds } }),
    ...((filters.dateFrom || filters.dateTo) && {
      date: {
        ...(filters.dateFrom && { gte: filters.dateFrom }),
        ...(filters.dateTo && { lte: filters.dateTo }),
      },
    }),
  };

  const [total, rows] = await Promise.all([
    db.transfer.count({ where }),
    db.transfer.findMany({
      where,
      orderBy: { date: "desc" },
      take: filters.limit,
      skip: filters.offset ?? 0,
      select: {
        id: true,
        date: true,
        description: true,
        amount: true,
        direction: true,
        externalId: true,
        fromBusinessId: true,
        fromPersonalAccountId: true,
        fromInvestmentAccountId: true,
        toBusinessId: true,
        toPersonalAccountId: true,
        toInvestmentAccountId: true,
      },
    }),
  ]);

  return { total, rows };
}
