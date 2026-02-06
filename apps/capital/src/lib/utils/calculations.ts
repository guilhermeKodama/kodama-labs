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

// ============================================
// Phase 3: Visualization Utilities
// ============================================

export interface BalanceDataPoint {
  date: string;
  balance: number;
  income: number;
  expense: number;
  transfer: number;
}

export interface CashFlowDataPoint {
  period: string;
  inflow: number;
  outflow: number;
  netFlow: number;
}

export interface CurrencyDistribution {
  currency: string;
  amount: number;
  percentage: number;
}

export interface EntityComparisonData {
  entityId: string;
  entityName: string;
  entityType: EntityType;
  income: number;
  expenses: number;
  balance: number;
  netWorth: number;
  color?: string;
}

/**
 * Calculate cumulative balance over time
 * Returns daily balance data points for charting
 */
export function calculateBalanceOverTime(
  transactions: Transaction[],
  transfers: Transfer[],
  startDate: Date,
  endDate: Date,
  entityId?: string,
  entityType?: EntityType
): BalanceDataPoint[] {
  // Filter by entity if specified
  const filteredTransactions = entityId && entityType
    ? transactions.filter(t => t.entityId === entityId && t.entityType === entityType)
    : transactions;

  const filteredTransfers = entityId
    ? transfers.filter(t => t.fromEntityId === entityId || t.toEntityId === entityId)
    : transfers;

  // Create a map of daily changes
  const dailyChanges = new Map<string, { income: number; expense: number; transfer: number }>();

  // Process transactions
  filteredTransactions.forEach(t => {
    const dateKey = new Date(t.date).toISOString().split('T')[0];
    const existing = dailyChanges.get(dateKey) || { income: 0, expense: 0, transfer: 0 };
    const amount = t.amount * t.exchangeRate;

    if (t.type === 'income') {
      existing.income += amount;
    } else if (t.type === 'expense') {
      existing.expense += amount;
    }
    // Investments don't affect liquid balance directly

    dailyChanges.set(dateKey, existing);
  });

  // Process transfers
  filteredTransfers.forEach(t => {
    const dateKey = new Date(t.date).toISOString().split('T')[0];
    const existing = dailyChanges.get(dateKey) || { income: 0, expense: 0, transfer: 0 };
    const amount = t.amount * t.exchangeRate;

    if (entityId) {
      // For specific entity, transfers are +/- based on direction
      if (t.toEntityId === entityId) {
        existing.transfer += amount;
      } else if (t.fromEntityId === entityId) {
        existing.transfer -= amount;
      }
    }
    // For global view, transfers cancel out (internal movements)

    dailyChanges.set(dateKey, existing);
  });

  // Generate data points for each day in range
  const dataPoints: BalanceDataPoint[] = [];
  let runningBalance = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    const changes = dailyChanges.get(dateKey) || { income: 0, expense: 0, transfer: 0 };

    runningBalance += changes.income - changes.expense + changes.transfer;

    dataPoints.push({
      date: dateKey,
      balance: runningBalance,
      income: changes.income,
      expense: changes.expense,
      transfer: changes.transfer,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dataPoints;
}

/**
 * Calculate cash flow data grouped by period
 */
export function calculateCashFlow(
  transactions: Transaction[],
  transfers: Transfer[],
  period: 'daily' | 'weekly' | 'monthly',
  year?: number
): CashFlowDataPoint[] {
  const currentYear = year || new Date().getFullYear();
  
  // Filter transactions by year
  const yearTransactions = transactions.filter(t => {
    const date = new Date(t.date);
    return date.getFullYear() === currentYear;
  });

  const getPeriodKey = (date: Date): string => {
    switch (period) {
      case 'daily':
        return date.toISOString().split('T')[0];
      case 'weekly': {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return `W${Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7)} ${date.toLocaleString('default', { month: 'short' })}`;
      }
      case 'monthly':
      default:
        return date.toLocaleString('default', { month: 'short' });
    }
  };

  const periodData = new Map<string, { inflow: number; outflow: number }>();

  // Process transactions
  yearTransactions.forEach(t => {
    const periodKey = getPeriodKey(new Date(t.date));
    const existing = periodData.get(periodKey) || { inflow: 0, outflow: 0 };
    const amount = t.amount * t.exchangeRate;

    if (t.type === 'income') {
      existing.inflow += amount;
    } else if (t.type === 'expense') {
      existing.outflow += amount;
    }

    periodData.set(periodKey, existing);
  });

  // For monthly period, ensure all months are present
  if (period === 'monthly') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach(month => {
      if (!periodData.has(month)) {
        periodData.set(month, { inflow: 0, outflow: 0 });
      }
    });
  }

  // Convert to array and calculate net flow
  const result: CashFlowDataPoint[] = [];
  
  if (period === 'monthly') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach(month => {
      const data = periodData.get(month) || { inflow: 0, outflow: 0 };
      result.push({
        period: month,
        inflow: data.inflow,
        outflow: data.outflow,
        netFlow: data.inflow - data.outflow,
      });
    });
  } else {
    periodData.forEach((data, key) => {
      result.push({
        period: key,
        inflow: data.inflow,
        outflow: data.outflow,
        netFlow: data.inflow - data.outflow,
      });
    });
  }

  return result;
}

