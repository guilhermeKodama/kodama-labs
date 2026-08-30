'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { InvestmentAccountForm } from '@/components/forms/investment-account-form';
import type { InvestmentAccount } from '@/types';
import type { CreateInvestmentAccountFormData } from '@/lib/validations';

interface InvestmentAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: InvestmentAccount;
  onSubmit: (data: CreateInvestmentAccountFormData) => void;
  isLoading?: boolean;
}

export function InvestmentAccountDialog({
  open,
  onOpenChange,
  account,
  onSubmit,
  isLoading,
}: InvestmentAccountDialogProps) {
  const t = useTranslations('investments.accounts');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={account ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={account ? t('dialog.editDescription') : t('dialog.createDescription')}
      className="sm:max-w-md"
    >
      <InvestmentAccountForm
        account={account}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
        isLoading={isLoading}
      />
    </FormDialog>
  );
}
