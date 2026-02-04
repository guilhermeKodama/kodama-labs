'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent } from '@/lib/utils/format';
import type { TaxSummary } from '@/types';
import { Building2, User, Receipt, Calculator, Percent } from 'lucide-react';

interface TaxSummaryCardProps {
  summary: TaxSummary;
  currency: string;
  isPersonal?: boolean;
}

export function TaxSummaryCard({ summary, currency, isPersonal }: TaxSummaryCardProps) {
  const t = useTranslations('tax');

  const Icon = isPersonal ? User : Building2;

  return (
    <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg text-white">
            <Icon className="h-5 w-5 text-slate-400" />
            {summary.entityName}
          </CardTitle>
          <Badge variant="outline" className="border-slate-700 text-slate-400">
            <Percent className="mr-1 h-3 w-3" />
            {summary.taxRate}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">{t('card.totalIncome')}</p>
            <p className="text-lg font-semibold text-emerald-400">
              {formatCurrency(summary.totalIncome, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t('card.deductions')}</p>
            <p className="text-lg font-semibold text-blue-400">
              {formatCurrency(summary.totalDeductible, currency)}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-amber-400" />
              <span className="text-sm text-slate-300">{t('card.taxableIncome')}</span>
            </div>
            <span className="font-semibold text-white">
              {formatCurrency(summary.taxableIncome, currency)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-400">{t('card.estimatedTax')}</span>
          </div>
          <span className="text-lg font-bold text-amber-400">
            {formatCurrency(summary.estimatedTax, currency)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
