import type { DbClient } from "@capital/server/lib/prisma";
import { fetchBudgetById } from "../data/queries/fetch-budgets";

export interface BudgetProgress {
  budgetId: string;
  category: string;
  budgetAmount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
}

export async function getBudgetProgress(
  budgetId: string,
  db: DbClient
): Promise<BudgetProgress> {
  const budget = await fetchBudgetById(budgetId, db);
  if (!budget) {
    throw new Error("Budget not found");
  }

  // Calculate date range based on budget period
  const startDate = new Date(budget.year, (budget.month ?? 1) - 1, 1);
  const endDate =
    budget.period === "monthly"
      ? new Date(budget.year, budget.month ?? 1, 0)
      : new Date(budget.year, 11, 31);

  // Get transactions for the budget period and category
  const transactions = await db.transaction.findMany({
    where: {
      category: budget.category,
      type: "expense",
      date: {
        gte: startDate,
        lte: endDate,
      },
      ...(budget.businessId && { businessId: budget.businessId }),
      ...(budget.personalAccountId && {
        personalAccountId: budget.personalAccountId,
      }),
    },
  });

  const spent = transactions.reduce((sum, t) => sum + t.amount, 0);
  const remaining = budget.amount - spent;
  const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

  return {
    budgetId: budget.id,
    category: budget.category,
    budgetAmount: budget.amount,
    spent,
    remaining,
    percentUsed: Math.round(percentUsed * 100) / 100,
    isOverBudget: spent > budget.amount,
  };
}
