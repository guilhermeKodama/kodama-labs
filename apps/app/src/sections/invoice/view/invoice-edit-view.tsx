import { paths } from 'src/routes/paths';

import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import type { Transaction } from 'src/types/api';

import { IconButton, useMediaQuery, useTheme } from '@mui/material';
import { useRouter } from 'src/routes/hooks';
import { Iconify } from 'src/components/iconify/iconify';
import { InvoiceNewEditForm } from '../invoice-new-edit-form';

// ----------------------------------------------------------------------

type Props = {
  transaction?: Transaction;
};

export function InvoiceEditView({ transaction }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <DashboardContent>
      {isMobile ? (
        <IconButton
          onClick={handleBack}
          aria-label="back"
          sx={{
            mb: 3,
            ml: 0,
            justifyContent: 'flex-start',
          }}
        >
          <Iconify icon="eva:arrow-back-outline" width={24} height={24} />
        </IconButton>
      ) : (
        <CustomBreadcrumbs
          heading="Editar"
          links={[
            { name: 'Transações', href: paths.dashboard.invoice.root },
            { name: transaction?.id },
          ]}
          sx={{ mb: { xs: 3, md: 5 } }}
        />
      )}

      <InvoiceNewEditForm currentTransaction={transaction} />
    </DashboardContent>
  );
}
