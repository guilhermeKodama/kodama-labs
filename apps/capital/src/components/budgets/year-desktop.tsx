"use client";

import { useTranslations } from "next-intl";
import type { BudgetKindName } from "@/lib/budgets/kind";
import { budgetedMonthsLabel } from "@/lib/budgets/labels";
import { percent, projectionVsBudget } from "@/lib/budgets/pace";
import { kindMonths, kindSummaries, type SectionKind } from "@/lib/budgets/year-desktop";
import { useFmt } from "@/lib/format/provider";
import { SERIES } from "@/lib/theme/chart-colors";
import { cn } from "@/lib/utils";
import type { YearOverview } from "./use-budgets";
import { MiniBars } from "./year-phone";

/**
 * Anual on a wide window: Fixo and Variável as two cards. Heartwood and
 * resin, the phone's neutral hues; green and red stay for gains and overruns.
 */
export const KIND_COLOR: Record<SectionKind, string> = { fixo: SERIES.cerne, variavel: SERIES.resina, none: SERIES.casca };

type Tense = (month: number) => "actual" | "current" | "projected";

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

/** The phone's split bar: fixo then variável, as a share of what both spent so far. */
function SplitBar({ fixo, variavel }: { fixo: number; variavel: number }) {
  return (
    <span aria-hidden className="flex h-2 overflow-hidden rounded-[3px] bg-fill-3">
      <span style={{ width: `${fixo * 100}%`, background: KIND_COLOR.fixo }} />
      <span style={{ width: `${variavel * 100}%`, background: KIND_COLOR.variavel }} />
    </span>
  );
}

function useSplitLabel(data: YearOverview) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const { nElapsed, isPast } = data.period;
  const month = isPast ? null : Math.min(Math.max(nElapsed, 1), 12);
  return month ? t("year.phone.split", { month: fmt.monthAbbr(month) }) : t("year.phone.splitYear", { year: data.year });
}

/**
 * Fixo and variável side by side under the KPIs, each a button for the
 * Tipo filter. They follow the scope on screen; the filter only dims the
 * other kind. Hidden below md, where the phone's split card stands in.
 */
export function KindCards({ data, kind, onKind, tense }: { data: YearOverview; kind: BudgetKindName | null; onKind?: (kind: BudgetKindName | null) => void; tense: Tense }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const splitLabel = useSplitLabel(data);
  const summary = kindSummaries(data.categories, data.period.nElapsed);
  if (!(summary.total > 0)) return null;
  const current = data.period.isPast ? 0 : data.currentMonth;

  const card = (name: BudgetKindName) => {
    const slice = summary[name];
    const s = slice.summary;
    const span = budgetedMonthsLabel(s.budgetedMonths, fmt.monthAbbr);
    const projection = projectionVsBudget(s.projectedInBudgetedMonths, s.budgetYear);
    const active = kind === name;
    const stat = (label: string, value: string, sub?: string, tone?: string) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-caption text-fg-3">{label}</span>
        <span className={cn("font-mono text-body-lg font-medium tabular-nums", tone)}>{value}</span>
        {sub ? <span className={cn("truncate text-caption", tone ?? "text-fg-3")}>{sub}</span> : null}
      </span>
    );
    return (
      <button
        key={name}
        type="button"
        data-kind-card={name}
        aria-pressed={active}
        title={active ? t("year.desktop.clearFilter") : t("year.desktop.filter", { kind: t(`kind.${name}`) })}
        onClick={() => onKind?.(active ? null : name)}
        className={cn(
          "flex min-w-0 flex-col gap-2.5 rounded-[6px] border px-3.5 py-3 text-left outline-none transition-opacity hover:bg-fill-4 focus-visible:border-fg-3",
          active ? "border-indicator" : "border-transparent",
          kind && !active && "opacity-50",
        )}
      >
        <span className="flex items-center gap-1.5 text-label text-fg-2">
          <Swatch color={KIND_COLOR[name]} />
          <span className="font-medium text-fg-1">{t(`kind.${name}`)}</span>
          <span className="font-mono text-fg-3 tabular-nums">{t("year.desktop.share", { pct: percent(slice.share) })}</span>
        </span>
        <span className="flex items-end justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-kpi font-medium tabular-nums">{fmt.money0(s.spentToDate)}</span>
            {span && s.budgetToDate > 0 ? <span className="text-caption text-fg-3">{t("year.kpi.spentSubSpan", { pct: percent(s.spentInBudgetedMonths / s.budgetToDate), span })}</span> : null}
          </span>
          <span className="w-[46%] max-w-[260px] shrink-0">
            <MiniBars months={kindMonths(slice, (m) => tense(m) === "projected")} current={current} color={KIND_COLOR[name]} />
          </span>
        </span>
        <span className="grid grid-cols-3 gap-3 border-t border-stroke-3 pt-2.5">
          {stat(span ? t("year.kpi.budgetSpan", { span }) : t("year.kpi.budgetYear", { year: data.year }), fmt.money0(span ? s.budgetToDate : s.budgetYear))}
          {stat(
            t("year.kpi.projection"),
            fmt.money0(s.projectedYear),
            projection ? (projection.kind === "over" ? t("year.desktop.over", { amount: fmt.money0(projection.amount) }) : t("year.kpi.slack", { amount: fmt.money0(projection.amount) })) : undefined,
            projection?.kind === "over" ? "text-warn" : undefined,
          )}
          {stat(t("year.kpi.overMonths"), String(s.overBudgetMonths), t("year.desktop.overMonthsSub", { count: s.budgetedCells }), s.overBudgetMonths > 0 ? "text-neg" : undefined)}
        </span>
      </button>
    );
  };

  return (
    <section data-kind-cards="row" className="hidden md:block">
    <div className="flex flex-col gap-1.5 rounded-[8px] border border-stroke-3 bg-panel p-1.5">
      <span className="flex items-center gap-3 px-2 pt-1.5">
        <span className="shrink-0 text-caption text-fg-3">{splitLabel}</span>
        <span className="flex-1">
          <SplitBar fixo={summary.fixo.share} variavel={summary.variavel.share} />
        </span>
      </span>
      <span className="grid grid-cols-2 gap-1.5">
        {card("fixo")}
        {card("variavel")}
      </span>
    </div>
    </section>
  );
}
