import { Prisma, type PrismaClient } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { amountInUserBase } from "@/lib/utils/currency";
import type { Currency } from "@/types";
import { matchCategoryName } from "../lib/category-validation";
import { unknownExpenseCategoryName } from "@capital/server/modules/categories/lib/unknown-expense-category";

interface InstallmentInfo {
  number: number;
  total: number;
}

interface StatementRow {
  date: string; // YYYY-MM-DD or ISO
  description: string;
  amount: number;
  currency?: string;
  categoryId?: string;
  category?: string;
  installment?: InstallmentInfo;
}

interface StatementMeta {
  month: string; // YYYY-MM
  closingDate?: string;
  dueDate?: string;
  total?: number;
}

interface ImportStatementParams {
  creditCardId: string;
  statement: StatementMeta;
  rows: StatementRow[];
}

/**
 * Normalize a description for deduplication.
 * Lowercase, trim whitespace, collapse multiple spaces.
 */
function normalizeDescription(desc: string): string {
  return desc.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Create a deduplication key for a purchase.
 * Format: date|amount|normalized-description|installment-number
 */
function createDedupeKey(
  date: Date,
  amount: number,
  description: string,
  installmentNumber?: number
): string {
  const dateStr = date.toISOString().split("T")[0];
  const amountStr = amount.toFixed(2);
  const descStr = normalizeDescription(description);
  const installmentStr = installmentNumber !== undefined ? `|${installmentNumber}` : "";
  return `${dateStr}|${amountStr}|${descStr}${installmentStr}`;
}

function rootClient(db: DbClient): PrismaClient {
  return db as PrismaClient;
}

/**
 * Import a monthly credit card statement.
 *
 * Creates or updates a CreditCardStatement, then inserts BillTransactions.
 * Identical rows (same date, amount, description, installment) are a multiset:
 * the import inserts only as many copies as the file has beyond the rows
 * already stored. Re-importing the same file inserts nothing.
 */
export async function importCreditCardStatement(
  userId: string,
  params: ImportStatementParams,
  db: DbClient
) {
  const client = rootClient(db);
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${params.creditCardId}), hashtext(${params.statement.month}))::text`;

    const card = await tx.creditCard.findFirst({
      where: {
        id: params.creditCardId,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: { id: true, currency: true },
    });

    if (!card) {
      throw new Error("Credit card not found or access denied");
    }

    const ownedCategories = await tx.category.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, isArchived: true },
    });
    const expenseCategories = ownedCategories.filter((category) => category.type === "expense");
    // Fallback writes other_system even when that row is archived. This is an
    // internal system write, not a user assignment.
    const fallbackName = await unknownExpenseCategoryName(userId, tx);

    const resolveCategory = (row: StatementRow): string => {
      if (row.categoryId) {
        const category = ownedCategories.find((item) => item.id === row.categoryId);
        if (!category) {
          throw new Error(`Category ${row.categoryId} not found or access denied`);
        }
        if (category.isArchived) {
          throw new Error(
            `Category '${category.name}' is archived and cannot be assigned. ` +
            `Unarchive it or choose a visible category.`
          );
        }
        return category.name;
      }
      if (row.category) {
        const matched = matchCategoryName(row.category, expenseCategories, "expense");
        if (matched.archived) {
          throw new Error(
            `Category '${matched.canonicalName ?? row.category}' is archived and cannot be assigned. ` +
            `Unarchive it or choose a visible category.`
          );
        }
        if (matched.canonicalName) return matched.canonicalName;
      }
      return fallbackName;
    };

    const statementData = {
      creditCardId: params.creditCardId,
      month: params.statement.month,
      closingDate: params.statement.closingDate ? parseLocalDate(params.statement.closingDate) : null,
      dueDate: params.statement.dueDate ? parseLocalDate(params.statement.dueDate) : null,
      totalAmount: params.statement.total ?? null,
    };

    const statement = await tx.creditCardStatement.upsert({
      where: {
        creditCardId_month: {
          creditCardId: params.creditCardId,
          month: params.statement.month,
        },
      },
      create: statementData,
      update: {
        closingDate: statementData.closingDate,
        dueDate: statementData.dueDate,
        totalAmount: statementData.totalAmount,
      },
      select: { id: true },
    });

    await tx.$queryRaw`SELECT id FROM "credit_card_statements" WHERE id = ${statement.id} FOR UPDATE`;

    const existingPurchases = await tx.billTransaction.findMany({
      where: { statementId: statement.id },
      select: {
        transactionDate: true,
        amount: true,
        description: true,
        installmentNumber: true,
      },
    });

    const existingCounts = new Map<string, number>();
    for (const purchase of existingPurchases) {
      const key = createDedupeKey(
        purchase.transactionDate,
        purchase.amount,
        purchase.description,
        purchase.installmentNumber ?? undefined
      );
      existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
    }

    const incomingGroups = new Map<string, StatementRow[]>();
    for (const row of params.rows) {
      const date = parseLocalDate(row.date);
      const key = createDedupeKey(date, row.amount, row.description, row.installment?.number);
      const group = incomingGroups.get(key) ?? [];
      group.push(row);
      incomingGroups.set(key, group);
    }

    const toCreate: Array<{
      statementId: string;
      category: string;
      transactionDate: Date;
      description: string;
      amount: number;
      currency: string;
      installmentNumber: number | null;
      totalInstallments: number | null;
      isAutoCategorized: boolean;
    }> = [];
    let skipped = 0;

    for (const [key, rows] of incomingGroups) {
      const already = existingCounts.get(key) ?? 0;
      const insertCount = rows.length - already;
      if (insertCount <= 0) {
        skipped += rows.length;
        continue;
      }
      skipped += already;
      for (const row of rows.slice(already)) {
        const date = parseLocalDate(row.date);
        toCreate.push({
          statementId: statement.id,
          category: resolveCategory(row),
          transactionDate: date,
          description: row.description,
          amount: row.amount,
          currency: row.currency ?? card.currency,
          installmentNumber: row.installment?.number ?? null,
          totalInstallments: row.installment?.total ?? null,
          isAutoCategorized: false,
        });
      }
    }

    let createdIds: string[] = [];
    if (toCreate.length > 0) {
      const created = await tx.billTransaction.createManyAndReturn({
        data: toCreate,
        select: { id: true },
      });
      createdIds = created.map((row) => row.id);
    }

    return {
      statementId: statement.id,
      created: createdIds.length,
      skipped,
      createdIds,
    };
  });
}

interface MarkAsSettlementParams {
  transactionId: string;
  statementId: string;
}

const ALREADY_LINKED = "Statement already has a different bill payment transaction linked";

/**
 * Link an expense transaction to a statement as the bill payment.
 * The link excludes the payment from expense totals. The category is left as-is.
 */
export async function markTransactionAsCardSettlement(
  userId: string,
  params: MarkAsSettlementParams,
  db: DbClient
) {
  const client = rootClient(db);
  return client.$transaction(async (tx) => {
    const lockKeys = [params.transactionId, params.statementId].sort();
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeys[0]}))::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeys[1]}))::text`;

    const transaction = await tx.transaction.findFirst({
      where: {
        id: params.transactionId,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: { id: true, type: true },
    });

    if (!transaction) {
      throw new Error("Transaction not found or access denied");
    }
    if (transaction.type !== "expense") {
      throw new Error("Only an expense transaction can be marked as a card settlement");
    }

    const statement = await tx.creditCardStatement.findFirst({
      where: {
        id: params.statementId,
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
      select: { id: true, billPaymentTransactionId: true },
    });

    if (!statement) {
      throw new Error("Statement not found or access denied");
    }

    if (
      statement.billPaymentTransactionId &&
      statement.billPaymentTransactionId !== params.transactionId
    ) {
      throw new Error(ALREADY_LINKED);
    }

    const other = await tx.creditCardStatement.findFirst({
      where: {
        billPaymentTransactionId: params.transactionId,
        NOT: { id: params.statementId },
      },
      select: { id: true },
    });
    if (other) {
      throw new Error("Transaction is already linked as a bill payment on another statement");
    }

    if (statement.billPaymentTransactionId === params.transactionId) {
      return {
        success: true,
        transactionId: params.transactionId,
        statementId: params.statementId,
      };
    }

    try {
      await tx.creditCardStatement.update({
        where: { id: params.statementId },
        data: { billPaymentTransactionId: params.transactionId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new Error(ALREADY_LINKED);
      }
      throw error;
    }

    return {
      success: true,
      transactionId: params.transactionId,
      statementId: params.statementId,
    };
  });
}

/**
 * Clear the statement link on a settlement payment. The category is unchanged.
 */
export async function unmarkTransactionAsCardSettlement(
  userId: string,
  params: { transactionId: string },
  db: DbClient
) {
  const client = rootClient(db);
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${params.transactionId}))::text`;

    const transaction = await tx.transaction.findFirst({
      where: {
        id: params.transactionId,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: { id: true },
    });
    if (!transaction) {
      throw new Error("Transaction not found or access denied");
    }

    const statement = await tx.creditCardStatement.findFirst({
      where: {
        billPaymentTransactionId: params.transactionId,
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
      select: { id: true },
    });
    if (!statement) {
      throw new Error("Transaction is not linked as a card settlement");
    }

    await tx.creditCardStatement.update({
      where: { id: statement.id },
      data: { billPaymentTransactionId: null },
    });

    return {
      success: true,
      transactionId: params.transactionId,
      statementId: statement.id,
    };
  });
}

interface GetStatementParams {
  statementId?: string;
  creditCardId?: string;
  month?: string; // YYYY-MM, required if using creditCardId
}

const statementInclude = {
  creditCard: {
    select: {
      id: true,
      bankName: true,
      lastFourDigits: true,
      currency: true,
    },
  },
  billPaymentTransaction: {
    select: {
      id: true,
      amount: true,
      currency: true,
      exchangeRate: true,
      date: true,
      description: true,
    },
  },
  purchases: {
    select: {
      id: true,
      category: true,
      transactionDate: true,
      description: true,
      amount: true,
      currency: true,
      installmentNumber: true,
      totalInstallments: true,
    },
    orderBy: { transactionDate: "asc" as const },
  },
};

/**
 * Get a credit card statement with purchases and reconciliation.
 * Purchase `date` is the original transactionDate. Reconciliation amounts
 * are in the user's base currency.
 */
export async function getCreditCardStatement(
  userId: string,
  params: GetStatementParams,
  db: DbClient
) {
  const owner = {
    OR: [
      { business: { userId } },
      { personalAccount: { userId } },
    ],
  };

  let statement;
  if (params.statementId) {
    statement = await db.creditCardStatement.findFirst({
      where: { id: params.statementId, creditCard: owner },
      include: statementInclude,
    });
  } else if (params.creditCardId && params.month) {
    statement = await db.creditCardStatement.findFirst({
      where: {
        creditCardId: params.creditCardId,
        month: params.month,
        creditCard: owner,
      },
      include: statementInclude,
    });
  } else {
    throw new Error("Must provide either statementId or (creditCardId + month)");
  }

  if (!statement) {
    throw new Error("Statement not found or access denied");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { baseCurrency: true },
  });
  const baseCurrency = user?.baseCurrency ?? "USD";
  const currencyRows = await db.currency.findMany({ where: { userId } });
  const currencies: Currency[] = currencyRows.map((row) => ({
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    manualRate: row.manualRate,
    updatedAt: row.updatedAt,
  }));

  const purchasesTotal = statement.purchases.reduce(
    (sum, purchase) =>
      sum +
      amountInUserBase({
        amount: purchase.amount,
        currency: purchase.currency,
        currencies,
        baseCurrency,
      }),
    0
  );
  const payment = statement.billPaymentTransaction;
  const paymentAmount = payment
    ? amountInUserBase({
        amount: payment.amount,
        currency: payment.currency,
        exchangeRate: payment.exchangeRate,
        currencies,
        baseCurrency,
      })
    : null;
  const difference = paymentAmount !== null ? paymentAmount - purchasesTotal : null;

  return {
    statement: {
      id: statement.id,
      month: statement.month,
      closingDate: statement.closingDate?.toISOString() ?? null,
      dueDate: statement.dueDate?.toISOString() ?? null,
      totalAmount: statement.totalAmount,
      creditCard: statement.creditCard,
    },
    purchases: statement.purchases.map((purchase) => ({
      id: purchase.id,
      category: purchase.category,
      date: purchase.transactionDate.toISOString(),
      description: purchase.description,
      amount: purchase.amount,
      currency: purchase.currency,
      installment:
        purchase.installmentNumber && purchase.totalInstallments
          ? { number: purchase.installmentNumber, total: purchase.totalInstallments }
          : null,
    })),
    billPayment: payment
      ? {
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          date: payment.date.toISOString(),
          description: payment.description,
        }
      : null,
    reconciliation: {
      currency: baseCurrency,
      purchasesTotal: Math.round(purchasesTotal * 100) / 100,
      paymentAmount,
      difference: difference !== null ? Math.round(difference * 100) / 100 : null,
      isReconciled: difference !== null ? Math.abs(difference) < 0.01 : false,
    },
  };
}
