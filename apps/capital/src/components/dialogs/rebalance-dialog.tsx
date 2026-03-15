'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { CurrencyInput } from '@/components/ui/currency-input';
import { formatCurrency } from '@/lib/utils/format';
import type { InvestmentHolding } from '@/types';

const rebalanceSchema = z.object({
  newValue: z.number().positive('Value must be greater than 0'),
});

type RebalanceFormData = z.infer<typeof rebalanceSchema>;

interface RebalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: InvestmentHolding | null;
  onSubmit: (holdingId: string, adjustmentAmount: number) => Promise<boolean>;
  isLoading?: boolean;
}

export function RebalanceDialog({
  open,
  onOpenChange,
  holding,
  onSubmit,
  isLoading,
}: RebalanceDialogProps) {
  const t = useTranslations('investments.rebalance');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const form = useForm<RebalanceFormData>({
    resolver: zodResolver(rebalanceSchema),
    defaultValues: {
      newValue: 0,
    },
  });

  useEffect(() => {
    if (open && holding) {
      form.reset({ newValue: holding.totalInvested });
    }
  }, [open, holding, form]);

  const handleSubmit = async (data: RebalanceFormData) => {
    if (!holding) return;
    const adjustmentAmount = data.newValue - holding.totalInvested;
    if (adjustmentAmount === 0) {
      onOpenChange(false);
      return;
    }
    const success = await onSubmit(holding.id, adjustmentAmount);
    if (success) {
      onOpenChange(false);
    }
  };

  if (!holding) return null;

  const newValue = form.watch('newValue');
  const diff = newValue - holding.totalInvested;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">{t('title')}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <p className="text-sm font-medium text-white">{holding.name}</p>
          {holding.account && (
            <p className="text-xs text-slate-500">{holding.account.name}</p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">{t('currentValue')}</span>
            <span className="font-mono text-sm font-semibold text-white">
              {formatCurrency(holding.totalInvested, holding.currency)}
            </span>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">
                    {t('actualValue')}
                  </FormLabel>
                  <FormControl>
                    <CurrencyInput
                      value={field.value}
                      onChange={field.onChange}
                      locale={locale}
                      className="border-slate-700 bg-slate-800 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {diff !== 0 && newValue > 0 && (
              <div className="rounded-md border border-slate-700 bg-slate-800/30 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{t('adjustment')}</span>
                  <span
                    className={`font-mono text-sm font-medium ${
                      diff > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {diff > 0 ? '+' : ''}
                    {formatCurrency(diff, holding.currency)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isLoading || diff === 0}
                className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('submit')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
