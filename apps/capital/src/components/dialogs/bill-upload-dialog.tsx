'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import type { CreditCard, Transaction } from '@/types';

interface BillUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditCards: CreditCard[];
  expenseTransactions?: Transaction[];
  onSubmit: (data: {
    creditCardId: string;
    closingDate: string;
    dueDate: string;
    csvContent: string;
    csvFileName: string;
    transactionId?: string;
    createExpense: boolean;
  }) => Promise<void>;
}

export function BillUploadDialog({
  open,
  onOpenChange,
  creditCards,
  expenseTransactions = [],
  onSubmit,
}: BillUploadDialogProps) {
  const t = useTranslations('creditCards');
  const tCommon = useTranslations('common');

  const [creditCardId, setCreditCardId] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [linkOption, setLinkOption] = useState<'none' | 'existing' | 'create'>('create');
  const [transactionId, setTransactionId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvContent(content);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await onSubmit({
        creditCardId,
        closingDate,
        dueDate,
        csvContent,
        csvFileName,
        transactionId: linkOption === 'existing' ? transactionId : undefined,
        createExpense: linkOption === 'create',
      });
      onOpenChange(false);
      // Reset form
      setCreditCardId('');
      setClosingDate('');
      setDueDate('');
      setCsvContent('');
      setCsvFileName('');
      setLinkOption('create');
      setTransactionId('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCard = creditCards.find((c) => c.id === creditCardId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="text-white">{t('upload.title')}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {t('upload.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Credit Card selector */}
          <div className="space-y-2">
            <Label className="text-slate-300">{t('upload.selectCard')}</Label>
            <Select value={creditCardId} onValueChange={setCreditCardId}>
              <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                <SelectValue placeholder={t('upload.selectCard')} />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                {creditCards.filter((c) => c.isActive).map((card) => (
                  <SelectItem key={card.id} value={card.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: card.color }}
                      />
                      {card.bankName} ****{card.lastFourDigits}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* CSV File Upload */}
          <div className="space-y-2">
            <Label className="text-slate-300">{t('upload.csvFile')}</Label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/50 p-6 transition-colors hover:border-slate-600"
            >
              {csvFileName ? (
                <div className="flex items-center gap-2 text-emerald-400">
                  <FileText className="h-5 w-5" />
                  <span className="text-sm">{csvFileName}</span>
                </div>
              ) : (
                <>
                  <Upload className="mb-2 h-8 w-8 text-slate-500" />
                  <p className="text-sm text-slate-400">{t('upload.csvFileDrag')}</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Closing Date + Due Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">{t('upload.closingDate')}</Label>
              <Input
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">{t('upload.dueDate')}</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
                required
              />
            </div>
          </div>

          {/* Link option */}
          <div className="space-y-3">
            <Label className="text-slate-300">Transaction Link</Label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="linkOption"
                  value="create"
                  checked={linkOption === 'create'}
                  onChange={() => setLinkOption('create')}
                  className="accent-emerald-500"
                />
                {t('upload.createNewExpense')}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="linkOption"
                  value="existing"
                  checked={linkOption === 'existing'}
                  onChange={() => setLinkOption('existing')}
                  className="accent-emerald-500"
                />
                {t('upload.linkToExisting')}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="linkOption"
                  value="none"
                  checked={linkOption === 'none'}
                  onChange={() => setLinkOption('none')}
                  className="accent-emerald-500"
                />
                {t('upload.noLink')}
              </label>
            </div>

            {/* Existing transaction selector */}
            {linkOption === 'existing' && (
              <Select value={transactionId} onValueChange={setTransactionId}>
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder={t('upload.selectTransaction')} />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-800">
                  {expenseTransactions
                    .filter((tx) => tx.type === 'expense')
                    .slice(0, 20)
                    .map((tx) => (
                      <SelectItem key={tx.id} value={tx.id}>
                        {tx.description} - {tx.amount.toFixed(2)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !creditCardId || !csvContent || !closingDate || !dueDate}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('upload.processing')}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  {t('uploadBill')}
                </span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
