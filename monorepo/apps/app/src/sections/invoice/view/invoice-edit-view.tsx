
import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import type { Transaction } from 'src/types/api';
import { InvoiceNewEditForm } from '../invoice-new-edit-form';

// ----------------------------------------------------------------------

type Props = {
  transaction?: Transaction;
};

export function InvoiceEditView({ transaction }: Props) {
  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading="Edit"
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Invoice', href: paths.dashboard.invoice.root },
          { name: transaction?.id },
        ]}
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      <InvoiceNewEditForm currentTransaction={transaction} />
    </DashboardContent>
  );
}
