'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InvestmentHoldingForm } from '@/components/forms/investment-holding-form';
import type { InvestmentHolding } from '@/types';
import type { CreateInvestmentHoldingFormData } from '@/lib/validations';

interface InvestmentHoldingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding?: InvestmentHolding;
  defaultAccountId?: string;
  onSubmit: (data: CreateInvestmentHoldingFormData) => void | Promise<void>;
  isLoading?: boolean;
}

export function InvestmentHoldingDialog({
  open,
  onOpenChange,
  holding,
  defaultAccountId,
  onSubmit,
  isLoading,
}: InvestmentHoldingDialogProps) {
  const t = useTranslations('investments.holdings');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {holding ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {holding ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <InvestmentHoldingForm
          holding={holding}
          defaultAccountId={defaultAccountId}
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
