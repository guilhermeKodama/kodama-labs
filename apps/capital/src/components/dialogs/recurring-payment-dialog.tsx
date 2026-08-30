'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
import { formatInputDateUTC, parseInputDateUTC } from '@/lib/utils/date';
import { formatCurrency } from '@/lib/utils/format';
import type { RecurringTransaction } from '@/types';

interface RecurringPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recurring?: RecurringTransaction;
  onSubmit: (values: { amount: number; date: Date }) => void;
  isLoading?: boolean;
}

/**
 * Confirms a reminder-mode recurring entry. The stored amount is only an
 * estimate, so this asks for the real value (and the real payment date) before
 * booking the transaction. Auto-mode entries never reach this dialog — they
 * settle in one click with the saved amount.
 */
export function RecurringPaymentDialog({
  open,
  onOpenChange,
  recurring,
  onSubmit,
  isLoading,
}: RecurringPaymentDialogProps) {
  const t = useTranslations('recurring');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState<Date | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Re-seed from the recurring each time the dialog opens for a new entry.
  // Adjusting state during render (rather than in an effect) is React's
  // documented pattern for deriving state from props, and avoids the
  // cascading-render lint rule this codebase enforces.
  const seedKey = open && recurring ? recurring.id : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    if (recurring && seedKey) {
      setAmount(recurring.amount);
      setDate(new Date(recurring.nextDueDate));
    }
  }

  if (!recurring) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || amount <= 0) return;
    onSubmit({ amount, date });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('payment.title')}
      description={t('payment.description', { description: recurring.description })}
      className="sm:max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{recurring.category}</span>
            <span className="text-slate-500">
              {t('payment.estimateHint', {
                amount: formatCurrency(recurring.amount, recurring.currency),
              })}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">{t('payment.amountLabel')}</Label>
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            locale={locale}
            className="border-slate-700 bg-slate-800 text-white"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-slate-300">{t('payment.dateLabel')}</Label>
          <Input
            type="date"
            value={formatInputDateUTC(date)}
            onChange={(e) => {
              const parsed = parseInputDateUTC(e.target.value);
              if (parsed) setDate(parsed);
            }}
            className="border-slate-700 bg-slate-800 text-white"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isLoading || amount <= 0 || !date}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {isLoading ? tCommon('loading') : t('payment.confirm')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
