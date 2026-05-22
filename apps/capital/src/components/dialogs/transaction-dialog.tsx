'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TransactionForm } from '@/components/forms/transaction-form';
import { AttachmentUploader } from '@/components/attachments/attachment-uploader';
import type { Transaction, TransactionType, EntityType } from '@/types';
import type { CreateTransactionFormData } from '@/lib/validations';

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  entityType: EntityType;
  transaction?: Transaction;
  onSubmit: (data: CreateTransactionFormData) => void;
  isLoading?: boolean;
  defaultType?: TransactionType;
}

export function TransactionDialog({
  open,
  onOpenChange,
  entityId,
  entityType,
  transaction,
  onSubmit,
  isLoading,
  defaultType,
}: TransactionDialogProps) {
  const t = useTranslations('transactions');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {transaction ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {transaction ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <TransactionForm
          entityId={entityId}
          entityType={entityType}
          transaction={transaction}
          defaultType={defaultType}
          onSubmit={(data) => {
            onSubmit(data);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
        />
        {transaction ? (
          <div className="space-y-4 border-t border-slate-800 pt-4">
            <AttachmentUploader
              ownerType="transaction"
              ownerId={transaction.id}
              kind="BILL"
              label="Bills"
              helperText="Invoice or bill received before payment."
            />
            <AttachmentUploader
              ownerType="transaction"
              ownerId={transaction.id}
              kind="RECEIPT"
              label="Receipts"
              helperText="Proof that the payment was made."
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
