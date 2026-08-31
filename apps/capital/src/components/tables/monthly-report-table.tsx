'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

export interface MonthlyDetailItem {
  id: string;
  date: Date;
  description: string;
  amount: number;
  source: string;
}

interface MonthlyData {
  month: string;
  income: number;
  expense: number;
  investment: number;
  balance: number;
  incomeItems?: MonthlyDetailItem[];
  expenseItems?: MonthlyDetailItem[];
  investmentItems?: MonthlyDetailItem[];
}

interface MonthlyReportTableProps {
  data: MonthlyData[];
  currency: string;
}

function DetailSection({
  title,
  items,
  currency,
  colorClass,
}: {
  title: string;
  items: MonthlyDetailItem[];
  currency: string;
  colorClass: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-3 last:mb-0">
      <p className={cn('mb-1.5 text-xs font-semibold uppercase tracking-wider', colorClass)}>
        {title}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-slate-700/30"
          >
            <span className="w-12 shrink-0 text-xs text-slate-500">
              {formatDate(item.date, 'dd/MM')}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-300">
              {item.description}
            </span>
            <span
              className={cn(
                'shrink-0 font-mono text-xs',
                item.amount >= 0 ? colorClass : 'text-red-400'
              )}
            >
              {item.amount < 0 ? '−' : ''}{formatCurrency(Math.abs(item.amount), currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyReportTable({ data, currency }: MonthlyReportTableProps) {
  const t = useTranslations('reports');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const toggleMonth = (month: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

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
      <Table className="min-w-[600px]">
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
          {data.map((row) => {
            const isExpanded = expandedMonths.has(row.month);
            const hasItems = (row.incomeItems?.length || 0) + (row.expenseItems?.length || 0) + (row.investmentItems?.length || 0) > 0;

            return (
              <Fragment key={row.month}>
                <TableRow className={cn(
                    'border-slate-800',
                    hasItems ? 'cursor-pointer hover:bg-slate-800/50' : 'hover:bg-slate-800/50',
                    isExpanded && 'bg-slate-800/30'
                  )}
                  onClick={() => hasItems && toggleMonth(row.month)}
                >
                  <TableCell className="font-medium text-white">
                    <div className="flex items-center gap-1.5">
                      {hasItems && (
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 text-slate-500 transition-transform duration-200',
                            isExpanded && 'rotate-90'
                          )}
                        />
                      )}
                      {!hasItems && <span className="w-3.5" />}
                      {row.month}
                    </div>
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
                {isExpanded && (
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-slate-800/20 px-4 py-3">
                      <div className="grid gap-4 md:grid-cols-3">
                        <DetailSection
                          title={t('table.income')}
                          items={row.incomeItems || []}
                          currency={currency}
                          colorClass="text-emerald-400"
                        />
                        <DetailSection
                          title={t('table.expenses')}
                          items={row.expenseItems || []}
                          currency={currency}
                          colorClass="text-red-400"
                        />
                        <DetailSection
                          title={t('table.investments')}
                          items={row.investmentItems || []}
                          currency={currency}
                          colorClass="text-blue-400"
                        />
                      </div>
                      {(row.incomeItems?.length || 0) + (row.expenseItems?.length || 0) + (row.investmentItems?.length || 0) === 0 && (
                        <p className="text-center text-sm text-slate-500">{t('table.noItems')}</p>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
        <TableFooter className="border-t border-slate-700 bg-slate-800/50">
          <TableRow className="hover:bg-transparent">
            <TableCell className="font-bold text-white">
              <div className="flex items-center gap-1.5">
                <span className="w-3.5" />
                {t('table.total')}
              </div>
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
