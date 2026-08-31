'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ArrowRight, MoreHorizontal, Paperclip, Trash2 } from 'lucide-react';
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
import { MobileList, MobileListItem } from '@/components/tables/mobile-list';
import { useBusinessStore, useSettingsStore, useInvestmentStore } from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { Transfer, TransferDirection } from '@/types';
import { AttachmentBadge } from '@/components/attachments/attachment-badge';

interface TransfersTableProps {
  transfers: Transfer[];
  onDelete?: (transfer: Transfer) => void;
  onAttach?: (transfer: Transfer) => void;
}

const directionBadgeClass: Record<TransferDirection, string> = {
  profit_distribution: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  reimbursement: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  investment_deposit: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400',
  investment_withdrawal: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  capital_injection: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
};

const directionChipClass: Record<TransferDirection, string> = {
  profit_distribution: 'bg-emerald-500/10 text-emerald-400',
  reimbursement: 'bg-purple-500/10 text-purple-400',
  investment_deposit: 'bg-cyan-500/10 text-cyan-400',
  investment_withdrawal: 'bg-amber-500/10 text-amber-400',
  capital_injection: 'bg-blue-500/10 text-blue-400',
};

interface RowActionsProps {
  transfer: Transfer;
  onDelete?: (transfer: Transfer) => void;
  onAttach?: (transfer: Transfer) => void;
}

/** The row-level actions menu, shared by the desktop table and the mobile card list. */
function RowActions({ transfer, onDelete, onAttach }: RowActionsProps) {
  const t = useTranslations('transfers');
  const tCommon = useTranslations('common');

  if (!onDelete && !onAttach) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-slate-400 hover:bg-slate-800 hover:text-white md:size-8"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-slate-700 bg-slate-900">
        {onAttach && (
          <DropdownMenuItem
            onClick={() => onAttach(transfer)}
            className="text-slate-300 focus:bg-slate-800 focus:text-white"
          >
            <Paperclip className="mr-2 h-4 w-4" />
            {t('actions.attach')}
          </DropdownMenuItem>
        )}
        {onDelete && (
          <DropdownMenuItem
            onClick={() => onDelete(transfer)}
            className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {tCommon('delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TransfersTable({ transfers, onDelete, onAttach }: TransfersTableProps) {
  const t = useTranslations('transfers');
  const { businesses } = useBusinessStore();
  const { settings } = useSettingsStore();
  const { accounts: investmentAccounts } = useInvestmentStore();

  const getEntityName = (entityId: string, entityType: 'business' | 'personal') => {
    if (!entityId) return t('table.unknownEntity');
    if (entityType === 'personal') {
      return t('form.personalAccount');
    }
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || t('table.unknownEntity');
  };

  const getInvestmentAccountName = (accountId?: string) => {
    if (!accountId) return null;
    const account = investmentAccounts.find((a) => a.id === accountId);
    return account?.name || null;
  };

  const directionLabel = (direction: TransferDirection) =>
    direction === 'profit_distribution'
      ? t('directions.profitDistribution')
      : direction === 'reimbursement'
        ? t('directions.reimbursement')
        : direction === 'investment_deposit'
          ? t('directions.investmentDeposit')
          : direction === 'investment_withdrawal'
            ? t('directions.investmentWithdrawal')
            : t('directions.capitalInjection');

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
    <div>
      {/* Mobile: card list */}
      <MobileList className="md:hidden">
        {sortedTransfers.map((transfer) => {
          const fromName =
            transfer.direction === 'investment_withdrawal'
              ? getInvestmentAccountName(transfer.fromInvestmentAccountId) || t('table.unknownEntity')
              : getEntityName(transfer.fromEntityId, transfer.fromEntityType);
          const toName =
            transfer.direction === 'investment_deposit'
              ? getInvestmentAccountName(transfer.toInvestmentAccountId) || t('table.unknownEntity')
              : getEntityName(transfer.toEntityId, transfer.toEntityType);
          const showApprox = transfer.currency !== settings.baseCurrency;

          return (
            <MobileListItem
              key={transfer.id}
              leading={
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg',
                    directionChipClass[transfer.direction]
                  )}
                >
                  <ArrowRight className="h-4 w-4" />
                </span>
              }
              title={
                <span className="inline-flex items-center gap-1">
                  {fromName}
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  {toName}
                </span>
              }
              titleExtra={
                <AttachmentBadge
                  ownerType="transfer"
                  ownerId={transfer.id}
                  onClick={onAttach ? () => onAttach(transfer) : undefined}
                />
              }
              subtitle={`${format(new Date(transfer.date), 'MMM d, yyyy')} · ${transfer.description || directionLabel(transfer.direction)}`}
              trailing={<span className="text-foreground">{formatCurrency(transfer.amount, transfer.currency)}</span>}
              trailingSub={
                showApprox
                  ? `≈ ${formatCurrency(transfer.amount * transfer.exchangeRate, settings.baseCurrency)}`
                  : undefined
              }
              actions={<RowActions transfer={transfer} onDelete={onDelete} onAttach={onAttach} />}
            />
          );
        })}
      </MobileList>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
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
              {(onDelete || onAttach) && (
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
                  <Badge variant="outline" className={directionBadgeClass[transfer.direction]}>
                    {directionLabel(transfer.direction)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-300">
                      {transfer.direction === 'investment_withdrawal'
                        ? getInvestmentAccountName(transfer.fromInvestmentAccountId) || t('table.unknownEntity')
                        : getEntityName(transfer.fromEntityId, transfer.fromEntityType)}
                    </span>
                    <ArrowRight className="h-3 w-3 flex-shrink-0 text-slate-500" />
                    <span className="text-slate-300">
                      {transfer.direction === 'investment_deposit'
                        ? getInvestmentAccountName(transfer.toInvestmentAccountId) || t('table.unknownEntity')
                        : getEntityName(transfer.toEntityId, transfer.toEntityType)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-slate-400">
                  <div className="flex items-center gap-2">
                    <span>{transfer.description || '-'}</span>
                    <AttachmentBadge
                      ownerType="transfer"
                      ownerId={transfer.id}
                      onClick={onAttach ? () => onAttach(transfer) : undefined}
                    />
                  </div>
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
                {(onDelete || onAttach) && (
                  <TableCell>
                    <RowActions transfer={transfer} onDelete={onDelete} onAttach={onAttach} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
