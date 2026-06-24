'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils/format';

interface Breakdown {
  monthlyIncome: number;
  monthlyExpenses: number;
  passiveIncomeNow: number;
  expensesByCategory: { category: string; amount: number }[];
}

function MetricTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg bg-slate-800/40 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-lg font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

export function FireBreakdownPanel({
  breakdown,
  baseCurrency,
  locale,
}: {
  breakdown: Breakdown;
  baseCurrency: string;
  locale: string;
}) {
  const t = useTranslations('fire.breakdown');
  const fmt = (n: number) => formatCurrency(n, baseCurrency, locale);

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="space-y-4 p-6">
        <h3 className="text-sm font-semibold text-white">{t('title')}</h3>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile label={t('income')} value={fmt(breakdown.monthlyIncome)} accent="text-emerald-400" />
          <MetricTile label={t('expenses')} value={fmt(breakdown.monthlyExpenses)} accent="text-red-400" />
          <MetricTile label={t('passiveIncome')} value={fmt(breakdown.passiveIncomeNow)} accent="text-amber-400" />
        </div>

        {breakdown.expensesByCategory.length > 0 && (
          <div className="border-t border-slate-800 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t('byCategory')}</p>
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {breakdown.expensesByCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-400">{c.category}</span>
                  <span className="shrink-0 text-white">{fmt(c.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
