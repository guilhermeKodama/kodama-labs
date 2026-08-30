'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
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
  CalendarClock,
  X,
  Upload,
  Loader2,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { SummaryCard } from '@/components/cards';
import { ActivityTable } from '@/components/tables';
import { TransactionDialog, TransferDialog, AttachmentsDialog } from '@/components/dialogs';
import { StatementUploadDialog } from '@/components/dialogs/statement-upload-dialog';
import { ConvertToTransferDialog } from '@/components/dialogs/convert-to-transfer-dialog';
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
  useCreditCardStore,
  useAttachmentStore,
} from '@/lib/store';
import { calculateEntitySummary, calculateUpcomingExpenses } from '@/lib/utils/calculations';
import { useRecurringTransactionStore } from '@/lib/store/recurring-store';
import { useRecurringTransferStore } from '@/lib/store/recurring-transfer-store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { client } from '@/lib/api-client';
import { useDialogForm } from '@/hooks/use-dialog-form';
import type { Transaction, Transfer } from '@/types';
import type { CreateTransactionFormData, CreateTransferFormData } from '@/lib/validations';
import type { DateRange } from 'react-day-picker';

export default function BusinessDetailPage() {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
  const params = useParams();
  const businessId = params.id as string;

  const { businesses, getBusiness } = useBusinessStore();
  const { transactions, addTransaction, updateTransaction, deleteTransaction, fetchTransactions } =
    useTransactionStore();
  const { transfers, addTransfer, deleteTransfer, fetchTransfers } = useTransferStore();
  const { settings, personalAccount } = useSettingsStore();
  const { creditCards } = useCreditCardStore();
  const { recurringTransactions } = useRecurringTransactionStore();
  const { recurringTransfers } = useRecurringTransferStore();
  const fetchAttachments = useAttachmentStore((s) => s.fetchByOwnerType);

  useEffect(() => {
    void fetchAttachments('transaction');
    void fetchAttachments('transfer');
  }, [fetchAttachments]);

  const business = getBusiness(businessId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isStatementDialogOpen, setIsStatementDialogOpen] = useState(false);
  const [pendingCategorization, setPendingCategorization] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | undefined>();
  const [convertingTransaction, setConvertingTransaction] = useState<Transaction | null>(null);
  const [deletingTransfer, setDeletingTransfer] = useState<Transfer | undefined>();
  const [editingTransfer, setEditingTransfer] = useState<Transfer | undefined>();
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [attachingTransaction, setAttachingTransaction] = useState<Transaction | undefined>();
  const [attachingTransfer, setAttachingTransfer] = useState<Transfer | undefined>();

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

  const { accounts: investmentAccounts, fetchAccounts: fetchInvestmentAccounts } = useInvestmentStore();

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
      settings.baseCurrency,
      business.initialBalance
    );
  }, [business, transactions, transfers, settings.baseCurrency]);

  const upcomingExpenses = useMemo(() => {
    if (!business) return 0;
    return calculateUpcomingExpenses(
      business.id,
      'business',
      recurringTransactions,
      recurringTransfers,
    );
  }, [business, recurringTransactions, recurringTransfers]);

  const handleImportComplete = useCallback(() => {
    fetchTransactions();
    fetchInvestmentAccounts();
    setPendingCategorization(true);
    toast.success(t('bankStatements.toast.imported'));
  }, [fetchTransactions, fetchInvestmentAccounts, t]);

  useEffect(() => {
    if (!pendingCategorization) return;
    const interval = setInterval(async () => {
      try {
        const res = await client.v1['bank-statements'].imports.$get();
        if (res.ok) {
          const imports = await res.json() as Array<{ categorizationStatus: string }>;
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
  }, [pendingCategorization, fetchTransactions]);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTransaction(undefined);
  };

  const closeTransferDialog = () => {
    setIsTransferDialogOpen(false);
    setEditingTransfer(undefined);
  };

  // Hooks must run unconditionally, before the early return below.
  const createTransactionForm = useDialogForm({
    onOpenChange: setIsDialogOpen,
    action: addTransaction,
    onSuccess: (created) => {
      // Offer to attach a bill/receipt right away via the standalone attach
      // dialog, instead of keeping the create dialog open in disguise as edit.
      setAttachingTransaction(created);
      toast.success(t('transactions.toast.created'));
    },
    errorMessage: t('transactions.toast.createError'),
  });

  const updateTransactionForm = useDialogForm({
    onOpenChange: closeDialog,
    action: (data: CreateTransactionFormData) =>
      editingTransaction ? updateTransaction(editingTransaction.id, data) : Promise.resolve(false),
    onSuccess: () => toast.success(t('transactions.toast.updated')),
    errorMessage: t('transactions.toast.updateError'),
  });

  const editTransferForm = useDialogForm({
    onOpenChange: closeTransferDialog,
    action: async (data: CreateTransferFormData) => {
      if (!editingTransfer) return null;
      const deleted = await deleteTransfer(editingTransfer.id);
      if (!deleted) return null;
      return addTransfer(data);
    },
    onSuccess: () => toast.success(t('transfers.toast.updated')),
    errorMessage: t('transfers.toast.editError'),
  });

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

  const openEditTransferDialog = (transfer: Transfer) => {
    setEditingTransfer(transfer);
    setIsTransferDialogOpen(true);
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

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setIsStatementDialogOpen(true)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Upload className="mr-2 h-4 w-4" />
              {t('bankStatements.uploadStatement')}
            </Button>
            <Button
              onClick={() => setIsDialogOpen(true)}
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('transactions.addTransaction')}
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <SummaryCard
            title={t('transactions.summary.upcomingExpenses')}
            value={upcomingExpenses}
            currency={settings.baseCurrency}
            icon={CalendarClock}
            variant="expense"
          />
        </div>
      )}

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
            entityId={businessId}
            entityType="business"
            entityNames={entityNames}
            onEditTransaction={openEditDialog}
            onDeleteTransaction={setDeletingTransaction}
            onAttachTransaction={setAttachingTransaction}
            onConvertToTransfer={setConvertingTransaction}
            onEditTransfer={openEditTransferDialog}
            onDeleteTransfer={setDeletingTransfer}
            onAttachTransfer={setAttachingTransfer}
          />
        </CardContent>
      </Card>

      {/* Statement Upload Dialog */}
      <StatementUploadDialog
        open={isStatementDialogOpen}
        onOpenChange={setIsStatementDialogOpen}
        businesses={businesses}
        personalAccountId={personalAccount?.id ?? null}
        existingCreditCards={creditCards}
        investmentAccounts={investmentAccounts}
        defaultEntityType="business"
        defaultEntityId={businessId}
        onImportComplete={handleImportComplete}
        currentBalance={summary?.balance}
      />

      {/* Transaction Dialog */}
      <TransactionDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        entityId={businessId}
        entityType="business"
        transaction={editingTransaction}
        onSubmit={editingTransaction ? updateTransactionForm.submit : createTransactionForm.submit}
        isLoading={editingTransaction ? updateTransactionForm.isSubmitting : createTransactionForm.isSubmitting}
      />

      {/* Transfer Edit Dialog */}
      <TransferDialog
        open={isTransferDialogOpen}
        onOpenChange={closeTransferDialog}
        transfer={editingTransfer}
        onSubmit={editTransferForm.submit}
        isLoading={editTransferForm.isSubmitting}
      />

      {/* Attachments Dialog — Transaction */}
      <AttachmentsDialog
        open={!!attachingTransaction}
        onOpenChange={(open) => { if (!open) setAttachingTransaction(undefined); }}
        ownerType="transaction"
        ownerId={attachingTransaction?.id ?? null}
        title={attachingTransaction?.description ?? t('transactions.attachments.title')}
        description={t('transactions.attachments.description')}
        sections={[
          {
            kind: 'BILL',
            label: t('transactions.attachments.bill.label'),
            helperText: t('transactions.attachments.bill.helper'),
          },
          {
            kind: 'RECEIPT',
            label: t('transactions.attachments.receipt.label'),
            helperText: t('transactions.attachments.receipt.helper'),
          },
        ]}
      />

      {/* Attachments Dialog — Transfer */}
      <AttachmentsDialog
        open={!!attachingTransfer}
        onOpenChange={(open) => { if (!open) setAttachingTransfer(undefined); }}
        ownerType="transfer"
        ownerId={attachingTransfer?.id ?? null}
        title={attachingTransfer?.description ?? t('transfers.attachments.title')}
        description={t('transfers.attachments.description')}
        sections={[
          {
            kind: 'TRANSFER_RECEIPT',
            label: t('transfers.attachments.receipt.label'),
            helperText: t('transfers.attachments.receipt.helper'),
          },
        ]}
      />

      {/* Convert Transaction to Transfer Dialog */}
      <ConvertToTransferDialog
        open={!!convertingTransaction}
        onOpenChange={(open) => { if (!open) setConvertingTransaction(null); }}
        transaction={convertingTransaction}
        sourceEntityId={businessId}
        sourceEntityType="business"
        businesses={businesses}
        personalAccountId={personalAccount?.id ?? null}
        investmentAccounts={investmentAccounts}
        onComplete={() => {
          setConvertingTransaction(null);
          fetchTransactions();
          fetchTransfers();
          toast.success(t('convertTransfer.success'));
        }}
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
