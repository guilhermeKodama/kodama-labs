'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TransactionType } from '@/types';

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, type: TransactionType) => Promise<unknown>;
  isLoading?: boolean;
}

export function CategoryDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: CategoryDialogProps) {
  const t = useTranslations('settings');
  const tTx = useTranslations('transactions');
  const tCommon = useTranslations('common');

  const [name, setName] = useState('');
  const [type, setType] = useState<TransactionType>('expense');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // Only clear the form on success — the dialog stays open on failure (via
    // the page's useDialogForm), so the user's input must survive to retry.
    const result = await onSubmit(name.trim(), type);
    if (result) {
      setName('');
      setType('expense');
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('categories.addTitle')}
      description={t('categories.addDescription')}
      className="sm:max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label className="text-slate-300">{t('categories.name')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('categories.namePlaceholder')}
            className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">{t('categories.type')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
            <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900">
              <SelectItem
                value="income"
                className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
              >
                {tTx('types.income')}
              </SelectItem>
              <SelectItem
                value="expense"
                className="text-red-400 focus:bg-slate-800 focus:text-red-400"
              >
                {tTx('types.expense')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-4">
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
            disabled={isLoading || !name.trim()}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {isLoading ? tCommon('loading') : t('categories.add')}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
