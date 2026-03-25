'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Settings,
  Globe,
  Palette,
  Database,
  Trash2,
  Download,
  Plus,
  Tag,
  Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { CategoryDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useSettingsStore,
  useBusinessStore,
  useTransactionStore,
  useTransferStore,
} from '@/lib/store';
import { COMMON_CURRENCIES, getCurrencyByCode } from '@/lib/utils/currency';
import { toast } from 'sonner';
import { client } from '@/lib/api-client';
import type { TransactionType, Category } from '@/types';

export default function SettingsPage() {
  const t = useTranslations();
  const {
    settings,
    currencies,
    categories,
    personalAccount,
    updateSettings,
    addCurrency,
    updateCurrencyRate,
    removeCurrency,
    addCategory,
    removeCategory,
    resetApp,
  } = useSettingsStore();
  const { businesses, updateBusiness } = useBusinessStore();
  const { transactions } = useTransactionStore();
  const { transfers } = useTransferStore();

  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showCurrencyDialog, setShowCurrencyDialog] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [newCurrencyCode, setNewCurrencyCode] = useState('');
  const [newCurrencyRate, setNewCurrencyRate] = useState('1');
  const [deletingCategory, setDeletingCategory] = useState<Category | undefined>();

  // Initial balance state
  const [personalInitialBalance, setPersonalInitialBalance] = useState<string>(
    personalAccount ? String(personalAccount.initialBalance) : '0'
  );
  const [businessInitialBalances, setBusinessInitialBalances] = useState<Record<string, string>>(
    () => Object.fromEntries(businesses.map((b) => [b.id, String(b.initialBalance)]))
  );
  const [savingInitialBalance, setSavingInitialBalance] = useState<string | null>(null);

  const handleSavePersonalInitialBalance = async () => {
    if (!personalAccount) return;
    setSavingInitialBalance('personal');
    try {
      const res = await client.v1.users.me['initial-balance'].$patch({
        json: { initialBalance: parseFloat(personalInitialBalance) || 0 },
      });
      if (res.ok) {
        toast.success(t('settings.initialBalance.saved'));
      }
    } catch {
      toast.error('Failed to save initial balance');
    } finally {
      setSavingInitialBalance(null);
    }
  };

  const handleSaveBusinessInitialBalance = async (businessId: string) => {
    setSavingInitialBalance(businessId);
    try {
      await updateBusiness(businessId, {
        initialBalance: parseFloat(businessInitialBalances[businessId] ?? '0') || 0,
      });
      toast.success(t('settings.initialBalance.saved'));
    } catch {
      toast.error('Failed to save initial balance');
    } finally {
      setSavingInitialBalance(null);
    }
  };

  const handleAddCurrency = () => {
    const currencyInfo = getCurrencyByCode(newCurrencyCode);
    if (!currencyInfo) {
      toast.error(t('settings.currencies.invalidCurrency'));
      return;
    }

    if (currencies.some((c) => c.code === newCurrencyCode)) {
      toast.error(t('settings.currencies.alreadyExists'));
      return;
    }

    addCurrency({
      code: currencyInfo.code,
      name: currencyInfo.name,
      symbol: currencyInfo.symbol,
      manualRate: parseFloat(newCurrencyRate) || 1,
    });

    setNewCurrencyCode('');
    setNewCurrencyRate('1');
    setShowCurrencyDialog(false);
    toast.success(t('settings.currencies.added'));
  };

  const handleAddCategory = (name: string, type: TransactionType) => {
    addCategory(name, type);
    toast.success(t('settings.categories.added'));
  };

  const handleDeleteCategory = () => {
    if (deletingCategory) {
      removeCategory(deletingCategory.id);
      setDeletingCategory(undefined);
      toast.success(t('settings.categories.deleted'));
    }
  };

  const handleReset = () => {
    resetApp();
    // Clear other stores
    useBusinessStore.getState().businesses = [];
    useTransactionStore.getState().transactions = [];
    useTransferStore.getState().transfers = [];
    setShowResetDialog(false);
    toast.success(t('settings.data.resetSuccess'));
    // Reload to trigger onboarding
    window.location.reload();
  };

  const handleExport = () => {
    const data = {
      settings,
      currencies,
      categories,
      businesses,
      transactions,
      transfers,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `capital-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('settings.data.exportSuccess'));
  };

  // Group categories by type
  const categoriesByType = {
    income: categories.filter((c) => c.type === 'income'),
    expense: categories.filter((c) => c.type === 'expense'),
    investment: categories.filter((c) => c.type === 'investment'),
  };

  return (
    <AppShell>
      <Header title={t('settings.title')} description={t('settings.subtitle')} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Appearance */}
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20">
                <Palette className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-white">
                  {t('settings.appearance.title')}
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {t('settings.appearance.description')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">{t('settings.appearance.theme')}</Label>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-slate-300">{t('settings.appearance.language')}</Label>
              <LanguageSwitcher />
            </div>
          </CardContent>
        </Card>

        {/* Base Currency */}
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
                <Globe className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-white">
                  {t('settings.baseCurrency.title')}
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {t('settings.baseCurrency.description')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-slate-300">
                {t('settings.baseCurrency.current')}
              </Label>
              <Select
                value={settings.baseCurrency}
                onValueChange={(value) => updateSettings({ baseCurrency: value })}
              >
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {COMMON_CURRENCIES.map((currency) => (
                    <SelectItem
                      key={currency.code}
                      value={currency.code}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {currency.symbol} {currency.code} - {currency.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Currencies & Exchange Rates */}
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                  <Settings className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <CardTitle className="text-white">
                    {t('settings.currencies.title')}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    {t('settings.currencies.description')}
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => setShowCurrencyDialog(true)}
                size="sm"
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('settings.currencies.add')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {currencies.length === 0 ? (
              <p className="py-4 text-center text-slate-400">
                {t('settings.currencies.empty')}
              </p>
            ) : (
              <div className="space-y-3">
                {currencies.map((currency) => (
                  <div
                    key={currency.code}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-white">
                        {currency.symbol}
                      </span>
                      <div>
                        <p className="font-medium text-white">{currency.code}</p>
                        <p className="text-xs text-slate-400">{currency.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {currency.code !== settings.baseCurrency && (
                        <>
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-slate-400">
                              1 {settings.baseCurrency} =
                            </Label>
                            <Input
                              type="number"
                              step="0.000001"
                              value={currency.manualRate}
                              onChange={(e) =>
                                updateCurrencyRate(
                                  currency.code,
                                  parseFloat(e.target.value) || 1
                                )
                              }
                              className="w-24 border-slate-700 bg-slate-800 text-white"
                            />
                            <span className="text-sm text-slate-400">
                              {currency.code}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCurrency(currency.code)}
                            className="text-slate-400 hover:bg-red-500/10 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {currency.code === settings.baseCurrency && (
                        <span className="text-xs text-emerald-400">
                          {t('settings.currencies.base')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Categories */}
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20">
                  <Tag className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <CardTitle className="text-white">
                    {t('settings.categories.title')}
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    {t('settings.categories.description')}
                  </CardDescription>
                </div>
              </div>
              <Button
                onClick={() => setShowCategoryDialog(true)}
                size="sm"
                className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-600 hover:to-blue-600"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('settings.categories.add')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="py-4 text-center text-slate-400">
                {t('settings.categories.empty')}
              </p>
            ) : (
              <div className="space-y-6">
                {/* Income Categories */}
                {categoriesByType.income.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-emerald-400">
                      {t('transactions.types.income')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {categoriesByType.income.map((category) => (
                        <div
                          key={category.id}
                          className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2"
                        >
                          <span className="text-slate-300">{category.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingCategory(category)}
                            className="h-5 w-5 text-slate-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expense Categories */}
                {categoriesByType.expense.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-red-400">
                      {t('transactions.types.expense')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {categoriesByType.expense.map((category) => (
                        <div
                          key={category.id}
                          className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2"
                        >
                          <span className="text-slate-300">{category.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingCategory(category)}
                            className="h-5 w-5 text-slate-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Investment Categories */}
                {categoriesByType.investment.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-blue-400">
                      {t('transactions.types.investment')}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {categoriesByType.investment.map((category) => (
                        <div
                          key={category.id}
                          className="group flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2"
                        >
                          <span className="text-slate-300">{category.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingCategory(category)}
                            className="h-5 w-5 text-slate-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Initial Balance */}
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-white">
                  {t('settings.initialBalance.title')}
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {t('settings.initialBalance.description')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Personal Account */}
            {personalAccount && (
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 p-3">
                <Label className="text-slate-300">
                  {t('settings.initialBalance.personalAccount')}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={personalInitialBalance}
                    onChange={(e) => setPersonalInitialBalance(e.target.value)}
                    placeholder={t('settings.initialBalance.placeholder')}
                    className="w-36 border-slate-700 bg-slate-800 text-white text-right"
                  />
                  <Button
                    size="sm"
                    onClick={handleSavePersonalInitialBalance}
                    disabled={savingInitialBalance === 'personal'}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            )}
            {/* Business accounts */}
            {businesses.map((biz) => (
              <div key={biz.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/50 p-3">
                <Label className="text-slate-300">
                  {t('settings.initialBalance.business', { name: biz.name })}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={businessInitialBalances[biz.id] ?? '0'}
                    onChange={(e) =>
                      setBusinessInitialBalances((prev) => ({
                        ...prev,
                        [biz.id]: e.target.value,
                      }))
                    }
                    placeholder={t('settings.initialBalance.placeholder')}
                    className="w-36 border-slate-700 bg-slate-800 text-white text-right"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleSaveBusinessInitialBalance(biz.id)}
                    disabled={savingInitialBalance === biz.id}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-red-500/20 to-rose-500/20">
                <Database className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <CardTitle className="text-white">
                  {t('settings.data.title')}
                </CardTitle>
                <CardDescription className="text-slate-400">
                  {t('settings.data.description')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={handleExport}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('settings.data.export')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowResetDialog(true)}
                className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('settings.data.reset')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Currency Dialog */}
      <Dialog open={showCurrencyDialog} onOpenChange={setShowCurrencyDialog}>
        <DialogContent className="border-slate-800 bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              {t('settings.currencies.addTitle')}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {t('settings.currencies.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">
                {t('settings.currencies.selectCurrency')}
              </Label>
              <Select value={newCurrencyCode} onValueChange={setNewCurrencyCode}>
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue placeholder={t('settings.currencies.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-900">
                  {COMMON_CURRENCIES.filter(
                    (c) => !currencies.some((ec) => ec.code === c.code)
                  ).map((currency) => (
                    <SelectItem
                      key={currency.code}
                      value={currency.code}
                      className="text-slate-300 focus:bg-slate-800 focus:text-white"
                    >
                      {currency.symbol} {currency.code} - {currency.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">
                {t('settings.currencies.exchangeRate')} (1 {settings.baseCurrency} =)
              </Label>
              <Input
                type="number"
                step="0.000001"
                value={newCurrencyRate}
                onChange={(e) => setNewCurrencyRate(e.target.value)}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCurrencyDialog(false)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleAddCurrency}
                disabled={!newCurrencyCode}
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
              >
                {t('settings.currencies.add')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <CategoryDialog
        open={showCategoryDialog}
        onOpenChange={setShowCategoryDialog}
        onSubmit={handleAddCategory}
      />

      {/* Delete Category Confirmation */}
      <AlertDialog
        open={!!deletingCategory}
        onOpenChange={() => setDeletingCategory(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('settings.categories.deleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('settings.categories.deleteDescription', { name: deletingCategory?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Confirmation */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('settings.data.resetTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('settings.data.resetDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('settings.data.confirmReset')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
