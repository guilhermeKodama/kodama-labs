'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils/format';

interface InvestmentCardProps {
  category: string;
  totalValue: number;
  currency: string;
  transactionCount: number;
  percentageOfTotal: number;
}

const categoryIcons: Record<string, string> = {
  Stocks: '📈',
  Bonds: '📊',
  Crypto: '₿',
  'Real Estate': '🏠',
  Savings: '💰',
  Retirement: '🎯',
  'Other Investment': '💎',
};

export function InvestmentCard({
  category,
  totalValue,
  currency,
  transactionCount,
  percentageOfTotal,
}: InvestmentCardProps) {
  const icon = categoryIcons[category] || '💼';

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm transition-all hover:border-slate-700 hover:bg-slate-900/70">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-2xl">
              {icon}
            </div>
            <div>
              <h3 className="font-semibold text-white">{category}</h3>
              <p className="text-xs text-slate-500">
                {transactionCount} transaction{transactionCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-blue-500/50 bg-blue-500/10 text-blue-400"
          >
            {percentageOfTotal.toFixed(1)}%
          </Badge>
        </div>
        <div className="mt-4">
          <p className="text-2xl font-bold text-white">
            {formatCurrency(totalValue, currency)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
