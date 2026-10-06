/**
 * Texts of the Orçamentos screen that depend on the period or on the
 * data: which message to show and its ICU values. Keys are relative to
 * the `budgets` namespace (src/messages/<locale>/budgets.json); month
 * abbreviations and money come from the formatter (useFmt), passed in.
 */

export interface Message {
  key: string;
  values?: Record<string, string | number>;
}

type Abbr = (month: number) => string;
type Money = (value: number) => string;

/** "jun–ago", or "jan" for a single month. */
export function monthSpan(from: number, to: number, abbr: Abbr): string {
  return from === to ? abbr(from) : `${abbr(from)}–${abbr(to)}`;
}

export interface MonthHeaderPeriod {
  year: number;
  month: number;
  daysElapsed: number;
  daysInMonth: number;
  isCurrent: boolean;
  isPast: boolean;
  /** YYYY-MM-DD in the user's timezone. */
  today: string;
}

/** "Hoje: 22/set · 73% do mês", or that the month is closed or has not started. */
export function monthHeader(period: MonthHeaderPeriod, abbr: Abbr): Message {
  if (period.isPast) return { key: "month.closed" };
  if (!period.isCurrent) return { key: "month.notStarted" };
  const day = period.today.slice(8, 10);
  return {
    key: "month.today",
    values: { day, month: abbr(period.month), pct: period.daysInMonth ? Math.round((period.daysElapsed / period.daysInMonth) * 100) : 0 },
  };
}

/** The bar column's header: "marca = hoje (dia 22)" only while the month runs. */
export function barHeader(period: Pick<MonthHeaderPeriod, "isCurrent" | "daysElapsed">): Message {
  return period.isCurrent ? { key: "month.table.barToday", values: { day: period.daysElapsed } } : { key: "month.table.bar" };
}

/** Total row: "Orçamento zera em 1º/out" (budgets do not carry over). */
export function resetsLabel(month: number, abbr: Abbr): Message {
  return { key: "month.table.resets", values: { month: abbr(month === 12 ? 1 : month + 1) } };
}

export interface YearPeriod {
  nElapsed: number;
  completeMonths: number;
  isPast: boolean;
  projectionBasis: readonly [number, number] | null;
}

/** "jan–set realizado · out–dez projetado pela média de jun–ago", and its variants for other years. */
export function yearHeader(period: YearPeriod, abbr: Abbr): Message {
  if (period.isPast || period.nElapsed >= 12) return { key: "year.header.done", values: { actual: monthSpan(1, 12, abbr) } };
  if (period.nElapsed <= 0) return { key: "year.header.future" };
  const actual = monthSpan(1, period.nElapsed, abbr);
  const projected = monthSpan(period.nElapsed + 1, 12, abbr);
  if (!period.projectionBasis) return { key: "year.header.noBasis", values: { actual, projected } };
  return { key: "year.header.projected", values: { actual, projected, basis: monthSpan(period.projectionBasis[0], period.projectionBasis[1], abbr) } };
}

/** The month the Anual KPIs run up to ("até set"), or null for a year that has not started. */
export function yearToDateMonth(period: Pick<YearPeriod, "nElapsed" | "isPast">): number | null {
  if (period.isPast) return 12;
  return period.nElapsed > 0 ? Math.min(period.nElapsed, 12) : null;
}

/** Legend under the heatmap; names the month in progress only while the year runs. */
export function heatmapLegend(currentMonth: number, isPast: boolean, abbr: Abbr): Message {
  return !isPast && currentMonth >= 1 && currentMonth <= 12 ? { key: "year.heatmap.legend", values: { month: abbr(currentMonth) } } : { key: "year.heatmap.legendNoCurrent" };
}

export interface YearInsight {
  kind: "overrun" | "growth" | "seasonal";
  overMonths: number;
  nElapsed: number;
  avg: number;
  budget: number;
  suggested: number;
  first3: number | null;
  last3: number | null;
  growth: number | null;
  peakMonth: number;
  peakValue: number;
}

export interface InsightCopy {
  title: Message;
  body: Message;
  /** "Ajustar para R$ X?": a new version of the budget with this amount. */
  adjust: { amount: number; label: Message } | null;
}

/**
 * Tendências do ano, per kind (mockup AnnualBudget):
 * - overrun: "Mercado: passou do orçado em 5 de 9 meses" · "Média de R$ 1.990/mês contra R$ 2.000 orçados. Ajustar para R$ 2.000?"
 * - growth: "Software: subiu 18% no ano" · "Média de jan–mar R$ 1.220 → jun–ago R$ 1.437."
 * - seasonal: "Lazer: sazonal" · "Pico em jun (R$ 1.900). Talvez vire um orçamento anual."
 * `basis` is the months the last-three average covers (yearOverview.period.projectionBasis).
 */
export function insightCopy(insight: YearInsight, category: string, abbr: Abbr, money: Money, basis: readonly [number, number] | null): InsightCopy {
  if (insight.kind === "overrun") {
    return {
      title: { key: "year.insights.overrunTitle", values: { category, count: insight.overMonths, total: insight.nElapsed } },
      body: { key: "year.insights.overrunBody", values: { avg: money(insight.avg), budget: money(insight.budget) } },
      // Spending runs over the budget: only a higher amount makes sense to offer.
      adjust: insight.suggested - insight.budget >= 0.005 ? { amount: insight.suggested, label: { key: "year.insights.adjust", values: { amount: money(insight.suggested) } } } : null,
    };
  }
  if (insight.kind === "growth") {
    const last = basis ? monthSpan(basis[0], basis[1], abbr) : "";
    return {
      title: { key: "year.insights.growthTitle", values: { category, pct: Math.round((insight.growth ?? 0) * 100) } },
      body: {
        key: "year.insights.growthBody",
        values: { first: monthSpan(1, 3, abbr), firstAvg: money(insight.first3 ?? 0), last, lastAvg: money(insight.last3 ?? 0) },
      },
      adjust: null,
    };
  }
  return {
    title: { key: "year.insights.seasonalTitle", values: { category } },
    body: { key: "year.insights.seasonalBody", values: { month: abbr(insight.peakMonth), value: money(insight.peakValue) } },
    adjust: null,
  };
}

/**
 * The badge next to a budget (mockup BUDGETS: "PF" / "PJ"): the scope
 * key whose label it shows. Any business entity is "PJ"; a budget for every
 * entity is "Todas"; an entity the session does not know shows no label.
 */
export function entityBadgeKey(entityId: string | null, kinds: ReadonlyMap<string, string>): "scope.pf" | "scope.pj" | "scope.all" | null {
  if (!entityId) return "scope.all";
  const kind = kinds.get(entityId);
  if (!kind) return null;
  return kind === "personal" ? "scope.pf" : "scope.pj";
}
