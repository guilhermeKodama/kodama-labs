'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  LineChart,
  Line,
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
import {
  calculateBalanceOverTime,
  getDateRangeForTimeRange,
  type BalanceDataPoint,
} from '@/lib/utils/calculations';
import type { Transaction, Transfer, EntityType } from '@/types';

type TimeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';

interface BalanceLineChartProps {
  transactions: Transaction[];
  transfers: Transfer[];
  currency: string;
  entityId?: string;
  entityType?: EntityType;
  height?: number;
  showTimeRangeSelector?: boolean;
  defaultTimeRange?: TimeRange;
}

export function BalanceLineChart({
  transactions,
  transfers,
  currency,
  entityId,
  entityType,
  height = 300,
  showTimeRangeSelector = true,
  defaultTimeRange = '6M',
}: BalanceLineChartProps) {
  const t = useTranslations('charts');
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);

  const timeRanges: TimeRange[] = ['1M', '3M', '6M', '1Y', 'ALL'];

  const data = useMemo(() => {
    const { startDate, endDate } = getDateRangeForTimeRange(timeRange, transactions);
    const rawData = calculateBalanceOverTime(
      transactions,
      transfers,
      startDate,
      endDate,
      entityId,
      entityType
    );

    // Sample data if too many points (more than 60)
    if (rawData.length > 60) {
      const step = Math.ceil(rawData.length / 60);
      return rawData.filter((_, i) => i % step === 0 || i === rawData.length - 1);
    }

    return rawData;
  }, [transactions, transfers, timeRange, entityId, entityType]);

  // Calculate min/max for Y axis
  const { minBalance, maxBalance } = useMemo(() => {
    if (data.length === 0) return { minBalance: 0, maxBalance: 0 };
    const balances = data.map(d => d.balance);
    return {
      minBalance: Math.min(...balances),
      maxBalance: Math.max(...balances),
    };
  }, [data]);

  // Determine if balance is positive overall
  const latestBalance = data.length > 0 ? data[data.length - 1].balance : 0;
  const balanceColor = latestBalance >= 0 ? '#10b981' : '#ef4444';

  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-slate-500`} style={{ height }}>
        {t('noData')}
      </div>
    );
  }

  const formatDate = (date: string) => {
    const d = new Date(date);
    if (timeRange === '1M' || timeRange === '3M') {
      return d.toLocaleDateString('default', { day: 'numeric', month: 'short' });
    }
    return d.toLocaleDateString('default', { month: 'short', year: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {showTimeRangeSelector && (
        <div className="flex items-center justify-end gap-1">
          {timeRanges.map((range) => (
            <Button
              key={range}
              variant="ghost"
              size="sm"
              onClick={() => setTimeRange(range)}
              className={cn(
                'h-7 px-2 text-xs',
                timeRange === range
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              {t(`timeRange.${range}`)}
            </Button>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={balanceColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={balanceColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={formatDate}
            tickLine={false}
            axisLine={{ stroke: '#334155' }}
          />
          <YAxis
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(value) => formatCompactNumber(value)}
            tickLine={false}
            axisLine={false}
            domain={[
              minBalance < 0 ? minBalance * 1.1 : 0,
              maxBalance > 0 ? maxBalance * 1.1 : 0,
            ]}
          />
          <Tooltip
            formatter={(value) => [formatCurrency(Number(value) || 0, currency), t('balance')]}
            labelFormatter={(label) => new Date(label).toLocaleDateString('default', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f1f5f9',
            }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
          />
          {minBalance < 0 && maxBalance > 0 && (
            <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
          )}
          <Line
            type="monotone"
            dataKey="balance"
            stroke={balanceColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: balanceColor, stroke: '#1e293b', strokeWidth: 2 }}
            fill="url(#balanceGradient)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
