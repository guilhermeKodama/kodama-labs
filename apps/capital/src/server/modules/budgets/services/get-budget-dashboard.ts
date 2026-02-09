import type { DbClient } from "@capital/server/lib/prisma";
import {
  getUserToday,
  getUserCurrentYear,
  getUserCurrentMonth,
  getMonthRange,
  toDateString,
} from "@capital/server/lib/date-utils";
import { addMonths } from "date-fns";

// ============================================
// Types
// ============================================

interface BudgetDashboardInput {
  year?: number;
  month?: number;
  timezone: string;
}

interface BudgetPaceResult {
  dailySpendRate: number;
  allowedDailyRate: number;
  projectedTotal: number;
  isOverPace: boolean;
  daysElapsed: number;
  daysRemaining: number;
  daysInPeriod: number;
}

interface BudgetProgressResult {
  id: string;
  entityId: string;
  entityType: string;
  category: string;
  amount: number;
  currency: string;
  period: string;
  year: number;
  month: number | null;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverBudget: boolean;
  isActive: boolean;
  pace: BudgetPaceResult;
}

interface InsightResult {
  budgetId: string;
  category: string;
  severity: "critical" | "warning" | "good";
  message: string;
  recommendation: string;
  percentUsed: number;
  remaining: number;
  daysRemaining: number;
  dailySpendRate: number;
  allowedDailyRate: number;
}

interface UnbudgetedResult {
  category: string;
  totalSpent: number;
  transactionCount: number;
  entityId: string;
  entityType: string;
  isFromPreviousMonth: boolean;
}

interface MonthOverMonthResult {
  category: string;
  entityId: string;
  currentSpent: number;
  previousSpent: number;
  changeAmount: number;
  changePercent: number;
}

export interface BudgetDashboardResponse {
  period: { year: number; month: number };
  summary: {
    totalBudget: number;
    totalSpent: number;
    totalRoom: number;
    projectedTotal: number;
  };
  budgets: BudgetProgressResult[];
  insights: InsightResult[];
  unbudgetedSpending: UnbudgetedResult[];
  monthOverMonth: MonthOverMonthResult[];
}

// ============================================
// Main Service
// ============================================

