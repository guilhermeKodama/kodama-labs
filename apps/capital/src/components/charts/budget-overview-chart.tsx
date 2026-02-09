'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';
import { formatCurrency } from '@/lib/utils/format';
import type { BudgetProgress } from '@/types';

interface BudgetOverviewChartProps {
  budgetProgress: BudgetProgress[];
  currency: string;
  height?: number;
}

function getStatusColor(percentUsed: number): string {
  if (percentUsed >= 100) return '#ef4444'; // red
  if (percentUsed >= 80) return '#f59e0b'; // amber
  if (percentUsed >= 50) return '#eab308'; // yellow
  return '#10b981'; // emerald
}

export function BudgetOverviewChart({
  budgetProgress,
  currency,
  height = 300,
}: BudgetOverviewChartProps) {
  const t = useTranslations('budgets');

  const chartData = useMemo(() => {
    return budgetProgress
      .filter((p) => p.budget.isActive)
      .map((p) => ({
        name: p.budget.category,
        value: p.budget.amount,
        spent: p.spent,
        remaining: p.remaining,
        percentUsed: p.percentUsed,
        color: getStatusColor(p.percentUsed),
      }));
  }, [budgetProgress]);

  const totalBudget = chartData.reduce((sum, d) => sum + d.value, 0);
  const totalRemaining = chartData.reduce((sum, d) => sum + Math.max(0, d.remaining), 0);

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500"
        style={{ height }}
      >
        No budget data
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            outerRadius={100}
            innerRadius={60}
            fill="#8884d8"
            dataKey="value"
            label={({ name, percent }: { name?: string; percent?: number }) =>
              `${name || ''} (${((percent ?? 0) * 100).toFixed(0)}%)`
            }
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatCurrency(Number(value) || 0, currency)}
            contentStyle={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f1f5f9',
            }}
            labelStyle={{ color: '#f1f5f9' }}
            itemStyle={{ color: '#f1f5f9' }}
          />
          <Legend
            formatter={(value) => (
              <span style={{ color: '#94a3b8' }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Center summary */}
      <div className="flex justify-center gap-8 text-sm">
        <div className="text-center">
          <p className="text-slate-400">{t('roomToSpend.totalBudget')}</p>
          <p className="text-lg font-bold text-white">
            {formatCurrency(totalBudget, currency)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-slate-400">{t('roomToSpend.totalRoom')}</p>
          <p className="text-lg font-bold text-emerald-400">
            {formatCurrency(totalRemaining, currency)}
          </p>
        </div>
      </div>
    </div>
  );
}
