'use client';

import { useTranslations } from 'next-intl';
import { ArrowDownLeft, ArrowUpRight, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import type { Transaction, TransactionType } from '@/types';

interface RecentTransactionsProps {
  transactions: Array<Transaction & { entityName: string }>;
  limit?: number;
}

const typeConfig: Record<
  TransactionType,
  { icon: typeof ArrowDownLeft; color: string; bgColor: string }
> = {
  income: {
    icon: ArrowDownLeft,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  expense: {
    icon: ArrowUpRight,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
  },
  investment: {
    icon: TrendingUp,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
};

export function RecentTransactions({
  transactions,
  limit = 5,
}: RecentTransactionsProps) {
  const t = useTranslations('dashboard');

  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  if (recentTransactions.length === 0) {
    return (
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg text-white">
            {t('recentTransactions')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <p className="text-slate-400">{t('noTransactions')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg text-white">
          {t('recentTransactions')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-800">
          {recentTransactions.map((transaction) => {
            const config = typeConfig[transaction.type];
            const Icon = config.icon;

            return (
              <div
                key={transaction.id}
                className="flex items-center justify-between px-6 py-3 transition-colors hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg',
                      config.bgColor
                    )}
                  >
                    <Icon className={cn('h-4 w-4', config.color)} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {transaction.description}
                    </p>
                    <p className="text-xs text-slate-500">
                      {transaction.entityName} • {formatDate(transaction.date)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      transaction.type === 'expense'
                        ? 'text-red-400'
                        : 'text-white'
                    )}
                  >
                    {transaction.type === 'expense' ? '-' : '+'}
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-1 border-slate-700 text-xs text-slate-400"
                  >
                    {transaction.category}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
