"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BottomSheet, DialogHead } from "@/components/cap";
import { budgetKind } from "@/lib/budgets/kind";
import { heatLevel, heatPercent, trendOf, type HeatLevel } from "@/lib/budgets/heatmap";
import { filteredYearFigures } from "@/lib/budgets/slices";
import { percent, usage } from "@/lib/budgets/pace";
import { defaultMonth, miniBars, monthTiles, rowYear, yearBar, type MonthTile, type PhoneLayout, type PhoneMonth } from "@/lib/budgets/year-phone";
import type { BudgetKindName } from "@/lib/budgets/kind";
import { useFmt } from "@/lib/format/provider";
import type { ViewDraft } from "@/lib/ledger/view-draft";
import { CHART, heatColor, SERIES } from "@/lib/theme/chart-colors";
import { cn } from "@/lib/utils";
import { BudgetEntityBadge, DrillLink, PaceBar, useEntityNames } from "./parts";
import type { HeatmapRow, YearOverview } from "./use-budgets";

/**
 * The Anual view below md, in the layout ?mv= picks while the owner
 * compares them (the desktop heatmap is unchanged):
 * - cards: a card per category with its year, a 12-month strip, tap for month by month;
 * - months: a month picker, then the categories of that month;
 * - map: the heatmap without numbers, tap a row for a bottom sheet.
 */
export interface PhoneYearProps {
  layout: Exclude<PhoneLayout, "table">;
  data: YearOverview;
  categories: HeatmapRow[];
  monthTotals: readonly number[];
  monthBudgets: readonly number[];
  tense: (month: number) => "actual" | "current" | "projected";
  /** The year so far of a category. */
  drill: (row: HeatmapRow, category: string) => ViewDraft | null;
  /** One month of a category; null for a projected month. */
  monthDrill: (row: HeatmapRow, category: string, month: number) => ViewDraft | null;
  onOpenMonth: (month: number) => void;
}

export function PhoneYear(props: PhoneYearProps) {
  if (props.layout === "cards") return <CardsLayout {...props} />;
  if (props.layout === "months") return <MonthsLayout {...props} />;
  return <MapLayout {...props} />;
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

// ---------------------------------------------------------------- A: cards

const BAR_FILL: Record<"actual" | "over" | "projected", CSSProperties> = {
  actual: { background: CHART.bar },
  over: { background: "var(--cap-neg-solid)" },
  projected: { background: CHART.soft },
};

/** Twelve bars of a category's months, each with a tick at its budget. The month list says the same in words. */
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

function CardsLayout({ data, categories, tense, drill, onOpenMonth }: PhoneYearProps) {
  const t = useTranslations("budgets");
  const [open, setOpen] = useState<string | null>(null);
  if (!categories.length) return <p className="text-body text-fg-3 md:hidden">{t("year.heatmap.empty", { year: data.year })}</p>;
  return (
    <>
      <section data-phone-layout="cards" className="overflow-hidden rounded-[8px] border border-stroke-3 bg-panel md:hidden">
        {categories.map((row) => {
          const key = `${row.entityId}:${row.categoryId}`;
          return (
            <CategoryCard
              key={key}
              row={row}
              data={data}
              open={open === key}
              onToggle={() => setOpen(open === key ? null : key)}
              tense={tense}
              drill={drill}
              onOpenMonth={onOpenMonth}
            />
          );
        })}
      </section>
      <p className="text-body-sm text-fg-4 md:hidden">{t("year.phone.barsLegend")}</p>
    </>
  );
}

function CategoryCard({
  row,
  data,
  open,
  onToggle,
  tense,
  drill,
  onOpenMonth,
}: {
  row: HeatmapRow;
  data: YearOverview;
  open: boolean;
  onToggle: () => void;
  tense: PhoneYearProps["tense"];
  drill: PhoneYearProps["drill"];
  onOpenMonth: (month: number) => void;
}) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const labels = useRowLabels();
  const category = labels.name(row);
  const year = rowYear(row.months);
  const bar = yearBar(year.spentToDate, year.budgetYear, data.period.yearPace);
  const panelId = `year-card-${row.entityId ?? "all"}-${row.categoryId ?? "none"}`;
  return (
    <div data-budget-card={category} className="border-t border-stroke-3 first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn("flex w-full flex-col gap-2 px-3 py-3 text-left outline-none focus-visible:bg-fill-4", open && "bg-fill-4")}
      >
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
          {labels.trend(row) ? (
            <>
              <span aria-hidden>·</span>
              {labels.trend(row)}
            </>
          ) : null}
          {year.overMonths > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-neg">{t("year.phone.overMonths", { count: year.overMonths })}</span>
            </>
          ) : null}
          <ChevronDown aria-hidden className={cn("ml-auto size-4 shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="border-t border-stroke-3 bg-fill-4 px-3 pb-2">
          <MonthList row={row} year={data.year} tense={tense} onOpenMonth={onOpenMonth} />
          <DrillLink draft={drill(row, category)} className="flex min-h-11 items-center justify-between border-t border-stroke-3 text-body font-medium text-fg-1">
            {t("year.phone.transactions", { year: data.year })}
            <ChevronRight aria-hidden className="size-4 text-fg-3" />
          </DrillLink>
        </div>
      ) : null}
    </div>
  );
}

