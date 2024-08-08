import { Helmet } from 'react-helmet-async';

import { useParams } from 'src/routes/hooks';

import { CONFIG } from 'src/config-global';

import { InvoiceEditView } from 'src/sections/invoice/view';
import { TransactionContext } from './transaction-context';
import { useContext } from 'react';

// ----------------------------------------------------------------------

const metadata = { title: `Invoice edit | Dashboard - ${CONFIG.site.name}` };

export default function Page() {
  const { id = '' } = useParams();

  const { transactions } = useContext(TransactionContext);

  const currentTransaction = transactions.find((transaction) => transaction.id === id);

  return (
    <>
      <Helmet>
        <title> {metadata.title}</title>
      </Helmet>

      <InvoiceEditView transaction={currentTransaction} />
    </>
  );
}
