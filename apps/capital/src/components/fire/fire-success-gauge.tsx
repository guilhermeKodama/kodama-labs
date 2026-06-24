'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WithdrawalStrategy } from '@/lib/fire';

/**
 * Radial "chance of success" gauge (% of Monte Carlo trials that last to life
 * expectancy). For a spend-down plan ~50% is on-target (the median lands at zero
 * exactly at life expectancy), so the colour bands are softer than for a
 * live-off-the-yield plan, where you want a comfortable margin.
 */
export function FireSuccessGauge({
  probability,
  strategy = 'perpetuity',
}: {
  probability: number;
  strategy?: WithdrawalStrategy;
}) {
  const t = useTranslations('fire.projection');
  const pct = Math.round(Math.max(0, Math.min(1, probability)) * 100);
  const greenAt = strategy === 'depletion' ? 65 : 85;
  const amberAt = strategy === 'depletion' ? 45 : 60;
  const color = pct >= greenAt ? 'text-emerald-400' : pct >= amberAt ? 'text-amber-400' : 'text-red-400';
  const ring = pct >= greenAt ? 'stroke-emerald-500' : pct >= amberAt ? 'stroke-amber-500' : 'stroke-red-500';

  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dash = (pct / 100) * circ;

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="flex items-center gap-5 p-6">
        <div className="relative h-28 w-28 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-slate-800" />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              className={ring}
              strokeDasharray={`${dash} ${circ}`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-2xl font-bold', color)}>{pct}%</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{t('success')}</p>
          <p className="mt-1 text-xs text-slate-400">
            {t(strategy === 'depletion' ? 'successHintDepletion' : 'successHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
