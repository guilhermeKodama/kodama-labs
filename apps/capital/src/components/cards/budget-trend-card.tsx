'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { MonthOverMonth } from '@/types';

interface BudgetTrendCardProps {
  trends: MonthOverMonth[];
  currency: string;
}

export function BudgetTrendCard({ trends, currency }: BudgetTrendCardProps) {
  const t = useTranslations('budgets');

  if (trends.length === 0) return null;

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-white">{t('trend.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trends.map((trend) => {
            const isIncrease = trend.changePercent > 0;
            const isDecrease = trend.changePercent < 0;
            const isNew = trend.previousSpent === 0 && trend.currentSpent > 0;

            return (
              <div
                key={`${trend.entityId}-${trend.category}`}
                className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    {trend.category}
                  </span>
                  {isNew ? (
                    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
                      {t('trend.new')}
                    </span>
                  ) : isIncrease ? (
                    <div className="flex items-center gap-1 text-red-400">
                      <TrendingUp className="h-3 w-3" />
                      <span className="text-xs font-medium">
                        +{trend.changePercent.toFixed(0)}%
                      </span>
                    </div>
                  ) : isDecrease ? (
                    <div className="flex items-center gap-1 text-emerald-400">
                      <TrendingDown className="h-3 w-3" />
                      <span className="text-xs font-medium">
                        {trend.changePercent.toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-slate-400">
                      <Minus className="h-3 w-3" />
                      <span className="text-xs">{t('trend.noChange')}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-end justify-between text-xs">
                  <div>
                    <span className="text-slate-500">This month: </span>
                    <span className="font-medium text-slate-300">
                      {formatCurrency(trend.currentSpent, currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Last: </span>
                    <span className="text-slate-400">
                      {trend.previousSpent > 0
                        ? formatCurrency(trend.previousSpent, currency)
                        : t('trend.noPrevious')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
