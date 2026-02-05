'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  MoreVertical,
  Pencil,
  Trash2,
  ArrowUpDown,
  Filter,
  ArrowLeftRight,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import type { Transaction, TransactionType, Transfer, EntityType } from '@/types';

// Unified activity item type
interface ActivityItem {
  id: string;
  type: 'transaction' | 'transfer';
  date: Date;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  // For transactions
  transactionType?: TransactionType;
  category?: string;
  // For transfers
  transferDirection?: 'incoming' | 'outgoing';
  transferType?: 'profit_distribution' | 'capital_injection' | 'reimbursement';
  counterpartyName?: string;
  // Original data for actions
  originalTransaction?: Transaction;
  originalTransfer?: Transfer;
}

interface ActivityTableProps {
  transactions: Transaction[];
  transfers?: Transfer[];
  entityId: string;
  entityType: EntityType;
  entityNames?: Record<string, string>; // Map of entity IDs to names
  onEditTransaction?: (transaction: Transaction) => void;
  onDeleteTransaction?: (transaction: Transaction) => void;
  onDeleteTransfer?: (transfer: Transfer) => void;
}

const transactionTypeConfig: Record<
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

type FilterType = 'all' | 'income' | 'expense' | 'investment' | 'transfer';
type SortField = 'date' | 'amount';
type SortDirection = 'asc' | 'desc';

