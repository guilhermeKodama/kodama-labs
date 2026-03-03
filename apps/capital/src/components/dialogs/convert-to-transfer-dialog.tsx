'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftRight,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { COMMON_CURRENCIES } from '@/lib/utils/currency';
import { useBusinessStore, useSettingsStore } from '@/lib/store';
import type { Transaction, Business, EntityType, TransferDirection } from '@/types';

interface ConvertToTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
  sourceEntityId: string;
  sourceEntityType: EntityType;
  businesses: Business[];
  personalAccountId: string | null;
  onComplete: () => void;
}

type Step = 'select-entity' | 'configure' | 'confirm';
const STEPS: Step[] = ['select-entity', 'configure', 'confirm'];

function inferDirection(
  sourceEntityType: EntityType,
  transactionType: string
): TransferDirection {
  if (sourceEntityType === 'personal') {
    return transactionType === 'expense' ? 'capital_injection' : 'profit_distribution';
  }
  return transactionType === 'expense' ? 'profit_distribution' : 'capital_injection';
}

export function ConvertToTransferDialog({
  open,
  onOpenChange,
  transaction,
  sourceEntityId,
  sourceEntityType,
  businesses,
  personalAccountId,
  onComplete,
}: ConvertToTransferDialogProps) {
  const t = useTranslations();
  const { settings } = useSettingsStore();
  const { addBusiness } = useBusinessStore();

  const [step, setStep] = useState<Step>('select-entity');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [, setSelectedEntityType] = useState<EntityType>('business');
  const [direction, setDirection] = useState<TransferDirection>('capital_injection');
  const [description, setDescription] = useState('');
  const [isConverting, setIsConverting] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessCurrency, setNewBusinessCurrency] = useState(settings.baseCurrency);
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  const reset = () => {
    setStep('select-entity');
    setSelectedEntityId(null);
    setSelectedEntityType('business');
    setDirection('capital_injection');
    setDescription('');
    setIsConverting(false);
    setShowCreateForm(false);
    setNewBusinessName('');
    setNewBusinessCurrency(settings.baseCurrency);
    setIsCreatingBusiness(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleSelectEntity = (entityId: string, entityType: EntityType) => {
    setSelectedEntityId(entityId);
    setSelectedEntityType(entityType);
  };

  const handleNext = () => {
    if (step === 'select-entity' && selectedEntityId && transaction) {
      setDirection(inferDirection(sourceEntityType, transaction.type));
      setDescription(transaction.description);
      setStep('configure');
    } else if (step === 'configure') {
      setStep('confirm');
    }
  };

  const handleBack = () => {
    if (step === 'configure') setStep('select-entity');
    else if (step === 'confirm') setStep('configure');
  };

  const handleCreateBusiness = async () => {
    if (!newBusinessName.trim()) return;
    setIsCreatingBusiness(true);
    try {
      const created = await addBusiness({
        name: newBusinessName.trim(),
        defaultCurrency: newBusinessCurrency,
      });
      if (created) {
        setSelectedEntityId(created.id);
        setSelectedEntityType('business');
        setShowCreateForm(false);
        setNewBusinessName('');
      }
    } finally {
      setIsCreatingBusiness(false);
    }
  };

  const handleConfirm = async () => {
    if (!transaction || !selectedEntityId) return;
    setIsConverting(true);
    try {
      // Determine personal and business sides from the two entities involved
      const personalId = sourceEntityType === 'personal' ? sourceEntityId : selectedEntityId;
      const businessId = sourceEntityType === 'business' ? sourceEntityId : selectedEntityId;

      let fromEntityId: string;
      let fromEntityType: EntityType;
      let toEntityId: string;
      let toEntityType: EntityType;

      if (direction === 'capital_injection') {
        // capital_injection: personal → business (matches transfer-form)
        fromEntityId = personalId;
        fromEntityType = 'personal';
        toEntityId = businessId;
        toEntityType = 'business';
      } else {
        // profit_distribution & reimbursement: business → personal (matches transfer-form)
        fromEntityId = businessId;
        fromEntityType = 'business';
        toEntityId = personalId;
        toEntityType = 'personal';
      }

      const body: Record<string, unknown> = {
        fromEntityType,
        toEntityType,
        direction,
        amount: transaction.amount,
        currency: transaction.currency,
        exchangeRate: transaction.exchangeRate,
        description: description || transaction.description,
        date: transaction.date instanceof Date ? transaction.date.toISOString() : transaction.date,
      };

      if (fromEntityType === 'business') body.fromBusinessId = fromEntityId;
      if (fromEntityType === 'personal') body.fromPersonalAccountId = fromEntityId;
      if (toEntityType === 'business') body.toBusinessId = toEntityId;
      if (toEntityType === 'personal') body.toPersonalAccountId = toEntityId;

      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

      // Create transfer
      const createRes = await fetch(`${baseUrl}/api/v1/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!createRes.ok) {
        throw new Error('Failed to create transfer');
      }

      // Delete original transaction
      const deleteRes = await fetch(`${baseUrl}/api/v1/transactions/${transaction.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!deleteRes.ok) {
        throw new Error('Failed to delete original transaction');
      }

      handleOpenChange(false);
      onComplete();
    } catch (error) {
      console.error('Failed to convert transaction:', error);
    } finally {
      setIsConverting(false);
    }
  };

  const selectedEntity = selectedEntityId
    ? businesses.find((b) => b.id === selectedEntityId)
    : null;

  const selectedEntityName = selectedEntity?.name ?? t('nav.personal');

  const counterpartyOptions: { id: string; name: string; type: EntityType; color?: string }[] = [];

  if (sourceEntityType === 'personal') {
    businesses.forEach((b) => {
      counterpartyOptions.push({ id: b.id, name: b.name, type: 'business', color: b.color });
    });
  } else {
    if (personalAccountId) {
      counterpartyOptions.push({
        id: personalAccountId,
        name: t('nav.personal'),
        type: 'personal',
      });
    }
    businesses
      .filter((b) => b.id !== sourceEntityId)
      .forEach((b) => {
        counterpartyOptions.push({ id: b.id, name: b.name, type: 'business', color: b.color });
      });
  }

  const directionLabel = (d: TransferDirection) => {
    if (d === 'capital_injection') return t('transfers.directions.capitalInjection');
    if (d === 'profit_distribution') return t('transfers.directions.profitDistribution');
    return t('transfers.directions.reimbursement');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <ArrowLeftRight className="h-5 w-5 text-purple-400" />
            {t('convertTransfer.title')}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {t('convertTransfer.step')} {stepIndex + 1} {t('convertTransfer.of')} {STEPS.length}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select or Create Entity */}
        {step === 'select-entity' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">{t('convertTransfer.selectEntity')}</p>

            {counterpartyOptions.length === 0 && !showCreateForm && (
              <p className="text-sm text-slate-500">{t('convertTransfer.noBusiness')}</p>
            )}

            <div className="space-y-2">
              {counterpartyOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectEntity(opt.id, opt.type)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    selectedEntityId === opt.id
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  )}
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: opt.color ? `${opt.color}20` : 'rgb(51 65 85 / 0.5)',
                    }}
                  >
                    <Building2
                      className="h-4 w-4"
                      style={{ color: opt.color || '#94a3b8' }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{opt.name}</p>
                    <p className="text-xs text-slate-500">
                      {opt.type === 'business' ? t('common.business') : t('nav.personal')}
                    </p>
                  </div>
                  {selectedEntityId === opt.id && (
                    <Check className="h-4 w-4 shrink-0 text-purple-400" />
                  )}
                </button>
              ))}
            </div>

            {/* Create new business inline */}
            {sourceEntityType === 'personal' && !showCreateForm && (
              <Button
                variant="outline"
                onClick={() => setShowCreateForm(true)}
                className="w-full border-dashed border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('convertTransfer.createBusiness')}
              </Button>
            )}

            {showCreateForm && (
              <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div>
                  <Label className="text-sm text-slate-300">
                    {t('convertTransfer.businessName')}
                  </Label>
                  <Input
                    value={newBusinessName}
                    onChange={(e) => setNewBusinessName(e.target.value)}
                    placeholder={t('convertTransfer.businessName')}
                    className="mt-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <Label className="text-sm text-slate-300">
                    {t('convertTransfer.currency')}
                  </Label>
                  <Select
                    value={newBusinessCurrency}
                    onValueChange={setNewBusinessCurrency}
                  >
                    <SelectTrigger className="mt-1 border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-slate-900">
                      {COMMON_CURRENCIES.map((c) => (
                        <SelectItem
                          key={c.code}
                          value={c.code}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          {c.symbol} {c.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCreateForm(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!newBusinessName.trim() || isCreatingBusiness}
                    onClick={handleCreateBusiness}
                    className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
                  >
                    {isCreatingBusiness ? (
                      <>
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        {t('convertTransfer.creating')}
                      </>
                    ) : (
                      t('convertTransfer.createBusiness')
                    )}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleNext}
                disabled={!selectedEntityId}
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
              >
                {t('common.next')}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Configure Transfer */}
        {step === 'configure' && transaction && (
          <div className="space-y-4">
            {/* Original transaction summary */}
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                {t('convertTransfer.transactionSummary')}
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">{transaction.description}</p>
                  <p className="text-xs text-slate-400">
                    {formatDate(transaction.date)}
                  </p>
                </div>
                <p
                  className={cn(
                    'text-lg font-bold',
                    transaction.type === 'expense' ? 'text-red-400' : 'text-emerald-400'
                  )}
                >
                  {transaction.type === 'expense' ? '-' : '+'}
                  {formatCurrency(transaction.amount, transaction.currency)}
                </p>
              </div>
            </div>

            {/* Direction */}
            <div>
              <Label className="text-sm text-slate-300">
                {t('convertTransfer.direction')}
              </Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as TransferDirection)}
              >
                <SelectTrigger className="mt-1 border-slate-700 bg-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem
                    value="capital_injection"
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    {t('transfers.directions.capitalInjection')}
                  </SelectItem>
                  <SelectItem
                    value="profit_distribution"
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    {t('transfers.directions.profitDistribution')}
                  </SelectItem>
                  <SelectItem
                    value="reimbursement"
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    {t('transfers.directions.reimbursement')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description override */}
            <div>
              <Label className="text-sm text-slate-300">
                {t('convertTransfer.description')}
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
              />
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={handleBack}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                {t('common.back')}
              </Button>
              <Button
                onClick={handleNext}
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
              >
                {t('common.next')}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 'confirm' && transaction && (
          <div className="space-y-4">
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
              <p className="text-sm text-purple-200">
                {t('convertTransfer.summary', {
                  amount: formatCurrency(transaction.amount, transaction.currency),
                  type: transaction.type === 'expense'
                    ? t('convertTransfer.expense')
                    : t('convertTransfer.income'),
                  direction: directionLabel(direction).toLowerCase(),
                  preposition:
                    direction === 'profit_distribution'
                      ? t('convertTransfer.to')
                      : direction === 'capital_injection'
                        ? t('convertTransfer.to')
                        : t('convertTransfer.from'),
                  entity: selectedEntityName,
                })}
              </p>
            </div>

            <p className="text-xs text-slate-500">
              {t('convertTransfer.confirmDescription')}
            </p>

            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                onClick={handleBack}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                {t('common.back')}
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isConverting}
                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
              >
                {isConverting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('convertTransfer.converting')}
                  </>
                ) : (
                  <>
                    <ArrowLeftRight className="mr-2 h-4 w-4" />
                    {t('convertTransfer.confirm')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
