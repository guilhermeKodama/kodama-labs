'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  PiggyBank,
  Plus,
  Pencil,
  Landmark,
  Briefcase,
  Trash2,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { HoldingsTable } from '@/components/tables/holdings-table';
import { InvestmentTransactionsTable } from '@/components/tables/investment-transactions-table';
import { InvestmentAccountDialog } from '@/components/dialogs/investment-account-dialog';
import { InvestmentHoldingDialog } from '@/components/dialogs/investment-holding-dialog';
import { InvestmentTransactionDialog } from '@/components/dialogs/investment-transaction-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
  useInvestmentStore,
  useSettingsStore,
  useBusinessStore,
} from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import { convertToBaseCurrency } from '@/lib/utils/currency';
import { toast } from 'sonner';
import type {
  InvestmentAccount,
  InvestmentHolding,
  InvestmentTransaction,
  AssetClass,
} from '@/types';
import type {
  CreateInvestmentAccountFormData,
  CreateInvestmentHoldingFormData,
  CreateInvestmentTransactionFormData,
} from '@/lib/validations';

export default function InvestmentsPage() {
  const t = useTranslations();
  const { settings, currencies } = useSettingsStore();
  const { businesses } = useBusinessStore();
  const {
    accounts,
    holdings,
    transactions,
    fetchAccounts,
    fetchHoldings,
    fetchTransactions,
    fetchPortfolioSummary,
    addAccount,
    updateAccount,
    deleteAccount,
    addHolding,
    updateHolding,
    deleteHolding,
    addTransaction,
    deleteTransaction,
  } = useInvestmentStore();

  // Dialog states
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [isHoldingDialogOpen, setIsHoldingDialogOpen] = useState(false);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<InvestmentAccount | undefined>();
  const [editingHolding, setEditingHolding] = useState<InvestmentHolding | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<InvestmentTransaction | undefined>();
  const [deletingItem, setDeletingItem] = useState<{ type: 'account' | 'holding' | 'transaction'; id: string } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState('portfolio');

  // Fetch data on mount
  useEffect(() => {
    fetchAccounts();
    fetchHoldings();
    fetchTransactions();
    fetchPortfolioSummary();
  }, [fetchAccounts, fetchHoldings, fetchTransactions, fetchPortfolioSummary]);

  // Helper: convert holding amount to base currency
  const toBase = useCallback(
    (amount: number, holdingCurrency: string) =>
      convertToBaseCurrency(amount, holdingCurrency, currencies, settings.baseCurrency),
    [currencies, settings.baseCurrency]
  );

  // Calculate totals
  const totals = useMemo(() => {
    const total = holdings.reduce(
      (sum: number, h: InvestmentHolding) => sum + toBase(h.totalInvested, h.currency), 0
    );
    return { total };
  }, [holdings, toBase]);

  // Group holdings by asset class
  const holdingsByAssetClass = useMemo(() => {
    const groups: Record<string, { holdings: InvestmentHolding[]; total: number }> = {};
    for (const h of holdings.filter((h: InvestmentHolding) => h.isActive)) {
      if (!groups[h.assetClass]) {
        groups[h.assetClass] = { holdings: [], total: 0 };
      }
      groups[h.assetClass].holdings.push(h);
      groups[h.assetClass].total += toBase(h.totalInvested, h.currency);
    }
    return groups;
  }, [holdings, toBase]);

  // Asset class breakdown for summary cards
  const assetClassBreakdown = useMemo(() => {
    return Object.entries(holdingsByAssetClass)
      .map(([assetClass, data]) => ({
        assetClass: assetClass as AssetClass,
        total: data.total,
        count: data.holdings.length,
        percentage: totals.total > 0 ? (data.total / totals.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [holdingsByAssetClass, totals.total]);

  // ---- Handlers ----

  const handleCreateAccount = async (data: CreateInvestmentAccountFormData) => {
    const result = await addAccount({
      name: data.name,
      broker: data.broker || undefined,
      entityType: data.entityType,
      currency: data.currency,
      businessId: data.entityType === 'business' ? data.entityId : undefined,
      personalAccountId: data.entityType === 'personal' ? data.entityId : undefined,
    });
    if (result) {
      toast.success(t('investments.accounts.toast.created'));
    } else {
      toast.error('Failed to create account');
    }
  };

  const handleUpdateAccount = async (data: CreateInvestmentAccountFormData) => {
    if (editingAccount) {
      await updateAccount(editingAccount.id, {
        name: data.name,
        broker: data.broker || undefined,
        currency: data.currency,
      });
      setEditingAccount(undefined);
      toast.success(t('investments.accounts.toast.updated'));
    }
  };

  const handleCreateHolding = async (data: CreateInvestmentHoldingFormData) => {
    const result = await addHolding(data);
    if (!result) {
      toast.error('Failed to create holding');
      return;
    }

    // If initial position fields are filled, create an initial transaction
    if (data.initialAmount && data.initialAmount > 0) {
      const isTickerAsset = ['stocks', 'fii', 'etf', 'bdr', 'crypto', 'international_stocks', 'international_etf'].includes(data.assetClass);
      const txResult = await addTransaction({
        holdingId: result.id,
        type: isTickerAsset ? 'buy' : 'deposit',
        quantity: data.initialQuantity,
        pricePerUnit: data.initialPricePerUnit,
        totalAmount: data.initialAmount,
        fees: 0,
        date: data.initialDate || new Date(),
      });
      if (!txResult) {
        toast.error('Holding created but failed to set initial position');
        return;
      }
      fetchPortfolioSummary();
    }

    toast.success(t('investments.holdings.toast.created'));
  };

  const handleUpdateHolding = async (data: CreateInvestmentHoldingFormData) => {
    if (editingHolding) {
      await updateHolding(editingHolding.id, {
        name: data.name,
        ticker: data.ticker,
        assetClass: data.assetClass,
        subType: data.subType,
        currency: data.currency,
      });
      setEditingHolding(undefined);
      toast.success(t('investments.holdings.toast.updated'));
    }
  };

  const handleCreateTransaction = async (data: CreateInvestmentTransactionFormData) => {
    const result = await addTransaction(data);
    if (result) {
      toast.success(t('investments.transactions.toast.created'));
      fetchPortfolioSummary();
    } else {
      toast.error('Failed to create transaction');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingItem) return;

    switch (deletingItem.type) {
      case 'account':
        await deleteAccount(deletingItem.id);
        toast.success(t('investments.accounts.toast.deleted'));
        break;
      case 'holding':
        await deleteHolding(deletingItem.id);
        toast.success(t('investments.holdings.toast.deleted'));
        break;
      case 'transaction':
        await deleteTransaction(deletingItem.id);
        toast.success(t('investments.transactions.toast.deleted'));
        break;
    }
    setDeletingItem(null);
    fetchPortfolioSummary();
  };

  // ---- Action buttons for header ----
  const getHeaderAction = () => {
    switch (activeTab) {
      case 'portfolio':
        return {
          label: t('investments.holdings.addHolding'),
          onClick: () => setIsHoldingDialogOpen(true),
        };
      case 'accounts':
        return {
          label: t('investments.accounts.addAccount'),
          onClick: () => setIsAccountDialogOpen(true),
        };
      case 'transactions':
        return {
          label: t('investments.transactions.addTransaction'),
          onClick: () => setIsTransactionDialogOpen(true),
        };
      default:
        return {
          label: t('investments.addInvestment'),
          onClick: () => setIsTransactionDialogOpen(true),
        };
    }
  };

  return (
    <AppShell>
      <Header
        title={t('investments.title')}
        description={t('investments.subtitle')}
        action={getHeaderAction()}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('investments.totalInvested')}
          value={totals.total}
          currency={settings.baseCurrency}
          icon={PiggyBank}
          variant="investment"
        />
        <SummaryCard
          title={t('investments.holdingsCount', { count: holdings.filter((h: InvestmentHolding) => h.isActive).length })}
          value={holdings.filter((h) => h.isActive).length}
          icon={Briefcase}
          variant="default"
          isCount
        />
        <SummaryCard
          title={t('investments.accountsCount', { count: accounts.filter((a) => a.isActive).length })}
          value={accounts.filter((a) => a.isActive).length}
          icon={Landmark}
          variant="default"
          isCount
        />
        <SummaryCard
          title={t('investments.transactionHistory')}
          value={transactions.length}
          icon={Landmark}
          variant="default"
          isCount
        />
      </div>

      {/* Asset Class Breakdown */}
      {assetClassBreakdown.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {t('investments.portfolioBreakdown')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {assetClassBreakdown.map((item) => (
              <Card
                key={item.assetClass}
                className="border-slate-800 bg-slate-900/50 backdrop-blur-sm transition-all hover:border-slate-700"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-400">
                        {t(`investments.assetClasses.${item.assetClass}`)}
                      </p>
                      <p className="mt-1 text-xl font-bold text-white">
                        {formatCurrency(item.total, settings.baseCurrency)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.count} {item.count === 1 ? 'holding' : 'holdings'}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-blue-500/50 bg-blue-500/10 text-blue-400"
                    >
                      {item.percentage.toFixed(1)}%
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="border-slate-800 bg-slate-900/50">
          <TabsTrigger
            value="portfolio"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('investments.tabs.portfolio')}
          </TabsTrigger>
          <TabsTrigger
            value="accounts"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('investments.tabs.accounts')}
          </TabsTrigger>
          <TabsTrigger
            value="transactions"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('investments.tabs.transactions')}
          </TabsTrigger>
        </TabsList>

        {/* Portfolio Tab - Holdings */}
        <TabsContent value="portfolio">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg text-white">
                {t('investments.holdings.title')}
              </CardTitle>
              <Button
                onClick={() => setIsHoldingDialogOpen(true)}
                size="sm"
                className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('investments.holdings.addHolding')}
              </Button>
            </CardHeader>
            <CardContent>
              {holdings.filter((h) => h.isActive).length === 0 ? (
                <div className="py-8 text-center">
                  <PiggyBank className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">{t('investments.holdings.empty')}</p>
                  <Button
                    onClick={() => setIsHoldingDialogOpen(true)}
                    className="mt-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('investments.holdings.addFirst')}
                  </Button>
                </div>
              ) : (
                <HoldingsTable
                  holdings={holdings.filter((h) => h.isActive)}
                  onEdit={(h) => {
                    setEditingHolding(h);
                    setIsHoldingDialogOpen(true);
                  }}
                  onDelete={(h) => setDeletingItem({ type: 'holding', id: h.id })}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accounts Tab */}
        <TabsContent value="accounts">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg text-white">
                {t('investments.accounts.title')}
              </CardTitle>
              <Button
                onClick={() => setIsAccountDialogOpen(true)}
                size="sm"
                className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('investments.accounts.addAccount')}
              </Button>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <div className="py-8 text-center">
                  <Landmark className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">{t('investments.accounts.empty')}</p>
                  <Button
                    onClick={() => setIsAccountDialogOpen(true)}
                    className="mt-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('investments.accounts.addFirst')}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {accounts.map((account) => {
                    const accountHoldings = holdings.filter(
                      (h) => h.accountId === account.id && h.isActive
                    );
                    const accountTotal = accountHoldings.reduce(
                      (sum, h) => sum + h.totalInvested,
                      0
                    );

                    return (
                      <Card
                        key={account.id}
                        className="border-slate-800 bg-slate-800/50 transition-all hover:border-slate-700"
                      >
                        <CardContent className="p-5">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-semibold text-white">{account.name}</h3>
                              {account.broker && (
                                <p className="text-xs text-slate-500">{account.broker}</p>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-white"
                                onClick={() => {
                                  setEditingAccount(account);
                                  setIsAccountDialogOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-red-400"
                                onClick={() =>
                                  setDeletingItem({ type: 'account', id: account.id })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3">
                            <p className="text-2xl font-bold text-white">
                              {formatCurrency(accountTotal, account.currency)}
                            </p>
                            <p className="text-xs text-slate-500">
                              {accountHoldings.length} holdings
                            </p>
                          </div>
                          <div className="mt-2">
                            <Badge
                              variant="outline"
                              className={
                                account.entityType === 'personal'
                                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                  : 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                              }
                            >
                              {account.entityType === 'personal'
                                ? t('nav.personal')
                                : businesses.find((b) => b.id === account.entityId)?.name || 'Business'}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg text-white">
                {t('investments.transactions.title')}
              </CardTitle>
              <Button
                onClick={() => setIsTransactionDialogOpen(true)}
                size="sm"
                className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('investments.transactions.addTransaction')}
              </Button>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <div className="py-8 text-center">
                  <PiggyBank className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">{t('investments.transactions.empty')}</p>
                  <Button
                    onClick={() => setIsTransactionDialogOpen(true)}
                    className="mt-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('investments.transactions.addFirst')}
                  </Button>
                </div>
              ) : (
                <InvestmentTransactionsTable
                  transactions={transactions}
                  onEdit={(tx) => {
                    setEditingTransaction(tx);
                    setIsTransactionDialogOpen(true);
                  }}
                  onDelete={(tx) =>
                    setDeletingItem({ type: 'transaction', id: tx.id })
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <InvestmentAccountDialog
        open={isAccountDialogOpen}
        onOpenChange={(open) => {
          setIsAccountDialogOpen(open);
          if (!open) setEditingAccount(undefined);
        }}
        account={editingAccount}
        onSubmit={editingAccount ? handleUpdateAccount : handleCreateAccount}
      />

      <InvestmentHoldingDialog
        open={isHoldingDialogOpen}
        onOpenChange={(open) => {
          setIsHoldingDialogOpen(open);
          if (!open) setEditingHolding(undefined);
        }}
        holding={editingHolding}
        onSubmit={editingHolding ? handleUpdateHolding : handleCreateHolding}
      />

      <InvestmentTransactionDialog
        open={isTransactionDialogOpen}
        onOpenChange={(open) => {
          setIsTransactionDialogOpen(open);
          if (!open) setEditingTransaction(undefined);
        }}
        transaction={editingTransaction}
        onSubmit={handleCreateTransaction}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingItem}
        onOpenChange={() => setDeletingItem(null)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('investments.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('investments.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
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