export function ActivityTable({
  transactions,
  transfers = [],
  entityId,
  entityType: _entityType,
  entityNames = {},
  onEditTransaction,
  onDeleteTransaction,
  onDeleteTransfer,
}: ActivityTableProps) {
  // _entityType reserved for potential future filtering by entity type
  void _entityType;
  const t = useTranslations();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');

  // Convert transactions and transfers to unified activity items
  const activityItems = useMemo(() => {
    const items: ActivityItem[] = [];

    // Add transactions
    transactions.forEach((tx) => {
      items.push({
        id: `tx-${tx.id}`,
        type: 'transaction',
        date: new Date(tx.date),
        description: tx.description,
        amount: tx.amount,
        currency: tx.currency,
        exchangeRate: tx.exchangeRate,
        transactionType: tx.type,
        category: tx.category,
        originalTransaction: tx,
      });
    });

    // Add transfers
    transfers.forEach((tr) => {
      const isIncoming = tr.toEntityId === entityId;
      const isOutgoing = tr.fromEntityId === entityId;
      
      if (!isIncoming && !isOutgoing) return;

      const counterpartyId = isIncoming ? tr.fromEntityId : tr.toEntityId;
      const counterpartyName = entityNames[counterpartyId] || 
        (isIncoming ? t('transfers.form.from') : t('transfers.form.to'));

      items.push({
        id: `tr-${tr.id}`,
        type: 'transfer',
        date: new Date(tr.date),
        description: tr.description || (
          isIncoming 
            ? t('activity.transferFrom', { name: counterpartyName })
            : t('activity.transferTo', { name: counterpartyName })
        ),
        amount: tr.amount,
        currency: tr.currency,
        exchangeRate: tr.exchangeRate,
        transferDirection: isIncoming ? 'incoming' : 'outgoing',
        transferType: tr.direction,
        counterpartyName,
        originalTransfer: tr,
      });
    });

    return items;
  }, [transactions, transfers, entityId, entityNames, t]);

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let result = [...activityItems];

    // Filter
    if (filterType !== 'all') {
      if (filterType === 'transfer') {
        result = result.filter((item) => item.type === 'transfer');
      } else {
        result = result.filter(
          (item) => item.type === 'transaction' && item.transactionType === filterType
        );
      }
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = a.date.getTime() - b.date.getTime();
          break;
        case 'amount':
          comparison = a.amount - b.amount;
          break;
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [activityItems, sortField, sortDirection, filterType]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (activityItems.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-400">{t('activity.empty')}</p>
      </div>
    );
  }

  const hasTransfers = transfers.length > 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select
          value={filterType}
          onValueChange={(value) => setFilterType(value as FilterType)}
        >
          <SelectTrigger className="w-[180px] border-slate-700 bg-slate-800 text-slate-300">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-slate-700 bg-slate-900">
            <SelectItem
              value="all"
              className="text-slate-300 focus:bg-slate-800 focus:text-white"
            >
              {t('activity.filterAll')}
            </SelectItem>
            <SelectItem
              value="income"
              className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
            >
              {t('transactions.types.income')}
            </SelectItem>
            <SelectItem
              value="expense"
              className="text-red-400 focus:bg-slate-800 focus:text-red-400"
            >
              {t('transactions.types.expense')}
            </SelectItem>
            <SelectItem
              value="investment"
              className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
            >
              {t('transactions.types.investment')}
            </SelectItem>
            {hasTransfers && (
              <SelectItem
                value="transfer"
                className="text-purple-400 focus:bg-slate-800 focus:text-purple-400"
              >
                {t('activity.transfers')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="text-slate-400">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort('date')}
                  className="text-slate-400 hover:text-white"
                >
                  {t('activity.table.date')}
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead className="text-slate-400">{t('activity.table.description')}</TableHead>
              <TableHead className="text-slate-400">{t('activity.table.type')}</TableHead>
              <TableHead className="text-slate-400">{t('activity.table.category')}</TableHead>
              <TableHead className="text-right text-slate-400">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort('amount')}
                  className="text-slate-400 hover:text-white"
                >
                  {t('activity.table.amount')}
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              {(onEditTransaction || onDeleteTransaction || onDeleteTransfer) && (
                <TableHead className="w-[50px]"></TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.map((item) => {
              const isTransaction = item.type === 'transaction';
              const isTransfer = item.type === 'transfer';
              const isIncoming = item.transferDirection === 'incoming';

              // Determine display properties
              let Icon = ArrowLeftRight;
              let badgeColor = 'text-purple-400';
              let badgeBg = 'bg-purple-500/10';
              let typeLabel = '';
              let amountPrefix = '';
              let amountColor = 'text-white';

              if (isTransaction && item.transactionType) {
                const config = transactionTypeConfig[item.transactionType];
                Icon = config.icon;
                badgeColor = config.color;
                badgeBg = config.bgColor;
                typeLabel = t(`transactions.types.${item.transactionType}`);
                amountPrefix = item.transactionType === 'expense' ? '-' : '+';
                amountColor = item.transactionType === 'expense' ? 'text-red-400' : 'text-white';
              } else if (isTransfer) {
                Icon = ArrowLeftRight;
                badgeColor = 'text-purple-400';
                badgeBg = 'bg-purple-500/10';
                typeLabel = isIncoming 
                  ? t('activity.incomingTransfer')
                  : t('activity.outgoingTransfer');
                amountPrefix = isIncoming ? '+' : '-';
                amountColor = isIncoming ? 'text-emerald-400' : 'text-red-400';
              }

              return (
                <TableRow
                  key={item.id}
                  className="border-slate-800 hover:bg-slate-800/50"
                >
                  <TableCell className="text-slate-300">
                    {formatDate(item.date)}
                  </TableCell>
                  <TableCell className="font-medium text-white">
                    {item.description}
                    {isTransfer && item.counterpartyName && (
                      <span className="ml-2 text-xs text-slate-500">
                        ({isIncoming ? t('activity.from') : t('activity.to')} {item.counterpartyName})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('border-0', badgeBg, badgeColor)}
                    >
                      <Icon className="mr-1 h-3 w-3" />
                      {typeLabel}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isTransaction && item.category ? (
                      <Badge
                        variant="outline"
                        className="border-slate-700 text-slate-400"
                      >
                        {item.category}
                      </Badge>
                    ) : isTransfer ? (
                      <Badge
                        variant="outline"
                        className={
                          item.transferType === 'profit_distribution'
                            ? 'border-emerald-700/50 text-emerald-400/70'
                            : item.transferType === 'reimbursement'
                              ? 'border-purple-700/50 text-purple-400/70'
                              : 'border-blue-700/50 text-blue-400/70'
                        }
                      >
                        {item.transferType === 'profit_distribution'
                          ? t('transfers.directions.profitDistribution')
                          : item.transferType === 'reimbursement'
                            ? t('transfers.directions.reimbursement')
                            : t('transfers.directions.capitalInjection')}
                      </Badge>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </TableCell>
                  <TableCell className={cn('text-right font-medium', amountColor)}>
                    {amountPrefix}
                    {formatCurrency(item.amount, item.currency)}
                  </TableCell>
                  {(onEditTransaction || onDeleteTransaction || onDeleteTransfer) && (
                    <TableCell>
                      {(isTransaction && (onEditTransaction || onDeleteTransaction)) ||
                       (isTransfer && onDeleteTransfer) ? (
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
                            {isTransaction && onEditTransaction && item.originalTransaction && (
                              <DropdownMenuItem
                                onClick={() => onEditTransaction(item.originalTransaction!)}
                                className="text-slate-300 focus:bg-slate-800 focus:text-white"
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                {t('common.edit')}
                              </DropdownMenuItem>
                            )}
                            {isTransaction && onDeleteTransaction && item.originalTransaction && (
                              <DropdownMenuItem
                                onClick={() => onDeleteTransaction(item.originalTransaction!)}
                                className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('common.delete')}
                              </DropdownMenuItem>
                            )}
                            {isTransfer && onDeleteTransfer && item.originalTransfer && (
                              <DropdownMenuItem
                                onClick={() => onDeleteTransfer(item.originalTransfer!)}
                                className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('common.delete')}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
