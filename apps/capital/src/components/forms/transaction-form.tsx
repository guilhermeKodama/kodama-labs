'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createTransactionSchema, type CreateTransactionFormData } from '@/lib/validations';
import { useSettingsStore } from '@/lib/store';
import type { Transaction, TransactionType, EntityType } from '@/types';
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from '@/types';

interface TransactionFormProps {
  entityId: string;
  entityType: EntityType;
  transaction?: Transaction;
  onSubmit: (data: CreateTransactionFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
  defaultType?: TransactionType;
}

export function TransactionForm({
  entityId,
  entityType,
  transaction,
  onSubmit,
  onCancel,
  isLoading,
  defaultType = 'income',
}: TransactionFormProps) {
  const t = useTranslations('transactions');
  const { settings, currencies, categories } = useSettingsStore();

  const form = useForm<CreateTransactionFormData>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      entityId,
      entityType,
      type: transaction?.type || defaultType,
      amount: transaction?.amount || 0,
      currency: transaction?.currency || settings.baseCurrency,
      exchangeRate: transaction?.exchangeRate || 1,
      description: transaction?.description || '',
      category: transaction?.category || '',
      date: transaction?.date ? new Date(transaction.date) : new Date(),
    },
  });

  const selectedType = form.watch('type');
  const selectedCurrency = form.watch('currency');

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

  const getCategoriesForType = (type: TransactionType) => {
    // First check custom categories from store
    const customCategories = categories
      .filter((c) => c.type === type)
      .map((c) => c.name);
    
    if (customCategories.length > 0) {
      return customCategories;
    }
    
    // Fall back to defaults
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.type')}</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  form.setValue('category', ''); // Reset category when type changes
                }}
                defaultValue={field.value}
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
                    {t('types.income')}
                  </SelectItem>
                  <SelectItem
                    value="expense"
                    className="text-red-400 focus:bg-slate-800 focus:text-red-400"
                  >
                    {t('types.expense')}
                  </SelectItem>
                  <SelectItem
                    value="investment"
                    className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
                  >
                    {t('types.investment')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">
                {t('form.description')}
              </FormLabel>
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

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">
                  {t('form.amount')}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="0.01"
                    min="0"
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
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
                <FormLabel className="text-slate-300">
                  {t('form.currency')}
                </FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
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

        {/* Exchange Rate - shown when currency differs from base */}
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
                <p className="text-xs text-slate-500">
                  {t('form.exchangeRateHint', {
                    amount: form.watch('amount') || 0,
                    currency: selectedCurrency,
                    converted: ((form.watch('amount') || 0) * (field.value || 1)).toFixed(2),
                    baseCurrency: settings.baseCurrency,
                  })}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">
                {t('form.category')}
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={t('form.categoryPlaceholder')} />
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

        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.date')}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={
                    field.value instanceof Date
                      ? field.value.toISOString().split('T')[0]
                      : ''
                  }
                  onChange={(e) => field.onChange(new Date(e.target.value))}
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
            onClick={onCancel}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {t('form.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {transaction ? t('form.update') : t('form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
