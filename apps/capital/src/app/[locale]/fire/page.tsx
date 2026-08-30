'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import {
  Flame,
  Target,
  Wallet,
  Coins,
  CalendarClock,
  Sparkles,
  Info,
  LayoutGrid,
  LineChart as LineChartIcon,
  Flag,
  History,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useFireStore } from '@/lib/store';
import { useDialogForm } from '@/hooks/use-dialog-form';
import type { FireGoalInput, FireGoalResponse, MilestoneInput } from '@/lib/store/fire-store';
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils/format';
import { buildAssumptions } from '@/lib/fire/adapter';
import {
  buildLifecycle,
  runMonteCarlo,
  evaluateMilestones,
  toMonthlyRate,
  MC_SEED,
  MC_TRIALS,
  type MilestoneDef,
  type WithdrawalStrategy,
} from '@/lib/fire';
import {
  FirePlanDialog,
  FireGapAlert,
  FireHistoryChart,
  FireLifecycleChart,
  FireSuccessGauge,
  FireBreakdownPanel,
  FireMilestonesPanel,
  FireMilestoneDialog,
  FireSnapshotList,
  FireSnapshotDialog,
  type MilestoneRow,
  type HistoryDatum,
  type SnapshotRow,
  type SnapshotEdit,
} from '@/components/fire';

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'text-slate-400',
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-400">{label}</p>
            <p className="text-xl font-bold text-white">{value}</p>
            {sub && <p className="text-xs text-slate-500">{sub}</p>}
          </div>
          <Icon className={`h-5 w-5 ${accent}`} />
        </div>
      </CardContent>
    </Card>
  );
}

/** A one-line plain-language explainer shown at the top of a tab. */
function TabHelp({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2.5 text-xs text-slate-400">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
      <span>{text}</span>
    </div>
  );
}

/** Map a persisted goal back to the editable input (for milestone add/remove). */
function goalToInput(goal: FireGoalResponse, overrides: Partial<FireGoalInput> = {}): FireGoalInput {
  return {
    name: goal.name,
    targetMonthlyIncome: goal.targetMonthlyIncome,
    safeWithdrawalRate: goal.safeWithdrawalRate,
    nominalAnnualReturn: goal.nominalAnnualReturn,
    annualInflation: goal.annualInflation,
    monthlyIncome: goal.monthlyIncome,
    planningMode: goal.planningMode as FireGoalInput['planningMode'],
    targetYear: goal.targetYear,
    phaseProfile: goal.phaseProfile as FireGoalInput['phaseProfile'],
    phases: goal.phases,
    baristaMonthlyIncome: goal.baristaMonthlyIncome,
    coastStopYear: goal.coastStopYear,
    leanMultiplier: goal.leanMultiplier,
    fatMultiplier: goal.fatMultiplier,
    includeEntityBalances: goal.includeEntityBalances,
    includeBusinessInvestments: goal.includeBusinessInvestments,
    currency: goal.currency,
    currentAge: goal.currentAge,
    retirementAge: goal.retirementAge,
    lifeExpectancyAge: goal.lifeExpectancyAge,
    annualVolatility: goal.annualVolatility,
    milestones: goal.milestones,
    withdrawalStrategy: goal.withdrawalStrategy as FireGoalInput['withdrawalStrategy'],
    ...overrides,
  };
}

