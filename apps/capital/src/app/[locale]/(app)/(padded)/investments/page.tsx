'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
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
  PiggyBank,
  Plus,
  Pencil,
  Landmark,
  Briefcase,
  Trash2,
  CalendarIcon,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { HoldingsTable } from '@/components/tables/holdings-table';
import { InvestmentTransactionsTable } from '@/components/tables/investment-transactions-table';
import { InvestmentAccountDialog } from '@/components/dialogs/investment-account-dialog';
import { InvestmentHoldingDialog } from '@/components/dialogs/investment-holding-dialog';
import { InvestmentTransactionDialog } from '@/components/dialogs/investment-transaction-dialog';
import { FundWithdrawDialog } from '@/components/dialogs/fund-withdraw-dialog';
import { RebalanceDialog } from '@/components/dialogs/rebalance-dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  useTransferStore,
} from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import { convertToBaseCurrency } from '@/lib/utils/currency';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useDialogForm } from '@/hooks/use-dialog-form';
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
import type { DateRange } from 'react-day-picker';

export default function InvestmentsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
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
    updateTransaction,
    deleteTransaction,
  } = useInvestmentStore();
  const { addTransfer } = useTransferStore();

  // Dialog states
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const [isHoldingDialogOpen, setIsHoldingDialogOpen] = useState(false);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<InvestmentAccount | undefined>();
  const [editingHolding, setEditingHolding] = useState<InvestmentHolding | undefined>();
  const [editingTransaction, setEditingTransaction] = useState<InvestmentTransaction | undefined>();
  const [deletingItem, setDeletingItem] = useState<{ type: 'account' | 'holding' | 'transaction'; id: string } | null>(null);
  const [fundWithdrawAccount, setFundWithdrawAccount] = useState<InvestmentAccount | null>(null);
  const [fundWithdrawMode, setFundWithdrawMode] = useState<'fund' | 'withdraw'>('fund');
  const [rebalancingHolding, setRebalancingHolding] = useState<InvestmentHolding | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState('portfolio');
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  // Filter investment transactions by date range
  const filteredTransactions = useMemo(() => {
    if (!dateRange?.from) return transactions;
    
    const start = startOfDay(dateRange.from);
    const end = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    
    return transactions.filter((t) => {
      const date = new Date(t.date);
      return isWithinInterval(date, { start, end });
    });
  }, [transactions, dateRange]);

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

  // Helper: get the best available value for a holding (market value if available, cost basis otherwise)
  const holdingValue = useCallback(
    (h: InvestmentHolding) =>
      h.currentPrice && h.currentQuantity > 0
        ? h.currentQuantity * h.currentPrice
        : h.totalInvested,
    []
  );

  // Calculate totals (using current market value when available)
  const totals = useMemo(() => {
    const total = holdings.reduce(
      (sum: number, h: InvestmentHolding) => sum + toBase(holdingValue(h), h.currency), 0
    );
    return { total };
  }, [holdings, toBase, holdingValue]);

  // Group holdings by asset class (using current market value)
  const holdingsByAssetClass = useMemo(() => {
    const groups: Record<string, { holdings: InvestmentHolding[]; total: number }> = {};
    for (const h of holdings.filter((h: InvestmentHolding) => h.isActive)) {
      if (!groups[h.assetClass]) {
        groups[h.assetClass] = { holdings: [], total: 0 };
      }
      groups[h.assetClass].holdings.push(h);
      groups[h.assetClass].total += toBase(holdingValue(h), h.currency);
    }
    return groups;
  }, [holdings, toBase, holdingValue]);

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

  // ---- Dialog close helpers (close + clear whichever "editing" state the
  // dialog was showing, so a failed submit leaves it open with the same
  // record still loaded, and a cancel/backdrop dismissal doesn't leave stale
  // "editing" state around for next time the dialog opens in create mode) ----

  const closeAccountDialog = () => {
    setIsAccountDialogOpen(false);
    setEditingAccount(undefined);
  };

  const closeHoldingDialog = () => {
    setIsHoldingDialogOpen(false);
    setEditingHolding(undefined);
  };

  const closeTransactionDialog = () => {
    setIsTransactionDialogOpen(false);
    setEditingTransaction(undefined);
  };

  const closeFundWithdrawDialog = (open: boolean) => {
    if (!open) setFundWithdrawAccount(null);
  };

  const closeRebalanceDialog = (open: boolean) => {
    if (!open) setRebalancingHolding(null);
  };

  // ---- Handlers ----

  const createAccountForm = useDialogForm({
    onOpenChange: setIsAccountDialogOpen,
    action: (data: CreateInvestmentAccountFormData) =>
      addAccount({
        name: data.name,
        broker: data.broker || undefined,
        entityType: data.entityType,
        currency: data.currency,
        businessId: data.entityType === 'business' ? data.entityId : undefined,
        personalAccountId: data.entityType === 'personal' ? data.entityId : undefined,
      }),
    onSuccess: () => toast.success(t('investments.accounts.toast.created')),
    errorMessage: 'Failed to create account',
  });

  const updateAccountForm = useDialogForm({
    onOpenChange: closeAccountDialog,
    action: (data: CreateInvestmentAccountFormData) =>
      editingAccount
        ? updateAccount(editingAccount.id, {
            name: data.name,
            broker: data.broker || undefined,
            currency: data.currency,
          })
        : Promise.resolve(false),
    onSuccess: () => toast.success(t('investments.accounts.toast.updated')),
    errorMessage: 'Failed to update account',
  });

  const handleCreateHolding = async (data: CreateInvestmentHoldingFormData) => {
    const result = await addHolding(data);
    if (!result) return null;

    // If initial position fields are filled, create an initial transaction.
    // The holding row itself already saved at this point, so this is still
    // treated as an overall success (close + success toast) even if this
    // secondary step fails — it just gets its own separate error toast.
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
      } else {
        fetchPortfolioSummary();
      }
    }

    return result;
  };

  const createHoldingForm = useDialogForm({
    onOpenChange: setIsHoldingDialogOpen,
    action: handleCreateHolding,
    onSuccess: () => toast.success(t('investments.holdings.toast.created')),
    errorMessage: 'Failed to create holding',
  });

  const updateHoldingForm = useDialogForm({
    onOpenChange: closeHoldingDialog,
    action: (data: CreateInvestmentHoldingFormData) =>
      editingHolding
        ? updateHolding(editingHolding.id, {
            name: data.name,
            ticker: data.ticker,
            assetClass: data.assetClass,
            subType: data.subType,
            currency: data.currency,
          })
        : Promise.resolve(false),
    onSuccess: () => toast.success(t('investments.holdings.toast.updated')),
    errorMessage: 'Failed to update holding',
  });

  const handleCreateTransaction = async (data: CreateInvestmentTransactionFormData) => {
    const result = await addTransaction(data);
    if (result) {
      fetchPortfolioSummary();
    }
    return result;
  };

  const createTransactionForm = useDialogForm({
    onOpenChange: closeTransactionDialog,
    action: handleCreateTransaction,
    onSuccess: () => toast.success(t('investments.transactions.toast.created')),
    errorMessage: 'Failed to create transaction',
  });

  const handleUpdateTransaction = async (data: CreateInvestmentTransactionFormData) => {
    if (!editingTransaction) return false;
    const success = await updateTransaction(editingTransaction.id, {
      type: data.type,
      quantity: data.quantity,
      pricePerUnit: data.pricePerUnit,
      totalAmount: data.totalAmount,
      fees: data.fees,
      date: data.date,
      notes: data.notes,
    });
    if (success) {
      fetchPortfolioSummary();
    }
    return success;
  };

  const updateTransactionForm = useDialogForm({
    onOpenChange: closeTransactionDialog,
    action: handleUpdateTransaction,
    onSuccess: () => toast.success(t('investments.transactions.toast.updated')),
    errorMessage: 'Failed to update transaction',
  });

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

  const handleFundWithdraw = async (
    accountId: string,
    data: { amount: number; currency: string; exchangeRate?: number; description?: string; date: Date }
  ) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return false;

    const isFund = fundWithdrawMode === 'fund';

    const result = await addTransfer({
      direction: isFund ? 'investment_deposit' : 'investment_withdrawal',
      amount: data.amount,
      currency: data.currency,
      exchangeRate: data.exchangeRate,
      description: data.description,
      date: data.date,
      // Entity side
      fromEntityId: isFund ? account.entityId : '',
      fromEntityType: isFund ? account.entityType : account.entityType,
      toEntityId: isFund ? '' : account.entityId,
      toEntityType: isFund ? account.entityType : account.entityType,
      // Investment account side
      toInvestmentAccountId: isFund ? accountId : undefined,
      fromInvestmentAccountId: isFund ? undefined : accountId,
    });

    if (result) {
      toast.success(
        isFund
          ? t('investments.fund.toast.success')
          : t('investments.withdraw.toast.success')
      );
      fetchAccounts();
      fetchPortfolioSummary();
    } else {
      toast.error(
        isFund
          ? t('investments.fund.toast.error')
          : t('investments.withdraw.toast.error')
      );
    }
    return !!result;
  };

  // handleFundWithdraw already shows its own success/error toast above, so
  // this only needs the hook for the shared loading + close-on-success wiring.
  const fundWithdrawForm = useDialogForm({
    onOpenChange: closeFundWithdrawDialog,
    action: (payload: {
      accountId: string;
      data: { amount: number; currency: string; exchangeRate?: number; description?: string; date: Date };
    }) => handleFundWithdraw(payload.accountId, payload.data),
  });

  const handleRebalance = async (holdingId: string, adjustmentAmount: number) => {
    const result = await addTransaction({
      holdingId,
      type: 'adjustment',
      totalAmount: adjustmentAmount,
      fees: 0,
      date: new Date(),
      notes: t('investments.rebalance.transactionNote'),
    });
    if (result) {
      toast.success(t('investments.rebalance.toast.success'));
      fetchPortfolioSummary();
      return true;
    }
    toast.error(t('investments.rebalance.toast.error'));
    return false;
  };

  // handleRebalance already shows its own success/error toast above, so this
  // only needs the hook for the shared loading + close-on-success wiring.
  const rebalanceForm = useDialogForm({
    onOpenChange: closeRebalanceDialog,
    action: (payload: { holdingId: string; adjustmentAmount: number }) =>
      handleRebalance(payload.holdingId, payload.adjustmentAmount),
  });

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
    <>
      <Header
        title={t('investments.title')}
        description={t('investments.subtitle')}
        action={getHeaderAction()}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('investments.portfolioValue')}
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
                  onRebalance={(h) => setRebalancingHolding(h)}
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
                      (sum, h) => sum + holdingValue(h),
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
                          {/* Cash Balance */}
                          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-700/30 px-2.5 py-1.5">
                            <span className="text-xs text-slate-400">{t('investments.accounts.cashBalance')}:</span>
                            <span className="text-xs font-semibold text-emerald-400">
                              {formatCurrency(account.cashBalance, account.currency)}
                            </span>
                          </div>
                          {/* Fund / Withdraw buttons */}
                          <div className="mt-3 flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                              onClick={() => {
                                setFundWithdrawAccount(account);
                                setFundWithdrawMode('fund');
                              }}
                            >
                              <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                              {t('investments.fund.button')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                              onClick={() => {
                                setFundWithdrawAccount(account);
                                setFundWithdrawMode('withdraw');
                              }}
                            >
                              <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" />
                              {t('investments.withdraw.button')}
                            </Button>
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
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
              </div>

              {/* Date Filters */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
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
                  {t('investments.filter.thisMonth')}
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
                  {t('investments.filter.lastMonth')}
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
                        t('investments.filter.selectDates')
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
                  transactions={filteredTransactions}
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
        onOpenChange={closeAccountDialog}
        account={editingAccount}
        onSubmit={editingAccount ? updateAccountForm.submit : createAccountForm.submit}
        isLoading={editingAccount ? updateAccountForm.isSubmitting : createAccountForm.isSubmitting}
      />

      <InvestmentHoldingDialog
        open={isHoldingDialogOpen}
        onOpenChange={closeHoldingDialog}
        holding={editingHolding}
        onSubmit={editingHolding ? updateHoldingForm.submit : createHoldingForm.submit}
        isLoading={editingHolding ? updateHoldingForm.isSubmitting : createHoldingForm.isSubmitting}
      />

      <InvestmentTransactionDialog
        open={isTransactionDialogOpen}
        onOpenChange={closeTransactionDialog}
        transaction={editingTransaction}
        onSubmit={editingTransaction ? updateTransactionForm.submit : createTransactionForm.submit}
        isLoading={editingTransaction ? updateTransactionForm.isSubmitting : createTransactionForm.isSubmitting}
      />

      <FundWithdrawDialog
        open={!!fundWithdrawAccount}
        onOpenChange={closeFundWithdrawDialog}
        account={fundWithdrawAccount}
        mode={fundWithdrawMode}
        onSubmit={(accountId, data) => fundWithdrawForm.submit({ accountId, data })}
        isLoading={fundWithdrawForm.isSubmitting}
      />

      <RebalanceDialog
        open={!!rebalancingHolding}
        onOpenChange={closeRebalanceDialog}
        holding={rebalancingHolding}
        onSubmit={(holdingId, adjustmentAmount) => rebalanceForm.submit({ holdingId, adjustmentAmount })}
        isLoading={rebalanceForm.isSubmitting}
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
    </>
  );
}