/** A category's twelve months as rows: amount and share of the budget; a lived month opens in Mensal. */
function MonthList({ row, year, tense, onOpenMonth, highlight }: { row: HeatmapRow; year: number; tense: PhoneYearProps["tense"]; onOpenMonth: (month: number) => void; highlight?: number | null }) {
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
        const rowClass = cn("flex min-h-11 w-full items-center gap-2.5 border-t border-stroke-3 text-left first:border-t-0", highlight === cell.month && "-mx-2 w-[calc(100%+1rem)] rounded-[6px] bg-fill-3 px-2");
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

// ---------------------------------------------------------------- B: month by month

const TENSE_KEY = { actual: "closed", current: "inProgress", projected: "future" } as const;

function MonthsLayout({ data, categories, monthTotals, monthBudgets, tense, monthDrill, onOpenMonth }: PhoneYearProps) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const labels = useRowLabels();
  const [month, setMonth] = useState(() => defaultMonth(data.currentMonth, data.period.isPast));
  const tiles = monthTiles(monthTotals, monthBudgets, tense);
  const tile = tiles[month - 1];
  if (!categories.length) return <p className="text-body text-fg-3 md:hidden">{t("year.heatmap.empty", { year: data.year })}</p>;
  return (
    <section data-phone-layout="months" className="flex flex-col gap-3 md:hidden">
      <div role="radiogroup" aria-label={t("year.phone.pickMonth")} className="grid grid-cols-6 gap-1.5">
        {tiles.map((item) => (
          <MonthTileButton key={item.month} tile={item} selected={item.month === month} onSelect={() => setMonth(item.month)} />
        ))}
      </div>
      <div className="overflow-hidden rounded-[8px] border border-stroke-3 bg-panel">
        <header data-month-summary="" className="flex flex-col gap-2 border-b border-stroke-3 px-3 py-3">
          <span className="flex items-center gap-2">
            <span className="font-title text-title-sm">{fmt.monthLabel({ year: data.year, month })}</span>
            <span className={cn("text-caption", tile.tense === "projected" ? "text-fg-4" : "text-fg-3")}>{t(`year.phone.${TENSE_KEY[tile.tense]}`)}</span>
            {tile.tense !== "projected" ? (
              <button type="button" onClick={() => onOpenMonth(month)} className="-my-2 ml-auto inline-flex min-h-11 items-center gap-0.5 text-button font-medium text-fg-1 outline-none focus-visible:underline">
                {t("year.phone.openMonth")}
                <ChevronRight aria-hidden className="size-4 text-fg-3" />
              </button>
            ) : null}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className={cn("font-mono text-kpi font-medium tabular-nums", tile.over && "text-neg")}>{fmt.money0(tile.spent)}</span>
            {tile.budget > 0 ? <span className="text-body-sm text-fg-3">{t("year.phone.of", { amount: fmt.money0(tile.budget) })}</span> : null}
            {tile.pct !== null ? <span className={cn("ml-auto font-mono text-body tabular-nums", tile.over ? "text-neg" : "text-fg-3")}>{tile.pct}%</span> : null}
          </span>
          {tile.budget > 0 ? (
            <span className={cn("flex", tile.tense === "projected" && "opacity-40")}>
              <PaceBar ratio={usage(tile.spent, tile.budget)} tone={tile.over ? "over" : "normal"} marker={null} />
            </span>
          ) : null}
        </header>
        {categories.map((row) => {
          const category = labels.name(row);
          const cell = row.months[month - 1];
          const pct = heatPercent(cell);
          const over = !cell.isProjected && pct !== null && pct > 100;
          const year = rowYear(row.months);
          const yearPct = year.budgetYear > 0 ? percent(year.spentToDate / year.budgetYear) : null;
          return (
            <DrillLink
              key={`${row.entityId}:${row.categoryId}`}
              draft={monthDrill(row, category, month)}
              className="flex flex-col gap-1.5 border-t border-stroke-3 px-3 py-2.5 first-of-type:border-t-0 hover:no-underline"
            >
              <span data-month-category={category} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-body-lg font-medium">{category}</span>
                <span className={cn("shrink-0 font-mono text-body-lg tabular-nums", over ? "font-semibold text-neg" : cell.isProjected ? "text-fg-4" : "text-fg-1")}>{pct !== null ? `${pct}%` : "—"}</span>
              </span>
              <span className="flex items-center gap-2">
                {labels.meta(row)}
                <span className={cn("ml-auto shrink-0 font-mono text-caption tabular-nums", cell.isProjected ? "text-fg-4" : "text-fg-3")}>
                  {fmt.money0(cell.spent)}
                  {cell.budget ? ` / ${fmt.money0(cell.budget)}` : ""}
                </span>
              </span>
              {cell.budget ? (
                <span className={cn("flex", cell.isProjected && "opacity-40")}>
                  <PaceBar ratio={usage(cell.spent, cell.budget)} tone={over ? "over" : "normal"} marker={null} label={category} />
                </span>
              ) : null}
              <span className="flex items-center gap-1.5 text-caption text-fg-4">
                {yearPct !== null ? t("year.phone.yearLine", { pct: yearPct, amount: fmt.money0(row.yearTotal) }) : t("year.phone.projection", { amount: fmt.money0(row.yearTotal) })}
                {labels.trend(row) ? (
                  <>
                    <span aria-hidden>·</span>
                    {labels.trend(row)}
                  </>
                ) : null}
              </span>
            </DrillLink>
          );
        })}
      </div>
    </section>
  );
}

