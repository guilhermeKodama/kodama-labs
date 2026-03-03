'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Upload,
  FileText,
  Loader2,
  Check,
  CreditCard,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
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
import type { Business, EntityType, CreditCard as CreditCardType } from '@/types';
import { client } from '@/lib/api-client';

// --- Types for parsed data ---

interface ParsedTransaction {
  fitId: string;
  date: string;
  description: string;
  fullDescription: string;
  amount: number;
  type: 'income' | 'expense';
  isDuplicate: boolean;
  selected: boolean;
}

interface DetectedCreditCardPayment {
  fitId: string;
  amount: number;
  date: string;
  suggestedBankName: string;
  dueDay: number;
  closingDay: number;
}

interface CreditCardToCreate {
  bankName: string;
  lastFourDigits: string;
  closingDay: number;
  dueDay: number;
  currency: string;
}

interface ParseResult {
  bankName: string;
  accountId: string;
  currency: string;
  ledgerBalance: number;
  transactions: ParsedTransaction[];
  detectedCreditCardPayments: DetectedCreditCardPayment[];
  summary: {
    totalIncome: number;
    totalExpenses: number;
    newCount: number;
    duplicateCount: number;
  };
}

// --- Props ---

interface StatementUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businesses: Business[];
  personalAccountId: string | null;
  existingCreditCards: CreditCardType[];
  defaultEntityType?: EntityType;
  defaultEntityId?: string;
  onImportComplete: () => void;
}

type Step = 'upload' | 'entity' | 'credit-cards' | 'preview' | 'confirm';

