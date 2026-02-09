'use client';

import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { BudgetInsight } from '@/types';

interface BudgetInsightsProps {
  insights: BudgetInsight[];
}

const severityConfig = {
  critical: {
    icon: AlertCircle,
    iconColor: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    badgeBg: 'bg-red-500/20',
    badgeText: 'text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-400',
  },
  good: {
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-emerald-400',
  },
};

export function BudgetInsights({ insights }: BudgetInsightsProps) {
  const t = useTranslations('budgets');

  if (insights.length === 0) return null;

  const criticalAndWarning = insights.filter(
    (i) => i.severity === 'critical' || i.severity === 'warning'
  );
  const good = insights.filter((i) => i.severity === 'good');

  return (
    <Card className="mb-8 border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-white">
          <TrendingUp className="h-5 w-5 text-cyan-400" />
          {t('insights.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Critical & Warning insights first */}
          {criticalAndWarning.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {t('insights.holdSpending')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {criticalAndWarning.map((insight) => {
                  const config = severityConfig[insight.severity];
                  const Icon = config.icon;
                  return (
                    <div
                      key={insight.budgetId}
                      className={cn(
                        'rounded-lg border p-3',
                        config.borderColor,
                        config.bgColor
                      )}
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className={cn('h-4 w-4', config.iconColor)} />
                          <span className="text-sm font-medium text-white">
                            {insight.category}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            config.badgeBg,
                            config.badgeText
                          )}
                        >
                          {insight.percentUsed.toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">{insight.message}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {insight.recommendation}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Good insights */}
          {good.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {t('insights.roomAvailable')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {good.map((insight) => {
                  const config = severityConfig.good;
                  return (
                    <div
                      key={insight.budgetId}
                      className={cn(
                        'rounded-lg border p-3',
                        config.borderColor,
                        config.bgColor
                      )}
                    >
                      <div className="mb-2 flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span className="text-sm font-medium text-white">
                            {insight.category}
                          </span>
                        </div>
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          {insight.percentUsed.toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">{insight.message}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {insight.recommendation}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
