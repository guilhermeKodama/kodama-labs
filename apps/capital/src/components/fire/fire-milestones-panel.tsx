'use client';

import { useTranslations } from 'next-intl';
import { Plus, Trash2, Flag } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatPercent } from '@/lib/utils/format';

export interface MilestoneRow {
  id: string;
  name: string;
  reachedNow: boolean;
  achievedAge: number | null;
  progress: number;
  isCustom: boolean;
}

interface FireMilestonesPanelProps {
  milestones: MilestoneRow[];
  currentAge: number;
  currentYear: number;
  locale: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function FireMilestonesPanel({
  milestones,
  currentAge,
  currentYear,
  locale,
  onAdd,
  onRemove,
}: FireMilestonesPanelProps) {
  const t = useTranslations('fire.milestones');

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Flag className="h-4 w-4 text-emerald-400" />
            {t('title')}
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={onAdd}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('addCustom')}
          </Button>
        </div>

        <div className="space-y-3">
          {milestones.map((m) => {
            const pct = Math.min(100, Math.max(0, m.progress * 100));
            const projected = m.reachedNow
              ? t('reachedNow')
              : m.achievedAge != null
                ? t('projectedFor', {
                    age: Math.round(m.achievedAge),
                    year: currentYear + Math.round(m.achievedAge - currentAge),
                  })
                : t('notProjected');
            return (
              <div key={m.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="text-slate-200">{m.name}</span>
                    <span
                      className={cn(
                        'ml-2 text-xs',
                        m.reachedNow ? 'text-emerald-400' : m.achievedAge != null ? 'text-slate-400' : 'text-amber-400'
                      )}
                    >
                      {projected}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-medium text-slate-400">{formatPercent(pct, locale, 0)}</span>
                    {m.isCustom && (
                      <button
                        type="button"
                        onClick={() => onRemove(m.id)}
                        className="text-slate-500 hover:text-red-400"
                        aria-label={t('remove')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
