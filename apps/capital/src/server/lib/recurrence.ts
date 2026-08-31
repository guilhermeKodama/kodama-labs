import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import type { RecurrenceFrequency } from "@/generated/prisma";
import { toNoonUTC } from "./date-utils";

/**
 * Calculate the next occurrence date based on frequency, normalized to noon
 * UTC. Shared by the process-recurring cron, mark-paid, and skip-occurrence —
 * previously duplicated across those call sites.
 */
export function getNextOccurrence(currentDate: Date, frequency: RecurrenceFrequency): Date {
  const date = toNoonUTC(currentDate);
  switch (frequency) {
    case "daily":
      return addDays(date, 1);
    case "weekly":
      return addWeeks(date, 1);
    case "monthly":
      return addMonths(date, 1);
    case "yearly":
      return addYears(date, 1);
    default:
      return addMonths(date, 1);
  }
}
