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
import {
  createBudgetSchema,
  type CreateBudgetFormData,
} from '@/lib/validations';
import { useSettingsStore, useBusinessStore } from '@/lib/store';
import type { Budget, EntityType, BudgetPeriod } from '@/types';
import { DEFAULT_EXPENSE_CATEGORIES } from '@/types';

interface BudgetFormProps {
  budget?: Budget;
  onSubmit: (data: CreateBudgetFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
  defaultEntityId?: string;
  defaultEntityType?: EntityType;
}

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

export function BudgetForm({
  budget,
  onSubmit,
  onCancel,
  isLoading,
  defaultEntityId,
  defaultEntityType,
}: BudgetFormProps) {
  const t = useTranslations('budgets');
  const tCommon = useTranslations('common');
  const { settings, currencies, categories, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const form = useForm<CreateBudgetFormData>({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: {
      entityId: budget?.entityId || defaultEntityId || personalAccount?.id || '',
      entityType: budget?.entityType || defaultEntityType || 'personal',
      category: budget?.category || '',
      amount: budget?.amount || 0,
      currency: budget?.currency || settings.baseCurrency,
      period: budget?.period || 'monthly',
      year: budget?.year || currentYear,
      month: budget?.month || currentMonth,
    },
  });

  const selectedPeriod = form.watch('period');
  const selectedEntityType = form.watch('entityType');

  // Update entity when entity type changes
  useEffect(() => {
    if (selectedEntityType === 'personal' && personalAccount) {
      form.setValue('entityId', personalAccount.id);
    } else if (selectedEntityType === 'business' && businesses.length > 0) {
      form.setValue('entityId', businesses[0].id);
    }
  }, [selectedEntityType, personalAccount, businesses, form]);

  // Get expense categories
  const expenseCategories = categories
    .filter((c) => c.type === 'expense')
    .map((c) => c.name);
  const categoryOptions = expenseCategories.length > 0 ? expenseCategories : DEFAULT_EXPENSE_CATEGORIES;

  // Generate year options (5 years back and forward)
  const yearOptions = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

        {/* Category */}
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.category')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={t('form.selectCategory')} />
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

        {/* Amount and Currency */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.amount')}</FormLabel>
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
                <FormLabel className="text-slate-300">{t('form.currency')}</FormLabel>
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

        {/* Period */}
        <FormField
          control={form.control}
          name="period"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.period')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem
                    value="monthly"
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    {t('periods.monthly')}
                  </SelectItem>
                  <SelectItem
                    value="yearly"
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    {t('periods.yearly')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Year and Month */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="year"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.year')}</FormLabel>
                <Select 
                  onValueChange={(v) => field.onChange(parseInt(v))} 
                  value={field.value.toString()}
                >
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {yearOptions.map((year) => (
                      <SelectItem
                        key={year}
                        value={year.toString()}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedPeriod === 'monthly' && (
            <FormField
              control={form.control}
              name="month"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('form.month')}</FormLabel>
                  <Select 
                    onValueChange={(v) => field.onChange(parseInt(v))} 
                    value={field.value?.toString() || currentMonth.toString()}
                  >
                    <FormControl>
                      <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-slate-700 bg-slate-900">
                      {MONTHS.map((month) => (
                        <SelectItem
                          key={month.value}
                          value={month.value.toString()}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          {month.label}
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
            {budget ? tCommon('save') : tCommon('create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
