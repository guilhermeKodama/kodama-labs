'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { format } from 'date-fns';
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
import type {
  InvestmentTransaction,
  InvestmentTransactionType,
} from '@/types';
import { PRICE_PER_UNIT_ASSET_CLASSES } from '@/types';

function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function formatDateForInput(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

const TRANSACTION_TYPES: InvestmentTransactionType[] = [
  'buy', 'sell', 'dividend', 'yield_payment', 'split', 'deposit', 'withdrawal',
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

  // Determine if the selected holding requires price per unit
  const selectedHolding = holdings.find((h) => h.id === selectedHoldingId);
  const showPriceFields = selectedHolding
    ? PRICE_PER_UNIT_ASSET_CLASSES.includes(selectedHolding.assetClass)
    : false;

  // Show quantity field for buy/sell/split types
  const showQuantity = ['buy', 'sell', 'split', 'deposit', 'withdrawal'].includes(selectedType);

  // Auto-calculate totalAmount from quantity * pricePerUnit
  useEffect(() => {
    if (showPriceFields && quantity && pricePerUnit && quantity > 0 && pricePerUnit > 0) {
      form.setValue('totalAmount', quantity * pricePerUnit);
    }
  }, [quantity, pricePerUnit, showPriceFields, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('transactions.form.type')}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={t('transactions.form.typePlaceholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {TRANSACTION_TYPES.map((type) => (
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

        {showQuantity && (
          <div className={showPriceFields ? 'grid grid-cols-2 gap-4' : ''}>
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

            {showPriceFields && (
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
            )}
          </div>
        )}

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

        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('transactions.form.date')}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={field.value instanceof Date ? formatDateForInput(field.value) : ''}
                  onChange={(e) => field.onChange(parseLocalDate(e.target.value))}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
