import type { PrismaClient } from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import { toNoonUTC } from "@capital/server/lib/date-utils";
import { sendToSubscriptions, type PushPayload } from "@capital/server/lib/web-push";
import { remindersConfigSchema } from "@/lib/validations/reminders";
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
  notificationsSent: number;
  notificationsFailed: number;
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function buildPayload(
  row: { id: string; description: string; category: string; amount: number; currency: string; nextDueDate: Date },
  instance: ReminderInstance
): PushPayload {
  const amountText = `~${formatAmount(row.amount, row.currency)}`;
  const tag = `reminder-${row.id}-${getDueYmd(row.nextDueDate)}`;
  const url = "/recurring";

  if (instance.kind === "overdue") {
    const n = -instance.daysBefore;
    return {
      title: `Atrasado: ${row.description}`,
      body: `Venceu há ${n} dia${n === 1 ? "" : "s"} — ${amountText} (${row.category}). Marque como pago ou concluído.`,
      tag,
      url,
    };
  }

  const whenText =
    instance.daysBefore === 0
      ? "Vence hoje"
      : instance.daysBefore === 1
        ? "Vence amanhã"
        : `Vence em ${instance.daysBefore} dias`;

  return {
    title: `Lembrete: ${row.description}`,
    body: `${whenText} — ${amountText} (${row.category})`,
    tag,
    url,
  };
}

/**
 * Runs every 5 minutes (see /api/cron/send-reminders). For every active
 * reminder-mode recurring transaction with a configured `reminders` JSON,
 * computes which pre-due/day-of/overdue instances are due right now and
 * pushes them — at most once each, via the ReminderDispatch idempotency
 * ledger (claim-then-send: the dispatch row is inserted before sending, so
 * an overlapping or re-run tick sees a unique-constraint violation and skips
 * rather than double-sending).
 *
 * Rows with `reminders: null` are skipped by the query itself — that is the
 * feature-off state for existing rows created before this shipped, and it
 * must stay that way or every already-overdue reminder-mode row in the
 * database starts nagging the instant this deploys.
 *
 * Mark as Paid / Concluir (skip-occurrence) both advance nextDueDate, which
 * changes the dispatch key space for this item — that's what makes the
 * overdue nag stop on its own with no special-casing here.
 */
export async function sendDueReminders(
  db: PrismaClient,
  now: Date = new Date()
): Promise<SendDueRemindersResult> {
  const result: SendDueRemindersResult = {
    rowsScanned: 0,
    rowsWithoutSubscription: 0,
    instancesClaimed: 0,
    instancesAlreadySent: 0,
    notificationsSent: 0,
    notificationsFailed: 0,
  };

  const rows = await db.recurringTransaction.findMany({
    where: {
      isActive: true,
      autoGenerateTransaction: false,
      reminders: { not: Prisma.DbNull },
    },
    include: {
      business: { select: { user: { select: { id: true, timezone: true } } } },
      personalAccount: { select: { user: { select: { id: true, timezone: true } } } },
    },
  });
  result.rowsScanned = rows.length;
  if (rows.length === 0) return result;

  const ownerIds = new Set<string>();
  for (const row of rows) {
    const owner = row.business?.user ?? row.personalAccount?.user;
    if (owner) ownerIds.add(owner.id);
  }

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId: { in: [...ownerIds] }, deadAt: null },
  });
  const subsByUser = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions) {
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }

  for (const row of rows) {
    const owner = row.business?.user ?? row.personalAccount?.user;
    if (!owner) continue;

    const subs = subsByUser.get(owner.id) ?? [];
    if (subs.length === 0) {
      result.rowsWithoutSubscription++;
      continue;
    }

    // Defensive: malformed JSON in the column (should not happen — the API
    // validates on write) must not take down the whole cron run.
    const parsed = remindersConfigSchema.safeParse(row.reminders);
    if (!parsed.success) continue;

    const instances = computeDueReminderInstances(parsed.data, row.nextDueDate, owner.timezone, now);

    for (const instance of instances) {
      let dispatchId: string;
      try {
        const dispatch = await db.reminderDispatch.create({
          data: {
            recurringTransactionId: row.id,
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

      const payload = buildPayload(row, instance);
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