const STEPS: Step[] = ['upload', 'entity', 'credit-cards', 'preview', 'confirm'];

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function StatementUploadDialog({
  open,
  onOpenChange,
  businesses,
  personalAccountId,
  existingCreditCards,
  defaultEntityType,
  defaultEntityId,
  onImportComplete,
}: StatementUploadDialogProps) {
  const t = useTranslations('bankStatements');
  const tCommon = useTranslations('common');

  // Step state
  const [currentStep, setCurrentStep] = useState<Step>('upload');

  // Upload state
  const [files, setFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse result
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  // Entity state
  const [entityType, setEntityType] = useState<EntityType>(defaultEntityType ?? 'personal');
  const [entityId, setEntityId] = useState<string>(defaultEntityId ?? personalAccountId ?? '');

  // Credit card creation state
  const [creditCardsToCreate, setCreditCardsToCreate] = useState<CreditCardToCreate[]>([]);
  const [skipCreditCards, setSkipCreditCards] = useState(false);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; creditCardsCreated: number } | null>(null);

  const reset = useCallback(() => {
    setCurrentStep('upload');
    setFiles([]);
    setIsParsing(false);
    setParseError(null);
    setParseResult(null);
    setEntityType(defaultEntityType ?? 'personal');
    setEntityId(defaultEntityId ?? personalAccountId ?? '');
    setCreditCardsToCreate([]);
    setSkipCreditCards(false);
    setIsImporting(false);
    setImportResult(null);
  }, [defaultEntityType, defaultEntityId, personalAccountId]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(reset, 300);
  }, [onOpenChange, reset]);

  // --- File upload ---

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const newFiles: Array<{ name: string; content: string }> = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const content = await file.text();
      newFiles.push({ name: file.name, content });
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleParse = async () => {
    if (files.length === 0) return;
    setIsParsing(true);
    setParseError(null);

    try {
      const res = await client.v1['bank-statements'].parse.$post({
        json: {
          files: files.map((f) => ({ content: f.content, fileName: f.name })),
        },
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Failed to parse files');
      }

      const data = await res.json();
      const transactions: ParsedTransaction[] = data.transactions.map((tx) => ({
        ...tx,
        selected: !tx.isDuplicate,
      }));

      setParseResult({
        ...data,
        transactions,
      });

      // Pre-fill credit cards to create if payments detected
      if (data.detectedCreditCardPayments.length > 0) {
        const hasExisting = existingCreditCards.some(
          (cc) => cc.bankName.toUpperCase().includes(data.bankName.toUpperCase().split(' ')[0] ?? '')
        );
        if (!hasExisting) {
          // Use the inferred days from the first detected payment
          const firstPayment = data.detectedCreditCardPayments[0];
          setCreditCardsToCreate([
            {
              bankName: data.bankName.split('.')[0]?.replace('S/A', '').replace('S.A', '').trim() ?? data.bankName,
              lastFourDigits: '',
              closingDay: firstPayment.closingDay,
              dueDay: firstPayment.dueDay,
              currency: data.currency,
            },
          ]);
        }
      }

      setCurrentStep('entity');
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse files');
    } finally {
      setIsParsing(false);
    }
  };

  // --- Navigation ---

  const goToStep = (step: Step) => {
    // Skip credit cards step if no payments detected
    if (step === 'credit-cards' && (!parseResult?.detectedCreditCardPayments.length || skipCreditCards)) {
      setCurrentStep('preview');
      return;
    }
    setCurrentStep(step);
  };

  const goNext = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      goToStep(STEPS[idx + 1]);
    }
  };

  const goPrev = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) {
      const prevStep = STEPS[idx - 1];
      if (prevStep === 'credit-cards' && (!parseResult?.detectedCreditCardPayments.length || skipCreditCards)) {
        setCurrentStep('entity');
        return;
      }
      setCurrentStep(prevStep);
    }
  };

  // --- Import ---

  const selectedTransactions = parseResult?.transactions.filter((t) => t.selected) ?? [];

  const handleImport = async () => {
    if (!parseResult || selectedTransactions.length === 0) return;
    setIsImporting(true);

    try {
      const res = await client.v1['bank-statements'].import.$post({
        json: {
          entityType,
          entityId,
          currency: parseResult.currency,
          bankName: parseResult.bankName,
          fileName: files.map((f) => f.name).join(', '),
          ledgerBalance: parseResult.ledgerBalance,
          transactions: selectedTransactions.map((t) => ({
            externalId: t.fitId,
            date: t.date,
            description: t.description,
            amount: t.amount,
            type: t.type,
          })),
          creditCards: creditCardsToCreate.length > 0 && !skipCreditCards
            ? creditCardsToCreate.filter((cc) => cc.lastFourDigits.length === 4)
            : undefined,
        },
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? 'Import failed');
      }

      const data = await res.json();
      setImportResult(data);
      setCurrentStep('confirm');
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDone = () => {
    onImportComplete();
    handleClose();
  };

  // --- Toggle transaction selection ---

  const toggleTransaction = (fitId: string) => {
    if (!parseResult) return;
    setParseResult({
      ...parseResult,
      transactions: parseResult.transactions.map((t) =>
        t.fitId === fitId ? { ...t, selected: !t.selected } : t
      ),
    });
  };

  const toggleAllNew = () => {
    if (!parseResult) return;
    const newTxs = parseResult.transactions.filter((t) => !t.isDuplicate);
    const allSelected = newTxs.every((t) => t.selected);
    setParseResult({
      ...parseResult,
      transactions: parseResult.transactions.map((t) =>
        t.isDuplicate ? t : { ...t, selected: !allSelected }
      ),
    });
  };

  // --- Step indicators ---

  const stepNumber = STEPS.indexOf(currentStep) + 1;
  const totalSteps = parseResult?.detectedCreditCardPayments.length ? 5 : 4;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">
            {importResult ? t('success.title') : t('title')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {importResult
              ? t('success.description')
              : `${t('step')} ${stepNumber} ${t('of')} ${totalSteps}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {/* STEP: Upload */}
          {currentStep === 'upload' && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/50 p-8 transition-colors hover:border-slate-600"
              >
                <Upload className="mb-3 h-10 w-10 text-slate-500" />
                <p className="text-sm text-slate-400">{t('upload.dropzone')}</p>
                <p className="mt-1 text-xs text-slate-500">{t('upload.formats')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ofx,.qfx"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              {files.length > 0 && (
                <div className="space-y-2">
                  {files.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 text-emerald-400">
                        <FileText className="h-4 w-4" />
                        <span className="text-sm">{file.name}</span>
                      </div>
                      <button
                        onClick={() => removeFile(idx)}
                        className="text-slate-500 hover:text-slate-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {parseError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-xs text-red-300">{parseError}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP: Entity selection */}
          {currentStep === 'entity' && parseResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <p className="text-sm text-slate-400">{t('entity.detected')}</p>
                <p className="mt-1 text-lg font-medium text-white">{parseResult.bankName}</p>
                <p className="text-sm text-slate-400">
                  {t('entity.account')}: {parseResult.accountId} · {parseResult.currency}
                </p>
              </div>

              <div className="space-y-3">
                <Label className="text-slate-300">{t('entity.selectEntity')}</Label>
                <Select value={entityType} onValueChange={(v) => {
                  setEntityType(v as EntityType);
                  if (v === 'personal' && personalAccountId) {
                    setEntityId(personalAccountId);
                  } else {
                    setEntityId('');
                  }
                }}>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-800">
                    {personalAccountId && (
                      <SelectItem value="personal">{t('entity.personal')}</SelectItem>
                    )}
                    {businesses.length > 0 && (
                      <SelectItem value="business">{t('entity.business')}</SelectItem>
                    )}
                  </SelectContent>
                </Select>

                {entityType === 'business' && (
                  <Select value={entityId} onValueChange={setEntityId}>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue placeholder={t('entity.selectBusiness')} />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-slate-800">
                      {businesses.map((biz) => (
                        <SelectItem key={biz.id} value={biz.id}>
                          {biz.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}

          {/* STEP: Credit card setup */}
          {currentStep === 'credit-cards' && parseResult && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-blue-300">{t('creditCards.detected')}</p>
                  <p className="mt-1 text-xs text-blue-400">
                    {t('creditCards.detectedDescription', { count: parseResult.detectedCreditCardPayments.length })}
                  </p>
                </div>
              </div>

              {parseResult.detectedCreditCardPayments.map((payment) => (
                <div
                  key={payment.fitId}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">{payment.date}</span>
                    <span className="text-sm font-medium text-red-400">
                      {formatCurrency(payment.amount, parseResult.currency)}
                    </span>
                  </div>
                </div>
              ))}

              {creditCardsToCreate.map((card, idx) => (
                <div key={idx} className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/30 p-4">
                  <p className="text-sm font-medium text-white">{t('creditCards.createNew')}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">{t('creditCards.bankName')}</Label>
                      <Input
                        value={card.bankName}
                        onChange={(e) => {
                          const updated = [...creditCardsToCreate];
                          updated[idx] = { ...card, bankName: e.target.value };
                          setCreditCardsToCreate(updated);
                        }}
                        className="border-slate-700 bg-slate-800 text-white h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">{t('creditCards.lastFour')}</Label>
                      <Input
                        value={card.lastFourDigits}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                          const updated = [...creditCardsToCreate];
                          updated[idx] = { ...card, lastFourDigits: val };
                          setCreditCardsToCreate(updated);
                        }}
                        placeholder="1234"
                        maxLength={4}
                        className="border-slate-700 bg-slate-800 text-white h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">{t('creditCards.closingDay')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={card.closingDay}
                        onChange={(e) => {
                          const updated = [...creditCardsToCreate];
                          updated[idx] = { ...card, closingDay: parseInt(e.target.value) || 1 };
                          setCreditCardsToCreate(updated);
                        }}
                        className="border-slate-700 bg-slate-800 text-white h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-400">{t('creditCards.dueDay')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={card.dueDay}
                        onChange={(e) => {
                          const updated = [...creditCardsToCreate];
                          updated[idx] = { ...card, dueDay: parseInt(e.target.value) || 10 };
                          setCreditCardsToCreate(updated);
                        }}
                        className="border-slate-700 bg-slate-800 text-white h-9 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSkipCreditCards(true)}
                className="text-slate-400 hover:text-slate-300"
              >
                {t('creditCards.skip')}
              </Button>
            </div>
          )}

          {/* STEP: Preview */}
          {currentStep === 'preview' && parseResult && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.new')}</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {selectedTransactions.length}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.duplicates')}</p>
                  <p className="text-lg font-bold text-slate-500">
                    {parseResult.summary.duplicateCount}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.income')}</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {formatCurrency(
                      selectedTransactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
                      parseResult.currency
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{t('preview.expenses')}</p>
                  <p className="text-lg font-bold text-red-400">
                    {formatCurrency(
                      selectedTransactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
                      parseResult.currency
                    )}
                  </p>
                </div>
              </div>

              {/* Select all toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{t('preview.transactions')}</span>
                <button
                  onClick={toggleAllNew}
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                >
                  {t('preview.toggleAll')}
                </button>
              </div>

              {/* Transaction list */}
              <div className="max-h-[300px] overflow-y-auto space-y-1 rounded-lg border border-slate-700">
                {parseResult.transactions.map((tx) => (
                  <div
                    key={tx.fitId}
                    onClick={() => !tx.isDuplicate && toggleTransaction(tx.fitId)}
                    className={`flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                      tx.isDuplicate
                        ? 'bg-slate-800/30 opacity-50'
                        : tx.selected
                          ? 'bg-slate-800/50 cursor-pointer hover:bg-slate-800/70'
                          : 'bg-slate-800/20 cursor-pointer hover:bg-slate-800/40'
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        tx.isDuplicate
                          ? 'border-slate-600 bg-slate-700'
                          : tx.selected
                            ? 'border-emerald-500 bg-emerald-500'
                            : 'border-slate-600'
                      }`}
                    >
                      {(tx.selected || tx.isDuplicate) && <Check className="h-3 w-3 text-white" />}
                    </div>

                    {/* Date */}
                    <span className="w-20 shrink-0 text-slate-400">{tx.date}</span>

                    {/* Description */}
                    <span className="min-w-0 flex-1 truncate text-slate-300" title={tx.fullDescription}>
                      {tx.description}
                    </span>

                    {/* Amount + badges */}
                    <div className="flex shrink-0 items-center gap-2">
                      {tx.isDuplicate && (
                        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                          {t('preview.duplicate')}
                        </span>
                      )}
                      <span
                        className={`font-medium ${
                          tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {tx.type === 'income' ? '+' : '-'}
                        {formatCurrency(tx.amount, parseResult.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP: Confirm (result) */}
          {currentStep === 'confirm' && importResult && (
            <div className="flex flex-col items-center justify-center space-y-4 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                <Sparkles className="h-8 w-8 text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-white">
                  {t('success.imported', { count: importResult.imported })}
                </p>
                {importResult.creditCardsCreated > 0 && (
                  <p className="mt-1 text-sm text-slate-400">
                    {t('success.creditCardsCreated', { count: importResult.creditCardsCreated })}
                  </p>
                )}
                <p className="mt-3 text-sm text-slate-400">
                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                  {t('success.categorizing')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer with navigation */}
        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          {currentStep === 'confirm' && importResult ? (
            <div className="flex w-full justify-end">
              <Button
                onClick={handleDone}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {tCommon('done')}
              </Button>
            </div>
          ) : (
            <>
              <div>
                {currentStep !== 'upload' && (
                  <Button
                    variant="outline"
                    onClick={goPrev}
                    className="border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    {tCommon('back')}
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  {tCommon('cancel')}
                </Button>

                {currentStep === 'upload' && (
                  <Button
                    onClick={handleParse}
                    disabled={files.length === 0 || isParsing}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {isParsing ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('upload.parsing')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <ArrowRight className="h-4 w-4" />
                        {t('upload.continue')}
                      </span>
                    )}
                  </Button>
                )}

                {currentStep === 'entity' && (
                  <Button
                    onClick={goNext}
                    disabled={!entityId}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <ArrowRight className="mr-1 h-4 w-4" />
                    {tCommon('next')}
                  </Button>
                )}

                {currentStep === 'credit-cards' && (
                  <Button
                    onClick={goNext}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <ArrowRight className="mr-1 h-4 w-4" />
                    {tCommon('next')}
                  </Button>
                )}

                {currentStep === 'preview' && (
                  <Button
                    onClick={handleImport}
                    disabled={selectedTransactions.length === 0 || isImporting}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {isImporting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('preview.importing')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        {t('preview.import', { count: selectedTransactions.length })}
                      </span>
                    )}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
