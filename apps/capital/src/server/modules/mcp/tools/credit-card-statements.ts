import type { DbClient } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";

/**
 * Display category stored on a settlement payment.
 * Expense totals ignore this name; the statement link is the rule.
 * PR #64 replaces this return value with the credit-card systemKey helper.
 */
export function settlementDisplayCategory(): string {
  return "Credit Card";
}

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

/**
 * Import a monthly credit card statement with idempotent dedupe logic.
 *
 * Creates or updates a CreditCardStatement, then inserts BillTransactions (purchases).
 * Deduplicates by date+amount+normalized description+installment number within the
 * statement, so re-importing the same month twice creates nothing new.
 *
 * Returns created/skipped counts and IDs.
 */
export async function importCreditCardStatement(
  userId: string,
  params: ImportStatementParams,
  db: DbClient
) {
  // 1. Verify card ownership
  const card = await db.creditCard.findFirst({
    where: {
      id: params.creditCardId,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: {
      id: true,
      currency: true,
      entityType: true,
      businessId: true,
      personalAccountId: true,
    },
  });

  if (!card) {
    throw new Error("Credit card not found or access denied");
  }

  // 2. Resolve category IDs
  const categoryMap = new Map<string, string>();
  
  for (const row of params.rows) {
    if (row.categoryId) {
      // Validate category ownership
      const cat = await db.category.findFirst({
        where: { id: row.categoryId, userId },
        select: { id: true, name: true },
      });
      if (!cat) {
        throw new Error(`Category ${row.categoryId} not found or access denied`);
      }
      categoryMap.set(row.categoryId, cat.name);
    } else if (row.category) {
      // Look up category by name
      const cat = await db.category.findFirst({
        where: { userId, name: row.category, type: "expense" },
        select: { id: true, name: true },
      });
      if (cat) {
        categoryMap.set(row.category, cat.name);
      } else {
        // Category name provided but doesn't exist - use as-is (will be "Uncategorized" or custom)
        categoryMap.set(row.category, row.category);
      }
    }
  }

  // 3. Create or update statement
  const statementData = {
    creditCardId: params.creditCardId,
    month: params.statement.month,
    closingDate: params.statement.closingDate ? parseLocalDate(params.statement.closingDate) : null,
    dueDate: params.statement.dueDate ? parseLocalDate(params.statement.dueDate) : null,
    totalAmount: params.statement.total ?? null,
  };

  const statement = await db.creditCardStatement.upsert({
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

  // 4. Fetch existing purchases for this statement (for dedupe)
  const existingPurchases = await db.billTransaction.findMany({
    where: { statementId: statement.id },
    select: {
      id: true,
      transactionDate: true,
      amount: true,
      description: true,
      installmentNumber: true,
    },
  });

  const existingKeys = new Set(
    existingPurchases.map((p) =>
      createDedupeKey(p.transactionDate, p.amount, p.description, p.installmentNumber ?? undefined)
    )
  );

  // 5. Dedupe within the batch and against existing
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

  const batchKeys = new Set<string>();
  const skippedKeys: string[] = [];

  for (const row of params.rows) {
    const date = parseLocalDate(row.date);
    const key = createDedupeKey(date, row.amount, row.description, row.installment?.number);

    // Check if already exists
    if (existingKeys.has(key)) {
      skippedKeys.push(key);
      continue;
    }

    // Check if duplicate within batch
    if (batchKeys.has(key)) {
      skippedKeys.push(key);
      continue;
    }

    batchKeys.add(key);

    // Determine category
    let category = "Uncategorized";
    if (row.categoryId && categoryMap.has(row.categoryId)) {
      category = categoryMap.get(row.categoryId)!;
    } else if (row.category) {
      category = categoryMap.get(row.category) ?? row.category;
    }

    toCreate.push({
      statementId: statement.id,
      category,
      transactionDate: date,
      description: row.description,
      amount: row.amount,
      currency: row.currency ?? card.currency,
      installmentNumber: row.installment?.number ?? null,
      totalInstallments: row.installment?.total ?? null,
      isAutoCategorized: false,
    });
  }

  // 6. Bulk insert purchases
  const createdIds: string[] = [];
  if (toCreate.length > 0) {
    await db.billTransaction.createMany({
      data: toCreate,
    });

    // Fetch the created IDs (createMany doesn't return them)
    const created = await db.billTransaction.findMany({
      where: {
        statementId: statement.id,
        transactionDate: { in: toCreate.map((t) => t.transactionDate) },
      },
      select: { id: true },
    });
    createdIds.push(...created.map((c) => c.id));
  }

  return {
    statementId: statement.id,
    created: createdIds.length,
    skipped: skippedKeys.length,
    createdIds,
  };
}

interface MarkAsSettlementParams {
  transactionId: string;
  statementId: string;
}

/**
 * Mark an existing transaction as a credit card bill settlement.
 * Links the transaction to the statement's billPaymentTransactionId.
 *
 * This allows converting historical bill payment transactions (June-September)
 * into proper settlements so they're excluded from expense totals.
 */
export async function markTransactionAsCardSettlement(
  userId: string,
  params: MarkAsSettlementParams,
  db: DbClient
) {
  // 1. Verify transaction ownership
  const transaction = await db.transaction.findFirst({
    where: {
      id: params.transactionId,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: {
      id: true,
      type: true,
      category: true,
    },
  });

  if (!transaction) {
    throw new Error("Transaction not found or access denied");
  }

  // 2. Verify statement ownership
  const statement = await db.creditCardStatement.findFirst({
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

  // 3. Check if statement already has a payment
  if (statement.billPaymentTransactionId && statement.billPaymentTransactionId !== params.transactionId) {
    throw new Error("Statement already has a different bill payment transaction linked");
  }

  // 4. Set the display category. Exclusion is the statement link, not this name.
  const displayCategory = settlementDisplayCategory();
  if (transaction.category !== displayCategory) {
    await db.transaction.update({
      where: { id: params.transactionId },
      data: { category: displayCategory },
    });
  }

  // 5. Link transaction to statement
  await db.creditCardStatement.update({
    where: { id: params.statementId },
    data: { billPaymentTransactionId: params.transactionId },
  });

  return {
    success: true,
    transactionId: params.transactionId,
    statementId: params.statementId,
  };
}

interface GetStatementParams {
  statementId?: string;
  creditCardId?: string;
  month?: string; // YYYY-MM, required if using creditCardId
}

/**
 * Get a credit card statement with purchases and reconciliation.
 *
 * Returns:
 * - Statement metadata (month, dates, total)
 * - List of purchases (BillTransactions)
 * - Reconciliation: sum of purchases vs. bill payment amount
 * - Bill payment transaction details (if linked)
 */
export async function getCreditCardStatement(
  userId: string,
  params: GetStatementParams,
  db: DbClient
) {
  let statement;

  if (params.statementId) {
    statement = await db.creditCardStatement.findFirst({
      where: {
        id: params.statementId,
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
      include: {
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
          orderBy: { transactionDate: "asc" },
        },
      },
    });
  } else if (params.creditCardId && params.month) {
    statement = await db.creditCardStatement.findFirst({
      where: {
        creditCardId: params.creditCardId,
        month: params.month,
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
      include: {
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
          orderBy: { transactionDate: "asc" },
        },
      },
    });
  } else {
    throw new Error("Must provide either statementId or (creditCardId + month)");
  }

  if (!statement) {
    throw new Error("Statement not found or access denied");
  }

  // Calculate reconciliation
  const purchasesTotal = statement.purchases.reduce((sum, p) => sum + p.amount, 0);
  const paymentAmount = statement.billPaymentTransaction?.amount ?? null;
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
    purchases: statement.purchases.map((p) => ({
      id: p.id,
      category: p.category,
      date: p.transactionDate.toISOString(),
      description: p.description,
      amount: p.amount,
      currency: p.currency,
      installment:
        p.installmentNumber && p.totalInstallments
          ? { number: p.installmentNumber, total: p.totalInstallments }
          : null,
    })),
    billPayment: statement.billPaymentTransaction
      ? {
          id: statement.billPaymentTransaction.id,
          amount: statement.billPaymentTransaction.amount,
          currency: statement.billPaymentTransaction.currency,
          date: statement.billPaymentTransaction.date.toISOString(),
          description: statement.billPaymentTransaction.description,
        }
      : null,
    reconciliation: {
      purchasesTotal: Math.round(purchasesTotal * 100) / 100,
      paymentAmount,
      difference: difference !== null ? Math.round(difference * 100) / 100 : null,
      isReconciled: difference !== null ? Math.abs(difference) < 0.01 : false,
    },
  };
}
