'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { format, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import {
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Wallet,
  Download,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { MonthlyReportTable } from '@/components/tables';
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
  useTransactionStore,
  useTransferStore,
  useBusinessStore,
  useSettingsStore,
} from '@/lib/store';
import {
  calculateCategoryBreakdown,
  sumTransactionsByType,
  calculateGrowthRate,
} from '@/lib/utils/calculations';
import { exportTransactionsToCSV } from '@/lib/utils/export';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { TransactionType } from '@/types';

export default function ReportsPage() {
  const t = useTranslations();
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount, currencies } = useSettingsStore();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedView, setSelectedView] = useState<'monthly' | 'categories' | 'insights'>('monthly');
  const [selectedType, setSelectedType] = useState<TransactionType | 'all'>('all');

  // Filter transactions by year
  const yearTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const date = new Date(t.date);
      return date.getFullYear() === selectedYear;
    });
  }, [transactions, selectedYear]);

  // Previous year transactions for comparison
  const prevYearTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const date = new Date(t.date);
      return date.getFullYear() === selectedYear - 1;
    });
  }, [transactions, selectedYear]);

  // Calculate yearly totals
  const yearlyTotals = useMemo(() => {
    const income = sumTransactionsByType(yearTransactions, 'income');
    const expense = sumTransactionsByType(yearTransactions, 'expense');
    const investment = sumTransactionsByType(yearTransactions, 'investment');
    return {
      income,
      expense,
      investment,
      balance: income - expense,
    };
  }, [yearTransactions]);

  // Calculate previous year totals for growth comparison
  const prevYearTotals = useMemo(() => {
    const income = sumTransactionsByType(prevYearTransactions, 'income');
    const expense = sumTransactionsByType(prevYearTransactions, 'expense');
    return { income, expense };
  }, [prevYearTransactions]);

  // Calculate growth rates
  const growthRates = useMemo(() => ({
    income: calculateGrowthRate(yearlyTotals.income, prevYearTotals.income),
    expense: calculateGrowthRate(yearlyTotals.expense, prevYearTotals.expense),
  }), [yearlyTotals, prevYearTotals]);

  // Calculate monthly data
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

      const income = sumTransactionsByType(monthTransactions, 'income');
      const expense = sumTransactionsByType(monthTransactions, 'expense');
      const investment = sumTransactionsByType(monthTransactions, 'investment');

      return {
        month: format(month, 'MMM'),
        income,
        expense,
        investment,
        balance: income - expense,
      };
    });
  }, [yearTransactions, selectedYear]);

  // Calculate category breakdown
  const categoryBreakdown = useMemo(() => {
    const filtered =
      selectedType === 'all'
        ? yearTransactions
        : yearTransactions.filter((t) => t.type === selectedType);

    const breakdown = calculateCategoryBreakdown(filtered);

    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [yearTransactions, selectedType]);

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
    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [yearTransactions]);

  // Prepare entities for comparison chart
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

  const handleExportCSV = () => {
    if (yearTransactions.length === 0) {
      toast.error(t('reports.export.noData'));
      return;
    }

    const entityNames: Record<string, string> = {};
    businesses.forEach((b) => {
      entityNames[b.id] = b.name;
    });
    if (personalAccount) {
      entityNames[personalAccount.id] = t('nav.personal');
    }

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

  const hasData = transactions.length > 0;
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
      <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as 'monthly' | 'categories' | 'insights')}>
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
                transactions={transactions}
                transfers={transfers}
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
                transactions={transactions}
                transfers={transfers}
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
                    transactions={transactions}
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
