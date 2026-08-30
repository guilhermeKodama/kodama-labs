'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={recurringTransfer ? t('editTitle') : t('createTitle')}
      description={recurringTransfer ? t('editDescription') : t('createDescription')}
      className="sm:max-w-[500px]"
    >
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
    </FormDialog>
  );
}
