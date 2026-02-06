'use client';

import { format } from 'date-fns';
import { Sparkles } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import type { BillTransaction } from '@/types';

interface BillTransactionsTableProps {
  transactions: BillTransaction[];
  currency: string;
}

export function BillTransactionsTable({ transactions, currency }: BillTransactionsTableProps) {
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
                  <span className="inline-flex items-center gap-1 text-sm text-slate-300">
                    {tx.category}
                    {tx.isAutoCategorized && (
                      <Sparkles className="h-3 w-3 text-amber-400" />
                    )}
                  </span>
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
