'use client';

import { useEffect, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { parseInputDateUTC, formatInputDateUTC } from '@/lib/utils/date';
import { Zap, Bell, Plus, Trash2, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  createRecurringTransactionSchema,
  DEFAULT_REMINDERS_CONFIG,
  REMINDER_DAYS_BEFORE_PRESETS,
  type CreateRecurringTransactionFormData,
} from '@/lib/validations';
import { useSettingsStore, useBusinessStore } from '@/lib/store';
import { usePushSubscription } from '@/components/push/use-push-subscription';
import type { RecurringTransaction, TransactionType, EntityType, RecurrenceFrequency } from '@/types';
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from '@/types';

const REMINDER_PRESET_KEYS: Record<(typeof REMINDER_DAYS_BEFORE_PRESETS)[number], string> = {
  0: 'onTheDay',
  1: 'oneDayBefore',
  2: 'twoDaysBefore',
  3: 'threeDaysBefore',
  7: 'oneWeekBefore',
};

const REMINDER_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const REMINDER_MINUTES = ['00', '15', '30', '45'];

/**
 * HH:MM picker built from the same Select primitives used everywhere else
 * in this form. A native <input type="time"> renders the browser/OS's own
 * widget, which clips inside this layout and doesn't match the app's
 * styling — this keeps the reminders section visually consistent with the
 * rest of the form.
 */
function TimeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [hour, minute] = value.split(':');

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select value={hour} onValueChange={(h) => onChange(`${h}:${minute}`)} disabled={disabled}>
        <SelectTrigger className="w-[68px] border-slate-700 bg-slate-800 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-slate-700 bg-slate-900">
          {REMINDER_HOURS.map((h) => (
            <SelectItem key={h} value={h} className="text-slate-300 focus:bg-slate-800 focus:text-white">
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-slate-500">:</span>
      <Select value={minute} onValueChange={(m) => onChange(`${hour}:${m}`)} disabled={disabled}>
        <SelectTrigger className="w-[68px] border-slate-700 bg-slate-800 text-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-slate-700 bg-slate-900">
          {REMINDER_MINUTES.map((m) => (
            <SelectItem key={m} value={m} className="text-slate-300 focus:bg-slate-800 focus:text-white">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface RecurringFormProps {
  recurring?: RecurringTransaction;
  onSubmit: (data: CreateRecurringTransactionFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
  defaultEntityId?: string;
  defaultEntityType?: EntityType;
}

export function RecurringForm({
  recurring,
  onSubmit,
  onCancel,
  isLoading,
  defaultEntityId,
  defaultEntityType,
}: RecurringFormProps) {
  const t = useTranslations('recurring');
  const tCommon = useTranslations('common');
  const tTransactions = useTranslations('transactions');
  const locale = useLocale();
  const { settings, currencies, categories, personalAccount } = useSettingsStore();
  const { businesses } = useBusinessStore();

  const form = useForm<CreateRecurringTransactionFormData>({
    resolver: zodResolver(createRecurringTransactionSchema),
    defaultValues: {
      entityId: recurring?.entityId || defaultEntityId || personalAccount?.id || '',
      entityType: recurring?.entityType || defaultEntityType || 'personal',
      type: recurring?.type || 'expense',
      amount: recurring?.amount || 0,
      currency: recurring?.currency || settings.baseCurrency,
      exchangeRate: recurring?.exchangeRate || 1,
      description: recurring?.description || '',
      category: recurring?.category || '',
      frequency: recurring?.frequency || 'monthly',
      startDate: recurring?.startDate ? new Date(recurring.startDate) : new Date(),
      endDate: recurring?.endDate ? new Date(recurring.endDate) : undefined,
      autoGenerateTransaction: recurring?.autoGenerateTransaction ?? true,
      reminders: recurring?.reminders ?? undefined,
    },
  });

  const selectedType = form.watch('type');
  const selectedCurrency = form.watch('currency');
  const selectedEntityType = form.watch('entityType');
  const hasEndDate = form.watch('endDate') !== undefined && form.watch('endDate') !== null;
  const isAutoMode = form.watch('autoGenerateTransaction');
  const overdueEnabled = form.watch('reminders.overdue.enabled');

  const {
    fields: reminderEntryFields,
    append: appendReminderEntry,
    remove: removeReminderEntry,
    replace: replaceReminderEntries,
  } = useFieldArray({ control: form.control, name: 'reminders.entries' });

  const { status: pushStatus, enable: enablePush } = usePushSubscription();

  // Seed default reminders (one "on the day" entry + daily overdue nag) the
  // first time this item is in Lembrete mode with nothing configured yet —
  // covers both clicking the mode toggle and opening an existing
  // reminder-mode row created before this feature shipped. Never overwrites
  // an existing config, so toggling back to Automático and forth keeps it.
  //
  // The entries array MUST be seeded via the field array's own replace(),
  // not a plain form.setValue('reminders', ...) — useFieldArray keeps its
  // rendered `fields` in an internal subscription that only reacts to its
  // own mutation methods (append/remove/replace/...); a setValue on the
  // array path from outside updates the underlying form data but leaves
  // `fields` stale, so the seeded entry silently never renders.
  //
  // Always clone DEFAULT_REMINDERS_CONFIG rather than handing over the
  // shared object itself — useFieldArray mutates array items in place (it
  // stamps a hidden `id` onto each one), so passing the same reference
  // across multiple form instances/dialog opens would corrupt the shared
  // default for every subsequent form in the page.
  //
  // Guarded by a ref, not just an inspection of current values — React 19
  // dev-mode Strict Mode runs this effect twice back to back on mount, and
  // react-hook-form's store update from the first invocation isn't
  // guaranteed to be visible to getValues() before the second runs. The ref
  // flips synchronously within the first invocation, closing that window.
  const hasSeededReminders = useRef(false);
  useEffect(() => {
    if (isAutoMode || hasSeededReminders.current) return;
    hasSeededReminders.current = true;

    // Inspect the CONTENTS, not just `reminders` itself: useFieldArray
    // initializes reminders.entries to [] as soon as it mounts, so
    // `reminders` is already a truthy {entries: []} before anything is
    // configured. Testing truthiness here skipped the seed entirely, which
    // left reminders.overdue.time undefined while the time picker still
    // displayed its '09:00' fallback — a value that looked set but failed
    // validation on submit.
    const existing = form.getValues('reminders');
    const alreadyConfigured =
      (existing?.entries?.length ?? 0) > 0 || existing?.overdue?.time !== undefined;
    if (alreadyConfigured) return;

    const seed = structuredClone(DEFAULT_REMINDERS_CONFIG);
    replaceReminderEntries(seed.entries);
    // Leaf-by-leaf, not setValue('reminders.overdue', seed.overdue), so each
    // registered field is updated individually.
    form.setValue('reminders.overdue.enabled', seed.overdue.enabled);
    form.setValue('reminders.overdue.time', seed.overdue.time);
  }, [isAutoMode, form, replaceReminderEntries]);

  // Set default currency when currencies are loaded
  useEffect(() => {
    if (currencies.length > 0 && !selectedCurrency) {
      const defaultCurrency = currencies.find(c => c.code === settings.baseCurrency) 
        || currencies[0];
      if (defaultCurrency) {
        form.setValue('currency', defaultCurrency.code);
      }
    }
  }, [currencies, selectedCurrency, settings.baseCurrency, form]);

  // Auto-update exchange rate when currency changes
  useEffect(() => {
    if (selectedCurrency === settings.baseCurrency) {
      form.setValue('exchangeRate', 1);
    } else {
      const currency = currencies.find((c) => c.code === selectedCurrency);
      if (currency) {
        form.setValue('exchangeRate', currency.manualRate);
      }
    }
  }, [selectedCurrency, currencies, settings.baseCurrency, form]);

  // Update entity when entity type changes
  useEffect(() => {
    if (selectedEntityType === 'personal' && personalAccount) {
      form.setValue('entityId', personalAccount.id);
    } else if (selectedEntityType === 'business' && businesses.length > 0) {
      form.setValue('entityId', businesses[0].id);
    }
  }, [selectedEntityType, personalAccount, businesses, form]);

  const getCategoriesForType = (type: TransactionType) => {
    const customCategories = categories
      .filter((c) => c.type === type)
      .map((c) => c.name);

    if (customCategories.length > 0) {
      return customCategories;
    }

    switch (type) {
      case 'income':
        return DEFAULT_INCOME_CATEGORIES;
      case 'expense':
        return DEFAULT_EXPENSE_CATEGORIES;
      case 'investment':
        return DEFAULT_INVESTMENT_CATEGORIES;
    }
  };

  const categoryOptions = getCategoriesForType(selectedType);
  const showExchangeRate = selectedCurrency !== settings.baseCurrency;

  const frequencyOptions: RecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'yearly'];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Mode: this decides the whole behavior, so it leads the form */}
        <FormField
          control={form.control}
          name="autoGenerateTransaction"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <FormLabel className="text-slate-300">{t('form.mode.label')}</FormLabel>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => field.onChange(true)}
                  aria-pressed={field.value}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                    field.value
                      ? 'border-cyan-500 bg-cyan-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <Zap className="h-4 w-4 shrink-0 text-cyan-400" />
                    {t('form.mode.auto.title')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t('form.mode.auto.description')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => field.onChange(false)}
                  aria-pressed={!field.value}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                    !field.value
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-white">
                    <Bell className="h-4 w-4 shrink-0 text-purple-400" />
                    {t('form.mode.reminder.title')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t('form.mode.reminder.description')}
                  </span>
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Reminders: only meaningful in Lembrete mode, Google-Calendar-style
            configurable offsets + a daily nag that keeps firing after the
            due date until the item is marked paid or concluído. */}
        {!isAutoMode && (
          <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <h4 className="flex items-center gap-2 text-sm font-medium text-white">
              <Bell className="h-4 w-4 text-purple-400" />
              {t('form.reminders.title')}
            </h4>

            {pushStatus !== 'subscribed' && (
              <div className="flex flex-col items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-amber-300">
                  {pushStatus === 'ios-needs-install'
                    ? t('form.reminders.push.iosInstallHint')
                    : pushStatus === 'denied'
                      ? t('form.reminders.push.denied')
                      : t('form.reminders.push.notEnabled')}
                </p>
                {pushStatus !== 'ios-needs-install' &&
                  pushStatus !== 'denied' &&
                  pushStatus !== 'unsupported' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void enablePush()}
                      disabled={pushStatus === 'subscribing'}
                      className="shrink-0 border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
                    >
                      <BellRing className="mr-2 h-4 w-4" />
                      {t('form.reminders.push.enableButton')}
                    </Button>
                  )}
              </div>
            )}

            <div className="space-y-2">
              {reminderEntryFields.map((entryField, index) => (
                <div key={entryField.id} className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name={`reminders.entries.${index}.daysBefore`}
                    render={({ field }) => (
                      <Select
                        value={String(field.value)}
                        onValueChange={(value) => field.onChange(Number(value))}
                      >
                        <SelectTrigger className="flex-1 border-slate-700 bg-slate-800 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-slate-700 bg-slate-900">
                          {REMINDER_DAYS_BEFORE_PRESETS.map((preset) => (
                            <SelectItem
                              key={preset}
                              value={String(preset)}
                              className="text-slate-300 focus:bg-slate-800 focus:text-white"
                            >
                              {t(`form.reminders.preset.${REMINDER_PRESET_KEYS[preset]}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`reminders.entries.${index}.time`}
                    render={({ field }) => (
                      <TimeSelect value={field.value ?? '09:00'} onChange={field.onChange} />
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeReminderEntry(index)}
                    aria-label={t('form.reminders.remove')}
                    className="shrink-0 text-slate-400 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => appendReminderEntry({ daysBefore: 1, time: '09:00' })}
              disabled={reminderEntryFields.length >= 5}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('form.reminders.add')}
            </Button>

            <div className="space-y-3 border-t border-slate-800 pt-4">
              <FormField
                control={form.control}
                name="reminders.overdue.enabled"
                render={({ field }) => (
                  <div className="flex items-start gap-3">
                    <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                    <div>
                      <p className="text-sm text-slate-300">{t('form.reminders.overdue.label')}</p>
                      <p className="text-xs text-slate-500">{t('form.reminders.overdue.description')}</p>
                    </div>
                  </div>
                )}
              />
              {/* Always mounted — react-hook-form only tracks a field once its
                  Controller has rendered at least once, so conditionally
                  unmounting this on overdueEnabled would drop a value seeded
                  before the user ever opened the toggle. Visibility is
                  handled with disabled + dimming instead. */}
              <FormField
                control={form.control}
                name="reminders.overdue.time"
                render={({ field }) => (
                  <div className={cn('pl-11', !overdueEnabled && 'opacity-40')}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        {t('form.reminders.overdue.timeLabel')}
                      </span>
                      <TimeSelect
                        value={field.value ?? '09:00'}
                        onChange={field.onChange}
                        disabled={!overdueEnabled}
                      />
                    </div>
                    <FormMessage />
                  </div>
                )}
              />
            </div>
          </div>
        )}

        {/* Entity Selection */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="entityType"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{t('form.entityType')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    <SelectItem
                      value="personal"
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {tCommon('personal')}
                    </SelectItem>
                    <SelectItem
                      value="business"
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {tCommon('business')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedEntityType === 'business' && (
            <FormField
              control={form.control}
              name="entityId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('form.business')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                        <SelectValue placeholder={t('form.selectBusiness')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-slate-700 bg-slate-900">
                      {businesses.map((business) => (
                        <SelectItem
                          key={business.id}
                          value={business.id}
                          className="text-slate-300 focus:bg-slate-800 focus:text-white"
                        >
                          {business.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {/* Transaction Type */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{tTransactions('form.type')}</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  form.setValue('category', '');
                }}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  <SelectItem
                    value="income"
                    className="text-emerald-400 focus:bg-slate-800 focus:text-emerald-400"
                  >
                    {tTransactions('types.income')}
                  </SelectItem>
                  <SelectItem
                    value="expense"
                    className="text-red-400 focus:bg-slate-800 focus:text-red-400"
                  >
                    {tTransactions('types.expense')}
                  </SelectItem>
                  <SelectItem
                    value="investment"
                    className="text-blue-400 focus:bg-slate-800 focus:text-blue-400"
                  >
                    {tTransactions('types.investment')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{tTransactions('form.description')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('form.descriptionPlaceholder')}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Amount and Currency */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">
                  {isAutoMode ? tTransactions('form.amount') : t('form.estimatedAmount')}
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

          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">{tTransactions('form.currency')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="border-slate-700 bg-slate-900">
                    {currencies.map((currency) => (
                      <SelectItem
                        key={currency.code}
                        value={currency.code}
                        className="text-slate-300 focus:bg-slate-800 focus:text-white"
                      >
                        {currency.symbol} {currency.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Exchange Rate */}
        {showExchangeRate && (
          <FormField
            control={form.control}
            name="exchangeRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-300">
                  {tTransactions('form.exchangeRate')} (1 {settings.baseCurrency} = ? {selectedCurrency})
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step="0.000001"
                    min="0"
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
                    className="border-slate-700 bg-slate-800 text-white"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Category */}
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{tTransactions('form.category')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue placeholder={tTransactions('form.categoryPlaceholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {categoryOptions.map((category) => (
                    <SelectItem
                      key={category}
                      value={category}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Frequency */}
        <FormField
          control={form.control}
          name="frequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.frequency')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {frequencyOptions.map((freq) => (
                    <SelectItem
                      key={freq}
                      value={freq}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {t(`frequencies.${freq}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Start Date */}
        <FormField
          control={form.control}
          name="startDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-slate-300">{t('form.startDate')}</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={formatInputDateUTC(field.value instanceof Date ? field.value : null)}
                  onChange={(e) => {
                    const parsed = parseInputDateUTC(e.target.value);
                    if (parsed) field.onChange(parsed);
                  }}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* End Date Toggle and Field */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={hasEndDate}
              onCheckedChange={(checked: boolean) => {
                form.setValue('endDate', checked ? new Date() : undefined);
              }}
            />
            <span className="text-sm text-slate-300">{t('form.hasEndDate')}</span>
          </div>

          {hasEndDate && (
            <FormField
              control={form.control}
              name="endDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t('form.endDate')}</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={
                        formatInputDateUTC(field.value instanceof Date ? field.value : null)
                      }
                      onChange={(e) => {
                        const parsed = parseInputDateUTC(e.target.value);
                        if (parsed) field.onChange(parsed);
                      }}
                      className="border-slate-700 bg-slate-800 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
          >
            {recurring ? tCommon('save') : tCommon('create')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
