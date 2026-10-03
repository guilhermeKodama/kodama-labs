import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";
import { shouldCountAsExpense, buildSettlementSet } from "../../../../lib/utils/expense-classification";

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

  // Fetch all credit card statements to build settlement ID set
  const statements = await db.creditCardStatement.findMany({
    where: {
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    select: {
      billPaymentTransactionId: true,
    },
  });

  const settlementIds = buildSettlementSet(statements);

  const summaries: EntitySummary[] = [];

  // Build date filter for transactions
  const transactionDateFilter =
    dateFrom || dateTo
      ? {
          date: {
            ...(dateFrom && { gte: dateFrom }),
            ...(dateTo && { lte: dateTo }),
          },
        }
      : {};

  // Build date filter for bill transactions (statement purchases)
  const billTxDateFilter =
    dateFrom || dateTo
      ? {
          transactionDate: {
            ...(dateFrom && { gte: dateFrom }),
            ...(dateTo && { lte: dateTo }),
          },
        }
      : {};

  // Calculate summary for each business
  for (const business of businesses) {
    const [transactions, reimbursementTransfers, statementPurchases] = await Promise.all([
      db.transaction.findMany({
        where: {
          businessId: business.id,
          ...transactionDateFilter,
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
      // Fetch statement purchases for this business
      db.billTransaction.findMany({
        where: {
          statementId: { not: null },
          statement: {
            creditCard: {
              businessId: business.id,
            },
          },
          ...billTxDateFilter,
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

    // Regular expense transactions (excluding settlements)
    const regularExpenses = transactions
      .filter((t) => t.type === "expense" && shouldCountAsExpense(t, settlementIds.has(t.id)))
      .reduce((sum, t) => sum + t.amount, 0);

    // Statement purchases (credit card expenses)
    const statementExpenses = statementPurchases.reduce((sum, bt) => sum + bt.amount, 0);

    const totalExpenses = regularExpenses + statementExpenses + reimbursementExpenses;

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
    const [transactions, reimbursementTransfers, statementPurchases] = await Promise.all([
      db.transaction.findMany({
        where: {
          personalAccountId: personalAccount.id,
          ...transactionDateFilter,
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
      // Fetch statement purchases for personal account
      db.billTransaction.findMany({
        where: {
          statementId: { not: null },
          statement: {
            creditCard: {
              personalAccountId: personalAccount.id,
            },
          },
          ...billTxDateFilter,
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

    // Regular expense transactions (excluding settlements)
    const regularExpenses = transactions
      .filter((t) => t.type === "expense" && shouldCountAsExpense(t, settlementIds.has(t.id)))
      .reduce((sum, t) => sum + t.amount, 0);

    // Statement purchases (credit card expenses)
    const statementExpenses = statementPurchases.reduce((sum, bt) => sum + bt.amount, 0);

    const totalExpenses = Math.max(
      0,
      regularExpenses + statementExpenses - reimbursementCredits
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
