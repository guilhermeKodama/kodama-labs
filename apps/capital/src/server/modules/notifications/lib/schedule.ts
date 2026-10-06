/**
 * Calendar math for the notification senders, in the user's timezone.
 * Pure: dates are "YYYY-MM-DD" strings and every computation goes through
 * Date.UTC, so the result never depends on the server's own timezone.
 */

export interface LocalNow {
  /** YYYY-MM-DD in the user's timezone. */
  ymd: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The user's local date, hour and weekday at `now` (UTC when the timezone is unknown). */
export function localNow(now: Date, timezone: string): LocalNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now);
  } catch {
    return localNow(now, "UTC");
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    year,
    month,
    day,
    hour: Number(get("hour")) % 24,
    dow: WEEKDAYS[get("weekday")] ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** `ymd` moved by whole calendar days. */
export function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** ISO 8601 week of a date, "2026-W41" (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeekKey(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Alerts that are not tied to a chosen hour (card bill closed, budget
 * threshold) go out between 09:00 and 21:59 local time; one found at night
 * waits for the morning (its dispatch key keeps it to one send).
 */
export const ALERT_HOURS = { from: 9, to: 22 } as const;

export function inAlertHours(local: Pick<LocalNow, "hour">): boolean {
  return local.hour >= ALERT_HOURS.from && local.hour < ALERT_HOURS.to;
}

/**
 * The week a weekly summary covers when it is due now: on `dow` from `hour`
 * on (the rest of that day absorbs a missed cron tick), the seven days
 * before today. Null on any other day or earlier hour.
 */
export function weeklySummaryWindow(local: LocalNow, schedule: { dow: number; hour: number }): { from: string; to: string; key: string } | null {
  if (local.dow !== schedule.dow || local.hour < schedule.hour) return null;
  return { from: addDays(local.ymd, -7), to: addDays(local.ymd, -1), key: isoWeekKey(local.ymd) };
}

/** How many days after its closing date a statement still counts as "just closed" (older ones are never announced). */
export const BILL_CLOSED_GRACE_DAYS = 3;

/**
 * A statement is closed once its closing day is over (purchases on the
 * closing day still belong to it). It is announced during the following
 * BILL_CLOSED_GRACE_DAYS days only, so turning the feature on never sends
 * old bills.
 */
export function billJustClosed(closingYmd: string, todayYmd: string): boolean {
  return closingYmd < todayYmd && closingYmd >= addDays(todayYmd, -BILL_CLOSED_GRACE_DAYS);
}
