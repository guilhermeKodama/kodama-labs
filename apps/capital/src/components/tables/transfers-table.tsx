'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ArrowRight, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBusinessStore, useSettingsStore } from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import type { Transfer } from '@/types';

interface TransfersTableProps {
  transfers: Transfer[];
  onDelete?: (transfer: Transfer) => void;
}

export function TransfersTable({ transfers, onDelete }: TransfersTableProps) {
  const t = useTranslations('transfers');
  const tCommon = useTranslations('common');
  const { businesses } = useBusinessStore();
  const { personalAccount, settings } = useSettingsStore();

  const getEntityName = (entityId: string, entityType: 'business' | 'personal') => {
    if (entityType === 'personal') {
      return t('form.personalAccount');
    }
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || t('table.unknownEntity');
  };

  const sortedTransfers = useMemo(() => {
    return [...transfers].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [transfers]);

  if (transfers.length === 0) {
    return (
      <div className="py-8 text-center text-slate-400">{t('table.empty')}</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">{t('table.date')}</TableHead>
            <TableHead className="text-slate-400">{t('table.type')}</TableHead>
            <TableHead className="text-slate-400">{t('table.fromTo')}</TableHead>
            <TableHead className="text-slate-400">{t('table.description')}</TableHead>
            <TableHead className="text-right text-slate-400">
              {t('table.amount')}
            </TableHead>
            {onDelete && (
              <TableHead className="w-[50px] text-slate-400" />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedTransfers.map((transfer) => (
            <TableRow
              key={transfer.id}
              className="border-slate-800 hover:bg-slate-800/50"
            >
              <TableCell className="text-slate-300">
                {format(new Date(transfer.date), 'MMM d, yyyy')}
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    transfer.direction === 'profit_distribution'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                  }
                >
                  {transfer.direction === 'profit_distribution'
                    ? t('directions.profitDistribution')
                    : t('directions.capitalInjection')}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-300">
                    {getEntityName(transfer.fromEntityId, transfer.fromEntityType)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-slate-500" />
                  <span className="text-slate-300">
                    {getEntityName(transfer.toEntityId, transfer.toEntityType)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-slate-400">
                {transfer.description || '-'}
              </TableCell>
              <TableCell className="text-right">
                <span className="font-medium text-white">
                  {formatCurrency(transfer.amount, transfer.currency)}
                </span>
                {transfer.currency !== settings.baseCurrency && (
                  <div className="text-xs text-slate-500">
                    ≈ {formatCurrency(
                      transfer.amount * transfer.exchangeRate,
                      settings.baseCurrency
                    )}
                  </div>
                )}
              </TableCell>
              {onDelete && (
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="border-slate-700 bg-slate-900"
                    >
                      <DropdownMenuItem
                        onClick={() => onDelete(transfer)}
                        className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tCommon('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
