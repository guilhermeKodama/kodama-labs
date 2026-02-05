import { parseISO } from "date-fns";

/**
 * Parse a date string preserving the local date.
 * 
 * For date-only strings like "2026-02-06", we want to treat it as Feb 6 regardless of timezone.
 * Without this, `new Date("2026-02-06")` interprets it as midnight UTC, which becomes
 * Feb 5 at 9 PM in UTC-3 (Brazil).
 */
export function parseLocalDate(dateString: string): Date {
  // If it's a date-only string (YYYY-MM-DD), parse it as local date at noon to avoid timezone issues
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0); // Use noon to avoid DST issues
  }
  // For ISO strings with time, use parseISO
  return parseISO(dateString);
}
