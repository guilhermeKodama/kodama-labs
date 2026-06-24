'use client';

import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatPercent } from '@/lib/utils/format';

export interface SnapshotRow {
  period: number;
  currentInvested: number;
  progress: number;
}

interface FireSnapshotListProps {
  snapshots: SnapshotRow[];
  baseCurrency: string;
  locale: string;
  onAdd: () => void;
  onEdit: (snapshot: SnapshotRow) => void;
  onDelete: (period: number) => void;
}

const fmtMonth = (period: number) => {
  const y = Math.floor(period / 100);
  const m = period % 100;
  return `${String(m).padStart(2, '0')}/${y}`;
};

export function FireSnapshotList({ snapshots, baseCurrency, locale, onAdd, onEdit, onDelete }: FireSnapshotListProps) {
  const t = useTranslations('fire.history');
  const fmt = (n: number) => formatCurrency(n, baseCurrency, locale);
  const sorted = [...snapshots].sort((a, b) => b.period - a.period);

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{t('records')}</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={onAdd}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('addMonth')}
          </Button>
        </div>

        {sorted.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('noRecords')}</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {sorted.map((s) => (
              <div key={s.period} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-slate-300">{fmtMonth(s.period)}</span>
                <div className="flex items-center gap-4">
                  <span className="font-medium text-white">{fmt(s.currentInvested)}</span>
                  <span className="w-12 text-right text-xs text-slate-400">
                    {formatPercent(Math.min(100, s.progress * 100), locale, 0)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onEdit(s)}
                    className="text-slate-500 hover:text-cyan-400"
                    aria-label={t('edit')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(s.period)}
                    className="text-slate-500 hover:text-red-400"
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
