'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { ArrowRight, Wallet, Building2, User } from 'lucide-react';
import { z } from 'zod';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore } from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import { parseInputDate, formatInputDate } from '@/lib/utils/date';
import type { InvestmentAccount } from '@/types';

const fundWithdrawSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  currency: z.string().min(1),
  exchangeRate: z.number().min(0).optional(),
  description: z.string().optional(),
  date: z.date(),
});

type FundWithdrawFormData = z.infer<typeof fundWithdrawSchema>;

interface FundWithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: InvestmentAccount | null;
  mode: 'fund' | 'withdraw';
  onSubmit: (accountId: string, data: {
    amount: number;
    currency: string;
    exchangeRate?: number;
    description?: string;
    date: Date;
  }) => Promise<boolean>;
  isLoading?: boolean;
}

export function FundWithdrawDialog({
  open,
  onOpenChange,
  account,
  mode,
  onSubmit,
  isLoading,
}: FundWithdrawDialogProps) {
  const t = useTranslations('investments');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { settings, currencies } = useSettingsStore();

  const form = useForm<FundWithdrawFormData>({
    resolver: zodResolver(fundWithdrawSchema),
    defaultValues: {
      amount: 0,
      currency: account?.currency || settings.baseCurrency,
      exchangeRate: 1,
      description: '',
      date: new Date(),
    },
  });

  // Reset form when dialog opens with new account
  useEffect(() => {
    if (open && account) {
      form.reset({
        amount: 0,
        currency: account.currency || settings.baseCurrency,
        exchangeRate: 1,
        description: '',
        date: new Date(),
      });
    }
  }, [open, account, settings.baseCurrency, form]);

  const selectedCurrency = form.watch('currency');
  const showExchangeRate = selectedCurrency !== settings.baseCurrency;

  // Auto-update exchange rate when currency changes
  useEffect(() => {
    if (selectedCurrency === settings.baseCurrency) {
      form.setValue('exchangeRate', 1);
    } else {
      const currency = currencies.find((c) => c.code === selectedCurrency);
      if (currency && currency.manualRate > 0) {
        form.setValue('exchangeRate', Math.round((1 / currency.manualRate) * 1000000) / 1000000);
      }
    }
  }, [selectedCurrency, currencies, settings.baseCurrency, form]);

  // Closing on success is owned by the caller (via the `onOpenChange` it
  // wires into its own useDialogForm hook) — this only forwards the submit.
  const handleSubmit = async (data: FundWithdrawFormData) => {
    if (!account) return;
    await onSubmit(account.id, {
      amount: data.amount,
      currency: data.currency,
      exchangeRate: data.exchangeRate,
      description: data.description,
      date: data.date,
    });
  };

  if (!account) return null;

  const isFund = mode === 'fund';

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isFund ? t('fund.title') : t('withdraw.title')}
      description={isFund ? t('fund.description') : t('withdraw.description')}
      className="sm:max-w-md"
    >
      {/* Transfer visualization */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 text-center">
            <div className="mb-1 flex items-center justify-center gap-1">
              {account.entityType === 'personal' ? (
                <User className="h-4 w-4 text-slate-400" />
              ) : (
                <Building2 className="h-4 w-4 text-slate-400" />
              )}
              <span className="text-xs text-slate-400">
                {isFund ? t('fund.from') : t('withdraw.to')}
              </span>
            </div>
            <p className="text-sm font-medium text-white">
              {isFund ? (account.entityType === 'personal' ? tCommon('personal') : t('fund.checkingAccount')) : account.name}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-500" />
          <div className="flex-1 text-center">
            <div className="mb-1 flex items-center justify-center gap-1">
              <Wallet className="h-4 w-4 text-slate-400" />
              <span className="text-xs text-slate-400">
                {isFund ? t('fund.to') : t('withdraw.from')}
              </span>
            </div>
            <p className="text-sm font-medium text-white">
              {isFund ? account.name : (account.entityType === 'personal' ? tCommon('personal') : t('withdraw.checkingAccount'))}
            </p>
          </div>
        </div>

        {/* Show current cash balance */}
        <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-600 bg-slate-700/30 px-3 py-2">
          <Wallet className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-400">{t('accounts.cashBalance')}:</span>
          <span className="text-sm font-semibold text-emerald-400">
            {formatCurrency(account.cashBalance, account.currency)}
          </span>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('fund.amount')}</FormLabel>
                  <FormControl>
                    <CurrencyInput
                      value={field.value}
                      onChange={field.onChange}
                      locale={locale}
                      className="border-slate-700 bg-slate-800 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('fund.currency')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-slate-700 bg-slate-900">
                      {currencies.map((c) => (
                        <SelectItem
                          key={c.code}
                          value={c.code}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          {c.symbol} {c.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {showExchangeRate && (
            <FormField
              control={form.control}
              name="exchangeRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">
                    {t('fund.exchangeRate')} (1 {selectedCurrency} = ? {settings.baseCurrency})
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.000001"
                      min="0"
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
                      className="border-slate-700 bg-slate-800 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('fund.descriptionLabel')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('fund.descriptionPlaceholder')}
                    className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('fund.date')}</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    value={formatInputDate(field.value instanceof Date ? field.value : null)}
                    onChange={(e) => {
                      const parsed = parseInputDate(e.target.value);
                      if (parsed) field.onChange(parsed);
                    }}
                    className="border-slate-700 bg-slate-800 text-white"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end gap-2 pt-4">
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
              disabled={isLoading}
              className={
                isFund
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600'
              }
            >
              {isFund ? t('fund.submit') : t('withdraw.submit')}
            </Button>
          </div>
        </form>
      </Form>
    </FormDialog>
  );
}
