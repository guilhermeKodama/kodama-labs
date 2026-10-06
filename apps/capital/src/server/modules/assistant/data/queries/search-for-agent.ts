import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, Prisma, TransactionType } from "@/generated/prisma";
import { excludeProjected } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { legacyEntityRef } from "@capital/server/modules/ledger/services/entities";
import { toNumber } from "@capital/server/modules/ledger/lib/money";

const dateRange = (from?: Date, to?: Date) => ((from || to) && { ...(from && { gte: from }), ...(to && { lte: to }) }) || undefined;

export interface SearchBillTransactionsFilters {
  creditCardId?: string;
  /** Card statement id (a "bill" in the assistant's vocabulary). */
  billId?: string;
  category?: string;
  descriptionContains?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  offset?: number;
}

/**
 * Card purchases (entries on credit card accounts, projected installments
 * and bill payments excluded) with the category breakdown computed over the
 * whole filtered set, so the agent never sums a capped page itself.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function searchBillTransactionsForAgent(userId: string, filters: SearchBillTransactionsFilters, db: DbClient) {
  const scoped: Prisma.LedgerEntryWhereInput = {
    userId,
    deletedAt: null,
    transferGroupId: null,
    account: { type: "credit_card", ...(filters.creditCardId && { id: filters.creditCardId }) },
    ...(await excludeProjected(userId, db)),
    ...(filters.billId && { cardStatementId: filters.billId }),
    ...(filters.category && { category: { name: filters.category } }),
    ...(filters.descriptionContains && { description: { contains: filters.descriptionContains, mode: "insensitive" } }),
    ...(dateRange(filters.dateFrom, filters.dateTo) && { date: dateRange(filters.dateFrom, filters.dateTo) }),
  };

  const [total, rows, groups] = await Promise.all([
    db.ledgerEntry.count({ where: scoped }),
    db.ledgerEntry.findMany({
      where: scoped,
      orderBy: { date: "desc" },
      take: filters.limit,
      skip: filters.offset ?? 0,
      include: { category: { select: { name: true } } },
    }),
    db.ledgerEntry.groupBy({ by: ["categoryId"], where: scoped, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const names = new Map(
    (await db.category.findMany({ where: { id: { in: groups.map((g) => g.categoryId).filter((id): id is string => !!id) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name])
  );

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      billId: r.cardStatementId,
      transactionDate: r.date,
      description: r.description,
      merchantName: r.merchantName,
      amount: -toNumber(r.amount),
      category: r.category?.name ?? null,
      installmentNumber: r.installmentNumber,
      totalInstallments: (r.metadata as { totalInstallments?: number } | null)?.totalInstallments ?? null,
    })),
    byCategory: groups
      .map((g) => ({ category: g.categoryId ? names.get(g.categoryId) ?? null : null, totalAmount: -toNumber(g._sum.amount ?? 0), count: g._count._all }))
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
 * Income/expense/investment entries (not transfer legs), with the filters
 * the agent needs. Amount filters apply to the positive magnitude.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function searchTransactionsForAgent(userId: string, filters: SearchTransactionsFilters, db: DbClient) {
  const magnitude =
    filters.amountMin !== undefined || filters.amountMax !== undefined
      ? {
          OR: [
            { amount: { ...(filters.amountMin !== undefined && { gte: filters.amountMin }), ...(filters.amountMax !== undefined && { lte: filters.amountMax }) } },
            { amount: { ...(filters.amountMax !== undefined && { gte: -filters.amountMax }), ...(filters.amountMin !== undefined && { lte: -filters.amountMin }) } },
          ],
        }
      : {};
  const where: Prisma.LedgerEntryWhereInput = {
    userId,
    deletedAt: null,
    transferGroupId: null,
    kind: filters.type ?? { in: ["income", "expense", "investment"] },
    ...(filters.entityType && { entity: { kind: filters.entityType } }),
    ...(filters.entityId && { entityId: filters.entityId }),
    ...(filters.statementImportId && { importId: filters.statementImportId }),
    ...(filters.externalIds?.length && { externalId: { in: filters.externalIds } }),
    ...(filters.descriptionContains && { description: { contains: filters.descriptionContains, mode: "insensitive" } }),
    ...(dateRange(filters.dateFrom, filters.dateTo) && { date: dateRange(filters.dateFrom, filters.dateTo) }),
    ...magnitude,
  };
  const [total, rows] = await Promise.all([
    db.ledgerEntry.count({ where }),
    db.ledgerEntry.findMany({
      where,
      orderBy: { date: "desc" },
      take: filters.limit,
      skip: filters.offset ?? 0,
      include: { category: { select: { name: true } }, _count: { select: { attachments: true } } },
    }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      amount: Math.abs(toNumber(r.amount)),
      type: r.kind,
      category: r.category?.name ?? null,
      accountId: r.accountId,
      externalId: r.externalId,
      statementImportId: r.importId,
      _count: r._count,
    })),
  };
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
 * Transfer groups (between entities, accounts, brokerages, card payments),
 * reported in the legacy from/to shape. Brokerage sides are reported as
 * investment account ids.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function searchTransfersForAgent(userId: string, filters: SearchTransfersFilters, db: DbClient) {
  const where: Prisma.TransferGroupWhereInput = {
    userId,
    deletedAt: null,
    ...((filters.entityId || filters.entityType) && {
      legs: { some: { ...(filters.entityId && { entityId: filters.entityId }), ...(filters.entityType && { entity: { kind: filters.entityType } }) } },
    }),
    ...(filters.externalIds?.length && { externalId: { in: filters.externalIds } }),
    ...(dateRange(filters.dateFrom, filters.dateTo) && { date: dateRange(filters.dateFrom, filters.dateTo) }),
  };
  const [total, groups] = await Promise.all([
    db.transferGroup.count({ where }),
    db.transferGroup.findMany({
      where,
      orderBy: { date: "desc" },
      take: filters.limit,
      skip: filters.offset ?? 0,
      include: { legs: { include: { account: { select: { id: true, type: true } }, entity: { select: { id: true, kind: true } } } } },
    }),
  ]);
  return {
    total,
    rows: groups.map((g) => {
      const from = g.legs.find((l) => toNumber(l.amount) < 0) ?? g.legs[0];
      const to = g.legs.find((l) => l.id !== from?.id) ?? g.legs[0];
      const side = (leg: typeof from) => {
        if (!leg) return { businessId: null, personalAccountId: null, investmentAccountId: null };
        if (leg.account.type === "brokerage") return { businessId: null, personalAccountId: null, investmentAccountId: leg.account.id };
        const ref = legacyEntityRef(leg.entity);
        return { businessId: ref.businessId, personalAccountId: ref.personalAccountId, investmentAccountId: null };
      };
      const f = side(from);
      const t = side(to);
      return {
        id: g.id,
        date: g.date,
        description: g.description,
        amount: Math.abs(toNumber(from?.amount ?? 0)),
        direction: g.direction,
        externalId: g.externalId,
        fromAccountId: from?.accountId ?? null,
        toAccountId: to?.accountId ?? null,
        fromBusinessId: f.businessId,
        fromPersonalAccountId: f.personalAccountId,
        fromInvestmentAccountId: f.investmentAccountId,
        toBusinessId: t.businessId,
        toPersonalAccountId: t.personalAccountId,
        toInvestmentAccountId: t.investmentAccountId,
      };
    }),
  };
}
