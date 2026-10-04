'use client';

import { format } from 'date-fns';
import { useTranslations } from 'next-intl';
import { formatCurrency } from '@/lib/utils/format';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEFAULT_EXPENSE_CATEGORIES, type Category } from '@/types';
import type { ExpenseLedgerStatement } from '@/lib/utils/expense-ledger';
import { pickerCategoryNames } from '@/lib/utils/category-picker';

interface StatementPurchasesTableProps {
  statements: Array<ExpenseLedgerStatement & { creditCardId: string }>;
  cardNames: Record<string, string>;
  currency: string;
  categories?: Category[];
  onUpdateCategory?: (transactionId: string, category: string) => void;
}

export function StatementPurchasesTable({
  statements,
  cardNames,
  currency,
  categories = [],
  onUpdateCategory,
}: StatementPurchasesTableProps) {
  const t = useTranslations();

  const rows = statements.flatMap((statement) =>
    statement.purchases.map((purchase) => ({
      ...purchase,
      statementMonth: statement.month,
      closingDate: statement.closingDate,
      cardName: cardNames[statement.creditCardId] ?? '',
    }))
  );

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400">
        {t('creditCards.statementPurchases.empty')}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="pb-3 text-left text-xs font-medium text-slate-400">
              {t('creditCards.statementPurchases.purchaseDate')}
            </th>
            <th className="pb-3 text-left text-xs font-medium text-slate-400">
              {t('creditCards.statementPurchases.statement')}
            </th>
            <th className="pb-3 text-left text-xs font-medium text-slate-400">
              {t('creditCards.statementPurchases.descriptionColumn')}
            </th>
            <th className="pb-3 text-left text-xs font-medium text-slate-400">
              {t('creditCards.statementPurchases.category')}
            </th>
            <th className="pb-3 text-right text-xs font-medium text-slate-400">
              {t('creditCards.statementPurchases.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const options = pickerCategoryNames(
              categories,
              'expense',
              row.category,
              DEFAULT_EXPENSE_CATEGORIES
            );
            const closing = row.closingDate
              ? format(new Date(row.closingDate), 'MMM dd, yyyy')
              : null;
            return (
              <tr key={row.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="py-2.5 text-sm text-slate-300">
                  {format(new Date(row.transactionDate), 'MMM dd, yyyy')}
                </td>
                <td className="py-2.5 text-sm text-slate-300">
                  <p className="text-white">{row.statementMonth}</p>
                  {row.cardName && <p className="text-xs text-slate-500">{row.cardName}</p>}
                  {closing && (
                    <p className="text-xs text-slate-500">
                      {t('creditCards.statementPurchases.closing', { date: closing })}
                    </p>
                  )}
                </td>
                <td className="py-2.5 text-sm text-white">{row.description}</td>
                <td className="py-2.5">
                  {onUpdateCategory && options.length > 0 ? (
                    <Select
                      value={row.category}
                      onValueChange={(value) => onUpdateCategory(row.id, value)}
                    >
                      <SelectTrigger className="h-7 w-auto min-w-[140px] gap-1 border-0 bg-transparent px-2 text-sm text-slate-300 hover:bg-slate-800 focus:ring-0 focus:ring-offset-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] border-slate-700 bg-slate-800">
                        {options.map((category) => (
                          <SelectItem key={category} value={category} className="text-sm">
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm text-slate-300">{row.category}</span>
                  )}
                </td>
                <td className="py-2.5 text-right text-sm font-medium text-white">
                  {formatCurrency(row.amount, row.currency || currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
