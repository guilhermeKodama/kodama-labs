'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  isWithinInterval,
  startOfDay,
  endOfDay,
} from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import {
  Repeat,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  CalendarIcon,
  Play,
  X,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { RecurringTable } from '@/components/tables';
import { RecurringDialog, RecurringPaymentDialog, AttachmentsDialog } from '@/components/dialogs';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useRecurringTransactionStore,
  useTransactionStore,
  useSettingsStore,
  useBusinessStore,
} from '@/lib/store';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useDialogForm } from '@/hooks/use-dialog-form';
import type { RecurringTransaction, TransactionType } from '@/types';
import type { CreateRecurringTransactionFormData } from '@/lib/validations';
import type { DateRange } from 'react-day-picker';

export default function RecurringPage() {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
  
  const {
    recurringTransactions,
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    toggleRecurringTransaction,
    markAsPaid,
    skipOccurrence,
  } = useRecurringTransactionStore();
  const { fetchTransactions } = useTransactionStore();
  const { settings, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringTransaction | undefined>();
  const [deletingRecurring, setDeletingRecurring] = useState<RecurringTransaction | undefined>();
  const [skippingRecurring, setSkippingRecurring] = useState<RecurringTransaction | undefined>();
  const [isSkipping, setIsSkipping] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [attachingRecurring, setAttachingRecurring] = useState<RecurringTransaction | undefined>();
  const [payingRecurring, setPayingRecurring] = useState<RecurringTransaction | undefined>();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<'all' | TransactionType>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Categories actually present on recurring items, not the full settings list —
  // keeps the filter free of options that would always return zero rows.
  const availableCategories = useMemo(() => {
    return [...new Set(recurringTransactions.map((rt) => rt.category))].sort();
  }, [recurringTransactions]);

  // Filter recurring transactions by date range, entity, type and category
  const filteredRecurringTransactions = useMemo(() => {
    let filtered = recurringTransactions;

    // Filter by entity
    if (selectedEntityId !== 'all') {
      filtered = filtered.filter((rt) => rt.entityId === selectedEntityId);
    }

    // Filter by transaction type
    if (selectedType !== 'all') {
      filtered = filtered.filter((rt) => rt.type === selectedType);
    }

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter((rt) => rt.category === selectedCategory);
    }

    // Filter by date range
    if (dateRange?.from) {
      const start = startOfDay(dateRange.from);
      const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);

      filtered = filtered.filter((rt) => {
        const dueDate = new Date(rt.nextDueDate);
        return isWithinInterval(dueDate, { start, end });
      });
    }

    return filtered;
  }, [recurringTransactions, dateRange, selectedEntityId, selectedType, selectedCategory]);

  // Calculate summaries (based on filtered data)
  const summaries = useMemo(() => {
    const active = filteredRecurringTransactions.filter((rt) => rt.isActive);
    const paused = filteredRecurringTransactions.filter((rt) => !rt.isActive);

    const monthlyIncome = active
      .filter((rt) => rt.type === 'income')
      .reduce((sum, rt) => {
        const monthlyAmount = getMonthlyAmount(rt);
        return sum + monthlyAmount * rt.exchangeRate;
      }, 0);

    const monthlyExpense = active
      .filter((rt) => rt.type === 'expense')
      .reduce((sum, rt) => {
        const monthlyAmount = getMonthlyAmount(rt);
        return sum + monthlyAmount * rt.exchangeRate;
      }, 0);

    const monthlyInvestment = active
      .filter((rt) => rt.type === 'investment')
      .reduce((sum, rt) => {
        const monthlyAmount = getMonthlyAmount(rt);
        return sum + monthlyAmount * rt.exchangeRate;
      }, 0);

    return {
      total: filteredRecurringTransactions.length,
      active: active.length,
      paused: paused.length,
      monthlyIncome,
      monthlyExpense,
      monthlyInvestment,
    };
  }, [filteredRecurringTransactions]);

  // Quick filter presets
  const setThisMonth = () => {
    const now = new Date();
    setDateRange({
      from: startOfMonth(now),
      to: endOfMonth(now),
    });
  };

  const setNextMonth = () => {
    const nextMonth = addMonths(new Date(), 1);
    setDateRange({
      from: startOfMonth(nextMonth),
      to: endOfMonth(nextMonth),
    });
  };

  const clearFilter = () => {
    setDateRange(undefined);
  };

  // Convert any frequency to monthly amount for comparison
  function getMonthlyAmount(rt: RecurringTransaction): number {
    switch (rt.frequency) {
      case 'daily':
        return rt.amount * 30;
      case 'weekly':
        return rt.amount * 4;
      case 'monthly':
        return rt.amount;
      case 'yearly':
        return rt.amount / 12;
      default:
        return rt.amount;
    }
  }

  const openEditDialog = (recurring: RecurringTransaction) => {
    setEditingRecurring(recurring);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingRecurring(undefined);
  };

  const closePaymentDialog = (open: boolean) => {
    if (!open) setPayingRecurring(undefined);
  };

  // Reminder mode: the stored amount is only an estimate, so the dialog
  // supplies the real amount/date before the transaction is booked.
  const paymentForm = useDialogForm({
    onOpenChange: closePaymentDialog,
    action: (values: { amount: number; date: Date }) =>
      payingRecurring
        ? markAsPaid(payingRecurring.id, values)
        : Promise.resolve(null),
    onSuccess: () => {
      void fetchTransactions();
      toast.success(t('recurring.toast.paymentRegistered'));
    },
    errorMessage: t('recurring.toast.paymentError'),
  });

  const createForm = useDialogForm({
    onOpenChange: setIsDialogOpen,
    action: addRecurringTransaction,
    onSuccess: (created) => {
      // Offer to attach the bill right away, instead of keeping the create
      // dialog open in disguise as an edit dialog.
      setAttachingRecurring(created);
      toast.success(t('recurring.toast.created'));
    },
    errorMessage: t('recurring.toast.createError'),
  });

  const updateForm = useDialogForm({
    onOpenChange: closeDialog,
    action: (data: CreateRecurringTransactionFormData) =>
      editingRecurring
        ? updateRecurringTransaction(editingRecurring.id, data)
        : Promise.resolve(false),
    onSuccess: () => toast.success(t('recurring.toast.updated')),
    errorMessage: t('recurring.toast.updateError'),
  });

  const handleDelete = async () => {
    if (deletingRecurring) {
      await deleteRecurringTransaction(deletingRecurring.id);
      setDeletingRecurring(undefined);
      toast.success(t('recurring.toast.deleted'));
    }
  };

  // Concluir sem lançar: advances the occurrence without booking a
  // transaction — for reminder-mode entries that don't need one this cycle.
  const handleSkip = async () => {
    if (!skippingRecurring) return;
    setIsSkipping(true);
    try {
      const success = await skipOccurrence(skippingRecurring.id);
      if (success) {
        toast.success(t('recurring.toast.skipped'));
      } else {
        toast.error(t('recurring.toast.skipError'));
      }
    } finally {
      setIsSkipping(false);
      setSkippingRecurring(undefined);
    }
  };

  const handleToggle = async (recurring: RecurringTransaction) => {
    await toggleRecurringTransaction(recurring.id);
    toast.success(
      recurring.isActive
        ? t('recurring.toast.paused')
        : t('recurring.toast.resumed')
    );
  };

  const handleMarkPaid = useCallback(async (recurring: RecurringTransaction) => {
    setMarkingPaidId(recurring.id);
    try {
      const result = await markAsPaid(recurring.id);
      if (result) {
        // Refetch transactions to include the new one
        await fetchTransactions();
        toast.success(t('recurring.toast.markedPaid'));
      } else {
        toast.error(t('recurring.toast.markPaidError'));
      }
    } catch {
      toast.error(t('recurring.toast.markPaidError'));
    } finally {
      setMarkingPaidId(null);
    }
  }, [markAsPaid, fetchTransactions, t]);

  return (
    <>
      <Header
        title={t('recurring.title')}
        description={t('recurring.subtitle')}
        action={{
          label: t('recurring.addRecurring'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <SummaryCard
          title={t('recurring.summary.total')}
          value={summaries.total}
          icon={Repeat}
          variant="default"
          isCount
        />
        <SummaryCard
          title={t('recurring.summary.active')}
          value={summaries.active}
          icon={Play}
          variant="income"
          isCount
        />
        <SummaryCard
          title={t('recurring.summary.monthlyIncome')}
          value={summaries.monthlyIncome}
          currency={settings.baseCurrency}
          icon={TrendingUp}
          variant="income"
        />
        <SummaryCard
          title={t('recurring.summary.monthlyExpense')}
          value={summaries.monthlyExpense}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="expense"
        />
        <SummaryCard
          title={t('recurring.summary.monthlyInvestment')}
          value={summaries.monthlyInvestment}
          currency={settings.baseCurrency}
          icon={PiggyBank}
          variant="investment"
        />
      </div>

      {/* Recurring Transactions Table */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg text-white">
              {t('recurring.list')}
            </CardTitle>
            
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Entity Filter */}
              <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                <SelectTrigger className="w-[180px] border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder={t('recurring.filter.allEntities')} />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem
                    value="all"
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    {t('recurring.filter.allEntities')}
                  </SelectItem>
                  {personalAccount && (
                    <SelectItem
                      value={personalAccount.id}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {t('common.personal')}
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

              {/* Type Filter */}
              <Select
                value={selectedType}
                onValueChange={(value) => setSelectedType(value as 'all' | TransactionType)}
              >
                <SelectTrigger className="w-[160px] border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder={t('recurring.filter.allTypes')} />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem value="all" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('recurring.filter.allTypes')}
                  </SelectItem>
                  <SelectItem value="income" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('transactions.types.income')}
                  </SelectItem>
                  <SelectItem value="expense" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('transactions.types.expense')}
                  </SelectItem>
                  <SelectItem value="investment" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('transactions.types.investment')}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Category Filter */}
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[180px] border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder={t('recurring.filter.allCategories')} />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem value="all" className="text-slate-300 focus:bg-slate-800 focus:text-white">
                    {t('recurring.filter.allCategories')}
                  </SelectItem>
                  {availableCategories.map((category) => (
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
                {t('recurring.filter.thisMonth')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={setNextMonth}
                className={cn(
                  'border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white',
                  dateRange?.from &&
                    format(dateRange.from, 'yyyy-MM') === format(addMonths(new Date(), 1), 'yyyy-MM') &&
                    'bg-slate-800 text-white'
                )}
              >
                {t('recurring.filter.nextMonth')}
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
                      t('recurring.filter.selectDates')
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
          <RecurringTable
            recurringTransactions={filteredRecurringTransactions}
            onEdit={openEditDialog}
            onDelete={setDeletingRecurring}
            onToggle={handleToggle}
            onMarkPaid={handleMarkPaid}
            onRegisterPayment={setPayingRecurring}
            onSkip={setSkippingRecurring}
            onAttach={setAttachingRecurring}
            isMarkingPaid={markingPaidId}
          />
        </CardContent>
      </Card>

      {/* Recurring Dialog */}
      <RecurringDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        recurring={editingRecurring}
        onSubmit={editingRecurring ? updateForm.submit : createForm.submit}
        isLoading={editingRecurring ? updateForm.isSubmitting : createForm.isSubmitting}
      />

      {/* Register Payment Dialog (reminder mode: enter the real amount) */}
      <RecurringPaymentDialog
        open={!!payingRecurring}
        onOpenChange={closePaymentDialog}
        recurring={payingRecurring}
        onSubmit={paymentForm.submit}
        isLoading={paymentForm.isSubmitting}
      />

      {/* Attachments Dialog (from kebab "Anexar") */}
      <AttachmentsDialog
        open={!!attachingRecurring}
        onOpenChange={(open) => { if (!open) setAttachingRecurring(undefined); }}
        ownerType="recurringTransaction"
        ownerId={attachingRecurring?.id ?? null}
        title={attachingRecurring?.description ?? t('recurring.attachments.title')}
        description={t('recurring.attachments.description')}
        sections={[
          {
            kind: 'BILL',
            label: t('recurring.attachments.bill.label'),
            helperText: t('recurring.attachments.bill.helper'),
          },
        ]}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingRecurring}
        onOpenChange={() => setDeletingRecurring(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('recurring.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('recurring.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Skip Confirmation (Concluir sem lançar) */}
      <AlertDialog
        open={!!skippingRecurring}
        onOpenChange={(open) => { if (!open) setSkippingRecurring(undefined); }}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('recurring.skip.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('recurring.skip.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSkip}
              disabled={isSkipping}
              className="bg-slate-700 text-white hover:bg-slate-600"
            >
              {t('recurring.skip.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
