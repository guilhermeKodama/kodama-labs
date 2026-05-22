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
import { AttachmentUploader } from '@/components/attachments/attachment-uploader';
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
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
          defaultEntityId={defaultEntityId}
          defaultEntityType={defaultEntityType}
        />
        {recurring ? (
          <div className="border-t border-slate-800 pt-4">
            <AttachmentUploader
              ownerType="recurringTransaction"
              ownerId={recurring.id}
              kind="BILL"
              label="Bill for next iteration"
              helperText="Attach the upcoming bill here. When this entry is paid (cron or Mark Paid), the file will move to that payment and this section will reset."
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
