import type { Period } from "@capital/server/modules/ledger/contracts";

/**
 * The view period on the client: the presets of "Período da view" (mockup
 * PERIODS 580–611), their month ranges for the hints in the menu, and the
 * ‹ › steps. The server resolves the same ranges (query-engine
 * resolvePeriod) and its `range` is what the period control shows.
 */

export const PERIOD_PRESETS = ["this_month", "last_month", "last_3m", "ytd", "last_12m", "all"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

/** Today's year and month in a timezone. */
export function currentMonth(timezone: string, now: Date = new Date()): YearMonth {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") };
}

function shift({ year, month }: YearMonth, months: number): YearMonth {
  const index = year * 12 + (month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const iso = ({ year, month }: YearMonth) => `${year}-${String(month).padStart(2, "0")}`;

/** First and last month ("YYYY-MM") of a preset at an offset; null for "all". Same rules as the server. */
export function presetMonths(preset: PeriodPreset, offset: number, today: YearMonth): { from: string; to: string } | null {
  switch (preset) {
    case "this_month": {
      const m = shift(today, offset);
      return { from: iso(m), to: iso(m) };
    }
    case "last_month": {
      const m = shift(today, offset - 1);
      return { from: iso(m), to: iso(m) };
    }
    case "last_3m":
      return { from: iso(shift(today, offset * 3 - 2)), to: iso(shift(today, offset * 3)) };
    case "ytd":
      return offset === 0
        ? { from: iso({ year: today.year, month: 1 }), to: iso(today) }
        : { from: iso({ year: today.year + offset, month: 1 }), to: iso({ year: today.year + offset, month: 12 }) };
    case "last_12m":
      return { from: iso(shift(today, offset * 12 - 11)), to: iso(shift(today, offset * 12)) };
    case "all":
      return null;
  }
}

/** The preset of a period, null for a custom range. */
export function presetOf(period: Period): PeriodPreset | null {
  return "preset" in period ? period.preset : null;
}

export function offsetOf(period: Period): number {
  return "preset" in period ? (period.offset ?? 0) : 0;
}

/** ‹ › show for every preset but "all" (and not for a custom range). */
export function isSteppable(period: Period): boolean {
  const preset = presetOf(period);
  return preset !== null && preset !== "all";
}

/** The period one step back (−1) or forward (+1); forward stops at the current period. */
export function stepPeriod(period: Period, delta: -1 | 1): Period {
  if (!("preset" in period)) return period;
  const offset = Math.min(0, (period.offset ?? 0) + delta);
  return { preset: period.preset, offset };
}

/** Last day of a "YYYY-MM" month as "YYYY-MM-DD". */
export function monthEndDate(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Today as "YYYY-MM-DD" in a timezone. */
export function todayIso(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First and last day ("YYYY-MM-DD") a period covers on the client; null for "all". */
export function periodDays(period: Period, today: YearMonth): { from: string; to: string } | null {
  if (!("preset" in period)) return { from: period.from, to: period.to };
  const months = presetMonths(period.preset, period.offset ?? 0, today);
  return months ? { from: `${months.from}-01`, to: monthEndDate(months.to) } : null;
}
