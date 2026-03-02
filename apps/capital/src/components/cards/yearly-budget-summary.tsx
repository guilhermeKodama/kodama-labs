'use client';

import { useTranslations } from 'next-intl';
import {
  Target,
  TrendingDown,
  Wallet,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { YearlySummaryStats } from '@/types';

interface YearlyBudgetSummaryProps {
  stats: YearlySummaryStats;
  currency: string;
  year: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function YearlyBudgetSummary({ stats, currency, year }: YearlyBudgetSummaryProps) {
  const t = useTranslations('budgets.yearly');

  const isOver = stats.totalAnnualRoom < 0;
  const projectedOver = stats.projectedAnnualTotal > stats.totalAnnualBudget;

  return (
    <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Annual Budget */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-400">
                {t('annualBudget')}
              </p>
              <p className="text-2xl font-bold text-white">
                {formatCurrency(stats.totalAnnualBudget, currency)}
              </p>
              <p className="text-xs text-slate-500">
                {t('monthlyTarget')}: {formatCurrency(stats.totalAnnualBudget / 12, currency)}
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500/20 to-zinc-500/20">
              <Target className="h-6 w-6 text-slate-400" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Annual Spent (includes known future installments) */}
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-400">
                {t('ytdSpent')}
              </p>
              <p className="text-2xl font-bold text-white">
                {formatCurrency(stats.totalAnnualSpent, currency)}
              </p>
              <p className="text-xs text-slate-500">
                {stats.monthsElapsed} / 12 months
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-red-500/20 to-rose-500/20">
              <TrendingDown className="h-6 w-6 text-red-400" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Annual Room */}
      <Card className={cn(
        'border-slate-800 backdrop-blur-sm',
        isOver ? 'bg-red-950/30' : 'bg-slate-900/50'
      )}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-400">
                {t('annualRoom')}
              </p>
              <p className={cn(
                'text-2xl font-bold',
                isOver ? 'text-red-400' : 'text-emerald-400'
              )}>
                {isOver ? '' : ''}{formatCurrency(Math.abs(stats.totalAnnualRoom), currency)}
                {isOver && <span className="ml-1 text-sm font-normal text-red-400">over</span>}
              </p>
            </div>
            <div className={cn(
              'flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br',
              isOver ? 'from-red-500/20 to-rose-500/20' : 'from-emerald-500/20 to-green-500/20'
            )}>
              <Wallet className={cn('h-6 w-6', isOver ? 'text-red-400' : 'text-emerald-400')} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Projected Annual */}
      <Card className={cn(
        'border-slate-800 backdrop-blur-sm',
        projectedOver ? 'bg-amber-950/20' : 'bg-slate-900/50'
      )}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-400">
                {t('projectedAnnual')}
              </p>
              <p className={cn(
                'text-2xl font-bold',
                projectedOver ? 'text-amber-400' : 'text-white'
              )}>
                {formatCurrency(stats.projectedAnnualTotal, currency)}
              </p>
              <p className={cn(
                'text-xs font-medium',
                stats.isOnTrack ? 'text-emerald-400' : 'text-amber-400'
              )}>
                {stats.isOnTrack ? t('onTrackForYear') : t('overPaceForYear')}
              </p>
            </div>
            <div className={cn(
              'flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br',
              projectedOver ? 'from-amber-500/20 to-yellow-500/20' : 'from-cyan-500/20 to-blue-500/20'
            )}>
              <TrendingUp className={cn('h-6 w-6', projectedOver ? 'text-amber-400' : 'text-cyan-400')} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
