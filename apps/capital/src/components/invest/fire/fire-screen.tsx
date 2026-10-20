"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Btn, EmptyRow, TextInput } from "@/components/cap";
import { Page } from "@/components/shell/page";
import { apiPut } from "@/lib/api/client";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { alternativeContribution } from "@/lib/invest/contributions-view";
import { ringRadius, whatIfArrival, type FireRingsView, type MilestoneMark } from "@/lib/invest/fire-rings";
import type { FireSummaryResponse } from "@/lib/invest/types";
import { cn } from "@/lib/utils";
import { MONO, useCompactMoney } from "../common";
import { AporteDialog, FireGoalDialog } from "../dialogs";
import { MilestoneDialog } from "./milestone-dialog";
import { RingBar, TrunkFigure, type TrunkMark } from "./trunk";
import { useArrivalRange, useFireRings } from "./use-fire-rings";

/** Projected rings listed in "Um anel por ano" before the "mais N" row. */
const LISTED_FUTURE = 2;

/** A card of the right column (the canvas: radius 12, 14×16 padding, white on cream). */
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-[5px] rounded-[12px] border border-stroke-2 bg-panel px-4 py-3.5", className)}>{children}</div>;
}

function Swatch({ className }: { className: string }) {
  return <span aria-hidden className={cn("inline-block size-[11px] shrink-0 rounded-full", className)} />;
}

/** Investimentos › Liberdade financeira: the plan as the cross-section of a trunk (canvas board CerneFire). */
export function FireScreen() {
  const t = useTranslations("invest.rings");
  const ti = useTranslations("invest");
  const { summary, view, isLoading } = useFireRings();
  const [dialog, setDialog] = useState<null | "goal" | "aporte" | "milestone">(null);

  return (
    <Page
      crumbs={[ti("crumbs.investments"), ti("crumbs.fire")]}
      actions={
        <>
          {summary ? <Btn onClick={() => setDialog("goal")}>{summary.goal ? t("editGoal") : t("defineGoal")}</Btn> : null}
          <Btn primary onClick={() => setDialog("aporte")}>
            {t("register")}
          </Btn>
        </>
      }
    >
      {summary && view ? (
        <FireBody summary={summary} view={view} onMilestone={() => setDialog("milestone")} />
      ) : (
        <EmptyRow>{isLoading ? ti("loading") : t("trunkEmpty")}</EmptyRow>
      )}
      {dialog === "aporte" ? <AporteDialog initialAmount={summary?.currentMonthContribution ?? undefined} onClose={() => setDialog(null)} /> : null}
      {dialog === "goal" && summary ? <FireGoalDialog summary={summary} onClose={() => setDialog(null)} /> : null}
      {dialog === "milestone" && summary?.goal ? (
        <MilestoneDialog milestones={summary.goal.milestones} currency={summary.baseCurrency} onClose={() => setDialog(null)} />
      ) : null}
    </Page>
  );
}

