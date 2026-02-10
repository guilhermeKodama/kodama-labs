'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Target,
  TrendingDown,
  Wallet,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import {
  calculateBudgetPace,
  getBudgetStatusColor,
  getBudgetStatusBgColor,
} from '@/lib/utils/budget';
import type { BudgetProgress, Transaction } from '@/types';

interface RoomToSpendSummaryProps {
  budgetProgress: BudgetProgress[];
  transactions: Transaction[];
  currency: string;
}

export function RoomToSpendSummary({
  budgetProgress,
  transactions,
  currency,
}: RoomToSpendSummaryProps) {
  const t = useTranslations('budgets');

  const stats = useMemo(() => {
    const activeBudgets = budgetProgress.filter((p) => p.budget.isActive);
    const totalBudget = activeBudgets.reduce((sum, p) => sum + p.budget.amount, 0);
    const totalSpent = activeBudgets.reduce((sum, p) => sum + p.spent, 0);
    const totalRoom = totalBudget - totalSpent;

    // Calculate overall projected total
    let totalProjected = 0;
    for (const p of activeBudgets) {
      const pace = calculateBudgetPace(p.budget, transactions);
      totalProjected += pace.projectedTotal;
    }

    return { totalBudget, totalSpent, totalRoom, totalProjected };
  }, [budgetProgress, transactions]);

  // Ranked categories sorted by room (most room first)
  const rankedCategories = useMemo(() => {
    return budgetProgress
      .filter((p) => p.budget.isActive)
      .map((p) => {
        const pace = calculateBudgetPace(p.budget, transactions);
        return { ...p, pace };
      })
      .sort((a, b) => b.remaining - a.remaining);
  }, [budgetProgress, transactions]);

  const isOverall = stats.totalRoom < 0;

  return (
    <div className="mb-8 space-y-6">
      {/* Top Stats Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-400">
                  {t('roomToSpend.totalBudget')}
                </p>
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(stats.totalBudget, currency)}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500/20 to-zinc-500/20">
                <Target className="h-6 w-6 text-slate-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-400">
                  {t('roomToSpend.totalSpent')}
                </p>
                <p className="text-2xl font-bold text-white">
                  {formatCurrency(stats.totalSpent, currency)}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-red-500/20 to-rose-500/20">
                <TrendingDown className="h-6 w-6 text-red-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(
          'border-slate-800 bg-slate-900/50 backdrop-blur-sm',
          isOverall && 'border-red-500/30'
        )}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-400">
                  {t('roomToSpend.totalRoom')}
                </p>
                <p className={cn(
                  'text-2xl font-bold',
                  isOverall ? 'text-red-400' : 'text-emerald-400'
                )}>
                  {formatCurrency(Math.abs(stats.totalRoom), currency)}
                  {isOverall && <span className="ml-1 text-sm">over</span>}
                </p>
              </div>
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br',
                isOverall
                  ? 'from-red-500/20 to-rose-500/20'
                  : 'from-emerald-500/20 to-green-500/20'
              )}>
                <Wallet className={cn('h-6 w-6', isOverall ? 'text-red-400' : 'text-emerald-400')} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(
          'border-slate-800 bg-slate-900/50 backdrop-blur-sm',
          stats.totalProjected > stats.totalBudget && 'border-amber-500/30'
        )}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-400">
                  {t('roomToSpend.projected')}
                </p>
                <p className={cn(
                  'text-2xl font-bold',
                  stats.totalProjected > stats.totalBudget ? 'text-amber-400' : 'text-white'
                )}>
                  {formatCurrency(stats.totalProjected, currency)}
                </p>
              </div>
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br',
                stats.totalProjected > stats.totalBudget
                  ? 'from-amber-500/20 to-yellow-500/20'
                  : 'from-blue-500/20 to-indigo-500/20'
              )}>
                <TrendingUp className={cn(
                  'h-6 w-6',
                  stats.totalProjected > stats.totalBudget ? 'text-amber-400' : 'text-blue-400'
                )} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ranked Category Bars */}
      {rankedCategories.length > 0 && (
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <h3 className="mb-4 text-sm font-medium text-slate-400">
              {t('roomToSpend.title')}
            </h3>
            <div className="space-y-3">
              {rankedCategories.map((item) => {
                const { budget, spent, remaining, percentUsed } = item;
                const { isOverPace } = item.pace;
                const statusColor = getBudgetStatusColor(percentUsed);
                const isOver = remaining < 0;

                return (
                  <div key={budget.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">
                          {budget.category}
                        </span>
                        {isOverPace ? (
                          <ArrowUp className="h-3 w-3 text-red-400" />
                        ) : percentUsed > 0 ? (
                          <ArrowDown className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Minus className="h-3 w-3 text-slate-500" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-400">
                          {formatCurrency(spent, currency)} / {formatCurrency(budget.amount, currency)}
                          {budget.period === 'yearly' && (
                            <span className="ml-1 text-slate-500">
                              ({t('roomToSpend.ofAnnual', { amount: formatCurrency(budget.amount * 12, currency) })})
                            </span>
                          )}
                        </span>
                        <span className={cn(
                          'font-medium',
                          isOver ? 'text-red-400' : 'text-emerald-400'
                        )}>
                          {isOver
                            ? `${t('roomToSpend.overBy')} ${formatCurrency(Math.abs(remaining), currency)}`
                            : `${formatCurrency(remaining, currency)} ${t('roomToSpend.roomLeft')}`
                          }
                        </span>
                      </div>
                    </div>
                    <Progress
                      value={Math.min(percentUsed, 100)}
                      className="h-1.5 bg-slate-700"
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
