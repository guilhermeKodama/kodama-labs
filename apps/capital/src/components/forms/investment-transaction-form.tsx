'use client';

import { useEffect, useMemo } from 'react';
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
  createInvestmentTransactionSchema,
  type CreateInvestmentTransactionFormData,
} from '@/lib/validations';
import { useInvestmentStore } from '@/lib/store';
import { parseInputDate, formatInputDate } from '@/lib/utils/date';
import type {
  InvestmentTransaction,
  InvestmentTransactionType,
} from '@/types';
import { PRICE_PER_UNIT_ASSET_CLASSES } from '@/types';

// Transaction types for ticker-based assets (stocks, ETF, BDR, FII, crypto)
const TICKER_TRANSACTION_TYPES: InvestmentTransactionType[] = [
  'buy', 'sell', 'dividend', 'split',
];

// Transaction types for deposit-based assets (fixed income, savings)
const DEPOSIT_TRANSACTION_TYPES: InvestmentTransactionType[] = [
  'deposit', 'withdrawal', 'yield_payment',
];

// All types combined (when no holding is selected yet)
const ALL_TRANSACTION_TYPES: InvestmentTransactionType[] = [
  ...TICKER_TRANSACTION_TYPES, ...DEPOSIT_TRANSACTION_TYPES,
];

interface InvestmentTransactionFormProps {
  transaction?: InvestmentTransaction;
  defaultHoldingId?: string;
  onSubmit: (data: CreateInvestmentTransactionFormData) => void | Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function InvestmentTransactionForm({
  transaction,
  defaultHoldingId,
  onSubmit,
  onCancel,
  isLoading,
}: InvestmentTransactionFormProps) {
  const t = useTranslations('investments');
  const locale = useLocale();
  const { holdings } = useInvestmentStore();

  const form = useForm<CreateInvestmentTransactionFormData>({
    resolver: zodResolver(createInvestmentTransactionSchema),
    defaultValues: {
      holdingId: transaction?.holdingId || defaultHoldingId || '',
      type: transaction?.type || 'buy',
      quantity: transaction?.quantity || undefined,
      pricePerUnit: transaction?.pricePerUnit || undefined,
      totalAmount: transaction?.totalAmount || 0,
      fees: transaction?.fees || 0,
      date: transaction?.date ? new Date(transaction.date) : new Date(),
      notes: transaction?.notes || '',
    },
  });

  const selectedHoldingId = form.watch('holdingId');
  const selectedType = form.watch('type');
  const quantity = form.watch('quantity');
  const pricePerUnit = form.watch('pricePerUnit');

  // Look up the selected holding
  const selectedHolding = holdings.find((h) => h.id === selectedHoldingId);

  // Is this a ticker-based asset? (stocks, etf, crypto, etc.)
  const isTickerAsset = selectedHolding
    ? PRICE_PER_UNIT_ASSET_CLASSES.includes(selectedHolding.assetClass)
    : true; // default to ticker when no holding selected

  // Available transaction types based on asset class
  const availableTransactionTypes = useMemo(() => {
    if (!selectedHolding) return ALL_TRANSACTION_TYPES;
    return isTickerAsset ? TICKER_TRANSACTION_TYPES : DEPOSIT_TRANSACTION_TYPES;
  }, [selectedHolding, isTickerAsset]);

  // Auto-switch transaction type when holding changes to a different asset class
  useEffect(() => {
    if (selectedHolding) {
      const currentType = form.getValues('type');
      if (!availableTransactionTypes.includes(currentType)) {
        form.setValue('type', availableTransactionTypes[0]);
      }
    }
  }, [selectedHoldingId, selectedHolding, availableTransactionTypes, form]);

  // For ticker assets: show quantity + price per unit fields
  const showQuantityAndPrice = isTickerAsset && ['buy', 'sell', 'split'].includes(selectedType);

  // Auto-calculate totalAmount from quantity * pricePerUnit
  useEffect(() => {
    if (showQuantityAndPrice && quantity && pricePerUnit && quantity > 0 && pricePerUnit > 0) {
      form.setValue('totalAmount', quantity * pricePerUnit);
    }
  }, [quantity, pricePerUnit, showQuantityAndPrice, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Holding selector */}
        <FormField
          control={form.control}
          name="holdingId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('transactions.form.holding')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={t('transactions.form.holdingPlaceholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {holdings.filter((h) => h.isActive).map((h) => (
                    <SelectItem
                      key={h.id}
                      value={h.id}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {h.ticker ? `${h.ticker} - ` : ''}{h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Transaction type — filtered by asset class */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('transactions.form.type')}</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={availableTransactionTypes.includes(field.value) ? field.value : availableTransactionTypes[0]}
              >
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={t('transactions.form.typePlaceholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {availableTransactionTypes.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {t(`transactionTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Quantity + Price per Unit — only for ticker-based buy/sell/split */}
        {showQuantityAndPrice && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('transactions.form.quantity')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder={t('transactions.form.quantityPlaceholder')}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                      className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pricePerUnit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('transactions.form.pricePerUnit')}</FormLabel>
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
        )}

        {/* Total Amount + Fees — always shown */}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="totalAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('transactions.form.totalAmount')}</FormLabel>
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
            name="fees"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('transactions.form.fees')}</FormLabel>
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

        {/* Date */}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('transactions.form.date')}</FormLabel>
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

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('transactions.form.notes')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('transactions.form.notesPlaceholder')}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
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
            {t('transactions.form.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {transaction ? t('transactions.form.update') : t('transactions.form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
