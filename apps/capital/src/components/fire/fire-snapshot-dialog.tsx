'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  onSubmit: (period: number, currentInvested: number) => void;
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

export function FireSnapshotDialog({ open, onOpenChange, baseCurrency, initial, onSubmit }: FireSnapshotDialogProps) {
  const t = useTranslations('fire.history');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">{initial ? t('editSnapshot') : t('addSnapshot')}</DialogTitle>
          <DialogDescription className="text-slate-400">{t('snapshotDialogHint')}</DialogDescription>
        </DialogHeader>
        <SnapshotForm
          baseCurrency={baseCurrency}
          initial={initial}
          onCancel={() => onOpenChange(false)}
          onSubmit={(p, v) => {
            onSubmit(p, v);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SnapshotForm({
  baseCurrency,
  initial,
  onSubmit,
  onCancel,
}: {
  baseCurrency: string;
  initial: SnapshotEdit | null;
  onSubmit: (period: number, currentInvested: number) => void;
  onCancel: () => void;
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
          className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
        >
          {tCommon('save')}
        </Button>
      </DialogFooter>
    </>
  );
}
