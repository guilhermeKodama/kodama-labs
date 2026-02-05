import { parseISO } from "date-fns";

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
 */
export function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
