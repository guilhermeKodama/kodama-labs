import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  isWithinInterval,
} from 'date-fns';
import type {
  Budget,
  BudgetProgress,
  Transaction,
  BudgetPeriod,
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
      const transactionDate = new Date(t.date);
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
 * Get budgets that are over or near limit (>80% used)
 */
export function getBudgetAlerts(
  budgets: Budget[],
  transactions: Transaction[],
  warningThreshold: number = 80
): BudgetProgress[] {
  return calculateAllBudgetProgress(budgets, transactions).filter(
    (progress) => progress.percentUsed >= warningThreshold && progress.budget.isActive
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
