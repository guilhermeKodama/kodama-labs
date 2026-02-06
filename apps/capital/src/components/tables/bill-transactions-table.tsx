'use client';

import { format } from 'date-fns';
import { Sparkles, ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BillTransaction, Category } from '@/types';

interface BillTransactionsTableProps {
  transactions: BillTransaction[];
  currency: string;
  categories?: Category[];
  onUpdateCategory?: (transactionId: string, category: string) => void;
}

export function BillTransactionsTable({
  transactions,
  currency,
  categories = [],
  onUpdateCategory,
}: BillTransactionsTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400">
        No transactions in this bill.
      </div>
    );
  }

  // Group by category for summary
  const categoryTotals = transactions.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {});

  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

  // Get unique expense category names for the dropdown
  const expenseCategories = categories
    .filter((c) => c.type === 'expense')
    .map((c) => c.name);
  // Deduplicate
  const uniqueCategories = [...new Set(expenseCategories)].sort();

  return (
    <div className="space-y-6">
      {/* Category summary */}
      <div className="flex flex-wrap gap-2">
        {sortedCategories.map(([category, total]) => (
          <span
            key={category}
            className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs"
          >
            <span className="text-slate-300">{category}</span>
            <span className="ml-2 font-medium text-white">
              {formatCurrency(total, currency)}
            </span>
          </span>
        ))}
      </div>

      {/* Transaction list */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="pb-3 text-left text-xs font-medium text-slate-400">Date</th>
              <th className="pb-3 text-left text-xs font-medium text-slate-400">Description</th>
              <th className="pb-3 text-left text-xs font-medium text-slate-400">Category</th>
              <th className="pb-3 text-center text-xs font-medium text-slate-400">Installment</th>
              <th className="pb-3 text-right text-xs font-medium text-slate-400">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="py-2.5 text-sm text-slate-300">
                  {format(new Date(tx.transactionDate), 'MMM dd')}
                </td>
                <td className="py-2.5">
                  <p className="text-sm text-white">{tx.description}</p>
                  {tx.merchantName && (
                    <p className="text-xs text-slate-500">{tx.merchantName}</p>
                  )}
                </td>
                <td className="py-2.5">
                  {onUpdateCategory && uniqueCategories.length > 0 ? (
                    <Select
                      value={tx.category}
                      onValueChange={(value) => onUpdateCategory(tx.id, value)}
                    >
                      <SelectTrigger className="h-7 w-auto min-w-[140px] gap-1 border-0 bg-transparent px-2 text-sm text-slate-300 hover:bg-slate-800 focus:ring-0 focus:ring-offset-0">
                        <div className="flex items-center gap-1">
                          <SelectValue />
                          {tx.isAutoCategorized && (
                            <Sparkles className="h-3 w-3 shrink-0 text-amber-400" />
                          )}
                        </div>
                      </SelectTrigger>
                      <SelectContent className="border-slate-700 bg-slate-800 max-h-[300px]">
                        {uniqueCategories.map((cat) => (
                          <SelectItem key={cat} value={cat} className="text-sm">
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sm text-slate-300">
                      {tx.category}
                      {tx.isAutoCategorized && (
                        <Sparkles className="h-3 w-3 text-amber-400" />
                      )}
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-center text-sm text-slate-400">
                  {tx.installmentNumber && tx.totalInstallments
                    ? `${tx.installmentNumber}/${tx.totalInstallments}`
                    : '-'}
                </td>
                <td className="py-2.5 text-right text-sm font-medium text-white">
                  {formatCurrency(tx.amount, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
