import type { DbClient } from "@capital/server/lib/prisma";
import { shouldCountAsExpense } from "@/lib/utils/expense-classification";

/**
 * Shared budget helpers for effective-date resolution and currency conversion.
 * 
 * SINGLE SOURCE OF TRUTH for:
 * - Effective-date budget resolution (used by MCP, ready for UI integration)
 * - Currency conversion logic (transaction → user base currency)
 * - Expense classification for budget tracking
 * 
 * UI Integration TODO (optional, not required for PR #63):
 * - Update get-budget-dashboard.ts to use getEffectiveBudgetsForMonth()
 * - Update list-budgets.ts to use getEffectiveBudgetsForMonth()
 * - Update get-budget-progress.ts to use getEffectiveBudgetsForMonth()
 * This will enable UI to show effective-dated budgets created by MCP.
 */

/**
 * Normalize any date to the first day of its month at noon UTC.
 * This is the project convention for effective dates to ensure consistency
 * across UI and MCP write paths, and to prevent duplicate budgets due to
 * timestamp variations within the same month.
 * 
 * Examples:
 * - 2026-10-15T08:30:00Z → 2026-10-01T12:00:00Z
 * - 2026-10-01T00:00:00Z → 2026-10-01T12:00:00Z
 * - 2026-10-31T23:59:59Z → 2026-10-01T12:00:00Z
 */
export function normalizeToMonthStart(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return new Date(Date.UTC(year, month, 1, 12, 0, 0, 0));
}

/**
 * Get the effective budget for a category at a specific month.
 * Returns the most recent active budget with effectiveFrom <= targetMonth.
 * 
 * Resolution compares by month (year-month), not exact timestamp, so legacy
 * values (00:00 UTC) and current values (12:00 UTC) both resolve correctly.
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
    targetMonth: Date; // First day of target month (any time)
    isActive?: boolean;
  }
) {
  // Normalize target to first day at noon UTC for consistent comparison
  const normalizedTarget = normalizeToMonthStart(filters.targetMonth);
  
  // Get all budgets effective on or before the target month
  const budgets = await db.budget.findMany({
    where: {
      ...(filters.personalAccountId && { personalAccountId: filters.personalAccountId }),
      ...(filters.businessId && { businessId: filters.businessId }),
      category: filters.category,
      effectiveFrom: { lte: normalizedTarget },
      isActive: filters.isActive ?? true,
    },
    orderBy: { effectiveFrom: "desc" },
  });

  // Find the most recent by comparing year-month (ignoring time)
  // This handles legacy budgets with 00:00 UTC and new ones with 12:00 UTC
  let mostRecent = null;
  let mostRecentYearMonth = 0;
  
  for (const budget of budgets) {
    const budgetYearMonth = budget.effectiveFrom.getUTCFullYear() * 100 + 
                            budget.effectiveFrom.getUTCMonth();
    if (!mostRecent || budgetYearMonth > mostRecentYearMonth) {
      mostRecent = budget;
      mostRecentYearMonth = budgetYearMonth;
    }
  }

  return mostRecent;
}

/**
 * Get all effective budgets for a user for a specific month.
 * Returns one budget per category (the most recent active budget with effectiveFrom <= targetMonth).
 * 
 * Resolution compares by month (year-month), not exact timestamp, so legacy
 * values (00:00 UTC) and current values (12:00 UTC) both resolve correctly.
 * 
 * This replaces the old query that matched exact year/month, ensuring UI and MCP
 * use the same effective-date resolution logic.
 */
export async function getEffectiveBudgetsForMonth(
  db: DbClient,
  userId: string,
  targetMonth: Date, // First day of target month (any time)
  filters?: {
    personalAccountId?: string;
    businessId?: string;
  }
) {
  // Normalize target to first day at noon UTC for consistent comparison
  const normalizedTarget = normalizeToMonthStart(targetMonth);

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
      effectiveFrom: { lte: normalizedTarget },
      isActive: true,
    },
    orderBy: [
      { personalAccountId: "asc" },
      { businessId: "asc" },
      { category: "asc" },
      { effectiveFrom: "desc" },
    ],
  });

  // Deduplicate: keep only the most recent (by year-month) for each entity+category
  // This handles legacy budgets with 00:00 UTC and new ones with 12:00 UTC
  const seenKeys = new Map<string, { budget: typeof allBudgets[0], yearMonth: number }>();
  
  for (const budget of allBudgets) {
    const key = `${budget.personalAccountId ?? ""}:${budget.businessId ?? ""}:${budget.category}`;
    const yearMonth = budget.effectiveFrom.getUTCFullYear() * 100 + 
                     budget.effectiveFrom.getUTCMonth();
    
    const existing = seenKeys.get(key);
    if (!existing || yearMonth > existing.yearMonth) {
      seenKeys.set(key, { budget, yearMonth });
    }
  }

  return Array.from(seenKeys.values()).map(({ budget }) => budget);
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
 * Whether a transaction counts toward budget actual spending.
 * Delegates to shouldCountAsExpense: expenses count, linked card settlements do not.
 */
export function shouldCountAsExpenseForBudget(
  transaction: { type: string; id: string },
  settlementIds: Set<string>
): boolean {
  return shouldCountAsExpense(transaction, settlementIds.has(transaction.id));
}
