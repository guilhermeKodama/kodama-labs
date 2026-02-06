'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCompactNumber } from '@/lib/utils/format';
import { calculateCashFlow } from '@/lib/utils/calculations';
import type { Transaction, Transfer } from '@/types';

type Period = 'weekly' | 'monthly';

interface CashFlowChartProps {
  transactions: Transaction[];
  transfers: Transfer[];
  currency: string;
  year?: number;
  height?: number;
  showPeriodSelector?: boolean;
  defaultPeriod?: Period;
}

export function CashFlowChart({
  transactions,
  transfers,
  currency,
  year,
  height = 300,
  showPeriodSelector = true,
  defaultPeriod = 'monthly',
}: CashFlowChartProps) {
  const t = useTranslations('charts');
  const [period, setPeriod] = useState<Period>(defaultPeriod);

  const data = useMemo(() => {
    return calculateCashFlow(transactions, transfers, period, year);
  }, [transactions, transfers, period, year]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalInflow = data.reduce((sum, d) => sum + d.inflow, 0);
    const totalOutflow = data.reduce((sum, d) => sum + d.outflow, 0);
    return {
      totalInflow,
      totalOutflow,
      netFlow: totalInflow - totalOutflow,
    };
  }, [data]);

  if (data.length === 0 || (totals.totalInflow === 0 && totals.totalOutflow === 0)) {
    return (
      <div className={`flex items-center justify-center text-slate-500`} style={{ height }}>
        {t('noData')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showPeriodSelector && (
        <div className="flex items-center justify-between">
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-emerald-500" />
              <span className="text-slate-400">{t('inflow')}</span>
              <span className="font-medium text-emerald-400">
                {formatCurrency(totals.totalInflow, currency)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-red-500" />
              <span className="text-slate-400">{t('outflow')}</span>
              <span className="font-medium text-red-400">
                {formatCurrency(totals.totalOutflow, currency)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">{t('netFlow')}</span>
              <span
                className={cn(
                  'font-medium',
                  totals.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {totals.netFlow >= 0 ? '+' : ''}
                {formatCurrency(totals.netFlow, currency)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPeriod('weekly')}
              className={cn(
                'h-7 px-2 text-xs',
                period === 'weekly'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              {t('period.weekly')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPeriod('monthly')}
              className={cn(
                'h-7 px-2 text-xs',
                period === 'monthly'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              {t('period.monthly')}
            </Button>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="inflowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="outflowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="period"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#334155' }}
          />
          <YAxis
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(value) => formatCompactNumber(value)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value, name) => [
              formatCurrency(Number(value) || 0, currency),
              name === 'inflow' ? t('inflow') : name === 'outflow' ? t('outflow') : t('netFlow'),
            ]}
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f1f5f9',
            }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
          />
          <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="inflow"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#inflowGradient)"
            name="inflow"
          />
          <Area
            type="monotone"
            dataKey="outflow"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#outflowGradient)"
            name="outflow"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
