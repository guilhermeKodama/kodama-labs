'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { Switch } from '@/components/ui/switch';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency, localeForCurrency } from '@/lib/utils/format';
import {
  buildPhaseShape,
  computeFireNumber,
  depletionFireNumber,
  monthsUntilYear,
  resolvePhases,
  solveBaseContributionForDate,
  toMonthlyRate,
  toRealReturn,
  type PhaseProfile,
  type WithdrawalStrategy,
} from '@/lib/fire';
import type { FireGoalInput, FireGoalResponse } from '@/lib/store/fire-store';

interface SuggestedDefaults {
  currentInvested: number;
  currentMonthlyExpenses: number;
  suggestedMonthlyContribution: number;
}

interface FirePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: FireGoalResponse | null;
  suggested: SuggestedDefaults;
  baseCurrency: string;
  locale: string;
  isSaving?: boolean;
  onSubmit: (input: FireGoalInput) => void;
}

const PROFILES: string[] = ['front_loaded', 'constant', 'back_loaded', 'custom'];
const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function FirePlanDialog(props: FirePlanDialogProps) {
  const { open, onOpenChange } = props;
  const t = useTranslations('fire.form');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{t('title')}</DialogTitle>
          <DialogDescription className="text-slate-400">{t('description')}</DialogDescription>
        </DialogHeader>
        {/* Radix unmounts content on close, so the form re-initializes from props each open. */}
        <FirePlanForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function FirePlanForm({
  initial,
  suggested,
  baseCurrency,
  locale,
  isSaving,
  onSubmit,
  onOpenChange,
}: FirePlanDialogProps) {
  const t = useTranslations('fire.form');
  const tPlan = useTranslations('fire.planning');
  const tCommon = useTranslations('common');
  const currentYear = new Date().getFullYear();
  const moneyLocale = localeForCurrency(baseCurrency);

  const [name, setName] = useState(() => initial?.name ?? '');
  const [targetIncome, setTargetIncome] = useState<number>(() =>
    initial ? initial.targetMonthlyIncome : suggested.currentMonthlyExpenses || 10000
  );
  const [swr, setSwr] = useState(() => String(initial ? initial.safeWithdrawalRate * 100 : 3.5));
  const [nominalReturn, setNominalReturn] = useState(() =>
    String(initial ? initial.nominalAnnualReturn * 100 : 10)
  );
  const [inflation, setInflation] = useState(() =>
    String(initial ? initial.annualInflation * 100 : 4.5)
  );
  const [monthlyIncome, setMonthlyIncome] = useState<number>(() => initial?.monthlyIncome ?? 0);
  const [planningMode, setPlanningMode] = useState<'by_date' | 'by_contribution'>(() =>
    initial?.planningMode === 'by_contribution' ? 'by_contribution' : 'by_date'
  );
  const [targetYear, setTargetYear] = useState(() =>
    String(initial?.targetYear ?? currentYear + 15)
  );
  const [profile, setProfile] = useState<PhaseProfile>(() =>
    initial && PROFILES.includes(initial.phaseProfile)
      ? (initial.phaseProfile as PhaseProfile)
      : 'front_loaded'
  );
  const [baseContribution, setBaseContribution] = useState<number>(() =>
    initial ? initial.phases[0]?.monthlyContribution ?? 0 : suggested.suggestedMonthlyContribution || 1000
  );
  const [customPhases, setCustomPhases] = useState<[number, number, number]>(() => [
    initial?.phases[0]?.monthlyContribution ?? 0,
    initial?.phases[1]?.monthlyContribution ?? 0,
    initial?.phases[2]?.monthlyContribution ?? 0,
  ]);
  const [barista, setBarista] = useState<number>(() => initial?.baristaMonthlyIncome ?? 0);
  const [currentAge, setCurrentAge] = useState(() =>
    initial?.currentAge != null ? String(initial.currentAge) : ''
  );
  const [retirementAge, setRetirementAge] = useState(() =>
    initial?.retirementAge != null ? String(initial.retirementAge) : ''
  );
  const [lifeExpectancyAge, setLifeExpectancyAge] = useState(() =>
    String(initial?.lifeExpectancyAge ?? 95)
  );
  const [volatility, setVolatility] = useState(() => String((initial?.annualVolatility ?? 0.12) * 100));
  const [includeBusiness, setIncludeBusiness] = useState(() => initial?.includeBusinessInvestments ?? false);
  const [strategy, setStrategy] = useState<WithdrawalStrategy>(() =>
    initial?.withdrawalStrategy === 'depletion' ? 'depletion' : 'perpetuity'
  );

  const strategies: { key: WithdrawalStrategy; title: string; hint: string }[] = [
    { key: 'perpetuity', title: t('strategyPerpetuity'), hint: t('strategyPerpetuityHint') },
    { key: 'depletion', title: t('strategyDepletion'), hint: t('strategyDepletionHint') },
  ];

  const fmt = (n: number) => formatCurrency(n, baseCurrency, locale);
  const phaseLabels = [t('phaseShort'), t('phaseMedium'), t('phaseLong')];
  const previewPhases =
    profile === 'custom' ? null : resolvePhases(buildPhaseShape(profile), baseContribution);

  // In "by date" mode the contribution is an OUTPUT: solve the base contribution
  // (and its phases) needed to hit the target year — mirroring the server. Custom
  // shapes don't apply here, so the math falls back to a preset shape.
  const byDateProfile: PhaseProfile = profile === 'custom' ? 'front_loaded' : profile;
  const realAnnualReturn = toRealReturn(num(nominalReturn) / 100, num(inflation) / 100);
  const monthlyRealReturn = toMonthlyRate(realAnnualReturn);
  const targetMonths = monthsUntilYear(Number(targetYear) || currentYear, new Date());
  const horizonMonths =
    currentAge && Number(lifeExpectancyAge) > Number(currentAge)
      ? Math.ceil((Number(lifeExpectancyAge) - Number(currentAge)) * 12)
      : null;
  const solveTarget =
    strategy === 'depletion' && horizonMonths != null
      ? depletionFireNumber(
          {
            targetMonthlyIncome: targetIncome,
            realAnnualReturn,
            safeWithdrawalRate: num(swr) / 100,
          },
          num(volatility) / 100,
          Math.max(0, horizonMonths - targetMonths)
        )
      : computeFireNumber(targetIncome * 12, num(swr) / 100);
  const requiredBase =
    planningMode === 'by_date'
      ? solveBaseContributionForDate({
          currentInvested: suggested.currentInvested,
          monthlyRealReturn,
          fireNumber: solveTarget,
          targetMonths,
          shape: buildPhaseShape(byDateProfile),
        })
      : null;
  const requiredPhases =
    requiredBase != null && Number.isFinite(requiredBase)
      ? resolvePhases(buildPhaseShape(byDateProfile), requiredBase)
      : null;

  const handleSubmit = () => {
    const phases =
      planningMode === 'by_date'
        ? (requiredPhases ?? resolvePhases(buildPhaseShape(byDateProfile), 0))
        : profile === 'custom'
          ? [
              { fromMonth: 0, toMonth: 36, monthlyContribution: customPhases[0] },
              { fromMonth: 36, toMonth: 120, monthlyContribution: customPhases[1] },
              { fromMonth: 120, toMonth: null, monthlyContribution: customPhases[2] },
            ]
          : resolvePhases(buildPhaseShape(profile), baseContribution);

    onSubmit({
      name: name.trim() || null,
      targetMonthlyIncome: targetIncome,
      safeWithdrawalRate: num(swr) / 100,
      nominalAnnualReturn: num(nominalReturn) / 100,
      annualInflation: num(inflation) / 100,
      monthlyIncome: monthlyIncome > 0 ? monthlyIncome : null,
      planningMode,
      targetYear: targetYear ? Number(targetYear) : null,
      phaseProfile: planningMode === 'by_date' ? byDateProfile : profile,
      phases,
      baristaMonthlyIncome: barista > 0 ? barista : null,
      coastStopYear: null,
      leanMultiplier: 0.7,
      fatMultiplier: 1.6,
      includeEntityBalances: false,
      includeBusinessInvestments: includeBusiness,
      currency: baseCurrency,
      currentAge: currentAge ? Number(currentAge) : null,
      retirementAge: retirementAge ? Number(retirementAge) : null,
      lifeExpectancyAge: lifeExpectancyAge ? Number(lifeExpectancyAge) : 95,
      annualVolatility: num(volatility) / 100,
      milestones: initial?.milestones ?? [],
      withdrawalStrategy: strategy,
    });
  };

  return (
    <>
      <div className="space-y-5 py-2">
        {/* Target income — the centerpiece */}
        <div className="space-y-2">
          <Label className="text-slate-300">{t('targetMonthlyIncome')}</Label>
          <CurrencyInput
            value={targetIncome}
            onChange={setTargetIncome}
            locale={moneyLocale}
            className="border-slate-700 bg-slate-950 text-white"
          />
          <p className="text-xs text-slate-500">{t('targetMonthlyIncomeHint')}</p>
          {suggested.currentMonthlyExpenses > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTargetIncome(suggested.currentMonthlyExpenses)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              {t('useCurrentExpenses', { amount: fmt(suggested.currentMonthlyExpenses) })}
            </Button>
          )}
        </div>

        {/* Current age — needed for the whole-life projection (accumulate → withdraw) */}
        <div className="space-y-2">
          <Label className="text-slate-300">{t('currentAge')}</Label>
          <Input
            type="number"
            value={currentAge}
            onChange={(e) => setCurrentAge(e.target.value)}
            placeholder="40"
            className="border-slate-700 bg-slate-950 text-white"
          />
          <p className="text-xs text-slate-500">{t('currentAgeHint')}</p>
        </div>

        {/* Retirement strategy — the choice that sets how big the number must be */}
        <div className="space-y-2">
          <Label className="text-slate-300">{t('strategy')}</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {strategies.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStrategy(s.key)}
                className={cn(
                  'rounded-lg border p-3 text-left transition',
                  strategy === s.key
                    ? 'border-emerald-500/60 bg-emerald-500/10'
                    : 'border-slate-700 bg-slate-950 hover:border-slate-600'
                )}
              >
                <p className="text-sm font-semibold text-white">{s.title}</p>
                <p className="mt-1 text-xs text-slate-400">{s.hint}</p>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{t('strategyHint')}</p>
        </div>

        {/* Planning mode (+ target year only when planning by date) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={cn('space-y-2', planningMode === 'by_date' ? 'sm:col-span-2' : 'sm:col-span-3')}>
            <Label className="text-slate-300">{t('planningMode')}</Label>
            <Select
              value={planningMode}
              onValueChange={(v) => {
                const mode = v as typeof planningMode;
                setPlanningMode(mode);
                if (mode === 'by_date' && profile === 'custom') setProfile('front_loaded');
              }}
            >
              <SelectTrigger className="w-full border-slate-700 bg-slate-950 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="by_date">{tPlan('byDate')}</SelectItem>
                <SelectItem value="by_contribution">{tPlan('byContribution')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {planningMode === 'by_date' && (
            <div className="space-y-2">
              <Label className="text-slate-300">{t('targetYear')}</Label>
              <Input
                type="number"
                value={targetYear}
                onChange={(e) => setTargetYear(e.target.value)}
                className="border-slate-700 bg-slate-950 text-white"
              />
            </div>
          )}
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          {planningMode === 'by_date' ? tPlan('byDateHint') : tPlan('byContributionHint')}
        </p>

        {/* Contribution: an INPUT when planning by contribution, the prescribed
            OUTPUT when planning by date. */}
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="space-y-2">
            <Label className="text-slate-300">{t('phaseProfile')}</Label>
            <Select
              value={planningMode === 'by_date' ? byDateProfile : profile}
              onValueChange={(v) => setProfile(v as PhaseProfile)}
            >
              <SelectTrigger className="border-slate-700 bg-slate-950 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="front_loaded">{t('profileFrontLoaded')}</SelectItem>
                <SelectItem value="constant">{t('profileConstant')}</SelectItem>
                <SelectItem value="back_loaded">{t('profileBackLoaded')}</SelectItem>
                {planningMode === 'by_contribution' && (
                  <SelectItem value="custom">{t('profileCustom')}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              {planningMode === 'by_date' ? t('profileHintByDate') : t('profileHintByContribution')}
            </p>
          </div>

          {planningMode === 'by_date' ? (
            requiredPhases ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t('requiredContributionLabel')}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {requiredPhases.map((p, i) => (
                    <div key={i} className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">{phaseLabels[i]}</p>
                      <p className="text-sm font-semibold text-emerald-300">{fmt(p.monthlyContribution)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-400">{t('requiredUnreachable')}</p>
            )
          ) : profile !== 'custom' ? (
            <>
              <div className="space-y-2">
                <Label className="text-slate-300">{t('monthlyContribution')}</Label>
                <CurrencyInput
                  value={baseContribution}
                  onChange={setBaseContribution}
                  locale={moneyLocale}
                  className="border-slate-700 bg-slate-950 text-white"
                />
              </div>
              {previewPhases && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  {previewPhases.map((p, i) => (
                    <div key={i} className="rounded-md bg-slate-800/60 p-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">{phaseLabels[i]}</p>
                      <p className="text-sm font-semibold text-white">{fmt(p.monthlyContribution)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1">
                  <Label className="text-[11px] uppercase tracking-wide text-slate-500">{phaseLabels[i]}</Label>
                  <CurrencyInput
                    value={customPhases[i]}
                    onChange={(v) => {
                      const next = [...customPhases] as [number, number, number];
                      next[i] = v;
                      setCustomPhases(next);
                    }}
                    locale={moneyLocale}
                    className="border-slate-700 bg-slate-950 text-white"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Advanced assumptions */}
        <details className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">{t('advanced')}</summary>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-slate-300">{t('safeWithdrawalRate')}</Label>
                <Input type="number" step="0.1" value={swr} onChange={(e) => setSwr(e.target.value)} className="border-slate-700 bg-slate-950 text-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300">{t('nominalAnnualReturn')}</Label>
                <Input type="number" step="0.1" value={nominalReturn} onChange={(e) => setNominalReturn(e.target.value)} className="border-slate-700 bg-slate-950 text-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300">{t('annualInflation')}</Label>
                <Input type="number" step="0.1" value={inflation} onChange={(e) => setInflation(e.target.value)} className="border-slate-700 bg-slate-950 text-white" />
              </div>
            </div>
            <p className="text-xs text-slate-500">{t('safeWithdrawalRateHint')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-slate-300">{t('retirementAge')}</Label>
                <Input type="number" value={retirementAge} onChange={(e) => setRetirementAge(e.target.value)} placeholder={t('retirementAgePlaceholder')} className="border-slate-700 bg-slate-950 text-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300">{t('lifeExpectancyAge')}</Label>
                <Input type="number" value={lifeExpectancyAge} onChange={(e) => setLifeExpectancyAge(e.target.value)} className="border-slate-700 bg-slate-950 text-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300">{t('annualVolatility')}</Label>
                <Input type="number" step="0.5" value={volatility} onChange={(e) => setVolatility(e.target.value)} className="border-slate-700 bg-slate-950 text-white" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-slate-300">{t('monthlyIncome')}</Label>
                <CurrencyInput value={monthlyIncome} onChange={setMonthlyIncome} locale={moneyLocale} className="border-slate-700 bg-slate-950 text-white" />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300">{t('baristaMonthlyIncome')}</Label>
                <CurrencyInput value={barista} onChange={setBarista} locale={moneyLocale} className="border-slate-700 bg-slate-950 text-white" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300">{t('name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} className="border-slate-700 bg-slate-950 text-white" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-300">{t('includeBusinessInvestments')}</p>
                <p className="text-xs text-slate-500">{t('includeBusinessInvestmentsHint')}</p>
              </div>
              <Switch checked={includeBusiness} onCheckedChange={setIncludeBusiness} />
            </div>
          </div>
        </details>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          {tCommon('cancel')}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSaving}
          className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
        >
          {isSaving ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
    </>
  );
}
