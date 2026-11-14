/**
 * Backtest of the budget projection against the one it replaced.
 *
 * A point is "on day D of month M, what will M close at?", scored against
 * the closed month. The old forecast is replayed with the day it really
 * used (a card purchase from the previous cycle on its purchase day, e.g.
 * the 28th); the new one with the corrected day (day 1 of the month it
 * counts in). Nothing here reads or prints a description.
 *
 * The synthetic generator is seeded, so the table in the pull request is
 * reproducible: `pnpm --filter @wallex/capital projection:backtest`.
 */

import {
  detectRecurring,
  dueRuleOccurrences,
  legacyFutureMonth,
  legacyMonthProjection,
  legacyTrend,
  projectFutureMonth,
  projectMonth,
  recurringExpectation,
  robustTrend,
  type ChargeObservation,
  type HistoryMonth,
  type RuleOccurrence,
} from "./project";

export interface Charge {
  /** Day in the month it counts in (1 for a card purchase of the previous cycle). */
  day: number;
  /** Day the old query used: the purchase's own day of month. */
  rawDay: number;
  /** Net: a refund is negative. */
  amount: number;
  /** Recurring key (merchant or rule); none for one-off spend. */
  key?: string;
}

export interface Series {
  household: number;
  kind: "fixo" | "variavel";
  /** Monthly budget in force; 0 without one. */
  budget: number;
  /** Index of the first month with data; earlier months do not exist. */
  start: number;
  months: Charge[][];
  /** Keys that a recurring rule in the app books (`rule:` keys). Synthetic series only. */
  ruleKeys?: ReadonlySet<string>;
  /**
   * Rule state, the way dueRules reads it. Set by the database backtest
   * (possibly empty). Absent on synthetic series, which still treat a rule
   * as due only when its own charge has not posted yet.
   */
  rules?: readonly SeriesRule[];
  /** YYYY-MM of month index 0. Synthetic series start at 2025-01. */
  origin?: string;
}

/** One active expense rule, in the calendar of `origin`. */
export interface SeriesRule {
  /** Charge key without the `rule:` prefix (`r<id>` in the database mode). */
  key: string;
  /** Base-currency amount of one occurrence. */
  amount: number;
  /** nextDueDate, YYYY-MM-DD. May sit months before the month being scored. */
  nextDue: string;
  frequency: string;
  /** YYYY-MM months that booked an entry under this rule. */
  bookedMonths: readonly string[];
}

export const BACKTEST_DAYS = [5, 10, 15, 20, 25] as const;
const DAYS_IN_MONTH = 30;
const HISTORY = 6;

/* ------------------------------ generator ----------------------------- */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Households with the situations that broke the old forecast: rent whose
 * day drifts and sometimes posts early, several bills in one fixed
 * category, card subscriptions across the closing day, an annual charge,
 * groceries, restaurants on the card, shopping with rare large one-offs
 * and refunds, lumpy health spend, short histories and missing budgets.
 */
