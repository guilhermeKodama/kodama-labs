'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { format, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import {
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Wallet,
  Download,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Briefcase,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { MonthlyReportTable } from '@/components/tables';
import { EntityFilterBar } from '@/components/filters/entity-filter-bar';
import {
  CategoryPieChart,
  IncomeExpenseChart,
  BalanceLineChart,
  CashFlowChart,
  EntityComparisonChart,
  CurrencyDistributionChart,
} from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  useTransactionStore,
  useTransferStore,
  useBusinessStore,
  useSettingsStore,
  useInvestmentStore,
} from '@/lib/store';
import {
  calculateCategoryBreakdown,
  sumTransactionsByType,
  sumReimbursementExpenses,
  calculateGrowthRate,
} from '@/lib/utils/calculations';
import { exportTransactionsToCSV } from '@/lib/utils/export';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { convertToBaseCurrency } from '@/lib/utils/currency';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TransactionType, InvestmentHolding, AssetClass } from '@/types';

export default function ReportsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount, currencies } = useSettingsStore();
  const {
    holdings,
    fetchHoldings,
    fetchAccounts,
  } = useInvestmentStore();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedView, setSelectedView] = useState<'monthly' | 'categories' | 'insights' | 'portfolio'>('monthly');
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());

  // Fetch investment data on mount
  useEffect(() => {
    fetchHoldings();
    fetchAccounts();
  }, [fetchHoldings, fetchAccounts]);
  const [selectedType, setSelectedType] = useState<TransactionType | 'all'>('all');

  // Prepare entities list (needed for filter bar and comparison chart)
  const allEntities = useMemo(() => {
    const entities: Array<{ id: string; name: string; type: 'business' | 'personal'; color?: string }> = [];
    
    businesses.forEach((b) => {
      entities.push({
        id: b.id,
        name: b.name,
        type: 'business',
        color: b.color,
      });
    });

    if (personalAccount) {
      entities.push({
        id: personalAccount.id,
        name: t('nav.personal'),
        type: 'personal',
        color: '#8b5cf6',
      });
    }

    return entities;
  }, [businesses, personalAccount, t]);

  const isEntityFiltered = selectedEntityIds.size > 0;

  // Helper to check if a transaction passes the entity filter
  const matchesEntityFilter = useCallback(
    (entityId: string) => !isEntityFiltered || selectedEntityIds.has(entityId),
    [isEntityFiltered, selectedEntityIds]
  );

  // Filter transactions by year and entity
  const yearTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const date = new Date(t.date);
      return date.getFullYear() === selectedYear && matchesEntityFilter(t.entityId);
    });
  }, [transactions, selectedYear, matchesEntityFilter]);

  // Previous year transactions for comparison (also entity-filtered)
  const prevYearTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const date = new Date(t.date);
      return date.getFullYear() === selectedYear - 1 && matchesEntityFilter(t.entityId);
    });
  }, [transactions, selectedYear, matchesEntityFilter]);

  // Entity-filtered transactions for Insights charts (all years)
  const filteredTransactions = useMemo(() => {
    if (!isEntityFiltered) return transactions;
    return transactions.filter((t) => matchesEntityFilter(t.entityId));
  }, [transactions, isEntityFiltered, matchesEntityFilter]);

  // Entity-filtered transfers for Insights charts
  const filteredTransfers = useMemo(() => {
    if (!isEntityFiltered) return transfers;
    return transfers.filter((t) =>
      matchesEntityFilter(t.fromEntityId) || matchesEntityFilter(t.toEntityId)
    );
  }, [transfers, isEntityFiltered, matchesEntityFilter]);

  // Reimbursement transfers filtered by year and entity (treated as business expenses)
  const yearReimbursements = useMemo(() => {
    return transfers.filter((t) => {
      if (t.direction !== 'reimbursement') return false;
      const date = new Date(t.date);
      if (date.getFullYear() !== selectedYear) return false;
      return !isEntityFiltered || selectedEntityIds.has(t.fromEntityId);
    });
  }, [transfers, selectedYear, isEntityFiltered, selectedEntityIds]);

  const prevYearReimbursements = useMemo(() => {
    return transfers.filter((t) => {
      if (t.direction !== 'reimbursement') return false;
      const date = new Date(t.date);
      if (date.getFullYear() !== selectedYear - 1) return false;
      return !isEntityFiltered || selectedEntityIds.has(t.fromEntityId);
    });
  }, [transfers, selectedYear, isEntityFiltered, selectedEntityIds]);

  // Calculate yearly totals (including reimbursement expenses)
  const yearlyTotals = useMemo(() => {
    const income = sumTransactionsByType(yearTransactions, 'income');
    const reimbursementExp = sumReimbursementExpenses(yearReimbursements);
    const expense = sumTransactionsByType(yearTransactions, 'expense') + reimbursementExp;
    const investment = sumTransactionsByType(yearTransactions, 'investment');
    return {
      income,
      expense,
      investment,
      balance: income - expense,
    };
  }, [yearTransactions, yearReimbursements]);

  // Calculate previous year totals for growth comparison
  const prevYearTotals = useMemo(() => {
    const income = sumTransactionsByType(prevYearTransactions, 'income');
    const expense = sumTransactionsByType(prevYearTransactions, 'expense') + sumReimbursementExpenses(prevYearReimbursements);
    return { income, expense };
  }, [prevYearTransactions, prevYearReimbursements]);

  // Calculate growth rates
  const growthRates = useMemo(() => ({
    income: calculateGrowthRate(yearlyTotals.income, prevYearTotals.income),
    expense: calculateGrowthRate(yearlyTotals.expense, prevYearTotals.expense),
  }), [yearlyTotals, prevYearTotals]);

  // Calculate monthly data (including reimbursement expenses)
  const monthlyData = useMemo(() => {
    const months = eachMonthOfInterval({
      start: startOfYear(new Date(selectedYear, 0, 1)),
      end: endOfYear(new Date(selectedYear, 0, 1)),
    });

    return months.map((month) => {
      const monthTransactions = yearTransactions.filter((t) => {
        const date = new Date(t.date);
        return date.getMonth() === month.getMonth();
      });

      const monthReimbursements = yearReimbursements.filter((t) => {
        const date = new Date(t.date);
        return date.getMonth() === month.getMonth();
      });

      const income = sumTransactionsByType(monthTransactions, 'income');
      const reimbursementExp = sumReimbursementExpenses(monthReimbursements);
      const expense = sumTransactionsByType(monthTransactions, 'expense') + reimbursementExp;
      const investment = sumTransactionsByType(monthTransactions, 'investment');

      return {
        month: format(month, 'MMM', { locale: dateLocale }),
        income,
        expense,
        investment,
        balance: income - expense,
      };
    });
  }, [yearTransactions, yearReimbursements, selectedYear, dateLocale]);

  // Calculate category breakdown (reimbursements appear under expenses)
  const categoryBreakdown = useMemo(() => {
    const filtered =
      selectedType === 'all'
        ? yearTransactions
        : yearTransactions.filter((t) => t.type === selectedType);

    const breakdown = calculateCategoryBreakdown(filtered);

    if (selectedType === 'all' || selectedType === 'expense') {
      const reimbursementTotal = sumReimbursementExpenses(yearReimbursements);
      if (reimbursementTotal > 0) {
        const label = t('transfers.directions.reimbursement');
        breakdown[label] = (breakdown[label] || 0) + reimbursementTotal;
      }
    }

    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [yearTransactions, yearReimbursements, selectedType, t]);

  // Income vs Expense breakdown
  const incomeBreakdown = useMemo(() => {
    const breakdown = calculateCategoryBreakdown(
      yearTransactions.filter((t) => t.type === 'income')
    );
    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [yearTransactions]);

  const expenseBreakdown = useMemo(() => {
    const breakdown = calculateCategoryBreakdown(
      yearTransactions.filter((t) => t.type === 'expense')
    );
    const reimbursementTotal = sumReimbursementExpenses(yearReimbursements);
    if (reimbursementTotal > 0) {
      const label = t('transfers.directions.reimbursement');
      breakdown[label] = (breakdown[label] || 0) + reimbursementTotal;
    }
    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [yearTransactions, yearReimbursements, t]);

  // ---- Portfolio data ----
  const activeHoldings = useMemo(
    () => holdings.filter((h: InvestmentHolding) => h.isActive),
    [holdings]
  );

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

  const portfolioTotals = useMemo(() => {
    const totalInvested = activeHoldings.reduce(
      (sum: number, h: InvestmentHolding) => sum + toBase(h.totalInvested, h.currency), 0
    );
    const holdingsWithPrice = activeHoldings.filter(
      (h: InvestmentHolding) => h.currentPrice && h.currentQuantity > 0
    );
    const currentValue = holdingsWithPrice.reduce(
      (sum: number, h: InvestmentHolding) =>
        sum + toBase(h.currentQuantity * (h.currentPrice || 0), h.currency),
      0
    );
    // For holdings without price, assume current = invested
    const noPrice = activeHoldings.filter(
      (h: InvestmentHolding) => !h.currentPrice || h.currentQuantity <= 0
    );
    const noPriceTotal = noPrice.reduce(
      (sum: number, h: InvestmentHolding) => sum + toBase(h.totalInvested, h.currency), 0
    );
    const totalCurrentValue = currentValue + noPriceTotal;
    const totalPnL = totalCurrentValue - totalInvested;
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    return { totalInvested, totalCurrentValue, totalPnL, totalPnLPercent, hasPriceData: holdingsWithPrice.length > 0 };
  }, [activeHoldings, toBase]);

  const assetAllocationData = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const h of activeHoldings) {
      const assetKey = h.assetClass as AssetClass;
      const label = t(`investments.assetClasses.${assetKey}` as any) || h.assetClass;
      groups[label] = (groups[label] || 0) + toBase(holdingValue(h), h.currency);
    }
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeHoldings, toBase, holdingValue, t]);

  const accountBreakdownData = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const h of activeHoldings) {
      const accountName = h.account?.name || t('transfers.table.unknownEntity');
      groups[accountName] = (groups[accountName] || 0) + toBase(holdingValue(h), h.currency);
    }
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeHoldings, toBase, holdingValue, t]);

  const currencyBreakdownData = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const h of activeHoldings) {
      const currency = h.currency || t('transfers.table.unknownEntity');
      // For currency exposure, convert to base so percentages are comparable
      groups[currency] = (groups[currency] || 0) + toBase(holdingValue(h), h.currency);
    }
    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeHoldings, toBase, holdingValue, t]);

  const holdingsPerformance = useMemo(() => {
    return activeHoldings
      .filter((h: InvestmentHolding) => h.currentPrice && h.currentQuantity > 0 && h.totalInvested > 0)
      .map((h: InvestmentHolding) => {
        const currentValue = h.currentQuantity * (h.currentPrice || 0);
        const investedInBase = toBase(h.totalInvested, h.currency);
        const currentInBase = toBase(currentValue, h.currency);
        const pnl = currentInBase - investedInBase;
        const pnlPercent = investedInBase > 0 ? (pnl / investedInBase) * 100 : 0;
        return { ...h, currentValue: currentInBase, investedInBase, pnl, pnlPercent };
      })
      .sort((a, b) => b.pnlPercent - a.pnlPercent);
  }, [activeHoldings, toBase]);

  const handleExportCSV = () => {
    if (yearTransactions.length === 0) {
      toast.error(t('reports.export.noData'));
      return;
    }

    const entityNames: Record<string, string> = {};
    allEntities.forEach((e) => {
      entityNames[e.id] = e.name;
    });

    exportTransactionsToCSV(
      yearTransactions,
      entityNames,
      `capital-report-${selectedYear}.csv`
    );
    toast.success(t('reports.export.success'));
  };

  // Available years (from transactions)
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    transactions.forEach((t) => {
      years.add(new Date(t.date).getFullYear());
    });
    // Always include current year
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const hasData = yearTransactions.length > 0;
  const hasMultipleEntities = allEntities.length > 1;
  const hasMultipleCurrencies = currencies.length > 1;

  // Top expense category
  const topExpenseCategory = expenseBreakdown.length > 0 ? expenseBreakdown[0] : null;
  // Top income category
  const topIncomeCategory = incomeBreakdown.length > 0 ? incomeBreakdown[0] : null;

  return (
    <AppShell>
      <Header
        title={t('reports.title')}
        description={t('reports.subtitle')}
      />

      {/* Year selector and export */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedYear(selectedYear - 1)}
            disabled={selectedYear <= Math.min(...availableYears, currentYear - 5)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[100px] text-center text-lg font-semibold text-white">
            {selectedYear}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedYear(selectedYear + 1)}
            disabled={selectedYear >= currentYear}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Download className="mr-2 h-4 w-4" />
          {t('reports.export.button')}
        </Button>
      </div>

      {/* Entity Filter */}
      {allEntities.length > 1 && (
        <div className="mb-6">
          <EntityFilterBar
            entities={allEntities}
            selectedEntityIds={selectedEntityIds}
            onSelectionChange={setSelectedEntityIds}
          />
        </div>
      )}

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('reports.yearlyBalance')}
          value={yearlyTotals.balance}
          currency={settings.baseCurrency}
          icon={Wallet}
          variant="default"
        />
        <SummaryCard
          title={t('reports.yearlyIncome')}
          value={yearlyTotals.income}
          currency={settings.baseCurrency}
          icon={TrendingUp}
          variant="income"
          trend={prevYearTotals.income > 0 ? {
            value: growthRates.income,
            isPositive: growthRates.income >= 0,
          } : undefined}
        />
        <SummaryCard
          title={t('reports.yearlyExpenses')}
          value={yearlyTotals.expense}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="expense"
          trend={prevYearTotals.expense > 0 ? {
            value: growthRates.expense,
            isPositive: growthRates.expense <= 0, // Less expense is good
          } : undefined}
        />
        <SummaryCard
          title={t('reports.yearlyInvestments')}
          value={yearlyTotals.investment}
          currency={settings.baseCurrency}
          icon={PiggyBank}
          variant="investment"
        />
      </div>

      {/* View Tabs */}
      <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as 'monthly' | 'categories' | 'insights' | 'portfolio')}>
        <TabsList className="mb-6 border-slate-800 bg-slate-900/50">
          <TabsTrigger
            value="monthly"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('reports.views.monthly')}
          </TabsTrigger>
          <TabsTrigger
            value="categories"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('reports.views.categories')}
          </TabsTrigger>
          <TabsTrigger
            value="portfolio"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            <Briefcase className="mr-1.5 h-3.5 w-3.5" />
            {t('reports.views.portfolio')}
          </TabsTrigger>
          <TabsTrigger
            value="insights"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
            {t('reports.views.insights')}
          </TabsTrigger>
        </TabsList>

        {/* Monthly View */}
        <TabsContent value="monthly" className="space-y-6">
          {/* Chart */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('reports.monthlyOverview')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <IncomeExpenseChart
                data={monthlyData}
                currency={settings.baseCurrency}
              />
            </CardContent>
          </Card>

          {/* Table */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('reports.monthlyBreakdown')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyReportTable
                data={monthlyData}
                currency={settings.baseCurrency}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories View */}
        <TabsContent value="categories" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Income Categories */}
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-emerald-400">
                  {t('reports.incomeByCategory')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CategoryPieChart
                  data={incomeBreakdown}
                  currency={settings.baseCurrency}
                />
              </CardContent>
            </Card>

            {/* Expense Categories */}
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-red-400">
                  {t('reports.expensesByCategory')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CategoryPieChart
                  data={expenseBreakdown}
                  currency={settings.baseCurrency}
                />
              </CardContent>
            </Card>
          </div>

          {/* All Categories */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg text-white">
                {t('reports.allCategories')}
              </CardTitle>
              <Tabs
                value={selectedType}
                onValueChange={(v) => setSelectedType(v as TransactionType | 'all')}
              >
                <TabsList className="border-slate-800 bg-slate-800/50">
                  <TabsTrigger
                    value="all"
                    className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-white"
                  >
                    {t('reports.filters.all')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="income"
                    className="text-xs data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400"
                  >
                    {t('transactions.types.income')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="expense"
                    className="text-xs data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400"
                  >
                    {t('transactions.types.expense')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="investment"
                    className="text-xs data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400"
                  >
                    {t('transactions.types.investment')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <CategoryPieChart
                data={categoryBreakdown}
                currency={settings.baseCurrency}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Portfolio View */}
        <TabsContent value="portfolio" className="space-y-6">
          {activeHoldings.length === 0 ? (
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardContent className="py-12 text-center">
                <Briefcase className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">{t('reports.portfolio.noData')}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Performance Summary Cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardContent className="pt-6">
                    <p className="text-sm text-slate-400">{t('reports.portfolio.totalInvested')}</p>
                    <p className="mt-1 text-2xl font-bold text-white">
                      {formatCurrency(portfolioTotals.totalInvested, settings.baseCurrency)}
                    </p>
                  </CardContent>
                </Card>
                {portfolioTotals.hasPriceData && (
                  <>
                    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                      <CardContent className="pt-6">
                        <p className="text-sm text-slate-400">{t('reports.portfolio.currentValue')}</p>
                        <p className="mt-1 text-2xl font-bold text-white">
                          {formatCurrency(portfolioTotals.totalCurrentValue, settings.baseCurrency)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                      <CardContent className="pt-6">
                        <p className="text-sm text-slate-400">{t('reports.portfolio.totalPnL')}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <p className={cn(
                            'text-2xl font-bold',
                            portfolioTotals.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                          )}>
                            {portfolioTotals.totalPnL >= 0 ? '+' : ''}
                            {formatCurrency(portfolioTotals.totalPnL, settings.baseCurrency)}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              portfolioTotals.totalPnL >= 0
                                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                : 'border-red-500/50 bg-red-500/10 text-red-400'
                            )}
                          >
                            {portfolioTotals.totalPnL >= 0 ? '+' : ''}
                            {portfolioTotals.totalPnLPercent.toFixed(1)}%
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              {/* Asset Allocation + Account Breakdown */}
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      {t('reports.portfolio.assetAllocation')}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {t('reports.portfolio.assetAllocationDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CategoryPieChart
                      data={assetAllocationData}
                      currency={settings.baseCurrency}
                    />
                  </CardContent>
                </Card>

                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      {t('reports.portfolio.accountBreakdown')}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {t('reports.portfolio.accountBreakdownDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CategoryPieChart
                      data={accountBreakdownData}
                      currency={settings.baseCurrency}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Currency Breakdown */}
              {currencyBreakdownData.length > 1 && (
                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      {t('reports.portfolio.currencyBreakdown')}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {t('reports.portfolio.currencyBreakdownDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CategoryPieChart
                      data={currencyBreakdownData}
                      currency={settings.baseCurrency}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Holdings Performance Table */}
              {holdingsPerformance.length > 0 && (
                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      {t('reports.portfolio.performance')}
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                      {t('reports.portfolio.performanceDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-slate-800 hover:bg-transparent">
                            <TableHead className="text-slate-400">{t('reports.portfolio.holding')}</TableHead>
                            <TableHead className="text-right text-slate-400">{t('reports.portfolio.invested')}</TableHead>
                            <TableHead className="text-right text-slate-400">{t('reports.portfolio.current')}</TableHead>
                            <TableHead className="text-right text-slate-400">{t('reports.portfolio.pnl')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {holdingsPerformance.map((h) => (
                            <TableRow key={h.id} className="border-slate-800 hover:bg-slate-800/50">
                              <TableCell>
                                <div>
                                  <p className="font-medium text-white">
                                    {h.ticker ? <span className="mr-2 font-mono text-sm">{h.ticker}</span> : null}
                                    {h.name}
                                  </p>
                                  <p className="text-xs text-slate-500">{h.account?.name}</p>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-slate-300">
                                {formatCurrency(h.investedInBase, settings.baseCurrency)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-white">
                                {formatCurrency(h.currentValue, settings.baseCurrency)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <span className={cn(
                                    'font-mono text-sm',
                                    h.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                                  )}>
                                    {h.pnl >= 0 ? '+' : ''}{formatCurrency(h.pnl, settings.baseCurrency)}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-xs',
                                      h.pnl >= 0
                                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                                        : 'border-red-500/50 bg-red-500/10 text-red-400'
                                    )}
                                  >
                                    {h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent.toFixed(1)}%
                                  </Badge>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Insights View */}
        <TabsContent value="insights" className="space-y-6">
          {/* Key Insights Summary */}
          {hasData && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Savings Rate */}
              <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">{t('insights.savingsRate')}</p>
                      <p className={cn(
                        'text-2xl font-bold',
                        yearlyTotals.balance >= 0 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {yearlyTotals.income > 0
                          ? formatPercent((yearlyTotals.balance / yearlyTotals.income) * 100)
                          : '0%'}
                      </p>
                    </div>
                    <Wallet className="h-8 w-8 text-slate-600" />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {t('insights.savingsRateDesc')}
                  </p>
                </CardContent>
              </Card>

              {/* Top Expense */}
              {topExpenseCategory && (
                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-400">{t('insights.topExpense')}</p>
                        <p className="text-lg font-bold text-white">{topExpenseCategory.name}</p>
                        <p className="text-sm text-red-400">
                          {formatCurrency(topExpenseCategory.value, settings.baseCurrency)}
                        </p>
                      </div>
                      <TrendingDown className="h-8 w-8 text-red-500/50" />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Top Income */}
              {topIncomeCategory && (
                <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-400">{t('insights.topIncome')}</p>
                        <p className="text-lg font-bold text-white">{topIncomeCategory.name}</p>
                        <p className="text-sm text-emerald-400">
                          {formatCurrency(topIncomeCategory.value, settings.baseCurrency)}
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-emerald-500/50" />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Balance Over Time */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('charts.balanceOverTime')}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t('insights.balanceOverTimeDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BalanceLineChart
                transactions={filteredTransactions}
                transfers={filteredTransfers}
                currency={settings.baseCurrency}
                height={300}
              />
            </CardContent>
          </Card>

          {/* Cash Flow */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('charts.cashFlow')}
              </CardTitle>
              <CardDescription className="text-slate-400">
                {t('insights.cashFlowDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CashFlowChart
                transactions={filteredTransactions}
                transfers={filteredTransfers}
                currency={settings.baseCurrency}
                year={selectedYear}
                height={300}
              />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Entity Comparison */}
            {hasMultipleEntities && (
              <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-white">
                    {t('charts.entityComparison')}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    {t('insights.entityComparisonDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <EntityComparisonChart
                    entities={allEntities}
                    transactions={transactions}
                    transfers={transfers}
                    currency={settings.baseCurrency}
                    height={Math.max(200, allEntities.length * 60)}
                  />
                </CardContent>
              </Card>
            )}

            {/* Currency Distribution */}
            {hasMultipleCurrencies && (
              <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-white">
                    {t('charts.currencyDistribution')}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    {t('insights.currencyDistributionDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <CurrencyDistributionChart
                    transactions={filteredTransactions}
                    height={300}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* No data message */}
          {!hasData && (
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardContent className="py-12 text-center">
                <Lightbulb className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">{t('insights.noData')}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
