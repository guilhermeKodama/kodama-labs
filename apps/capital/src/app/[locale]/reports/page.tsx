'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { format, startOfYear, endOfYear, eachMonthOfInterval } from 'date-fns';
import {
  FileBarChart,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Wallet,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { MonthlyReportTable } from '@/components/tables';
import { CategoryPieChart, IncomeExpenseChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useTransactionStore,
  useBusinessStore,
  useSettingsStore,
} from '@/lib/store';
import {
  calculateCategoryBreakdown,
  sumTransactionsByType,
} from '@/lib/utils/calculations';
import { exportTransactionsToCSV } from '@/lib/utils/export';
import { toast } from 'sonner';
import type { TransactionType } from '@/types';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export default function ReportsPage() {
  const t = useTranslations();
  const { transactions } = useTransactionStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount } = useSettingsStore();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedView, setSelectedView] = useState<'monthly' | 'categories'>('monthly');
  const [selectedType, setSelectedType] = useState<TransactionType | 'all'>('all');

  // Filter transactions by year
  const yearTransactions = useMemo(() => {
    return transactions.filter((t) => {
      const date = new Date(t.date);
      return date.getFullYear() === selectedYear;
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
        />
        <SummaryCard
          title={t('reports.yearlyExpenses')}
          value={yearlyTotals.expense}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="expense"
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
      <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as any)}>
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
                onValueChange={(v) => setSelectedType(v as any)}
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
      </Tabs>
    </AppShell>
  );
}
