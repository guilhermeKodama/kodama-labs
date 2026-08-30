'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { BudgetForm } from '@/components/forms/budget-form';
import type { Budget, EntityType } from '@/types';
import type { CreateBudgetFormData } from '@/lib/validations';

interface BudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget?: Budget;
  onSubmit: (data: CreateBudgetFormData) => void;
  isLoading?: boolean;
  defaultEntityId?: string;
  defaultEntityType?: EntityType;
  defaultCategory?: string;
}

export function BudgetDialog({
  open,
  onOpenChange,
  budget,
  onSubmit,
  isLoading,
  defaultEntityId,
  defaultEntityType,
  defaultCategory,
}: BudgetDialogProps) {
  const t = useTranslations('budgets');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={budget ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={budget ? t('dialog.editDescription') : t('dialog.createDescription')}
    >
      <BudgetForm
        budget={budget}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
        isLoading={isLoading}
        defaultEntityId={defaultEntityId}
        defaultEntityType={defaultEntityType}
        defaultCategory={defaultCategory}
      />
    </FormDialog>
  );
}
