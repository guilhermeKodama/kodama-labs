'use client';

import { useTranslations } from 'next-intl';
import {
  MoreVertical,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  RefreshCw,
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
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { InvestmentHolding } from '@/types';
import { TICKER_ASSET_CLASSES } from '@/types';

interface HoldingsTableProps {
  holdings: InvestmentHolding[];
  onEdit?: (holding: InvestmentHolding) => void;
  onDelete?: (holding: InvestmentHolding) => void;
  onRebalance?: (holding: InvestmentHolding) => void;
}

const assetClassColors: Record<string, string> = {
  stocks: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  fii: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  etf: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400',
  bdr: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400',
  fixed_income: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  crypto: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
  savings: 'border-green-500/50 bg-green-500/10 text-green-400',
  international_stocks: 'border-sky-500/50 bg-sky-500/10 text-sky-400',
  international_etf: 'border-teal-500/50 bg-teal-500/10 text-teal-400',
};

function computeCurrentValue(holding: InvestmentHolding): number | null {
  if (holding.currentPrice && holding.currentQuantity > 0) {
    return holding.currentQuantity * holding.currentPrice;
  }
  return null;
}

function computePnL(holding: InvestmentHolding): { amount: number; percent: number } | null {
  const currentValue = computeCurrentValue(holding);
  if (currentValue === null || holding.totalInvested <= 0) return null;
  const amount = currentValue - holding.totalInvested;
  const percent = (amount / holding.totalInvested) * 100;
  return { amount, percent };
}

export function HoldingsTable({
  holdings,
  onEdit,
  onDelete,
  onRebalance,
}: HoldingsTableProps) {
  const t = useTranslations('investments');
  const tCommon = useTranslations('common');

  // Check if any holding has price data
  const hasPriceData = holdings.some((h) => h.currentPrice);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">Asset</TableHead>
            <TableHead className="text-slate-400">Class</TableHead>
            <TableHead className="text-slate-400">Account</TableHead>
            <TableHead className="text-right text-slate-400">{t('holdings.quantity')}</TableHead>
            <TableHead className="text-right text-slate-400">{t('holdings.avgCost')}</TableHead>
            <TableHead className="text-right text-slate-400">{t('holdings.totalInvested')}</TableHead>
            {hasPriceData && (
              <>
                <TableHead className="text-right text-slate-400">Valor Atual</TableHead>
                <TableHead className="text-right text-slate-400">P&L</TableHead>
              </>
            )}
            {(onEdit || onDelete || onRebalance) && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((holding) => {
            const currentValue = computeCurrentValue(holding);
            const pnl = computePnL(holding);

            return (
              <TableRow
                key={holding.id}
                className="border-slate-800 hover:bg-slate-800/50"
              >
                <TableCell>
                  <div>
                    <p className="font-medium text-white">
                      {holding.ticker ? (
                        <span className="mr-2 font-mono text-sm">{holding.ticker}</span>
                      ) : null}
                      {holding.name}
                    </p>
                    {holding.account && (
                      <p className="text-xs text-slate-500">{holding.account.name}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={assetClassColors[holding.assetClass] || 'border-slate-500/50 bg-slate-500/10 text-slate-400'}
                  >
                    {t(`assetClasses.${holding.assetClass}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-300">
                  {holding.account?.name || '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-slate-300">
                  {holding.currentQuantity > 0 ? holding.currentQuantity.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-slate-300">
                  {holding.averageCost > 0 ? formatCurrency(holding.averageCost, holding.currency) : '-'}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold text-white">
                  {formatCurrency(holding.totalInvested, holding.currency)}
                </TableCell>
                {hasPriceData && (
                  <>
                    <TableCell className="text-right font-mono font-semibold text-white">
                      {currentValue !== null
                        ? formatCurrency(currentValue, holding.currency)
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {pnl ? (
                        <div className="flex items-center justify-end gap-1">
                          {pnl.amount >= 0 ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          )}
                          <span
                            className={cn(
                              'font-mono text-sm font-medium',
                              pnl.amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                            )}
                          >
                            {pnl.amount >= 0 ? '+' : ''}
                            {pnl.percent.toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </TableCell>
                  </>
                )}
                {(onEdit || onDelete || onRebalance) && (
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
                      <DropdownMenuContent align="end" className="border-slate-700 bg-slate-900">
                        {onRebalance && !TICKER_ASSET_CLASSES.includes(holding.assetClass) && (
                          <DropdownMenuItem
                            onClick={() => onRebalance(holding)}
                            className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {t('holdings.rebalance')}
                          </DropdownMenuItem>
                        )}
                        {onEdit && (
                          <DropdownMenuItem
                            onClick={() => onEdit(holding)}
                            className="text-slate-300 focus:bg-slate-800 focus:text-white"
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            {tCommon('edit')}
                          </DropdownMenuItem>
                        )}
                        {onDelete && (
                          <DropdownMenuItem
                            onClick={() => onDelete(holding)}
                            className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {tCommon('delete')}
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
  );
}
