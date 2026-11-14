"use client";

import { useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet, DialogHead } from "@/components/cap";
import { budgetKind, type BudgetKindName } from "@/lib/budgets/kind";
import { heatPercent, trendOf } from "@/lib/budgets/heatmap";
import { filteredYearFigures } from "@/lib/budgets/slices";
import { percent, usage } from "@/lib/budgets/pace";
import { miniBars, rowYear, yearBar, type PhoneMonth } from "@/lib/budgets/year-phone";
import { useFmt } from "@/lib/format/provider";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { CHART, SERIES } from "@/lib/theme/chart-colors";
import { cn } from "@/lib/utils";
import { BudgetEntityBadge, DrillLink, PaceBar, useEntityNames } from "./parts";
import type { HeatmapRow, YearOverview } from "./use-budgets";

/**
 * The Anual view below md: one card per category (its year, a bar, twelve
 * mini-bars), and a bottom sheet with that category month by month. The
 * desktop heatmap is unchanged and hidden here.
 */
export interface YearCardsProps {
  data: YearOverview;
  categories: HeatmapRow[];
  tense: (month: number) => "actual" | "current" | "projected";
  /** The year so far of a category. */
  drill: (row: HeatmapRow, category: string) => ViewDraft | null;
  onOpenMonth: (month: number) => void;
}

const TREND_TEXT = { up: "text-warn", down: "text-pos", stable: "text-fg-3", none: "text-fg-4" } as const;

