import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isWithinInterval,
  differenceInDays,
  addMonths,
} from 'date-fns';
import { parseLocalDate } from '@/lib/utils/date';
import type {
  Budget,
  BudgetProgress,
  BudgetPace,
  UnbudgetedCategory,
  MonthOverMonth,
  BudgetInsight,
  YearlyMonthBreakdown,
  YearlyBudgetProgress,
  YearlySummaryStats,
  Transaction,
  BudgetPeriod,
  BillTransaction,
  CreditCardBill,
  CreditCard,
  Installment,
} from '@/types';

/**
 * Get the date range for a budget period
 */
export function getBudgetDateRange(budget: Budget): { start: Date; end: Date } {
  if (budget.period === 'monthly' && budget.month) {
    const date = new Date(budget.year, budget.month - 1, 1);
    return {
      start: startOfMonth(date),
      end: endOfMonth(date),
    };
  } else {
    const date = new Date(budget.year, 0, 1);
    return {
      start: startOfYear(date),
      end: endOfYear(date),
    };
  }
}

/**
 * Calculate how much has been spent against a budget
 */
export function calculateBudgetSpent(
  budget: Budget,
  transactions: Transaction[]
): number {
  const { start, end } = getBudgetDateRange(budget);

  return transactions
    .filter((t) => {
      // Match entity
      if (t.entityId !== budget.entityId) return false;
      // Match category
      if (t.category !== budget.category) return false;
      // Match type (budgets are for expenses)
      if (t.type !== 'expense') return false;
      // Match date range
      const transactionDate = t.date instanceof Date ? t.date : parseLocalDate(t.date);
      return isWithinInterval(transactionDate, { start, end });
    })
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}

/**
 * Calculate budget progress including spent, remaining, and percentage
 */
export function calculateBudgetProgress(
  budget: Budget,
  transactions: Transaction[]
): BudgetProgress {
  const spent = calculateBudgetSpent(budget, transactions);
  const remaining = budget.amount - spent;
  const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
  const isOverBudget = spent > budget.amount;

  return {
    budget,
    spent,
    remaining,
    percentUsed,
    isOverBudget,
  };
}

/**
 * Calculate progress for all budgets
 */
export function calculateAllBudgetProgress(
  budgets: Budget[],
  transactions: Transaction[]
): BudgetProgress[] {
  return budgets.map((budget) => calculateBudgetProgress(budget, transactions));
}

/**
 * Get budgets that are over or near limit (uses per-budget threshold or fallback)
 */
export function getBudgetAlerts(
  budgets: Budget[],
  transactions: Transaction[],
  defaultThreshold: number = 80
): BudgetProgress[] {
  return calculateAllBudgetProgress(budgets, transactions).filter(
    (progress) => {
      const threshold = progress.budget.alertThreshold ?? defaultThreshold;
      return progress.percentUsed >= threshold && progress.budget.isActive;
    }
  );
}

/**
 * Get current month's budgets
 */
export function getCurrentMonthBudgets(budgets: Budget[]): Budget[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return budgets.filter((b) => {
    if (!b.isActive) return false;
    if (b.year !== currentYear) return false;
    if (b.period === 'monthly') {
      return b.month === currentMonth;
    }
    return true; // Yearly budgets apply to current year
  });
}

/**
 * Get total budget amount for a period
 */
export function getTotalBudgetAmount(budgets: Budget[]): number {
  return budgets.reduce((sum, b) => sum + b.amount, 0);
}

/**
 * Get total spent across all budgets
 */
export function getTotalBudgetSpent(
  budgets: Budget[],
  transactions: Transaction[]
): number {
  return budgets.reduce((sum, b) => {
    const spent = calculateBudgetSpent(b, transactions);
    return sum + spent;
  }, 0);
}

/**
 * Get budget status color based on percentage used
 */
export function getBudgetStatusColor(percentUsed: number): string {
  if (percentUsed >= 100) return 'text-red-400';
  if (percentUsed >= 80) return 'text-amber-400';
  if (percentUsed >= 50) return 'text-yellow-400';
  return 'text-emerald-400';
}

