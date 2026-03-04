'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTranslations } from 'next-intl';
import { formatCurrency, formatCompactNumber } from '@/lib/utils/format';

interface MonthlyData {
  month: string;
  income: number;
  expense: number;
  investment: number;
}

interface IncomeExpenseChartProps {
  data: MonthlyData[];
  currency: string;
}

export function IncomeExpenseChart({ data, currency }: IncomeExpenseChartProps) {
  const t = useTranslations();

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-slate-500">
        {t('charts.noData')}
      </div>
    );
  }

  const incomeLabel = t('transactions.types.income');
  const expenseLabel = t('transactions.types.expense');
  const investmentLabel = t('transactions.types.investment');

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="month"
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
            String(name),
          ]}
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f1f5f9',
          }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ color: '#94a3b8' }}>
              {String(value)}
            </span>
          )}
        />
        <Bar
          dataKey="income"
          fill="#10b981"
          radius={[4, 4, 0, 0]}
          name={incomeLabel}
        />
        <Bar
          dataKey="expense"
          fill="#ef4444"
          radius={[4, 4, 0, 0]}
          name={expenseLabel}
        />
        <Bar
          dataKey="investment"
          fill="#3b82f6"
          radius={[4, 4, 0, 0]}
          name={investmentLabel}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
