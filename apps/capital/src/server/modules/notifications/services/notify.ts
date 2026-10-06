import { randomUUID } from "crypto";
import type { PrismaClient } from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import { createFormatter, type Formatter } from "@/lib/format";
import { buildTransactionsHref } from "@/lib/ledger/view-draft";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { isPushConfigured, sendToSubscriptions, type PushPayload, type PushSubscriptionTarget } from "@capital/server/lib/web-push";
import { resolveLocale, st, type Locale } from "@capital/server/i18n";
import { getEffectiveBudgetsForMonth } from "@capital/server/modules/budgets/lib/effective-budgets";
import { closingDateFor, dueDateFor, statementMonthFor } from "@capital/server/modules/ledger/services/statements";
import { REMINDER_PUSH_URL } from "@capital/server/modules/push/constants";
import { addDays, BILL_CLOSED_GRACE_DAYS, billJustClosed, inAlertHours, localNow, weeklySummaryWindow, type LocalNow } from "../lib/schedule";
import { notificationSettingsFor, type NotificationPrefs } from "./settings";

/** NotificationDispatch.kind values; dedupe keys are the statement id, "<entity|*>:<category>:<YYYY-MM>" and the ISO week. */
export const NOTIFICATION_KINDS = ["bill_closed", "budget_threshold", "weekly_summary"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Where a budget alert opens (Orçamentos). */
export const BUDGETS_PUSH_URL = REMINDER_PUSH_URL;

export interface NotifyResult {
  users: number;
  claimed: Record<NotificationKind, number>;
  alreadySent: number;
  sent: number;
  failed: number;
  errors: { userId: string; kind: NotificationKind; message: string }[];
  /** Set when nothing ran (no VAPID keys: claiming keys would burn them without a send). */
  skipped?: "push_not_configured";
}

interface UserContext {
  userId: string;
  locale: Locale;
  fmt: Formatter;
  local: LocalNow;
  prefs: NotificationPrefs;
  subs: PushSubscriptionTarget[];
}

const emptyResult = (): NotifyResult => ({
  users: 0,
  claimed: { bill_closed: 0, budget_threshold: 0, weekly_summary: 0 },
  alreadySent: 0,
  sent: 0,
  failed: 0,
  errors: [],
});

/**
 * Claim-then-send: the dispatch row goes in first, so an overlapping tick
 * hits the unique key and skips (ON CONFLICT instead of catching P2002, which
 * Prisma would log as an error on every repeat tick).
 */
async function claim(db: PrismaClient, userId: string, kind: NotificationKind, dedupeKey: string, result: NotifyResult): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO notification_dispatches (id, "userId", kind, "dedupeKey")
    VALUES (${randomUUID()}, ${userId}, ${kind}, ${dedupeKey})
    ON CONFLICT ("userId", kind, "dedupeKey") DO NOTHING
    RETURNING id`;
  if (!rows.length) {
    result.alreadySent++;
    return null;
  }
  result.claimed[kind]++;
  return rows[0].id;
}

async function deliver(db: PrismaClient, dispatchId: string, ctx: UserContext, payload: PushPayload, result: NotifyResult) {
  const { sent, failed } = await sendToSubscriptions(ctx.subs, payload);
  result.sent += sent;
  result.failed += failed;
  await db.notificationDispatch.update({ where: { id: dispatchId }, data: { sentCount: sent, failCount: failed } });
}

/** "Fatura do cartão fechou": statements whose closing day ended in the last few days, with purchases on them. */
async function sendBillClosed(db: PrismaClient, ctx: UserContext, result: NotifyResult) {
  if (!inAlertHours(ctx.local)) return;
  const cards = await db.account.findMany({
    where: { userId: ctx.userId, type: "credit_card", archivedAt: null, closingDay: { not: null } },
    select: { id: true, name: true, currency: true, closingDay: true, dueDay: true },
  });
  if (!cards.length) return;
  const today = parseLocalDate(ctx.local.ymd);
  const earliest = parseLocalDate(addDays(ctx.local.ymd, -BILL_CLOSED_GRACE_DAYS - 1));
  const monthsOf = (closingDay: number) => [...new Set([statementMonthFor(earliest, closingDay), statementMonthFor(today, closingDay)])];
  const statements = await db.cardStatement.findMany({
    where: { OR: cards.map((card) => ({ accountId: card.id, month: { in: monthsOf(card.closingDay!) } })) },
  });
  const closed = statements.flatMap((statement) => {
    const card = cards.find((c) => c.id === statement.accountId)!;
    const closing = formatDateOnly(statement.closingDate ?? closingDateFor(statement.month, card.closingDay!));
    if (!billJustClosed(closing, ctx.local.ymd)) return [];
    const due = statement.dueDate ?? (card.dueDay ? dueDateFor(statement.month, card.closingDay!, card.dueDay) : null);
    return [{ statement, card, due: due ? formatDateOnly(due) : null }];
  });
  if (!closed.length) return;
  const totals = await db.ledgerEntry.groupBy({
    by: ["cardStatementId"],
    where: { cardStatementId: { in: closed.map((c) => c.statement.id) }, deletedAt: null },
    _sum: { amount: true },
    _count: { _all: true },
  });
  for (const { statement, card, due } of closed) {
    const sum = totals.find((t) => t.cardStatementId === statement.id);
    const total = sum?._sum.amount ? -Number(sum._sum.amount) : 0;
    const count = sum?._count._all ?? 0;
    if (count === 0 || total <= 0) continue;
    const dispatchId = await claim(db, ctx.userId, "bill_closed", statement.id, result);
    if (!dispatchId) continue;
    const amount = ctx.fmt.money(total, card.currency);
    await deliver(db, dispatchId, ctx, {
      title: st(ctx.locale, "notifications.billClosed.title", { card: card.name }),
      body: due
        ? st(ctx.locale, "notifications.billClosed.body", { amount, due: ctx.fmt.date(due) })
        : st(ctx.locale, "notifications.billClosed.bodyNoDue", { amount, count }),
      tag: `bill-${statement.id}`,
      url: buildTransactionsHref({ draft: { filters: [{ field: "cardStatementId", op: "in", values: [statement.id] }], period: { preset: "all", offset: 0 } } }),
    }, result);
  }
}

/**
 * "Orçamento passou de 90%": this month's monthly budgets whose spending to
 * date (expenses by effective date, as Orçamentos counts them) reached the
 * user's threshold. Once per budget chain (entity and category) and month,
 * so editing the amount mid-month does not send it again.
 */
async function sendBudgetThreshold(db: PrismaClient, ctx: UserContext, result: NotifyResult) {
  if (!inAlertHours(ctx.local)) return;
  const { year, month } = ctx.local;
  const budgets = (await getEffectiveBudgetsForMonth(db, ctx.userId, new Date(Date.UTC(year, month - 1, 1, 12)))).filter(
    (b) => b.period === "monthly" && !b.isTombstone && Number(b.amount) > 0
  );
  if (!budgets.length) return;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(`${ctx.local.ymd}T23:59:59.999Z`);
  const spend = await db.$queryRaw<{ entity_id: string; category_id: string; spent: Prisma.Decimal }[]>`
    SELECT le."entityId" AS entity_id, le."categoryId" AS category_id, coalesce(-sum(le."amountBase"), 0) AS spent
    FROM ledger_entries le
    WHERE le."userId" = ${ctx.userId} AND le."deletedAt" IS NULL AND le.kind = 'expense' AND le."transferGroupId" IS NULL
      AND le."effectiveDate" BETWEEN ${from} AND ${to}
      AND le."categoryId" IN (${Prisma.join([...new Set(budgets.map((b) => b.categoryId))])})
    GROUP BY 1, 2`;
  const categories = await db.category.findMany({ where: { id: { in: budgets.map((b) => b.categoryId) } }, select: { id: true, name: true } });
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  for (const budget of budgets) {
    const amount = Number(budget.amount);
    const spent = spend
      .filter((r) => r.category_id === budget.categoryId && (!budget.entityId || r.entity_id === budget.entityId))
      .reduce((s, r) => s + Number(r.spent), 0);
    if (spent < amount * ctx.prefs.budgetThreshold) continue;
    const dispatchId = await claim(db, ctx.userId, "budget_threshold", `${budget.entityId ?? "*"}:${budget.categoryId}:${monthKey}`, result);
    if (!dispatchId) continue;
    await deliver(db, dispatchId, ctx, {
      title: st(ctx.locale, "notifications.budget.title", {
        category: categories.find((c) => c.id === budget.categoryId)?.name ?? "?",
        threshold: ctx.fmt.pct(ctx.prefs.budgetThreshold, 0),
      }),
      body: st(ctx.locale, "notifications.budget.body", {
        spent: ctx.fmt.money(spent, budget.currency),
        budget: ctx.fmt.money(amount, budget.currency),
        month: ctx.fmt.monthLabel({ year, month }),
      }),
      tag: `budget-${budget.categoryId}-${monthKey}`,
      url: BUDGETS_PUSH_URL,
    }, result);
  }
}

/** "Resumo semanal": money in and out over the seven days before the chosen weekday, once per ISO week. */
async function sendWeeklySummary(db: PrismaClient, ctx: UserContext, result: NotifyResult) {
  const window = weeklySummaryWindow(ctx.local, { dow: ctx.prefs.weeklyDow, hour: ctx.prefs.weeklyHour });
  if (!window) return;
  const [row] = await db.$queryRaw<{ income: Prisma.Decimal; expense: Prisma.Decimal; n: number }[]>`
    SELECT coalesce(sum(le."amountBase") FILTER (WHERE le.kind = 'income'), 0) AS income,
           coalesce(-sum(le."amountBase") FILTER (WHERE le.kind = 'expense'), 0) AS expense,
           count(*)::int AS n
    FROM ledger_entries le
    WHERE le."userId" = ${ctx.userId} AND le."deletedAt" IS NULL AND le."transferGroupId" IS NULL
      AND le.kind IN ('income', 'expense')
      AND le.date BETWEEN ${new Date(`${window.from}T00:00:00.000Z`)} AND ${new Date(`${window.to}T23:59:59.999Z`)}`;
  if (!row || Number(row.n) === 0) return;
  const dispatchId = await claim(db, ctx.userId, "weekly_summary", window.key, result);
  if (!dispatchId) return;
  await deliver(db, dispatchId, ctx, {
    title: st(ctx.locale, "notifications.weekly.title"),
    body: st(ctx.locale, "notifications.weekly.body", {
      from: ctx.fmt.date(window.from),
      to: ctx.fmt.date(window.to),
      expense: ctx.fmt.money(Number(row.expense)),
      income: ctx.fmt.money(Number(row.income)),
    }),
    tag: `weekly-${window.key}`,
    url: buildTransactionsHref({ draft: { period: { from: window.from, to: window.to } } }),
  }, result);
}

const SENDERS: { kind: NotificationKind; enabled: (p: NotificationPrefs) => boolean; send: typeof sendBillClosed }[] = [
  { kind: "bill_closed", enabled: (p) => p.billClosedEnabled, send: sendBillClosed },
  { kind: "budget_threshold", enabled: (p) => p.budgetEnabled, send: sendBudgetThreshold },
  { kind: "weekly_summary", enabled: (p) => p.weeklyEnabled, send: sendWeeklySummary },
];

/**
 * The /api/cron/notify tick (every 15 minutes): for every user with a live
 * push device, the card-bill, budget and weekly-summary pushes their
 * Notificações settings allow and their local time calls for. Each push is
 * claimed once in NotificationDispatch before it is sent. One user's or one
 * sender's failure is reported and the rest go on.
 */
export async function runNotifications(db: PrismaClient, now: Date = new Date(), opts: { userIds?: string[] } = {}): Promise<NotifyResult> {
  const result = emptyResult();
  if (!isPushConfigured()) return { ...result, skipped: "push_not_configured" };
  const subscriptions = await db.pushSubscription.findMany({
    where: { deadAt: null, ...(opts.userIds && { userId: { in: opts.userIds } }) },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
  const subsByUser = new Map<string, PushSubscriptionTarget[]>();
  for (const { userId, ...sub } of subscriptions) subsByUser.set(userId, [...(subsByUser.get(userId) ?? []), sub]);
  const userIds = [...subsByUser.keys()];
  if (!userIds.length) return result;
  const [users, settings] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, timezone: true, locale: true, numberFormat: true, dateFormat: true, baseCurrency: true },
    }),
    notificationSettingsFor(userIds, db),
  ]);
  for (const user of users) {
    const prefs = settings.get(user.id)!;
    const locale = resolveLocale(user.locale);
    const ctx: UserContext = {
      userId: user.id,
      locale,
      fmt: createFormatter({ numberFormat: user.numberFormat, dateFormat: user.dateFormat, timezone: user.timezone, baseCurrency: user.baseCurrency, locale }),
      local: localNow(now, user.timezone),
      prefs,
      subs: subsByUser.get(user.id) ?? [],
    };
    result.users++;
    for (const sender of SENDERS) {
      if (!sender.enabled(prefs)) continue;
      try {
        await sender.send(db, ctx, result);
      } catch (error) {
        result.errors.push({ userId: user.id, kind: sender.kind, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return result;
}