export default function FirePage() {
  const t = useTranslations('fire');
  const locale = useLocale();
  const { summary, isLoading, isSaving, fetchSummary, saveGoal, recordSnapshot, upsertSnapshot, deleteSnapshot } =
    useFireStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [milestoneDialogOpen, setMilestoneDialogOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState<SnapshotEdit | null>(null);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const baseCurrency = summary?.baseCurrency ?? 'BRL';
  const fmt = useMemo(() => (n: number) => formatCurrency(n, baseCurrency, locale), [baseCurrency, locale]);
  const currentYear = new Date().getFullYear();

  // Whole-life projection + Monte Carlo + milestones — computed client-side.
  const computed = useMemo(() => {
    const goal = summary?.goal;
    if (!summary || !goal || goal.currentAge == null) return null;
    const currentInvested = summary.result?.currentInvested ?? summary.suggestedDefaults.currentInvested;
    const effectivePhases = summary.requiredContribution?.phases ?? goal.phases;
    const strategy = goal.withdrawalStrategy as WithdrawalStrategy;
    const assumptions = buildAssumptions(
      {
        targetMonthlyIncome: goal.targetMonthlyIncome,
        safeWithdrawalRate: goal.safeWithdrawalRate,
        nominalAnnualReturn: goal.nominalAnnualReturn,
        annualInflation: goal.annualInflation,
        monthlyIncome: goal.monthlyIncome,
        phases: effectivePhases,
        withdrawalStrategy: strategy,
      },
      currentInvested
    );
    // The server resolves the canonical retirement month (depletion: the MC solve;
    // perpetuity: the FIRE crossing). Pinning it here makes the chart curve,
    // retirement marker, milestones, success gauge and hero all agree.
    const opts = {
      currentAge: goal.currentAge,
      lifeExpectancyAge: goal.lifeExpectancyAge,
      retirementAge: goal.retirementAge ?? undefined,
      retirementMonthIndex: summary.result?.retirementMonthIndex,
      annualVolatility: goal.annualVolatility,
    };
    try {
      const lifecycle = buildLifecycle(assumptions, opts);
      const monteCarlo = runMonteCarlo(assumptions, {
        ...opts,
        annualVolatility: goal.annualVolatility,
        trials: MC_TRIALS,
        seed: MC_SEED,
        // Spend-down: success = "leaves a surplus" (P(net worth > 0 at the end)),
        // which is ~50% by design — the median spends down to ~0 at life expectancy.
        successCriterion: strategy === 'depletion' ? 'positive_at_end' : 'never_depleted',
      });
      const annualExpenses = goal.targetMonthlyIncome * 12;
      // The strategy-aware target (the perpetuity number, or the smaller spend-down
      // number) is authoritative — it drives the hero, the chart line and the
      // milestone ladder so everything agrees.
      const fireNumber = summary.result?.fireNumber ?? lifecycle.fireNumber;
      // Milestones are fractions of that number; at 100% you're independent. Under
      // perpetuity, "X% of the number" == "passive income covers X% of the income
      // you want" (algebraically the same), so the label stays motivating.
      const coverage: MilestoneDef[] = [];
      if (fireNumber > 0) {
        for (const pct of [10, 25, 50, 75]) {
          coverage.push({
            id: `_cover${pct}`,
            name:
              strategy === 'depletion'
                ? t('milestones.coverPctTarget', { pct })
                : t('milestones.coverPct', { pct }),
            type: 'net_worth_absolute',
            value: (pct / 100) * fireNumber,
          });
        }
        coverage.push({ id: '_cover100', name: t('milestones.coverAll'), type: 'net_worth_absolute', value: fireNumber });
      }
      const builtins: MilestoneDef[] = [...coverage, { id: '_coast', name: t('milestones.coast'), type: 'coast', value: 0 }];
      const customDefs = goal.milestones as MilestoneDef[];
      const customIds = new Set(customDefs.map((m) => m.id));
      const evals = evaluateMilestones([...builtins, ...customDefs], lifecycle.points, {
        annualExpenses,
        swr: goal.safeWithdrawalRate,
        currentInvested,
        fireNumber,
        monthlyRealReturn: toMonthlyRate(assumptions.realAnnualReturn),
        retirementMonthIndex: lifecycle.retirementMonthIndex,
        currentAge: goal.currentAge,
      });
      const milestoneRows: MilestoneRow[] = evals.map((m) => ({
        id: m.id,
        name: m.name,
        reachedNow: m.reachedNow,
        achievedAge: m.achievedAge,
        progress: m.progress,
        isCustom: customIds.has(m.id),
      }));

      // The next net-worth milestone you haven't reached yet (lowest threshold).
      const upcoming = evals
        .filter((m) => !m.reachedNow && m.targetNetWorth != null)
        .sort((a, b) => (a.targetNetWorth as number) - (b.targetNetWorth as number));
      const next = upcoming[0];
      const nextMilestone = next
        ? {
            name: next.name,
            remaining: Math.max(0, (next.targetNetWorth as number) - currentInvested),
            age: next.achievedAge,
          }
        : null;
      // Markers to plot on the projection curve.
      const chartMilestones = evals
        .filter((m) => m.achievedAge != null)
        .map((m) => ({
          name: m.name,
          age: m.achievedAge as number,
          reachedNow: m.reachedNow,
          isNext: next ? m.id === next.id : false,
        }));

      return {
        lifecycle,
        monteCarlo,
        milestoneRows,
        chartMilestones,
        nextMilestone,
        fireNumber,
        strategy,
        currentAge: goal.currentAge,
      };
    } catch {
      return null;
    }
  }, [summary, t]);

  const handleSavePlan = async (input: FireGoalInput) => {
    const saved = await saveGoal(input);
    if (saved) {
      setDialogOpen(false);
      toast.success(t('planSaved'));
    } else {
      toast.error(t('planSaveFailed'));
    }
  };
  const handleRecordSnapshot = async () => {
    setRecording(true);
    const snap = await recordSnapshot();
    setRecording(false);
    if (snap) toast.success(t('snapshotRecorded'));
    else toast.error(t('snapshotFailed'));
  };

  // Actual progress (snapshots) vs. the initial projection at each month.
  const progressData = useMemo<HistoryDatum[]>(() => {
    if (!summary) return [];
    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1;
    const lifePts = computed?.lifecycle.points;
    const cAge = computed?.currentAge;
    return summary.history.map((s) => {
      const yr = Math.floor(s.period / 100);
      const mo = s.period % 100;
      const label = `${String(mo).padStart(2, '0')}/${String(yr).slice(2)}`;
      let projected: number | null = null;
      if (lifePts && cAge != null) {
        const age = cAge + ((yr - nowY) * 12 + (mo - nowM)) / 12;
        let best = lifePts[0];
        for (const p of lifePts) if (Math.abs(p.age - age) < Math.abs(best.age - age)) best = p;
        projected = best.netWorth;
      }
      return { label, actual: s.currentInvested, projected };
    });
  }, [summary, computed]);
  const milestoneForm = useDialogForm({
    onOpenChange: setMilestoneDialogOpen,
    action: (m: MilestoneInput) =>
      summary?.goal
        ? saveGoal(goalToInput(summary.goal, { milestones: [...summary.goal.milestones, m] }))
        : Promise.resolve(null),
    onSuccess: () => toast.success(t('milestones.added')),
    errorMessage: t('milestones.addError'),
  });
  const handleRemoveMilestone = async (id: string) => {
    if (!summary?.goal) return;
    await saveGoal(goalToInput(summary.goal, { milestones: summary.goal.milestones.filter((x) => x.id !== id) }));
  };
  const handleAddSnapshot = () => {
    setEditingSnapshot(null);
    setSnapshotDialogOpen(true);
  };
  const handleEditSnapshot = (s: SnapshotRow) => {
    setEditingSnapshot({ period: s.period, currentInvested: s.currentInvested });
    setSnapshotDialogOpen(true);
  };
  const snapshotForm = useDialogForm({
    onOpenChange: setSnapshotDialogOpen,
    action: (data: { period: number; currentInvested: number }) =>
      upsertSnapshot(data.period, { currentInvested: data.currentInvested }),
    onSuccess: () => toast.success(t('history.snapshotSaved')),
    errorMessage: t('snapshotFailed'),
  });
  const handleSubmitSnapshot = (period: number, currentInvested: number) =>
    snapshotForm.submit({ period, currentInvested });
  const handleDeleteSnapshot = async (period: number) => {
    const ok = await deleteSnapshot(period);
    if (ok) toast.success(t('snapshotDeleted'));
    else toast.error(t('snapshotFailed'));
  };

  // First load
  if (!summary && isLoading) {
    return (
      <AppShell>
        <Header title={t('title')} description={t('subtitle')} />
        <div className="flex h-64 items-center justify-center text-slate-500">…</div>
      </AppShell>
    );
  }

  // Empty state — no plan yet
  if (summary && !summary.hasGoal) {
    return (
      <AppShell>
        <Header title={t('title')} description={t('subtitle')} />
        <Card className="border-slate-800 bg-slate-900/50">
          <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
              <Flame className="h-7 w-7 text-emerald-400" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-lg font-semibold text-white">{t('empty.title')}</h2>
              <p className="text-sm text-slate-400">{t('empty.description')}</p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600">
              {t('empty.cta')}
            </Button>
          </CardContent>
        </Card>
        <FirePlanDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={null}
          suggested={summary.suggestedDefaults}
          baseCurrency={baseCurrency}
          locale={locale}
          isSaving={isSaving}
          onSubmit={handleSavePlan}
        />
      </AppShell>
    );
  }

  if (!summary || !summary.result) {
    return (
      <AppShell>
        <Header title={t('title')} description={t('subtitle')} />
      </AppShell>
    );
  }

  const { result, gap, requiredContribution, goal, breakdown } = summary;
  const progressPct = Math.min(100, Math.max(0, result.progress * 100));
  const projectedDate = result.projectedFireDate ? formatDate(result.projectedFireDate, 'MMM yyyy') : t('cards.never');
  const phaseLabels = [t('form.phaseShort'), t('form.phaseMedium'), t('form.phaseLong')];

  const needsAge = (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <CalendarClock className="h-8 w-8 text-cyan-400" />
        <p className="max-w-sm text-sm text-slate-400">{t('projection.needsAge')}</p>
        <Button onClick={() => setDialogOpen(true)} variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
          {t('editPlan')}
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <AppShell>
      <Header
        title={t('title')}
        description={t('subtitle')}
        action={{ label: t('editPlan'), onClick: () => setDialogOpen(true), icon: Settings }}
      />

      <Tabs defaultValue="plan">
        <TabsList className="mb-6 border-slate-800 bg-slate-900/50">
          <TabsTrigger value="plan" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white">
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
            {t('tabs.plan')}
          </TabsTrigger>
          <TabsTrigger value="projection" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white">
            <LineChartIcon className="mr-1.5 h-3.5 w-3.5" />
            {t('tabs.projection')}
          </TabsTrigger>
          <TabsTrigger value="milestones" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white">
            <Flag className="mr-1.5 h-3.5 w-3.5" />
            {t('tabs.milestones')}
          </TabsTrigger>
          <TabsTrigger value="progress" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white">
            <History className="mr-1.5 h-3.5 w-3.5" />
            {t('tabs.progress')}
          </TabsTrigger>
        </TabsList>

        {/* PLAN */}
        <TabsContent value="plan" className="space-y-6">
          <TabHelp text={t('help.plan')} />
          <Card className="border-slate-800 bg-slate-900/50">
            <CardContent className="p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm text-slate-400">{t('cards.progress')}</p>
                  <p className="text-3xl font-bold text-white">{formatPercent(progressPct, locale, 1)}</p>
                </div>
                <p className="text-sm text-slate-400">
                  {result.reached ? (
                    <span className="font-semibold text-emerald-400">{t('cards.reached')} 🎉</span>
                  ) : (
                    <>
                      {fmt(result.currentInvested)} <span className="text-slate-600">/</span> {fmt(result.fireNumber)}
                    </>
                  )}
                </p>
              </div>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={t('cards.fireNumber')} value={fmt(result.fireNumber)} sub={t('cards.fireNumberSub')} icon={Target} accent="text-blue-400" />
            <MetricCard label={t('cards.invested')} value={fmt(result.currentInvested)} sub={t('cards.investedSub')} icon={Wallet} accent="text-emerald-400" />
            <MetricCard
              label={t('cards.passiveIncome')}
              value={fmt(result.currentMonthlyPassiveIncome)}
              sub={goal ? t('cards.ofTarget', { target: fmt(goal.targetMonthlyIncome) }) : undefined}
              icon={Coins}
              accent="text-amber-400"
            />
            <MetricCard label={t('cards.fireDate')} value={projectedDate} icon={CalendarClock} accent="text-cyan-400" />
          </div>

          {gap && <FireGapAlert gap={gap} baseCurrency={baseCurrency} locale={locale} />}

          {requiredContribution && (
            <Card className="border-slate-800 bg-slate-900/50">
              <CardContent className="space-y-3 p-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  {t('required.title')}
                </h3>
                {requiredContribution.baseContribution == null ? (
                  <p className="text-sm text-amber-400">{t('required.unreachable')}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {requiredContribution.phases.map((p, i) => (
                      <div key={i} className="rounded-lg bg-slate-800/60 p-3 text-center">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">{phaseLabels[i] ?? p.label}</p>
                        <p className="text-base font-semibold text-white">{fmt(p.monthlyContribution)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* PROJECTION */}
        <TabsContent value="projection" className="space-y-6">
          <TabHelp text={t('help.projection')} />
          {computed ? (
            <>
              <FireSuccessGauge probability={computed.monteCarlo.successProbability} strategy={computed.strategy} />
              <FireLifecycleChart
                mcPoints={computed.monteCarlo.points}
                lifePoints={computed.lifecycle.points}
                fireNumber={computed.fireNumber}
                retirementAge={computed.lifecycle.retirementAge}
                milestones={computed.chartMilestones}
                nextMilestone={computed.nextMilestone}
                baseCurrency={baseCurrency}
                locale={locale}
                height={460}
              />
              <FireBreakdownPanel breakdown={breakdown} baseCurrency={baseCurrency} locale={locale} />
            </>
          ) : (
            <>
              {needsAge}
              <FireBreakdownPanel breakdown={breakdown} baseCurrency={baseCurrency} locale={locale} />
            </>
          )}
        </TabsContent>

        {/* MILESTONES */}
        <TabsContent value="milestones" className="space-y-6">
          <TabHelp text={t('help.milestones')} />
          {computed ? (
            <FireMilestonesPanel
              milestones={computed.milestoneRows}
              currentAge={computed.currentAge}
              currentYear={currentYear}
              locale={locale}
              onAdd={() => setMilestoneDialogOpen(true)}
              onRemove={handleRemoveMilestone}
            />
          ) : (
            needsAge
          )}
        </TabsContent>

        {/* PROGRESS */}
        <TabsContent value="progress" className="space-y-6">
          <TabHelp text={t('help.progress')} />
          <FireHistoryChart
            data={progressData}
            currentInvested={result.currentInvested}
            progress={result.progress}
            baseCurrency={baseCurrency}
            locale={locale}
            onRecord={handleRecordSnapshot}
            isRecording={recording}
          />
          <FireSnapshotList
            snapshots={summary.history.map((s) => ({
              period: s.period,
              currentInvested: s.currentInvested,
              progress: s.progress,
            }))}
            baseCurrency={baseCurrency}
            locale={locale}
            onAdd={handleAddSnapshot}
            onEdit={handleEditSnapshot}
            onDelete={handleDeleteSnapshot}
          />
        </TabsContent>
      </Tabs>

      <FirePlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={goal}
        suggested={summary.suggestedDefaults}
        baseCurrency={baseCurrency}
        locale={locale}
        isSaving={isSaving}
        onSubmit={handleSavePlan}
      />
      <FireMilestoneDialog
        open={milestoneDialogOpen}
        onOpenChange={setMilestoneDialogOpen}
        baseCurrency={baseCurrency}
        onSubmit={milestoneForm.submit}
        isLoading={milestoneForm.isSubmitting}
      />
      <FireSnapshotDialog
        open={snapshotDialogOpen}
        onOpenChange={setSnapshotDialogOpen}
        baseCurrency={baseCurrency}
        initial={editingSnapshot}
        onSubmit={handleSubmitSnapshot}
        isLoading={snapshotForm.isSubmitting}
      />
    </AppShell>
  );
}
