'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore } from '@/lib/store';
import { COMMON_CURRENCIES } from '@/lib/utils/currency';

interface OnboardingDialogProps {
  open: boolean;
  onComplete: () => void;
}

const popularCurrencies = ['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'];

export function OnboardingDialog({ open, onComplete }: OnboardingDialogProps) {
  const t = useTranslations('onboarding');
  const { initializeApp } = useSettingsStore();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('BRL');

  const handleNext = () => {
    if (step === 1 && name.trim()) {
      setStep(2);
    } else if (step === 2) {
      initializeApp(baseCurrency, name.trim());
      onComplete();
    }
  };

  const isNextDisabled = step === 1 && !name.trim();

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="border-slate-800 bg-slate-900 sm:max-w-md [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500">
            <TrendingUp className="h-7 w-7 text-white" />
          </div>
          <DialogTitle className="text-xl text-white">
            {step === 1 ? t('welcome') : t('currencyTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {step === 1 ? t('welcomeDescription') : t('currencyDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 space-y-4">
          {step === 1 ? (
            <div className="space-y-2">
              <Label htmlFor="name" className="text-slate-300">
                {t('nameLabel')}
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    handleNext();
                  }
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="currency" className="text-slate-300">
                {t('currencyLabel')}
              </Label>
              <Select value={baseCurrency} onValueChange={setBaseCurrency}>
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white focus:ring-emerald-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {/* Popular currencies first */}
                  {popularCurrencies.map((code) => {
                    const currency = COMMON_CURRENCIES.find((c) => c.code === code);
                    if (!currency) return null;
                    return (
                      <SelectItem
                        key={code}
                        value={code}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {currency.symbol} {currency.code} - {currency.name}
                      </SelectItem>
                    );
                  })}
                  {/* Separator */}
                  <div className="my-2 border-t border-slate-700" />
                  {/* Other currencies */}
                  {COMMON_CURRENCIES.filter(
                    (c) => !popularCurrencies.includes(c.code)
                  ).map((currency) => (
                    <SelectItem
                      key={currency.code}
                      value={currency.code}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {currency.symbol} {currency.code} - {currency.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{t('currencyHint')}</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                step >= 1 ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            />
            <div
              className={`h-2 w-2 rounded-full ${
                step >= 2 ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            />
          </div>

          <Button
            onClick={handleNext}
            disabled={isNextDisabled}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600 disabled:opacity-50"
          >
            {step === 2 ? t('finish') : t('next')}
            {step === 1 && <ChevronRight className="ml-1 h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