export async function getBudgetDashboard(
  userId: string,
  input: BudgetDashboardInput,
  db: DbClient
): Promise<BudgetDashboardResponse> {
  const { timezone } = input;
  const today = getUserToday(timezone);
  const year = input.year ?? getUserCurrentYear(timezone);
  const month = input.month ?? getUserCurrentMonth(timezone);

  // 1. Fetch budgets for the period
  const budgets = await db.budget.findMany({
    where: {
      AND: [
        {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        {
          OR: [
            { period: "monthly", month },
            { period: "yearly" },
          ],
        },
      ],
      year,
      isActive: true,
    },
  });

  // 2. Fetch regular expense transactions for the period
  const { start: periodStart, end: periodEnd } = getMonthRange(year, month);
  const transactions = await db.transaction.findMany({
    where: {
      type: "expense",
      date: { gte: periodStart, lte: periodEnd },
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
  });

  // 3. Fetch credit card bill transactions for the period
  const billTransactions = await db.billTransaction.findMany({
    where: {
      transactionDate: { gte: periodStart, lte: periodEnd },
      bill: {
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
    },
    include: {
      bill: {
        include: {
          creditCard: {
            select: {
              entityType: true,
              businessId: true,
              personalAccountId: true,
              currency: true,
            },
          },
        },
      },
    },
  });

  // 4. Fetch installment projections for the period
  const installments = await db.installment.findMany({
    where: {
      isActive: true,
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
          entityType: true,
          businessId: true,
          personalAccountId: true,
          currency: true,
        },
      },
      billTransaction: {
        select: {
          category: true,
          billId: true,
        },
      },
    },
  });

  // Also fetch bills for installment anchoring
  const bills = await db.creditCardBill.findMany({
    where: {
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    select: {
      id: true,
      closingDate: true,
    },
  });

  // 5. Build unified expense list for the period
  type ExpenseItem = { entityId: string; category: string; amount: number };
  const expenses: ExpenseItem[] = [];

  // Regular transactions
  for (const tx of transactions) {
    const entityId = tx.businessId ?? tx.personalAccountId ?? "";
    expenses.push({
      entityId,
      category: tx.category,
      amount: tx.amount * tx.exchangeRate,
    });
  }

  // Bill transactions (credit card line items)
  for (const bt of billTransactions) {
    const card = bt.bill.creditCard;
    const entityId = card.businessId ?? card.personalAccountId ?? "";
    expenses.push({
      entityId,
      category: bt.category,
      amount: bt.amount, // Already in card currency
    });
  }

  // Installment projections for this month
  const billMap = new Map(bills.map((b) => [b.id, b]));
  for (const inst of installments) {
    const remaining = inst.totalInstallments - inst.paidInstallments;
    if (remaining <= 0) continue;

    const card = inst.creditCard;
    const entityId = card.businessId ?? card.personalAccountId ?? "";
    const category = inst.billTransaction?.category || "Credit Card";

    // Use bill closing date as anchor
    const sourceBill = inst.billTransaction?.billId
      ? billMap.get(inst.billTransaction.billId)
      : undefined;
    const anchorDate = sourceBill ? sourceBill.closingDate : inst.startDate;

    for (let i = 0; i < remaining; i++) {
      const projectedDate = addMonths(anchorDate, sourceBill ? 1 + i : inst.paidInstallments + i);
      const projMonth = projectedDate.getMonth() + 1;
      const projYear = projectedDate.getFullYear();

      // Only include if in the requested period
      if (projYear === year && projMonth === month) {
        // Skip if this month is covered by a bill
        const coveredByBill = bills.some((b) => {
          const closingMonth = b.closingDate.getMonth() + 1;
          const closingYear = b.closingDate.getFullYear();
          return closingMonth === month && closingYear === year;
        });
        if (!coveredByBill) {
          expenses.push({
            entityId,
            category,
            amount: inst.installmentAmount,
          });
        }
      }
    }
  }

  // 6. Calculate budget progress
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const daysElapsed = isCurrentMonth
    ? Math.min(today.getDate(), daysInMonth)
    : (new Date() < periodStart ? 0 : daysInMonth);
  const daysRemaining = daysInMonth - daysElapsed;

  const budgetResults: BudgetProgressResult[] = budgets.map((budget) => {
    const entityId = budget.businessId ?? budget.personalAccountId ?? "";
    const spent = expenses
      .filter((e) => e.entityId === entityId && e.category === budget.category)
      .reduce((sum, e) => sum + e.amount, 0);

    const remaining = budget.amount - spent;
    const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
    const isOverBudget = spent > budget.amount;

    const dailySpendRate = daysElapsed > 0 ? spent / daysElapsed : 0;
    const allowedDailyRate = daysInMonth > 0 ? budget.amount / daysInMonth : 0;
    const projectedTotal = daysElapsed > 0
      ? spent + dailySpendRate * daysRemaining
      : 0;
    const isOverPace = dailySpendRate > allowedDailyRate;

    return {
      id: budget.id,
      entityId,
      entityType: budget.entityType,
      category: budget.category,
      amount: budget.amount,
      currency: budget.currency,
      period: budget.period,
      year: budget.year,
      month: budget.month,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percentUsed: Math.round(percentUsed * 100) / 100,
      isOverBudget,
      isActive: budget.isActive,
      pace: {
        dailySpendRate: Math.round(dailySpendRate * 100) / 100,
        allowedDailyRate: Math.round(allowedDailyRate * 100) / 100,
        projectedTotal: Math.round(projectedTotal * 100) / 100,
        isOverPace,
        daysElapsed,
        daysRemaining,
        daysInPeriod: daysInMonth,
      },
    };
  });

  // 7. Generate insights
  const insights: InsightResult[] = budgetResults
    .map((b) => {
      let severity: InsightResult["severity"];
      let message: string;
      let recommendation: string;

      if (b.isOverBudget) {
        severity = "critical";
        message = `${b.category}: Over budget by ${Math.abs(b.remaining).toFixed(0)}`;
        recommendation = "Stop non-essential spending in this category.";
      } else if (b.percentUsed >= 80) {
        severity = "warning";
        message = `${b.category}: ${b.percentUsed.toFixed(0)}% used with ${b.pace.daysRemaining} days remaining`;
        recommendation = b.pace.isOverPace
          ? `Spending ${b.pace.dailySpendRate.toFixed(0)}/day vs ${b.pace.allowedDailyRate.toFixed(0)}/day budget pace.`
          : `On pace but close to limit. ${b.remaining.toFixed(0)} remaining.`;
      } else {
        severity = "good";
        message = `${b.category}: ${b.percentUsed.toFixed(0)}% used`;
        recommendation = `${b.remaining.toFixed(0)} room available.`;
      }

      return {
        budgetId: b.id,
        category: b.category,
        severity,
        message,
        recommendation,
        percentUsed: b.percentUsed,
        remaining: b.remaining,
        daysRemaining: b.pace.daysRemaining,
        dailySpendRate: b.pace.dailySpendRate,
        allowedDailyRate: b.pace.allowedDailyRate,
      };
    })
    .sort((a, b) => {
      const order = { critical: 0, warning: 1, good: 2 };
      return order[a.severity] - order[b.severity];
    });

  // 8. Unbudgeted spending (current + previous month)
  const budgetedKeys = new Set(
    budgets.map((b) => `${b.businessId ?? b.personalAccountId ?? ""}::${b.category}`)
  );

  // Current month expenses not in any budget
  const unbudgetedCurrent: Record<string, { total: number; count: number; entityId: string; entityType: string }> = {};
  for (const e of expenses) {
    const key = `${e.entityId}::${e.category}`;
    if (budgetedKeys.has(key)) continue;
    if (!unbudgetedCurrent[key]) {
      unbudgetedCurrent[key] = { total: 0, count: 0, entityId: e.entityId, entityType: "personal" };
    }
    unbudgetedCurrent[key].total += e.amount;
    unbudgetedCurrent[key].count += 1;
  }

  // Previous month for CC categories
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const { start: prevStart, end: prevEnd } = getMonthRange(prevYear, prevMonth);
  const prevTransactions = await db.transaction.findMany({
    where: {
      type: "expense",
      date: { gte: prevStart, lte: prevEnd },
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
  });

  const prevBillTx = await db.billTransaction.findMany({
    where: {
      transactionDate: { gte: prevStart, lte: prevEnd },
      bill: {
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
    },
    include: {
      bill: {
        include: {
          creditCard: { select: { businessId: true, personalAccountId: true } },
        },
      },
    },
  });

  const unbudgetedPrev: Record<string, { total: number; count: number; entityId: string; entityType: string }> = {};
  for (const tx of prevTransactions) {
    const entityId = tx.businessId ?? tx.personalAccountId ?? "";
    const key = `${entityId}::${tx.category}`;
    if (budgetedKeys.has(key) || unbudgetedCurrent[key]) continue;
    if (!unbudgetedPrev[key]) unbudgetedPrev[key] = { total: 0, count: 0, entityId, entityType: tx.entityType };
    unbudgetedPrev[key].total += tx.amount * tx.exchangeRate;
    unbudgetedPrev[key].count += 1;
  }
  for (const bt of prevBillTx) {
    const entityId = bt.bill.creditCard.businessId ?? bt.bill.creditCard.personalAccountId ?? "";
    const key = `${entityId}::${bt.category}`;
    if (budgetedKeys.has(key) || unbudgetedCurrent[key]) continue;
    if (!unbudgetedPrev[key]) unbudgetedPrev[key] = { total: 0, count: 0, entityId, entityType: "personal" };
    unbudgetedPrev[key].total += bt.amount;
    unbudgetedPrev[key].count += 1;
  }

  const unbudgetedSpending: UnbudgetedResult[] = [
    ...Object.entries(unbudgetedCurrent).map(([key, val]) => ({
      category: key.split("::")[1],
      totalSpent: Math.round(val.total * 100) / 100,
      transactionCount: val.count,
      entityId: val.entityId,
      entityType: val.entityType,
      isFromPreviousMonth: false,
    })),
    ...Object.entries(unbudgetedPrev).map(([key, val]) => ({
      category: key.split("::")[1],
      totalSpent: Math.round(val.total * 100) / 100,
      transactionCount: val.count,
      entityId: val.entityId,
      entityType: val.entityType,
      isFromPreviousMonth: true,
    })),
  ].sort((a, b) => b.totalSpent - a.totalSpent);

  // 9. Month-over-month
  const prevExpenses: ExpenseItem[] = [];
  for (const tx of prevTransactions) {
    prevExpenses.push({
      entityId: tx.businessId ?? tx.personalAccountId ?? "",
      category: tx.category,
      amount: tx.amount * tx.exchangeRate,
    });
  }
  for (const bt of prevBillTx) {
    prevExpenses.push({
      entityId: bt.bill.creditCard.businessId ?? bt.bill.creditCard.personalAccountId ?? "",
      category: bt.category,
      amount: bt.amount,
    });
  }

  const momCategories = [...new Set(budgets.map((b) => `${b.businessId ?? b.personalAccountId ?? ""}::${b.category}`))];
  const monthOverMonth: MonthOverMonthResult[] = momCategories.map((key) => {
    const [entityId, category] = key.split("::");
    const currentSpent = expenses
      .filter((e) => e.entityId === entityId && e.category === category)
      .reduce((sum, e) => sum + e.amount, 0);
    const previousSpent = prevExpenses
      .filter((e) => e.entityId === entityId && e.category === category)
      .reduce((sum, e) => sum + e.amount, 0);
    const changeAmount = currentSpent - previousSpent;
    const changePercent = previousSpent > 0 ? (changeAmount / previousSpent) * 100 : currentSpent > 0 ? 100 : 0;

    return {
      category,
      entityId,
      currentSpent: Math.round(currentSpent * 100) / 100,
      previousSpent: Math.round(previousSpent * 100) / 100,
      changeAmount: Math.round(changeAmount * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
    };
  });

  // 10. Summary
  const totalBudget = budgetResults.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = budgetResults.reduce((sum, b) => sum + b.spent, 0);
  const totalRoom = totalBudget - totalSpent;
  const totalProjected = budgetResults.reduce((sum, b) => sum + b.pace.projectedTotal, 0);

  return {
    period: { year, month },
    summary: {
      totalBudget: Math.round(totalBudget * 100) / 100,
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalRoom: Math.round(totalRoom * 100) / 100,
      projectedTotal: Math.round(totalProjected * 100) / 100,
    },
    budgets: budgetResults,
    insights,
    unbudgetedSpending,
    monthOverMonth,
  };
}
