'use client';

import { useTranslations } from 'next-intl';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CalendarCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatCompactNumber, formatPercent } from '@/lib/utils/format';

export interface HistoryDatum {
  label: string;
  actual: number;
  projected: number | null;
}

interface FireHistoryChartProps {
  data: HistoryDatum[];
  currentInvested: number;
  progress: number; // 0..1
  baseCurrency: string;
  locale: string;
  onRecord: () => void;
  isRecording?: boolean;
}

export function FireHistoryChart({
  data,
  currentInvested,
  progress,
  baseCurrency,
  locale,
  onRecord,
  isRecording,
}: FireHistoryChartProps) {
  const t = useTranslations('fire.history');
  const fmt = (n: number) => formatCurrency(n, baseCurrency, locale);
  const hasProjected = data.some((d) => d.projected != null);

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{t('subtitle')}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRecord}
            disabled={isRecording}
            className="shrink-0 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />
            {t('record')}
          </Button>
        </div>

        {data.length >= 2 ? (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => formatCompactNumber(Number(v))} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value, name) => [fmt(Number(value) || 0), name === 'actual' ? t('actual') : t('projected')]}
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#f1f5f9' }}
                  labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                />
                {hasProjected && (
                  <Line type="monotone" dataKey="projected" stroke="#64748b" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                )}
                <Line type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            {hasProjected && (
              <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 bg-emerald-500" /> {t('actual')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-4 border-t border-dashed border-slate-500" /> {t('projected')}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-3xl font-bold text-white">{fmt(currentInvested)}</p>
            <p className="text-sm text-emerald-400">
              {formatPercent(Math.min(100, progress * 100), locale, 1)} {t('ofGoal')}
            </p>
            <p className="mt-2 max-w-sm text-sm text-slate-500">{t('empty')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
