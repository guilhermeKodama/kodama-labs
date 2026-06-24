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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { localeForCurrency } from '@/lib/utils/format';
import type { MilestoneInput } from '@/lib/store/fire-store';

type CustomType = 'net_worth_absolute' | 'passive_income_absolute' | 'net_worth_x_expenses' | 'age';

interface FireMilestoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseCurrency: string;
  onSubmit: (milestone: MilestoneInput) => void;
}

export function FireMilestoneDialog({ open, onOpenChange, baseCurrency, onSubmit }: FireMilestoneDialogProps) {
  const t = useTranslations('fire.milestones');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{t('addCustom')}</DialogTitle>
          <DialogDescription className="text-slate-400">{t('addCustomHint')}</DialogDescription>
        </DialogHeader>
        <MilestoneForm
          baseCurrency={baseCurrency}
          onCancel={() => onOpenChange(false)}
          onSubmit={(m) => {
            onSubmit(m);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function MilestoneForm({
  baseCurrency,
  onSubmit,
  onCancel,
}: {
  baseCurrency: string;
  onSubmit: (m: MilestoneInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('fire.milestones');
  const tCommon = useTranslations('common');
  const moneyLocale = localeForCurrency(baseCurrency);

  const [name, setName] = useState('');
  const [type, setType] = useState<CustomType>('net_worth_absolute');
  const [money, setMoney] = useState(0);
  const [plain, setPlain] = useState('25');

  const isMoney = type === 'net_worth_absolute' || type === 'passive_income_absolute';

  const submit = () => {
    const value = isMoney ? money : Number(plain) || 0;
    onSubmit({ id: crypto.randomUUID(), name: name.trim() || t(`type_${type}`), type, value });
  };

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <Label className="text-slate-300">{t('milestoneName')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(`type_${type}`)}
            className="border-slate-700 bg-slate-950 text-white"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-slate-300">{t('criteria')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as CustomType)}>
            <SelectTrigger className="w-full border-slate-700 bg-slate-950 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="net_worth_absolute">{t('type_net_worth_absolute')}</SelectItem>
              <SelectItem value="passive_income_absolute">{t('type_passive_income_absolute')}</SelectItem>
              <SelectItem value="net_worth_x_expenses">{t('type_net_worth_x_expenses')}</SelectItem>
              <SelectItem value="age">{t('type_age')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-slate-300">{t('value')}</Label>
          {isMoney ? (
            <CurrencyInput
              value={money}
              onChange={setMoney}
              locale={moneyLocale}
              className="border-slate-700 bg-slate-950 text-white"
            />
          ) : (
            <Input
              type="number"
              value={plain}
              onChange={(e) => setPlain(e.target.value)}
              className="border-slate-700 bg-slate-950 text-white"
            />
          )}
          <p className="text-xs text-slate-500">{t(`valueHint_${type}`)}</p>
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
