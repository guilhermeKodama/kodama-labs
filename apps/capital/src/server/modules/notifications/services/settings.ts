import type { NotificationSettings } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";

/**
 * What a user receives by push. A missing NotificationSettings row means
 * these defaults (mockup: due, overdue, card bill and budget on, weekly
 * summary off), so nothing is written until the user changes a toggle.
 */
export const NOTIFICATION_DEFAULTS = {
  /** Recurring bills (Contas fixas) before they are due. */
  dueEnabled: true,
  dueDaysBefore: 1,
  /** Local hour (User.timezone) of the due reminder. */
  dueHour: 9,
  /** A recurring bill still unpaid after its due date. */
  overdueEnabled: true,
  /** A card statement closed. */
  billClosedEnabled: true,
  /** A monthly budget passed budgetThreshold of its amount. */
  budgetEnabled: true,
  budgetThreshold: 0.9,
  /** Last week's money in and out, on weeklyDow (0 = Sunday) at weeklyHour. */
  weeklyEnabled: false,
  weeklyDow: 1,
  weeklyHour: 8,
} as const;

export type NotificationPrefs = { -readonly [K in keyof typeof NOTIFICATION_DEFAULTS]: (typeof NOTIFICATION_DEFAULTS)[K] extends boolean ? boolean : number };
export type NotificationPrefsPatch = Partial<NotificationPrefs>;

function toPrefs(row: NotificationSettings | null | undefined): NotificationPrefs {
  if (!row) return { ...NOTIFICATION_DEFAULTS };
  return {
    dueEnabled: row.dueEnabled,
    dueDaysBefore: row.dueDaysBefore,
    dueHour: row.dueHour,
    overdueEnabled: row.overdueEnabled,
    billClosedEnabled: row.billClosedEnabled,
    budgetEnabled: row.budgetEnabled,
    budgetThreshold: row.budgetThreshold,
    weeklyEnabled: row.weeklyEnabled,
    weeklyDow: row.weeklyDow,
    weeklyHour: row.weeklyHour,
  };
}

export async function getNotificationSettings(userId: string, db: DbClient): Promise<NotificationPrefs> {
  return toPrefs(await db.notificationSettings.findUnique({ where: { userId } }));
}

/** Settings of several users at once (defaults for those without a row), for the senders. */
export async function notificationSettingsFor(userIds: string[], db: DbClient): Promise<Map<string, NotificationPrefs>> {
  const rows = userIds.length ? await db.notificationSettings.findMany({ where: { userId: { in: userIds } } }) : [];
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return new Map(userIds.map((id) => [id, toPrefs(byUser.get(id))]));
}

/** Saves the changed fields; the first change writes the row with the defaults for the rest. */
export async function updateNotificationSettings(userId: string, patch: NotificationPrefsPatch, db: DbClient): Promise<NotificationPrefs> {
  const row = await db.notificationSettings.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: patch,
  });
  return toPrefs(row);
}
