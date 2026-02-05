'use client';

import { useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { ArrowRight, Wallet } from 'lucide-react';
import { z } from 'zod';
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
import { useSettingsStore, useBusinessStore, useTransactionStore, useTransferStore } from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { formatCurrency } from '@/lib/utils/format';
import type { RecurringTransfer, TransferDirection, RecurrenceFrequency } from '@/types';

/**
 * Parse a date string from an input[type="date"] as noon UTC.
 * "2026-02-06" should be Feb 6 regardless of user timezone.
 * Using noon UTC provides a 12-hour buffer in both directions.
 */
function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Format a Date to YYYY-MM-DD for input[type="date"] using UTC date parts.
 * This ensures the displayed date matches the stored UTC date.
 */
function formatDateForInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const recurringTransferSchema = z.object({
  fromEntityId: z.string().min(1, 'Required'),
  fromEntityType: z.enum(['business', 'personal']),
  toEntityId: z.string().min(1, 'Required'),
  toEntityType: z.enum(['business', 'personal']),
  direction: z.enum(['profit_distribution', 'capital_injection', 'reimbursement']),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency is required'),
  exchangeRate: z.number().positive().optional(),
  description: z.string().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  startDate: z.date(),
  endDate: z.date().optional().nullable(),
});

export type RecurringTransferFormData = z.infer<typeof recurringTransferSchema>;

interface RecurringTransferFormProps {
  recurringTransfer?: RecurringTransfer;
  onSubmit: (data: RecurringTransferFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function RecurringTransferForm({
  recurringTransfer,
  onSubmit,
  onCancel,
  isLoading,
}: RecurringTransferFormProps) {
  const t = useTranslations('transfers.recurring');
  const tTransfers = useTranslations('transfers');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { settings, personalAccount, currencies } = useSettingsStore();
  const { businesses } = useBusinessStore();
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();

  const form = useForm<RecurringTransferFormData>({
    resolver: zodResolver(recurringTransferSchema),
    defaultValues: {
      fromEntityId: recurringTransfer?.fromEntityId || businesses[0]?.id || '',
      fromEntityType: recurringTransfer?.fromEntityType || 'business',
      toEntityId: recurringTransfer?.toEntityId || personalAccount?.id || '',
      toEntityType: recurringTransfer?.toEntityType || 'personal',
      direction: recurringTransfer?.direction || 'reimbursement',
      amount: recurringTransfer?.amount || 0,
      currency: recurringTransfer?.currency || settings.baseCurrency,
      exchangeRate: recurringTransfer?.exchangeRate || 1,
      description: recurringTransfer?.description || '',
      frequency: recurringTransfer?.frequency || 'monthly',
      startDate: recurringTransfer?.startDate ? new Date(recurringTransfer.startDate) : new Date(),
      endDate: recurringTransfer?.endDate ? new Date(recurringTransfer.endDate) : null,
    },
  });

  const selectedDirection = form.watch('direction');
  const selectedCurrency = form.watch('currency');
  const selectedFromEntityId = form.watch('fromEntityId');

  // Calculate the balance of the source entity
  const sourceEntityBalance = useMemo(() => {
    if (selectedDirection === 'reimbursement' || selectedDirection === 'profit_distribution') {
      // Source is a business
      const business = businesses.find((b) => b.id === selectedFromEntityId);
      if (!business) return null;
      
      const summary = calculateEntitySummary(
        business.id,
        'business',
        business.name,
        transactions,
        transfers,
        settings.baseCurrency
      );
      return {
        name: business.name,
        balance: summary.balance,
        currency: settings.baseCurrency,
      };
    } else {
      // Source is personal account
      if (!personalAccount) return null;
      
      const summary = calculateEntitySummary(
        personalAccount.id,
        'personal',
        tTransfers('form.personalAccount'),
        transactions,
        transfers,
        settings.baseCurrency
      );
      return {
        name: tTransfers('form.personalAccount'),
        balance: summary.balance,
        currency: settings.baseCurrency,
      };
    }
  }, [selectedDirection, selectedFromEntityId, businesses, personalAccount, transactions, transfers, settings.baseCurrency, tTransfers]);

  // Update from/to entities when direction changes
  const handleDirectionChange = (direction: TransferDirection) => {
    form.setValue('direction', direction);
    if (direction === 'profit_distribution' || direction === 'reimbursement') {
      form.setValue('fromEntityType', 'business');
      form.setValue('toEntityType', 'personal');
      form.setValue('toEntityId', personalAccount?.id || '');
      form.setValue('fromEntityId', businesses[0]?.id || '');
    } else {
      form.setValue('fromEntityType', 'personal');
      form.setValue('toEntityType', 'business');
      form.setValue('fromEntityId', personalAccount?.id || '');
      form.setValue('toEntityId', businesses[0]?.id || '');
    }
  };

  // Get exchange rate from currencies when currency changes
  const handleCurrencyChange = (currencyCode: string) => {
    form.setValue('currency', currencyCode);
    const currency = currencies.find((c) => c.code === currencyCode);
    if (currency) {
      form.setValue('exchangeRate', currency.manualRate);
    }
  };

  // Set default currency when currencies are loaded
  useEffect(() => {
    if (currencies.length > 0 && !selectedCurrency) {
      const defaultCurrency = currencies.find(c => c.code === settings.baseCurrency) 
        || currencies[0];
      if (defaultCurrency) {
        form.setValue('currency', defaultCurrency.code);
      }
    }
  }, [currencies, selectedCurrency, settings.baseCurrency, form]);

  const showExchangeRate = selectedCurrency !== settings.baseCurrency;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Direction */}
        <FormField
          control={form.control}
          name="direction"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.direction')}</FormLabel>
              <Select
                onValueChange={(value) => handleDirectionChange(value as TransferDirection)}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem
                    value="reimbursement"
                    className="text-purple-400 focus:bg-slate-800 focus:text-purple-400"
                  >
                    {tTransfers('directions.reimbursement')}
                  </SelectItem>
                  <SelectItem
                    value="profit_distribution"
                    className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
                  >
                    {tTransfers('directions.profitDistribution')}
                  </SelectItem>
                  <SelectItem
                    value="capital_injection"
                    className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
                  >
                    {tTransfers('directions.capitalInjection')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* From/To visualization */}
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between gap-4">
            {/* From Entity */}
            <div className="flex-1">
              <p className="mb-2 text-xs text-slate-400">{t('form.from')}</p>
              {selectedDirection === 'profit_distribution' || selectedDirection === 'reimbursement' ? (
                <FormField
                  control={form.control}
                  name="fromEntityId"
                  render={({ field }) => (
                    <FormItem>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                            <SelectValue placeholder={t('form.selectBusiness')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="border-slate-700 bg-slate-900">
                          {businesses.map((business) => (
                            <SelectItem
                              key={business.id}
                              value={business.id}
                              className="text-slate-300 focus:bg-slate-800 focus:text-white"
                            >
                              {business.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <div className="rounded-md border border-slate-600 bg-slate-700/50 px-3 py-2 text-white">
                  {t('form.personalAccount')}
                </div>
              )}
            </div>

            {/* Arrow */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700">
              <ArrowRight className="h-5 w-5 text-slate-400" />
            </div>

            {/* To Entity */}
            <div className="flex-1">
              <p className="mb-2 text-xs text-slate-400">{t('form.to')}</p>
              {selectedDirection === 'capital_injection' ? (
                <FormField
                  control={form.control}
                  name="toEntityId"
                  render={({ field }) => (
                    <FormItem>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                            <SelectValue placeholder={t('form.selectBusiness')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="border-slate-700 bg-slate-900">
                          {businesses.map((business) => (
                            <SelectItem
                              key={business.id}
                              value={business.id}
                              className="text-slate-300 focus:bg-slate-800 focus:text-white"
                            >
                              {business.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <div className="rounded-md border border-slate-600 bg-slate-700/50 px-3 py-2 text-white">
                  {t('form.personalAccount')}
                </div>
              )}
            </div>
          </div>

          {/* Available Balance */}
          {sourceEntityBalance && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-600 bg-slate-700/30 px-3 py-2">
              <Wallet className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-400">{tTransfers('form.availableBalance')}:</span>
              <span className={`text-sm font-semibold ${sourceEntityBalance.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(sourceEntityBalance.balance, sourceEntityBalance.currency)}
              </span>
            </div>
          )}
        </div>

        {/* Amount and Currency */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.amount')}</FormLabel>
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
                <FormLabel className="text-slate-300">{t('form.currency')}</FormLabel>
                <Select
                  onValueChange={(value) => handleCurrencyChange(value)}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('form.currency')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {currencies.map((currency) => (
                      <SelectItem
                        key={currency.code}
                        value={currency.code}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {currency.symbol} {currency.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Exchange Rate (shown when currency differs from base) */}
        {showExchangeRate && (
          <FormField
            control={form.control}
            name="exchangeRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">
                  {t('form.exchangeRate')} (1 {settings.baseCurrency} = ? {selectedCurrency})
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="0.0001"
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

        {/* Frequency */}
        <FormField
          control={form.control}
          name="frequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.frequency')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem value="daily" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('form.frequencies.daily')}
                  </SelectItem>
                  <SelectItem value="weekly" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('form.frequencies.weekly')}
                  </SelectItem>
                  <SelectItem value="monthly" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('form.frequencies.monthly')}
                  </SelectItem>
                  <SelectItem value="yearly" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('form.frequencies.yearly')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.description')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('form.descriptionPlaceholder')}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Start Date */}
        <FormField
          control={form.control}
          name="startDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.startDate')}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={
                    field.value instanceof Date
                      ? formatDateForInput(field.value)
                      : ''
                  }
                  onChange={(e) => field.onChange(parseLocalDate(e.target.value))}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* End Date (optional) */}
        <FormField
          control={form.control}
          name="endDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.endDate')}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={
                    field.value instanceof Date
                      ? formatDateForInput(field.value)
                      : ''
                  }
                  onChange={(e) => {
                    if (e.target.value) {
                      field.onChange(parseLocalDate(e.target.value));
                    } else {
                      field.onChange(null);
                    }
                  }}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isLoading || businesses.length === 0}
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
          >
            {recurringTransfer ? t('form.update') : t('form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
