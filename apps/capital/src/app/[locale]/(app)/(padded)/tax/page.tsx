'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Receipt,
  Download,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Calculator,
  Settings,
  Building2,
  User,
} from 'lucide-react';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { TaxSummaryCard } from '@/components/cards/tax-summary-card';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useTransactionStore,
  useBusinessStore,
  useSettingsStore,
} from '@/lib/store';
import {
  calculateAllTaxSummaries,
  calculateDeductionsByCategory,
  calculateIncomeByCategory,
  downloadTaxReport,
} from '@/lib/utils/tax';
import { formatCurrency } from '@/lib/utils/format';
import { toast } from 'sonner';

export default function TaxPage() {
  const t = useTranslations();
  const { transactions } = useTransactionStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount, taxSettings, setEntityTaxRate } = useSettingsStore();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(taxSettings.taxYear || currentYear);
  const [selectedTab, setSelectedTab] = useState<'summary' | 'settings'>('summary');

  // Build entity list
  const entities = useMemo(() => {
    const list: Array<{ id: string; name: string; type: 'business' | 'personal' }> = [];
    
    businesses.forEach((b) => {
      list.push({ id: b.id, name: b.name, type: 'business' });
    });
    
    if (personalAccount) {
      list.push({ id: personalAccount.id, name: t('common.personal'), type: 'personal' });
    }
    
    return list;
  }, [businesses, personalAccount, t]);

  // Calculate tax summaries
  const taxSummaries = useMemo(() => {
    return calculateAllTaxSummaries(transactions, entities, {
      ...taxSettings,
      taxYear: selectedYear,
    });
  }, [transactions, entities, taxSettings, selectedYear]);

  // Calculate totals
  const totals = useMemo(() => {
    return taxSummaries.reduce(
      (acc, summary) => ({
        totalIncome: acc.totalIncome + summary.totalIncome,
        totalDeductible: acc.totalDeductible + summary.totalDeductible,
        taxableIncome: acc.taxableIncome + summary.taxableIncome,
        estimatedTax: acc.estimatedTax + summary.estimatedTax,
      }),
      { totalIncome: 0, totalDeductible: 0, taxableIncome: 0, estimatedTax: 0 }
    );
  }, [taxSummaries]);

  // Get deductions and income by category
  const deductionsByCategory = useMemo(() => {
    return calculateDeductionsByCategory(transactions, selectedYear);
  }, [transactions, selectedYear]);

  const incomeByCategory = useMemo(() => {
    return calculateIncomeByCategory(transactions, selectedYear);
  }, [transactions, selectedYear]);

  // Available years
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    transactions.forEach((t) => {
      years.add(new Date(t.date).getFullYear());
    });
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const handleExportReport = () => {
    downloadTaxReport(taxSummaries, deductionsByCategory, incomeByCategory, selectedYear);
    toast.success(t('tax.toast.exported'));
  };

  const handleTaxRateChange = (entityId: string, rate: string) => {
    const numRate = parseFloat(rate) || 0;
    setEntityTaxRate(entityId, Math.max(0, Math.min(100, numRate)));
  };

  return (
    <>
      <Header
        title={t('tax.title')}
        description={t('tax.subtitle')}
      />

      {/* Year selector and export */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedYear(selectedYear - 1)}
            disabled={selectedYear <= Math.min(...availableYears, currentYear - 5)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[100px] text-center text-lg font-semibold text-white">
            {selectedYear}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSelectedYear(selectedYear + 1)}
            disabled={selectedYear >= currentYear}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          onClick={handleExportReport}
          className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <Download className="mr-2 h-4 w-4" />
          {t('tax.export.button')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('tax.summary.totalIncome')}
          value={totals.totalIncome}
          currency={settings.baseCurrency}
          icon={TrendingUp}
          variant="income"
        />
        <SummaryCard
          title={t('tax.summary.totalDeductions')}
          value={totals.totalDeductible}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="investment"
        />
        <SummaryCard
          title={t('tax.summary.taxableIncome')}
          value={totals.taxableIncome}
          currency={settings.baseCurrency}
          icon={Calculator}
          variant="default"
        />
        <SummaryCard
          title={t('tax.summary.estimatedTax')}
          value={totals.estimatedTax}
          currency={settings.baseCurrency}
          icon={Receipt}
          variant="expense"
        />
      </div>

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as 'summary' | 'settings')}>
        <TabsList className="mb-6 border-slate-800 bg-slate-900/50">
          <TabsTrigger
            value="summary"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            {t('tax.tabs.summary')}
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
          >
            <Settings className="mr-2 h-4 w-4" />
            {t('tax.tabs.settings')}
          </TabsTrigger>
        </TabsList>

        {/* Summary Tab */}
        <TabsContent value="summary" className="space-y-6">
          {/* Entity Tax Summaries */}
          <div className="grid gap-4 lg:grid-cols-2">
            {taxSummaries.map((summary) => (
              <TaxSummaryCard
                key={summary.entityId}
                summary={summary}
                currency={settings.baseCurrency}
                isPersonal={summary.entityId === personalAccount?.id}
              />
            ))}
          </div>

          {/* Deductions by Category */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('tax.deductionsByCategory')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(deductionsByCategory).length > 0 ? (
                <div className="rounded-lg border border-slate-800 bg-slate-900/50">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400">{t('tax.table.category')}</TableHead>
                        <TableHead className="text-right text-slate-400">{t('tax.table.amount')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(deductionsByCategory).map(([category, amount]) => (
                        <TableRow key={category} className="border-slate-800 hover:bg-slate-800/50">
                          <TableCell className="font-medium text-white">{category}</TableCell>
                          <TableCell className="text-right text-blue-400">
                            {formatCurrency(amount, settings.baseCurrency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="py-8 text-center text-slate-400">{t('tax.noDeductions')}</p>
              )}
            </CardContent>
          </Card>

          {/* Income by Category */}
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('tax.incomeByCategory')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(incomeByCategory).length > 0 ? (
                <div className="rounded-lg border border-slate-800 bg-slate-900/50">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400">{t('tax.table.category')}</TableHead>
                        <TableHead className="text-right text-slate-400">{t('tax.table.amount')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(incomeByCategory).map(([category, amount]) => (
                        <TableRow key={category} className="border-slate-800 hover:bg-slate-800/50">
                          <TableCell className="font-medium text-white">{category}</TableCell>
                          <TableCell className="text-right text-emerald-400">
                            {formatCurrency(amount, settings.baseCurrency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="py-8 text-center text-slate-400">{t('tax.noIncome')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">{t('tax.settings.title')}</CardTitle>
              <CardDescription className="text-slate-400">
                {t('tax.settings.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {entities.map((entity) => {
                const currentRate = taxSettings.entityTaxRates[entity.id] || 0;
                const Icon = entity.type === 'personal' ? User : Building2;

                return (
                  <div
                    key={entity.id}
                    className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
                        <Icon className="h-5 w-5 text-slate-300" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{entity.name}</p>
                        <p className="text-xs text-slate-500">
                          {entity.type === 'personal'
                            ? t('tax.settings.personalAccount')
                            : t('tax.settings.business')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`tax-rate-${entity.id}`} className="sr-only">
                        {t('tax.settings.taxRate')}
                      </Label>
                      <Input
                        id={`tax-rate-${entity.id}`}
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={currentRate}
                        onChange={(e) => handleTaxRateChange(entity.id, e.target.value)}
                        className="w-24 border-slate-700 bg-slate-800 text-right text-white"
                      />
                      <span className="text-slate-400">%</span>
                    </div>
                  </div>
                );
              })}

              {entities.length === 0 && (
                <p className="py-8 text-center text-slate-400">{t('tax.settings.noEntities')}</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">{t('tax.settings.taxTips.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-400">
              <p>{t('tax.settings.taxTips.tip1')}</p>
              <p>{t('tax.settings.taxTips.tip2')}</p>
              <p>{t('tax.settings.taxTips.tip3')}</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
