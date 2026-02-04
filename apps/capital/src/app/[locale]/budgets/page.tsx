'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Target,
  Plus,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { BudgetProgressCard } from '@/components/cards';
import { BudgetsTable } from '@/components/tables';
import { BudgetDialog } from '@/components/dialogs';
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
} from '@/lib/store';
import {
  calculateAllBudgetProgress,
  getCurrentMonthBudgets,
  getTotalBudgetAmount,
  getTotalBudgetSpent,
  getBudgetAlerts,
} from '@/lib/utils/budget';
import { toast } from 'sonner';
import type { Budget } from '@/types';
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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | undefined>();
  const [deletingBudget, setDeletingBudget] = useState<Budget | undefined>();
  const [selectedView, setSelectedView] = useState<'current' | 'all'>('current');

  // Calculate budget progress
  const allBudgetProgress = useMemo(() => {
    return calculateAllBudgetProgress(budgets, transactions);
  }, [budgets, transactions]);

  // Get current month budgets
  const currentBudgets = useMemo(() => {
    return getCurrentMonthBudgets(budgets);
  }, [budgets]);

  const currentBudgetProgress = useMemo(() => {
    return calculateAllBudgetProgress(currentBudgets, transactions);
  }, [currentBudgets, transactions]);

  // Get budget alerts
  const alerts = useMemo(() => {
    return getBudgetAlerts(currentBudgets, transactions, 80);
  }, [currentBudgets, transactions]);

  // Calculate summaries
  const summaries = useMemo(() => {
    const totalBudget = getTotalBudgetAmount(currentBudgets);
    const totalSpent = getTotalBudgetSpent(currentBudgets, transactions);
    const onTrack = currentBudgetProgress.filter(
      (p) => p.percentUsed < 80 && p.budget.isActive
    ).length;
    const overBudget = currentBudgetProgress.filter(
      (p) => p.isOverBudget && p.budget.isActive
    ).length;

    return {
      totalBudget,
      totalSpent,
      remaining: totalBudget - totalSpent,
      onTrack,
      overBudget,
      alertsCount: alerts.length,
    };
  }, [currentBudgets, currentBudgetProgress, transactions, alerts]);

  const handleCreate = (data: CreateBudgetFormData) => {
    addBudget(data);
    toast.success(t('budgets.toast.created'));
  };

  const handleUpdate = (data: CreateBudgetFormData) => {
    if (editingBudget) {
      updateBudget(editingBudget.id, data);
      setEditingBudget(undefined);
      toast.success(t('budgets.toast.updated'));
    }
  };

  const handleDelete = () => {
    if (deletingBudget) {
      deleteBudget(deletingBudget.id);
      setDeletingBudget(undefined);
      toast.success(t('budgets.toast.deleted'));
    }
  };

  const handleToggle = (budget: Budget) => {
    toggleBudget(budget.id);
    toast.success(
      budget.isActive
        ? t('budgets.toast.paused')
        : t('budgets.toast.resumed')
    );
  };

  const openEditDialog = (budget: Budget) => {
    setEditingBudget(budget);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingBudget(undefined);
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
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('budgets.summary.totalBudget')}
          value={summaries.totalBudget}
          currency={settings.baseCurrency}
          icon={Target}
          variant="default"
        />
        <SummaryCard
          title={t('budgets.summary.totalSpent')}
          value={summaries.totalSpent}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="expense"
        />
        <SummaryCard
          title={t('budgets.summary.onTrack')}
          value={summaries.onTrack}
          icon={CheckCircle2}
          variant="income"
          isCount
        />
        <SummaryCard
          title={t('budgets.summary.alerts')}
          value={summaries.alertsCount}
          icon={AlertTriangle}
          variant={summaries.alertsCount > 0 ? 'expense' : 'default'}
          isCount
        />
      </div>

      {/* Budget Alerts */}
      {alerts.length > 0 && (
        <Card className="mb-8 border-amber-500/30 bg-amber-500/5 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              {t('budgets.alerts.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {alerts.map((progress) => (
                <BudgetProgressCard
                  key={progress.budget.id}
                  progress={progress}
                  currency={settings.baseCurrency}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Budget Tabs */}
      <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as any)}>
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
