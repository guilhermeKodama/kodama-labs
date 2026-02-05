'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  MoreVertical,
  Pencil,
  Trash2,
  Pause,
  Play,
  Calendar,
  Repeat,
  Check,
  AlertCircle,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { RecurringTransaction, TransactionType } from '@/types';
import { useSettingsStore, useBusinessStore } from '@/lib/store';

interface RecurringTableProps {
  recurringTransactions: RecurringTransaction[];
  onEdit?: (recurring: RecurringTransaction) => void;
  onDelete?: (recurring: RecurringTransaction) => void;
  onToggle?: (recurring: RecurringTransaction) => void;
  onMarkPaid?: (recurring: RecurringTransaction) => void;
  isMarkingPaid?: string | null; // ID of the recurring being marked as paid
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

/**
 * Format a date using UTC to avoid timezone shifts.
 * This ensures the displayed date matches the stored date regardless of user timezone.
 */
function formatDateUTC(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Compare dates using UTC date parts to determine due status.
 * This avoids timezone issues where midnight UTC shows as the previous day in negative UTC offsets.
 */
function getDueStatus(nextDueDate: Date): 'overdue' | 'due-today' | 'upcoming' {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDateUTC = Date.UTC(
    nextDueDate.getUTCFullYear(),
    nextDueDate.getUTCMonth(),
    nextDueDate.getUTCDate()
  );

  if (dueDateUTC < todayUTC) {
    return 'overdue';
  }
  if (dueDateUTC === todayUTC) {
    return 'due-today';
  }
  return 'upcoming';
}

export function RecurringTable({
  recurringTransactions,
  onEdit,
  onDelete,
  onToggle,
  onMarkPaid,
  isMarkingPaid,
}: RecurringTableProps) {
  const t = useTranslations('recurring');
  const tCommon = useTranslations('common');
  const tTransactions = useTranslations('transactions');
  const { settings } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const getEntityName = (entityId: string, entityType: string) => {
    if (entityType === 'personal') {
      return tCommon('personal');
    }
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || 'Unknown';
  };

  // Sort by nextDueDate ascending (soonest first), with overdue at the top
  const sortedRecurringTransactions = useMemo(() => {
    return [...recurringTransactions].sort((a, b) => {
      const dateA = new Date(a.nextDueDate);
      const dateB = new Date(b.nextDueDate);
      return dateA.getTime() - dateB.getTime();
    });
  }, [recurringTransactions]);

  if (recurringTransactions.length === 0) {
    return (
      <div className="py-12 text-center">
        <Repeat className="mx-auto h-12 w-12 text-slate-600" />
        <h3 className="mt-4 text-lg font-medium text-white">{t('empty.title')}</h3>
        <p className="mt-2 text-slate-400">{t('empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">{t('table.description')}</TableHead>
            <TableHead className="text-slate-400">{t('table.type')}</TableHead>
            <TableHead className="text-slate-400">{t('table.entity')}</TableHead>
            <TableHead className="text-slate-400">{t('table.frequency')}</TableHead>
            <TableHead className="text-slate-400">{t('table.nextDue')}</TableHead>
            <TableHead className="text-right text-slate-400">{t('table.amount')}</TableHead>
            <TableHead className="text-slate-400">{t('table.status')}</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRecurringTransactions.map((recurring) => {
            const config = typeConfig[recurring.type];
            const Icon = config.icon;
            const dueStatus = recurring.isActive ? getDueStatus(new Date(recurring.nextDueDate)) : null;
            const isBeingMarkedPaid = isMarkingPaid === recurring.id;

            return (
              <TableRow
                key={recurring.id}
                className={cn(
                  'border-slate-800 hover:bg-slate-800/50',
                  !recurring.isActive && 'opacity-50',
                  dueStatus === 'overdue' && 'bg-red-500/5',
                  dueStatus === 'due-today' && 'bg-amber-500/5'
                )}
              >
                <TableCell className="font-medium text-white">
                  <div className="flex items-center gap-2">
                    {dueStatus === 'overdue' && (
                      <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    )}
                    <div>
                      {recurring.description}
                      <div className="text-xs text-slate-500">{recurring.category}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('border-0', config.bgColor, config.color)}
                  >
                    <Icon className="mr-1 h-3 w-3" />
                    {tTransactions(`types.${recurring.type}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  {getEntityName(recurring.entityId, recurring.entityType)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="border-slate-700 text-slate-400">
                    <Repeat className="mr-1 h-3 w-3" />
                    {t(`frequencies.${recurring.frequency}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'flex items-center gap-1',
                      dueStatus === 'overdue' && 'text-red-400',
                      dueStatus === 'due-today' && 'text-amber-400',
                      dueStatus === 'upcoming' && 'text-slate-300',
                      !recurring.isActive && 'text-slate-500'
                    )}>
                      <Calendar className="h-3 w-3" />
                      {formatDateUTC(new Date(recurring.nextDueDate))}
                    </div>
                    {dueStatus === 'due-today' && (
                      <Badge variant="outline" className="border-0 bg-amber-500/10 text-amber-400 text-xs">
                        {t('status.dueToday')}
                      </Badge>
                    )}
                    {dueStatus === 'overdue' && (
                      <Badge variant="outline" className="border-0 bg-red-500/10 text-red-400 text-xs">
                        {t('status.overdue')}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium',
                    recurring.type === 'expense' ? 'text-red-400' : 'text-emerald-400'
                  )}
                >
                  {formatCurrency(recurring.amount * recurring.exchangeRate, settings.baseCurrency)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      'border-0',
                      recurring.isActive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-slate-500/10 text-slate-400'
                    )}
                  >
                    {recurring.isActive ? t('status.active') : t('status.paused')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {/* Mark as Paid button - only show for active recurring that are due */}
                    {onMarkPaid && recurring.isActive && (dueStatus === 'overdue' || dueStatus === 'due-today') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onMarkPaid(recurring)}
                        disabled={isBeingMarkedPaid}
                        className={cn(
                          'h-8 border-emerald-600 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300',
                          isBeingMarkedPaid && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <Check className="mr-1 h-3 w-3" />
                        {t('actions.markPaid')}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="border-slate-700 bg-slate-900"
                      >
                        {onMarkPaid && recurring.isActive && (
                          <DropdownMenuItem
                            onClick={() => onMarkPaid(recurring)}
                            disabled={isBeingMarkedPaid}
                            className="text-emerald-400 focus:bg-emerald-500/10 focus:text-emerald-400"
                          >
                            <Check className="mr-2 h-4 w-4" />
                            {t('actions.markPaid')}
                          </DropdownMenuItem>
                        )}
                        {onToggle && (
                          <DropdownMenuItem
                            onClick={() => onToggle(recurring)}
                            className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          >
                            {recurring.isActive ? (
                              <>
                                <Pause className="mr-2 h-4 w-4" />
                                {t('actions.pause')}
                              </>
                            ) : (
                              <>
                                <Play className="mr-2 h-4 w-4" />
                                {t('actions.resume')}
                              </>
                            )}
                          </DropdownMenuItem>
                        )}
                        {onEdit && (
                          <DropdownMenuItem
                            onClick={() => onEdit(recurring)}
                            className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            {tCommon('edit')}
                          </DropdownMenuItem>
                        )}
                        {onDelete && (
                          <>
                            <DropdownMenuSeparator className="bg-slate-700" />
                            <DropdownMenuItem
                              onClick={() => onDelete(recurring)}
                              className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {tCommon('delete')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
