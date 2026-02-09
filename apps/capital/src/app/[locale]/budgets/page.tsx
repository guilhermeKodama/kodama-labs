'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Copy,
  Calendar,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { RoomToSpendSummary } from '@/components/cards';
import { BudgetInsights } from '@/components/cards';
import { UnbudgetedSpendingCard } from '@/components/cards';
import { BudgetTrendCard } from '@/components/cards';
import { BudgetsTable } from '@/components/tables';
import { BudgetDialog } from '@/components/dialogs';
import { BudgetOverviewChart } from '@/components/charts';
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
  useBudgetStore,
  useTransactionStore,
  useSettingsStore,
  useCreditCardStore,
} from '@/lib/store';
import {
  calculateAllBudgetProgress,
  getCurrentMonthBudgets,
  getBudgetAlerts,
  getUnbudgetedSpending,
  getMonthOverMonth,
  generateBudgetInsights,
  mergeTransactionsWithCreditCard,
  convertInstallmentsToTransactions,
} from '@/lib/utils/budget';
import { toast } from 'sonner';
import type { Budget, EntityType } from '@/types';
import type { CreateBudgetFormData } from '@/lib/validations';

export default function BudgetsPage() {
  const t = useTranslations();
  const {
    budgets,
    addBudget,
    updateBudget,
    deleteBudget,
    toggleBudget,
  } = useBudgetStore();
  const { transactions } = useTransactionStore();
  const { settings } = useSettingsStore();
  const {
    creditCards,
    bills,
    allBillTransactions,
    installments,
    fetchCreditCards,
    fetchBills,
    fetchAllBillTransactions,
    fetchInstallments,
  } = useCreditCardStore();

  // Load credit card data for budget integration
  useEffect(() => {
    fetchCreditCards();
    fetchBills();
    fetchInstallments();
  }, [fetchCreditCards, fetchBills, fetchInstallments]);

  // After bills are loaded, fetch all bill transactions
  useEffect(() => {
    if (bills.length > 0) {
      fetchAllBillTransactions();
    }
  }, [bills, fetchAllBillTransactions]);

  // Merge regular transactions + credit card bill transactions + installment projections
  const mergedTransactions = useMemo(() => {
    const ccMerged = mergeTransactionsWithCreditCard(
      transactions,
      allBillTransactions,
      bills,
      creditCards
    );

    // Add installment future projections as virtual transactions
    // Uses bill closing dates as anchor for accurate month alignment
    const installmentTransactions = convertInstallmentsToTransactions(
      installments,
      creditCards,
      bills,
      allBillTransactions
    );

    return [...ccMerged, ...installmentTransactions];
  }, [transactions, allBillTransactions, bills, creditCards, installments]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | undefined>();
  const [deletingBudget, setDeletingBudget] = useState<Budget | undefined>();
  const [selectedView, setSelectedView] = useState<'current' | 'all' | 'overview'>('current');
  const [prefillCategory, setPrefillCategory] = useState<string | undefined>();
  const [prefillEntityId, setPrefillEntityId] = useState<string | undefined>();
  const [prefillEntityType, setPrefillEntityType] = useState<EntityType | undefined>();

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Overview period selector state
  const [overviewYear, setOverviewYear] = useState(currentYear);
  const [overviewMonth, setOverviewMonth] = useState(currentMonth);

  // Calculate budget progress (using merged transactions that include CC spending)
  const allBudgetProgress = useMemo(() => {
    return calculateAllBudgetProgress(budgets, mergedTransactions);
  }, [budgets, mergedTransactions]);

  // Get current month budgets
  const currentBudgets = useMemo(() => {
    return getCurrentMonthBudgets(budgets);
  }, [budgets]);

  const currentBudgetProgress = useMemo(() => {
    return calculateAllBudgetProgress(currentBudgets, mergedTransactions);
  }, [currentBudgets, mergedTransactions]);

  // Generate insights
  const insights = useMemo(() => {
    return generateBudgetInsights(currentBudgetProgress, mergedTransactions);
  }, [currentBudgetProgress, mergedTransactions]);

  // Unbudgeted spending (includes credit card categories)
  const unbudgetedCategories = useMemo(() => {
    return getUnbudgetedSpending(currentBudgets, mergedTransactions, currentYear, currentMonth);
  }, [currentBudgets, mergedTransactions, currentYear, currentMonth]);

  // Month-over-month trends
  const trends = useMemo(() => {
    return getMonthOverMonth(currentBudgets, mergedTransactions, currentYear, currentMonth);
  }, [currentBudgets, mergedTransactions, currentYear, currentMonth]);

  // Overview tab: budgets and progress for the selected period
  const overviewBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (!b.isActive) return false;
      if (b.year !== overviewYear) return false;
      if (b.period === 'monthly') {
        return b.month === overviewMonth;
      }
      return true; // Yearly budgets
    });
  }, [budgets, overviewYear, overviewMonth]);

  const overviewBudgetProgress = useMemo(() => {
    return calculateAllBudgetProgress(overviewBudgets, mergedTransactions);
  }, [overviewBudgets, mergedTransactions]);

  const overviewTrends = useMemo(() => {
    return getMonthOverMonth(overviewBudgets, mergedTransactions, overviewYear, overviewMonth);
  }, [overviewBudgets, mergedTransactions, overviewYear, overviewMonth]);

  const MONTH_LABELS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const navigateOverviewPeriod = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (overviewMonth === 1) {
        setOverviewMonth(12);
        setOverviewYear(overviewYear - 1);
      } else {
        setOverviewMonth(overviewMonth - 1);
      }
    } else {
      if (overviewMonth === 12) {
        setOverviewMonth(1);
        setOverviewYear(overviewYear + 1);
      } else {
        setOverviewMonth(overviewMonth + 1);
      }
    }
  };

  const isCurrentPeriod = overviewYear === currentYear && overviewMonth === currentMonth;

  // Handlers
  const handleCreate = async (data: CreateBudgetFormData) => {
    const result = await addBudget(data);
    setPrefillCategory(undefined);
    setPrefillEntityId(undefined);
    setPrefillEntityType(undefined);
    if (result) {
      toast.success(t('budgets.toast.created'));
    } else {
      toast.error(t('budgets.toast.createError'));
    }
  };

  const handleUpdate = async (data: CreateBudgetFormData) => {
    if (editingBudget) {
      await updateBudget(editingBudget.id, data);
      setEditingBudget(undefined);
      toast.success(t('budgets.toast.updated'));
    }
  };

  const handleDelete = async () => {
    if (deletingBudget) {
      await deleteBudget(deletingBudget.id);
      setDeletingBudget(undefined);
      toast.success(t('budgets.toast.deleted'));
    }
  };

  const handleToggle = async (budget: Budget) => {
    await toggleBudget(budget.id);
    toast.success(
      budget.isActive
        ? t('budgets.toast.paused')
        : t('budgets.toast.resumed')
    );
  };

  const openEditDialog = (budget: Budget) => {
    setEditingBudget(budget);
    setPrefillCategory(undefined);
    setPrefillEntityId(undefined);
    setPrefillEntityType(undefined);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingBudget(undefined);
    setPrefillCategory(undefined);
    setPrefillEntityId(undefined);
    setPrefillEntityType(undefined);
  };

  // Copy to next month handler
  const handleCopyToNextMonth = async () => {
    if (currentBudgets.length === 0) {
      toast.info(t('budgets.toast.noBudgetsToCopy'));
      return;
    }

    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

    // Check which budgets already exist for next month
    const existingNextMonth = budgets.filter(
      (b) => b.year === nextYear && b.month === nextMonth && b.period === 'monthly'
    );
    const existingKeys = new Set(
      existingNextMonth.map((b) => `${b.entityId}::${b.category}`)
    );

    const budgetsToCopy = currentBudgets.filter((b) => {
      if (b.period !== 'monthly') return false;
      const key = `${b.entityId}::${b.category}`;
      return !existingKeys.has(key);
    });

    if (budgetsToCopy.length === 0) {
      toast.info(t('budgets.toast.allBudgetsExist'));
      return;
    }

    let copied = 0;
    for (const budget of budgetsToCopy) {
      const result = await addBudget({
        entityId: budget.entityId,
        entityType: budget.entityType,
        category: budget.category,
        amount: budget.amount,
        currency: budget.currency,
        period: 'monthly',
        year: nextYear,
        month: nextMonth,
        alertThreshold: budget.alertThreshold,
      });
      if (result) copied++;
    }

    if (copied > 0) {
      toast.success(t('budgets.toast.copiedToNextMonth', { count: copied }));
    }
  };

  // Handle creating budget from unbudgeted spending
  const handleCreateFromUnbudgeted = (category: string, entityId: string, entityType: string) => {
    setPrefillCategory(category);
    setPrefillEntityId(entityId);
    setPrefillEntityType(entityType as EntityType);
    setEditingBudget(undefined);
    setIsDialogOpen(true);
  };

  return (
    <AppShell>
      <Header
        title={t('budgets.title')}
        description={t('budgets.subtitle')}
        action={{
          label: t('budgets.addBudget'),
          onClick: () => setIsDialogOpen(true),
        }}
        secondaryAction={{
          label: t('budgets.copyToNextMonth'),
          onClick: handleCopyToNextMonth,
          icon: Copy,
        }}
      />

      {/* Room to Spend Summary (replaces old 4 summary cards) */}
      <RoomToSpendSummary
        budgetProgress={currentBudgetProgress}
        transactions={mergedTransactions}
        currency={settings.baseCurrency}
      />

      {/* Actionable Insights (replaces old alerts) */}
      <BudgetInsights insights={insights} />

      {/* Unbudgeted Spending Detection */}
      <UnbudgetedSpendingCard
        unbudgetedCategories={unbudgetedCategories}
        currency={settings.baseCurrency}
        onCreateBudget={handleCreateFromUnbudgeted}
      />

      {/* Budget Tabs */}
      <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as 'current' | 'all' | 'overview')}>
        <TabsList className="mb-6 border-slate-800 bg-slate-900/50">
          <TabsTrigger
            value="current"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            <Calendar className="mr-2 h-4 w-4" />
            {t('budgets.views.current')}
          </TabsTrigger>
          <TabsTrigger
            value="all"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('budgets.views.all')}
          </TabsTrigger>
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            {t('budgets.views.overview')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('budgets.currentBudgets')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BudgetsTable
                budgetProgress={currentBudgetProgress}
                transactions={mergedTransactions}
                onEdit={openEditDialog}
                onDelete={setDeletingBudget}
                onToggle={handleToggle}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('budgets.allBudgets')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BudgetsTable
                budgetProgress={allBudgetProgress}
                transactions={mergedTransactions}
                onEdit={openEditDialog}
                onDelete={setDeletingBudget}
                onToggle={handleToggle}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overview">
          <div className="space-y-6">
            {/* Period Navigator */}
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
                onClick={() => navigateOverviewPeriod('prev')}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-white">
                  {MONTH_LABELS[overviewMonth - 1]} {overviewYear}
                </span>
                {isCurrentPeriod && (
                  <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs font-medium text-cyan-400">
                    {t('budgets.views.current')}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
                onClick={() => navigateOverviewPeriod('next')}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              {!isCurrentPeriod && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2 border-slate-700 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
                  onClick={() => {
                    setOverviewMonth(currentMonth);
                    setOverviewYear(currentYear);
                  }}
                >
                  {t('budgets.overview.today')}
                </Button>
              )}
            </div>

            {/* Budget Distribution Chart */}
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-white">
                  {t('budgets.overview.chartTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BudgetOverviewChart
                  budgetProgress={overviewBudgetProgress}
                  currency={settings.baseCurrency}
                />
              </CardContent>
            </Card>

            {/* Month-over-Month Trends */}
            <BudgetTrendCard
              trends={overviewTrends}
              currency={settings.baseCurrency}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Budget Dialog */}
      <BudgetDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        budget={editingBudget}
        onSubmit={editingBudget ? handleUpdate : handleCreate}
        defaultEntityId={prefillEntityId}
        defaultEntityType={prefillEntityType}
        defaultCategory={prefillCategory}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingBudget}
        onOpenChange={() => setDeletingBudget(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('budgets.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('budgets.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
