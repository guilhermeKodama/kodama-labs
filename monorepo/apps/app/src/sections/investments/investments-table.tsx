import { useState } from 'react';
import type { Transaction } from 'src/types/api';

import { Table, TableBody, TableContainer, TablePagination } from '@mui/material';

import { Scrollbar } from 'src/components/scrollbar';

import InvestmentsTableRow from './investments-table-row';
import InvestmentsTableHead from './investments-table-head';
import InvestmentsTableToolbar from './investments-table-toolbar';
import { TableNoData } from './table-no-data';

// ----------------------------------------------------------------------

type Props = {
  data: Transaction[];
};

export default function InvestmentsTable({ data }: Props) {
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = useState('date');
  const [rowsPerPage, setRowsPerPage] = useState(5);

  const handleSort = (id: string) => {
    const isAsc = orderBy === id && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(id);
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPage(0);
    setRowsPerPage(parseInt(event.target.value, 10));
  };

  return (
    <>
      <InvestmentsTableToolbar />

      <TableContainer sx={{ overflow: 'unset' }}>
        <Scrollbar>
          <Table sx={{ minWidth: 800 }}>
            <InvestmentsTableHead
              order={order}
              orderBy={orderBy}
              onSort={handleSort}
              headLabel={[
                { id: 'symbol', label: 'Criptomoeda' },
                { id: 'quantity', label: 'Quantidade' },
                { id: 'price', label: 'Preço' },
                { id: 'total', label: 'Total' },
                { id: 'date', label: 'Data' },
              ]}
            />
            <TableBody>
              {data.flatMap((row) =>
                row.subItems.map((subItem, idx) => (
                  <InvestmentsTableRow key={`${row.id}-${idx}`} row={row} subItem={subItem} />
                ))
              )}
              <TableNoData notFound={data.length === 0} />
            </TableBody>
          </Table>
        </Scrollbar>
      </TableContainer>

      <TablePagination
        page={page}
        component="div"
        count={data.length}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        rowsPerPageOptions={[5, 10, 25]}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </>
  );
} 