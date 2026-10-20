"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Btn, Panel } from "@/components/cap";
import { Link } from "@/i18n/navigation";
import { useFmt } from "@/lib/format/provider";
import { alternativeContribution } from "@/lib/invest/contributions-view";
import { whatIfArrival } from "@/lib/invest/fire-rings";
import { cn } from "@/lib/utils";
import { MONO, useCompactMoney } from "../common";
import { RingBar, TrunkBadge } from "./trunk";
import { useFireRings } from "./use-fire-rings";

/** Liberdade financeira in Aportes (canvas board CerneFireCard): the small trunk, today, the ring in progress and the arrival. */
export function FireRingsCard({ onEditGoal }: { onEditGoal: () => void }) {
  const t = useTranslations("invest.rings");
  const ti = useTranslations("invest");
  const fmt = useFmt();
  const compact = useCompactMoney();
  const { summary, view } = useFireRings();
  const plan = view?.plan ?? null;
  const cur = summary?.baseCurrency;
  const alt = plan && !plan.reached ? alternativeContribution(plan.contribution) : null;
  const altYear = useMemo(
    () => (plan && alt !== null ? whatIfArrival(view!.currentInvested, plan.fireNumber, plan.realAnnualReturn, alt, new Date()) : null),
    [plan, alt, view],
  );

  return (
    <Panel
      title={t("card.title")}
      trailing={
        summary ? (
          <>
            <Btn ghost onClick={onEditGoal}>
              {summary.goal ? t("editGoal") : t("defineGoal")}
            </Btn>
            <Link
              href="/investments/fire"
              className="inline-flex h-(--cap-control-h) items-center rounded-[6px] border border-stroke-1 bg-panel px-2.5 text-button font-medium text-fg-1 outline-none hover:bg-fill-4 focus-visible:ring-2 focus-visible:ring-fg-3/40"
            >
              {t("card.link")}
            </Link>
          </>
        ) : null
      }
    >
      {summary && view && plan ? (
        <div className="flex flex-wrap items-center gap-[22px] p-1.5">
          <TrunkBadge trunk={view.trunk} label={t("hero.progress", { pct: fmt.pct(plan.progress, 0), target: compact(plan.fireNumber, cur) })} center={fmt.pct(Math.min(plan.progress, 9.99), 0)} className="size-[168px]" />
          <div className="flex min-w-[220px] flex-1 flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-label text-fg-3">{t("hero.label")}</span>
                <span className={cn(MONO, "text-kpi")}>{compact(view.currentInvested, cur)}</span>
                <span className="text-caption text-fg-3">{t("card.target", { target: compact(plan.fireNumber, cur) })}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-label text-fg-3">{t("passive.label")}</span>
                <span className={cn(MONO, "text-kpi text-pos")}>{fmt.money0(plan.passiveIncome, cur)}</span>
                <span className="text-caption text-fg-3">{t("card.passiveOf", { target: fmt.money0(plan.targetMonthlyIncome, cur) })}</span>
              </div>
            </div>
            {view.history.current ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-2 text-label text-fg-3">
                  <span>{t("forming.label", { year: view.history.current.year })}</span>
                  <span className={cn(MONO, "text-fg-1")}>
                    {(() => {
                      const added = view.history.current.aportes + view.history.current.rendimento;
                      return `${added < 0 ? "−" : "+"}${compact(Math.abs(added), cur)}`;
                    })()}
                  </span>
                </div>
                <RingBar aportes={view.history.current.aportes} rendimento={view.history.current.rendimento} className="h-[7px] rounded-[4px]" />
              </div>
            ) : null}
            <p className="m-0 text-body-sm leading-normal text-fg-2">
              {plan.reached
                ? t("card.reached")
                : plan.arrivalYear === null
                  ? t("card.unreachable")
                  : t.rich("card.arrival", {
                      year: String(plan.arrivalYear),
                      amount: fmt.money0(plan.contribution ?? 0, cur),
                      b: (chunks) => <strong className="font-semibold text-fg-1">{chunks}</strong>,
                    })}
              {alt !== null ? (
                <span className="text-resin-ink">
                  {" "}
                  {altYear !== null ? t("card.alt", { amount: fmt.money0(alt, cur), year: String(altYear) }) : t("card.altNever", { amount: fmt.money0(alt, cur) })}
                </span>
              ) : null}
            </p>
          </div>
        </div>
      ) : !summary ? (
        <span className="text-body text-fg-3">{ti("loading")}</span>
      ) : (
        <span className="text-body text-fg-2">
          {t("card.noPlan", {
            invested: fmt.money0(summary.suggestedDefaults.currentInvested, cur),
            expenses: fmt.money0(summary.suggestedDefaults.currentMonthlyExpenses, cur),
          })}
        </span>
      )}
    </Panel>
  );
}
