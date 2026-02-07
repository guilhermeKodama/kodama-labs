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
  createInvestmentAccountSchema,
  type CreateInvestmentAccountFormData,
} from '@/lib/validations';
import { useSettingsStore, useBusinessStore } from '@/lib/store';
import type { InvestmentAccount } from '@/types';

interface InvestmentAccountFormProps {
  account?: InvestmentAccount;
  onSubmit: (data: CreateInvestmentAccountFormData) => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function InvestmentAccountForm({
  account,
  onSubmit,
  onCancel,
  isLoading,
}: InvestmentAccountFormProps) {
  const t = useTranslations('investments.accounts');
  const tNav = useTranslations('nav');
  const { settings, currencies, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const form = useForm<CreateInvestmentAccountFormData>({
    resolver: zodResolver(createInvestmentAccountSchema),
    defaultValues: {
      name: account?.name || '',
      broker: account?.broker || '',
      entityId: account?.entityId || personalAccount?.id || '',
      entityType: account?.entityType || 'personal',
      currency: account?.currency || settings.baseCurrency,
    },
  });

  // When entity selection changes, auto-set the entityType
  const selectedEntityId = form.watch('entityId');
  useEffect(() => {
    if (!selectedEntityId) return;

    if (personalAccount && selectedEntityId === personalAccount.id) {
      form.setValue('entityType', 'personal');
    } else {
      // It's a business
      form.setValue('entityType', 'business');
    }
  }, [selectedEntityId, personalAccount, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.name')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('form.namePlaceholder')}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="broker"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.broker')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('form.brokerPlaceholder')}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="entityId"
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
                  {personalAccount && (
                    <SelectItem
                      value={personalAccount.id}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {tNav('personal')}
                    </SelectItem>
                  )}
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
            {account ? t('form.update') : t('form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
