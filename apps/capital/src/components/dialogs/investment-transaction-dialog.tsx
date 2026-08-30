'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { InvestmentTransactionForm } from '@/components/forms/investment-transaction-form';
import type { InvestmentTransaction } from '@/types';
import type { CreateInvestmentTransactionFormData } from '@/lib/validations';

interface InvestmentTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: InvestmentTransaction;
  defaultHoldingId?: string;
  onSubmit: (data: CreateInvestmentTransactionFormData) => void;
  isLoading?: boolean;
}

export function InvestmentTransactionDialog({
  open,
  onOpenChange,
  transaction,
  defaultHoldingId,
  onSubmit,
  isLoading,
}: InvestmentTransactionDialogProps) {
  const t = useTranslations('investments.transactions');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={transaction ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={transaction ? t('dialog.editDescription') : t('dialog.createDescription')}
    >
      <InvestmentTransactionForm
        transaction={transaction}
        defaultHoldingId={defaultHoldingId}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
        isLoading={isLoading}
      />
    </FormDialog>
  );
}
