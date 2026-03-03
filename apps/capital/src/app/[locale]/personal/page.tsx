'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
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
import { useLocale } from 'next-intl';
import {
  User,
  TrendingUp,
  TrendingDown,
  Wallet,
  CalendarIcon,
  X,
  Upload,
  Loader2,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { ActivityTable } from '@/components/tables';
import { TransactionDialog, TransferDialog } from '@/components/dialogs';
import { StatementUploadDialog } from '@/components/dialogs/statement-upload-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import {
  useTransactionStore,
  useTransferStore,
  useSettingsStore,
  useBusinessStore,
  useInvestmentStore,
  useCreditCardStore,
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { client } from '@/lib/api-client';
import type { Transaction, Transfer } from '@/types';
import type { CreateTransactionFormData } from '@/lib/validations';
import type { DateRange } from 'react-day-picker';

interface StatementImportStatus {
  id: string;
  categorizationStatus: string;
  ledgerBalance: number | null;
  ledgerCurrency: string | null;
  personalAccountId: string | null;
  businessId: string | null;
  createdAt: string;
}

export default function PersonalPage() {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
  
  const { transactions, addTransaction, updateTransaction, deleteTransaction, fetchTransactions } =
    useTransactionStore();
  const { transfers, addTransfer, deleteTransfer } = useTransferStore();
  const { settings, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();
  const { creditCards } = useCreditCardStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isStatementDialogOpen, setIsStatementDialogOpen] = useState(false);
  const [pendingCategorization, setPendingCategorization] = useState(false);
  const [ledgerBalance, setLedgerBalance] = useState<number | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | undefined>();
  const [deletingTransfer, setDeletingTransfer] = useState<Transfer | undefined>();
  const [editingTransfer, setEditingTransfer] = useState<Transfer | undefined>();
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Get transactions for personal account
  const personalTransactions = useMemo(() => {
    if (!personalAccount) return [];
    return transactions.filter(
      (t) => t.entityId === personalAccount.id && t.entityType === 'personal'
    );
  }, [transactions, personalAccount]);

  // Get transfers involving personal account
  const personalTransfers = useMemo(() => {
    if (!personalAccount) return [];
    return transfers.filter(
      (t) => t.fromEntityId === personalAccount.id || t.toEntityId === personalAccount.id
    );
  }, [transfers, personalAccount]);

  // Filter transactions and transfers by date range
  const filteredTransactions = useMemo(() => {
    if (!dateRange?.from) return personalTransactions;
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    
    return personalTransactions.filter((t) => {
      const date = new Date(t.date);
      return isWithinInterval(date, { start, end });
    });
  }, [personalTransactions, dateRange]);

  const filteredTransfers = useMemo(() => {
    if (!dateRange?.from) return personalTransfers;
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    
    return personalTransfers.filter((t) => {
      const date = new Date(t.date);
      return isWithinInterval(date, { start, end });
    });
  }, [personalTransfers, dateRange]);

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

  // Build entity names map for display
  const { accounts: investmentAccounts } = useInvestmentStore();

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
    if (!personalAccount) return null;
    return calculateEntitySummary(
      personalAccount.id,
      'personal',
      t('nav.personal'),
      transactions,
      transfers,
      settings.baseCurrency
    );
  }, [personalAccount, transactions, transfers, settings.baseCurrency, t]);

  const updateLedgerBalance = useCallback((imports: StatementImportStatus[]) => {
    if (!personalAccount) return;
    const relevant = imports
      .filter((i) => i.personalAccountId === personalAccount.id && i.ledgerBalance != null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (relevant.length > 0) {
      setLedgerBalance(relevant[0].ledgerBalance);
    }
  }, [personalAccount]);

  useEffect(() => {
    if (!personalAccount) return;
    (async () => {
      try {
        const res = await client.v1['bank-statements'].imports.$get();
        if (res.ok) {
          const imports = await res.json() as StatementImportStatus[];
          updateLedgerBalance(imports);
        }
      } catch {
        // ignore
      }
    })();
  }, [personalAccount, updateLedgerBalance]);

  useEffect(() => {
    if (!pendingCategorization) return;
    const interval = setInterval(async () => {
      try {
        const res = await client.v1['bank-statements'].imports.$get();
        if (res.ok) {
          const imports = await res.json() as StatementImportStatus[];
          updateLedgerBalance(imports);
          const hasPending = imports.some(
            (i) => i.categorizationStatus === 'pending' || i.categorizationStatus === 'processing'
          );
          if (!hasPending) {
            setPendingCategorization(false);
            fetchTransactions();
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [pendingCategorization, fetchTransactions, updateLedgerBalance]);

  const handleImportComplete = useCallback(async () => {
    fetchTransactions();
    setPendingCategorization(true);
    toast.success(t('bankStatements.toast.imported'));
    try {
      const res = await client.v1['bank-statements'].imports.$get();
      if (res.ok) {
        const imports = await res.json() as StatementImportStatus[];
        updateLedgerBalance(imports);
      }
    } catch {
      // ignore
    }
  }, [fetchTransactions, t, updateLedgerBalance]);

  if (!personalAccount) {
    return (
      <AppShell>
        <div className="py-16 text-center">
          <User className="mx-auto mb-4 h-16 w-16 text-slate-600" />
          <h2 className="mb-2 text-xl font-bold text-white">
            {t('personal.setup.title')}
          </h2>
          <p className="text-slate-400">{t('personal.setup.description')}</p>
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

  const handleEditTransfer = async (data: import('@/lib/validations').CreateTransferFormData) => {
    if (editingTransfer) {
      await deleteTransfer(editingTransfer.id);
      await addTransfer(data);
      setEditingTransfer(undefined);
      setIsTransferDialogOpen(false);
      toast.success(t('transfers.toast.created'));
    }
  };

  const openEditDialog = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsDialogOpen(true);
  };

  const openEditTransferDialog = (transfer: Transfer) => {
    setEditingTransfer(transfer);
    setIsTransferDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTransaction(undefined);
  };

  const closeTransferDialog = () => {
    setIsTransferDialogOpen(false);
    setEditingTransfer(undefined);
  };

  return (
    <AppShell>
      <Header
        title={t('personal.title')}
        description={t('personal.subtitle')}
        secondaryAction={{
          label: t('bankStatements.uploadStatement'),
          onClick: () => setIsStatementDialogOpen(true),
          icon: Upload,
        }}
        action={{
          label: t('transactions.addTransaction'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      {summary && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            title={t('personal.balance')}
            value={ledgerBalance ?? summary.balance}
            currency={settings.baseCurrency}
            icon={Wallet}
            variant={(ledgerBalance ?? summary.balance) >= 0 ? 'income' : 'expense'}
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

      {/* Categorization Status Banner */}
      {pendingCategorization && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span className="text-sm text-blue-300">{t('bankStatements.status.categorizing')}</span>
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
            entityId={personalAccount.id}
            entityType="personal"
            entityNames={entityNames}
            onEditTransaction={openEditDialog}
            onDeleteTransaction={setDeletingTransaction}
            onEditTransfer={openEditTransferDialog}
            onDeleteTransfer={setDeletingTransfer}
          />
        </CardContent>
      </Card>

      {/* Statement Upload Dialog */}
      <StatementUploadDialog
        open={isStatementDialogOpen}
        onOpenChange={setIsStatementDialogOpen}
        businesses={businesses}
        personalAccountId={personalAccount.id}
        existingCreditCards={creditCards}
        defaultEntityType="personal"
        defaultEntityId={personalAccount.id}
        onImportComplete={handleImportComplete}
      />

      {/* Transaction Dialog */}
      <TransactionDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        entityId={personalAccount.id}
        entityType="personal"
        transaction={editingTransaction}
        onSubmit={editingTransaction ? handleUpdateTransaction : handleCreateTransaction}
      />

      {/* Transfer Edit Dialog */}
      <TransferDialog
        open={isTransferDialogOpen}
        onOpenChange={closeTransferDialog}
        transfer={editingTransfer}
        onSubmit={handleEditTransfer}
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
