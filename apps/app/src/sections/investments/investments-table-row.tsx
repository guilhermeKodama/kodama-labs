import { TableRow, TableCell, Typography } from '@mui/material';
import type { Transaction, TransactionSubItem } from 'src/types/api';

import { fCurrency } from 'src/utils/format-number';
import { fDate } from 'src/utils/format-time';

// ----------------------------------------------------------------------

type Props = {
  row: Transaction;
  subItem: TransactionSubItem;
};

export default function InvestmentsTableRow({ row, subItem }: Props) {
  const symbol = subItem.symbol || 'N/A';
  const quantity = typeof subItem.quantity === 'number' ? subItem.quantity : 'N/A';
  const price = typeof subItem.amount === 'number' ? subItem.amount : 0;
  const total = typeof subItem.quantity === 'number' && typeof subItem.amount === 'number'
    ? subItem.quantity * subItem.amount
    : 0;

  return (
    <TableRow hover>
      <TableCell>
        <Typography variant="subtitle2">{symbol}</Typography>
      </TableCell>
      <TableCell>{quantity}</TableCell>
      <TableCell>{fCurrency(price)}</TableCell>
      <TableCell>{fCurrency(total)}</TableCell>
      <TableCell>{fDate(row.dueAt)}</TableCell>
    </TableRow>
  );
} 