/**
 * Calculate currency distribution across all transactions
 */
export function calculateCurrencyDistribution(
  transactions: Transaction[]
): CurrencyDistribution[] {
  const currencyTotals = new Map<string, number>();

  // Sum up balances by currency from transactions
  transactions.forEach(t => {
    const currency = t.currency;
    const existing = currencyTotals.get(currency) || 0;
    
    if (t.type === 'income') {
      currencyTotals.set(currency, existing + t.amount);
    } else if (t.type === 'expense') {
      currencyTotals.set(currency, existing - t.amount);
    }
  });

  // Calculate total for percentages (use absolute values)
  const total = Array.from(currencyTotals.values())
    .map(Math.abs)
    .reduce((sum, val) => sum + val, 0);

  // Convert to distribution array
  const distribution: CurrencyDistribution[] = [];
  
  currencyTotals.forEach((amount, currency) => {
    if (amount !== 0) {
      distribution.push({
        currency,
        amount: Math.abs(amount),
        percentage: total > 0 ? (Math.abs(amount) / total) * 100 : 0,
      });
    }
  });

  // Sort by amount descending
  return distribution.sort((a, b) => b.amount - a.amount);
}

/**
 * Calculate entity comparison data for all entities
 */
export function calculateEntityComparison(
  entities: Array<{ id: string; name: string; type: EntityType; color?: string }>,
  transactions: Transaction[],
  transfers: Transfer[],
  baseCurrency: string
): EntityComparisonData[] {
  return entities.map(entity => {
    const summary = calculateEntitySummary(
      entity.id,
      entity.type,
      entity.name,
      transactions,
      transfers,
      baseCurrency
    );

    return {
      entityId: entity.id,
      entityName: entity.name,
      entityType: entity.type,
      income: summary.totalIncome,
      expenses: summary.totalExpenses,
      balance: summary.balance,
      netWorth: summary.netWorth,
      color: entity.color,
    };
  });
}

/**
 * Get date range for time range selector
 */
export function getDateRangeForTimeRange(
  timeRange: '1M' | '3M' | '6M' | '1Y' | 'ALL',
  transactions: Transaction[]
): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  let startDate: Date;

  switch (timeRange) {
    case '1M':
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '3M':
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6M':
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case '1Y':
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case 'ALL':
    default:
      // Find earliest transaction date
      if (transactions.length === 0) {
        startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
      } else {
        const dates = transactions.map(t => new Date(t.date).getTime());
        startDate = new Date(Math.min(...dates));
      }
      break;
  }

  return { startDate, endDate };
}
