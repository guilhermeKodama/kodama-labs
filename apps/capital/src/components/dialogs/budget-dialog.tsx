'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {budget ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {budget ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <BudgetForm
          budget={budget}
          onSubmit={(data) => {
            onSubmit(data);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
          defaultEntityId={defaultEntityId}
          defaultEntityType={defaultEntityType}
          defaultCategory={defaultCategory}
        />
      </DialogContent>
    </Dialog>
  );
}
