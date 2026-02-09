import { parseISO, startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

/**
 * Normalize a date to noon UTC (12:00:00.000Z).
 * This provides a 12-hour buffer in both directions, handling timezones from UTC-12 to UTC+12.
 */
export function toNoonUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

/**
 * Parse a date string and normalize to noon UTC.
 *
 * For date-only strings like "2026-02-06", we want to treat it as Feb 6 regardless of timezone.
 * By using noon UTC, even users in extreme timezones (UTC-12 to UTC+12) will see the correct date.
 */
export function parseLocalDate(dateString: string): Date {
  // If it's a date-only string (YYYY-MM-DD), parse it as noon UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }
  // For ISO strings with time, normalize to noon UTC to preserve the date
  const parsed = parseISO(dateString);
  return toNoonUTC(parsed);
}

/**
 * Format a Date to YYYY-MM-DD string using UTC date parts.
 * This ensures the formatted date matches the stored UTC date.
 * Alias: toDateString
 */
export function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Format a DB Date as "YYYY-MM-DD" for API responses.
 * Used for date-only fields (transaction date, closing date, etc.)
 * NOT for timestamps (createdAt, updatedAt) which keep toISOString().
 */
export const toDateString = formatDateOnly;

// ============================================
// Timezone-aware utilities
// ============================================

/**
 * Get "today" in the user's timezone.
 */
export function getUserToday(timezone: string): Date {
  return toZonedTime(new Date(), timezone);
}

/**
 * Get current year in the user's timezone.
 */
export function getUserCurrentYear(timezone: string): number {
  return getUserToday(timezone).getFullYear();
}

/**
 * Get current month (1-12) in the user's timezone.
 */
export function getUserCurrentMonth(timezone: string): number {
  return getUserToday(timezone).getMonth() + 1;
}

/**
 * Get the start and end of a specific month for date-range queries.
 */
export function getMonthRange(year: number, month: number): { start: Date; end: Date } {
  const date = new Date(year, month - 1, 1, 12, 0, 0);
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
  };
}

/**
 * Get the next N months from a reference date, useful for installment projections.
 */
export function getProjectedMonths(
  anchorDate: Date,
  count: number
): Array<{ year: number; month: number; date: Date }> {
  const result: Array<{ year: number; month: number; date: Date }> = [];
  for (let i = 1; i <= count; i++) {
    const projected = addMonths(anchorDate, i);
    result.push({
      year: projected.getFullYear(),
      month: projected.getMonth() + 1,
      date: projected,
    });
  }
  return result;
}
