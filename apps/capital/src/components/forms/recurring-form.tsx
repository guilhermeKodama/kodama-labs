'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { parseInputDateUTC, formatInputDateUTC } from '@/lib/utils/date';
import { Zap, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
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
import { Switch } from '@/components/ui/switch';
import {
  createRecurringTransactionSchema,
  type CreateRecurringTransactionFormData,
} from '@/lib/validations';
import { useSettingsStore, useBusinessStore } from '@/lib/store';
import type { RecurringTransaction, TransactionType, EntityType, RecurrenceFrequency } from '@/types';
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from '@/types';

interface RecurringFormProps {
  recurring?: RecurringTransaction;
  onSubmit: (data: CreateRecurringTransactionFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
  defaultEntityId?: string;
  defaultEntityType?: EntityType;
}

export function RecurringForm({
  recurring,
  onSubmit,
  onCancel,
  isLoading,
  defaultEntityId,
  defaultEntityType,
}: RecurringFormProps) {
  const t = useTranslations('recurring');
  const tCommon = useTranslations('common');
  const tTransactions = useTranslations('transactions');
  const locale = useLocale();
  const { settings, currencies, categories, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const form = useForm<CreateRecurringTransactionFormData>({
    resolver: zodResolver(createRecurringTransactionSchema),
    defaultValues: {
      entityId: recurring?.entityId || defaultEntityId || personalAccount?.id || '',
      entityType: recurring?.entityType || defaultEntityType || 'personal',
      type: recurring?.type || 'expense',
      amount: recurring?.amount || 0,
      currency: recurring?.currency || settings.baseCurrency,
      exchangeRate: recurring?.exchangeRate || 1,
      description: recurring?.description || '',
      category: recurring?.category || '',
      frequency: recurring?.frequency || 'monthly',
      startDate: recurring?.startDate ? new Date(recurring.startDate) : new Date(),
      endDate: recurring?.endDate ? new Date(recurring.endDate) : undefined,
      autoGenerateTransaction: recurring?.autoGenerateTransaction ?? true,
    },
  });

  const selectedType = form.watch('type');
  const selectedCurrency = form.watch('currency');
  const selectedEntityType = form.watch('entityType');
  const hasEndDate = form.watch('endDate') !== undefined && form.watch('endDate') !== null;
  const isAutoMode = form.watch('autoGenerateTransaction');

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

  // Auto-update exchange rate when currency changes
  useEffect(() => {
    if (selectedCurrency === settings.baseCurrency) {
      form.setValue('exchangeRate', 1);
    } else {
      const currency = currencies.find((c) => c.code === selectedCurrency);
      if (currency) {
        form.setValue('exchangeRate', currency.manualRate);
      }
    }
  }, [selectedCurrency, currencies, settings.baseCurrency, form]);

  // Update entity when entity type changes
  useEffect(() => {
    if (selectedEntityType === 'personal' && personalAccount) {
      form.setValue('entityId', personalAccount.id);
    } else if (selectedEntityType === 'business' && businesses.length > 0) {
      form.setValue('entityId', businesses[0].id);
    }
  }, [selectedEntityType, personalAccount, businesses, form]);

  const getCategoriesForType = (type: TransactionType) => {
    const customCategories = categories
      .filter((c) => c.type === type)
      .map((c) => c.name);

    if (customCategories.length > 0) {
      return customCategories;
    }

    switch (type) {
      case 'income':
        return DEFAULT_INCOME_CATEGORIES;
      case 'expense':
        return DEFAULT_EXPENSE_CATEGORIES;
      case 'investment':
        return DEFAULT_INVESTMENT_CATEGORIES;
    }
  };

  const categoryOptions = getCategoriesForType(selectedType);
  const showExchangeRate = selectedCurrency !== settings.baseCurrency;

  const frequencyOptions: RecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Mode: this decides the whole behavior, so it leads the form */}
        <FormField
          control={form.control}
          name="autoGenerateTransaction"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <FormLabel className="text-slate-300">{t('form.mode.label')}</FormLabel>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => field.onChange(true)}
                  aria-pressed={field.value}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                    field.value
                      ? 'border-cyan-500 bg-cyan-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <Zap className="h-4 w-4 shrink-0 text-cyan-400" />
                    {t('form.mode.auto.title')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t('form.mode.auto.description')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => field.onChange(false)}
                  aria-pressed={!field.value}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                    !field.value
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <Bell className="h-4 w-4 shrink-0 text-purple-400" />
                    {t('form.mode.reminder.title')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t('form.mode.reminder.description')}
                  </span>
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Entity Selection */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="entityType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.entityType')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    <SelectItem
                      value="personal"
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {tCommon('personal')}
                    </SelectItem>
                    <SelectItem
                      value="business"
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {tCommon('business')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedEntityType === 'business' && (
            <FormField
              control={form.control}
              name="entityId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('form.business')}</FormLabel>
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
          )}
        </div>

        {/* Transaction Type */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{tTransactions('form.type')}</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  form.setValue('category', '');
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem
                    value="income"
                    className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
                  >
                    {tTransactions('types.income')}
                  </SelectItem>
                  <SelectItem
                    value="expense"
                    className="text-red-400 focus:bg-slate-800 focus:text-red-400"
                  >
                    {tTransactions('types.expense')}
                  </SelectItem>
                  <SelectItem
                    value="investment"
                    className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
                  >
                    {tTransactions('types.investment')}
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
              <FormLabel className="text-slate-300">{tTransactions('form.description')}</FormLabel>
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

        {/* Amount and Currency */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">
                  {isAutoMode ? tTransactions('form.amount') : t('form.estimatedAmount')}
                </FormLabel>
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
                <FormLabel className="text-slate-300">{tTransactions('form.currency')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
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

        {/* Exchange Rate */}
        {showExchangeRate && (
          <FormField
            control={form.control}
            name="exchangeRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">
                  {tTransactions('form.exchangeRate')} (1 {settings.baseCurrency} = ? {selectedCurrency})
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

        {/* Category */}
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{tTransactions('form.category')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={tTransactions('form.categoryPlaceholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {categoryOptions.map((category) => (
                    <SelectItem
                      key={category}
                      value={category}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

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
                  {frequencyOptions.map((freq) => (
                    <SelectItem
                      key={freq}
                      value={freq}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {t(`frequencies.${freq}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  value={formatInputDateUTC(field.value instanceof Date ? field.value : null)}
                  onChange={(e) => {
                    const parsed = parseInputDateUTC(e.target.value);
                    if (parsed) field.onChange(parsed);
                  }}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* End Date Toggle and Field */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={hasEndDate}
              onCheckedChange={(checked: boolean) => {
                form.setValue('endDate', checked ? new Date() : undefined);
              }}
            />
            <span className="text-sm text-slate-300">{t('form.hasEndDate')}</span>
          </div>

          {hasEndDate && (
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
                        formatInputDateUTC(field.value instanceof Date ? field.value : null)
                      }
                      onChange={(e) => {
                        const parsed = parseInputDateUTC(e.target.value);
                        if (parsed) field.onChange(parsed);
                      }}
                      className="border-slate-700 bg-slate-800 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

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
            disabled={isLoading}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {recurring ? tCommon('save') : tCommon('create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
