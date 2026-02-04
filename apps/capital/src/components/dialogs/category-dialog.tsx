'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  onSubmit: (name: string, type: TransactionType) => void;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), type);
      setName('');
      setType('expense');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">
            {t('categories.addTitle')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {t('categories.addDescription')}
          </DialogDescription>
        </DialogHeader>
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
                <SelectItem
                  value="investment"
                  className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
                >
                  {tTx('types.investment')}
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
              {t('categories.add')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
