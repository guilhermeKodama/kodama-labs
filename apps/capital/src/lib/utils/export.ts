import { format } from 'date-fns';
import type { Transaction, Transfer } from '@/types';

/**
 * Escape CSV value (handle commas, quotes, newlines)
 */
function escapeCSV(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert array of objects to CSV string
 */
function arrayToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: Array<{ key: keyof T; header: string }>
): string {
  const headers = columns.map((col) => escapeCSV(col.header)).join(',');
  const rows = data.map((row) =>
    columns.map((col) => escapeCSV(row[col.key] as string | number)).join(',')
  );
  return [headers, ...rows].join('\n');
}

/**
 * Trigger file download
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export transactions to CSV
 */
export function exportTransactionsToCSV(
  transactions: Transaction[],
  entityNames: Record<string, string>,
  filename: string = 'transactions.csv'
) {
  const data = transactions.map((t) => ({
    date: format(new Date(t.date), 'yyyy-MM-dd'),
    type: t.type,
    description: t.description,
    category: t.category,
    amount: t.amount,
    currency: t.currency,
    exchangeRate: t.exchangeRate,
    amountInBase: (t.amount * t.exchangeRate).toFixed(2),
    entity: entityNames[t.entityId] || t.entityId,
    entityType: t.entityType,
  }));

  const columns = [
    { key: 'date' as const, header: 'Date' },
    { key: 'type' as const, header: 'Type' },
    { key: 'description' as const, header: 'Description' },
    { key: 'category' as const, header: 'Category' },
    { key: 'amount' as const, header: 'Amount' },
    { key: 'currency' as const, header: 'Currency' },
    { key: 'exchangeRate' as const, header: 'Exchange Rate' },
    { key: 'amountInBase' as const, header: 'Amount (Base Currency)' },
    { key: 'entity' as const, header: 'Entity' },
    { key: 'entityType' as const, header: 'Entity Type' },
  ];

  const csv = arrayToCSV(data, columns);
  downloadFile(csv, filename, 'text/csv;charset=utf-8');
}

/**
 * Export transfers to CSV
 */
export function exportTransfersToCSV(
  transfers: Transfer[],
  entityNames: Record<string, string>,
  filename: string = 'transfers.csv'
) {
  const data = transfers.map((t) => ({
    date: format(new Date(t.date), 'yyyy-MM-dd'),
    direction: t.direction === 'profit_distribution'
      ? 'Profit Distribution'
      : 'Capital Injection',
    from: entityNames[t.fromEntityId] || t.fromEntityId,
    fromType: t.fromEntityType,
    to: entityNames[t.toEntityId] || t.toEntityId,
    toType: t.toEntityType,
    amount: t.amount,
    currency: t.currency,
    exchangeRate: t.exchangeRate,
    amountInBase: (t.amount * t.exchangeRate).toFixed(2),
    description: t.description || '',
  }));

  const columns = [
    { key: 'date' as const, header: 'Date' },
    { key: 'direction' as const, header: 'Direction' },
    { key: 'from' as const, header: 'From' },
    { key: 'fromType' as const, header: 'From Type' },
    { key: 'to' as const, header: 'To' },
    { key: 'toType' as const, header: 'To Type' },
    { key: 'amount' as const, header: 'Amount' },
    { key: 'currency' as const, header: 'Currency' },
    { key: 'exchangeRate' as const, header: 'Exchange Rate' },
    { key: 'amountInBase' as const, header: 'Amount (Base Currency)' },
    { key: 'description' as const, header: 'Description' },
  ];

  const csv = arrayToCSV(data, columns);
  downloadFile(csv, filename, 'text/csv;charset=utf-8');
}

/**
 * Export monthly report to CSV
 */
export function exportMonthlyReportToCSV(
  data: Array<{
    month: string;
    income: number;
    expense: number;
    investment: number;
    balance: number;
  }>,
  year: number,
  currency: string,
  filename?: string
) {
  const exportData = data.map((row) => ({
    month: row.month,
    income: row.income.toFixed(2),
    expenses: row.expense.toFixed(2),
    investments: row.investment.toFixed(2),
    balance: row.balance.toFixed(2),
  }));

  const columns = [
    { key: 'month' as const, header: 'Month' },
    { key: 'income' as const, header: `Income (${currency})` },
    { key: 'expenses' as const, header: `Expenses (${currency})` },
    { key: 'investments' as const, header: `Investments (${currency})` },
    { key: 'balance' as const, header: `Balance (${currency})` },
  ];

  const csv = arrayToCSV(exportData, columns);
  downloadFile(
    csv,
    filename || `monthly-report-${year}.csv`,
    'text/csv;charset=utf-8'
  );
}

/**
 * Export all data to JSON
 */
export function exportAllDataToJSON(
  data: {
    settings: unknown;
    currencies: unknown[];
    categories: unknown[];
    businesses: unknown[];
    transactions: unknown[];
    transfers: unknown[];
  },
  filename: string = 'capital-backup.json'
) {
  const exportData = {
    ...data,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };

  const json = JSON.stringify(exportData, null, 2);
  downloadFile(json, filename, 'application/json');
}
