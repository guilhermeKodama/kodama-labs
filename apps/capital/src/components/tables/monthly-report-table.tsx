'use client';

import { useTranslations } from 'next-intl';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

interface MonthlyData {
  month: string;
  income: number;
  expense: number;
  investment: number;
  balance: number;
}

interface MonthlyReportTableProps {
  data: MonthlyData[];
  currency: string;
}

export function MonthlyReportTable({ data, currency }: MonthlyReportTableProps) {
  const t = useTranslations('reports');

  const totals = data.reduce(
    (acc, row) => ({
      income: acc.income + row.income,
      expense: acc.expense + row.expense,
      investment: acc.investment + row.investment,
      balance: acc.balance + row.balance,
    }),
    { income: 0, expense: 0, investment: 0, balance: 0 }
  );

  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400">
        {t('noData')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">{t('table.month')}</TableHead>
            <TableHead className="text-right text-emerald-400">
              {t('table.income')}
            </TableHead>
            <TableHead className="text-right text-red-400">
              {t('table.expenses')}
            </TableHead>
            <TableHead className="text-right text-blue-400">
              {t('table.investments')}
            </TableHead>
            <TableHead className="text-right text-slate-400">
              {t('table.balance')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow
              key={row.month}
              className="border-slate-800 hover:bg-slate-800/50"
            >
              <TableCell className="font-medium text-white">
                {row.month}
              </TableCell>
              <TableCell className="text-right text-emerald-400">
                {formatCurrency(row.income, currency)}
              </TableCell>
              <TableCell className="text-right text-red-400">
                {formatCurrency(row.expense, currency)}
              </TableCell>
              <TableCell className="text-right text-blue-400">
                {formatCurrency(row.investment, currency)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-medium',
                  row.balance >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {formatCurrency(row.balance, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className="border-t border-slate-700 bg-slate-800/50">
          <TableRow className="hover:bg-transparent">
            <TableCell className="font-bold text-white">
              {t('table.total')}
            </TableCell>
            <TableCell className="text-right font-bold text-emerald-400">
              {formatCurrency(totals.income, currency)}
            </TableCell>
            <TableCell className="text-right font-bold text-red-400">
              {formatCurrency(totals.expense, currency)}
            </TableCell>
            <TableCell className="text-right font-bold text-blue-400">
              {formatCurrency(totals.investment, currency)}
            </TableCell>
            <TableCell
              className={cn(
                'text-right font-bold',
                totals.balance >= 0 ? 'text-emerald-400' : 'text-red-400'
              )}
            >
              {formatCurrency(totals.balance, currency)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
