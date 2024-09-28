import type { IInvoiceTableFilters } from 'src/types/invoice';

import { useCallback, useContext, useEffect } from 'react';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import TableBody from '@mui/material/TableBody';
import { useTheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';
import { RouterLink } from 'src/routes/components';

import { useBoolean } from 'src/hooks/use-boolean';
import { useSetState } from 'src/hooks/use-set-state';

import { sumBy } from 'src/utils/helper';
import { fIsAfter, fIsBetween } from 'src/utils/format-time';

import { varAlpha } from 'src/theme/styles';
import { DashboardContent } from 'src/layouts/dashboard';
import { INVOICE_SERVICE_OPTIONS } from 'src/_mock';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { ConfirmDialog } from 'src/components/custom-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import {
  useTable,
  emptyRows,
  rowInPage,
  TableNoData,
  getComparator,
  TableEmptyRows,
  TableHeadCustom,
  TableSelectedAction,
  TablePaginationCustom,
} from 'src/components/table';

import axios, { endpoints } from 'src/utils/axios';
import { TransactionContext } from 'src/pages/dashboard/invoice/transaction-context';
import type { Transaction } from 'src/types/api';
import { useMediaQuery } from '@mui/material';
import { useAuthContext } from 'src/auth/hooks';
import transactionsService from 'src/modules/transactions/services/transactions.service';
import { InvoiceAnalytic } from '../invoice-analytic';
import { InvoiceTableRow } from '../invoice-table-row';
import { InvoiceTableToolbar } from '../invoice-table-toolbar';
import { InvoiceTableFiltersResult } from '../invoice-table-filters-result';

// ----------------------------------------------------------------------

const TABLE_HEAD = [
  { id: 'description', label: 'Descrição' },
  { id: 'createdAt', label: 'Criado' },
  { id: 'dueAt', label: 'Vencimento' },
  { id: 'amount', label: 'Valor' },
  { id: 'status', label: 'Status' },
  { id: 'type', label: 'Tipo' },
  { id: '' },
];

// ----------------------------------------------------------------------

