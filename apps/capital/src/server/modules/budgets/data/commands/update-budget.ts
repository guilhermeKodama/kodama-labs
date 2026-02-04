import type { DbClient } from "@capital/server/lib/prisma";
import type { BudgetPeriod } from "@prisma/client";

interface UpdateBudgetData {
  category?: string;
  amount?: number;
  currency?: string;
  period?: BudgetPeriod;
  year?: number;
  month?: number;
  isActive?: boolean;
}

export async function updateBudget(
  id: string,
  data: UpdateBudgetData,
  db: DbClient
) {
  return db.budget.update({
    where: { id },
    data,
  });
}
