/**
 * Months and days of the Orçamentos screen. Budgets work on calendar months
 * in the user's timezone (the server's todayIn does the same), so "today"
 * comes from the user's zone, never from the browser's.
 */

export interface YearMonth {
  year: number;
  /** 1-12 */
  month: number;
}

export interface DayParts extends YearMonth {
  day: number;
  /** YYYY-MM-DD */
  iso: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day `now` falls on in `timeZone` (an invalid or missing zone falls back to UTC). */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): DayParts {
  let iso: string;
  try {
    iso = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    iso = now.toISOString().slice(0, 10);
  }
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day, iso: `${year}-${pad(month)}-${pad(day)}` };
}

/** "2026-09" */
export const monthKey = ({ year, month }: YearMonth) => `${year}-${pad(month)}`;

/** "2026-09" → {2026, 9}; null for anything else. */
export function parseMonthKey(value: string | null | undefined): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 && year >= 1900 && year <= 2999 ? { year, month } : null;
}

/** "2026" → 2026; null for anything else. */
export function parseYear(value: string | null | undefined): number | null {
  if (!/^\d{4}$/.test(value ?? "")) return null;
  const year = Number(value);
  return year >= 1900 && year <= 2999 ? year : null;
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Negative when a is earlier than b. */
export const compareMonths = (a: YearMonth, b: YearMonth) => a.year * 12 + a.month - (b.year * 12 + b.month);

export const sameMonth = (a: YearMonth, b: YearMonth) => compareMonths(a, b) === 0;

/**
 * The months a "A partir de" select offers: `before` months before
 * `center` through `after` months after it, never earlier than `min`
 * (a budget version cannot change before it starts).
 */
export function monthOptions(center: YearMonth, before: number, after: number, min?: YearMonth | null): YearMonth[] {
  const out: YearMonth[] = [];
  for (let delta = -before; delta <= after; delta++) {
    const month = shiftMonth(center, delta);
    if (!min || compareMonths(month, min) >= 0) out.push(month);
  }
  return out;
}

/** Days in a month (28-31). */
export const daysInMonth = ({ year, month }: YearMonth) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** "2026-09-01" → {2026, 9}; null when not a date. */
export function monthOfDate(value: string | null | undefined): YearMonth | null {
  return parseMonthKey((value ?? "").slice(0, 7));
}
