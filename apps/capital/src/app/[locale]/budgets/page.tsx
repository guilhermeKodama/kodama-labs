'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  Copy,
  Calendar,
  BarChart3,
  Settings2,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { RoomToSpendSummary } from '@/components/cards';
import { BudgetInsights } from '@/components/cards';
import { UnbudgetedSpendingCard } from '@/components/cards';
import { BudgetTrendCard } from '@/components/cards';
import { YearlyBudgetSummary } from '@/components/cards';
import { BudgetsTable } from '@/components/tables';
import { BudgetDialog } from '@/components/dialogs';
import { YearlyBudgetChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
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
  getUnbudgetedSpending,
  getMonthOverMonth,
  generateBudgetInsights,
  mergeTransactionsWithCreditCard,
  convertInstallmentsToTransactions,
  getMonthlyFromYearlyBudgets,
  calculateAllYearlyProgress,
  getYearlySummaryStats,
  getCurrentYearBudgets,
} from '@/lib/utils/budget';
import { formatCurrency } from '@/lib/utils/format';
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
  const [selectedView, setSelectedView] = useState<'monthly' | 'yearly' | 'manage'>('monthly');
  const [prefillCategory, setPrefillCategory] = useState<string | undefined>();
  const [prefillEntityId, setPrefillEntityId] = useState<string | undefined>();
  const [prefillEntityType, setPrefillEntityType] = useState<EntityType | undefined>();
  // Yearly tab: category filter (empty set = all categories shown)
  const [selectedYearlyCategories, setSelectedYearlyCategories] = useState<Set<string>>(new Set());

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // ============================================
  // Monthly Tab Data
  // ============================================

  // Get yearly budgets for current year to derive monthly targets
  const currentYearBudgets = useMemo(() => {
    return getCurrentYearBudgets(budgets);
  }, [budgets]);

  // Derive monthly budget progress from yearly budgets (amount/12 per category)
  const monthlyFromYearly = useMemo(() => {
    return getMonthlyFromYearlyBudgets(
      budgets,
      mergedTransactions,
      currentYear,
      currentMonth
    );
  }, [budgets, mergedTransactions, currentYear, currentMonth]);

  // Also get any explicit monthly budgets for current month
  const explicitMonthlyProgress = useMemo(() => {
    const monthlyBudgets = budgets.filter(
      (b) => b.isActive && b.period === 'monthly' && b.year === currentYear && b.month === currentMonth
    );
    return calculateAllBudgetProgress(monthlyBudgets, mergedTransactions);
  }, [budgets, mergedTransactions, currentYear, currentMonth]);

  // Combine monthly view: explicit monthly + derived from yearly
  const currentMonthProgress = useMemo(() => {
    // Avoid duplicates: if a category has an explicit monthly budget, skip the yearly-derived one
    const explicitKeys = new Set(
      explicitMonthlyProgress.map((p) => `${p.budget.entityId}::${p.budget.category}`)
    );
    const filtered = monthlyFromYearly.filter(
      (p) => !explicitKeys.has(`${p.budget.entityId}::${p.budget.category}`)
    );
    return [...explicitMonthlyProgress, ...filtered];
  }, [explicitMonthlyProgress, monthlyFromYearly]);

  // Generate monthly insights
  const insights = useMemo(() => {
    return generateBudgetInsights(
      currentMonthProgress,
      mergedTransactions,
      currentYearBudgets
    );
  }, [currentMonthProgress, mergedTransactions, currentYearBudgets]);

  // Unbudgeted spending (includes credit card categories)
  const allCurrentBudgets = useMemo(() => {
    return budgets.filter((b) => {
      if (!b.isActive) return false;
      if (b.year !== currentYear) return false;
      if (b.period === 'monthly') return b.month === currentMonth;
      return true; // yearly
    });
  }, [budgets, currentYear, currentMonth]);

  const unbudgetedCategories = useMemo(() => {
    return getUnbudgetedSpending(allCurrentBudgets, mergedTransactions, currentYear, currentMonth);
  }, [allCurrentBudgets, mergedTransactions, currentYear, currentMonth]);

  // Month-over-month trends
  const trends = useMemo(() => {
    return getMonthOverMonth(allCurrentBudgets, mergedTransactions, currentYear, currentMonth);
  }, [allCurrentBudgets, mergedTransactions, currentYear, currentMonth]);

  // ============================================
  // Yearly Tab Data
  // ============================================

  const yearlyProgress = useMemo(() => {
    return calculateAllYearlyProgress(budgets, mergedTransactions, currentYear);
  }, [budgets, mergedTransactions, currentYear]);

  const yearlySummaryStats = useMemo(() => {
    return getYearlySummaryStats(budgets, mergedTransactions, currentYear);
  }, [budgets, mergedTransactions, currentYear]);

  // Available categories for the yearly filter
  const yearlyCategories = useMemo(() => {
    return yearlyProgress.map((yp) => yp.budget.category).sort();
  }, [yearlyProgress]);

  // Whether all categories are selected (empty set = all)
  const isAllYearlyCategoriesSelected = selectedYearlyCategories.size === 0;

  // Filtered yearly data based on selected categories
  const filteredYearlyProgress = useMemo(() => {
    if (isAllYearlyCategoriesSelected) return yearlyProgress;
    return yearlyProgress.filter((yp) => selectedYearlyCategories.has(yp.budget.category));
  }, [yearlyProgress, selectedYearlyCategories, isAllYearlyCategoriesSelected]);

  const filteredYearlySummaryStats = useMemo(() => {
    if (isAllYearlyCategoriesSelected) return yearlySummaryStats;
    // Recompute stats for filtered budgets only
    const filteredBudgets = budgets.filter(
      (b) => b.isActive && b.period === 'yearly' && b.year === currentYear && selectedYearlyCategories.has(b.category)
    );
    return getYearlySummaryStats(
      // Pass only filtered budgets (the function filters by yearly+active+year internally,
      // so we wrap them to match)
      filteredBudgets,
      mergedTransactions,
      currentYear
    );
  }, [yearlySummaryStats, isAllYearlyCategoriesSelected, budgets, mergedTransactions, currentYear, selectedYearlyCategories]);

  // Toggle a category in the yearly filter
  const toggleYearlyCategory = (category: string) => {
    setSelectedYearlyCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const selectAllYearlyCategories = () => {
    setSelectedYearlyCategories(new Set());
  };

  // ============================================
  // Manage Tab Data
  // ============================================

  const allBudgetProgress = useMemo(() => {
    return calculateAllBudgetProgress(budgets, mergedTransactions);
  }, [budgets, mergedTransactions]);

  // ============================================
  // Handlers
  // ============================================

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

  // Copy yearly budgets to next year
  const handleCopyToNextYear = async () => {
    const yearlyBudgets = budgets.filter(
      (b) => b.isActive && b.period === 'yearly' && b.year === currentYear
    );

    if (yearlyBudgets.length === 0) {
      toast.info(t('budgets.toast.noBudgetsToCopy'));
      return;
    }

    const nextYear = currentYear + 1;

    // Check which budgets already exist for next year
    const existingNextYear = budgets.filter(
      (b) => b.year === nextYear && b.period === 'yearly'
    );
    const existingKeys = new Set(
      existingNextYear.map((b) => `${b.entityId}::${b.category}`)
    );

    const budgetsToCopy = yearlyBudgets.filter((b) => {
      const key = `${b.entityId}::${b.category}`;
      return !existingKeys.has(key);
    });

    if (budgetsToCopy.length === 0) {
      toast.info(t('budgets.toast.allYearlyBudgetsExist'));
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
        period: 'yearly',
        year: nextYear,
        alertThreshold: budget.alertThreshold,
      });
      if (result) copied++;
    }

    if (copied > 0) {
      toast.success(t('budgets.toast.copiedToNextYear', { count: copied }));
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
          label: t('budgets.copyToNextYear'),
          onClick: handleCopyToNextYear,
          icon: Copy,
        }}
      />

      {/* Main Tabs */}
      <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as 'monthly' | 'yearly' | 'manage')}>
        <div className="mb-6 flex items-center justify-between">
          <TabsList className="border-slate-800 bg-slate-900/50">
            <TabsTrigger
              value="monthly"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <Calendar className="mr-1.5 h-3.5 w-3.5" />
              {t('budgets.views.monthly')}
            </TabsTrigger>
            <TabsTrigger
              value="yearly"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
              {t('budgets.views.yearly')}
            </TabsTrigger>
            <TabsTrigger
              value="manage"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              {t('budgets.views.manage')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ============================================ */}
        {/* Monthly Tab */}
        {/* ============================================ */}
        <TabsContent value="monthly" className="space-y-6">
          {/* Summary Cards */}
          <RoomToSpendSummary
            budgetProgress={currentMonthProgress}
            transactions={mergedTransactions}
            currency={settings.baseCurrency}
          />

          {/* Insights */}
          <BudgetInsights insights={insights} />

          {/* Current Month Budget Table */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('budgets.currentBudgets')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BudgetsTable
                budgetProgress={currentMonthProgress}
                transactions={mergedTransactions}
                onEdit={openEditDialog}
                onDelete={setDeletingBudget}
                onToggle={handleToggle}
              />
            </CardContent>
          </Card>

          {/* Unbudgeted Spending */}
          <UnbudgetedSpendingCard
            unbudgetedCategories={unbudgetedCategories}
            currency={settings.baseCurrency}
            onCreateBudget={handleCreateFromUnbudgeted}
          />

          {/* Month-over-Month Trends */}
          <BudgetTrendCard
            trends={trends}
            currency={settings.baseCurrency}
          />
        </TabsContent>

        {/* ============================================ */}
        {/* Yearly Tab */}
        {/* ============================================ */}
        <TabsContent value="yearly" className="space-y-6">
          {yearlyProgress.length === 0 ? (
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
                <h3 className="mb-2 text-lg font-medium text-white">
                  {t('budgets.yearly.noYearlyBudgets')}
                </h3>
                <p className="max-w-md text-center text-sm text-slate-400">
                  {t('budgets.yearly.noYearlyBudgetsDescription')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllYearlyCategories}
                  className={cn(
                    'rounded-full border text-xs transition-colors',
                    isAllYearlyCategoriesSelected
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
                  )}
                >
                  {t('budgets.yearly.allCategories')}
                </Button>
                {yearlyCategories.map((category) => {
                  const isSelected = selectedYearlyCategories.has(category);
                  return (
                    <Button
                      key={category}
                      variant="outline"
                      size="sm"
                      onClick={() => toggleYearlyCategory(category)}
                      className={cn(
                        'rounded-full border text-xs transition-colors',
                        isSelected
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300'
                          : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
                      )}
                    >
                      {category}
                    </Button>
                  );
                })}
              </div>

              {/* Yearly Summary Cards */}
              <YearlyBudgetSummary
                stats={filteredYearlySummaryStats}
                currency={settings.baseCurrency}
                year={currentYear}
              />

              {/* 12-Month Budget vs Actual Chart */}
              <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-white">
                    {t('budgets.yearly.monthlyBreakdown')} — {currentYear}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <YearlyBudgetChart
                    yearlyProgress={filteredYearlyProgress}
                    currency={settings.baseCurrency}
                  />
                </CardContent>
              </Card>

              {/* Category YTD Breakdown */}
              <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="text-lg text-white">
                    {t('budgets.yearly.categoryBreakdown')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {filteredYearlyProgress.map((yp) => {
                      const percentUsed = yp.budget.amount > 0
                        ? (yp.ytdSpent / yp.budget.amount) * 100
                        : 0;
                      const isOver = yp.ytdSpent > yp.ytdBudget;
                      const projectedOver = yp.projectedAnnual > yp.budget.amount;

                      return (
                        <div
                          key={yp.budget.id}
                          className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <div>
                              <h4 className="font-medium text-white">
                                {yp.budget.category}
                              </h4>
                              <p className="text-xs text-slate-400">
                                {t('budgets.yearly.annualBudget')}: {formatCurrency(yp.budget.amount, settings.baseCurrency)}
                                {' · '}
                                {t('budgets.yearly.monthlyTarget')}: {formatCurrency(yp.monthlyTarget, settings.baseCurrency)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`text-lg font-bold ${isOver ? 'text-red-400' : 'text-white'}`}>
                                {formatCurrency(yp.ytdSpent, settings.baseCurrency)}
                              </p>
                              <p className="text-xs text-slate-400">
                                {t('budgets.yearly.ytdSpent')} ({yp.ytdPercentUsed.toFixed(0)}%)
                              </p>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="mb-2">
                            <div className="flex justify-between text-xs text-slate-500">
                              <span>0%</span>
                              <span>{percentUsed.toFixed(0)}% of annual</span>
                              <span>100%</span>
                            </div>
                            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-700">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  percentUsed >= 100
                                    ? 'bg-red-500'
                                    : percentUsed >= 80
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(percentUsed, 100)}%` }}
                              />
                            </div>
                          </div>

                          {/* Stats row */}
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-slate-400">
                              {t('budgets.yearly.annualRoom')}:{' '}
                              <span className={isOver ? 'text-red-400' : 'text-emerald-400'}>
                                {formatCurrency(yp.budget.amount - yp.ytdSpent, settings.baseCurrency)}
                              </span>
                            </span>
                            <span className="text-slate-400">
                              {t('budgets.yearly.projectedAnnual')}:{' '}
                              <span className={projectedOver ? 'text-amber-400' : 'text-slate-300'}>
                                {formatCurrency(yp.projectedAnnual, settings.baseCurrency)}
                              </span>
                            </span>
                            <span className="text-slate-400">
                              {t('budgets.yearly.monthlyAvg')}:{' '}
                              <span className="text-slate-300">
                                {formatCurrency(
                                  filteredYearlySummaryStats.monthsElapsed > 0
                                    ? yp.ytdSpent / filteredYearlySummaryStats.monthsElapsed
                                    : 0,
                                  settings.baseCurrency
                                )}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ============================================ */}
        {/* Manage Tab */}
        {/* ============================================ */}
        <TabsContent value="manage">
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
