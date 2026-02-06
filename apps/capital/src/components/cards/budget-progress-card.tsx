'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { getBudgetStatusColor } from '@/lib/utils/budget';
import type { BudgetProgress } from '@/types';
import { AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';

interface BudgetProgressCardProps {
  progress: BudgetProgress;
  currency: string;
}

export function BudgetProgressCard({ progress, currency }: BudgetProgressCardProps) {
  const t = useTranslations('budgets');
  const { budget, spent, remaining, percentUsed, isOverBudget } = progress;

  const statusColor = getBudgetStatusColor(percentUsed);
  const StatusIcon = isOverBudget
    ? AlertCircle
    : percentUsed >= 80
    ? AlertTriangle
    : CheckCircle2;

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h4 className="font-medium text-white">{budget.category}</h4>
            <p className="text-xs text-slate-500">
              {budget.period === 'monthly'
                ? t('periods.monthly')
                : t('periods.yearly')}
            </p>
          </div>
          <StatusIcon
            className={cn(
              'h-5 w-5',
              isOverBudget
                ? 'text-red-400'
                : percentUsed >= 80
                ? 'text-amber-400'
                : 'text-emerald-400'
            )}
          />
        </div>

        <div className="mb-2 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{t('card.spent')}</span>
            <span className={cn('font-medium', statusColor)}>
              {formatCurrency(spent, currency)}
            </span>
          </div>
          <Progress
            value={Math.min(percentUsed, 100)}
            className="h-2 bg-slate-700"
          />
        </div>

        <div className="flex justify-between text-xs">
          <span className="text-slate-500">
            {isOverBudget ? t('card.over') : t('card.remaining')}:{' '}
            <span className={cn('font-medium', isOverBudget ? 'text-red-400' : 'text-emerald-400')}>
              {formatCurrency(Math.abs(remaining), currency)}
            </span>
          </span>
          <span className="text-slate-500">
            {t('card.budget')}: {formatCurrency(budget.amount, currency)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
