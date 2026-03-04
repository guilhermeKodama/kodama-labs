'use client';

import { useState, useMemo, useCallback, Fragment } from 'react';
import { useTranslations } from 'next-intl';
import {
  MoreVertical,
  Pencil,
  Trash2,
  Pause,
  Play,
  Target,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
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
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { formatCurrency } from '@/lib/utils/format';
import { formatDate } from '@/lib/utils/format';
import { getBudgetStatusColor, calculateBudgetPace, getBudgetDateRange } from '@/lib/utils/budget';
import type { BudgetProgress, Transaction } from '@/types';
import { useSettingsStore, useBusinessStore, useTransactionStore } from '@/lib/store';

type SortField = 'category' | 'budget' | 'spent' | 'remaining' | 'percentUsed';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'onTrack' | 'nearLimit' | 'overBudget';

interface BudgetsTableProps {
  budgetProgress: BudgetProgress[];
  transactions?: Transaction[];
  onEdit?: (budget: BudgetProgress['budget']) => void;
  onDelete?: (budget: BudgetProgress['budget']) => void;
  onToggle?: (budget: BudgetProgress['budget']) => void;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function BudgetsTable({
  budgetProgress,
  transactions: externalTransactions,
  onEdit,
  onDelete,
  onToggle,
}: BudgetsTableProps) {
  const t = useTranslations('budgets');
  const tCommon = useTranslations('common');
  const { settings } = useSettingsStore();
  const { businesses } = useBusinessStore();
  const { transactions: storeTransactions } = useTransactionStore();
  const transactions = externalTransactions ?? storeTransactions;

  const [sortField, setSortField] = useState<SortField>('percentUsed');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedBudgetId, setExpandedBudgetId] = useState<string | null>(null);

  const getEntityName = useCallback((entityId: string, entityType: string) => {
    if (entityType === 'personal') {
      return tCommon('personal');
    }
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || 'Unknown';
  }, [businesses, tCommon]);

  const getPeriodLabel = (budget: BudgetProgress['budget']) => {
    if (budget.period === 'yearly') {
      return `${budget.year}`;
    }
    return `${MONTH_NAMES[budget.month! - 1]} ${budget.year}`;
  };

  // Calculate pace for each budget
  const progressWithPace = useMemo(() => {
    return budgetProgress.map((p) => ({
      ...p,
      pace: calculateBudgetPace(p.budget, transactions),
    }));
  }, [budgetProgress, transactions]);

  // Filter and sort
  const filteredAndSorted = useMemo(() => {
    let result = [...progressWithPace];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((p) => {
        if (statusFilter === 'overBudget') return p.isOverBudget;
        if (statusFilter === 'nearLimit') return !p.isOverBudget && p.percentUsed >= 80;
        if (statusFilter === 'onTrack') return p.percentUsed < 80;
        return true;
      });
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'category':
          comparison = a.budget.category.localeCompare(b.budget.category);
          break;
        case 'budget':
          comparison = a.budget.amount - b.budget.amount;
          break;
        case 'spent':
          comparison = a.spent - b.spent;
          break;
        case 'remaining':
          comparison = a.remaining - b.remaining;
          break;
        case 'percentUsed':
          comparison = a.percentUsed - b.percentUsed;
          break;
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [progressWithPace, sortField, sortDirection, statusFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };


  // Get transactions for drill-down
  const getDrillDownTransactions = (budget: BudgetProgress['budget']) => {
    const { start, end } = getBudgetDateRange(budget);
    return transactions.filter((tx) => {
      if (tx.entityId !== budget.entityId) return false;
      if (tx.category !== budget.category) return false;
      if (tx.type !== 'expense') return false;
      const txDate = new Date(tx.date);
      return txDate >= start && txDate <= end;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 text-slate-600" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="ml-1 h-3 w-3 text-cyan-400" />
      : <ArrowDown className="ml-1 h-3 w-3 text-cyan-400" />;
  };

  if (budgetProgress.length === 0) {
    return (
      <div className="py-12 text-center">
        <Target className="mx-auto h-12 w-12 text-slate-600" />
        <h3 className="mt-4 text-lg font-medium text-white">{t('empty.title')}</h3>
        <p className="mt-2 text-slate-400">{t('empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px] border-slate-700 bg-slate-800 text-slate-300">
            <SelectValue placeholder={t('filter.statusFilter')} />
          </SelectTrigger>
          <SelectContent className="border-slate-700 bg-slate-900">
            <SelectItem value="all" className="text-slate-300 focus:bg-slate-800 focus:text-white">{t('filter.all')}</SelectItem>
            <SelectItem value="onTrack" className="text-slate-300 focus:bg-slate-800 focus:text-white">{t('filter.onTrack')}</SelectItem>
            <SelectItem value="nearLimit" className="text-slate-300 focus:bg-slate-800 focus:text-white">{t('filter.nearLimit')}</SelectItem>
            <SelectItem value="overBudget" className="text-slate-300 focus:bg-slate-800 focus:text-white">{t('filter.overBudget')}</SelectItem>
          </SelectContent>
        </Select>

      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="w-[30px]"></TableHead>
              <TableHead
                className="cursor-pointer text-slate-400 hover:text-white"
                onClick={() => toggleSort('category')}
              >
                <span className="flex items-center">
                  {t('table.category')}
                  {getSortIcon('category')}
                </span>
              </TableHead>
              <TableHead className="text-slate-400">{t('table.entity')}</TableHead>
              <TableHead className="text-slate-400">{t('table.period')}</TableHead>
              <TableHead className="text-slate-400">{t('table.progress')}</TableHead>
              <TableHead
                className="cursor-pointer text-right text-slate-400 hover:text-white"
                onClick={() => toggleSort('budget')}
              >
                <span className="flex items-center justify-end">
                  {t('table.budget')}
                  {getSortIcon('budget')}
                </span>
              </TableHead>
              <TableHead
                className="cursor-pointer text-right text-slate-400 hover:text-white"
                onClick={() => toggleSort('spent')}
              >
                <span className="flex items-center justify-end">
                  {t('table.spent')}
                  {getSortIcon('spent')}
                </span>
              </TableHead>
              <TableHead
                className="cursor-pointer text-right text-slate-400 hover:text-white"
                onClick={() => toggleSort('remaining')}
              >
                <span className="flex items-center justify-end">
                  {t('table.remaining')}
                  {getSortIcon('remaining')}
                </span>
              </TableHead>
              <TableHead className="text-slate-400">{t('table.pace')}</TableHead>
              <TableHead className="text-slate-400">{t('table.status')}</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.map((progress) => {
              const { budget, spent, remaining, percentUsed, isOverBudget } = progress;
              const { pace } = progress;
              const statusColor = getBudgetStatusColor(percentUsed);
              const isExpanded = expandedBudgetId === budget.id;
              const drillDownTransactions = isExpanded ? getDrillDownTransactions(budget) : [];

              return (
                <Fragment key={budget.id}>
                  <TableRow
                    className={cn(
                      'border-slate-800 hover:bg-slate-800/50',
                      !budget.isActive && 'opacity-50'
                    )}
                  >
                    <TableCell className="w-[30px] pr-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-slate-500 hover:text-white"
                        onClick={() =>
                          setExpandedBudgetId(isExpanded ? null : budget.id)
                        }
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium text-white">
                      {budget.category}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {getEntityName(budget.entityId, budget.entityType)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-slate-700 text-slate-400">
                        {getPeriodLabel(budget)}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-[160px]">
                      <div className="space-y-1">
                        <Progress
                          value={Math.min(percentUsed, 100)}
                          className="h-2 bg-slate-700"
                        />
                        <p className={cn('text-xs', statusColor)}>
                          {percentUsed.toFixed(0)}%
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-slate-300">
                      {formatCurrency(budget.amount, budget.currency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium',
                        isOverBudget ? 'text-red-400' : 'text-emerald-400'
                      )}
                    >
                      {formatCurrency(spent, settings.baseCurrency)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium',
                        remaining < 0 ? 'text-red-400' : 'text-emerald-400'
                      )}
                    >
                      {formatCurrency(Math.abs(remaining), settings.baseCurrency)}
                      {remaining < 0 && (
                        <span className="ml-1 text-xs text-red-400">over</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {pace.isOverPace ? (
                          <TrendingUp className="h-3.5 w-3.5 text-red-400" />
                        ) : pace.dailySpendRate > 0 ? (
                          <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Minus className="h-3.5 w-3.5 text-slate-500" />
                        )}
                        <span className={cn(
                          'text-xs',
                          pace.isOverPace ? 'text-red-400' : 'text-slate-400'
                        )}>
                          {formatCurrency(pace.dailySpendRate, settings.baseCurrency)}
                          {t('pace.perDay')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {pace.daysRemaining} {t('pace.daysLeft')}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-0',
                          isOverBudget
                            ? 'bg-red-500/10 text-red-400'
                            : percentUsed >= 80
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        )}
                      >
                        {isOverBudget
                          ? t('status.overBudget')
                          : percentUsed >= 80
                          ? t('status.nearLimit')
                          : t('status.onTrack')}
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
                          {onToggle && (
                            <DropdownMenuItem
                              onClick={() => onToggle(budget)}
                              className="text-slate-300 focus:bg-slate-800 focus:text-white"
                            >
                              {budget.isActive ? (
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
                              onClick={() => onEdit(budget)}
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
                                onClick={() => onDelete(budget)}
                                className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {tCommon('delete')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>

                  {/* Drill-down row */}
                  {isExpanded && (
                    <TableRow key={`${budget.id}-drilldown`} className="border-slate-800 bg-slate-800/20">
                      <TableCell colSpan={11} className="p-0">
                        <div className="px-8 py-4">
                          <h4 className="mb-3 text-sm font-medium text-slate-300">
                            {t('drillDown.title')} — {budget.category}
                          </h4>
                          {drillDownTransactions.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              {t('drillDown.noTransactions')}
                            </p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-700">
                                  <th className="pb-2 text-left text-xs text-slate-500">{t('drillDown.date')}</th>
                                  <th className="pb-2 text-left text-xs text-slate-500">{t('drillDown.description')}</th>
                                  <th className="pb-2 text-right text-xs text-slate-500">{t('drillDown.amount')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {drillDownTransactions.map((tx) => (
                                  <tr key={tx.id} className="border-b border-slate-700/50">
                                    <td className="py-2 text-slate-400">
                                      {formatDate(tx.date, 'MMM d, yyyy')}
                                    </td>
                                    <td className="py-2 text-slate-300">{tx.description}</td>
                                    <td className="py-2 text-right font-medium text-red-400">
                                      {formatCurrency(tx.amount * tx.exchangeRate, settings.baseCurrency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