function MonthTileButton({ tile, selected, onSelect }: { tile: MonthTile; selected: boolean; onSelect: () => void }) {
  const fmt = useFmt();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-month-tile={tile.month}
      onClick={onSelect}
      className={cn(
        "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[6px] border outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40",
        tile.tense === "projected" ? "border-dashed border-stroke-1" : "border-stroke-2",
        selected ? "border-solid border-indicator bg-fill-3 font-medium" : "bg-panel",
      )}
    >
      <span className={cn("text-button", tile.tense === "projected" && !selected ? "text-fg-4" : "text-fg-1")}>
        {fmt.monthAbbr(tile.month)}
        {tile.tense === "current" ? "*" : ""}
      </span>
      <span className={cn("font-mono text-hint tabular-nums", tile.over ? "font-semibold text-neg" : tile.tense === "projected" ? "text-fg-4" : "text-fg-3")}>{tile.pct !== null ? `${tile.pct}%` : "—"}</span>
    </button>
  );
}

// ---------------------------------------------------------------- C: map + bottom sheet

/** Cell fill per level: the heatmap's ink, stronger near the limit; red once passed; projections only outlined. */
const MAP_STYLE: Record<HeatLevel, { className: string; style?: CSSProperties }> = {
  low: { className: "", style: { background: heatColor(0.12) } },
  mid: { className: "", style: { background: heatColor(0.3) } },
  high: { className: "", style: { background: heatColor(0.6) } },
  over: { className: "bg-neg-solid" },
  projected: { className: "border border-dashed border-stroke-1" },
  empty: { className: "bg-fill-4" },
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MAP_COLS = "grid grid-cols-[minmax(0,1fr)_repeat(12,15px)] items-center gap-x-[3px]";

function MapCell({ level, month }: { level: HeatLevel; month: number }) {
  const look = MAP_STYLE[level];
  return <span data-map-cell={month} data-level={level} className={cn("h-7 rounded-[3px]", look.className)} style={look.style} />;
}

function MapLayout({ data, categories, monthTotals, monthBudgets, tense, drill, onOpenMonth }: PhoneYearProps) {
  const t = useTranslations("budgets");
  const fmt = useFmt();
  const labels = useRowLabels();
  const [picked, setPicked] = useState<{ key: string; month: number | null } | null>(null);
  const current = data.period.isPast ? 0 : data.currentMonth;
  const keyOf = (row: HeatmapRow) => `${row.entityId}:${row.categoryId}`;
  const pickedRow = picked ? categories.find((row) => keyOf(row) === picked.key) ?? null : null;
  if (!categories.length) return <p className="text-body text-fg-3 md:hidden">{t("year.heatmap.empty", { year: data.year })}</p>;

  const open = (row: HeatmapRow) => (event: MouseEvent<HTMLButtonElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-map-cell]");
    setPicked({ key: keyOf(row), month: cell ? Number(cell.dataset.mapCell) : null });
  };

  return (
    <>
      <section data-phone-layout="map" className="overflow-hidden rounded-[8px] border border-stroke-3 bg-panel md:hidden">
        <div className={cn(MAP_COLS, "h-8 px-3 text-micro text-fg-3")}>
          <span className="text-caption">{t("year.heatmap.category")}</span>
          {MONTHS.map((month) => (
            <span key={month} className={cn("text-center", month === current && "font-semibold text-fg-1", tense(month) === "projected" && "text-fg-4")}>
              {fmt.monthAbbr(month).slice(0, 1)}
            </span>
          ))}
        </div>
        {categories.map((row) => {
          const category = labels.name(row);
          return (
            <button
              key={keyOf(row)}
              type="button"
              data-map-row={category}
              aria-haspopup="dialog"
              onClick={open(row)}
              className={cn(MAP_COLS, "min-h-12 w-full border-t border-stroke-3 px-3 py-1.5 text-left outline-none focus-visible:bg-fill-4 active:bg-fill-4")}
            >
              <span className="flex min-w-0 flex-col gap-0.5 pr-1.5">
                <span className="truncate text-body font-medium">{category}</span>
                {labels.meta(row)}
              </span>
              {row.months.map((cell) => (
                <MapCell key={cell.month} month={cell.month} level={heatLevel(cell)} />
              ))}
            </button>
          );
        })}
        <div className={cn(MAP_COLS, "min-h-10 border-t border-stroke-2 bg-fill-4 px-3")}>
          <span className="text-body-sm font-semibold">{t("year.heatmap.total")}</span>
          {monthTotals.map((total, i) => (
            <MapCell key={i} month={i + 1} level={heatLevel({ spent: total, budget: monthBudgets[i] ?? 0, isProjected: tense(i + 1) === "projected" })} />
          ))}
        </div>
      </section>
      <div data-map-legend="" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-3 md:hidden">
        <span className="inline-flex items-center gap-1">
          <span className="flex gap-[2px]">
            {(["low", "mid", "high"] as const).map((level) => (
              <span key={level} className="h-3 w-2.5 rounded-[2px]" style={MAP_STYLE[level].style} />
            ))}
          </span>
          {t("year.phone.legendLow")} → {t("year.phone.legendHigh")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2.5 rounded-[2px] bg-neg-solid" />
          {t("year.phone.legendOver")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-2.5 rounded-[2px] border border-dashed border-stroke-1" />
          {t("year.phone.legendProjected")}
        </span>
        <span className="basis-full text-fg-4">{t("year.phone.mapHint")}</span>
      </div>
      <BottomSheet open={!!pickedRow} onOpenChange={(next) => !next && setPicked(null)}>
        {pickedRow ? <CategorySheet row={pickedRow} data={data} highlight={picked?.month ?? null} tense={tense} drill={drill} onOpenMonth={onOpenMonth} /> : null}
      </BottomSheet>
    </>
  );
}

function CategorySheet({
  row,
  data,
  highlight,
  tense,
  drill,
  onOpenMonth,
}: {
  row: HeatmapRow;
  data: YearOverview;
  highlight: number | null;
  tense: PhoneYearProps["tense"];
  drill: PhoneYearProps["drill"];
  onOpenMonth: (month: number) => void;
}) {
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
      <MonthList row={row} year={data.year} tense={tense} onOpenMonth={onOpenMonth} highlight={highlight} />
      <DrillLink draft={drill(row, category)} className="flex min-h-11 items-center justify-between border-t border-stroke-3 text-body font-medium text-fg-1">
        {t("year.phone.transactions", { year: data.year })}
        <ChevronRight aria-hidden className="size-4 text-fg-3" />
      </DrillLink>
    </>
  );
}
