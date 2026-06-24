'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent } from '@/lib/utils/format';

export interface FireGap {
  targetMonthlyIncome: number;
  currentMonthlyExpenses: number;
  difference: number;
  percentDifference: number | null;
  direction: 'above' | 'below' | 'equal';
}

interface FireGapAlertProps {
  gap: FireGap;
  baseCurrency: string;
  locale: string;
}

const styleByDirection = {
  above: { wrap: 'border-amber-500/40 bg-amber-500/10', icon: 'text-amber-400', Icon: TrendingUp },
  below: { wrap: 'border-emerald-500/40 bg-emerald-500/10', icon: 'text-emerald-400', Icon: TrendingDown },
  equal: { wrap: 'border-slate-700 bg-slate-800/40', icon: 'text-slate-400', Icon: Check },
} as const;

export function FireGapAlert({ gap, baseCurrency, locale }: FireGapAlertProps) {
  const t = useTranslations('fire.gap');
  const fmt = (n: number) => formatCurrency(n, baseCurrency, locale);
  const s = styleByDirection[gap.direction];

  const hasBaseline = gap.percentDifference != null && gap.currentMonthlyExpenses > 0;
  const percent = gap.percentDifference != null
    ? formatPercent(Math.abs(gap.percentDifference) * 100, locale, 0)
    : '';

  return (
    <div className={cn('rounded-xl border p-4', s.wrap)}>
      <div className="flex items-start gap-3">
        <s.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', s.icon)} />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">{t('title')}</p>
          {hasBaseline ? (
            <>
              <p className="text-sm text-slate-300">
                {t(gap.direction, {
                  target: fmt(gap.targetMonthlyIncome),
                  current: fmt(gap.currentMonthlyExpenses),
                  percent,
                })}
              </p>
              <p className="text-xs text-slate-400">{t(`${gap.direction}Hint`)}</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">{t('noBaseline')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
