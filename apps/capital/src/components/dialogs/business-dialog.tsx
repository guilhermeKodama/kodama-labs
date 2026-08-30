'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { BusinessForm } from '@/components/forms/business-form';
import type { Business } from '@/types';
import type { CreateBusinessFormData } from '@/lib/validations';

interface BusinessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business?: Business;
  onSubmit: (data: CreateBusinessFormData) => void;
  isLoading?: boolean;
}

export function BusinessDialog({
  open,
  onOpenChange,
  business,
  onSubmit,
  isLoading,
}: BusinessDialogProps) {
  const t = useTranslations('businesses');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={business ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={business ? t('dialog.editDescription') : t('dialog.createDescription')}
      className="sm:max-w-md"
    >
      <BusinessForm
        business={business}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
        isLoading={isLoading}
      />
    </FormDialog>
  );
}
