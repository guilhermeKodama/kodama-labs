'use client';

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
import { createBusinessSchema, type CreateBusinessFormData } from '@/lib/validations';
import { COMMON_CURRENCIES } from '@/lib/utils/currency';
import { useSettingsStore } from '@/lib/store';
import type { Business } from '@/types';

const COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

interface BusinessFormProps {
  business?: Business;
  onSubmit: (data: CreateBusinessFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function BusinessForm({
  business,
  onSubmit,
  onCancel,
  isLoading,
}: BusinessFormProps) {
  const t = useTranslations('businesses');
  const { settings } = useSettingsStore();

  const form = useForm<CreateBusinessFormData>({
    resolver: zodResolver(createBusinessSchema),
    defaultValues: {
      name: business?.name || '',
      description: business?.description || '',
      defaultCurrency: business?.defaultCurrency || settings.baseCurrency,
      color: business?.color || COLORS[0],
    },
  });

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

        <FormField
          control={form.control}
          name="defaultCurrency"
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
                  {COMMON_CURRENCIES.map((currency) => (
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
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="color"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.color')}</FormLabel>
              <FormControl>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => field.onChange(color)}
                      className={`h-8 w-8 rounded-full transition-all ${
                        field.value === color
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
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
            {business ? t('form.update') : t('form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
