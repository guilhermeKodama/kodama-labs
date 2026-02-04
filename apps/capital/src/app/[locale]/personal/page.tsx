'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  User,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { ActivityTable } from '@/components/tables';
import { TransactionDialog } from '@/components/dialogs';
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
  useTransactionStore,
  useTransferStore,
  useSettingsStore,
  useBusinessStore,
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { toast } from 'sonner';
import type { Transaction, Transfer } from '@/types';
import type { CreateTransactionFormData } from '@/lib/validations';

export default function PersonalPage() {
  const t = useTranslations();
  const { transactions, addTransaction, updateTransaction, deleteTransaction } =
    useTransactionStore();
  const { transfers, deleteTransfer } = useTransferStore();
  const { settings, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | undefined>();
  const [deletingTransfer, setDeletingTransfer] = useState<Transfer | undefined>();

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

  // Build entity names map for display
  const entityNames = useMemo(() => {
    const names: Record<string, string> = {};
    businesses.forEach((b) => {
      names[b.id] = b.name;
    });
    if (personalAccount) {
      names[personalAccount.id] = t('nav.personal');
    }
    return names;
  }, [businesses, personalAccount, t]);

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
      <Header
        title={t('personal.title')}
        description={t('personal.subtitle')}
        action={{
          label: t('transactions.addTransaction'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      {summary && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            title={t('personal.netWorth')}
            value={summary.netWorth}
            currency={settings.baseCurrency}
            icon={Wallet}
            variant="default"
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
            title={t('transactions.summary.investments')}
            value={summary.totalInvestments}
            currency={settings.baseCurrency}
            icon={PiggyBank}
            variant="investment"
          />
        </div>
      )}

      {/* Activity (Transactions + Transfers) */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg text-white">
            {t('activity.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTable
            transactions={personalTransactions}
            transfers={personalTransfers}
            entityId={personalAccount.id}
            entityType="personal"
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
        entityId={personalAccount.id}
        entityType="personal"
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