function FireBody({ summary, view, onMilestone }: { summary: FireSummaryResponse; view: FireRingsView; onMilestone: () => void }) {
  const t = useTranslations("invest.rings");
  const fmt = useFmt();
  const compact = useCompactMoney();
  const cur = summary.baseCurrency;
  const money = (value: number) => compact(value, cur);
  const signed = (value: number) => `${value < 0 ? "−" : "+"}${compact(Math.abs(value), cur)}`;
  const { plan, trunk, history } = view;
  const now = new Date();

  const marks: TrunkMark[] = view.milestones
    .filter((mark): mark is MilestoneMark & { threshold: number } => mark.threshold !== null && mark.threshold > 0 && mark.threshold <= trunk.scale)
    .map((mark) => ({ id: mark.id, r: ringRadius(mark.threshold, trunk.scale), label: money(mark.threshold) }));

  return (
    <>
      <div className="flex flex-wrap gap-7 px-2.5 pt-2.5">
        <figure className="m-0 flex min-w-0 flex-[1_1_520px] flex-col items-center gap-3.5">
          <TrunkFigure
            className="max-w-[600px]"
            trunk={trunk}
            marks={marks}
            text={{
              label: history.core ? t("trunkLabel", { coreYear: history.core.year, today: money(view.currentInvested) }) : t("trunkEmpty"),
              core: t("core"),
              coreValue: history.core ? t("coreSince", { value: money(history.core.value), date: String(history.core.year) }) : "",
              now: t("now"),
              goal: plan ? t("goalLabel", { value: money(plan.fireNumber) }) : null,
            }}
          />
          <figcaption className="flex flex-wrap justify-center gap-x-[18px] gap-y-2 text-body-sm text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <Swatch className="bg-trunk-heart" />
              {t("legend.core")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Swatch className="border-[1.5px] border-trunk-late bg-trunk-wood-a" />
              {t("legend.ring")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Swatch className="border-[3px] border-resin" />
              {t("legend.now")}
            </span>
            {plan ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <Swatch className="border-[1.5px] border-dashed border-trunk-future" />
                  {t("legend.future")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Swatch className="border-2 border-dashed border-trunk-goal" />
                  {t("legend.goal")}
                </span>
              </>
            ) : null}
          </figcaption>
        </figure>

        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
          <div data-testid="fire-hero" className="flex flex-col gap-1.5 rounded-[14px] bg-trunk-hero px-5 py-[18px] text-trunk-hero-ink">
            <span className="text-body text-trunk-hero-muted">{t("hero.label")}</span>
            <span className={cn(MONO, "text-hero tracking-[-0.02em]")}>{money(view.currentInvested)}</span>
            <span className="text-body text-trunk-hero-muted">
              {plan ? t("hero.progress", { pct: fmt.pct(plan.progress, 0), target: money(plan.fireNumber) }) : t("hero.noGoal")}
            </span>
          </div>
          {plan ? <PlanCards plan={plan} currency={cur} /> : null}
          {history.current ? (
            <Card className="gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-body-sm text-fg-3">{t("forming.label", { year: history.current.year })}</span>
                <span className={cn(MONO, "text-kpi")}>{signed(history.current.aportes + history.current.rendimento)}</span>
              </div>
              <RingBar aportes={history.current.aportes} rendimento={history.current.rendimento} className="h-2 rounded-[4px]" />
              <span className="text-label text-fg-3">
                {t("forming.detail", {
                  month: fmt.monthName(now.getMonth() + 1),
                  aportes: money(history.current.aportes),
                  rendimento: money(history.current.rendimento),
                })}
              </span>
            </Card>
          ) : null}
          {plan && !plan.reached ? <WhatIf plan={plan} currentInvested={view.currentInvested} currency={cur} /> : null}
        </div>
      </div>

      <RingTable view={view} currency={cur} />
      {plan && summary.goal ? <Milestones goal={summary.goal} view={view} currency={cur} onAdd={onMilestone} /> : null}
      <p className="px-2.5 text-label text-fg-3">
        {t("caption")}
        {[...history.past, ...(history.current ? [history.current] : [])].some((ring) => ring.estimated) ? ` ${t("estimatedNote")}` : null}
      </p>
    </>
  );
}

/** "Já dá por mês" and "Chegada". */
function PlanCards({ plan, currency }: { plan: NonNullable<FireRingsView["plan"]>; currency: string }) {
  const t = useTranslations("invest.rings");
  const fmt = useFmt();
  const range = useArrivalRange(plan);

  let arrivalSub: string | null = null;
  if (!plan.reached && plan.arrivalYear === null) arrivalSub = t("arrival.unreachable");
  else if (!plan.reached) {
    const pace = plan.contribution !== null ? t("arrival.pace", { amount: fmt.money0(plan.contribution, currency) }) : null;
    const spread =
      plan.currentAge === null
        ? t("arrival.needAge")
        : range === null
          ? null
          : range.to === null
            ? t("arrival.rangeOpen", { from: String(range.from) })
            : range.from === range.to
              ? t("arrival.rangeSame", { year: String(range.from) })
              : t("arrival.range", { from: String(range.from), to: String(range.to) });
    arrivalSub = [pace, spread].filter(Boolean).join("; ");
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <span className="text-body-sm text-fg-3">{t("passive.label")}</span>
        <span className={cn(MONO, "text-kpi text-pos")}>{fmt.money0(plan.passiveIncome, currency)}</span>
        <span className="text-label leading-[1.4] text-fg-3">{t("passive.sub", { swr: fmt.pct(plan.safeWithdrawalRate, 1) })}</span>
      </Card>
      <Card>
        <span className="text-body-sm text-fg-3">{t("arrival.label")}</span>
        <span data-testid="fire-arrival" className={cn(MONO, "text-kpi")}>
          {plan.reached ? t("arrival.reached") : plan.arrivalYear !== null ? String(plan.arrivalYear) : t("arrival.never")}
        </span>
        {arrivalSub ? <span className="text-label leading-[1.4] text-fg-3">{arrivalSub}</span> : null}
      </Card>
    </div>
  );
}

/** "E se eu aportar por mês": the arrival at another contribution, computed here (no request). */
function WhatIf({ plan, currentInvested, currency }: { plan: NonNullable<FireRingsView["plan"]>; currentInvested: number; currency: string }) {
  const t = useTranslations("invest.rings.whatIf");
  const fmt = useFmt();
  const [text, setText] = useState(() => {
    const suggested = alternativeContribution(plan.contribution);
    return suggested === null ? "" : fmt.number(suggested, 0);
  });
  const amount = fmt.parseNumber(text);
  const year = useMemo(
    () => (amount >= 0 ? whatIfArrival(currentInvested, plan.fireNumber, plan.realAnnualReturn, amount, new Date()) : null),
    [amount, currentInvested, plan.fireNumber, plan.realAnnualReturn],
  );
  const base = plan.arrivalYear;
  const result =
    !text.trim() || !Number.isFinite(amount)
      ? null
      : year === null
        ? t("never")
        : base === null
          ? t("resultPlain", { year: String(year) })
          : t("result", {
              year: String(year),
              delta: year < base ? t("sooner", { years: base - year }) : year > base ? t("later", { years: year - base }) : t("same"),
            });

  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-dashed border-resin-line bg-resin-wash px-4 py-3.5">
      <label className="flex flex-wrap items-center justify-between gap-2.5 text-body text-fg-1">
        {t("label")}
        <span className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-mono text-control text-fg-3">
            {fmt.currencySymbol(currency)}
          </span>
          <TextInput value={text} onChange={setText} mono inputMode="decimal" className="w-[120px] bg-panel pl-8 text-right" />
        </span>
      </label>
      {result ? (
        <span data-testid="fire-what-if" className="text-body text-resin-ink">
          {result}
        </span>
      ) : null}
    </div>
  );
}

type RingRow =
  | { kind: "bar"; key: string; year: string; tag: string; tagClass: string; aportes: number; rendimento: number; added: number; total: number }
  | { kind: "future"; key: string; year: string; tag: string; added: number; total: number }
  | { kind: "note"; key: string; year: string; tag: string; tagClass: string; note: string; total: number | null };

/** "Um anel por ano": the core, every past ring, this year's, two projected and the arrival. */
function RingTable({ view, currency }: { view: FireRingsView; currency: string }) {
  const t = useTranslations("invest.rings.table");
  const fmt = useFmt();
  const compact = useCompactMoney();
  const money = (value: number) => compact(value, currency);
  const signed = (value: number) => `${value < 0 ? "−" : "+"}${compact(Math.abs(value), currency)}`;
  const { history, plan } = view;
  const nowYear = new Date().getFullYear();

  const rows: RingRow[] = [];
  if (history.core) {
    rows.push({ kind: "note", key: "core", year: String(history.core.year), tag: t("coreTag"), tagClass: "text-fg-3", note: t("coreNote"), total: history.core.value });
  }
  for (const ring of history.past) {
    const tag = ring.rendimento < 0 ? t("thinTag") : ring.estimated ? t("estimatedTag") : t("ringTag");
    rows.push({ kind: "bar", key: String(ring.year), year: String(ring.year), tag, tagClass: "text-fg-3", aportes: ring.aportes, rendimento: ring.rendimento, added: ring.aportes + ring.rendimento, total: ring.value });
  }
  if (history.current) {
    const ring = history.current;
    const tag = t("formingTag", { month: fmt.monthName(new Date().getMonth() + 1) });
    rows.push({ kind: "bar", key: "current", year: String(ring.year), tag, tagClass: "text-resin-ink", aportes: ring.aportes, rendimento: ring.rendimento, added: ring.aportes + ring.rendimento, total: ring.value });
  }
  const future = view.future.filter((ring) => ring.year > nowYear);
  if (plan && !plan.reached && future.length) {
    const reachable = plan.arrivalYear !== null;
    const last = future[future.length - 1];
    // The closing row stands for the last ring: the arrival, or ten years out when it never comes.
    const listed = future.slice(0, Math.min(LISTED_FUTURE, future.length - 1));
    for (const ring of listed) {
      rows.push({ kind: "future", key: `f${ring.year}`, year: String(ring.year), tag: t("projectedTag"), added: ring.aportes + ring.rendimento, total: ring.value });
    }
    const hidden = future.length - 1 - listed.length;
    if (hidden > 0) rows.push({ kind: "note", key: "more", year: "…", tag: "", tagClass: "", note: t("more", { count: hidden }), total: null });
    rows.push(
      reachable
        ? { kind: "note", key: "arrival", year: String(plan.arrivalYear), tag: t("arrivalTag"), tagClass: "text-resin-ink", note: t("arrivalNote", { amount: fmt.money0(plan.targetMonthlyIncome, currency) }), total: plan.fireNumber }
        : { kind: "note", key: "far", year: String(last.year), tag: t("unreachableTag"), tagClass: "text-fg-3", note: t("unreachableNote"), total: last.value },
    );
  }

  const scale = Math.max(1, ...rows.map((row) => (row.kind === "bar" ? Math.max(row.aportes, 0) + Math.abs(row.rendimento) : row.kind === "future" ? Math.max(row.added, 0) : 0)));
  const pct = (value: number) => `${(Math.max(value, 0) / scale) * 100}%`;

  return (
    <section aria-labelledby="rings-title" className="overflow-hidden rounded-[12px] border border-stroke-2 bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-stroke-2 bg-trunk-bg px-4 py-3">
        <h2 id="rings-title" className="m-0 font-title text-heading font-medium">
          {t("title")}
        </h2>
        <div className="flex flex-wrap gap-3.5 text-label text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-trunk-aportes" />
            {t("aportes")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-pos" />
            {t("rendimento")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-neg" />
            {t("loss")}
          </span>
          {plan ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[2px] border-[1.5px] border-dashed border-trunk-future" />
              {t("projection")}
            </span>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {rows.map((row) => (
            <div
              key={row.key}
              data-ring-row={row.key}
              className={cn(
                "grid min-h-(--cap-table-row-h) grid-cols-[150px_minmax(0,1fr)_120px_110px] items-center gap-3 border-b border-stroke-3 px-4 py-1 last:border-b-0",
                row.kind === "future" ? "text-fg-2" : "text-fg-1",
              )}
            >
              <span className="flex flex-col leading-tight">
                <span className={cn(MONO, "text-body")}>{row.year}</span>
                {row.tag ? <span className={cn("text-caption", row.kind === "future" ? "text-fg-3" : row.tagClass)}>{row.tag}</span> : null}
              </span>
              {row.kind === "bar" ? (
                <span className="flex h-2.5 items-center">
                  <span className="h-2.5 rounded-l-[3px] bg-trunk-aportes" style={{ width: pct(row.aportes) }} />
                  <span className="h-2.5 bg-pos" style={{ width: pct(row.rendimento) }} />
                  <span className="h-2.5 rounded-r-[3px] bg-neg" style={{ width: pct(-row.rendimento) }} />
                </span>
              ) : row.kind === "future" ? (
                <span className="block h-2.5 rounded-[3px] border-[1.5px] border-dashed border-trunk-future" style={{ width: pct(row.added) }} />
              ) : (
                <span className="text-body-sm text-fg-3">{row.note}</span>
              )}
              <span className={cn(MONO, "text-right text-body")}>{row.kind === "note" ? "" : signed(row.added)}</span>
              <span className={cn(MONO, "text-right text-body font-medium")}>{row.total === null ? "" : money(row.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Marcos no caminho": the plan's milestones and the arrival, each with its year. */
function Milestones({
  goal,
  view,
  currency,
  onAdd,
}: {
  goal: NonNullable<FireSummaryResponse["goal"]>;
  view: FireRingsView;
  currency: string;
  onAdd: () => void;
}) {
  const t = useTranslations("invest.rings.milestones");
  const fmt = useFmt();
  const plan = view.plan!;
  const remove = useAppMutation({
    event: "investments.write",
    mutationFn: (id: string) => apiPut("/api/v1/fire/goal", { milestones: goal.milestones.filter((m) => m.id !== id) }),
    undo: (_data, id) => t("removed", { name: goal.milestones.find((m) => m.id === id)?.name ?? "" }),
  });
  const coreYear = view.history.core?.year ?? null;
  const when = (mark: MilestoneMark) =>
    mark.reached ? (mark.year !== null && coreYear !== null && mark.year > coreYear ? String(mark.year) : t("done")) : mark.year !== null ? String(mark.year) : "—";
  const marks = [...view.milestones].sort((a, b) => (a.threshold ?? Infinity) - (b.threshold ?? Infinity));

  return (
    <section aria-labelledby="milestones-title" className="flex flex-col gap-3 px-2.5">
      <div className="flex items-center justify-between gap-2.5">
        <h2 id="milestones-title" className="m-0 font-title text-heading font-medium">
          {t("title")}
        </h2>
        <Btn dashed onClick={onAdd} className="text-fg-2">
          {t("add")}
        </Btn>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
        {marks.map((mark) => (
          <li
            key={mark.id}
            data-milestone={mark.name}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border py-2 pr-2 pl-3 text-body text-fg-1",
              mark.reached ? "border-stroke-2 bg-panel" : "border-stroke-1",
            )}
          >
            <span aria-hidden className={cn("size-[9px] rotate-45 border-[1.5px] border-trunk-goal", mark.reached && "bg-trunk-goal")} />
            {mark.name}
            <span className={cn(MONO, "text-label text-fg-3")}>{when(mark)}</span>
            <button
              type="button"
              aria-label={t("remove", { name: mark.name })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(mark.id)}
              className="inline-flex size-5 items-center justify-center rounded-full text-fg-3 outline-none hover:bg-fill-3 hover:text-fg-1 focus-visible:ring-2 focus-visible:ring-fg-3/40"
            >
              ×
            </button>
          </li>
        ))}
        {plan.arrivalYear !== null || plan.reached ? (
          <li className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-2 text-body text-fg-1", plan.reached ? "border-stroke-2 bg-panel" : "border-stroke-1")}>
            <span aria-hidden className={cn("size-[9px] rotate-45 border-[1.5px] border-trunk-goal", plan.reached && "bg-trunk-goal")} />
            {t("goal", { amount: fmt.money0(plan.targetMonthlyIncome, currency) })}
            <span className={cn(MONO, "text-label text-fg-3")}>{plan.reached ? t("done") : String(plan.arrivalYear)}</span>
          </li>
        ) : null}
      </ul>
      {!marks.length && plan.arrivalYear === null && !plan.reached ? <span className="text-label text-fg-3">{t("empty")}</span> : null}
    </section>
  );
}
