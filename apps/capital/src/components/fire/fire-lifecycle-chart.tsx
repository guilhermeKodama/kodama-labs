'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCompactNumber } from '@/lib/utils/format';

interface McPoint {
  age: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}
interface LifePoint {
  age: number;
  netWorth: number;
  contributionsToDate: number;
  withdrawalsToDate: number;
}

interface ChartMilestone {
  name: string;
  age: number;
  reachedNow: boolean;
  isNext: boolean;
}
interface NextMilestone {
  name: string;
  remaining: number;
  age: number | null;
}

interface FireLifecycleChartProps {
  mcPoints: McPoint[];
  lifePoints: LifePoint[];
  fireNumber: number;
  retirementAge: number;
  baseCurrency: string;
  locale: string;
  milestones?: ChartMilestone[];
  nextMilestone?: NextMilestone | null;
  height?: number;
}

interface TooltipDatum {
  median?: number;
  outer?: [number, number];
  principal?: number;
  growth?: number;
}
interface LifecycleTooltipProps {
  active?: boolean;
  label?: number | string;
  payload?: Array<{ payload: TooltipDatum }>;
  plot: 'networth' | 'composition';
  fmt: (n: number) => string;
  ageLabel: string;
  labels: { median: string; range: string; principal: string; growth: string };
  milestones: ChartMilestone[];
  milestoneLabel: string;
}

function LifecycleTooltip({
  active,
  payload,
  label,
  plot,
  fmt,
  ageLabel,
  labels,
  milestones,
  milestoneLabel,
}: LifecycleTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  const age = Math.round(Number(label));
  const here = milestones.filter((m) => Math.round(m.age) === age);
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100">
      <p className="mb-1 text-slate-400">
        {ageLabel} {age}
      </p>
      {plot === 'networth' ? (
        <>
          <p>
            {labels.median}: <span className="font-semibold">{fmt(d.median ?? 0)}</span>
          </p>
          <p className="text-slate-400">
            {labels.range}: {fmt(d.outer?.[0] ?? 0)} – {fmt(d.outer?.[1] ?? 0)}
          </p>
        </>
      ) : (
        <>
          <p className="text-emerald-400">
            {labels.principal}: {fmt(d.principal ?? 0)}
          </p>
          <p className="text-cyan-400">
            {labels.growth}: {fmt(d.growth ?? 0)}
          </p>
        </>
      )}
      {here.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-slate-700 pt-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{milestoneLabel}</p>
          {here.map((m, i) => (
            <p key={i} className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: m.reachedNow ? '#10b981' : m.isNext ? '#f59e0b' : '#475569' }}
              />
              {m.name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function FireLifecycleChart({
  mcPoints,
  lifePoints,
  fireNumber,
  retirementAge,
  baseCurrency,
  locale,
  milestones = [],
  nextMilestone = null,
  height = 320,
}: FireLifecycleChartProps) {
  const t = useTranslations('fire.projection');
  const [plot, setPlot] = useState<'networth' | 'composition'>('networth');
  const fmt = (n: number) => formatCurrency(n, baseCurrency, locale);

  const medianAtAge = (age: number): number => {
    if (mcPoints.length === 0) return 0;
    let best = mcPoints[0];
    for (const p of mcPoints) if (Math.abs(p.age - age) < Math.abs(best.age - age)) best = p;
    return best.p50;
  };

  const networthData = mcPoints.map((p) => ({
    age: p.age,
    outer: [p.p10, p.p90] as [number, number],
    inner: [p.p25, p.p75] as [number, number],
    median: p.p50,
  }));
  // Composition = cost basis (total contributed) vs. market growth on top. We do
  // NOT subtract withdrawals from the principal — that made "your money" collapse
  // to zero in retirement even while net worth grew. Principal plateaus once
  // contributions stop; everything above it is growth.
  const compositionData = lifePoints.map((p) => {
    const principal = Math.max(0, Math.min(p.contributionsToDate, p.netWorth));
    return { age: p.age, principal, growth: Math.max(0, p.netWorth - principal) };
  });

  const axis = { stroke: '#94a3b8', tick: { fill: '#94a3b8', fontSize: 11 }, tickLine: false };

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
          <div className="flex gap-1">
            {(['networth', 'composition'] as const).map((p) => (
              <Button
                key={p}
                variant="ghost"
                size="sm"
                onClick={() => setPlot(p)}
                className={cn(
                  'h-7 px-2 text-xs',
                  plot === p ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                )}
              >
                {t(p === 'networth' ? 'plotNetWorth' : 'plotComposition')}
              </Button>
            ))}
          </div>
        </div>

        {nextMilestone && (
          <p className="-mt-1 text-xs text-slate-400">
            <span className="text-slate-500">{t('nextMilestone')}:</span>{' '}
            <span className="font-medium text-amber-400">{nextMilestone.name}</span>
            {' · '}
            {t('remaining', { amount: fmt(nextMilestone.remaining) })}
            {nextMilestone.age != null ? ` · ${t('atAge', { age: Math.round(nextMilestone.age) })}` : ''}
          </p>
        )}

        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={plot === 'networth' ? networthData : compositionData}
            margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
          >
            <defs>
              <linearGradient id="fireBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.06} />
              </linearGradient>
              <linearGradient id="lifePrincipal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="lifeGrowth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.6} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis
              dataKey="age"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => `${Math.round(Number(v))}`}
              axisLine={{ stroke: '#334155' }}
              {...axis}
            />
            <YAxis tickFormatter={(v) => formatCompactNumber(Number(v))} axisLine={false} {...axis} />
            <Tooltip
              content={
                <LifecycleTooltip
                  plot={plot}
                  fmt={fmt}
                  ageLabel={t('age')}
                  labels={{
                    median: t('median'),
                    range: t('range'),
                    principal: t('contributions'),
                    growth: t('growth'),
                  }}
                  milestones={milestones}
                  milestoneLabel={t('milestone')}
                />
              }
            />
            <ReferenceLine
              y={fireNumber}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: t('fireLine'), position: 'insideTopRight', fill: '#f59e0b', fontSize: 11 }}
            />
            <ReferenceLine
              x={retirementAge}
              stroke="#64748b"
              strokeDasharray="3 3"
              label={{ value: t('retirement'), position: 'top', fill: '#94a3b8', fontSize: 11 }}
            />
            {plot === 'networth' ? (
              <>
                <Area type="monotone" dataKey="outer" stroke="none" fill="url(#fireBand)" isAnimationActive={false} />
                <Area type="monotone" dataKey="inner" stroke="none" fill="url(#fireBand)" isAnimationActive={false} />
                <Line type="monotone" dataKey="median" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                {milestones.map((ms, i) => (
                  <ReferenceDot
                    key={`ms-${i}`}
                    x={ms.age}
                    y={medianAtAge(ms.age)}
                    r={5}
                    fill={ms.reachedNow ? '#10b981' : ms.isNext ? '#f59e0b' : '#475569'}
                    stroke="#0f172a"
                    strokeWidth={2}
                  />
                ))}
              </>
            ) : (
              <>
                <Area type="monotone" dataKey="principal" stackId="c" stroke="#10b981" strokeWidth={2} fill="url(#lifePrincipal)" isAnimationActive={false} />
                <Area type="monotone" dataKey="growth" stackId="c" stroke="#06b6d4" strokeWidth={2} fill="url(#lifeGrowth)" isAnimationActive={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {plot === 'networth' && milestones.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {t('msReached')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              {t('msNext')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-600" />
              {t('msFuture')}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
