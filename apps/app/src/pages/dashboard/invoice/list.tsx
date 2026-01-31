import { useContext, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

import { CONFIG } from 'src/config-global';

import { InvoiceListView } from 'src/sections/invoice/view';
import transactionsService from 'src/modules/transactions/services/transactions.service';
import { TransactionContext } from './transaction-context';

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
