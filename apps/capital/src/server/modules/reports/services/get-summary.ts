import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";

export interface EntitySummary {
  entityId: string;
  entityType: EntityType;
  entityName: string;
  totalIncome: number;
  totalExpenses: number;
  totalInvestments: number;
  balance: number;
  netWorth: number;
  currency: string;
}

interface GetSummaryInput {
  userId: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export async function getSummary(
  input: GetSummaryInput,
  db: DbClient
): Promise<EntitySummary[]> {
  const { userId, dateFrom, dateTo } = input;

  // Get user's businesses and personal account
  const [businesses, personalAccount] = await Promise.all([
    db.business.findMany({
      where: { userId },
    }),
    db.personalAccount.findFirst({
      where: { userId },
    }),
  ]);

  const summaries: EntitySummary[] = [];

  // Build date filter
  const dateFilter =
    dateFrom || dateTo
      ? {
          date: {
            ...(dateFrom && { gte: dateFrom }),
            ...(dateTo && { lte: dateTo }),
          },
        }
      : {};

  // Calculate summary for each business
  for (const business of businesses) {
    const [transactions, reimbursementTransfers] = await Promise.all([
      db.transaction.findMany({
        where: {
          businessId: business.id,
          ...dateFilter,
        },
      }),
      db.transfer.findMany({
        where: {
          fromBusinessId: business.id,
          direction: "reimbursement",
          ...(dateFrom || dateTo
            ? {
                date: {
                  ...(dateFrom && { gte: dateFrom }),
                  ...(dateTo && { lte: dateTo }),
                },
              }
            : {}),
        },
      }),
    ]);

    const totalIncome = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0);

    const reimbursementExpenses = reimbursementTransfers.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    const totalExpenses =
      transactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0) + reimbursementExpenses;

    const totalInvestments = transactions
      .filter((t) => t.type === "investment")
      .reduce((sum, t) => sum + t.amount, 0);

    summaries.push({
      entityId: business.id,
      entityType: "business",
      entityName: business.name,
      totalIncome,
      totalExpenses,
      totalInvestments,
      balance: business.initialBalance + totalIncome - totalExpenses,
      netWorth: business.initialBalance + totalIncome - totalExpenses + totalInvestments,
      currency: business.defaultCurrency,
    });
  }

  // Calculate summary for personal account
  if (personalAccount) {
    const [transactions, reimbursementTransfers] = await Promise.all([
      db.transaction.findMany({
        where: {
          personalAccountId: personalAccount.id,
          ...dateFilter,
        },
      }),
      db.transfer.findMany({
        where: {
          toPersonalAccountId: personalAccount.id,
          direction: "reimbursement",
          ...(dateFrom || dateTo
            ? {
                date: {
                  ...(dateFrom && { gte: dateFrom }),
                  ...(dateTo && { lte: dateTo }),
                },
              }
            : {}),
        },
      }),
    ]);

    const totalIncome = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0);

    const reimbursementCredits = reimbursementTransfers.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    const totalExpenses = Math.max(
      0,
      transactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0) - reimbursementCredits
    );

    const totalInvestments = transactions
      .filter((t) => t.type === "investment")
      .reduce((sum, t) => sum + t.amount, 0);

    summaries.push({
      entityId: personalAccount.id,
      entityType: "personal",
      entityName: "Personal",
      totalIncome,
      totalExpenses,
      totalInvestments,
      balance: personalAccount.initialBalance + totalIncome - totalExpenses,
      netWorth: personalAccount.initialBalance + totalIncome - totalExpenses + totalInvestments,
      currency: personalAccount.defaultCurrency,
    });
  }

  return summaries;
}
