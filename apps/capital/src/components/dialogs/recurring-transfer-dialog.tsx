'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RecurringTransferForm, type RecurringTransferFormData } from '@/components/forms/recurring-transfer-form';
import { AttachmentUploader } from '@/components/attachments/attachment-uploader';
import type { RecurringTransfer } from '@/types';

interface RecurringTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recurringTransfer?: RecurringTransfer;
  onSubmit: (data: RecurringTransferFormData) => void;
  isLoading?: boolean;
}

export function RecurringTransferDialog({
  open,
  onOpenChange,
  recurringTransfer,
  onSubmit,
  isLoading,
}: RecurringTransferDialogProps) {
  const t = useTranslations('transfers.recurring.dialog');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl text-white">
            {recurringTransfer ? t('editTitle') : t('createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {recurringTransfer ? t('editDescription') : t('createDescription')}
          </DialogDescription>
        </DialogHeader>
        <RecurringTransferForm
          recurringTransfer={recurringTransfer}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
        />
        {recurringTransfer ? (
          <div className="border-t border-slate-800 pt-4">
            <AttachmentUploader
              ownerType="recurringTransfer"
              ownerId={recurringTransfer.id}
              kind="TRANSFER_RECEIPT"
              label="Receipt for next iteration"
              helperText="Attach the upcoming transfer receipt here. When this entry is paid (cron or Mark Paid), the file will move to that transfer and this section will reset."
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
