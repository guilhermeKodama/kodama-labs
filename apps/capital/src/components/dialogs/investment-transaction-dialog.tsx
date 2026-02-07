'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InvestmentTransactionForm } from '@/components/forms/investment-transaction-form';
import type { InvestmentTransaction } from '@/types';
import type { CreateInvestmentTransactionFormData } from '@/lib/validations';

interface InvestmentTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction?: InvestmentTransaction;
  defaultHoldingId?: string;
  onSubmit: (data: CreateInvestmentTransactionFormData) => void | Promise<void>;
  isLoading?: boolean;
}

export function InvestmentTransactionDialog({
  open,
  onOpenChange,
  transaction,
  defaultHoldingId,
  onSubmit,
  isLoading,
}: InvestmentTransactionDialogProps) {
  const t = useTranslations('investments.transactions');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {transaction ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {transaction ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <InvestmentTransactionForm
          transaction={transaction}
          defaultHoldingId={defaultHoldingId}
          onSubmit={async (data) => {
            await onSubmit(data);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
