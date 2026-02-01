'use client';

import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BusinessForm } from '@/components/forms/business-form';
import type { Business } from '@/types';
import type { CreateBusinessFormData } from '@/lib/validations';

interface BusinessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business?: Business;
  onSubmit: (data: CreateBusinessFormData) => void;
  isLoading?: boolean;
}

export function BusinessDialog({
  open,
  onOpenChange,
  business,
  onSubmit,
  isLoading,
}: BusinessDialogProps) {
  const t = useTranslations('businesses');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {business ? t('dialog.editTitle') : t('dialog.createTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {business ? t('dialog.editDescription') : t('dialog.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <BusinessForm
          business={business}
          onSubmit={(data) => {
            onSubmit(data);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
