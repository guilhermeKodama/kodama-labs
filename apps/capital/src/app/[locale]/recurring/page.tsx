'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Repeat,
  Plus,
  TrendingUp,
  TrendingDown,
  Calendar,
  Pause,
  Play,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { RecurringTable } from '@/components/tables';
import { RecurringDialog } from '@/components/dialogs';
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
import {
  useRecurringTransactionStore,
  useTransactionStore,
  useSettingsStore,
} from '@/lib/store';
import { toast } from 'sonner';
import type { RecurringTransaction } from '@/types';
import type { CreateRecurringTransactionFormData } from '@/lib/validations';

export default function RecurringPage() {
  const t = useTranslations();
  const {
    recurringTransactions,
    addRecurringTransaction,
    updateRecurringTransaction,
    deleteRecurringTransaction,
    toggleRecurringTransaction,
    markAsPaid,
  } = useRecurringTransactionStore();
  const { fetchTransactions } = useTransactionStore();
  const { settings } = useSettingsStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringTransaction | undefined>();
  const [deletingRecurring, setDeletingRecurring] = useState<RecurringTransaction | undefined>();
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

  // Calculate summaries
  const summaries = useMemo(() => {
    const active = recurringTransactions.filter((rt) => rt.isActive);
    const paused = recurringTransactions.filter((rt) => !rt.isActive);

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

    return {
      total: recurringTransactions.length,
      active: active.length,
      paused: paused.length,
      monthlyIncome,
      monthlyExpense,
    };
  }, [recurringTransactions]);

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

  const handleCreate = async (data: CreateRecurringTransactionFormData) => {
    await addRecurringTransaction(data);
    toast.success(t('recurring.toast.created'));
  };

  const handleUpdate = async (data: CreateRecurringTransactionFormData) => {
    if (editingRecurring) {
      await updateRecurringTransaction(editingRecurring.id, data);
      setEditingRecurring(undefined);
      toast.success(t('recurring.toast.updated'));
    }
  };

  const handleDelete = async () => {
    if (deletingRecurring) {
      await deleteRecurringTransaction(deletingRecurring.id);
      setDeletingRecurring(undefined);
      toast.success(t('recurring.toast.deleted'));
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
    } catch (error) {
      toast.error(t('recurring.toast.markPaidError'));
    } finally {
      setMarkingPaidId(null);
    }
  }, [markAsPaid, fetchTransactions, t]);

  const openEditDialog = (recurring: RecurringTransaction) => {
    setEditingRecurring(recurring);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingRecurring(undefined);
  };

  return (
    <AppShell>
      <Header
        title={t('recurring.title')}
        description={t('recurring.subtitle')}
        action={{
          label: t('recurring.addRecurring'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* Recurring Transactions Table */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg text-white">
            {t('recurring.list')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RecurringTable
            recurringTransactions={recurringTransactions}
            onEdit={openEditDialog}
            onDelete={setDeletingRecurring}
            onToggle={handleToggle}
            onMarkPaid={handleMarkPaid}
            isMarkingPaid={markingPaidId}
          />
        </CardContent>
      </Card>

      {/* Recurring Dialog */}
      <RecurringDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        recurring={editingRecurring}
        onSubmit={editingRecurring ? handleUpdate : handleCreate}
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
    </AppShell>
  );
}
