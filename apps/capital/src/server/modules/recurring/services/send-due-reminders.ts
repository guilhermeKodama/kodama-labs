import type { PrismaClient } from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import { createFormatter, type Formatter } from "@/lib/format";
import { toNoonUTC } from "@capital/server/lib/date-utils";
import { sendToSubscriptions, type PushPayload } from "@capital/server/lib/web-push";
import { resolveLocale, st, type Locale } from "@capital/server/i18n";
import { notificationSettingsFor, type NotificationPrefs } from "@capital/server/modules/notifications/services/settings";
import { REMINDER_PUSH_URL } from "@capital/server/modules/push/constants";
import { remindersConfigSchema, type RemindersConfig } from "@/lib/validations/reminders";
import {
  computeDueReminderInstances,
  getDueYmd,
  type ReminderInstance,
} from "./reminder-schedule";

interface SendDueRemindersResult {
  rowsScanned: number;
  rowsWithoutSubscription: number;
  instancesClaimed: number;
  instancesAlreadySent: number;
  /** Instances the user's Notificações toggles turned off. */
  instancesMuted: number;
  notificationsSent: number;
  notificationsFailed: number;
}

/**
 * A rule with no reminders of its own follows the user's Notificações
 * settings: dueDaysBefore days before at dueHour, plus the overdue nag at
 * the same hour.
 */
export function defaultRemindersConfig(prefs: Pick<NotificationPrefs, "dueDaysBefore" | "dueHour" | "overdueEnabled">): RemindersConfig {
  const time = `${String(prefs.dueHour).padStart(2, "0")}:00`;
  return { entries: [{ daysBefore: prefs.dueDaysBefore, time }], overdue: { enabled: prefs.overdueEnabled, time } };
}

/**
 * The overdue nag of a rule without its own reminders stops after a week:
 * those rules never asked for reminders, and a bill left unpaid for months
 * should not start nagging every day the moment the default applies.
 */
export const DEFAULT_OVERDUE_MAX_DAYS = 7;

/** Drops what the user's toggles turned off ("Contas fixas" and "Conta fixa em atraso"). */
export function allowedInstances(instances: ReminderInstance[], prefs: Pick<NotificationPrefs, "dueEnabled" | "overdueEnabled">, usesDefaults: boolean): ReminderInstance[] {
  return instances.filter((instance) => {
    if (instance.kind === "overdue") return prefs.overdueEnabled && (!usesDefaults || -instance.daysBefore <= DEFAULT_OVERDUE_MAX_DAYS);
    return prefs.dueEnabled;
  });
}

const PT_FORMATTER = createFormatter();

/** The push for one reminder instance, in the user's language and number format; it opens Orçamentos, where Contas fixas lives. */
export function buildPayload(
  row: { id: string; description: string; category: string | null; amount: number; currency: string; nextDueDate: Date },
  instance: ReminderInstance,
  opts: { locale?: Locale; fmt?: Formatter } = {}
): PushPayload {
  const locale = opts.locale ?? "pt-BR";
  const fmt = opts.fmt ?? PT_FORMATTER;
  const amount = fmt.money(row.amount, row.currency);
  const category = row.category ?? st(locale, "notifications.reminder.uncategorized");
  const tag = `reminder-${row.id}-${getDueYmd(row.nextDueDate)}`;
  const url = REMINDER_PUSH_URL;

  if (instance.kind === "overdue") {
    const days = -instance.daysBefore;
    return {
      title: st(locale, "notifications.reminder.overdueTitle", { description: row.description }),
      body: days === 1
        ? st(locale, "notifications.reminder.overdueOne", { amount, category })
        : st(locale, "notifications.reminder.overdueMany", { days, amount, category }),
      tag,
      url,
    };
  }

  const when =
    instance.daysBefore === 0
      ? st(locale, "notifications.reminder.dueToday")
      : instance.daysBefore === 1
        ? st(locale, "notifications.reminder.dueTomorrow")
        : st(locale, "notifications.reminder.dueInDays", { days: instance.daysBefore });

  return {
    title: st(locale, "notifications.reminder.title", { description: row.description }),
    body: st(locale, "notifications.reminder.body", { when, amount, category }),
    tag,
    url,
  };
}

