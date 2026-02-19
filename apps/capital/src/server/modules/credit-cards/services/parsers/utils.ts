/**
 * Shared utilities for CSV bill parsing.
 * These are bank-agnostic helpers used by all parser configs.
 */

/**
 * Parse a CSV line respecting quoted fields.
 * Handles fields like: "Estorno de ""Mercadolivre*Mercadol"""
 */
export function parseCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === separator) {
        fields.push(current.trim());
        current = "";
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parse Brazilian number format (1.234,56) or standard (1234.56).
 * Preserves the sign (negative for refunds/credits).
 */
export function parseAmount(value: string): number {
  let cleaned = value.trim().replace(/"/g, "");
  // Remove currency symbols
  cleaned = cleaned.replace(/R\$\s?/g, "").replace(/\$/g, "").trim();

  // Brazilian format: 1.234,56 or -1.234,56
  if (cleaned.includes(",") && cleaned.indexOf(",") > cleaned.lastIndexOf(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // Format like 1,234.56 (standard US)
  else if (cleaned.includes(",") && cleaned.indexOf(".") > cleaned.lastIndexOf(",")) {
    cleaned = cleaned.replace(/,/g, "");
  }
  // Only comma: 1234,56
  else if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  }

  return parseFloat(cleaned);
}

/**
 * Parse date string from various formats.
 * Uses noon UTC to prevent timezone shifts (e.g. midnight UTC = previous day in UTC-3).
 */
export function parseDate(dateStr: string): Date {
  const cleaned = dateStr.trim().replace(/"/g, "");

  // Try YYYY-MM-DD (ISO format) — most common in Nubank CSVs
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(Date.UTC(
      parseInt(isoMatch[1]),
      parseInt(isoMatch[2]) - 1,
      parseInt(isoMatch[3]),
      12, 0, 0 // Noon UTC — safe from any timezone shift
    ));
  }

  // Try DD/MM/YYYY (Brazilian format)
  const brMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return new Date(Date.UTC(
      parseInt(brMatch[3]),
      parseInt(brMatch[2]) - 1,
      parseInt(brMatch[1]),
      12, 0, 0
    ));
  }

  // Fallback: append noon time if it looks like a date-only string
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return new Date(cleaned + "T12:00:00Z");
  }

  const date = new Date(cleaned);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return date;
}

/**
 * Compute the start of the current billing cycle (day after previous month's closing).
 * Credits/refunds dated before this are adjustments to a previous bill and should not
 * be counted in the current bill's total.
 */
export function computeCycleStart(closingDate: Date): Date {
  const closingDay = closingDate.getUTCDate();
  const closingMonth = closingDate.getUTCMonth();
  const closingYear = closingDate.getUTCFullYear();

  let prevMonth = closingMonth - 1;
  let prevYear = closingYear;
  if (prevMonth < 0) {
    prevMonth = 11;
    prevYear--;
  }

  // Handle months with fewer days (e.g. closing day 31 but Feb only has 28)
  const lastDayOfPrevMonth = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  const prevClosingDay = Math.min(closingDay, lastDayOfPrevMonth);

  // Cycle starts the day after the previous closing
  return new Date(Date.UTC(prevYear, prevMonth, prevClosingDay + 1, 12, 0, 0));
}
