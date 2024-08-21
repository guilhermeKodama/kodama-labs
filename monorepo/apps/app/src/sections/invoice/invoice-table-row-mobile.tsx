import { TableRow, TableCell, Stack, Typography, IconButton, Button } from '@mui/material';
import { Label } from 'src/components/label';
import type { Transaction } from 'src/types/api';
import { fCurrency } from 'src/utils/format-number';
import { fDate } from 'src/utils/format-time';

import { Iconify } from 'src/components/iconify/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { useBoolean } from 'src/hooks/use-boolean';
import { ShortTypeLabels, StatusLabels } from './constants';

type Props = {
  row: Transaction;
  onViewRow: () => void;
  onEditRow: () => void;
  onDeleteRow: () => void;
};

export function InvoiceTableRowMobile({ row, onViewRow, onEditRow, onDeleteRow }: Props) {
  const confirm = useBoolean();

  return (
    <TableRow
      hover
      sx={{
        width: '100%',
        display: 'block',
      }}
    >
      <TableCell
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 2,
          borderBottom: 1,
          borderColor: 'divider',
          width: '100%',
        }}
      >
        {/* First Column: Icon (Label) */}
        <Label
          fontSize={20}
          variant="soft"
          color={
            (row.type === 'INCOME' && 'success') || (row.type === 'EXPENSE' && 'error') || 'default'
          }
          sx={{
            minWidth: 36,
            minHeight: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {ShortTypeLabels[row.type]}
        </Label>

        {/* Second Column: Main Content */}
        <Stack
          spacing={1}
          direction="column"
          alignItems="flex-start"
          sx={{ flex: 1, marginLeft: 1.5 }}
          onClick={() => {
            onEditRow();
          }}
        >
          <Typography variant="subtitle2" noWrap>
            {row.description}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            Vencimento: {fDate(row.dueAt)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {fCurrency(row.amount)}
          </Typography>
          <Label
            variant="soft"
            color={
              (row.status.toLowerCase() === 'paid' && 'success') ||
              (row.status.toLowerCase() === 'pending' && 'warning') ||
              (row.status.toLowerCase() === 'overdue' && 'error') ||
              'default'
            }
          >
            {StatusLabels[row.status]}
          </Label>
        </Stack>

        {/* Third Column: Created Date at the top and Delete Button at the bottom */}
        <Stack
          direction="column"
          alignItems="flex-end"
          justifyContent="space-between"
          sx={{ height: '100%', minHeight: 70 }} // Adjust this value to control spacing
        >
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            {fDate(row.createdAt)}
          </Typography>
          <IconButton
            color="error"
            onClick={() => {
              confirm.onTrue();
            }}
            aria-label="delete"
            size="small"
            sx={{ marginTop: 'auto' }}
          >
            <Iconify icon="eva:trash-2-outline" />
          </IconButton>
        </Stack>
      </TableCell>
      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title="Deletar"
        content="Tem certeza que deseja deletar?"
        action={
          <Button variant="contained" color="error" onClick={onDeleteRow}>
            Deletar
          </Button>
        }
      />
    </TableRow>
  );
}
