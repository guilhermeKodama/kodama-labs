'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InvestmentAccountForm } from '@/components/forms/investment-account-form';
import type { InvestmentAccount } from '@/types';
import type { CreateInvestmentAccountFormData } from '@/lib/validations';

interface InvestmentAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: InvestmentAccount;
  onSubmit: (data: CreateInvestmentAccountFormData) => void | Promise<void>;
  isLoading?: boolean;
}

export function InvestmentAccountDialog({
  open,
  onOpenChange,
  account,
  onSubmit,
  isLoading,
}: InvestmentAccountDialogProps) {
  const t = useTranslations('investments.accounts');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {account ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {account ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <InvestmentAccountForm
          account={account}
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
