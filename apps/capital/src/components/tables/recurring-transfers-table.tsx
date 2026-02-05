'use client';

import { useTranslations } from 'next-intl';
import { format, isBefore, isToday, startOfDay } from 'date-fns';
import {
  ArrowRight,
  MoreVertical,
  Play,
  Pause,
  Pencil,
  Trash2,
  Calendar,
  Repeat,
  CheckCircle,
  Loader2,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSettingsStore, useBusinessStore } from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { RecurringTransfer, TransferDirection, RecurrenceFrequency } from '@/types';

interface RecurringTransfersTableProps {
  recurringTransfers: RecurringTransfer[];
  onEdit?: (recurringTransfer: RecurringTransfer) => void;
  onDelete?: (recurringTransfer: RecurringTransfer) => void;
  onToggle?: (recurringTransfer: RecurringTransfer) => void;
  onMarkPaid?: (recurringTransfer: RecurringTransfer) => void;
  isMarkingPaid?: string | null;
}

const directionConfig: Record<
  TransferDirection,
  { label: string; className: string }
> = {
  profit_distribution: {
    label: 'profitDistribution',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-700',
  },
  capital_injection: {
    label: 'capitalInjection',
    className: 'bg-blue-500/10 text-blue-400 border-blue-700',
  },
  reimbursement: {
    label: 'reimbursement',
    className: 'bg-purple-500/10 text-purple-400 border-purple-700',
  },
};

const frequencyLabels: Record<RecurrenceFrequency, string> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  yearly: 'yearly',
};

export function RecurringTransfersTable({
  recurringTransfers,
  onEdit,
  onDelete,
  onToggle,
  onMarkPaid,
  isMarkingPaid,
}: RecurringTransfersTableProps) {
  const t = useTranslations('transfers.recurring');
  const tDirections = useTranslations('transfers.directions');
  const { businesses } = useBusinessStore();
  const { personalAccount, settings } = useSettingsStore();

  const getEntityName = (entityId: string, entityType: 'business' | 'personal') => {
    if (entityType === 'personal') {
      return t('form.personalAccount');
    }
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || 'Unknown';
  };

  const getDueDateStatus = (date: Date) => {
    const today = startOfDay(new Date());
    const dueDate = startOfDay(date);
    if (isBefore(dueDate, today)) return 'overdue';
    if (isToday(dueDate)) return 'dueToday';
    return 'upcoming';
  };

  if (recurringTransfers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Repeat className="mb-4 h-12 w-12 text-slate-600" />
        <p className="text-slate-400">{t('empty')}</p>
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
            <TableHead className="text-slate-400">{t('table.fromTo')}</TableHead>
            <TableHead className="text-slate-400">{t('table.frequency')}</TableHead>
            <TableHead className="text-slate-400">{t('table.nextDueDate')}</TableHead>
            <TableHead className="text-right text-slate-400">{t('table.amount')}</TableHead>
            <TableHead className="text-slate-400">{t('table.status')}</TableHead>
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {recurringTransfers.map((rt) => {
            const config = directionConfig[rt.direction];
            const dueDateStatus = getDueDateStatus(new Date(rt.nextDueDate));
            const isOverdue = dueDateStatus === 'overdue';
            const isDueToday = dueDateStatus === 'dueToday';

            return (
              <TableRow
                key={rt.id}
                className={cn(
                  'border-slate-800 hover:bg-slate-800/50',
                  !rt.isActive && 'opacity-50',
                  isOverdue && 'bg-red-900/20',
                  isDueToday && 'bg-amber-900/20'
                )}
              >
                <TableCell className="font-medium text-white">
                  {rt.description || '-'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={config.className}>
                    <ArrowRight className="mr-1 h-3 w-3" />
                    {tDirections(config.label)}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {getEntityName(rt.fromEntityId, rt.fromEntityType)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-slate-500" />
                    <span className="text-sm">
                      {getEntityName(rt.toEntityId, rt.toEntityType)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="border-slate-700 text-slate-300">
                    <Repeat className="mr-1 h-3 w-3" />
                    {t(`form.frequencies.${frequencyLabels[rt.frequency]}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-slate-500" />
                    {format(new Date(rt.nextDueDate), 'MMM d, yyyy')}
                    {isOverdue && (
                      <Badge variant="destructive" className="ml-2">
                        {t('status.overdue')}
                      </Badge>
                    )}
                    {isDueToday && (
                      <Badge
                        variant="outline"
                        className="ml-2 border-amber-700 bg-amber-500/10 text-amber-400"
                      >
                        {t('status.dueToday')}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-medium text-purple-400">
                    {formatCurrency(rt.amount * rt.exchangeRate, settings.baseCurrency)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      rt.isActive
                        ? 'border-emerald-700 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-600 bg-slate-500/10 text-slate-400'
                    }
                  >
                    {rt.isActive ? t('status.active') : t('status.paused')}
                  </Badge>
                </TableCell>
                <TableCell>
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
                      {onMarkPaid && rt.isActive && (
                        <DropdownMenuItem
                          onClick={() => onMarkPaid(rt)}
                          disabled={isMarkingPaid === rt.id}
                          className="text-emerald-400 focus:bg-emerald-500/10 focus:text-emerald-400"
                        >
                          {isMarkingPaid === rt.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="mr-2 h-4 w-4" />
                          )}
                          {t('actions.markPaid')}
                        </DropdownMenuItem>
                      )}
                      {onToggle && (
                        <DropdownMenuItem
                          onClick={() => onToggle(rt)}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          {rt.isActive ? (
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
                          onClick={() => onEdit(rt)}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          {t('actions.edit')}
                        </DropdownMenuItem>
                      )}
                      {onDelete && (
                        <DropdownMenuItem
                          onClick={() => onDelete(rt)}
                          className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('actions.delete')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
