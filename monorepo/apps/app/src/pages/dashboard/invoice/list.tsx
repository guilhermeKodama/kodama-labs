import { useContext, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { InvoiceListView } from 'src/sections/invoice/view';
import axios, { endpoints } from 'src/utils/axios';
import type { Transaction, UserTransactionsReponse } from 'src/types/api';
import { TransactionContext } from './transaction-context';

// ----------------------------------------------------------------------

const metadata = { title: `Invoice list | Dashboard - ${CONFIG.site.name}` };

export default function Page() {
  const { setTransactions } = useContext(TransactionContext);

  useEffect(() => {
    axios.get(endpoints.user.transactions).then((response) => {
      const data: UserTransactionsReponse = response.data;

      const STATUS_MAP = {
        PENDING: 'pending',
        PAID: 'paid',
        OVERDUE: 'overdue',
        DRAFT: 'draft',
      };

      const transactionsMapped: Transaction[] = data.transactions.map((transaction) => ({
        ...transaction,
        status: STATUS_MAP[transaction.status as keyof typeof STATUS_MAP] || STATUS_MAP.DRAFT,
      }));

      setTransactions(transactionsMapped);
    });
  }, [setTransactions]);

  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <InvoiceListView />
    </>
  );
}