export function syntheticSeries(households = 300, months = 14, seed = 20261114): Series[] {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const logn = (mean: number, sigma = 0.5) => mean * Math.exp(sigma * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()) - (sigma * sigma) / 2);
  const money = (v: number) => Math.round(v * 100) / 100;
  const out: Series[] = [];

  for (let h = 0; h < households; h++) {
    const start = r() < 0.35 ? int(8, 13) : int(0, 7);
    const closing = int(1, 28);
    /** A card purchase on `purchaseDay` of some month: counts in the next statement when after the closing day. */
    const card = (purchaseDay: number): { day: number; rawDay: number } => (purchaseDay > closing ? { day: 1, rawDay: purchaseDay } : { day: purchaseDay, rawDay: purchaseDay });
    const blank = () => Array.from({ length: months }, () => [] as Charge[]);

    // Casa (fixo): rent + condomínio + energia.
    const rent = money(1500 + r() * 14000);
    const rentDay = int(1, 25);
    const raiseAt = r() < 0.3 ? int(2, months - 1) : months;
    const condo = money(300 + r() * 1500);
    const condoDay = int(1, 28);
    const energy = 120 + r() * 400;
    const energyDay = int(5, 25);
    const casa = blank();
    for (let m = start; m < months; m++) {
      const early = r() < 0.2;
      const day = early ? int(1, 9) : Math.min(28, Math.max(1, rentDay + int(-3, 3)));
      casa[m].push({ day, rawDay: day, amount: money(rent * (m >= raiseAt ? 1.08 : 1)), key: "rent" });
      casa[m].push({ day: condoDay, rawDay: condoDay, amount: condo, key: "condo" });
      const e = Math.min(28, Math.max(1, energyDay + int(-2, 2)));
      casa[m].push({ day: e, rawDay: e, amount: money(energy * (0.75 + r() * 0.5)), key: "energy" });
    }
    const ruleKeys = r() < 0.5 ? new Set(["rent"]) : new Set<string>();
    out.push({ household: h, kind: "fixo", budget: money((rent + condo + energy) * (0.95 + r() * 0.2)), start, months: casa, ruleKeys });

    // Assinaturas (fixo, card): several monthly items, one annual charge, a cancellation.
    const items = Array.from({ length: int(3, 7) }, (_, i) => ({ key: `sub${i}`, amount: money(15 + r() * 70), day: int(1, 31), stopAt: r() < 0.15 ? int(start + 1, months) : months }));
    const annualAt = r() < 0.4 ? int(start, months - 1) : -1;
    const subs = blank();
    for (let m = start; m < months; m++) {
      for (const item of items) if (m < item.stopAt) subs[m].push({ ...card(item.day), amount: item.amount, key: item.key });
      if (m === annualAt) subs[m].push({ ...card(int(1, 31)), amount: money(250 + r() * 500) });
    }
    const subsBudget = items.reduce((s, i) => s + i.amount, 0);
    out.push({ household: h, kind: "fixo", budget: money(subsBudget * (0.9 + r() * 0.3)), start, months: subs });

    // Mercado (variável): a few trips a month.
    const groceries = 600 + r() * 2500;
    const mercado = blank();
    for (let m = start; m < months; m++) {
      const trips = int(3, 7);
      for (let t = 0; t < trips; t++) {
        const day = int(1, 30);
        mercado[m].push({ day, rawDay: day, amount: money(logn(groceries / trips, 0.35)) });
      }
    }
    out.push({ household: h, kind: "variavel", budget: r() < 0.1 ? 0 : money(groceries * (0.9 + r() * 0.3)), start, months: mercado });

    // Restaurantes (variável, card).
    const meals = 4 + r() * 12;
    const restaurantes = blank();
    for (let m = start; m < months; m++) {
      const n = Math.max(0, Math.round(meals + (r() - 0.5) * 6));
      for (let t = 0; t < n; t++) restaurantes[m].push({ ...card(int(1, 31)), amount: money(logn(70, 0.6)) });
    }
    out.push({ household: h, kind: "variavel", budget: r() < 0.15 ? 0 : money(meals * 70 * (0.9 + r() * 0.4)), start, months: restaurantes });

    // Compras (variável): rare large one-offs and refunds.
    const compras = blank();
    let returned = 0;
    for (let m = start; m < months; m++) {
      const n = int(0, 3);
      for (let t = 0; t < n; t++) compras[m].push({ ...card(int(1, 31)), amount: money(logn(300, 0.8)) });
      // A large purchase returned the month after: that month nets negative.
      if (returned) {
        const day = int(1, 30);
        compras[m].push({ day, rawDay: day, amount: -returned });
        returned = 0;
      }
      if (r() < 0.06) {
        const big = money(3000 + r() * 12000);
        compras[m].push({ ...card(int(1, 31)), amount: big });
        if (r() < 0.4) returned = big;
      }
      if (r() < 0.1) {
        const day = int(1, 30);
        compras[m].push({ day, rawDay: day, amount: -money(100 + r() * 1500) });
      }
    }
    out.push({ household: h, kind: "variavel", budget: r() < 0.2 ? 0 : money(800 + r() * 1200), start, months: compras });

    // Saúde (variável, lumpy).
    const saude = blank();
    for (let m = start; m < months; m++) {
      if (r() < 0.7) {
        const day = int(1, 30);
        saude[m].push({ day, rawDay: day, amount: money(200 + r() * 600) });
      }
    }
    out.push({ household: h, kind: "variavel", budget: money(300 + r() * 500), start, months: saude });
  }
  return out;
}

