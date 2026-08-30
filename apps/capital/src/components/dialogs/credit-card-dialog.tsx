'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { useBusinessStore, useSettingsStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { CreditCard, EntityType } from '@/types';

interface CreditCardFormData {
  entityType: EntityType;
  bankName: string;
  lastFourDigits: string;
  nickname?: string;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  color: string;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

interface CreditCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card?: CreditCard;
  onSubmit: (data: CreditCardFormData) => void;
  isLoading?: boolean;
}

const CARD_COLORS = [
  '#8B5CF6', // Purple (Nubank)
  '#F97316', // Orange (Itaú)
  '#EF4444', // Red (Bradesco)
  '#3B82F6', // Blue (default)
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#6366F1', // Indigo
  '#84CC16', // Lime
];

export function CreditCardDialog({ open, onOpenChange, card, onSubmit, isLoading }: CreditCardDialogProps) {
  const t = useTranslations('creditCards');
  const tCommon = useTranslations('common');
  const { businesses } = useBusinessStore();
  const { personalAccount, currencies } = useSettingsStore();

  const [entityType, setEntityType] = useState<EntityType>('personal');
  const [businessId, setBusinessId] = useState<string>('');
  const [bankName, setBankName] = useState('');
  const [lastFourDigits, setLastFourDigits] = useState('');
  const [nickname, setNickname] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [closingDay, setClosingDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [color, setColor] = useState(CARD_COLORS[3]);
  const [currency, setCurrency] = useState('BRL');

  // Re-seed the form whenever the dialog is (re)opened or switches which card
  // it's editing. Adjusted directly during render (React's documented
  // alternative to an effect for this) instead of via useEffect, so the
  // reset lands in the same commit rather than a cascading extra render.
  const [seededFor, setSeededFor] = useState<{ open: boolean; card?: CreditCard }>({
    open,
    card,
  });
  if (seededFor.open !== open || seededFor.card !== card) {
    setSeededFor({ open, card });
    if (card) {
      setEntityType(card.entityType);
      setBankName(card.bankName);
      setLastFourDigits(card.lastFourDigits);
      setNickname(card.nickname || '');
      setCreditLimit(card.creditLimit.toString());
      setClosingDay(card.closingDay.toString());
      setDueDay(card.dueDay.toString());
      setColor(card.color);
      setCurrency(card.currency);
    } else {
      setEntityType('personal');
      setBusinessId('');
      setBankName('');
      setLastFourDigits('');
      setNickname('');
      setCreditLimit('');
      setClosingDay('');
      setDueDay('');
      setColor(CARD_COLORS[3]);
      setCurrency('BRL');
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      entityType,
      bankName,
      lastFourDigits,
      nickname: nickname || undefined,
      creditLimit: parseFloat(creditLimit),
      closingDay: parseInt(closingDay),
      dueDay: parseInt(dueDay),
      color,
      currency,
      businessId: entityType === 'business' ? businessId : undefined,
      personalAccountId: entityType === 'personal' ? personalAccount?.id : undefined,
    });
  };

  const isEdit = !!card;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? t('dialog.editTitle') : t('dialog.createTitle')}
      description={isEdit ? t('dialog.editDescription') : t('dialog.createDescription')}
      className="max-h-none overflow-y-visible sm:max-w-[500px]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Entity Type */}
        {!isEdit && (
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.entityType')}</Label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
              <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                <SelectItem value="personal">{t('form.personal')}</SelectItem>
                <SelectItem value="business">{t('form.business')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Business selector */}
        {entityType === 'business' && !isEdit && (
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.selectBusiness')}</Label>
            <Select value={businessId} onValueChange={setBusinessId}>
              <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                <SelectValue placeholder={t('form.selectBusiness')} />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                {businesses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Bank Name */}
        <div className="space-y-2">
          <Label className="text-slate-300">{t('form.bankName')}</Label>
          <Input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder={t('form.bankNamePlaceholder')}
            className="border-slate-700 bg-slate-800 text-white"
            required
          />
        </div>

        {/* Last 4 Digits + Nickname */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.lastFour')}</Label>
            <Input
              value={lastFourDigits}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setLastFourDigits(val);
              }}
              placeholder={t('form.lastFourPlaceholder')}
              className="border-slate-700 bg-slate-800 text-white font-mono"
              maxLength={4}
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.nickname')}</Label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('form.nicknamePlaceholder')}
              className="border-slate-700 bg-slate-800 text-white"
            />
          </div>
        </div>

        {/* Credit Limit + Currency */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.creditLimit')}</Label>
            <Input
              type="number"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
              className="border-slate-700 bg-slate-800 text-white"
              min="0"
              step="0.01"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.currency')}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-slate-800">
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.symbol} {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Closing Day + Due Day */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.closingDay')}</Label>
            <Input
              type="number"
              value={closingDay}
              onChange={(e) => setClosingDay(e.target.value)}
              className="border-slate-700 bg-slate-800 text-white"
              min="1"
              max="31"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">{t('form.dueDay')}</Label>
            <Input
              type="number"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              className="border-slate-700 bg-slate-800 text-white"
              min="1"
              max="31"
              required
            />
          </div>
        </div>

        {/* Card Color */}
        <div className="space-y-2">
          <Label className="text-slate-300">{t('form.color')}</Label>
          <div className="flex flex-wrap gap-2">
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'h-8 w-8 rounded-full border-2 transition-all',
                  color === c ? 'border-white scale-110' : 'border-transparent'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
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
            disabled={isLoading || !bankName || lastFourDigits.length !== 4 || !creditLimit || !closingDay || !dueDay}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isLoading ? tCommon('loading') : (isEdit ? tCommon('save') : tCommon('create'))}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}
