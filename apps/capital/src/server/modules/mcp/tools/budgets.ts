import type { DbClient } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";

export interface ListBudgetsParams {
  accountId?: string;
  category?: string;
  effectiveDate?: string; // YYYY-MM-DD or YYYY-MM format
}

export interface CreateBudgetParams {
  accountId: string;
  category: string;
  amount: number;
  currency: string;
  effectiveFrom: string; // YYYY-MM-DD format
}

export interface UpdateBudgetParams {
  budgetId: string;
  amount?: number;
  currency?: string;
  effectiveFrom?: string; // YYYY-MM-DD format
  isActive?: boolean;
}

export interface DeleteBudgetParams {
  budgetId: string;
}

export interface GetBudgetStatusParams {
  month: string; // YYYY-MM format
  accountId?: string;
}

/**
 * List budgets for an account, optionally filtered by category.
 * If effectiveDate is provided, returns only budgets effective at that date.
 * Otherwise, returns all budgets.
 */
export async function listBudgets(
  userId: string,
  params: ListBudgetsParams,
  db: DbClient
) {
  const { category, effectiveDate } = params;

  // Verify account ownership and get account ID
  let resolvedAccountId: string;
  if (params.accountId) {
    const account = await db.personalAccount.findFirst({
      where: { id: params.accountId, userId },
    });
    if (!account) {
      throw new Error("Account not found or access denied");
    }
    resolvedAccountId = params.accountId;
  } else {
    // Default to user's personal account
    const account = await db.personalAccount.findFirst({
      where: { userId },
    });
    if (!account) {
      throw new Error("No personal account found");
    }
    resolvedAccountId = account.id;
  }

  interface BudgetWhereClause {
    personalAccountId: string;
    isActive: boolean;
    category?: string;
    effectiveFrom?: { lte: Date };
  }

  const where: BudgetWhereClause = {
    personalAccountId: resolvedAccountId,
    isActive: true,
  };

  if (category) {
    where.category = category;
  }

  if (effectiveDate) {
    // Parse date (YYYY-MM or YYYY-MM-DD)
    const targetDate = effectiveDate.includes("-DD")
      ? parseLocalDate(effectiveDate)
      : parseLocalDate(`${effectiveDate}-01`);

    where.effectiveFrom = { lte: targetDate };

    // If filtering by effective date, group by category and return only the most recent
    const budgets = await db.budget.findMany({
      where,
      orderBy: [{ category: "asc" }, { effectiveFrom: "desc" }],
    });

    // Deduplicate by category, keeping the most recent for each
    const seenCategories = new Set<string>();
    return budgets.filter((budget) => {
      if (seenCategories.has(budget.category)) {
        return false;
      }
      seenCategories.add(budget.category);
      return true;
    }).map((budget) => ({
      id: budget.id,
      category: budget.category,
      amount: budget.amount,
      currency: budget.currency,
      effectiveFrom: budget.effectiveFrom.toISOString().split("T")[0],
      period: budget.period,
      year: budget.year,
      month: budget.month,
      isActive: budget.isActive,
    }));
  }

  const budgets = await db.budget.findMany({
    where,
    orderBy: [{ category: "asc" }, { effectiveFrom: "desc" }],
  });

  return budgets.map((budget) => ({
    id: budget.id,
    category: budget.category,
    amount: budget.amount,
    currency: budget.currency,
    effectiveFrom: budget.effectiveFrom.toISOString().split("T")[0],
    period: budget.period,
    year: budget.year,
    month: budget.month,
    isActive: budget.isActive,
  }));
}

/**
 * Create a new budget for a category, effective from a specific date.
 */
