import { parseLocalDate } from "@capital/server/lib/date-utils";

/**
 * Parse date range filters for MCP tools to be inclusive of the entire calendar day.
 * 
 * The UI stores dates at noon UTC (12:00:00.000Z) to handle all timezones.
 * To make date filters inclusive:
 * - dateFrom: Start at the beginning of the day (00:00:00.000Z)
 * - dateTo: End at the end of the day (23:59:59.999Z)
 * 
 * This ensures queries capture both MCP-created transactions (noon UTC)
 * and any transactions that might exist at other times of day.
 * 
 * @param dateFrom - Optional start date (YYYY-MM-DD or ISO string)
 * @param dateTo - Optional end date (YYYY-MM-DD or ISO string)
 * @returns Object with normalized dateFrom and dateTo, or empty object if both are null
 */
export function parseDateRangeFilter(
  dateFrom?: string,
  dateTo?: string
): { dateFrom?: Date; dateTo?: Date } {
  if (!dateFrom && !dateTo) {
    return {};
  }

  const result: { dateFrom?: Date; dateTo?: Date } = {};

  if (dateFrom) {
    const parsed = parseLocalDate(dateFrom);
    // Set to start of day (00:00:00.000Z) to be inclusive
    parsed.setUTCHours(0, 0, 0, 0);
    result.dateFrom = parsed;
  }

  if (dateTo) {
    const parsed = parseLocalDate(dateTo);
    // Set to end of day (23:59:59.999Z) to be inclusive
    parsed.setUTCHours(23, 59, 59, 999);
    result.dateTo = parsed;
  }

  return result;
}
