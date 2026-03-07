/**
 * Parse a date from an API response as a local calendar date, avoiding timezone shift.
 *
 * Problem: `new Date("2026-02-01T00:00:00.000Z")` in UTC-3 becomes Jan 31 at 21:00 local.
 * Solution: Extract UTC year/month/day and create a local date at noon (safe from DST).
 *
 * Use this for all date-only fields from the API (date, closingDate, dueDate, startDate, etc.)
 * Do NOT use this for timestamps (createdAt, updatedAt) where the exact moment matters.
 */
export function parseLocalDate(input: Date | string): Date {
  if (typeof input === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const [y, m, d] = input.split('-').map(Number);
      return new Date(y, m - 1, d, 12, 0, 0);
    }
    const d = new Date(input);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
  }
  return new Date(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate(), 12, 0, 0);
}

/**
 * Format a Date as "YYYY-MM-DD" string for API requests or display.
 */
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Form input helpers — safe for <input type="date"> onChange / value binding
// ---------------------------------------------------------------------------

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Safely parse the value from an `<input type="date">`.
 * Returns `null` for empty or malformed strings so the caller can skip the
 * update and keep the previous valid date in the form state.
 *
 * Creates a **local** Date at noon (same convention as `parseLocalDate`).
 */
export function parseInputDate(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * UTC variant of `parseInputDate`.
 * Use for recurring / scheduled dates that must be timezone-independent.
 */
export function parseInputDateUTC(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/**
 * Format a Date to `YYYY-MM-DD` for `<input type="date">` using **local** parts.
 * Returns `''` for null / undefined / invalid dates so the input stays blank
 * instead of crashing.
 */
export function formatInputDate(date: Date | null | undefined): string {
  if (!isValidDate(date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * UTC variant of `formatInputDate`.
 * Use when the Date was created with `parseInputDateUTC` / `Date.UTC`.
 */
export function formatInputDateUTC(date: Date | null | undefined): string {
  if (!isValidDate(date)) return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