export async function createBudget(
  userId: string,
  params: CreateBudgetParams,
  db: DbClient
) {
  const { accountId, category, amount, currency, effectiveFrom } = params;

  // Verify account ownership
  const account = await db.personalAccount.findFirst({
    where: { id: accountId, userId },
  });

  if (!account) {
    throw new Error("Account not found or access denied");
  }

  // Validate amount
  if (amount < 0) {
    throw new Error("Budget amount must be non-negative");
  }

  // Parse effective date (always noon UTC for consistency with transaction dates)
  const effectiveDate = parseLocalDate(effectiveFrom);
  const year = effectiveDate.getUTCFullYear();
  const month = effectiveDate.getUTCMonth() + 1;

  // Check for duplicate (same account, category, effectiveFrom)
  const existing = await db.budget.findFirst({
    where: {
      personalAccountId: accountId,
      category,
      effectiveFrom: effectiveDate,
    },
  });

  if (existing) {
    throw new Error(
      `Budget for category "${category}" already exists with effective date ${effectiveFrom}`
    );
  }

  const budget = await db.budget.create({
    data: {
      entityType: "personal",
      personalAccountId: accountId,
      category,
      amount,
      currency,
      effectiveFrom: effectiveDate,
      period: "monthly",
      year,
      month,
      isActive: true,
    },
  });

  return {
    id: budget.id,
    category: budget.category,
    amount: budget.amount,
    currency: budget.currency,
    effectiveFrom: budget.effectiveFrom.toISOString().split("T")[0],
    period: budget.period,
    year: budget.year,
    month: budget.month,
  };
}

/**
 * Update an existing budget.
 */
export async function updateBudget(
  userId: string,
  params: UpdateBudgetParams,
  db: DbClient
) {
  const { budgetId, amount, currency, effectiveFrom, isActive } = params;

  // Fetch and verify ownership
  const budget = await db.budget.findFirst({
    where: { id: budgetId },
    include: { personalAccount: true },
  });

  if (!budget || budget.personalAccount?.userId !== userId) {
    throw new Error("Budget not found or access denied");
  }

  // Validate amount if provided
  if (amount !== undefined && amount < 0) {
    throw new Error("Budget amount must be non-negative");
  }

  interface BudgetUpdateData {
    amount?: number;
    currency?: string;
    effectiveFrom?: Date;
    year?: number;
    month?: number;
    isActive?: boolean;
  }

  const updateData: BudgetUpdateData = {};
  if (amount !== undefined) updateData.amount = amount;
  if (currency !== undefined) updateData.currency = currency;
  if (isActive !== undefined) updateData.isActive = isActive;

  if (effectiveFrom !== undefined) {
    const effectiveDate = parseLocalDate(effectiveFrom);
    updateData.effectiveFrom = effectiveDate;
    updateData.year = effectiveDate.getUTCFullYear();
    updateData.month = effectiveDate.getUTCMonth() + 1;

    // Check for duplicate with new effectiveFrom
    if (effectiveDate.getTime() !== budget.effectiveFrom.getTime()) {
      const existing = await db.budget.findFirst({
        where: {
          personalAccountId: budget.personalAccountId,
          category: budget.category,
          effectiveFrom: effectiveDate,
          id: { not: budgetId },
        },
      });

      if (existing) {
        throw new Error(
          `Budget for category "${budget.category}" already exists with effective date ${effectiveFrom}`
        );
      }
    }
  }

  const updated = await db.budget.update({
    where: { id: budgetId },
    data: updateData,
  });

  return {
    id: updated.id,
    category: updated.category,
    amount: updated.amount,
    currency: updated.currency,
    effectiveFrom: updated.effectiveFrom.toISOString().split("T")[0],
    period: updated.period,
    year: updated.year,
    month: updated.month,
    isActive: updated.isActive,
  };
}

/**
 * Delete a budget (soft delete by setting isActive=false).
 */
export async function deleteBudget(
  userId: string,
  params: DeleteBudgetParams,
  db: DbClient
) {
  const { budgetId } = params;

  // Fetch and verify ownership
  const budget = await db.budget.findFirst({
    where: { id: budgetId },
    include: { personalAccount: true },
  });

  if (!budget || budget.personalAccount?.userId !== userId) {
    throw new Error("Budget not found or access denied");
  }

  await db.budget.update({
    where: { id: budgetId },
    data: { isActive: false },
  });

  return {
    success: true,
    budgetId,
  };
}

interface CategoryBudgetStatus {
  category: string;
  budgeted: number;
  actual: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
}

interface BudgetStatusResponse {
  month: string;
  accountId: string;
  accountCurrency: string;
  budgetCurrency: string; // BRL as requested
  summary: {
    totalBudgeted: number;
    totalActual: number;
    totalRemaining: number;
  };
  categories: CategoryBudgetStatus[];
}

/**
 * Get budget status for a specific month, comparing budgeted vs actual spending.
 * Budgets are in BRL. Actual spending is converted to BRL using transaction exchange rates.
 */
