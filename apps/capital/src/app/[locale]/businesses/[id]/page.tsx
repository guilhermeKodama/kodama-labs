'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Plus,
  Building2,
  TrendingUp,
  TrendingDown,
  PiggyBank,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { SummaryCard } from '@/components/cards';
import { ActivityTable } from '@/components/tables';
import { TransactionDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
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
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { toast } from 'sonner';
import type { Transaction, Transfer } from '@/types';
import type { CreateTransactionFormData } from '@/lib/validations';

export default function BusinessDetailPage() {
  const t = useTranslations();
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

  const handleCreateTransaction = (data: CreateTransactionFormData) => {
    addTransaction(data);
    toast.success(t('transactions.toast.created'));
  };

  const handleUpdateTransaction = (data: CreateTransactionFormData) => {
    if (editingTransaction) {
      updateTransaction(editingTransaction.id, data);
      setEditingTransaction(undefined);
      toast.success(t('transactions.toast.updated'));
    }
  };

  const handleDeleteTransaction = () => {
    if (deletingTransaction) {
      deleteTransaction(deletingTransaction.id);
      setDeletingTransaction(undefined);
      toast.success(t('transactions.toast.deleted'));
    }
  };

  const handleDeleteTransfer = () => {
    if (deletingTransfer) {
      deleteTransfer(deletingTransfer.id);
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
            transactions={businessTransactions}
            transfers={businessTransfers}
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
