'use client';

import { useTranslations } from 'next-intl';
import {
  MoreVertical,
  Pencil,
  Trash2,
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
import { formatCurrency, formatDate } from '@/lib/utils/format';
import type { InvestmentTransaction, InvestmentTransactionType } from '@/types';

interface InvestmentTransactionsTableProps {
  transactions: InvestmentTransaction[];
  onEdit?: (transaction: InvestmentTransaction) => void;
  onDelete?: (transaction: InvestmentTransaction) => void;
}

const typeColors: Record<InvestmentTransactionType, string> = {
  buy: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
  sell: 'border-red-500/50 bg-red-500/10 text-red-400',
  dividend: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400',
  yield_payment: 'border-green-500/50 bg-green-500/10 text-green-400',
  split: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
  deposit: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400',
  withdrawal: 'border-orange-500/50 bg-orange-500/10 text-orange-400',
};

export function InvestmentTransactionsTable({
  transactions,
  onEdit,
  onDelete,
}: InvestmentTransactionsTableProps) {
  const t = useTranslations('investments');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            <TableHead className="text-slate-400">Date</TableHead>
            <TableHead className="text-slate-400">Holding</TableHead>
            <TableHead className="text-slate-400">Type</TableHead>
            <TableHead className="text-right text-slate-400">Qty</TableHead>
            <TableHead className="text-right text-slate-400">Price/Unit</TableHead>
            <TableHead className="text-right text-slate-400">Total</TableHead>
            <TableHead className="text-right text-slate-400">Fees</TableHead>
            {(onEdit || onDelete) && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((tx) => (
            <TableRow
              key={tx.id}
              className="border-slate-800 hover:bg-slate-800/50"
            >
              <TableCell className="text-slate-300">
                {formatDate(tx.date)}
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-medium text-white">
                    {tx.holding?.ticker ? (
                      <span className="mr-2 font-mono text-sm">{tx.holding.ticker}</span>
                    ) : null}
                    {tx.holding?.name || '-'}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={typeColors[tx.type] || 'border-slate-500/50 bg-slate-500/10 text-slate-400'}
                >
                  {t(`transactionTypes.${tx.type}`)}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-slate-300">
                {tx.quantity ? tx.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'}
              </TableCell>
              <TableCell className="text-right font-mono text-slate-300">
                {tx.pricePerUnit ? tx.pricePerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '-'}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold text-white">
                {formatCurrency(tx.totalAmount, 'BRL')}
              </TableCell>
              <TableCell className="text-right font-mono text-slate-500">
                {tx.fees > 0 ? formatCurrency(tx.fees, 'BRL') : '-'}
              </TableCell>
              {(onEdit || onDelete) && (
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
                      {onEdit && (
                        <DropdownMenuItem
                          onClick={() => onEdit(tx)}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          {tCommon('edit')}
                        </DropdownMenuItem>
                      )}
                      {onDelete && (
                        <DropdownMenuItem
                          onClick={() => onDelete(tx)}
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
