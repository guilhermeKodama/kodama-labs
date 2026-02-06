'use client';

import { useTranslations } from 'next-intl';
import { Pencil, Trash2, CreditCard as CreditCardIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import type { CreditCard } from '@/types';

interface CreditCardVisualProps {
  card: CreditCard;
  currentBalance?: number;
  entityName?: string;
  onEdit?: (card: CreditCard) => void;
  onDelete?: (card: CreditCard) => void;
}

export function CreditCardVisual({ card, currentBalance = 0, entityName, onEdit, onDelete }: CreditCardVisualProps) {
  const t = useTranslations('creditCards');
  const available = card.creditLimit - currentBalance;
  const utilization = card.creditLimit > 0 ? (currentBalance / card.creditLimit) * 100 : 0;

  const getUtilizationColor = () => {
    if (utilization >= 90) return 'bg-red-500';
    if (utilization >= 70) return 'bg-amber-500';
    return 'bg-emerald-400';
  };

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-slate-700/50 p-5 transition-all hover:border-slate-600"
      style={{
        background: `linear-gradient(135deg, ${card.color}22, ${card.color}08)`,
      }}
    >
      {/* Top row: Bank name + Actions */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${card.color}30` }}
          >
            <CreditCardIcon className="h-4 w-4" style={{ color: card.color }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{card.bankName}</p>
            <div className="flex items-center gap-1.5">
              {card.nickname && (
                <span className="text-xs text-slate-400">{card.nickname}</span>
              )}
              {entityName && (
                <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {entityName}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!card.isActive && (
            <span className="mr-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
              {t('card.inactive')}
            </span>
          )}
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-white"
              onClick={() => onEdit(card)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-red-400"
              onClick={() => onDelete(card)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Card number */}
      <div className="mb-4">
        <p className="font-mono text-lg tracking-widest text-slate-300">
          •••• •••• •••• {card.lastFourDigits}
        </p>
      </div>

      {/* Balance and Limit */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-slate-400">{t('summary.currentBalance')}</p>
          <p className="text-lg font-bold text-white">
            {formatCurrency(currentBalance, card.currency)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">{t('card.limit')}</p>
          <p className="text-sm text-slate-300">
            {formatCurrency(card.creditLimit, card.currency)}
          </p>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="mb-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/50">
          <div
            className={cn('h-full rounded-full transition-all', getUtilizationColor())}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-xs text-slate-500">
            {t('card.utilization')}: {utilization.toFixed(0)}%
          </span>
          <span className="text-xs text-slate-500">
            {t('card.available')}: {formatCurrency(Math.max(available, 0), card.currency)}
          </span>
        </div>
      </div>

      {/* Bottom row: Closing/Due dates */}
      <div className="flex items-center gap-4 border-t border-slate-700/30 pt-3">
        <div>
          <span className="text-xs text-slate-500">{t('card.closes')}</span>
          <span className="ml-1 text-xs font-medium text-slate-300">
            {card.closingDay}{getSuffix(card.closingDay)}
          </span>
        </div>
        <div className="h-3 w-px bg-slate-700" />
        <div>
          <span className="text-xs text-slate-500">{t('card.due')}</span>
          <span className="ml-1 text-xs font-medium text-slate-300">
            {card.dueDay}{getSuffix(card.dueDay)}
          </span>
        </div>
      </div>
    </div>
  );
}

function getSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
