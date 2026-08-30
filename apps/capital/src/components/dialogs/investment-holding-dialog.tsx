'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { InvestmentHoldingForm } from '@/components/forms/investment-holding-form';
import type { InvestmentHolding } from '@/types';
import type { CreateInvestmentHoldingFormData } from '@/lib/validations';

interface InvestmentHoldingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding?: InvestmentHolding;
  defaultAccountId?: string;
  onSubmit: (data: CreateInvestmentHoldingFormData) => void;
  isLoading?: boolean;
}

export function InvestmentHoldingDialog({
  open,
  onOpenChange,
  holding,
  defaultAccountId,
  onSubmit,
  isLoading,
}: InvestmentHoldingDialogProps) {
  const t = useTranslations('investments.holdings');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={holding ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={holding ? t('dialog.editDescription') : t('dialog.createDescription')}
      className="sm:max-w-md"
    >
      <InvestmentHoldingForm
        holding={holding}
        defaultAccountId={defaultAccountId}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
        isLoading={isLoading}
      />
    </FormDialog>
  );
}
