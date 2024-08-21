import { useMediaQuery, useTheme } from '@mui/material';
import type { Transaction } from 'src/types/api';
import { InvoiceTableRowDesktop } from './invoice-table-row-desktop';
import { InvoiceTableRowMobile } from './invoice-table-row-mobile';

type Props = {
  row: Transaction;
  selected: boolean;
  onSelectRow: () => void;
  onViewRow: () => void;
  onEditRow: () => void;
  onDeleteRow: () => void;
};

export function InvoiceTableRow({
  row,
  selected,
  onSelectRow,
  onViewRow,
  onEditRow,
  onDeleteRow,
}: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return isMobile ? (
    <InvoiceTableRowMobile
      row={row}
      onViewRow={onViewRow}
      onEditRow={onEditRow}
      onDeleteRow={onDeleteRow}
    />
  ) : (
    <InvoiceTableRowDesktop
      row={row}
      selected={selected}
      onSelectRow={onSelectRow}
      onViewRow={onViewRow}
      onEditRow={onEditRow}
      onDeleteRow={onDeleteRow}
    />
  );
}
