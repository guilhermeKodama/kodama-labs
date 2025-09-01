import { z as zod } from 'zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import LoadingButton from '@mui/lab/LoadingButton';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { useBoolean } from 'src/hooks/use-boolean';

import { today } from 'src/utils/format-time';

import { Form, schemaHelper } from 'src/components/hook-form';

import axios, { endpoints } from 'src/utils/axios';
import type { Transaction } from 'src/types/api';
import { TransactionType } from 'src/types/api';
import { InvoiceNewEditStatusDate } from './invoice-new-edit-status-date';
import { InvoiceNewEditCategoryTotal } from './invoice-new-edit-category-total';
import { InvoiceNewEditDescription } from './invoice-new-edit-description';
import { InvoiceNewEditType } from './invoice-new-edit-type';
import { InvoiceNewEditSubItems } from './invoice-new-edit-subitems';

// ----------------------------------------------------------------------

export type NewInvoiceSchemaType = zod.infer<typeof NewInvoiceSchema>;

export const NewInvoiceSchema = zod.object({
  type: zod.string().refine((val) => val !== '', { message: 'Tipo é obrigatório!' }),
  createdAt: schemaHelper.date({ message: { required_error: 'Data de criação é obrigatório!' } }),
  dueAt: schemaHelper.date({ message: { required_error: 'Data de vencimento é obrigatório!' } }),
  // Not required
  category: zod.string().optional(),
  description: zod.string().refine((val) => val !== '', { message: 'Descrição é obrigatório!' }),
  status: zod.string().refine((val) => val !== '', { message: 'Status é obrigatório!' }),
  amount: zod.number().refine((val) => val !== 0, {
    message: 'Valor é obrigatório.',
  }),
  subItems: zod
    .array(
      zod.object({
        id: zod.string().optional(),
        description: zod.string(),
        amount: zod.number(),
        category: zod.string().optional(),
        hasChanged: zod.boolean().optional(),
        // Add crypto specific fields
        symbol: zod.string().optional(),
        quantity: zod.number().optional(),
        pricePerUnit: zod.number().optional(),
      })
    )
    .optional(),
});

// ----------------------------------------------------------------------

type Props = {
  currentTransaction?: Transaction;
};

export function InvoiceNewEditForm({ currentTransaction }: Props) {
  const router = useRouter();

  const loadingSave = useBoolean();

  const loadingSend = useBoolean();

  const defaultValues = useMemo(
    () => ({
      type: currentTransaction?.type || TransactionType.EXPENSE,
      description: currentTransaction?.description || '',
      category: currentTransaction?.category || '',
      createdAt: currentTransaction?.createdAt || today(),
      dueAt: currentTransaction?.dueAt || null,
      status: currentTransaction?.status || 'pending',
      amount: currentTransaction?.amount || 0,
      subItems: currentTransaction?.subItems || [],
    }),
    [currentTransaction]
  );

  const methods = useForm<NewInvoiceSchemaType>({
    mode: 'all',
    resolver: zodResolver(NewInvoiceSchema),
    defaultValues,
  });

  const {
    reset,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const handleSaveAsDraft = handleSubmit(async (data) => {
    loadingSave.onTrue();

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      reset();
      loadingSave.onFalse();
      router.push(paths.dashboard.invoice.root);
      console.info('DATA', JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(error);
      loadingSave.onFalse();
    }
  });

  const handleCreateAndSend = handleSubmit(async (data) => {
    loadingSend.onTrue();
    console.log({ data });
    try {
      let amount = 0;

      if (data.subItems && data.subItems.length > 0) {
        amount = data.subItems.reduce((acc, item) => acc + (item.amount || 0), 0);
      } else {
        amount = data.amount || 0;
      }

      // Prepare subItems data
      const subItems = data.subItems?.map(item => ({
        ...item,
        symbol: item.symbol || null,
        quantity: item.quantity || null,
        pricePerUnit: item.pricePerUnit || null,
        category: item.category || null,
      }));

      if (currentTransaction) {
        await axios.put(endpoints.user.updateTransaction, {
          ...data,
          amount,
          category: data.category === '' ? null : data.category,
          status: data.status.toUpperCase(),
          id: currentTransaction.id,
          subItems,
        });
      } else {
        await axios.post(endpoints.user.createTransaction, {
          ...data,
          amount,
          category: data.category === '' ? null : data.category,
          status: data.status.toUpperCase(),
          subItems,
        });
      }

      reset();
      loadingSend.onFalse();

      router.push(paths.dashboard.invoice.root);
    } catch (error) {
      console.error(error);
      loadingSend.onFalse();
    }
  });

  return (
    <Form methods={methods}>
      <Card>
        <InvoiceNewEditType />

        <InvoiceNewEditDescription />

        <InvoiceNewEditStatusDate />

        <InvoiceNewEditCategoryTotal />

        <InvoiceNewEditSubItems />
      </Card>

      <Stack justifyContent="flex-end" direction="row" spacing={2} sx={{ mt: 3 }}>
        <LoadingButton
          color="inherit"
          size="large"
          variant="outlined"
          loading={loadingSave.value && isSubmitting}
          onClick={handleSaveAsDraft}
        >
          Salvar como rascunho
        </LoadingButton>

        <LoadingButton
          size="large"
          variant="contained"
          loading={loadingSend.value && isSubmitting}
          onClick={handleCreateAndSend}
        >
          {currentTransaction ? 'Atualizar' : 'Salvar'}
        </LoadingButton>
      </Stack>
    </Form>
  );
}
