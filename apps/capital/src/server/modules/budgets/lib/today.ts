/** The user's calendar today in their timezone, with the instant its last millisecond ends in UTC-date terms. */
export interface UserToday {
  y: number;
  /** 1-12 */
  m: number;
  d: number;
  /** 23:59:59.999 UTC of that calendar date: every noon-UTC entry dated today or earlier is <= it. */
  end: Date;
  /** 00:00 UTC of that calendar date. */
  start: Date;
  /** YYYY-MM-DD */
  iso: string;
}

export function todayIn(timezone: string, now = new Date()): UserToday {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = p.split("-").map(Number);
  return { y, m, d, start: new Date(Date.UTC(y, m - 1, d)), end: new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)), iso: p };
}

export const DAY_MS = 86_400_000;
