'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { format, addMonths } from 'date-fns';
import { Repeat, CalendarClock } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { convertInstallmentsToTransactions, groupTransactionsByMonth } from '@/lib/utils/budget';
import type { Installment, CreditCard, CreditCardBill, BillTransaction } from '@/types';

interface InstallmentsTableProps {
  installments: Installment[];
  creditCards: CreditCard[];
  bills: CreditCardBill[];
  billTransactions: BillTransaction[];
  currency: string;
}

export function InstallmentsTable({
  installments,
  creditCards,
  bills,
  billTransactions,
  currency,
}: InstallmentsTableProps) {
  const t = useTranslations('creditCards');

  // Future monthly projections - reuses convertInstallmentsToTransactions
  // (already covered by budget-installments.test.ts) instead of a second,
  // parallel calculation. That matters here specifically because
  // Installment.startDate gets overwritten to the latest bill's
  // transaction date every time a new bill updates it (see
  // process-bill-csv.ts) - a naive `startDate + paidInstallments` offset
  // double-counts elapsed months and compounds worse with every re-upload,
  // which is what produced the growing/oscillating totals here. The
  // shared function anchors on the source bill's closing date instead.
  const monthlyProjections = useMemo(() => {
    const virtualTransactions = convertInstallmentsToTransactions(
      installments,
      creditCards,
      bills,
      billTransactions
    );
    return groupTransactionsByMonth(virtualTransactions);
  }, [installments, creditCards, bills, billTransactions]);

  const totalFutureAmount = useMemo(() => {
    return installments
      .filter((i) => i.isActive)
      .reduce((sum, i) => {
        const remaining = i.totalInstallments - i.paidInstallments;
        return sum + remaining * i.installmentAmount;
      }, 0);
  }, [installments]);

  if (installments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Repeat className="mb-4 h-12 w-12 text-slate-600" />
        <p className="text-slate-400">{t('noInstallments')}</p>
      </div>
    );
  }

  const activeInstallments = installments.filter((i) => i.isActive);

  return (
    <div className="space-y-6">
      {/* Future projections summary */}
      {monthlyProjections.length > 0 && (
        <Card className="border-slate-700/50 bg-slate-800/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <CalendarClock className="h-4 w-4 text-amber-400" />
              Future Installment Projections
              <span className="ml-auto text-xs text-slate-500">
                Total: {formatCurrency(Math.round(totalFutureAmount * 100) / 100, currency)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {monthlyProjections.slice(0, 12).map((proj) => (
                <div
                  key={proj.month}
                  className="flex flex-col items-center rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-2"
                >
                  <span className="text-xs text-slate-400">{proj.label}</span>
                  <span className="text-sm font-semibold text-amber-400">
                    {formatCurrency(proj.amount, currency)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active installments table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="pb-3 text-left text-xs font-medium text-slate-400">Description</th>
              <th className="pb-3 text-left text-xs font-medium text-slate-400">Card</th>
              <th className="pb-3 text-right text-xs font-medium text-slate-400">{t('installment.amount')}</th>
              <th className="pb-3 text-center text-xs font-medium text-slate-400">{t('installment.progress')}</th>
              <th className="pb-3 text-right text-xs font-medium text-slate-400">{t('installment.total')}</th>
              <th className="pb-3 text-right text-xs font-medium text-slate-400">{t('installment.remaining')}</th>
              <th className="pb-3 text-right text-xs font-medium text-slate-400">{t('installment.endsOn')}</th>
            </tr>
          </thead>
          <tbody>
            {activeInstallments.map((inst) => {
              const remaining = inst.totalInstallments - inst.paidInstallments;
              const progress = (inst.paidInstallments / inst.totalInstallments) * 100;
              const endDate = addMonths(new Date(inst.startDate), inst.totalInstallments - 1);

              return (
                <tr key={inst.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                  <td className="py-3">
                    <p className="text-sm font-medium text-white">{inst.description}</p>
                  </td>
                  <td className="py-3">
                    {inst.creditCard && (
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: inst.creditCard.color }}
                        />
                        <span className="text-xs text-slate-400">
                          ****{inst.creditCard.lastFourDigits}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right text-sm text-white">
                    {formatCurrency(inst.installmentAmount, currency)}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">
                        {inst.paidInstallments}/{inst.totalInstallments}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-right text-sm text-slate-300">
                    {formatCurrency(inst.totalAmount, currency)}
                  </td>
                  <td className="py-3 text-right text-sm text-slate-300">
                    {formatCurrency(Math.round(remaining * inst.installmentAmount * 100) / 100, currency)}
                  </td>
                  <td className="py-3 text-right text-sm text-slate-400">
                    {format(endDate, 'MMM yyyy')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Completed installments */}
      {installments.length > activeInstallments.length && (
        <div className="pt-4">
          <p className="mb-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
            Completed
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {installments
                  .filter((i) => !i.isActive)
                  .map((inst) => (
                    <tr key={inst.id} className="border-b border-slate-800/30">
                      <td className="py-2 text-sm text-slate-500">{inst.description}</td>
                      <td className="py-2 text-right text-sm text-slate-500">
                        {inst.totalInstallments}/{inst.totalInstallments}
                      </td>
                      <td className="py-2 text-right text-sm text-slate-500">
                        {formatCurrency(inst.totalAmount, currency)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
