import { MONTHS_PER_YEAR } from './rates';

/**
 * Convert a (possibly fractional or Infinite) months-to-FIRE into a calendar
 * date. The only place in the engine that touches `Date` — kept at the boundary
 * so the core math stays trivially testable and date-library-free.
 * Returns null when FIRE is never reached.
 */
export function projectFireDate(startDate: Date, monthsToFire: number): Date | null {
  if (!Number.isFinite(monthsToFire)) return null;
  const date = new Date(startDate.getTime());
  const wholeMonths = Math.floor(monthsToFire);
  const fractionalDays = Math.round((monthsToFire - wholeMonths) * 30);
  date.setMonth(date.getMonth() + wholeMonths);
  date.setDate(date.getDate() + fractionalDays);
  return date;
}

/** Convenience: the calendar year FIRE is reached, or null. */
export function projectFireYear(startDate: Date, monthsToFire: number): number | null {
  const date = projectFireDate(startDate, monthsToFire);
  return date ? date.getFullYear() : null;
}

/** Months between now and the start of a target calendar year. */
export function monthsUntilYear(targetYear: number, now: Date): number {
  const months = (targetYear - now.getFullYear()) * MONTHS_PER_YEAR - now.getMonth();
  return Math.max(0, months);
}
