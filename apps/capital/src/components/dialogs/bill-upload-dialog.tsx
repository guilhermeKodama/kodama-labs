'use client';

import { useState, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { FormDialog } from '@/components/dialogs/form-dialog';
import { DialogFooter } from '@/components/ui/dialog';
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
import type { CreditCard, CreditCardBill, Transaction } from '@/types';

interface BillUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditCards: CreditCard[];
  bills?: CreditCardBill[];
  expenseTransactions?: Transaction[];
  onSubmit: (data: {
    creditCardId: string;
    closingDate: string;
    dueDate: string;
    csvContent: string;
    csvFileName: string;
    transactionId?: string;
    createExpense: boolean;
  }) => void;
  isLoading?: boolean;
}

export function BillUploadDialog({
  open,
  onOpenChange,
  creditCards,
  bills = [],
  expenseTransactions = [],
  onSubmit,
  isLoading,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset the form every time the dialog transitions open, so a prior
  // upload's card/dates/CSV don't linger into the next one. Since the dialog
  // only closes on a successful submit (see useDialogForm), a failed upload
  // leaves `open` unchanged and the user's in-progress input intact to retry.
  // Adjusted directly during render (React's documented alternative to an
  // effect for this) so the reset lands in the same commit.
  const [seededForOpen, setSeededForOpen] = useState(open);
  if (seededForOpen !== open) {
    setSeededForOpen(open);
    setCreditCardId('');
    setClosingDate('');
    setDueDate('');
    setCsvContent('');
    setCsvFileName('');
    setLinkOption('create');
    setTransactionId('');
  }

  // Detect if uploading will replace an existing bill
  const willReplace = useMemo(() => {
    if (!creditCardId || !closingDate) return false;
    // Match by card + closing date (same day = same billing cycle)
    const inputClosing = closingDate; // "YYYY-MM-DD"
    return bills.some((bill) => {
      if (bill.creditCardId !== creditCardId) return false;
      const billClosing = bill.closingDate instanceof Date
        ? bill.closingDate.toISOString().slice(0, 10)
        : String(bill.closingDate).slice(0, 10);
      return billClosing === inputClosing;
    });
  }, [creditCardId, closingDate, bills]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      creditCardId,
      closingDate,
      dueDate,
      csvContent,
      csvFileName,
      transactionId: linkOption === 'existing' ? transactionId : undefined,
      createExpense: linkOption === 'create',
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('upload.title')}
      description={t('upload.description')}
      className="max-h-none overflow-y-visible sm:max-w-[550px]"
    >
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

        {/* Replace warning */}
        {willReplace && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-300">
              {t('upload.replaceWarning')}
            </p>
          </div>
        )}

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
            disabled={isLoading || !creditCardId || !csvContent || !closingDate || !dueDate}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isLoading ? (
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
    </FormDialog>
  );
}
