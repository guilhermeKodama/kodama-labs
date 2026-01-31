import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TableRow from '@mui/material/TableRow';
import Checkbox from '@mui/material/Checkbox';
import TableCell from '@mui/material/TableCell';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';

import { useBoolean } from 'src/hooks/use-boolean';

import { fCurrency } from 'src/utils/format-number';
import { fDate, fTime } from 'src/utils/format-time';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { usePopover, CustomPopover } from 'src/components/custom-popover';
import type { Transaction } from 'src/types/api';
import { ExpenseCategory, TransactionType } from 'src/types/api';
import { useTheme } from '@emotion/react';
import { useContext } from 'react';
import { FormDialog } from 'src/components/form-dialog';
import axios, { endpoints } from 'src/utils/axios';
import { TransactionContext } from 'src/pages/dashboard/invoice/transaction-context';
import transactionsService from 'src/modules/transactions/services/transactions.service';
import { StatusLabels } from './constants';

// ----------------------------------------------------------------------

type Props = {
  row: Transaction;
  selected: boolean;
  onSelectRow: () => void;
  onViewRow: () => void;
  onEditRow: () => void;
  onDeleteRow: () => void;
};

export function InvoiceTableRowDesktop({
  row,
  selected,
  onSelectRow,
  onViewRow,
  onEditRow,
  onDeleteRow,
}: Props) {
  const { setTransactions } = useContext(TransactionContext);

  const confirm = useBoolean();

  const popover = usePopover();

  const theme = useTheme();

  const dialog = useBoolean();

  const renderRowIcon = () => {
    if (row.email?.pdfNeedsPassword) {
      return (
        <Tooltip title="PDF necessita senha para extrair items da fatura.">
          {/* @ts-ignore */}
          <Iconify icon="mdi:alert" width={24} height={24} color={theme.palette.warning.main} />
        </Tooltip>
      );
    }

    if (row.category === ExpenseCategory.CREDIT_CARD) {
      return <Iconify icon="ic:baseline-credit-card" width={24} height={24} />;
    }

    return null;
  };

  const renderSecondaryText = () => {
    if (row.email?.pdfNeedsPassword && !row.email?.isPasswordSet) {
      return (
        <Button onClick={dialog.onTrue} variant="text">
          Enviar senha do PDF
        </Button>
      );
    }

    if (row.email?.pdfNeedsPassword && row.email?.isPasswordSet) {
      return (
        <Typography variant="caption" noWrap>
          PDF está na fila de processamento.
        </Typography>
      );
    }

    return null;
  };

  const handleSubmitPassword = async (password: string) => {
    await axios.post(endpoints.user.setPDFPassword, {
      transactionId: row.id,
      password,
    });

    await transactionsService.refetchTransactions(setTransactions);

    dialog.onFalse();
  };

  return (
    <>
      <FormDialog
        open={dialog.value}
        content="Digite a senha para destravar o PDF e extrair os detalhes da fatura."
        onClose={dialog.onFalse}
        onCancel={dialog.onFalse}
        onConfirm={handleSubmitPassword}
      />
      <TableRow hover selected={selected}>
        <TableCell padding="checkbox">
          <Checkbox
            checked={selected}
            onClick={onSelectRow}
            inputProps={{ id: `row-checkbox-${row.id}`, 'aria-label': `Row checkbox` }}
          />
        </TableCell>

        <TableCell>
          <Stack spacing={2} direction="row" alignItems="center">
            {renderRowIcon()}

            {/* <Avatar alt={row.description}>{row.description.charAt(0).toUpperCase()}</Avatar> */}

            <ListItemText
              disableTypography
              primary={
                <Typography variant="body2" noWrap>
                  {row.description}
                </Typography>
              }
              secondary={renderSecondaryText()}
            />
          </Stack>
        </TableCell>

        <TableCell>
          <ListItemText
            primary={fDate(row.createdAt)}
            secondary={fTime(row.createdAt)}
            primaryTypographyProps={{ typography: 'body2', noWrap: true }}
            secondaryTypographyProps={{ mt: 0.5, component: 'span', typography: 'caption' }}
          />
        </TableCell>

        <TableCell>
          <ListItemText
            primary={fDate(row.dueAt)}
            secondary={fTime(row.dueAt)}
            primaryTypographyProps={{ typography: 'body2', noWrap: true }}
            secondaryTypographyProps={{ mt: 0.5, component: 'span', typography: 'caption' }}
          />
        </TableCell>

        <TableCell>{fCurrency(row.amount)}</TableCell>

        <TableCell>
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
        </TableCell>

        <TableCell>
          <Tooltip title={
            row.type === TransactionType.INCOME ? 'Receita' :
            row.type === TransactionType.EXPENSE ? 'Despesa' :
            row.type === TransactionType.INVESTMENT ? 'Investimento' : ''
          }>
            <Label
              variant="soft"
              color={
                (row.type === TransactionType.INCOME && 'success') ||
                (row.type === TransactionType.EXPENSE && 'error') ||
                (row.type === TransactionType.INVESTMENT && 'info') ||
                'default'
              }
              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}
            >
              {row.type === TransactionType.INCOME && <Iconify icon="mdi:cash-plus" width={20} />}
              {row.type === TransactionType.EXPENSE && <Iconify icon="mdi:cash-minus" width={20} />}
              {row.type === TransactionType.INVESTMENT && <Iconify icon="mdi:finance" width={20} />}
            </Label>
          </Tooltip>
        </TableCell>

        <TableCell align="right" sx={{ px: 1 }}>
          <IconButton color={popover.open ? 'inherit' : 'default'} onClick={popover.onOpen}>
            <Iconify icon="eva:more-vertical-fill" />
          </IconButton>
        </TableCell>
      </TableRow>

      <CustomPopover
        open={popover.open}
        anchorEl={popover.anchorEl}
        onClose={popover.onClose}
        slotProps={{ arrow: { placement: 'right-top' } }}
      >
        {/* <MenuItem
          onClick={() => {
            onViewRow();
            popover.onClose();
          }}
        >
          <Iconify icon="solar:eye-bold" />
          View
        </MenuItem> */}

        <MenuItem
          onClick={() => {
            onEditRow();
            popover.onClose();
          }}
        >
          <Iconify icon="solar:pen-bold" />
          Editar
        </MenuItem>

        <Divider sx={{ borderStyle: 'dashed' }} />

        <MenuItem
          onClick={() => {
            confirm.onTrue();
            popover.onClose();
          }}
          sx={{ color: 'error.main' }}
        >
          <Iconify icon="solar:trash-bin-trash-bold" />
          Deletar
        </MenuItem>
      </CustomPopover>

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
    </>
  );
}
