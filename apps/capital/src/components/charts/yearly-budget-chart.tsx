'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Line,
  ComposedChart,
} from 'recharts';
import { formatCurrency } from '@/lib/utils/format';
import { formatCompactNumber } from '@/lib/utils/format';
import type { YearlyBudgetProgress } from '@/types';

interface YearlyBudgetChartProps {
  yearlyProgress: YearlyBudgetProgress[];
  currency: string;
  height?: number;
}

export function YearlyBudgetChart({
  yearlyProgress,
  currency,
  height = 350,
}: YearlyBudgetChartProps) {
  const t = useTranslations('budgets.yearly');

  // Aggregate all categories into monthly totals
  const chartData = useMemo(() => {
    if (yearlyProgress.length === 0) return [];

    const monthLabels = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    return monthLabels.map((label, i) => {
      const month = i + 1;
      let totalBudget = 0;
      let totalActual = 0;
      let totalCumulativeBudget = 0;
      let totalCumulativeActual = 0;

      for (const yp of yearlyProgress) {
        const monthData = yp.months.find((m) => m.month === month);
        if (monthData) {
          totalBudget += monthData.budgetTarget;
          totalActual += monthData.actual;
          totalCumulativeBudget += monthData.cumulativeBudget;
          totalCumulativeActual += monthData.cumulativeActual;
        }
      }

      return {
        name: label,
        month,
        budget: Math.round(totalBudget * 100) / 100,
        actual: Math.round(totalActual * 100) / 100,
        cumulativeBudget: Math.round(totalCumulativeBudget * 100) / 100,
        cumulativeActual: Math.round(totalCumulativeActual * 100) / 100,
      };
    });
  }, [yearlyProgress]);

  if (chartData.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-500"
        style={{ height }}
      >
        {t('noYearlyBudgets')}
      </div>
    );
  }

  // Determine which months have data (current/past months)
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  return (
    <div className="space-y-6">
      {/* Budget vs Actual Bar Chart */}
      <div>
        <h4 className="mb-3 text-sm font-medium text-slate-400">
          {t('budgetVsActual')}
        </h4>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="name"
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
            />
            <YAxis
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={(value) => formatCompactNumber(value)}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(Number(value) || 0, currency),
                name === 'budget' ? t('budget') : t('actual'),
              ]}
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f1f5f9',
              }}
              labelStyle={{ color: '#f1f5f9' }}
            />
            <Legend
              formatter={(value) => (
                <span style={{ color: '#94a3b8' }}>
                  {value === 'budget' ? t('budget') : t('actual')}
                </span>
              )}
            />
            <Bar
              dataKey="budget"
              fill="#334155"
              radius={[4, 4, 0, 0]}
              name="budget"
            />
            <Bar
              dataKey="actual"
              radius={[4, 4, 0, 0]}
              name="actual"
              fill="#3b82f6"
              // Color bars based on over/under budget
              shape={(props: unknown) => {
                const p = props as {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  payload: { actual: number; budget: number; month: number };
                };
                const isOver = p.payload.actual > p.payload.budget;
                const isFuture = p.payload.month > currentMonth;
                const barFill = isFuture
                  ? '#475569'
                  : isOver
                    ? '#ef4444'
                    : '#10b981';
                return (
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.width}
                    height={p.height}
                    fill={barFill}
                    rx={4}
                    ry={4}
                  />
                );
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cumulative Progress Line */}
      <div>
        <h4 className="mb-3 text-sm font-medium text-slate-400">
          {t('cumulativeProgress')}
        </h4>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="name"
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
            />
            <YAxis
              stroke="#94a3b8"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={(value) => formatCompactNumber(value)}
            />
            <Tooltip
              formatter={(value, name) => [
                formatCurrency(Number(value) || 0, currency),
                name === 'cumulativeBudget' ? t('budget') : t('actual'),
              ]}
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f1f5f9',
              }}
              labelStyle={{ color: '#f1f5f9' }}
            />
            <Legend
              formatter={(value) => (
                <span style={{ color: '#94a3b8' }}>
                  {value === 'cumulativeBudget' ? t('budget') : t('actual')}
                </span>
              )}
            />
            <Line
              type="monotone"
              dataKey="cumulativeBudget"
              stroke="#64748b"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="cumulativeBudget"
            />
            <Line
              type="monotone"
              dataKey="cumulativeActual"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ fill: '#3b82f6', r: 3 }}
              name="cumulativeActual"
            />
            <ReferenceLine y={0} stroke="#475569" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
