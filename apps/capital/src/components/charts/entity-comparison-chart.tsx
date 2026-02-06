'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCompactNumber } from '@/lib/utils/format';
import { calculateEntityComparison } from '@/lib/utils/calculations';
import type { Transaction, Transfer, EntityType } from '@/types';

type Metric = 'income' | 'expenses' | 'balance' | 'netWorth';

interface Entity {
  id: string;
  name: string;
  type: EntityType;
  color?: string;
}

interface EntityComparisonChartProps {
  entities: Entity[];
  transactions: Transaction[];
  transfers: Transfer[];
  currency: string;
  height?: number;
  showMetricSelector?: boolean;
  defaultMetric?: Metric;
}

const ENTITY_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
];

export function EntityComparisonChart({
  entities,
  transactions,
  transfers,
  currency,
  height = 300,
  showMetricSelector = true,
  defaultMetric = 'netWorth',
}: EntityComparisonChartProps) {
  const t = useTranslations('charts');
  const tTransactions = useTranslations('transactions');
  const [metric, setMetric] = useState<Metric>(defaultMetric);

  const metrics: Metric[] = ['income', 'expenses', 'balance', 'netWorth'];

  const metricLabels: Record<Metric, string> = {
    income: tTransactions('summary.income'),
    expenses: tTransactions('summary.expenses'),
    balance: tTransactions('summary.balance'),
    netWorth: t('netWorth'),
  };

  const comparisonData = useMemo(() => {
    return calculateEntityComparison(entities, transactions, transfers, currency);
  }, [entities, transactions, transfers, currency]);

  const chartData = useMemo(() => {
    return comparisonData.map((entity, index) => ({
      name: entity.entityName,
      value: entity[metric],
      color: entity.color || ENTITY_COLORS[index % ENTITY_COLORS.length],
      entityType: entity.entityType,
    }));
  }, [comparisonData, metric]);

  if (entities.length === 0 || chartData.length === 0) {
    return (
      <div className={`flex items-center justify-center text-slate-500`} style={{ height }}>
        {t('noData')}
      </div>
    );
  }

  // Sort by value for better visualization
  const sortedData = [...chartData].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4">
      {showMetricSelector && (
        <div className="flex items-center justify-end gap-1 flex-wrap">
          {metrics.map((m) => (
            <Button
              key={m}
              variant="ghost"
              size="sm"
              onClick={() => setMetric(m)}
              className={cn(
                'h-7 px-2 text-xs',
                metric === m
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              {metricLabels[m]}
            </Button>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={sortedData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 80, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={true} vertical={false} />
          <XAxis
            type="number"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(value) => formatCompactNumber(value)}
            tickLine={false}
            axisLine={{ stroke: '#334155' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            formatter={(value) => [formatCurrency(Number(value) || 0, currency), metricLabels[metric]]}
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f1f5f9',
            }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
            cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={40}
          >
            {sortedData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.value >= 0 ? entry.color : '#ef4444'}
                opacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
        {sortedData.map((entity) => (
          <div key={entity.name} className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: entity.color }}
            />
            <span className="text-slate-400">{entity.name}</span>
            <span
              className={cn(
                'font-medium',
                entity.value >= 0 ? 'text-white' : 'text-red-400'
              )}
            >
              {formatCurrency(entity.value, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
