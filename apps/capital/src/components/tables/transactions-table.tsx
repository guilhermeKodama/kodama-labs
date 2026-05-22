'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  MoreVertical,
  Paperclip,
  Pencil,
  Trash2,
  ArrowUpDown,
  Filter,
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
import type { Transaction, TransactionType } from '@/types';

interface TransactionsTableProps {
  transactions: Transaction[];
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
  onAttach?: (transaction: Transaction) => void;
}

const typeConfig: Record<
  TransactionType,
  { icon: typeof ArrowDownLeft; color: string; bgColor: string; label: string }
> = {
  income: {
    icon: ArrowDownLeft,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    label: 'Receita',
  },
  expense: {
    icon: ArrowUpRight,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    label: 'Despesa',
  },
  investment: {
    icon: TrendingUp,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    label: 'Investimento',
  },
};

type SortField = 'date' | 'amount' | 'type';
type SortDirection = 'asc' | 'desc';

export function TransactionsTable({
  transactions,
  onEdit,
  onDelete,
  onAttach,
}: TransactionsTableProps) {
  const t = useTranslations('transactions');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<TransactionType | 'all'>('all');

  const filteredAndSorted = useMemo(() => {
    let result = [...transactions];

    // Filter
    if (filterType !== 'all') {
      result = result.filter((t) => t.type === filterType);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'amount':
          comparison = a.amount - b.amount;
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [transactions, sortField, sortDirection, filterType]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-slate-400">{t('table.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select
          value={filterType}
          onValueChange={(value) => setFilterType(value as TransactionType | 'all')}
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
              {t('table.filterAll')}
            </SelectItem>
            <SelectItem
              value="income"
              className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
            >
              {t('types.income')}
            </SelectItem>
            <SelectItem
              value="expense"
              className="text-red-400 focus:bg-slate-800 focus:text-red-400"
            >
              {t('types.expense')}
            </SelectItem>
            <SelectItem
              value="investment"
              className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
            >
              {t('types.investment')}
            </SelectItem>
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
                  {t('table.date')}
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead className="text-slate-400">{t('table.description')}</TableHead>
              <TableHead className="text-slate-400">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort('type')}
                  className="text-slate-400 hover:text-white"
                >
                  {t('table.type')}
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead className="text-slate-400">{t('table.category')}</TableHead>
              <TableHead className="text-right text-slate-400">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort('amount')}
                  className="text-slate-400 hover:text-white"
                >
                  {t('table.amount')}
                  <ArrowUpDown className="ml-2 h-3 w-3" />
                </Button>
              </TableHead>
              {(onEdit || onDelete || onAttach) && (
                <TableHead className="w-[50px]"></TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.map((transaction) => {
              const config = typeConfig[transaction.type];
              const Icon = config.icon;

              return (
                <TableRow
                  key={transaction.id}
                  className="border-slate-800 hover:bg-slate-800/50"
                >
                  <TableCell className="text-slate-300">
                    {formatDate(transaction.date)}
                  </TableCell>
                  <TableCell className="font-medium text-white">
                    {transaction.description}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('border-0', config.bgColor, config.color)}
                    >
                      <Icon className="mr-1 h-3 w-3" />
                      {config.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-slate-700 text-slate-400"
                    >
                      {transaction.category}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-medium',
                      transaction.type === 'expense' ? 'text-red-400' : 'text-white'
                    )}
                  >
                    {transaction.type === 'expense' ? '-' : '+'}
                    {formatCurrency(transaction.amount, transaction.currency)}
                  </TableCell>
                  {(onEdit || onDelete || onAttach) && (
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
                          {onAttach && (
                            <DropdownMenuItem
                              onClick={() => onAttach(transaction)}
                              className="text-slate-300 focus:bg-slate-800 focus:text-white"
                            >
                              <Paperclip className="mr-2 h-4 w-4" />
                              {t('table.attach')}
                            </DropdownMenuItem>
                          )}
                          {onEdit && (
                            <DropdownMenuItem
                              onClick={() => onEdit(transaction)}
                              className="text-slate-300 focus:bg-slate-800 focus:text-white"
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              {t('table.edit')}
                            </DropdownMenuItem>
                          )}
                          {onDelete && (
                            <DropdownMenuItem
                              onClick={() => onDelete(transaction)}
                              className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('table.delete')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
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