/* ------------------------------ scoring ------------------------------ */

const sum = (charges: readonly Charge[], pick: (c: Charge) => boolean = () => true) => charges.filter(pick).reduce((s, c) => s + c.amount, 0);
/** Month index 0 is `origin` (synthetic series: 2025-01). Negative indexes step back. */
function monthYm(origin: string, index: number): string {
  const base = Number(origin.slice(0, 4)) * 12 + Number(origin.slice(5, 7)) - 1;
  const abs = base + index;
  const year = Math.floor(abs / 12);
  const month = (abs % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Rules due in month `t`, from the rule's nextDueDate the way the app's
 * dueRules does. A nextDueDate before the month is not pending unless the
 * rule booked in that month or the two before it.
 */
function dueFromRules(series: Series, t: number): RuleOccurrence[] {
  const origin = series.origin ?? "2025-01";
  const month = monthYm(origin, t);
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const monthStart = new Date(Date.UTC(year, m - 1, 1));
  const monthEnd = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999));
  const recent = new Set([month, monthYm(origin, t - 1), monthYm(origin, t - 2)]);
  return dueRuleOccurrences(
    (series.rules ?? []).map((rule) => ({
      key: `rule:${rule.key}`,
      amount: rule.amount,
      nextDue: new Date(`${rule.nextDue}T12:00:00Z`),
      frequency: rule.frequency,
      endDate: null,
      bookedRecently: rule.bookedMonths.some((booked) => recent.has(booked)),
    })),
    monthStart,
    monthEnd,
  );
}

export interface Point {
  household: number;
  month: number;
  kind: "fixo" | "variavel";
  day: number;
  /** Months of history (0–6). */
  depth: number;
  actual: number;
  old: number;
  neu: number;
}

/** Forecast of month `t` as of `day`, old and new. */
function pointsFor(series: Series, t: number, day: number): Point | null {
  if (t < series.start) return null;
  const month = series.months[t] ?? [];
  const priorIdx = [...Array(t).keys()].filter((i) => i >= series.start && i >= t - HISTORY && (series.months[i]?.length ?? 0) > 0);
  const spent = sum(month, (c) => c.day <= day);
  const actual = sum(month);

  const oldHistory = priorIdx.map((i) => ({ total: sum(series.months[i] ?? []), rest: sum(series.months[i] ?? [], (c) => c.rawDay > day) }));
  const old = legacyMonthProjection({ spent, committed: spent, daysElapsed: day, daysInMonth: DAYS_IN_MONTH, totals: oldHistory.map((h) => h.total), tails: oldHistory.map((h) => h.rest) });

  const history: HistoryMonth[] = priorIdx.map((i) => ({ total: sum(series.months[i] ?? []), rest: sum(series.months[i] ?? [], (c) => c.day > day) }));
  const origin = series.origin ?? "2025-01";
  const observations: ChargeObservation[] = [];
  for (const i of [...priorIdx, t]) {
    for (const c of series.months[i] ?? []) {
      if (!c.key || c.amount <= 0 || (i === t && c.day > day)) continue;
      const key = series.ruleKeys?.has(c.key) ? `rule:${c.key}` : c.key;
      observations.push({ month: monthYm(origin, i), key, day: c.day, amount: c.amount });
    }
  }
  const bills = series.kind === "fixo" ? detectRecurring(observations, monthYm(origin, t)) : [];
  // Database mode replays rule state (a stale nextDueDate included). Synthetic
  // series have no rule state: a rule is due when its own charge posts later.
  const due: RuleOccurrence[] = series.rules
    ? dueFromRules(series, t)
    : [...(series.ruleKeys ?? [])].flatMap((key) => {
        const charge = month.find((c) => c.key === key);
        return charge && charge.day > day ? [{ key: `rule:${key}`, amount: charge.amount }] : [];
      });
  const booked = observations.filter((c) => c.month === monthYm(origin, t)).map((c) => ({ key: c.key, amount: c.amount }));
  const neu = projectMonth({ kind: series.kind, spent, committed: spent, budget: series.budget, elapsed: day / DAYS_IN_MONTH, history, recurring: recurringExpectation(bills, due, booked) }).total;
  return { household: series.household, month: t, kind: series.kind, day, depth: priorIdx.length, actual, old, neu };
}

