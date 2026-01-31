import type {
  Transaction,
  Transfer,
  EntityType,
  EntitySummary,
  TransactionType,
} from '@/types';

/**
 * Calculate the sum of transactions by type
 */
export function sumTransactionsByType(
  transactions: Transaction[],
  type: TransactionType
): number {
  return transactions
    .filter((t) => t.type === type)
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}

/**
 * Calculate entity summary (income, expenses, investments, balance)
 */
export function calculateEntitySummary(
  entityId: string,
  entityType: EntityType,
  entityName: string,
  transactions: Transaction[],
  transfers: Transfer[],
  baseCurrency: string
): EntitySummary {
  const entityTransactions = transactions.filter(
    (t) => t.entityId === entityId && t.entityType === entityType
  );

  const totalIncome = sumTransactionsByType(entityTransactions, 'income');
  const totalExpenses = sumTransactionsByType(entityTransactions, 'expense');
  const totalInvestments = sumTransactionsByType(entityTransactions, 'investment');

  // Calculate transfers impact
  const incomingTransfers = transfers
    .filter((t) => t.toEntityId === entityId)
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

  const outgoingTransfers = transfers
    .filter((t) => t.fromEntityId === entityId)
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

  const balance = totalIncome - totalExpenses + incomingTransfers - outgoingTransfers;
  const netWorth = balance + totalInvestments;

  return {
    entityId,
    entityType,
    entityName,
    totalIncome,
    totalExpenses,
    totalInvestments,
    balance,
    netWorth,
    currency: baseCurrency,
  };
}

/**
 * Calculate total capital across all entities
 */
export function calculateTotalCapital(summaries: EntitySummary[]): number {
  return summaries.reduce((total, summary) => total + summary.netWorth, 0);
}

/**
 * Calculate monthly totals for a given transaction type
 */
export function calculateMonthlyTotals(
  transactions: Transaction[],
  type: TransactionType,
  year: number
): number[] {
  const monthlyTotals = Array(12).fill(0);

  transactions
    .filter((t) => {
      const date = new Date(t.date);
      return t.type === type && date.getFullYear() === year;
    })
    .forEach((t) => {
      const month = new Date(t.date).getMonth();
      monthlyTotals[month] += t.amount * t.exchangeRate;
    });

  return monthlyTotals;
}

/**
 * Calculate category breakdown for transactions
 */
export function calculateCategoryBreakdown(
  transactions: Transaction[],
  type?: TransactionType
): Record<string, number> {
  const filtered = type ? transactions.filter((t) => t.type === type) : transactions;

  return filtered.reduce(
    (acc, t) => {
      const category = t.category || 'Uncategorized';
      acc[category] = (acc[category] || 0) + t.amount * t.exchangeRate;
      return acc;
    },
    {} as Record<string, number>
  );
}

/**
 * Convert amount to base currency
 */
export function convertToBaseCurrency(
  amount: number,
  exchangeRate: number
): number {
  return amount * exchangeRate;
}

/**
 * Calculate growth rate between two periods
 */
export function calculateGrowthRate(
  currentValue: number,
  previousValue: number
): number {
  if (previousValue === 0) return currentValue > 0 ? 100 : 0;
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}
