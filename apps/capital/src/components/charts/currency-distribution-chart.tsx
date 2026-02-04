'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import { calculateCurrencyDistribution, type CurrencyDistribution } from '@/lib/utils/calculations';
import type { Transaction, Transfer } from '@/types';

interface CurrencyDistributionChartProps {
  transactions: Transaction[];
  transfers: Transfer[];
  baseCurrency: string;
  height?: number;
}

const CURRENCY_COLORS: Record<string, string> = {
  USD: '#22c55e', // green
  EUR: '#3b82f6', // blue
  BRL: '#f59e0b', // amber
  GBP: '#8b5cf6', // violet
  JPY: '#ef4444', // red
  CAD: '#ec4899', // pink
  AUD: '#06b6d4', // cyan
  CHF: '#84cc16', // lime
};

const DEFAULT_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#6366f1',
];

export function CurrencyDistributionChart({
  transactions,
  transfers,
  baseCurrency,
  height = 300,
}: CurrencyDistributionChartProps) {
  const t = useTranslations('charts');

  const data = useMemo(() => {
    const distribution = calculateCurrencyDistribution(transactions, transfers);
    return distribution.map((item, index) => ({
      ...item,
      color: CURRENCY_COLORS[item.currency] || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    }));
  }, [transactions, transfers]);

  if (data.length === 0) {
    return (
      <div className={`flex items-center justify-center text-slate-500`} style={{ height }}>
        {t('noData')}
      </div>
    );
  }

  // Calculate total for display
  const total = data.reduce((sum, item) => sum + item.amount, 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-800/95 p-3 shadow-lg backdrop-blur-sm">
          <p className="mb-1 font-medium text-white">{item.currency}</p>
          <p className="text-sm text-slate-300">
            {formatCurrency(item.amount, item.currency)}
          </p>
          <p className="text-xs text-slate-400">
            {formatPercent(item.percentage)}
          </p>
        </div>
      );
    }
    return null;
  };

  const renderLabel = (props: any) => {
    const { payload, percent } = props;
    if (!payload || percent < 0.05) return null; // Don't show label for small slices (< 5%)
    return `${payload.currency} (${(percent * 100).toFixed(0)}%)`;
  };

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderLabel}
            outerRadius={100}
            innerRadius={60}
            fill="#8884d8"
            dataKey="amount"
            nameKey="currency"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span className="text-slate-300">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 md:grid-cols-4">
        {data.map((item) => (
          <div
            key={item.currency}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2"
          >
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-white">{item.currency}</p>
              <p className="text-xs text-slate-400">
                {formatPercent(item.percentage)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