/**
 * Get budget status background color based on percentage used
 */
export function getBudgetStatusBgColor(percentUsed: number): string {
  if (percentUsed >= 100) return 'bg-red-500';
  if (percentUsed >= 80) return 'bg-amber-500';
  if (percentUsed >= 50) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

/**
 * Get budget period label
 */
export function getBudgetPeriodLabel(period: BudgetPeriod): string {
  return period === 'monthly' ? 'Monthly' : 'Yearly';
}

/**
 * Group budgets by entity
 */
export function groupBudgetsByEntity(
  budgets: Budget[]
): Record<string, Budget[]> {
  return budgets.reduce((groups, budget) => {
    const key = budget.entityId;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(budget);
    return groups;
  }, {} as Record<string, Budget[]>);
}

/**
 * Group budgets by category
 */
export function groupBudgetsByCategory(
  budgets: Budget[]
): Record<string, Budget[]> {
  return budgets.reduce((groups, budget) => {
    const key = budget.category;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(budget);
    return groups;
  }, {} as Record<string, Budget[]>);
}

// ============================================
// Pace & Projection
// ============================================

/**
 * Calculate spending pace for a budget
 */
export function calculateBudgetPace(
  budget: Budget,
  transactions: Transaction[]
): BudgetPace {
  const { start, end } = getBudgetDateRange(budget);
  const now = new Date();
  const periodStart = start;
  const periodEnd = end;

  const daysInPeriod = differenceInDays(periodEnd, periodStart) + 1;
  const daysElapsed = Math.max(0, Math.min(differenceInDays(now, periodStart) + 1, daysInPeriod));
  const daysRemaining = Math.max(0, daysInPeriod - daysElapsed);

  const spent = calculateBudgetSpent(budget, transactions);
  const dailySpendRate = daysElapsed > 0 ? spent / daysElapsed : 0;
  const allowedDailyRate = daysInPeriod > 0 ? budget.amount / daysInPeriod : 0;
  const projectedTotal = daysElapsed > 0
    ? spent + dailySpendRate * daysRemaining
    : 0;
  const isOverPace = dailySpendRate > allowedDailyRate;

  return {
    dailySpendRate,
    allowedDailyRate,
    projectedTotal,
    isOverPace,
    daysElapsed,
    daysRemaining,
    daysInPeriod,
  };
}

// ============================================
// Unbudgeted Spending
// ============================================

/**
 * Find expense categories that have spending but no matching active budget.
 * Looks at both current month AND previous month so that credit card categories
 * from recent bills are surfaced even before the current month's bill is uploaded.
 */
export function getUnbudgetedSpending(
  budgets: Budget[],
  transactions: Transaction[],
  year: number,
  month: number
): UnbudgetedCategory[] {
  const currentStart = startOfMonth(new Date(year, month - 1, 1));
  const currentEnd = endOfMonth(new Date(year, month - 1, 1));

  // Also look at the previous month to capture CC bill categories
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStart = startOfMonth(new Date(prevYear, prevMonth - 1, 1));
  const prevEnd = endOfMonth(new Date(prevYear, prevMonth - 1, 1));

  // Get all budgeted category+entity combos for the current month
  const budgetedKeys = new Set(
    budgets
      .filter((b) => b.isActive)
      .map((b) => `${b.entityId}::${b.category}`)
  );

  // Find expense transactions in current month OR previous month without a budget
  const expenseTransactions = transactions.filter((t) => {
    if (t.type !== 'expense') return false;
    const txDate = t.date instanceof Date ? t.date : parseLocalDate(t.date);
    return (
      isWithinInterval(txDate, { start: currentStart, end: currentEnd }) ||
      isWithinInterval(txDate, { start: prevStart, end: prevEnd })
    );
  });

  // Group by entity+category, tracking current vs previous month separately
  const grouped: Record<string, {
    currentTotal: number;
    previousTotal: number;
    currentCount: number;
    previousCount: number;
    entityId: string;
    entityType: string;
  }> = {};

  for (const tx of expenseTransactions) {
    const key = `${tx.entityId}::${tx.category}`;
    if (budgetedKeys.has(key)) continue; // has a budget, skip
    if (!grouped[key]) {
      grouped[key] = {
        currentTotal: 0, previousTotal: 0,
        currentCount: 0, previousCount: 0,
        entityId: tx.entityId, entityType: tx.entityType,
      };
    }
    const txDate = tx.date instanceof Date ? tx.date : parseLocalDate(tx.date);
    const isCurrent = isWithinInterval(txDate, { start: currentStart, end: currentEnd });
    if (isCurrent) {
      grouped[key].currentTotal += tx.amount * tx.exchangeRate;
      grouped[key].currentCount += 1;
    } else {
      grouped[key].previousTotal += tx.amount * tx.exchangeRate;
      grouped[key].previousCount += 1;
    }
  }

  return Object.entries(grouped)
    .map(([key, val]) => {
      // Use current month total if available, otherwise show previous month
      const hasCurrentData = val.currentTotal > 0;
      return {
        category: key.split('::')[1],
        totalSpent: hasCurrentData ? val.currentTotal : val.previousTotal,
        transactionCount: hasCurrentData ? val.currentCount : val.previousCount,
        entityId: val.entityId,
        entityType: val.entityType as Budget['entityType'],
        isFromPreviousMonth: !hasCurrentData,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent);
}

// ============================================
// Month-over-Month
// ============================================

/**
 * Compare spending per category between current and previous month
 */
export function getMonthOverMonth(
  budgets: Budget[],
  transactions: Transaction[],
  year: number,
  month: number
): MonthOverMonth[] {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  const currentStart = startOfMonth(new Date(year, month - 1, 1));
  const currentEnd = endOfMonth(new Date(year, month - 1, 1));
  const prevStart = startOfMonth(new Date(prevYear, prevMonth - 1, 1));
  const prevEnd = endOfMonth(new Date(prevYear, prevMonth - 1, 1));

  // Get unique category+entity combos from active budgets
  const categories = budgets
    .filter((b) => b.isActive)
    .map((b) => ({ category: b.category, entityId: b.entityId }));

  // Deduplicate
  const seen = new Set<string>();
  const unique = categories.filter((c) => {
    const key = `${c.entityId}::${c.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.map(({ category, entityId }) => {
    const currentSpent = transactions
      .filter((t) => {
        if (t.entityId !== entityId || t.category !== category || t.type !== 'expense') return false;
        const d = t.date instanceof Date ? t.date : parseLocalDate(t.date);
        return isWithinInterval(d, { start: currentStart, end: currentEnd });
      })
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const previousSpent = transactions
      .filter((t) => {
        if (t.entityId !== entityId || t.category !== category || t.type !== 'expense') return false;
        const d = t.date instanceof Date ? t.date : parseLocalDate(t.date);
        return isWithinInterval(d, { start: prevStart, end: prevEnd });
      })
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const changeAmount = currentSpent - previousSpent;
    const changePercent = previousSpent > 0 ? (changeAmount / previousSpent) * 100 : currentSpent > 0 ? 100 : 0;

    return {
      category,
      entityId,
      currentSpent,
      previousSpent,
      changeAmount,
      changePercent,
    };
  });
}

// ============================================
// Budget Insights
// ============================================

/**
 * Generate actionable insight objects for each budget
 */
export function generateBudgetInsights(
  budgetProgressList: BudgetProgress[],
  transactions: Transaction[],
  yearlyBudgets?: Budget[]
): BudgetInsight[] {
  // Build a lookup of yearly budget amounts by entityId+category for context
  const yearlyAmountMap = new Map<string, number>();
  if (yearlyBudgets) {
    for (const yb of yearlyBudgets) {
      yearlyAmountMap.set(`${yb.entityId}::${yb.category}`, yb.amount);
    }
  }

  return budgetProgressList
    .filter((p) => p.budget.isActive)
    .map((progress) => {
      const pace = calculateBudgetPace(progress.budget, transactions);
      const { percentUsed, remaining, budget } = progress;
      const { dailySpendRate, allowedDailyRate, daysRemaining } = pace;

      // Check if this budget is a yearly-derived monthly view
      const isYearlyDerived = budget.period === 'yearly';
      const annualAmount = yearlyAmountMap.get(`${budget.entityId}::${budget.category}`);
      const yearlyContext = isYearlyDerived && annualAmount
        ? ` (monthly target from ${formatAmount(annualAmount)}/year)`
        : '';

      let severity: BudgetInsight['severity'];
      let message: string;
      let recommendation: string;

      if (progress.isOverBudget) {
        severity = 'critical';
        message = `${budget.category}: Over budget by ${formatAmount(Math.abs(remaining))}`;
        recommendation = isYearlyDerived
          ? 'Over this month\'s target. Keep an eye on the yearly total to stay on track.'
          : 'Stop non-essential spending in this category immediately.';
      } else if (percentUsed >= 80) {
        severity = 'warning';
        message = `${budget.category}: ${percentUsed.toFixed(0)}% used with ${daysRemaining} days remaining${yearlyContext}`;
        recommendation = dailySpendRate > allowedDailyRate
          ? `Spending ${formatAmount(dailySpendRate)}/day vs ${formatAmount(allowedDailyRate)}/day budget pace. Consider reducing spend.`
          : `On pace but close to limit. ${formatAmount(remaining)} remaining.`;
      } else {
        severity = 'good';
        message = `${budget.category}: ${percentUsed.toFixed(0)}% used`;
        recommendation = `You have ${formatAmount(remaining)} room available. Daily pace: ${formatAmount(dailySpendRate)}/day of ${formatAmount(allowedDailyRate)}/day allowed.`;
      }

      return {
        budgetId: budget.id,
        category: budget.category,
        severity,
        message,
        recommendation,
        percentUsed,
        remaining,
        daysRemaining,
        dailySpendRate,
        allowedDailyRate,
      };
    })
    .sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, good: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
}

/** Simple helper to format amounts for insight messages */
function formatAmount(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ============================================
// Yearly Budget Breakdown
// ============================================

const MONTH_LABELS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Break a yearly budget into 12 monthly segments with budget target
 * (amount/12) vs actual spending per month.
 */
export function getYearlyBreakdown(
  budget: Budget,
  transactions: Transaction[]
): YearlyMonthBreakdown[] {
  const monthlyTarget = budget.amount / 12;

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const monthStart = startOfMonth(new Date(budget.year, i, 1));
    const monthEnd = endOfMonth(new Date(budget.year, i, 1));

    const actual = transactions
      .filter((t) => {
        if (t.entityId !== budget.entityId) return false;
        if (t.category !== budget.category) return false;
        if (t.type !== 'expense') return false;
        const txDate = t.date instanceof Date ? t.date : parseLocalDate(t.date);
        return isWithinInterval(txDate, { start: monthStart, end: monthEnd });
      })
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const cumulativeBudget = monthlyTarget * month;
    const cumulativeActual = Array.from({ length: month }, (_, j) => {
      const mStart = startOfMonth(new Date(budget.year, j, 1));
      const mEnd = endOfMonth(new Date(budget.year, j, 1));
      return transactions
        .filter((t) => {
          if (t.entityId !== budget.entityId) return false;
          if (t.category !== budget.category) return false;
          if (t.type !== 'expense') return false;
          const txDate = t.date instanceof Date ? t.date : parseLocalDate(t.date);
          return isWithinInterval(txDate, { start: mStart, end: mEnd });
        })
        .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
    }).reduce((sum, v) => sum + v, 0);

    return {
      month,
      monthLabel: MONTH_LABELS_SHORT[i],
      budgetTarget: monthlyTarget,
      actual,
      cumulativeBudget,
      cumulativeActual,
      isOver: actual > monthlyTarget,
    };
  });
}

/**
 * Calculate yearly progress for a single yearly budget.
 * Derives monthly target (amount/12), YTD spent, and projected annual.
 */
export function calculateYearlyBudgetProgress(
  budget: Budget,
  transactions: Transaction[]
): YearlyBudgetProgress {
  const now = new Date();
  const currentMonth = budget.year === now.getFullYear()
    ? now.getMonth() + 1
    : (budget.year < now.getFullYear() ? 12 : 0);

  const monthlyTarget = budget.amount / 12;
  const months = getYearlyBreakdown(budget, transactions);

  // YTD = sum of months up to current month
  const ytdMonths = months.filter((m) => m.month <= currentMonth);
  const ytdSpent = ytdMonths.reduce((sum, m) => sum + m.actual, 0);
  const ytdBudget = monthlyTarget * currentMonth;
  const ytdRemaining = ytdBudget - ytdSpent;
  const ytdPercentUsed = ytdBudget > 0 ? (ytdSpent / ytdBudget) * 100 : 0;

  // Project annual: if we've spent X in N months, project X * (12/N)
  const projectedAnnual = currentMonth > 0
    ? (ytdSpent / currentMonth) * 12
    : 0;

  return {
    budget,
    monthlyTarget,
    ytdBudget,
    ytdSpent,
    ytdRemaining,
    ytdPercentUsed,
    isYtdOver: ytdSpent > ytdBudget,
    projectedAnnual,
    months,
  };
}

/**
 * Calculate yearly progress for all yearly budgets in a given year.
 */
export function calculateAllYearlyProgress(
  budgets: Budget[],
  transactions: Transaction[],
  year: number
): YearlyBudgetProgress[] {
  return budgets
    .filter((b) => b.isActive && b.period === 'yearly' && b.year === year)
    .map((b) => calculateYearlyBudgetProgress(b, transactions));
}

/**
 * Get aggregated yearly summary stats across all yearly budgets for a year.
 */
export function getYearlySummaryStats(
  budgets: Budget[],
  transactions: Transaction[],
  year: number
): YearlySummaryStats {
  const yearlyBudgets = budgets.filter(
    (b) => b.isActive && b.period === 'yearly' && b.year === year
  );

  const now = new Date();
  const monthsElapsed = year === now.getFullYear()
    ? now.getMonth() + 1
    : (year < now.getFullYear() ? 12 : 0);

  const totalAnnualBudget = yearlyBudgets.reduce((sum, b) => sum + b.amount, 0);

  // Total YTD spent across all yearly budgets
  let totalYtdSpent = 0;
  for (const budget of yearlyBudgets) {
    for (let m = 0; m < monthsElapsed; m++) {
      const mStart = startOfMonth(new Date(year, m, 1));
      const mEnd = endOfMonth(new Date(year, m, 1));
      totalYtdSpent += transactions
        .filter((t) => {
          if (t.entityId !== budget.entityId) return false;
          if (t.category !== budget.category) return false;
          if (t.type !== 'expense') return false;
          const txDate = t.date instanceof Date ? t.date : parseLocalDate(t.date);
          return isWithinInterval(txDate, { start: mStart, end: mEnd });
        })
        .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
    }
  }

  const totalAnnualRoom = totalAnnualBudget - totalYtdSpent;
  const projectedAnnualTotal = monthsElapsed > 0
    ? (totalYtdSpent / monthsElapsed) * 12
    : 0;
  const isOnTrack = projectedAnnualTotal <= totalAnnualBudget;

  return {
    totalAnnualBudget,
    totalYtdSpent,
    totalAnnualRoom,
    projectedAnnualTotal,
    monthsElapsed,
    isOnTrack,
  };
}

/**
 * Get yearly budgets for the current year.
 */
export function getCurrentYearBudgets(budgets: Budget[]): Budget[] {
  const currentYear = new Date().getFullYear();
  return budgets.filter(
    (b) => b.isActive && b.period === 'yearly' && b.year === currentYear
  );
}

/**
 * For the Monthly tab, derive monthly-equivalent budget progress from yearly budgets.
 * Each yearly budget appears as a virtual monthly budget with amount/12 for the given month.
 */
export function getMonthlyFromYearlyBudgets(
  budgets: Budget[],
  transactions: Transaction[],
  year: number,
  month: number
): BudgetProgress[] {
  const yearlyBudgets = budgets.filter(
    (b) => b.isActive && b.period === 'yearly' && b.year === year
  );

  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(new Date(year, month - 1, 1));

  return yearlyBudgets.map((budget) => {
    const monthlyTarget = budget.amount / 12;
    const spent = transactions
      .filter((t) => {
        if (t.entityId !== budget.entityId) return false;
        if (t.category !== budget.category) return false;
        if (t.type !== 'expense') return false;
        const txDate = t.date instanceof Date ? t.date : parseLocalDate(t.date);
        return isWithinInterval(txDate, { start: monthStart, end: monthEnd });
      })
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const remaining = monthlyTarget - spent;
    const percentUsed = monthlyTarget > 0 ? (spent / monthlyTarget) * 100 : 0;

    // Create a virtual budget with monthly amount for display
    const virtualBudget: Budget = {
      ...budget,
      amount: monthlyTarget,
    };

    return {
      budget: virtualBudget,
      spent,
      remaining,
      percentUsed,
      isOverBudget: spent > monthlyTarget,
    };
  });
}

// ============================================
// Credit Card Integration
// ============================================

/**
 * Convert credit card bill transactions into virtual Transaction objects
 * so they can be included in budget calculations.
 *
 * Chain: BillTransaction → CreditCardBill → CreditCard → entity
 *
 * Uses the bill's closing date as the effective date for ALL transactions,
 * not the individual purchase dates from the CSV. This ensures:
 * - Jan bill transactions count in January's budget
 * - Feb bill transactions count in February's budget
 * - No cross-contamination (a late-Jan purchase in the Feb bill doesn't
 *   inflate January's budget)
 * - Installment charges are attributed to the correct billing cycle
 *
 * This matches the user's mental model: each bill maps to its own month.
 */
export function convertBillTransactionsToTransactions(
  billTransactions: BillTransaction[],
  bills: CreditCardBill[],
  creditCards: CreditCard[]
): Transaction[] {
  // Build lookup maps
  const billMap = new Map(bills.map((b) => [b.id, b]));
  const cardMap = new Map(creditCards.map((c) => [c.id, c]));

  const result: Transaction[] = [];
  for (const bt of billTransactions) {
    const bill = billMap.get(bt.billId);
    if (!bill) continue;
    const card = cardMap.get(bill.creditCardId);
    if (!card) continue;

    // Use the bill's closing date so each transaction is attributed to the
    // correct billing cycle month. The CSV purchase date is preserved in the
    // original BillTransaction record for display purposes.
    const effectiveDate = bill.closingDate instanceof Date
      ? bill.closingDate
      : parseLocalDate(bill.closingDate);

    result.push({
      id: `cc-${bt.id}`,
      entityId: card.entityId,
      entityType: card.entityType,
      type: 'expense',
      amount: bt.amount,
      currency: card.currency,
      exchangeRate: 1,
      description: bt.description,
      category: bt.category,
      date: effectiveDate,
      createdAt: bt.createdAt,
      updatedAt: bt.updatedAt,
    });
  }
  return result;
}

/**
 * Merge regular transactions with credit-card-derived virtual transactions,
 * avoiding double-counting bills that are already linked as expense transactions.
 */
export function mergeTransactionsWithCreditCard(
  transactions: Transaction[],
  billTransactions: BillTransaction[],
  bills: CreditCardBill[],
  creditCards: CreditCard[]
): Transaction[] {
  // Get IDs of regular transactions that are linked to bills (to avoid double-count)
  const linkedTransactionIds = new Set(
    bills
      .filter((b) => b.transactionId)
      .map((b) => b.transactionId!)
  );

  // Filter out linked bill-expense transactions from regular transactions
  // (they'd have category "Credit Card" and we're replacing them with granular ones)
  const filteredRegular = transactions.filter(
    (t) => !linkedTransactionIds.has(t.id)
  );

  const virtualTransactions = convertBillTransactionsToTransactions(
    billTransactions,
    bills,
    creditCards
  );

  return [...filteredRegular, ...virtualTransactions];
}

// ============================================
// Installment Projections
// ============================================

/**
 * Convert active installment future projections into virtual Transaction objects
 * so upcoming credit card installments are counted in budget calculations.
 *
 * Projects from the bill's closing date (which tells us when the last paid installment
 * was charged) rather than the purchase date. This ensures:
 * - Projections align with actual billing cycles
 * - Totals naturally decrease month-over-month as installments complete
 * - Months covered by uploaded bills are skipped to prevent double-counting
 */
export function convertInstallmentsToTransactions(
  installments: Installment[],
  creditCards: CreditCard[],
  bills: CreditCardBill[] = [],
  billTransactions: BillTransaction[] = []
): Transaction[] {
  // Safety-net dedup: if the same purchase produced multiple installment records
  // across different bills (e.g., "STORE 3/10" in Jan + "STORE 4/10" in Feb),
  // keep only the one with the highest paidInstallments (most recent bill).
  const dedupMap = new Map<string, Installment>();
  for (const inst of installments) {
    const key = `${inst.creditCardId}::${inst.description}::${inst.installmentAmount}::${inst.totalInstallments}`;
    const existing = dedupMap.get(key);
    if (!existing || inst.paidInstallments > existing.paidInstallments) {
      dedupMap.set(key, inst);
    }
  }
  const dedupedInstallments = Array.from(dedupMap.values());

  const cardMap = new Map(creditCards.map((c) => [c.id, c]));
  const billMap = new Map(bills.map((b) => [b.id, b]));

  // Map billTransactionId → billId so we can find each installment's source bill
  const btToBillId = new Map<string, string>();
  for (const bt of billTransactions) {
    btToBillId.set(bt.id, bt.billId);
  }

  // Determine which year-months are already covered by uploaded bills
  const coveredMonths = new Set<string>();
  for (const bill of bills) {
    const closing = bill.closingDate instanceof Date ? bill.closingDate : parseLocalDate(bill.closingDate);
    const key = `${closing.getFullYear()}-${closing.getMonth() + 1}`;
    coveredMonths.add(key);
  }

  const result: Transaction[] = [];

  for (const inst of dedupedInstallments) {
    if (!inst.isActive) continue;
    const remaining = inst.totalInstallments - inst.paidInstallments;
    if (remaining <= 0) continue;

    const card = cardMap.get(inst.creditCardId);
    if (!card) continue;

    const category = inst.category || 'Credit Card';

    // Find the bill that contains this installment's source transaction
    // and use its closing date as the anchor for projections
    const sourceBillId = btToBillId.get(inst.billTransactionId);
    const sourceBill = sourceBillId ? billMap.get(sourceBillId) : undefined;

    // Anchor: the bill's closing date tells us when the last paid installment was charged
    // Each future installment is 1, 2, 3... months after that bill
    const anchorDate = sourceBill
      ? (sourceBill.closingDate instanceof Date ? sourceBill.closingDate : parseLocalDate(sourceBill.closingDate))
      : (inst.startDate instanceof Date ? inst.startDate : parseLocalDate(inst.startDate));
    const usesBillAnchor = !!sourceBill;

    for (let i = 0; i < remaining; i++) {
      const futureDate = usesBillAnchor
        ? addMonths(anchorDate, 1 + i)  // 1 month after bill for next payment, 2 for the one after, etc.
        : addMonths(anchorDate, inst.paidInstallments + i); // fallback to old formula

      const monthKey = `${futureDate.getFullYear()}-${futureDate.getMonth() + 1}`;

      // Skip months already covered by actual bill data
      if (coveredMonths.has(monthKey)) continue;

      result.push({
        id: `inst-${inst.id}-${i}`,
        entityId: card.entityId,
        entityType: card.entityType,
        type: 'expense',
        amount: inst.installmentAmount,
        currency: card.currency,
        exchangeRate: 1,
        description: `${inst.description} (${inst.paidInstallments + i + 1}/${inst.totalInstallments})`,
        category,
        date: futureDate,
        createdAt: inst.createdAt,
        updatedAt: inst.updatedAt,
      });
    }
  }

  return result;
}
