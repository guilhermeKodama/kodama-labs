'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Sparkles, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
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
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  if (transactions.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400">
        No transactions in this bill.
      </div>
    );
  }

  // Group by category for summary
  const categoryTotals = transactions.reduce<Record<string, { total: number; count: number }>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = { total: 0, count: 0 };
    acc[t.category].total += t.amount;
    acc[t.category].count += 1;
    return acc;
  }, {});

  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1].total - a[1].total);

  // Get unique expense category names for the dropdown
  const expenseCategories = categories
    .filter((c) => c.type === 'expense')
    .map((c) => c.name);
  const uniqueCategories = [...new Set(expenseCategories)].sort();

  // Filter transactions by selected categories
  const filteredTransactions = selectedCategories.size > 0
    ? transactions.filter((t) => selectedCategories.has(t.category))
    : transactions;

  // Filtered total
  const filteredTotal = filteredTransactions.reduce((sum, t) => sum + t.amount, 0);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedCategories(new Set());
  };

  return (
    <div className="space-y-6">
      {/* Category summary — clickable filters */}
      <div className="flex flex-wrap items-center gap-2">
        {sortedCategories.map(([category, { total }]) => {
          const isSelected = selectedCategories.has(category);
          const isFiltering = selectedCategories.size > 0;
          return (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-xs transition-all cursor-pointer',
                isSelected
                  ? 'bg-cyan-500/20 ring-1 ring-cyan-500/50'
                  : isFiltering
                  ? 'bg-slate-800/50 opacity-50 hover:opacity-80'
                  : 'bg-slate-800 hover:bg-slate-700'
              )}
            >
              <span className={cn('text-slate-300', isSelected && 'text-cyan-300')}>
                {category}
              </span>
              <span className={cn('ml-2 font-medium', isSelected ? 'text-cyan-400' : 'text-white')}>
                {formatCurrency(total, currency)}
              </span>
            </button>
          );
        })}

        {/* Reset button */}
        {selectedCategories.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-6 gap-1 rounded-full px-2 text-xs text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Filter summary */}
      {selectedCategories.size > 0 && (
        <div className="text-xs text-slate-500">
          Showing {filteredTransactions.length} of {transactions.length} transactions
          &middot; {formatCurrency(filteredTotal, currency)}
        </div>
      )}

      {/* Transaction list */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px]">
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
            {filteredTransactions.map((tx) => (
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
