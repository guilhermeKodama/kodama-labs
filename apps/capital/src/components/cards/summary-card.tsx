'use client';

import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';

interface SummaryCardProps {
  title: string;
  value: number;
  currency: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'income' | 'expense' | 'investment';
}

const variantStyles = {
  default: {
    icon: 'from-slate-500/20 to-zinc-500/20',
    iconColor: 'text-slate-400',
  },
  income: {
    icon: 'from-emerald-500/20 to-green-500/20',
    iconColor: 'text-emerald-400',
  },
  expense: {
    icon: 'from-red-500/20 to-rose-500/20',
    iconColor: 'text-red-400',
  },
  investment: {
    icon: 'from-blue-500/20 to-indigo-500/20',
    iconColor: 'text-blue-400',
  },
};

export function SummaryCard({
  title,
  value,
  currency,
  icon: Icon,
  trend,
  variant = 'default',
}: SummaryCardProps) {
  const styles = variantStyles[variant];

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(value, currency)}
            </p>
            {trend && (
              <p
                className={cn(
                  'text-xs font-medium',
                  trend.isPositive ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {trend.isPositive ? '+' : ''}
                {trend.value.toFixed(1)}%
              </p>
            )}
          </div>
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br',
              styles.icon
            )}
          >
            <Icon className={cn('h-6 w-6', styles.iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