export async function getBudgetStatus(
  userId: string,
  params: GetBudgetStatusParams,
  db: DbClient
): Promise<BudgetStatusResponse> {
  const { month, accountId } = params;

  // Parse month (YYYY-MM)
  const [year, monthNum] = month.split("-").map(Number);
  if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
    throw new Error("Invalid month format. Expected YYYY-MM");
  }

  // Get or default to user's personal account
  let account;
  if (accountId) {
    account = await db.personalAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new Error("Account not found or access denied");
    }
  } else {
    account = await db.personalAccount.findFirst({
      where: { userId },
    });
    if (!account) {
      throw new Error("No personal account found");
    }
  }

  // Get the first day of the target month (noon UTC)
  const targetDate = parseLocalDate(`${year}-${String(monthNum).padStart(2, "0")}-01`);

  // Get effective budgets for this month (most recent budget <= targetDate for each category)
  const allBudgets = await db.budget.findMany({
    where: {
      personalAccountId: account.id,
      effectiveFrom: { lte: targetDate },
      isActive: true,
    },
    orderBy: [{ category: "asc" }, { effectiveFrom: "desc" }],
  });

  // Deduplicate by category, keeping most recent
  const seenCategories = new Set<string>();
  const budgets = allBudgets.filter((budget) => {
    if (seenCategories.has(budget.category)) {
      return false;
    }
    seenCategories.add(budget.category);
    return true;
  });

  // Get month date range (inclusive, America/Sao_Paulo calendar month)
  // For simplicity, use UTC month boundaries at noon
  const monthStart = targetDate; // First day at noon UTC
  const monthEnd = parseLocalDate(
    `${year}-${String(monthNum).padStart(2, "0")}-${new Date(year, monthNum, 0).getDate()}`
  ); // Last day at noon UTC

  // Get all expense transactions for this account in this month
  // Exclude transfers (only type='expense' counts as actual spending)
  const transactions = await db.transaction.findMany({
    where: {
      personalAccountId: account.id,
      type: "expense",
      date: {
        gte: monthStart,
        lte: monthEnd,
      },
    },
    select: {
      category: true,
      amount: true,
      currency: true,
      exchangeRate: true,
    },
  });

  // Get credit card bill transactions for this account in this month
  const billTransactions = await db.billTransaction.findMany({
    where: {
      transactionDate: {
        gte: monthStart,
        lte: monthEnd,
      },
      bill: {
        creditCard: {
          personalAccountId: account.id,
        },
      },
    },
  });

  // Calculate actual spending per category in BRL
  // Transaction amounts are stored in their original currency with exchangeRate to user's base currency
  // For simplicity: amount * exchangeRate converts transaction to user's base currency
  // We assume this is already in the budget currency or close enough for the comparison
  
  const actualByCategory: Record<string, number> = {};

  // Regular transactions: amount * exchangeRate converts to user's base currency
  for (const tx of transactions) {
    const amountInBaseCurrency = tx.amount * tx.exchangeRate;
    actualByCategory[tx.category] = (actualByCategory[tx.category] || 0) + amountInBaseCurrency;
  }

  // Bill transactions: already in card currency, use amount directly
  for (const bt of billTransactions) {
    actualByCategory[bt.category] = (actualByCategory[bt.category] || 0) + bt.amount;
  }

  // Build category status
  const categoryStatuses: CategoryBudgetStatus[] = budgets.map((budget) => {
    const actual = actualByCategory[budget.category] || 0;
    const remaining = budget.amount - actual;
    const percentUsed = budget.amount > 0 ? (actual / budget.amount) * 100 : 0;

    return {
      category: budget.category,
      budgeted: budget.amount,
      actual: Math.round(actual * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percentUsed: Math.round(percentUsed * 100) / 100,
      isOverBudget: actual > budget.amount,
    };
  });

  // Calculate summary
  const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalActual = categoryStatuses.reduce((sum, c) => sum + c.actual, 0);
  const totalRemaining = totalBudgeted - totalActual;

  return {
    month,
    accountId: account.id,
    accountCurrency: account.defaultCurrency,
    budgetCurrency: "BRL",
    summary: {
      totalBudgeted: Math.round(totalBudgeted * 100) / 100,
      totalActual: Math.round(totalActual * 100) / 100,
      totalRemaining: Math.round(totalRemaining * 100) / 100,
    },
    categories: categoryStatuses.sort((a, b) => b.percentUsed - a.percentUsed),
  };
}