export function InvoiceListView() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const router = useRouter();

  const table = useTable({ defaultOrderBy: 'createdAt', defaultOrder: 'desc' });

  const confirm = useBoolean();

  const { transactions, setTransactions } = useContext(TransactionContext);

  const { user, checkUserSession } = useAuthContext();

  const filters = useSetState<IInvoiceTableFilters>({
    name: '',
    service: [],
    status: 'all',
    startDate: null,
    endDate: null,
  });

  const dateError = fIsAfter(filters.state.startDate, filters.state.endDate);

  const dataFiltered = applyFilter({
    inputData: transactions,
    comparator: getComparator(table.order, table.orderBy),
    filters: filters.state,
    dateError,
  });

  const dataInPage = rowInPage(dataFiltered, table.page, table.rowsPerPage);

  const canReset =
    !!filters.state.name ||
    filters.state.service.length > 0 ||
    filters.state.status !== 'all' ||
    (!!filters.state.startDate && !!filters.state.endDate);

  const notFound = (!dataFiltered.length && canReset) || !dataFiltered.length;

  const getInvoiceLength = (status: string) =>
    transactions.filter((item) => item.status === status).length;

  const getTotalAmount = (status: string) =>
    sumBy(
      transactions.filter((item) => item.status === status),
      (invoice) => invoice.amount
    );

  const getPercentByStatus = (status: string) =>
    (getInvoiceLength(status) / transactions.length) * 100;

  const TABS = [
    {
      value: 'all',
      label: 'Todos',
      color: 'default',
      count: transactions.length,
    },
    {
      value: 'paid',
      label: 'Pago',
      color: 'success',
      count: getInvoiceLength('paid'),
    },
    {
      value: 'pending',
      label: 'Pendente',
      color: 'warning',
      count: getInvoiceLength('pending'),
    },
    {
      value: 'overdue',
      label: 'Vencido',
      color: 'error',
      count: getInvoiceLength('overdue'),
    },
    {
      value: 'draft',
      label: 'Rascunho',
      color: 'default',
      count: getInvoiceLength('draft'),
    },
  ] as const;

  /**
   * Use effects
   */

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const processEmails = async () => {
      if (user?.hasPendingProcess === true) {
        // Show loading toast
        toast.loading('Processando emails...', {
          id: 'process-emails',
          closeButton: false,
          position: 'top-center',
        });

        // Wait 5 seconds before checking the user session
        timeoutId = setTimeout(async () => {
          if (checkUserSession) await checkUserSession();
        }, 2000);
      }

      if (user?.hasPendingProcess === false) {
        // Refetch transactions
        await transactionsService.refetchTransactions(setTransactions);

        // Complete the toast with success message
        toast.success('Emails processados com sucesso!', {
          id: 'process-emails',
          closeButton: false,
          position: 'top-center',
        });
      }
    };

    // Call the processEmails function when the component renders
    processEmails();

    return () => {
      // Clean up timeout on unmount
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [user, checkUserSession, setTransactions]);

  /**
   * Handlers
   */

  const handleDeleteRow = useCallback(
    async (id: string) => {
      try {
        await axios.delete(`${endpoints.user.deleteTransaction}/${id}`);

        const deleteRow = transactions.filter((row) => row.id !== id);

        toast.success('Deletado com sucesso!');

        setTransactions(deleteRow);

        table.onUpdatePageDeleteRow(dataInPage.length);
      } catch (e) {
        console.error(e);
        toast.error('Não foi possível deletar essa transação!');
      }
    },
    [dataInPage.length, table, transactions, setTransactions]
  );

  const handleDeleteRows = useCallback(async () => {
    try {
      await axios.delete(endpoints.user.deleteTransactions, {
        params: { ids: table.selected.join(',') },
      });

      const deleteRows = transactions.filter((row) => !table.selected.includes(row.id));

      toast.success('Deletado com sucesso!');

      setTransactions(deleteRows);

      table.onUpdatePageDeleteRows({
        totalRowsInPage: dataInPage.length,
        totalRowsFiltered: dataFiltered.length,
      });
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível deletar essa transações!');
    }
  }, [dataFiltered.length, dataInPage.length, table, transactions, setTransactions]);

  const handleEditRow = useCallback(
    (id: string) => {
      router.push(paths.dashboard.invoice.edit(id));
    },
    [router]
  );

  const handleViewRow = useCallback(
    (id: string) => {
      router.push(paths.dashboard.invoice.details(id));
    },
    [router]
  );

  const handleFilterStatus = useCallback(
    (event: React.SyntheticEvent, newValue: string) => {
      table.onResetPage();
      filters.setState({ status: newValue });
    },
    [filters, table]
  );

  return (
    <>
      <DashboardContent>
        <CustomBreadcrumbs
          heading={isMobile ? 'Transações' : 'Listar'}
          links={
            isMobile
              ? []
              : [{ name: 'Transações', href: paths.dashboard.invoice.root }, { name: 'Listar' }]
          }
          action={
            <Button
              component={RouterLink}
              href={paths.dashboard.invoice.new}
              variant="contained"
              startIcon={<Iconify icon="mingcute:add-line" />}
            >
              Nova transação
            </Button>
          }
          sx={{ mb: { xs: 3, md: 5 } }}
        />

        <Card sx={{ mb: { xs: 3, md: 5 } }}>
          <Scrollbar sx={{ minHeight: 108 }}>
            <Stack
              direction="row"
              divider={<Divider orientation="vertical" flexItem sx={{ borderStyle: 'dashed' }} />}
              sx={{ py: 2 }}
            >
              <InvoiceAnalytic
                title="Total"
                total={transactions.length}
                percent={100}
                price={sumBy(transactions, (invoice) => invoice.amount)}
                icon="solar:bill-list-bold-duotone"
                color={theme.vars.palette.info.main}
              />

              <InvoiceAnalytic
                title="Pago"
                total={getInvoiceLength('paid')}
                percent={getPercentByStatus('paid')}
                price={getTotalAmount('paid')}
                icon="solar:file-check-bold-duotone"
                color={theme.vars.palette.success.main}
              />

              <InvoiceAnalytic
                title="Pendente"
                total={getInvoiceLength('pending')}
                percent={getPercentByStatus('pending')}
                price={getTotalAmount('pending')}
                icon="solar:sort-by-time-bold-duotone"
                color={theme.vars.palette.warning.main}
              />

              <InvoiceAnalytic
                title="Vencido"
                total={getInvoiceLength('overdue')}
                percent={getPercentByStatus('overdue')}
                price={getTotalAmount('overdue')}
                icon="solar:bell-bing-bold-duotone"
                color={theme.vars.palette.error.main}
              />

              <InvoiceAnalytic
                title="Rascunho"
                total={getInvoiceLength('draft')}
                percent={getPercentByStatus('draft')}
                price={getTotalAmount('draft')}
                icon="solar:file-corrupted-bold-duotone"
                color={theme.vars.palette.text.secondary}
              />
            </Stack>
          </Scrollbar>
        </Card>

        <Card>
          <Tabs
            value={filters.state.status}
            onChange={handleFilterStatus}
            sx={{
              px: 2.5,
              boxShadow: `inset 0 -2px 0 0 ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)}`,
            }}
          >
            {TABS.map((tab) => (
              <Tab
                key={tab.value}
                value={tab.value}
                label={tab.label}
                iconPosition="end"
                icon={
                  <Label
                    variant={
                      ((tab.value === 'all' || tab.value === filters.state.status) && 'filled') ||
                      'soft'
                    }
                    color={tab.color}
                  >
                    {tab.count}
                  </Label>
                }
              />
            ))}
          </Tabs>

          <InvoiceTableToolbar
            filters={filters}
            dateError={dateError}
            onResetPage={table.onResetPage}
            options={{ services: INVOICE_SERVICE_OPTIONS.map((option) => option.name) }}
          />

          {canReset && (
            <InvoiceTableFiltersResult
              filters={filters}
              onResetPage={table.onResetPage}
              totalResults={dataFiltered.length}
              sx={{ p: 2.5, pt: 0 }}
            />
          )}

          <Box sx={{ position: 'relative' }}>
            <TableSelectedAction
              dense={table.dense}
              numSelected={table.selected.length}
              rowCount={dataFiltered.length}
              onSelectAllRows={(checked) => {
                table.onSelectAllRows(
                  checked,
                  dataFiltered.map((row) => row.id)
                );
              }}
              action={
                <Stack direction="row">
                  <Tooltip title="Sent">
                    <IconButton color="primary">
                      <Iconify icon="iconamoon:send-fill" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title="Download">
                    <IconButton color="primary">
                      <Iconify icon="eva:download-outline" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title="Print">
                    <IconButton color="primary">
                      <Iconify icon="solar:printer-minimalistic-bold" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title="Delete">
                    <IconButton color="primary" onClick={confirm.onTrue}>
                      <Iconify icon="solar:trash-bin-trash-bold" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              }
            />

            {isMobile &&
              dataFiltered.map((row) => (
                <InvoiceTableRow
                  key={row.id}
                  row={row}
                  selected={table.selected.includes(row.id)}
                  onSelectRow={() => table.onSelectRow(row.id)}
                  onViewRow={() => handleViewRow(row.id)}
                  onEditRow={() => handleEditRow(row.id)}
                  onDeleteRow={() => handleDeleteRow(row.id)}
                />
              ))}

            {!isMobile && (
              <Scrollbar sx={{ minHeight: 444 }}>
                <Table size={table.dense ? 'small' : 'medium'} sx={{ minWidth: 800 }}>
                  <TableHeadCustom
                    order={table.order}
                    orderBy={table.orderBy}
                    headLabel={TABLE_HEAD}
                    rowCount={dataFiltered.length}
                    numSelected={table.selected.length}
                    onSort={table.onSort}
                    onSelectAllRows={(checked) =>
                      table.onSelectAllRows(
                        checked,
                        dataFiltered.map((row) => row.id)
                      )
                    }
                  />

                  <TableBody>
                    {dataFiltered
                      .slice(
                        table.page * table.rowsPerPage,
                        table.page * table.rowsPerPage + table.rowsPerPage
                      )
                      .map((row) => (
                        <InvoiceTableRow
                          key={row.id}
                          row={row}
                          selected={table.selected.includes(row.id)}
                          onSelectRow={() => table.onSelectRow(row.id)}
                          onViewRow={() => handleViewRow(row.id)}
                          onEditRow={() => handleEditRow(row.id)}
                          onDeleteRow={() => handleDeleteRow(row.id)}
                        />
                      ))}

                    <TableEmptyRows
                      height={table.dense ? 56 : 56 + 20}
                      emptyRows={emptyRows(table.page, table.rowsPerPage, dataFiltered.length)}
                    />

                    <TableNoData notFound={notFound} />
                  </TableBody>
                </Table>
              </Scrollbar>
            )}
          </Box>

          {!isMobile && (
            <TablePaginationCustom
              page={table.page}
              dense={table.dense}
              count={dataFiltered.length}
              rowsPerPage={table.rowsPerPage}
              onPageChange={table.onChangePage}
              onChangeDense={table.onChangeDense}
              onRowsPerPageChange={table.onChangeRowsPerPage}
            />
          )}
        </Card>
      </DashboardContent>

      <ConfirmDialog
        open={confirm.value}
        onClose={confirm.onFalse}
        title="Delete"
        content={
          <>
            Are you sure want to delete <strong> {table.selected.length} </strong> items?
          </>
        }
        action={
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              handleDeleteRows();
              confirm.onFalse();
            }}
          >
            Delete
          </Button>
        }
      />
    </>
  );
}

// ----------------------------------------------------------------------

type ApplyFilterProps = {
  dateError: boolean;
  inputData: Transaction[];
  filters: IInvoiceTableFilters;
  comparator: (a: any, b: any) => number;
};

function applyFilter({ inputData, comparator, filters, dateError }: ApplyFilterProps) {
  const { name, status, startDate, endDate } = filters;

  const stabilizedThis = inputData.map((el, index) => [el, index] as const);

  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) return order;
    return a[1] - b[1];
  });

  inputData = stabilizedThis.map((el) => el[0]);

  if (name) {
    inputData = inputData.filter(
      (invoice) =>
        invoice.description.toLowerCase().indexOf(name.toLowerCase()) !== -1 ||
        invoice.description.toLowerCase().indexOf(name.toLowerCase()) !== -1
    );
  }

  if (status !== 'all') {
    inputData = inputData.filter((invoice) => invoice.status === status);
  }

  if (!dateError) {
    if (startDate && endDate) {
      inputData = inputData.filter((invoice) => fIsBetween(invoice.createdAt, startDate, endDate));
    }
  }

  return inputData;
}
