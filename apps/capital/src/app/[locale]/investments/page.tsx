'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  PiggyBank,
  Plus,
  TrendingUp,
  Building2,
  User,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard, InvestmentCard } from '@/components/cards';
import { TransactionsTable } from '@/components/tables';
import { TransactionDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  useBusinessStore,
  useSettingsStore,
} from '@/lib/store';
import { calculateCategoryBreakdown } from '@/lib/utils/calculations';
import { toast } from 'sonner';
import type { Transaction } from '@/types';
import type { CreateTransactionFormData } from '@/lib/validations';

export default function InvestmentsPage() {
  const t = useTranslations();
  const { transactions, addTransaction, updateTransaction, deleteTransaction } =
    useTransactionStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount } = useSettingsStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('all');
  const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>();
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | undefined>();

  // Filter investment transactions
  const investmentTransactions = useMemo(() => {
    let filtered = transactions.filter((t) => t.type === 'investment');
    
    if (selectedEntityId !== 'all') {
      filtered = filtered.filter((t) => t.entityId === selectedEntityId);
    }
    
    return filtered;
  }, [transactions, selectedEntityId]);

  // Calculate totals
  const totals = useMemo(() => {
    const total = investmentTransactions.reduce(
      (sum, t) => sum + t.amount * t.exchangeRate,
      0
    );
    
    const businessTotal = investmentTransactions
      .filter((t) => t.entityType === 'business')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);
    
    const personalTotal = investmentTransactions
      .filter((t) => t.entityType === 'personal')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    return { total, businessTotal, personalTotal };
  }, [investmentTransactions]);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const breakdown = calculateCategoryBreakdown(investmentTransactions);
    const total = totals.total || 1;
    
    return Object.entries(breakdown)
      .map(([category, value]) => ({
        category,
        value,
        percentage: (value / total) * 100,
        count: investmentTransactions.filter((t) => t.category === category).length,
      }))
      .sort((a, b) => b.value - a.value);
  }, [investmentTransactions, totals.total]);

  // Get entity name
  const getEntityName = (entityId: string, entityType: 'business' | 'personal') => {
    if (entityType === 'personal') return t('nav.personal');
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || t('investments.unknownEntity');
  };

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

  const openCreateDialog = (entityId: string, entityType: 'business' | 'personal') => {
    setSelectedEntityId(entityId);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTransaction(undefined);
  };

  // Determine which entity to use for new transactions
  const getDefaultEntity = () => {
    if (selectedEntityId !== 'all') {
      const business = businesses.find((b) => b.id === selectedEntityId);
      if (business) {
        return { id: business.id, type: 'business' as const };
      }
      if (selectedEntityId === personalAccount?.id) {
        return { id: personalAccount.id, type: 'personal' as const };
      }
    }
    // Default to personal account
    return personalAccount
      ? { id: personalAccount.id, type: 'personal' as const }
      : { id: businesses[0]?.id || '', type: 'business' as const };
  };

  const defaultEntity = getDefaultEntity();

  return (
    <AppShell>
      <Header
        title={t('investments.title')}
        description={t('investments.subtitle')}
        action={{
          label: t('investments.addInvestment'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          title={t('investments.totalInvestments')}
          value={totals.total}
          currency={settings.baseCurrency}
          icon={PiggyBank}
          variant="investment"
        />
        <SummaryCard
          title={t('investments.businessInvestments')}
          value={totals.businessTotal}
          currency={settings.baseCurrency}
          icon={Building2}
          variant="default"
        />
        <SummaryCard
          title={t('investments.personalInvestments')}
          value={totals.personalTotal}
          currency={settings.baseCurrency}
          icon={User}
          variant="default"
        />
      </div>

      {/* Portfolio Breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {t('investments.portfolioBreakdown')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categoryBreakdown.map((item) => (
              <InvestmentCard
                key={item.category}
                category={item.category}
                totalValue={item.value}
                currency={settings.baseCurrency}
                transactionCount={item.count}
                percentageOfTotal={item.percentage}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tabs for filtering */}
      <Tabs
        value={selectedEntityId}
        onValueChange={setSelectedEntityId}
        className="space-y-4"
      >
        <TabsList className="border-slate-800 bg-slate-900/50">
          <TabsTrigger
            value="all"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('investments.filters.all')}
          </TabsTrigger>
          {personalAccount && (
            <TabsTrigger
              value={personalAccount.id}
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              {t('nav.personal')}
            </TabsTrigger>
          )}
          {businesses.map((business) => (
            <TabsTrigger
              key={business.id}
              value={business.id}
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              {business.name}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={selectedEntityId}>
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('investments.transactionHistory')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {investmentTransactions.length === 0 ? (
                <div className="py-8 text-center">
                  <PiggyBank className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">{t('investments.empty')}</p>
                  <Button
                    onClick={() => setIsDialogOpen(true)}
                    className="mt-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('investments.addFirst')}
                  </Button>
                </div>
              ) : (
                <TransactionsTable
                  transactions={investmentTransactions}
                  onEdit={(t) => {
                    setEditingTransaction(t);
                    setIsDialogOpen(true);
                  }}
                  onDelete={setDeletingTransaction}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transaction Dialog */}
      <TransactionDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        entityId={editingTransaction?.entityId || defaultEntity.id}
        entityType={editingTransaction?.entityType || defaultEntity.type}
        transaction={editingTransaction}
        defaultType="investment"
        onSubmit={editingTransaction ? handleUpdateTransaction : handleCreateTransaction}
      />

      {/* Delete Confirmation */}
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
    </AppShell>
  );
}
