import { useContext, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { InvoiceListView } from 'src/sections/invoice/view';
import axios, { endpoints } from 'src/utils/axios';
import type { Transaction, UserTransactionsReponse } from 'src/types/api';
import { TransactionContext } from './transaction-context';
import transactionsService from 'src/modules/transactions/services/transactions.service';

// ----------------------------------------------------------------------

const metadata = { title: `Invoice list | Dashboard - ${CONFIG.site.name}` };

export default function Page() {
  const { setTransactions } = useContext(TransactionContext);

  useEffect(() => {
    transactionsService.refetchTransactions(setTransactions).then(() => {});
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
