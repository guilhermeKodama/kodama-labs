'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { TransferForm } from '@/components/forms/transfer-form';
import { AttachmentUploader } from '@/components/attachments/attachment-uploader';
import type { Transfer } from '@/types';
import type { CreateTransferFormData } from '@/lib/validations';

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transfer?: Transfer;
  onSubmit: (data: CreateTransferFormData) => void;
  isLoading?: boolean;
}

export function TransferDialog({
  open,
  onOpenChange,
  transfer,
  onSubmit,
  isLoading,
}: TransferDialogProps) {
  const t = useTranslations('transfers');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={transfer ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={transfer ? t('dialog.editDescription') : t('dialog.createDescription')}
      className="sm:max-w-md"
    >
      <TransferForm
        transfer={transfer}
        onSubmit={onSubmit}
        onCancel={() => onOpenChange(false)}
        isLoading={isLoading}
      />
      {transfer ? (
        <div className="border-t border-slate-800 pt-4">
          <AttachmentUploader
            ownerType="transfer"
            ownerId={transfer.id}
            kind="TRANSFER_RECEIPT"
            label="Transfer receipt"
            helperText="Proof of the bank operation."
          />
        </div>
      ) : null}
    </FormDialog>
  );
}
