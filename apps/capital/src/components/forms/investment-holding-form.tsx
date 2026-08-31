'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
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
import {
  createInvestmentHoldingSchema,
  type CreateInvestmentHoldingFormData,
} from '@/lib/validations';
import { useSettingsStore, useInvestmentStore } from '@/lib/store';
import { parseInputDate, formatInputDate } from '@/lib/utils/date';
import type {
  InvestmentHolding,
  AssetClass,
} from '@/types';
import { TICKER_ASSET_CLASSES } from '@/types';

const ASSET_CLASSES: AssetClass[] = [
  'stocks', 'fii', 'etf', 'bdr', 'fixed_income', 'crypto',
  'savings', 'international_stocks', 'international_etf',
];

const FIXED_INCOME_SUB_TYPES = [
  'cdb', 'rdb', 'lci', 'lca', 'cdi', 'tesouro_selic',
  'tesouro_ipca', 'tesouro_prefixado', 'debenture',
] as const;

interface InvestmentHoldingFormProps {
  holding?: InvestmentHolding;
  defaultAccountId?: string;
  onSubmit: (data: CreateInvestmentHoldingFormData) => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function InvestmentHoldingForm({
  holding,
  defaultAccountId,
  onSubmit,
  onCancel,
  isLoading,
}: InvestmentHoldingFormProps) {
  const t = useTranslations('investments');
  const locale = useLocale();
  const { settings, currencies } = useSettingsStore();
  const { accounts } = useInvestmentStore();

  const isEditing = !!holding;

  const form = useForm<CreateInvestmentHoldingFormData>({
    resolver: zodResolver(createInvestmentHoldingSchema),
    defaultValues: {
      accountId: holding?.accountId || defaultAccountId || '',
      assetClass: holding?.assetClass || 'stocks',
      subType: holding?.subType || undefined,
      ticker: holding?.ticker || '',
      name: holding?.name || '',
      currency: holding?.currency || settings.baseCurrency,
      // Initial position defaults
      initialAmount: undefined,
      initialQuantity: undefined,
      initialPricePerUnit: undefined,
      initialDate: new Date(),
    },
  });

  const selectedAssetClass = form.watch('assetClass');
  const showTicker = TICKER_ASSET_CLASSES.includes(selectedAssetClass);
  const showSubType = selectedAssetClass === 'fixed_income';
  const isTickerAsset = TICKER_ASSET_CLASSES.includes(selectedAssetClass);

  // Watch initial position fields for auto-calculation
  const initialQuantity = form.watch('initialQuantity');
  const initialPricePerUnit = form.watch('initialPricePerUnit');

  // Reset subType when asset class changes away from fixed_income
  useEffect(() => {
    if (selectedAssetClass !== 'fixed_income') {
      form.setValue('subType', undefined);
    }
  }, [selectedAssetClass, form]);

  // Auto-calculate totalAmount from quantity * pricePerUnit for ticker assets
  useEffect(() => {
    if (isTickerAsset && initialQuantity && initialPricePerUnit && initialQuantity > 0 && initialPricePerUnit > 0) {
      form.setValue('initialAmount', initialQuantity * initialPricePerUnit);
    }
  }, [initialQuantity, initialPricePerUnit, isTickerAsset, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="accountId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('holdings.form.account')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={t('holdings.form.accountPlaceholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {accounts.map((acc) => (
                    <SelectItem
                      key={acc.id}
                      value={acc.id}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {acc.name} {acc.broker ? `(${acc.broker})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="assetClass"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('holdings.form.assetClass')}</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('holdings.form.assetClassPlaceholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {ASSET_CLASSES.map((ac) => (
                      <SelectItem
                        key={ac}
                        value={ac}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {t(`assetClasses.${ac}`)}
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
                <FormLabel className="text-slate-300">{t('holdings.form.currency')}</FormLabel>
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

        {showSubType && (
          <FormField
            control={form.control}
            name="subType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('holdings.form.subType')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ''}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('holdings.form.subTypePlaceholder')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {FIXED_INCOME_SUB_TYPES.map((st) => (
                      <SelectItem
                        key={st}
                        value={st}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {t(`fixedIncomeSubTypes.${st}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {showTicker && (
          <FormField
            control={form.control}
            name="ticker"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('holdings.form.ticker')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('holdings.form.tickerPlaceholder')}
                    className="border-slate-700 bg-slate-800 text-white uppercase placeholder:text-slate-500"
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('holdings.form.name')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('holdings.form.namePlaceholder')}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Initial Position Section - only shown on creation */}
        {!isEditing && (
          <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4 space-y-4">
            <div>
              <h4 className="text-sm font-medium text-slate-200">
                {t('holdings.form.initialPosition')}
              </h4>
              <p className="text-xs text-slate-500">
                {t('holdings.form.initialPositionHint')}
              </p>
            </div>

            {isTickerAsset ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="initialQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">
                          {t('holdings.form.initialQuantity')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            placeholder={t('holdings.form.initialQuantityPlaceholder')}
                            value={field.value ?? ''}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value ? parseFloat(e.target.value) : undefined
                              )
                            }
                            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="initialPricePerUnit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">
                          {t('holdings.form.initialPricePerUnit')}
                        </FormLabel>
                        <FormControl>
                          <CurrencyInput
                            value={field.value ?? 0}
                            onChange={field.onChange}
                            locale={locale}
                            className="border-slate-700 bg-slate-800 text-white"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="initialAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-slate-300">
                        {t('holdings.form.initialAmount')}
                      </FormLabel>
                      <FormControl>
                        <CurrencyInput
                          value={field.value ?? 0}
                          onChange={field.onChange}
                          locale={locale}
                          className="border-slate-700 bg-slate-800 text-white"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <FormField
                control={form.control}
                name="initialAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-300">
                      {t('holdings.form.initialAmount')}
                    </FormLabel>
                    <FormControl>
                      <CurrencyInput
                        value={field.value ?? 0}
                        onChange={field.onChange}
                        locale={locale}
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
              name="initialDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">
                    {t('holdings.form.initialDate')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={formatInputDate(field.value instanceof Date ? field.value : null)}
                      onChange={(e) => {
                        const parsed = parseInputDate(e.target.value);
                        field.onChange(parsed ?? undefined);
                      }}
                      className="border-slate-700 bg-slate-800 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {t('holdings.form.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {holding ? t('holdings.form.update') : t('holdings.form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
