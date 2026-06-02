'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { format, startOfMonth, endOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';

export type PeriodPreset = 'thisMonth' | 'last3M' | 'ytd' | '1Y' | 'all' | 'custom';

export interface PeriodRange {
  preset: PeriodPreset;
  from?: Date;
  to?: Date;
}

interface PeriodRangeSelectorProps {
  value: PeriodRange;
  onChange: (value: PeriodRange) => void;
}

export function presetToRange(
  preset: PeriodPreset,
  now: Date = new Date()
): { from?: Date; to?: Date } {
  switch (preset) {
    case 'thisMonth':
      // Cover the entire current month, including scheduled/recurring entries
      // that fall after `now` — the Activity tab and other pages already do
      // this; the Sankey was the only place clipping at `now`, which silently
      // dropped the rest-of-month transactions.
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'last3M':
      return { from: startOfMonth(subMonths(now, 2)), to: endOfMonth(now) };
    case 'ytd':
      return { from: startOfYear(now), to: now };
    case '1Y':
      return { from: subYears(now, 1), to: now };
    case 'all':
      return { from: undefined, to: undefined };
    case 'custom':
      return {};
  }
}

const PRESETS: PeriodPreset[] = ['thisMonth', 'last3M', 'ytd', '1Y', 'all'];

export function PeriodRangeSelector({ value, onChange }: PeriodRangeSelectorProps) {
  const t = useTranslations('charts.period');
  const locale = useLocale();
  const dateLocale = locale === 'pt-BR' ? ptBR : enUS;
  const [open, setOpen] = useState(false);

  const handlePresetClick = (preset: PeriodPreset) => {
    const { from, to } = presetToRange(preset);
    onChange({ preset, from, to });
  };

  const handleCustomChange = (range: DateRange | undefined) => {
    if (!range) return;
    onChange({ preset: 'custom', from: range.from, to: range.to });
    if (range.from && range.to) setOpen(false);
  };

  const customLabel = (() => {
    if (value.preset !== 'custom') return t('custom');
    if (value.from && value.to) {
      return `${format(value.from, 'd MMM', { locale: dateLocale })} – ${format(
        value.to,
        'd MMM yyyy',
        { locale: dateLocale }
      )}`;
    }
    return t('custom');
  })();

  return (
    <div className="flex flex-wrap items-center gap-1">
      {PRESETS.map((preset) => {
        const active = value.preset === preset;
        return (
          <Button
            key={preset}
            variant="outline"
            size="sm"
            onClick={() => handlePresetClick(preset)}
            className={cn(
              'h-8 rounded-full border text-xs transition-colors',
              active
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300'
                : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
            )}
          >
            {t(preset)}
          </Button>
        );
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 rounded-full border text-xs transition-colors',
              value.preset === 'custom'
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300'
                : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
            )}
          >
            <CalendarIcon className="mr-1 h-3 w-3" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={
              value.from || value.to
                ? { from: value.from, to: value.to }
                : undefined
            }
            onSelect={handleCustomChange}
            defaultMonth={value.from ?? new Date()}
            locale={dateLocale}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
