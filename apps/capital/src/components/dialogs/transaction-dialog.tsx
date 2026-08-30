'use client';

import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={transaction ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={transaction ? t('dialog.editDescription') : t('dialog.createDescription')}
      className="sm:max-w-md"
    >
      <TransactionForm
        entityId={entityId}
        entityType={entityType}
        transaction={transaction}
        defaultType={defaultType}
        onSubmit={onSubmit}
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
    </FormDialog>
  );
}