export function intraMonthPoints(all: readonly Series[]): Point[] {
  const points: Point[] = [];
  for (const series of all) for (let t = 0; t < series.months.length; t++) for (const day of BACKTEST_DAYS) {
    const p = pointsFor(series, t, day);
    if (p) points.push(p);
  }
  return points;
}

export interface FuturePoint {
  kind: "fixo" | "variavel";
  actual: number;
  old: number;
  neu: number;
}

export function futurePoints(all: readonly Series[]): FuturePoint[] {
  const out: FuturePoint[] = [];
  for (const series of all) {
    for (let t = series.start + 1; t < series.months.length; t++) {
      const complete = series.months.slice(series.start, t).map((m) => sum(m));
      const first = complete.findIndex((v) => v > 0);
      const sample = first === -1 ? [] : complete.slice(first).slice(-HISTORY);
      out.push({ kind: series.kind, actual: sum(series.months[t] ?? []), old: legacyFutureMonth(complete, 0), neu: projectFutureMonth({ history: sample, budget: series.budget || null, committed: 0 }) });
    }
  }
  return out;
}

export interface TrendCount {
  shownOld: number;
  shownNew: number;
  wildOld: number;
  wildNew: number;
  negativeFutureOld: number;
  negativeFutureNew: number;
}

export function trendCounts(all: readonly Series[], future: readonly FuturePoint[]): TrendCount {
  const counts: TrendCount = { shownOld: 0, shownNew: 0, wildOld: 0, wildNew: 0, negativeFutureOld: 0, negativeFutureNew: 0 };
  for (const series of all) {
    const complete = series.months.slice(series.start, series.months.length - 1).map((m) => sum(m));
    const old = legacyTrend(complete);
    const neu = robustTrend(complete);
    if (old != null) counts.shownOld += 1;
    if (neu != null) counts.shownNew += 1;
    if (old != null && Math.abs(old) > 2) counts.wildOld += 1;
    if (neu != null && Math.abs(neu) > 2) counts.wildNew += 1;
  }
  for (const p of future) {
    if (p.old < 0) counts.negativeFutureOld += 1;
    if (p.neu < 0) counts.negativeFutureNew += 1;
  }
  return counts;
}

export interface ErrorRow {
  label: string;
  n: number;
  maeOld: number;
  maeNew: number;
  mapeOld: number;
  mapeNew: number;
  /** Share of points within ±10% of the actual. */
  hitOld: number;
  hitNew: number;
}

export function errors(label: string, points: readonly { actual: number; old: number; neu: number }[]): ErrorRow {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  const usable = points.filter((p) => Math.abs(p.actual) > 1);
  const ape = (p: { actual: number }, v: number) => Math.abs(v - p.actual) / Math.abs(p.actual);
  return {
    label,
    n: points.length,
    maeOld: mean(points.map((p) => Math.abs(p.old - p.actual))),
    maeNew: mean(points.map((p) => Math.abs(p.neu - p.actual))),
    mapeOld: mean(usable.map((p) => ape(p, p.old))),
    mapeNew: mean(usable.map((p) => ape(p, p.neu))),
    hitOld: mean(usable.map((p) => (ape(p, p.old) <= 0.1 ? 1 : 0))),
    hitNew: mean(usable.map((p) => (ape(p, p.neu) <= 0.1 ? 1 : 0))),
  };
}

/**
 * The cards: per household, month and day, the sum of its Fixo series,
 * its Variável series and both. These are the numbers "Projeção fim do
 * mês" shows under each filter.
 */
