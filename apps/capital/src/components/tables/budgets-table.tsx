'use client';

import { useTranslations } from 'next-intl';
import {
  MoreVertical,
  Pencil,
  Trash2,
  Pause,
  Play,
  Target,
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
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { getBudgetStatusColor, getBudgetStatusBgColor } from '@/lib/utils/budget';
import type { BudgetProgress } from '@/types';
import { useSettingsStore, useBusinessStore } from '@/lib/store';

interface BudgetsTableProps {
  budgetProgress: BudgetProgress[];
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
  onEdit,
  onDelete,
  onToggle,
}: BudgetsTableProps) {
  const t = useTranslations('budgets');
  const tCommon = useTranslations('common');
  const { settings, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const getEntityName = (entityId: string, entityType: string) => {
    if (entityType === 'personal') {
      return tCommon('personal');
    }
    const business = businesses.find((b) => b.id === entityId);
    return business?.name || 'Unknown';
  };

  const getPeriodLabel = (budget: BudgetProgress['budget']) => {
    if (budget.period === 'yearly') {
      return `${budget.year}`;
    }
    return `${MONTH_NAMES[budget.month! - 1]} ${budget.year}`;
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
    <div className="rounded-lg border border-slate-800 bg-slate-900/50">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">{t('table.category')}</TableHead>
            <TableHead className="text-slate-400">{t('table.entity')}</TableHead>
            <TableHead className="text-slate-400">{t('table.period')}</TableHead>
            <TableHead className="text-slate-400">{t('table.progress')}</TableHead>
            <TableHead className="text-right text-slate-400">{t('table.budget')}</TableHead>
            <TableHead className="text-right text-slate-400">{t('table.spent')}</TableHead>
            <TableHead className="text-slate-400">{t('table.status')}</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {budgetProgress.map((progress) => {
            const { budget, spent, percentUsed, isOverBudget } = progress;
            const statusColor = getBudgetStatusColor(percentUsed);
            const progressColor = getBudgetStatusBgColor(percentUsed);

            return (
              <TableRow
                key={budget.id}
                className={cn(
                  'border-slate-800 hover:bg-slate-800/50',
                  !budget.isActive && 'opacity-50'
                )}
              >
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
                <TableCell className="w-[200px]">
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
