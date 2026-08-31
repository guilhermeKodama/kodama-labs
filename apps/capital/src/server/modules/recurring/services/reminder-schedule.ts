import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import type { RemindersConfig } from "@/lib/validations/reminders";

// Pure, Prisma-free scheduling math for the reminder push cron — kept
// separate from send-due-reminders.ts (the orchestrator) so it's unit
// testable without a database. All calendar-day arithmetic here works on
// "YYYY-MM-DD" strings via Date.UTC, deliberately avoiding date-fns's
// addDays/differenceInCalendarDays (those use the HOST process's local
// timezone for calendar math, which would make this file's behavior depend
// on where it runs). date-fns-tz's fromZonedTime/formatInTimeZone are the
// only place an actual IANA timezone (the user's, not the server's) enters
// the computation.

/** A pre-due/day-of window stays live for 24h after its scheduled instant —
 * long enough to absorb a cron hiccup, short enough not to resurrect a
 * missed reminder days later. */
export const REMINDER_STALENESS_MS = 24 * 60 * 60 * 1000;

export interface ReminderInstance {
  /** >= 0: a configured pre-due/day-of entry. < 0: overdue nag, -N = N days overdue. */
  daysBefore: number;
  scheduledAt: Date;
  kind: "pre-due" | "due-today" | "overdue";
}

/** Add/subtract whole calendar days to a "YYYY-MM-DD" string via UTC math only. */
function addCalendarDaysUTC(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return formatDateOnly(new Date(Date.UTC(y, m - 1, d + delta, 12)));
}

/** Whole-day difference b - a between two "YYYY-MM-DD" strings, TZ-independent. */
function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function withinStaleness(scheduledAt: Date, now: Date): boolean {
  const delta = now.getTime() - scheduledAt.getTime();
  return delta >= 0 && delta <= REMINDER_STALENESS_MS;
}

/** nextDueDate is noon-UTC; its UTC date parts ARE the calendar due date. */
export function getDueYmd(nextDueDate: Date): string {
  return formatDateOnly(nextDueDate);
}

/**
 * Configured entries (daysBefore >= 0) whose scheduled local time has
 * arrived and is still within the staleness window.
 */
export function computePreDueInstances(
  config: RemindersConfig,
  nextDueDate: Date,
  timezone: string,
  now: Date
): ReminderInstance[] {
  const dueYmd = getDueYmd(nextDueDate);
  const instances: ReminderInstance[] = [];

  for (const entry of config.entries) {
    const targetYmd = addCalendarDaysUTC(dueYmd, -entry.daysBefore);
    const scheduledAt = fromZonedTime(`${targetYmd}T${entry.time}:00`, timezone);
    if (withinStaleness(scheduledAt, now)) {
      instances.push({
        daysBefore: entry.daysBefore,
        scheduledAt,
        kind: entry.daysBefore === 0 ? "due-today" : "pre-due",
      });
    }
  }

  return instances;
}

/**
 * The daily overdue nag, if enabled and the item is at least one full day
 * past due in the user's timezone. Never fires on the due date itself —
 * daysOverdue starts at 1 (the day AFTER D), so it never collides with the
 * daysBefore:0 "due today" entry on the same calendar day.
 */
export function computeOverdueInstance(
  config: RemindersConfig,
  nextDueDate: Date,
  timezone: string,
  now: Date
): ReminderInstance | null {
  if (!config.overdue.enabled) return null;

  const dueYmd = getDueYmd(nextDueDate);
  const todayYmd = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const daysOverdue = daysBetweenYmd(dueYmd, todayYmd);

  if (daysOverdue < 1) return null;

  const scheduledAt = fromZonedTime(`${todayYmd}T${config.overdue.time}:00`, timezone);
  if (!withinStaleness(scheduledAt, now)) return null;

  return { daysBefore: -daysOverdue, scheduledAt, kind: "overdue" };
}

/** Every instance due to fire right now for one recurring item. */
export function computeDueReminderInstances(
  config: RemindersConfig,
  nextDueDate: Date,
  timezone: string,
  now: Date
): ReminderInstance[] {
  const instances = computePreDueInstances(config, nextDueDate, timezone, now);
  const overdue = computeOverdueInstance(config, nextDueDate, timezone, now);
  if (overdue) instances.push(overdue);
  return instances;
}
