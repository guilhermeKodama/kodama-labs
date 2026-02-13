'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  isWithinInterval,
  startOfDay,
  endOfDay,
} from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import {
  ArrowLeft,
  Plus,
  Building2,
  TrendingUp,
  TrendingDown,
  CalendarIcon,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { SummaryCard } from '@/components/cards';
import { ActivityTable } from '@/components/tables';
import { TransactionDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Link } from '@/i18n/navigation';
import {
  useBusinessStore,
  useTransactionStore,
  useTransferStore,
  useSettingsStore,
  useInvestmentStore,
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Transaction, Transfer } from '@/types';
import type { CreateTransactionFormData } from '@/lib/validations';
import type { DateRange } from 'react-day-picker';

export default function BusinessDetailPage() {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
  const params = useParams();
  const businessId = params.id as string;

  const { businesses, getBusiness } = useBusinessStore();
  const { transactions, addTransaction, updateTransaction, deleteTransaction } =
    useTransactionStore();
  const { transfers, deleteTransfer } = useTransferStore();
  const { settings, personalAccount } = useSettingsStore();

  const business = getBusiness(businessId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | undefined>();
  const [deletingTransfer, setDeletingTransfer] = useState<Transfer | undefined>();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Get transactions for this business
  const businessTransactions = useMemo(() => {
    return transactions.filter(
      (t) => t.entityId === businessId && t.entityType === 'business'
    );
  }, [transactions, businessId]);

  // Get transfers involving this business
  const businessTransfers = useMemo(() => {
    return transfers.filter(
      (t) => t.fromEntityId === businessId || t.toEntityId === businessId
    );
  }, [transfers, businessId]);

  // Filter transactions and transfers by date range
  const filteredTransactions = useMemo(() => {
    if (!dateRange?.from) return businessTransactions;
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    
    return businessTransactions.filter((t) => {
      const date = new Date(t.date);
      return isWithinInterval(date, { start, end });
    });
  }, [businessTransactions, dateRange]);

  const filteredTransfers = useMemo(() => {
    if (!dateRange?.from) return businessTransfers;
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    
    return businessTransfers.filter((t) => {
      const date = new Date(t.date);
      return isWithinInterval(date, { start, end });
    });
  }, [businessTransfers, dateRange]);

  // Quick filter presets
  const setThisMonth = () => {
    const now = new Date();
    setDateRange({
      from: startOfMonth(now),
      to: endOfMonth(now),
    });
  };

  const setLastMonth = () => {
    const lastMonth = subMonths(new Date(), 1);
    setDateRange({
      from: startOfMonth(lastMonth),
      to: endOfMonth(lastMonth),
    });
  };

  const clearFilter = () => {
    setDateRange(undefined);
  };

  const { accounts: investmentAccounts } = useInvestmentStore();

  // Build entity names map for display (includes investment accounts)
  const entityNames = useMemo(() => {
    const names: Record<string, string> = {};
    businesses.forEach((b) => {
      names[b.id] = b.name;
    });
    if (personalAccount) {
      names[personalAccount.id] = t('nav.personal');
    }
    investmentAccounts.forEach((a) => {
      names[a.id] = a.name;
    });
    return names;
  }, [businesses, personalAccount, investmentAccounts, t]);

  const summary = useMemo(() => {
    if (!business) return null;
    return calculateEntitySummary(
      business.id,
      'business',
      business.name,
      transactions,
      transfers,
      settings.baseCurrency
    );
  }, [business, transactions, transfers, settings.baseCurrency]);

  if (!business) {
    return (
      <AppShell>
        <div className="py-16 text-center">
          <Building2 className="mx-auto mb-4 h-16 w-16 text-slate-600" />
          <h2 className="mb-2 text-xl font-bold text-white">
            {t('businesses.notFound.title')}
          </h2>
          <p className="mb-6 text-slate-400">
            {t('businesses.notFound.description')}
          </p>
          <Button asChild>
            <Link href="/businesses">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('businesses.notFound.back')}
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const handleCreateTransaction = async (data: CreateTransactionFormData) => {
    await addTransaction(data);
    toast.success(t('transactions.toast.created'));
  };

  const handleUpdateTransaction = async (data: CreateTransactionFormData) => {
    if (editingTransaction) {
      await updateTransaction(editingTransaction.id, data);
      setEditingTransaction(undefined);
      toast.success(t('transactions.toast.updated'));
    }
  };

  const handleDeleteTransaction = async () => {
    if (deletingTransaction) {
      await deleteTransaction(deletingTransaction.id);
      setDeletingTransaction(undefined);
      toast.success(t('transactions.toast.deleted'));
    }
  };

  const handleDeleteTransfer = async () => {
    if (deletingTransfer) {
      await deleteTransfer(deletingTransfer.id);
      setDeletingTransfer(undefined);
      toast.success(t('transfers.toast.deleted'));
    }
  };

  const openEditDialog = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTransaction(undefined);
  };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-4 text-slate-400 hover:text-white"
        >
          <Link href="/businesses">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('common.back')}
          </Link>
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl"
              style={{
                backgroundColor: business.color
                  ? `${business.color}20`
                  : 'rgb(51 65 85 / 0.5)',
              }}
            >
              <Building2
                className="h-6 w-6"
                style={{ color: business.color || '#94a3b8' }}
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{business.name}</h1>
              {business.description && (
                <p className="text-sm text-slate-400">{business.description}</p>
              )}
            </div>
          </div>

          <Button
            onClick={() => setIsDialogOpen(true)}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('transactions.addTransaction')}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            title={t('transactions.summary.balance')}
            value={summary.balance}
            currency={settings.baseCurrency}
            icon={summary.balance >= 0 ? TrendingUp : TrendingDown}
            variant={summary.balance >= 0 ? 'income' : 'expense'}
          />
          <SummaryCard
            title={t('transactions.summary.income')}
            value={summary.totalIncome}
            currency={settings.baseCurrency}
            icon={TrendingUp}
            variant="income"
          />
          <SummaryCard
            title={t('transactions.summary.expenses')}
            value={summary.totalExpenses}
            currency={settings.baseCurrency}
            icon={TrendingDown}
            variant="expense"
          />
        </div>
      )}

      {/* Activity (Transactions + Transfers) */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg text-white">
              {t('activity.title')}
            </CardTitle>
            
            {/* Date Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick Presets */}
              <Button
                variant="outline"
                size="sm"
                onClick={setThisMonth}
                className={cn(
                  'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white',
                  dateRange?.from &&
                    format(dateRange.from, 'yyyy-MM') === format(new Date(), 'yyyy-MM') &&
                    'bg-slate-800 text-white'
                )}
              >
                {t('activity.filter.thisMonth')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={setLastMonth}
                className={cn(
                  'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white',
                  dateRange?.from &&
                    format(dateRange.from, 'yyyy-MM') === format(subMonths(new Date(), 1), 'yyyy-MM') &&
                    'bg-slate-800 text-white'
                )}
              >
                {t('activity.filter.lastMonth')}
              </Button>

              {/* Custom Date Range Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white min-w-[200px] justify-start text-left font-normal',
                      dateRange?.from && 'bg-slate-800 text-white'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, 'dd MMM', { locale: dateLocale })} -{' '}
                          {format(dateRange.to, 'dd MMM yyyy', { locale: dateLocale })}
                        </>
                      ) : (
                        format(dateRange.from, 'dd MMM yyyy', { locale: dateLocale })
                      )
                    ) : (
                      t('activity.filter.selectDates')
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0 border-slate-700 bg-slate-900"
                  align="end"
                >
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    locale={dateLocale}
                    className="bg-slate-900 text-white"
                  />
                </PopoverContent>
              </Popover>

              {/* Clear Filter */}
              {dateRange?.from && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilter}
                  className="text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ActivityTable
            transactions={filteredTransactions}
            transfers={filteredTransfers}
            entityId={businessId}
            entityType="business"
            entityNames={entityNames}
            onEditTransaction={openEditDialog}
            onDeleteTransaction={setDeletingTransaction}
            onDeleteTransfer={setDeletingTransfer}
          />
        </CardContent>
      </Card>

      {/* Transaction Dialog */}
      <TransactionDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        entityId={businessId}
        entityType="business"
        transaction={editingTransaction}
        onSubmit={editingTransaction ? handleUpdateTransaction : handleCreateTransaction}
      />

      {/* Delete Transaction Confirmation */}
      <AlertDialog
        open={!!deletingTransaction}
        onOpenChange={() => setDeletingTransaction(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('transactions.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('transactions.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTransaction}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Transfer Confirmation */}
      <AlertDialog
        open={!!deletingTransfer}
        onOpenChange={() => setDeletingTransfer(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('transfers.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('transfers.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTransfer}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
