'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
import { localeForCurrency } from '@/lib/utils/format';

export interface SnapshotEdit {
  period: number;
  currentInvested: number;
}

interface FireSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseCurrency: string;
  initial: SnapshotEdit | null;
  onSubmit: (period: number, currentInvested: number) => Promise<unknown>;
  isLoading?: boolean;
}

const periodToMonthValue = (period: number) => {
  const y = Math.floor(period / 100);
  const m = period % 100;
  return `${y}-${String(m).padStart(2, '0')}`;
};
const monthValueToPeriod = (v: string): number | null => {
  const [y, m] = v.split('-').map(Number);
  return y && m ? y * 100 + m : null;
};

export function FireSnapshotDialog({
  open,
  onOpenChange,
  baseCurrency,
  initial,
  onSubmit,
  isLoading,
}: FireSnapshotDialogProps) {
  const t = useTranslations('fire.history');
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t('editSnapshot') : t('addSnapshot')}
      description={t('snapshotDialogHint')}
      className="sm:max-w-sm"
    >
      <SnapshotForm
        baseCurrency={baseCurrency}
        initial={initial}
        onCancel={() => onOpenChange(false)}
        onSubmit={onSubmit}
        isLoading={isLoading}
      />
    </FormDialog>
  );
}

function SnapshotForm({
  baseCurrency,
  initial,
  onSubmit,
  onCancel,
  isLoading,
}: {
  baseCurrency: string;
  initial: SnapshotEdit | null;
  onSubmit: (period: number, currentInvested: number) => Promise<unknown>;
  onCancel: () => void;
  isLoading?: boolean;
}) {
  const t = useTranslations('fire.history');
  const tCommon = useTranslations('common');
  const moneyLocale = localeForCurrency(baseCurrency);
  const now = new Date();

  const [month, setMonth] = useState(() =>
    initial
      ? periodToMonthValue(initial.period)
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );
  const [invested, setInvested] = useState<number>(() => initial?.currentInvested ?? 0);

  const submit = () => {
    const period = monthValueToPeriod(month);
    if (period == null) return;
    onSubmit(period, invested);
  };

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <Label className="text-slate-300">{t('month')}</Label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={!!initial}
            className="border-slate-700 bg-slate-950 text-white"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-slate-300">{t('investedAmount')}</Label>
          <CurrencyInput
            value={invested}
            onChange={setInvested}
            locale={moneyLocale}
            className="border-slate-700 bg-slate-950 text-white"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={onCancel}
          className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          {tCommon('cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={isLoading}
          className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
        >
          {isLoading ? tCommon('loading') : tCommon('save')}
        </Button>
      </DialogFooter>
    </>
  );
}
