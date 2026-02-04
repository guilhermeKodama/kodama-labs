import {
  startOfYear,
  endOfYear,
  isWithinInterval,
} from 'date-fns';
import type {
  Transaction,
  TaxSummary,
  TaxSettings,
  EntityType,
} from '@/types';

/**
 * Get transactions for a specific tax year
 */
export function getTransactionsForTaxYear(
  transactions: Transaction[],
  taxYear: number
): Transaction[] {
  const start = startOfYear(new Date(taxYear, 0, 1));
  const end = endOfYear(new Date(taxYear, 0, 1));

  return transactions.filter((t) => {
    const transactionDate = new Date(t.date);
    return isWithinInterval(transactionDate, { start, end });
  });
}

/**
 * Get transactions for a specific entity and tax year
 */
export function getEntityTransactionsForTaxYear(
  transactions: Transaction[],
  entityId: string,
  entityType: EntityType,
  taxYear: number
): Transaction[] {
  return getTransactionsForTaxYear(transactions, taxYear).filter(
    (t) => t.entityId === entityId && t.entityType === entityType
  );
}

/**
 * Calculate total income for an entity in a tax year
 */
export function calculateTotalIncome(
  transactions: Transaction[],
  entityId: string,
  entityType: EntityType,
  taxYear: number
): number {
  return getEntityTransactionsForTaxYear(transactions, entityId, entityType, taxYear)
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}

/**
 * Calculate total deductible expenses for an entity in a tax year
 */
export function calculateTotalDeductible(
  transactions: Transaction[],
  entityId: string,
  entityType: EntityType,
  taxYear: number
): number {
  return getEntityTransactionsForTaxYear(transactions, entityId, entityType, taxYear)
    .filter((t) => t.type === 'expense' && t.isTaxDeductible)
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}

/**
 * Calculate total expenses (all, not just deductible) for an entity in a tax year
 */
export function calculateTotalExpenses(
  transactions: Transaction[],
  entityId: string,
  entityType: EntityType,
  taxYear: number
): number {
  return getEntityTransactionsForTaxYear(transactions, entityId, entityType, taxYear)
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
}

/**
 * Calculate taxable income (income - deductible expenses)
 */
export function calculateTaxableIncome(
  transactions: Transaction[],
  entityId: string,
  entityType: EntityType,
  taxYear: number
): number {
  const totalIncome = calculateTotalIncome(transactions, entityId, entityType, taxYear);
  const totalDeductible = calculateTotalDeductible(transactions, entityId, entityType, taxYear);
  return Math.max(0, totalIncome - totalDeductible);
}

/**
 * Calculate estimated tax based on tax rate
 */
export function calculateEstimatedTax(
  taxableIncome: number,
  taxRate: number // As percentage (e.g., 25 for 25%)
): number {
  return taxableIncome * (taxRate / 100);
}

/**
 * Calculate full tax summary for an entity
 */
export function calculateTaxSummary(
  transactions: Transaction[],
  entityId: string,
  entityType: EntityType,
  entityName: string,
  taxYear: number,
  taxRate: number
): TaxSummary {
  const totalIncome = calculateTotalIncome(transactions, entityId, entityType, taxYear);
  const totalDeductible = calculateTotalDeductible(transactions, entityId, entityType, taxYear);
  const taxableIncome = calculateTaxableIncome(transactions, entityId, entityType, taxYear);
  const estimatedTax = calculateEstimatedTax(taxableIncome, taxRate);

  return {
    entityId,
    entityName,
    totalIncome,
    totalDeductible,
    taxableIncome,
    estimatedTax,
    taxRate,
  };
}

/**
 * Calculate tax summaries for all entities
 */
export function calculateAllTaxSummaries(
  transactions: Transaction[],
  entities: Array<{ id: string; name: string; type: EntityType }>,
  taxSettings: TaxSettings
): TaxSummary[] {
  return entities.map((entity) => {
    const taxRate = taxSettings.entityTaxRates[entity.id] || 0;
    return calculateTaxSummary(
      transactions,
      entity.id,
      entity.type,
      entity.name,
      taxSettings.taxYear,
      taxRate
    );
  });
}

/**
 * Get all deductible transactions for a tax year
 */
export function getDeductibleTransactions(
  transactions: Transaction[],
  taxYear: number
): Transaction[] {
  return getTransactionsForTaxYear(transactions, taxYear).filter(
    (t) => t.type === 'expense' && t.isTaxDeductible
  );
}

/**
 * Group transactions by category for tax reporting
 */
export function groupTransactionsByCategory(
  transactions: Transaction[]
): Record<string, Transaction[]> {
  return transactions.reduce((groups, transaction) => {
    const category = transaction.category;
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(transaction);
    return groups;
  }, {} as Record<string, Transaction[]>);
}

/**
 * Calculate deductions by category
 */
export function calculateDeductionsByCategory(
  transactions: Transaction[],
  taxYear: number
): Record<string, number> {
  const deductible = getDeductibleTransactions(transactions, taxYear);
  const grouped = groupTransactionsByCategory(deductible);

  return Object.entries(grouped).reduce((result, [category, txs]) => {
    result[category] = txs.reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
    return result;
  }, {} as Record<string, number>);
}

/**
 * Get income by category for a tax year
 */
export function calculateIncomeByCategory(
  transactions: Transaction[],
  taxYear: number
): Record<string, number> {
  const yearTransactions = getTransactionsForTaxYear(transactions, taxYear);
  const incomeTransactions = yearTransactions.filter((t) => t.type === 'income');
  const grouped = groupTransactionsByCategory(incomeTransactions);

  return Object.entries(grouped).reduce((result, [category, txs]) => {
    result[category] = txs.reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
    return result;
  }, {} as Record<string, number>);
}

/**
 * Format tax data for CSV export
 */
export function formatTaxReportForExport(
  taxSummaries: TaxSummary[],
  deductionsByCategory: Record<string, number>,
  incomeByCategory: Record<string, number>,
  taxYear: number
): string {
  let csv = `Tax Report - ${taxYear}\n\n`;

  // Entity summaries
  csv += 'Entity Tax Summaries\n';
  csv += 'Entity,Total Income,Total Deductible,Taxable Income,Tax Rate,Estimated Tax\n';
  taxSummaries.forEach((summary) => {
    csv += `${summary.entityName},${summary.totalIncome.toFixed(2)},${summary.totalDeductible.toFixed(2)},${summary.taxableIncome.toFixed(2)},${summary.taxRate}%,${summary.estimatedTax.toFixed(2)}\n`;
  });

  csv += '\nIncome by Category\n';
  csv += 'Category,Amount\n';
  Object.entries(incomeByCategory).forEach(([category, amount]) => {
    csv += `${category},${amount.toFixed(2)}\n`;
  });

  csv += '\nDeductions by Category\n';
  csv += 'Category,Amount\n';
  Object.entries(deductionsByCategory).forEach(([category, amount]) => {
    csv += `${category},${amount.toFixed(2)}\n`;
  });

  return csv;
}

/**
 * Download tax report as CSV
 */
export function downloadTaxReport(
  taxSummaries: TaxSummary[],
  deductionsByCategory: Record<string, number>,
  incomeByCategory: Record<string, number>,
  taxYear: number
) {
  const csv = formatTaxReportForExport(taxSummaries, deductionsByCategory, incomeByCategory, taxYear);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tax-report-${taxYear}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
