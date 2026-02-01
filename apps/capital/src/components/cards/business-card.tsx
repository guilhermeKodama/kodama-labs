'use client';

import { Building2, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { Business, EntitySummary } from '@/types';

interface BusinessCardProps {
  business: Business;
  summary: EntitySummary;
}

export function BusinessCard({ business, summary }: BusinessCardProps) {
  const isPositive = summary.balance >= 0;

  return (
    <Link href={`/businesses/${business.id}`}>
      <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm transition-all hover:border-slate-700 hover:bg-slate-900/70">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: business.color
                    ? `${business.color}20`
                    : 'rgb(51 65 85 / 0.5)',
                }}
              >
                <Building2
                  className="h-5 w-5"
                  style={{ color: business.color || '#94a3b8' }}
                />
              </div>
              <div>
                <CardTitle className="text-base text-white">
                  {business.name}
                </CardTitle>
                <p className="text-xs text-slate-500">
                  {business.defaultCurrency}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'border-0',
                isPositive
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              )}
            >
              {isPositive ? (
                <TrendingUp className="mr-1 h-3 w-3" />
              ) : (
                <TrendingDown className="mr-1 h-3 w-3" />
              )}
              {isPositive ? '+' : ''}
              {formatCurrency(summary.balance, summary.currency)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-500">Receita</p>
              <p className="text-sm font-medium text-emerald-400">
                {formatCurrency(summary.totalIncome, summary.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Despesas</p>
              <p className="text-sm font-medium text-red-400">
                {formatCurrency(summary.totalExpenses, summary.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Invest.</p>
              <p className="text-sm font-medium text-blue-400">
                {formatCurrency(summary.totalInvestments, summary.currency)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
