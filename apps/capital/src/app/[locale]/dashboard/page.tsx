'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Plus,
  Building2,
  BarChart3,
  Clock,
  AlertCircle,
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { startOfMonth, endOfMonth, isBefore, isToday, startOfDay, isWithinInterval, differenceInDays, formatDistanceToNow } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useLocale } from 'next-intl';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard, BusinessCard } from '@/components/cards';
import { RecentTransactions } from '@/components/tables';
import { BalanceLineChart, CashFlowChart, EntityComparisonChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useBusinessStore,
  useTransactionStore,
  useTransferStore,
  useSettingsStore,
  useRecurringTransactionStore,
  useRecurringTransferStore,
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { formatCurrency } from '@/lib/utils/format';
import { Link } from '@/i18n/navigation';

export default function DashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { businesses } = useBusinessStore();
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();
  const { settings, personalAccount } = useSettingsStore();
  const { recurringTransactions } = useRecurringTransactionStore();
  const { recurringTransfers } = useRecurringTransferStore();
  const [showAllPending, setShowAllPending] = useState(false);
  
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;

  // Calculate summaries
  const businessSummaries = useMemo(() => {
    return businesses.map((business) =>
      calculateEntitySummary(
        business.id,
        'business',
        business.name,
        transactions,
        transfers,
        settings.baseCurrency,
        business.initialBalance
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
      settings.baseCurrency,
      personalAccount.initialBalance
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

  // Calculate pending items for this month
  const pendingItems = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const today = startOfDay(now);

    type PendingItem = {
      id: string;
      type: 'expense' | 'income' | 'transfer';
      source: 'recurring-transaction' | 'recurring-transfer';
      description: string;
      amount: number;
      currency: string;
      exchangeRate: number;
      dueDate: Date;
      status: 'overdue' | 'dueToday' | 'upcoming';
      entityName?: string;
      daysUntilDue: number;
    };

    const items: PendingItem[] = [];

    // Add recurring transactions due this month
    recurringTransactions
      .filter((rt) => rt.isActive)
      .forEach((rt) => {
        const dueDate = startOfDay(new Date(rt.nextDueDate));
        if (isWithinInterval(dueDate, { start: monthStart, end: monthEnd })) {
          const entityName = rt.entityType === 'business'
            ? businesses.find((b) => b.id === rt.entityId)?.name || 'Unknown'
            : t('nav.personal');

          let status: 'overdue' | 'dueToday' | 'upcoming' = 'upcoming';
          if (isBefore(dueDate, today)) status = 'overdue';
          else if (isToday(dueDate)) status = 'dueToday';

          const daysUntilDue = differenceInDays(dueDate, today);

          items.push({
            id: rt.id,
            type: rt.type === 'income' ? 'income' : 'expense',
            source: 'recurring-transaction',
            description: rt.description,
            amount: rt.amount,
            currency: rt.currency,
            exchangeRate: rt.exchangeRate,
            dueDate,
            status,
            entityName,
            daysUntilDue,
          });
        }
      });

    // Add recurring transfers due this month
    recurringTransfers
      .filter((rt) => rt.isActive)
      .forEach((rt) => {
        const dueDate = startOfDay(new Date(rt.nextDueDate));
        if (isWithinInterval(dueDate, { start: monthStart, end: monthEnd })) {
          const fromName = rt.fromEntityType === 'business'
            ? businesses.find((b) => b.id === rt.fromEntityId)?.name || 'Unknown'
            : t('nav.personal');
          const toName = rt.toEntityType === 'business'
            ? businesses.find((b) => b.id === rt.toEntityId)?.name || 'Unknown'
            : t('nav.personal');

          let status: 'overdue' | 'dueToday' | 'upcoming' = 'upcoming';
          if (isBefore(dueDate, today)) status = 'overdue';
          else if (isToday(dueDate)) status = 'dueToday';

          const daysUntilDue = differenceInDays(dueDate, today);

          items.push({
            id: rt.id,
            type: 'transfer',
            source: 'recurring-transfer',
            description: rt.description || `${fromName} → ${toName}`,
            amount: rt.amount,
            currency: rt.currency,
            exchangeRate: rt.exchangeRate,
            dueDate,
            status,
            entityName: `${fromName} → ${toName}`,
            daysUntilDue,
          });
        }
      });

    // Sort by due date (overdue first, then due today, then upcoming)
    items.sort((a, b) => {
      const statusOrder = { overdue: 0, dueToday: 1, upcoming: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

    return items;
  }, [recurringTransactions, recurringTransfers, businesses, t]);

  // Helper function to get countdown text
  const getCountdownText = (item: typeof pendingItems[0]) => {
    if (item.status === 'overdue') {
      return formatDistanceToNow(item.dueDate, { addSuffix: true, locale: dateLocale });
    } else if (item.status === 'dueToday') {
      return t('dashboard.pendingThisMonth.dueToday');
    } else {
      return formatDistanceToNow(item.dueDate, { addSuffix: true, locale: dateLocale });
    }
  };

  // Prepare entities for comparison chart
  const allEntities = useMemo(() => {
    const entities: Array<{ id: string; name: string; type: 'business' | 'personal'; color?: string; initialBalance?: number }> = [];

    businesses.forEach((b) => {
      entities.push({
        id: b.id,
        name: b.name,
        type: 'business',
        color: b.color,
        initialBalance: b.initialBalance,
      });
    });

    if (personalAccount) {
      entities.push({
        id: personalAccount.id,
        name: t('nav.personal'),
        type: 'personal',
        color: '#8b5cf6',
        initialBalance: personalAccount.initialBalance,
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
          {/* Pending This Month */}
          {pendingItems.length > 0 && (
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg text-white">
                    <Clock className="h-5 w-5 text-amber-400" />
                    {t('dashboard.pendingThisMonth.title')}
                  </CardTitle>
                  <Badge variant="outline" className="border-amber-700 bg-amber-500/10 text-amber-400">
                    {pendingItems.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {(showAllPending ? pendingItems : pendingItems.slice(0, 5)).map((item) => (
                  <Link
                    key={item.id}
                    href={item.source === 'recurring-transfer' ? '/transfers?tab=recurring' : '/recurring'}
                    className={`block rounded-lg border p-3 transition-colors hover:brightness-110 ${
                      item.status === 'overdue'
                        ? 'border-red-700/50 bg-red-900/20'
                        : item.status === 'dueToday'
                        ? 'border-amber-700/50 bg-amber-900/20'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">
                          {item.description}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                          {item.type === 'transfer' ? (
                            <ArrowRight className="h-3 w-3" />
                          ) : item.type === 'expense' ? (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          ) : (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          )}
                          <span>{item.entityName}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${
                          item.type === 'income' ? 'text-emerald-400' : 
                          item.type === 'expense' ? 'text-red-400' : 'text-purple-400'
                        }`}>
                          {formatCurrency(item.amount * item.exchangeRate, settings.baseCurrency)}
                        </p>
                        <p className={`mt-1 text-xs ${
                          item.status === 'overdue'
                            ? 'text-red-400'
                            : item.status === 'dueToday'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                        }`}>
                          {item.status === 'overdue' && (
                            <AlertCircle className="mr-1 inline h-3 w-3" />
                          )}
                          {item.status === 'dueToday' && (
                            <Calendar className="mr-1 inline h-3 w-3" />
                          )}
                          {getCountdownText(item)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
                {pendingItems.length > 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllPending(!showAllPending)}
                    className="w-full text-slate-400 hover:text-white"
                  >
                    {showAllPending ? (
                      <>
                        <ChevronUp className="mr-2 h-4 w-4" />
                        {t('dashboard.pendingThisMonth.showLess')}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="mr-2 h-4 w-4" />
                        {t('dashboard.pendingThisMonth.viewAll')} ({pendingItems.length})
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

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
