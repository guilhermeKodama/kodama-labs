'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Plus,
  Building2,
  BarChart3,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard, BusinessCard } from '@/components/cards';
import { RecentTransactions } from '@/components/tables';
import { BalanceLineChart, CashFlowChart, EntityComparisonChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useBusinessStore,
  useTransactionStore,
  useTransferStore,
  useSettingsStore,
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { Link } from '@/i18n/navigation';

export default function DashboardPage() {
  const t = useTranslations();
  const { businesses } = useBusinessStore();
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();
  const { settings, personalAccount } = useSettingsStore();

  // Calculate summaries
  const businessSummaries = useMemo(() => {
    return businesses.map((business) =>
      calculateEntitySummary(
        business.id,
        'business',
        business.name,
        transactions,
        transfers,
        settings.baseCurrency
      )
    );
  }, [businesses, transactions, transfers, settings.baseCurrency]);

  const personalSummary = useMemo(() => {
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

  // Calculate totals
  const totals = useMemo(() => {
    const allSummaries = [...businessSummaries];
    if (personalSummary) allSummaries.push(personalSummary);

    return {
      totalCapital: allSummaries.reduce((sum, s) => sum + s.netWorth, 0),
      totalIncome: allSummaries.reduce((sum, s) => sum + s.totalIncome, 0),
      totalExpenses: allSummaries.reduce((sum, s) => sum + s.totalExpenses, 0),
      totalInvestments: allSummaries.reduce(
        (sum, s) => sum + s.totalInvestments,
        0
      ),
    };
  }, [businessSummaries, personalSummary]);

  // Get recent transactions with entity names
  const recentTransactionsWithNames = useMemo(() => {
    return transactions.map((t) => {
      let entityName = '';
      if (t.entityType === 'business') {
        const business = businesses.find((b) => b.id === t.entityId);
        entityName = business?.name || 'Unknown';
      } else {
        entityName = 'Personal';
      }
      return { ...t, entityName };
    });
  }, [transactions, businesses]);

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

  const hasData = transactions.length > 0;
  const hasMultipleEntities = allEntities.length > 1;

  return (
    <AppShell>
      <Header
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('dashboard.totalCapital')}
          value={totals.totalCapital}
          currency={settings.baseCurrency}
          icon={Wallet}
          variant="default"
        />
        <SummaryCard
          title={t('dashboard.totalIncome')}
          value={totals.totalIncome}
          currency={settings.baseCurrency}
          icon={TrendingUp}
          variant="income"
        />
        <SummaryCard
          title={t('dashboard.totalExpenses')}
          value={totals.totalExpenses}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="expense"
        />
        <SummaryCard
          title={t('dashboard.totalInvestments')}
          value={totals.totalInvestments}
          currency={settings.baseCurrency}
          icon={PiggyBank}
          variant="investment"
        />
      </div>

      {/* Charts Row */}
      {hasData && (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          {/* Balance Trend */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg text-white">
                {t('charts.balanceOverTime')}
              </CardTitle>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-white"
              >
                <Link href="/reports">{t('dashboard.viewAll')}</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <BalanceLineChart
                transactions={transactions}
                transfers={transfers}
                currency={settings.baseCurrency}
                height={220}
                defaultTimeRange="3M"
              />
            </CardContent>
          </Card>

          {/* Cash Flow */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg text-white">
                {t('charts.cashFlow')}
              </CardTitle>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-white"
              >
                <Link href="/reports">{t('dashboard.viewAll')}</Link>
              </Button>
            </CardHeader>
            <CardContent>
              <CashFlowChart
                transactions={transactions}
                transfers={transfers}
                currency={settings.baseCurrency}
                height={220}
                showPeriodSelector={false}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Entity Comparison (only if multiple entities) */}
      {hasMultipleEntities && hasData && (
        <div className="mb-8">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg text-white">
                {t('charts.entityComparison')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EntityComparisonChart
                entities={allEntities}
                transactions={transactions}
                transfers={transfers}
                currency={settings.baseCurrency}
                height={Math.max(180, allEntities.length * 50)}
                defaultMetric="netWorth"
              />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Recent Transactions */}
          <RecentTransactions
            transactions={recentTransactionsWithNames}
            limit={5}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('dashboard.quickActions')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Button
                asChild
                variant="outline"
                className="justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Link href="/businesses">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('dashboard.addBusiness')}
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Link href="/personal">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('dashboard.addTransaction')}
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="justify-start border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Link href="/reports">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  {t('charts.viewReports')}
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Businesses Overview */}
          {businesses.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">
                  {t('dashboard.yourBusinesses')}
                </h3>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-white"
                >
                  <Link href="/businesses">{t('dashboard.viewAll')}</Link>
                </Button>
              </div>
              <div className="space-y-3">
                {businesses.slice(0, 3).map((business, index) => (
                  <BusinessCard
                    key={business.id}
                    business={business}
                    summary={businessSummaries[index]}
                  />
                ))}
              </div>
            </div>
          ) : (
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardContent className="py-8 text-center">
                <Building2 className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                <p className="mb-4 text-slate-400">{t('dashboard.noBusinesses')}</p>
                <Button
                  asChild
                  className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
                >
                  <Link href="/businesses">
                    <Plus className="mr-2 h-4 w-4" />
                    {t('dashboard.createFirst')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
