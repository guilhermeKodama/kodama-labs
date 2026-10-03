import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Get the effective budget for a category at a specific month.
 * Returns the most recent active budget with effectiveFrom <= targetMonth.
 * 
 * This is the SINGLE source of truth for budget resolution used by both
 * UI (get-budget-dashboard.ts) and MCP (get_budget_status).
 */
export async function getEffectiveBudget(
  db: DbClient,
  filters: {
    personalAccountId?: string;
    businessId?: string;
    category: string;
    targetMonth: Date; // First day of target month at noon UTC
    isActive?: boolean;
  }
) {
  const budget = await db.budget.findFirst({
    where: {
      ...(filters.personalAccountId && { personalAccountId: filters.personalAccountId }),
      ...(filters.businessId && { businessId: filters.businessId }),
      category: filters.category,
      effectiveFrom: { lte: filters.targetMonth },
      isActive: filters.isActive ?? true,
    },
    orderBy: { effectiveFrom: "desc" },
  });

  return budget;
}

/**
 * Get all effective budgets for a user for a specific month.
 * Returns one budget per category (the most recent active budget with effectiveFrom <= targetMonth).
 * 
 * This replaces the old query that matched exact year/month, ensuring UI and MCP
 * use the same effective-date resolution logic.
 */
export async function getEffectiveBudgetsForMonth(
  db: DbClient,
  userId: string,
  targetMonth: Date, // First day of target month at noon UTC
  filters?: {
    personalAccountId?: string;
    businessId?: string;
  }
) {
  // First, get all active budgets effective on or before the target month
  const allBudgets = await db.budget.findMany({
    where: {
      AND: [
        {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      ],
      ...(filters?.personalAccountId && { personalAccountId: filters.personalAccountId }),
      ...(filters?.businessId && { businessId: filters.businessId }),
      effectiveFrom: { lte: targetMonth },
      isActive: true,
    },
    orderBy: [
      { personalAccountId: "asc" },
      { businessId: "asc" },
      { category: "asc" },
      { effectiveFrom: "desc" },
    ],
  });

  // Deduplicate: keep only the most recent (first after sorting) for each entity+category
  const seenKeys = new Set<string>();
  const effectiveBudgets = [];
  
  for (const budget of allBudgets) {
    const key = `${budget.personalAccountId ?? ""}:${budget.businessId ?? ""}:${budget.category}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      effectiveBudgets.push(budget);
    }
  }

  return effectiveBudgets;
}

/**
 * Convert an amount in a source currency to a target currency using user's base currency as pivot.
 * 
 * Transaction.exchangeRate converts transaction.amount to user.baseCurrency:
 *   amountInBaseCurrency = tx.amount * tx.exchangeRate
 * 
 * Budget.currency is the budget's currency (often BRL).
 * 
 * To convert actualSpending (already in baseCurrency) to budget.currency:
 *   1. If budget.currency === baseCurrency: return actualSpending as-is
 *   2. Otherwise: would need baseCurrency -> budget.currency rate
 * 
 * For simplicity (and matching current UI behavior), we assume:
 *   - budgets.currency === user.baseCurrency for direct comparison
 *   - OR budgets store amounts already normalized to baseCurrency
 * 
 * The current UI code in get-budget-dashboard.ts does:
 *   spent = sum(tx.amount * tx.exchangeRate)
 *   compare spent directly with budget.amount
 * 
 * This assumes budget.amount is in the same currency as (tx.amount * tx.exchangeRate),
 * which is user.baseCurrency.
 * 
 * @returns amount in user's base currency (for comparison with budget.amount)
 */
export function convertToBaseCurrency(
  amount: number,
  exchangeRate: number
): number {
  return amount * exchangeRate;
}

/**
 * Determine if a transaction should count toward budget actual spending.
 * 
 * Rule: Only type="expense" transactions count (not income or transfers).
 * 
 * This is the SINGLE source for the expense classification rule.
 * When PR #62 (credit card statements) merges with shouldCountAsExpense(),
 * switch this implementation to call that helper.
 */
export function shouldCountAsExpenseForBudget(transactionType: string): boolean {
  return transactionType === "expense";
}