function useRowLabels() {
  const t = useTranslations("budgets");
  const { kinds } = useEntityNames();
  return {
    name: (row: HeatmapRow) => row.category ?? t("uncategorized"),
    meta: (row: HeatmapRow) => (
      <span className="flex min-w-0 items-center gap-1 text-caption text-fg-3">
        {row.isBudgeted ? (
          <>
            <span className="shrink-0">{t(`kind.${budgetKind(row.kind)}`)}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <BudgetEntityBadge entityId={row.entityId} kinds={kinds} />
      </span>
    ),
    trend: (row: HeatmapRow) => {
      const trend = trendOf(row.trend);
      return trend.kind === "none" ? null : <span className={cn("font-mono", TREND_TEXT[trend.kind])}>{t(`year.heatmap.trend_${trend.kind}`, { pct: trend.pct })}</span>;
    },
  };
}

/** Fixo and variável spent so far, side by side, while the Tipo filter is Todos. */
export function KindSplit({ data, kind }: { data: YearOverview; kind: BudgetKindName | null }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  if (kind !== null) return null;
  const { nElapsed, isPast } = data.period;
  const of = (filter: BudgetKindName) => filteredYearFigures(data.categories, filter, nElapsed).summary;
  const fixo = of("fixo");
  const variavel = of("variavel");
  const total = fixo.spentToDate + variavel.spentToDate;
  if (!(total > 0)) return null;
  const month = isPast ? null : Math.min(Math.max(nElapsed, 1), 12);
  const side = (name: BudgetKindName, slice: typeof fixo, color: string) => (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-caption text-fg-3">
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
        {t(`kind.${name}`)}
        <span className="font-mono tabular-nums">{percent(slice.spentToDate / total)}%</span>
      </span>
      <span className="font-mono text-body-lg font-medium tabular-nums">{fmt.money0(slice.spentToDate)}</span>
      {slice.budgetToDate > 0 ? <span className="text-caption text-fg-3">{t("year.phone.of", { amount: fmt.money0(slice.budgetToDate) })}</span> : null}
    </span>
  );
  return (
    <section data-kind-split="" className="flex flex-col gap-2.5 rounded-[8px] border border-stroke-3 bg-panel px-3.5 py-3 md:hidden">
      <span className="text-caption text-fg-3">{month ? t("year.phone.split", { month: fmt.monthAbbr(month) }) : t("year.phone.splitYear", { year: data.year })}</span>
      <span aria-hidden className="flex h-2 overflow-hidden rounded-[3px] bg-fill-3">
        <span style={{ width: `${(fixo.spentToDate / total) * 100}%`, background: SERIES.cerne }} />
        <span style={{ width: `${(variavel.spentToDate / total) * 100}%`, background: SERIES.resina }} />
      </span>
      <span className="grid grid-cols-2 gap-3">
        {side("fixo", fixo, SERIES.cerne)}
        {side("variavel", variavel, SERIES.resina)}
      </span>
    </section>
  );
}

const BAR_FILL: Record<"actual" | "over" | "projected", CSSProperties> = {
  actual: { background: CHART.bar },
  over: { background: "var(--cap-neg-solid)" },
  projected: { background: CHART.soft },
};

/** Twelve bars of a category's months, each with a tick at its budget. The sheet says the same in words. */
function MiniBars({ months, current }: { months: readonly PhoneMonth[]; current: number }) {
  const fmt = useFmt();
  const bars = miniBars(months);
  return (
    <span aria-hidden data-mini-bars="" className="flex flex-col gap-1">
      <span className="grid h-9 grid-cols-12 items-end gap-[3px]">
        {bars.map((bar) => (
          <span key={bar.month} data-bar-tone={bar.tone} className="relative flex h-full items-end">
            <span className="w-full rounded-t-[2px]" style={{ ...BAR_FILL[bar.tone], height: bar.height > 0 ? `max(2px, ${bar.height * 100}%)` : 0 }} />
            {bar.budgetAt !== null ? <span className="absolute inset-x-[-1px] border-t border-dashed border-fg-3" style={{ bottom: `${bar.budgetAt * 100}%` }} /> : null}
          </span>
        ))}
      </span>
      <span className="grid grid-cols-12 gap-[3px] text-center text-micro text-fg-4">
        {bars.map((bar) => (
          <span key={bar.month} className={cn(bar.month === current && "font-semibold text-fg-1")}>
            {fmt.monthAbbr(bar.month).slice(0, 1)}
          </span>
        ))}
      </span>
    </span>
  );
}

/** One card per category. Tapping it opens the category's year in a bottom sheet. */
export function YearCards({ data, categories, tense, drill, onOpenMonth }: YearCardsProps) {
  const t = useTranslations("budgets");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const keyOf = (row: HeatmapRow) => `${row.entityId}:${row.categoryId}`;
  const openRow = openKey ? (categories.find((row) => keyOf(row) === openKey) ?? null) : null;
  if (!categories.length) return <p className="text-body text-fg-3 md:hidden">{t("year.heatmap.empty", { year: data.year })}</p>;
  return (
    <>
      <section data-phone-layout="cards" className="overflow-hidden rounded-[8px] border border-stroke-3 bg-panel md:hidden">
        {categories.map((row) => (
          <CategoryCard key={keyOf(row)} row={row} data={data} onOpen={() => setOpenKey(keyOf(row))} />
        ))}
      </section>
      <p className="text-body-sm text-fg-4 md:hidden">{t("year.phone.barsLegend")}</p>
      <BottomSheet open={!!openRow} onOpenChange={(next) => !next && setOpenKey(null)}>
        {openRow ? <CategorySheet row={openRow} data={data} tense={tense} drill={drill} onOpenMonth={onOpenMonth} /> : null}
      </BottomSheet>
    </>
  );
}

function CategoryCard({ row, data, onOpen }: { row: HeatmapRow; data: YearOverview; onOpen: () => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const labels = useRowLabels();
  const category = labels.name(row);
  const year = rowYear(row.months);
  const bar = yearBar(year.spentToDate, year.budgetYear, data.period.yearPace);
  return (
    <div data-budget-card={category} className="border-t border-stroke-3 first:border-t-0">
      <button type="button" onClick={onOpen} className="flex w-full flex-col gap-2 px-3 py-3 text-left outline-none focus-visible:bg-fill-4 active:bg-fill-4">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-body-lg font-medium">{category}</span>
          <span className="shrink-0 font-mono text-body-lg font-medium tabular-nums">{fmt.money0(year.spentToDate)}</span>
        </span>
        <span className="-mt-1 flex items-center gap-2">
          {labels.meta(row)}
          {year.budgetYear > 0 ? <span className="ml-auto shrink-0 text-caption text-fg-3">{t("year.phone.ofYear", { amount: fmt.money0(year.budgetYear) })}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <PaceBar ratio={bar.ratio} tone={bar.tone} marker={data.period.isPast ? null : data.period.yearPace} label={category} />
          <span className={cn("w-[38px] shrink-0 text-right font-mono text-caption tabular-nums", bar.tone === "over" ? "text-neg" : "text-fg-3")}>{percent(bar.ratio)}%</span>
        </span>
        <MiniBars months={row.months} current={data.period.isPast ? 0 : data.currentMonth} />
        <span className="flex items-center gap-1.5 text-caption text-fg-3">
          <span className="tabular-nums">{t("year.phone.projection", { amount: fmt.money0(row.yearTotal) })}</span>
          <span aria-hidden>·</span>
          {labels.trend(row) ?? <span className="font-mono text-fg-4">—</span>}
          {year.overMonths > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-neg">{t("year.phone.overMonths", { count: year.overMonths })}</span>
            </>
          ) : null}
          <ChevronRight aria-hidden className="ml-auto size-4 shrink-0 text-fg-3" />
        </span>
      </button>
    </div>
  );
}

/** A category's twelve months as rows: amount and share of the budget; a lived month opens in Mensal. */
function MonthList({ row, year, tense, onOpenMonth }: { row: HeatmapRow; year: number; tense: YearCardsProps["tense"]; onOpenMonth: (month: number) => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  return (
    <ol data-month-list="" className="flex flex-col">
      {row.months.map((cell) => {
        const tensed = tense(cell.month);
        const pct = heatPercent(cell);
        const over = !cell.isProjected && pct !== null && pct > 100;
        const body = (
          <>
            <span className={cn("w-10 shrink-0 text-body", tensed === "current" && "font-semibold", tensed === "projected" && "text-fg-4")}>
              {fmt.monthAbbr(cell.month)}
              {tensed === "current" ? "*" : ""}
            </span>
            <span className={cn("flex min-w-0 flex-1 items-center", tensed === "projected" && "opacity-40")}>
              {cell.budget ? <PaceBar ratio={usage(cell.spent, cell.budget)} tone={over ? "over" : "normal"} marker={null} /> : <span className="text-caption text-fg-4">{t("year.phone.noBudget")}</span>}
            </span>
            <span className={cn("w-[84px] shrink-0 text-right font-mono text-body-sm tabular-nums", tensed === "projected" ? "text-fg-4" : "text-fg-2")}>{fmt.money0(cell.spent)}</span>
            <span className={cn("w-11 shrink-0 text-right font-mono text-caption tabular-nums", over ? "font-semibold text-neg" : tensed === "projected" ? "text-fg-4" : "text-fg-3")}>
              {tensed === "projected" ? t("year.phone.projected") : pct !== null ? `${pct}%` : "—"}
            </span>
          </>
        );
        const rowClass = "flex min-h-11 w-full items-center gap-2.5 border-t border-stroke-3 text-left first:border-t-0";
        return (
          <li key={cell.month} data-month-row={cell.month}>
            {cell.isProjected ? (
              <span className={rowClass}>{body}</span>
            ) : (
              <button type="button" title={t("year.heatmap.open", { month: fmt.monthLabel({ year, month: cell.month }) })} onClick={() => onOpenMonth(cell.month)} className={cn(rowClass, "outline-none focus-visible:bg-fill-3")}>
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CategorySheet({ row, data, tense, drill, onOpenMonth }: { row: HeatmapRow; data: YearOverview; tense: YearCardsProps["tense"]; drill: YearCardsProps["drill"]; onOpenMonth: (month: number) => void }) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const labels = useRowLabels();
  const category = labels.name(row);
  const year = rowYear(row.months);
  const bar = yearBar(year.spentToDate, year.budgetYear, data.period.yearPace);
  const lived = data.period.isPast ? 12 : Math.min(Math.max(data.period.nElapsed, 1), 12);
  const stat = (label: string, value: string, tone?: string) => (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption text-fg-3">{label}</span>
      <span className={cn("font-mono text-title font-medium tabular-nums", tone)}>{value}</span>
    </span>
  );
  return (
    <>
      <DialogHead title={category} desc={labels.meta(row)} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {stat(t("year.phone.spentTo", { month: fmt.monthAbbr(lived) }), fmt.money0(year.spentToDate), bar.tone === "over" ? "text-neg" : undefined)}
        {stat(t("year.phone.budgetYear"), fmt.money0(year.budgetYear))}
        {stat(t("year.phone.projectionYear"), fmt.money0(row.yearTotal), year.budgetYear > 0 && row.yearTotal > year.budgetYear ? "text-warn" : undefined)}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-fg-3">{t("year.heatmap.trend")}</span>
          <span className="text-title">{labels.trend(row) ?? <span className="text-fg-4">—</span>}</span>
        </span>
      </div>
      <span className="flex items-center gap-2">
        <PaceBar ratio={bar.ratio} tone={bar.tone} marker={data.period.isPast ? null : data.period.yearPace} label={category} />
        <span className={cn("w-[38px] shrink-0 text-right font-mono text-caption tabular-nums", bar.tone === "over" ? "text-neg" : "text-fg-3")}>{percent(bar.ratio)}%</span>
      </span>
      <MonthList row={row} year={data.year} tense={tense} onOpenMonth={onOpenMonth} />
      <DrillLink draft={drill(row, category)} className="flex min-h-11 items-center justify-between border-t border-stroke-3 text-body font-medium text-fg-1">
        {t("year.phone.transactions", { year: data.year })}
        <ChevronRight aria-hidden className="size-4 text-fg-3" />
      </DrillLink>
    </>
  );
}
