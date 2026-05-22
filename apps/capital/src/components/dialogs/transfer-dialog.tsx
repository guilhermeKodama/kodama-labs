'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {transfer ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {transfer ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