export function kpiPoints(points: readonly Point[]): Record<"fixo" | "variavel" | "total", { actual: number; old: number; neu: number }[]> {
  const groups = new Map<string, { actual: number; old: number; neu: number }>();
  for (const p of points) {
    for (const kind of [p.kind, "total"]) {
      const key = `${kind}|${p.household}|${p.month}|${p.day}`;
      const g = groups.get(key) ?? { actual: 0, old: 0, neu: 0 };
      g.actual += p.actual;
      g.old += p.old;
      g.neu += p.neu;
      groups.set(key, g);
    }
  }
  const of = (kind: string) => [...groups.entries()].filter(([key]) => key.startsWith(`${kind}|`)).map(([, value]) => value);
  return { fixo: of("fixo"), variavel: of("variavel"), total: of("total") };
}

export interface Report {
  byCard: ErrorRow[];
  byKind: ErrorRow[];
  byDay: ErrorRow[];
  byDepth: ErrorRow[];
  future: ErrorRow[];
  /** Months whose net spend is negative. Left out of the tables above: a large credit (a fee reversal) dominates MAPE. */
  negativeActual: ErrorRow;
  counts: TrendCount;
  series: number;
}

export function runBacktest(all: readonly Series[], monthPoints?: readonly Point[]): Report {
  const points = monthPoints ?? intraMonthPoints(all);
  const future = futurePoints(all);
  const depthLabel = (d: number) => (d === 0 ? "0 meses" : d <= 2 ? "1–2 meses" : "3–6 meses");
  // A month that nets negative (a fee reversal, a refund larger than the spend) is not a forecast of the usual month.
  const scored = points.filter((p) => p.actual >= 0);
  const cards = kpiPoints(scored);
  return {
    series: all.length,
    byCard: [errors("Fixo", cards.fixo), errors("Variável", cards.variavel), errors("Total", cards.total)],
    byKind: [errors("Fixo", scored.filter((p) => p.kind === "fixo")), errors("Variável", scored.filter((p) => p.kind === "variavel")), errors("Todas", scored)],
    byDay: BACKTEST_DAYS.map((d) => errors(`dia ${d}`, scored.filter((p) => p.day === d))),
    byDepth: ["0 meses", "1–2 meses", "3–6 meses"].map((label) => errors(label, scored.filter((p) => depthLabel(p.depth) === label))),
    future: [errors("Fixo", future.filter((p) => p.kind === "fixo" && p.actual >= 0)), errors("Variável", future.filter((p) => p.kind === "variavel" && p.actual >= 0)), errors("Todas", future.filter((p) => p.actual >= 0))],
    negativeActual: errors("Gasto líquido negativo", points.filter((p) => p.actual < 0)),
    counts: trendCounts(all, future),
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

function table(title: string, rows: readonly ErrorRow[]): string {
  const head = `| ${title} | pontos | MAE antigo | MAE novo | MAPE antigo | MAPE novo | ±10% antigo | ±10% novo |\n|---|---:|---:|---:|---:|---:|---:|---:|`;
  return [head, ...rows.map((r) => `| ${r.label} | ${r.n} | ${brl(r.maeOld)} | ${brl(r.maeNew)} | ${pct(r.mapeOld)} | ${pct(r.mapeNew)} | ${pct(r.hitOld)} | ${pct(r.hitNew)} |`)].join("\n");
}

/** Markdown tables of errors and counts. Never a description or a single transaction. */
export function formatReport(report: Report): string {
  const c = report.counts;
  return [
    table("Card \"Projeção fim do mês\"", report.byCard),
    table("Fim do mês, por categoria", report.byKind),
    table("Fim do mês, por dia", report.byDay),
    table("Fim do mês, por histórico", report.byDepth),
    table("Meses futuros (Anual)", report.future),
    table("Fora das tabelas: mês com gasto líquido negativo", [report.negativeActual]),
    `| Contagens | antigo | novo |\n|---|---:|---:|\n| Tendência exibida | ${c.shownOld} | ${c.shownNew} |\n| Tendência acima de ±200% | ${c.wildOld} | ${c.wildNew} |\n| Mês futuro negativo | ${c.negativeFutureOld} | ${c.negativeFutureNew} |`,
  ].join("\n\n");
}
