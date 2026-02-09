'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Plus, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { UnbudgetedCategory } from '@/types';

interface UnbudgetedSpendingCardProps {
  unbudgetedCategories: UnbudgetedCategory[];
  currency: string;
  onCreateBudget?: (category: string, entityId: string, entityType: string) => void;
}

export function UnbudgetedSpendingCard({
  unbudgetedCategories,
  currency,
  onCreateBudget,
}: UnbudgetedSpendingCardProps) {
  const t = useTranslations('budgets');

  if (unbudgetedCategories.length === 0) return null;

  const currentMonth = unbudgetedCategories.filter((c) => !c.isFromPreviousMonth);
  const previousMonth = unbudgetedCategories.filter((c) => c.isFromPreviousMonth);

  const renderCategory = (cat: UnbudgetedCategory) => (
    <div
      key={`${cat.entityId}-${cat.category}`}
      className={cn(
        'flex items-center justify-between rounded-lg border p-3',
        cat.isFromPreviousMonth
          ? 'border-slate-700/30 bg-slate-800/30'
          : 'border-slate-700/50 bg-slate-800/50'
      )}
    >
      <div>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white">{cat.category}</p>
          {cat.isFromPreviousMonth && (
            <span className="flex items-center gap-1 rounded-full bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400">
              <History className="h-2.5 w-2.5" />
              {t('unbudgeted.lastMonth')}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">
          {formatCurrency(cat.totalSpent, currency)} {t('unbudgeted.spent')}{' '}
          &middot; {cat.transactionCount} {t('unbudgeted.transactions')}
        </p>
      </div>
      {onCreateBudget && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-amber-500/30 px-2 text-xs text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          onClick={() =>
            onCreateBudget(cat.category, cat.entityId, cat.entityType)
          }
        >
          <Plus className="mr-1 h-3 w-3" />
          {t('unbudgeted.createBudget')}
        </Button>
      )}
    </div>
  );

  return (
    <Card className="mb-8 border-amber-500/20 bg-amber-500/5 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-amber-400">
          <AlertTriangle className="h-5 w-5" />
          {t('unbudgeted.title')}
        </CardTitle>
        <p className="text-sm text-slate-400">{t('unbudgeted.description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current month unbudgeted */}
        {currentMonth.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {currentMonth.map(renderCategory)}
          </div>
        )}

        {/* Previous month categories (CC spending from last bill) */}
        {previousMonth.length > 0 && (
          <div>
            {currentMonth.length > 0 && (
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                {t('unbudgeted.basedOnLastMonth')}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {previousMonth.map(renderCategory)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
