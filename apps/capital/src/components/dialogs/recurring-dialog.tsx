'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RecurringForm } from '@/components/forms/recurring-form';
import type { RecurringTransaction, EntityType } from '@/types';
import type { CreateRecurringTransactionFormData } from '@/lib/validations';

interface RecurringDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recurring?: RecurringTransaction;
  onSubmit: (data: CreateRecurringTransactionFormData) => void;
  isLoading?: boolean;
  defaultEntityId?: string;
  defaultEntityType?: EntityType;
}

export function RecurringDialog({
  open,
  onOpenChange,
  recurring,
  onSubmit,
  isLoading,
  defaultEntityId,
  defaultEntityType,
}: RecurringDialogProps) {
  const t = useTranslations('recurring');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {recurring ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {recurring ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <RecurringForm
          recurring={recurring}
          onSubmit={(data) => {
            onSubmit(data);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
          defaultEntityId={defaultEntityId}
          defaultEntityType={defaultEntityType}
        />
      </DialogContent>
    </Dialog>
  );
}
