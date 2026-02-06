'use client';

import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { FileText, ExternalLink, Trash2, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import type { CreditCardBill } from '@/types';

interface BillsTableProps {
  bills: CreditCardBill[];
  currency: string;
  onViewTransactions?: (billId: string) => void;
  onCreateExpense?: (billId: string) => void;
  onDelete?: (billId: string) => void;
}

export function BillsTable({ bills, currency, onViewTransactions, onCreateExpense, onDelete }: BillsTableProps) {
  const t = useTranslations('creditCards');

  if (bills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="mb-4 h-12 w-12 text-slate-600" />
        <p className="text-slate-400">{t('noBills')}</p>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-amber-500/20 text-amber-400',
      paid: 'bg-emerald-500/20 text-emerald-400',
      overdue: 'bg-red-500/20 text-red-400',
    };
    return styles[status as keyof typeof styles] || styles.pending;
  };

  const getCategorizationBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Categorizing...
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing...
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
            <Sparkles className="h-3 w-3" />
            Categorized
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="pb-3 text-left text-xs font-medium text-slate-400">Card</th>
            <th className="pb-3 text-left text-xs font-medium text-slate-400">{t('bill.closingDate')}</th>
            <th className="pb-3 text-left text-xs font-medium text-slate-400">{t('bill.dueDate')}</th>
            <th className="pb-3 text-right text-xs font-medium text-slate-400">{t('bill.totalAmount')}</th>
            <th className="pb-3 text-center text-xs font-medium text-slate-400">{t('bill.transactions')}</th>
            <th className="pb-3 text-center text-xs font-medium text-slate-400">{t('bill.status')}</th>
            <th className="pb-3 text-center text-xs font-medium text-slate-400">AI</th>
            <th className="pb-3 text-right text-xs font-medium text-slate-400"></th>
          </tr>
        </thead>
        <tbody>
          {bills.map((bill) => (
            <tr key={bill.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
              <td className="py-3">
                {bill.creditCard && (
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: bill.creditCard.color }}
                    />
                    <span className="text-sm text-white">
                      {bill.creditCard.bankName} ****{bill.creditCard.lastFourDigits}
                    </span>
                  </div>
                )}
              </td>
              <td className="py-3 text-sm text-slate-300">
                {format(new Date(bill.closingDate), 'MMM dd, yyyy')}
              </td>
              <td className="py-3 text-sm text-slate-300">
                {format(new Date(bill.dueDate), 'MMM dd, yyyy')}
              </td>
              <td className="py-3 text-right text-sm font-medium text-white">
                {formatCurrency(bill.totalAmount, currency)}
              </td>
              <td className="py-3 text-center text-sm text-slate-400">
                {bill.transactionCount ?? 0}
              </td>
              <td className="py-3 text-center">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', getStatusBadge(bill.status))}>
                  {t(`bill.${bill.status}`)}
                </span>
              </td>
              <td className="py-3 text-center">
                {getCategorizationBadge(bill.categorizationStatus)}
              </td>
              <td className="py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  {onViewTransactions && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewTransactions(bill.id)}
                      className="h-7 text-xs text-slate-400 hover:text-white"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      View
                    </Button>
                  )}
                  {!bill.transactionId && onCreateExpense && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCreateExpense(bill.id)}
                      className="h-7 text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      {t('bill.createExpense')}
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(bill.id)}
                      className="h-7 w-7 text-slate-400 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
