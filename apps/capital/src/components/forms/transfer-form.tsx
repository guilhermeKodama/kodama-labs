'use client';

import { useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { format } from 'date-fns';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Parse a date string from an input[type="date"] as a local date (not UTC).
 */
function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Format a Date to YYYY-MM-DD for input[type="date"]
 */
function formatDateForInput(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
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
import { createTransferSchema, type CreateTransferFormData } from '@/lib/validations';
import { useSettingsStore, useBusinessStore, useTransactionStore, useTransferStore, useInvestmentStore } from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { formatCurrency } from '@/lib/utils/format';
import type { Transfer, TransferDirection } from '@/types';

interface TransferFormProps {
  transfer?: Transfer;
  onSubmit: (data: CreateTransferFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function TransferForm({
  transfer,
  onSubmit,
  onCancel,
  isLoading,
}: TransferFormProps) {
  const t = useTranslations('transfers');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { settings, personalAccount, currencies } = useSettingsStore();
  const { businesses } = useBusinessStore();
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();
  const { accounts: investmentAccounts } = useInvestmentStore();

  const form = useForm<CreateTransferFormData>({
    resolver: zodResolver(createTransferSchema),
    defaultValues: {
      fromEntityId: transfer?.fromEntityId || businesses[0]?.id || '',
      fromEntityType: transfer?.fromEntityType || 'business',
      toEntityId: transfer?.toEntityId || personalAccount?.id || '',
      toEntityType: transfer?.toEntityType || 'personal',
      direction: transfer?.direction || 'profit_distribution',
      amount: transfer?.amount || 0,
      currency: transfer?.currency || settings.baseCurrency,
      exchangeRate: transfer?.exchangeRate || 1,
      description: transfer?.description || '',
      date: transfer?.date ? new Date(transfer.date) : new Date(),
    },
  });

  const selectedDirection = form.watch('direction');
  const selectedCurrency = form.watch('currency');
  const selectedFromEntityId = form.watch('fromEntityId');

  const selectedFromInvestmentAccountId = form.watch('fromInvestmentAccountId');

  // For deposits, filter investment accounts by the source entity.
  // For withdrawals, show all accounts (user picks account first).
  const filteredInvestmentAccounts = useMemo(() => {
    const active = investmentAccounts.filter((a) => a.isActive);
    if (selectedDirection === 'investment_deposit' && selectedFromEntityId) {
      const matched = active.filter((a) => a.entityId === selectedFromEntityId);
      // If entity has its own accounts, show only those; otherwise show all
      return matched.length > 0 ? matched : active;
    }
    return active;
  }, [investmentAccounts, selectedDirection, selectedFromEntityId]);

  // Calculate the balance of the source entity
  const sourceEntityBalance = useMemo(() => {
    if (selectedDirection === 'investment_withdrawal') {
      // Source is an investment account
      const account = investmentAccounts.find((a) => a.id === selectedFromInvestmentAccountId);
      if (!account) return null;
      return {
        name: account.name,
        balance: account.cashBalance,
        currency: account.currency,
      };
    }
    if (selectedDirection === 'investment_deposit' || selectedDirection === 'reimbursement' || selectedDirection === 'profit_distribution') {
      // Source is a business (or personal for investment_deposit)
      const business = businesses.find((b) => b.id === selectedFromEntityId);
      if (business) {
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
      }
      // Check if source is personal
      if (personalAccount && selectedFromEntityId === personalAccount.id) {
        const summary = calculateEntitySummary(
          personalAccount.id,
          'personal',
          t('form.personalAccount'),
          transactions,
          transfers,
          settings.baseCurrency
        );
        return {
          name: t('form.personalAccount'),
          balance: summary.balance,
          currency: settings.baseCurrency,
        };
      }
      return null;
    } else {
      // Capital injection: source is personal account
      if (!personalAccount) return null;
      
      const summary = calculateEntitySummary(
        personalAccount.id,
        'personal',
        t('form.personalAccount'),
        transactions,
        transfers,
        settings.baseCurrency
      );
      return {
        name: t('form.personalAccount'),
        balance: summary.balance,
        currency: settings.baseCurrency,
      };
    }
  }, [selectedDirection, selectedFromEntityId, selectedFromInvestmentAccountId, businesses, personalAccount, investmentAccounts, transactions, transfers, settings.baseCurrency, t]);

  // Update from/to entities when direction changes
  const handleDirectionChange = (direction: TransferDirection) => {
    form.setValue('direction', direction);
    form.setValue('toInvestmentAccountId', undefined);
    form.setValue('fromInvestmentAccountId', undefined);

    if (direction === 'profit_distribution' || direction === 'reimbursement') {
      // Profit distribution & reimbursement: business → personal
      form.setValue('fromEntityType', 'business');
      form.setValue('toEntityType', 'personal');
      form.setValue('toEntityId', personalAccount?.id || '');
      form.setValue('fromEntityId', businesses[0]?.id || '');
    } else if (direction === 'capital_injection') {
      // Capital injection: personal → business
      form.setValue('fromEntityType', 'personal');
      form.setValue('toEntityType', 'business');
      form.setValue('fromEntityId', personalAccount?.id || '');
      form.setValue('toEntityId', businesses[0]?.id || '');
    } else if (direction === 'investment_deposit') {
      // Investment deposit: entity → investment account
      const activeAccounts = investmentAccounts.filter((a) => a.isActive);
      form.setValue('fromEntityType', businesses[0] ? 'business' : 'personal');
      form.setValue('toEntityType', 'business');
      form.setValue('fromEntityId', businesses[0]?.id || personalAccount?.id || '');
      form.setValue('toEntityId', '');
      form.setValue('toInvestmentAccountId', activeAccounts[0]?.id || '');
    } else if (direction === 'investment_withdrawal') {
      // Investment withdrawal: investment account → entity
      const activeAccounts = investmentAccounts.filter((a) => a.isActive);
      form.setValue('fromEntityType', 'business');
      form.setValue('toEntityType', businesses[0] ? 'business' : 'personal');
      form.setValue('fromEntityId', '');
      form.setValue('toEntityId', businesses[0]?.id || personalAccount?.id || '');
      form.setValue('fromInvestmentAccountId', activeAccounts[0]?.id || '');
    }
  };

  // Auto-select first matching investment account when source entity changes
  useEffect(() => {
    if (selectedDirection === 'investment_deposit' && selectedFromEntityId) {
      const active = investmentAccounts.filter((a) => a.isActive);
      const matched = active.filter((a) => a.entityId === selectedFromEntityId);
      const list = matched.length > 0 ? matched : active;
      const current = form.getValues('toInvestmentAccountId');
      if (!current || !list.find((a) => a.id === current)) {
        form.setValue('toInvestmentAccountId', list[0]?.id || '');
      }
    }
  }, [selectedFromEntityId, selectedDirection, investmentAccounts, form]);

  // Get exchange rate from currencies when currency changes
  // manualRate = "1 baseCurrency = X foreignCurrency"
  // exchangeRate = "1 foreignCurrency = X baseCurrency" (inverse)
  const handleCurrencyChange = (currencyCode: string) => {
    form.setValue('currency', currencyCode);
    const currency = currencies.find((c) => c.code === currencyCode);
    if (currency && currency.manualRate > 0) {
      form.setValue('exchangeRate', Math.round((1 / currency.manualRate) * 1000000) / 1000000);
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
                    value="profit_distribution"
                    className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
                  >
                    {t('directions.profitDistribution')}
                  </SelectItem>
                  <SelectItem
                    value="capital_injection"
                    className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
                  >
                    {t('directions.capitalInjection')}
                  </SelectItem>
                  <SelectItem
                    value="reimbursement"
                    className="text-purple-400 focus:bg-slate-800 focus:text-purple-400"
                  >
                    {t('directions.reimbursement')}
                  </SelectItem>
                  {investmentAccounts.length > 0 && (
                    <>
                      <SelectItem
                        value="investment_deposit"
                        className="text-cyan-400 focus:bg-slate-800 focus:text-cyan-400"
                      >
                        {t('directions.investmentDeposit')}
                      </SelectItem>
                      <SelectItem
                        value="investment_withdrawal"
                        className="text-amber-400 focus:bg-slate-800 focus:text-amber-400"
                      >
                        {t('directions.investmentWithdrawal')}
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* From */}
        {selectedDirection === 'investment_withdrawal' ? (
          <FormField
            control={form.control}
            name="fromInvestmentAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.from')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ''}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('form.selectInvestmentAccount')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {investmentAccounts.filter((a) => a.isActive).map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : selectedDirection === 'profit_distribution' || selectedDirection === 'reimbursement' || selectedDirection === 'investment_deposit' ? (
          <FormField
            control={form.control}
            name="fromEntityId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.from')}</FormLabel>
                <Select
                  onValueChange={(val) => {
                    field.onChange(val);
                    if (personalAccount && val === personalAccount.id) {
                      form.setValue('fromEntityType', 'personal');
                    } else {
                      form.setValue('fromEntityType', 'business');
                    }
                  }}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('form.selectAccount')} />
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
                    {personalAccount && selectedDirection === 'investment_deposit' && (
                      <SelectItem
                        value={personalAccount.id}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {t('form.personalAccount')}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
                {/* Available Balance */}
                {sourceEntityBalance && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <Wallet className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-slate-400">{t('form.availableBalance')}:</span>
                    <span className={sourceEntityBalance.balance >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                      {formatCurrency(sourceEntityBalance.balance, sourceEntityBalance.currency)}
                    </span>
                  </div>
                )}
              </FormItem>
            )}
          />
        ) : (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-300">{t('form.from')}</p>
            <div className="rounded-md border border-slate-600 bg-slate-700/50 px-3 py-2 text-white">
              {t('form.personalAccount')}
            </div>
            {sourceEntityBalance && (
              <div className="mt-1.5 flex items-center gap-2 text-xs">
                <Wallet className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-400">{t('form.availableBalance')}:</span>
                <span className={sourceEntityBalance.balance >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                  {formatCurrency(sourceEntityBalance.balance, sourceEntityBalance.currency)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* To */}
        {selectedDirection === 'investment_deposit' ? (
          <FormField
            control={form.control}
            name="toInvestmentAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.to')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ''}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('form.selectInvestmentAccount')} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {filteredInvestmentAccounts.map((account) => (
                      <SelectItem
                        key={account.id}
                        value={account.id}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : selectedDirection === 'capital_injection' || selectedDirection === 'investment_withdrawal' ? (
          <FormField
            control={form.control}
            name="toEntityId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.to')}</FormLabel>
                <Select
                  onValueChange={(val) => {
                    field.onChange(val);
                    if (personalAccount && val === personalAccount.id) {
                      form.setValue('toEntityType', 'personal');
                    } else {
                      form.setValue('toEntityType', 'business');
                    }
                  }}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('form.selectAccount')} />
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
                    {personalAccount && (
                      <SelectItem
                        value={personalAccount.id}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {t('form.personalAccount')}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-300">{t('form.to')}</p>
            <div className="rounded-md border border-slate-600 bg-slate-700/50 px-3 py-2 text-white">
              {t('form.personalAccount')}
            </div>
          </div>
        )}

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
                  {t('form.exchangeRate')} (1 {selectedCurrency} = ? {settings.baseCurrency})
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

        {/* Date */}
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
            {transfer ? t('form.update') : t('form.create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