/**
 * Runs every 5 minutes (see /api/cron/send-reminders). For every active
 * reminder-mode recurring rule (autoGenerate off: a bill the user pays by
 * hand), computes which pre-due/day-of/overdue instances are due right now
 * and pushes them — at most once each, via the ReminderDispatch idempotency
 * ledger (claim-then-send: the dispatch row is inserted before sending, so
 * an overlapping or re-run tick sees a unique-constraint violation and skips
 * rather than double-sending).
 *
 * A rule's own `reminders` JSON wins; a rule without one follows the user's
 * Notificações settings (defaultRemindersConfig, with the overdue nag
 * capped at DEFAULT_OVERDUE_MAX_DAYS). The "Contas fixas" and "Conta fixa
 * em atraso" toggles turn the due and overdue pushes off for every rule.
 *
 * Mark as Paid / Concluir (skip-occurrence) both advance nextDueDate, which
 * changes the dispatch key space for this item — that's what makes the
 * overdue nag stop on its own with no special-casing here.
 */
export async function sendDueReminders(
  db: PrismaClient,
  now: Date = new Date(),
  opts: { userIds?: string[] } = {}
): Promise<SendDueRemindersResult> {
  const result: SendDueRemindersResult = {
    rowsScanned: 0,
    rowsWithoutSubscription: 0,
    instancesClaimed: 0,
    instancesAlreadySent: 0,
    instancesMuted: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
  };

  const rules = await db.recurringRule.findMany({
    where: {
      isActive: true,
      autoGenerate: false,
      ...(opts.userIds && { userId: { in: opts.userIds } }),
    },
    include: {
      user: { select: { id: true, timezone: true, locale: true, numberFormat: true, dateFormat: true, baseCurrency: true } },
      category: { select: { name: true } },
    },
  });
  const rows = rules.map((r) => ({
    ...r,
    amount: Number(r.amount),
    category: r.category?.name ?? null,
    owner: r.user,
  }));
  result.rowsScanned = rows.length;
  if (rows.length === 0) return result;

  const ownerIds = [...new Set(rows.map((row) => row.owner.id))];
  const [subscriptions, settings] = await Promise.all([
    db.pushSubscription.findMany({ where: { userId: { in: ownerIds }, deadAt: null } }),
    notificationSettingsFor(ownerIds, db),
  ]);
  const subsByUser = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions) {
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }
  const formatters = new Map<string, Formatter>();

  for (const row of rows) {
    const owner = row.owner;

    const subs = subsByUser.get(owner.id) ?? [];
    if (subs.length === 0) {
      result.rowsWithoutSubscription++;
      continue;
    }
    const prefs = settings.get(owner.id)!;
    if (!prefs.dueEnabled && !prefs.overdueEnabled) continue;

    // Defensive: malformed JSON in the column (should not happen — the API
    // validates on write) must not take down the whole cron run.
    const usesDefaults = row.reminders === null;
    let config: RemindersConfig;
    if (usesDefaults) {
      config = defaultRemindersConfig(prefs);
    } else {
      const parsed = remindersConfigSchema.safeParse(row.reminders);
      if (!parsed.success) continue;
      config = parsed.data;
    }

    const due = computeDueReminderInstances(config, row.nextDueDate, owner.timezone, now);
    const instances = allowedInstances(due, prefs, usesDefaults);
    result.instancesMuted += due.length - instances.length;

    for (const instance of instances) {
      let dispatchId: string;
      try {
        const dispatch = await db.reminderDispatch.create({
          data: {
            recurringRuleId: row.id,
            occurrenceDate: toNoonUTC(row.nextDueDate),
            daysBefore: instance.daysBefore,
          },
        });
        dispatchId = dispatch.id;
        result.instancesClaimed++;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          result.instancesAlreadySent++;
          continue;
        }
        throw error;
      }

      const locale = resolveLocale(owner.locale);
      let fmt = formatters.get(owner.id);
      if (!fmt) {
        fmt = createFormatter({ ...owner, locale });
        formatters.set(owner.id, fmt);
      }
      const payload = buildPayload(row, instance, { locale, fmt });
      const { sent, failed } = await sendToSubscriptions(
        subs.map((s) => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
        payload
      );
      result.notificationsSent += sent;
      result.notificationsFailed += failed;

      await db.reminderDispatch.update({
        where: { id: dispatchId },
        data: { sentCount: sent, failCount: failed },
      });
    }
  }

  return result;
}
