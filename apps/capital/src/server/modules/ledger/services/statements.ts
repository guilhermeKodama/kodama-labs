import type { DbClient } from "@capital/server/lib/prisma";
import type { Account, CardStatement } from "@/generated/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { inTransaction } from "./mutations";
import { LedgerError } from "../lib/errors";

function ym(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Statement month a purchase belongs to: the month whose closing day is on
 * or after the purchase date. With closingDay 5, a purchase on the 3rd
 * belongs to this month's statement and one on the 6th to next month's.
 */
export function statementMonthFor(date: Date, closingDay: number): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const closing = Math.min(
    closingDay,
    new Date(Date.UTC(y, m + 1, 0)).getUTCDate(),
  );
  return date.getUTCDate() <= closing ? ym(y, m) : ym(y, m + 1);
}

/** Closing date of a statement month (day clamped to the month length, noon UTC). */
export function closingDateFor(month: string, closingDay: number): Date {
  const [y, m] = month.split("-").map(Number);
  const day = Math.min(closingDay, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return new Date(Date.UTC(y, m - 1, day, 12));
}

export function dueDateFor(
  month: string,
  closingDay: number,
  dueDay: number,
): Date {
  const [y, m] = month.split("-").map(Number);
  // Due day before the closing day means the bill is due the following month.
  const dueMonth0 = dueDay > closingDay ? m - 1 : m;
  const day = Math.min(
    dueDay,
    new Date(Date.UTC(y, dueMonth0 + 1, 0)).getUTCDate(),
  );
  return new Date(Date.UTC(y, dueMonth0, day, 12));
}

/** Date a statement's purchases count on: its closing date, or noon on the 1st of its month. */
export function statementEffectiveDate(
  statement: Pick<CardStatement, "month" | "closingDate">,
): Date {
  return statement.closingDate ?? parseLocalDate(`${statement.month}-01`);
}

/** The user's calendar day at `now`, as noon UTC (how the ledger stores dates). */
export function userCalendarDay(timezone: string, now: Date = new Date()): Date {
  let ymd: string;
  try {
    ymd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    ymd = formatDateOnly(now);
  }
  return parseLocalDate(ymd);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return ym(y, m);
}

/** The statement a card is accumulating purchases on today, for the card's usage bar. */
export interface OpenStatement {
  /** Null while the month has no purchase yet (no statement row). */
  statementId: string | null;
  month: string;
  /** Purchases net of refunds, in the card's currency (positive = owed). */
  total: number;
  count: number;
  /** YYYY-MM-DD */
  closingDate: string;
  /** YYYY-MM-DD; null when the card has no due day. */
  dueDate: string | null;
}

/**
 * Open statement of each card on `today` (a noon-UTC calendar day): the
 * month whose closing date has not passed yet. A statement row whose own
 * closing date (imported from a bill) is already behind `today` is closed,
 * so the next month is the open one. Months with no row yet get the dates
 * the card's closing and due days give and a zero total.
 */
export async function openStatements(
  cards: Pick<Account, "id" | "closingDay" | "dueDay">[],
  db: DbClient,
  today: Date,
): Promise<Map<string, OpenStatement>> {
  const result = new Map<string, OpenStatement>();
  if (!cards.length) return result;
  const todayYmd = formatDateOnly(today);
  const candidates = cards.map((card) => {
    const month = statementMonthFor(today, card.closingDay ?? 1);
    return { card, months: [month, nextMonth(month)] };
  });
  const rows = await db.cardStatement.findMany({
    where: { OR: candidates.map((c) => ({ accountId: c.card.id, month: { in: c.months } })) },
  });
  const rowOf = (accountId: string, month: string) => rows.find((r) => r.accountId === accountId && r.month === month) ?? null;
  const chosen = candidates.map(({ card, months }) => {
    const first = rowOf(card.id, months[0]);
    const closed = first?.closingDate != null && formatDateOnly(first.closingDate) < todayYmd;
    const month = closed ? months[1] : months[0];
    return { card, month, row: closed ? rowOf(card.id, months[1]) : first };
  });
  const statementIds = chosen.flatMap((c) => (c.row ? [c.row.id] : []));
  const totals = statementIds.length
    ? await db.ledgerEntry.groupBy({
        by: ["cardStatementId"],
        where: { cardStatementId: { in: statementIds }, deletedAt: null },
        _sum: { amount: true },
        _count: { _all: true },
      })
    : [];
  const totalOf = new Map(totals.map((t) => [t.cardStatementId, t]));
  for (const { card, month, row } of chosen) {
    const closingDay = card.closingDay ?? 1;
    const sum = row ? totalOf.get(row.id) : undefined;
    const closingDate = row?.closingDate ?? closingDateFor(month, closingDay);
    const dueDate = row?.dueDate ?? (card.dueDay ? dueDateFor(month, closingDay, card.dueDay) : null);
    result.set(card.id, {
      statementId: row?.id ?? null,
      month,
      total: sum?._sum.amount ? -Number(sum._sum.amount) : 0,
      count: sum?._count._all ?? 0,
      closingDate: formatDateOnly(closingDate),
      dueDate: dueDate ? formatDateOnly(dueDate) : null,
    });
  }
  return result;
}

export async function ensureStatement(
  account: Pick<Account, "id" | "type" | "closingDay" | "dueDay">,
  month: string,
  db: DbClient,
  overrides: {
    closingDate?: Date | null;
    dueDate?: Date | null;
    totalAmount?: number | null;
  } = {},
): Promise<CardStatement> {
  if (account.type !== "credit_card")
    throw new LedgerError(
      "Statements only exist for credit card accounts",
      422,
      { code: "account.not_credit_card" },
    );
  const closingDay = account.closingDay ?? 1;
  const existing = await db.cardStatement.findUnique({
    where: { accountId_month: { accountId: account.id, month } },
  });
  if (existing) {
    const data = {
      ...(overrides.closingDate !== undefined && {
        closingDate: overrides.closingDate,
      }),
      ...(overrides.dueDate !== undefined && { dueDate: overrides.dueDate }),
      ...(overrides.totalAmount !== undefined && {
        totalAmount: overrides.totalAmount,
      }),
    };
    return Object.keys(data).length
      ? db.cardStatement.update({ where: { id: existing.id }, data })
      : existing;
  }
  return db.cardStatement.create({
    data: {
      accountId: account.id,
      month,
      closingDate: overrides.closingDate ?? closingDateFor(month, closingDay),
      dueDate:
        overrides.dueDate ??
        (account.dueDay ? dueDateFor(month, closingDay, account.dueDay) : null),
      totalAmount: overrides.totalAmount ?? null,
    },
  });
}

/** Statement and effective date for a purchase dated `date` on a card. */
export async function assignStatement(
  account: Pick<Account, "id" | "type" | "closingDay" | "dueDay">,
  date: Date,
  db: DbClient,
  explicitMonth?: string,
): Promise<{ statement: CardStatement; effectiveDate: Date }> {
  const month =
    explicitMonth ?? statementMonthFor(date, account.closingDay ?? 1);
  const statement = await ensureStatement(account, month, db);
  return { statement, effectiveDate: statementEffectiveDate(statement) };
}

/**
 * Turn an existing expense on a checking account into the payment of a card
 * statement: the entry becomes the checking leg of a card_payment transfer
 * and a matching leg is booked on the card. It stops counting as an expense.
 */
export async function markStatementPayment(
  userId: string,
  entryId: string,
  statementId: string,
  outer: DbClient,
) {
  return inTransaction(outer, async (db) => {
    const [entry, statement] = await Promise.all([
      db.ledgerEntry.findFirst({
        where: { id: entryId, userId, deletedAt: null },
      }),
      db.cardStatement.findFirst({
        where: { id: statementId, account: { userId } },
        include: { account: true },
      }),
    ]);
    if (!entry)
      throw new LedgerError("Transaction not found or access denied", 404, {
        code: "entry.not_found",
      });
    if (!statement)
      throw new LedgerError("Statement not found or access denied", 404, {
        code: "statement.not_found",
      });
    if (
      statement.paymentGroupId &&
      statement.paymentGroupId !== entry.transferGroupId
    ) {
      throw new LedgerError(
        "Statement already has a different bill payment transaction linked",
        409,
        { code: "statement.payment_conflict" },
      );
    }
    if (entry.transferGroupId) {
      const other = await db.cardStatement.findFirst({
        where: { paymentGroupId: entry.transferGroupId },
      });
      if (other && other.id !== statementId)
        throw new LedgerError(
          "Transaction is already linked as a bill payment on another statement",
          409,
          { code: "statement.entry_linked_elsewhere" },
        );
      if (other) return { statement: other, groupId: entry.transferGroupId };
      throw new LedgerError(
        "Transaction is a transfer and cannot be a card settlement",
        422,
        { code: "statement.transfer_not_settlement" },
      );
    }
    if (entry.kind !== "expense")
      throw new LedgerError(
        "Only an expense transaction can be marked as a card settlement",
        422,
        { code: "statement.settlement_requires_expense" },
      );

    const group = await db.transferGroup.create({
      data: {
        userId,
        direction: "card_payment",
        description: entry.description,
        date: entry.date,
        importId: entry.importId,
        recurringRuleId: entry.recurringRuleId,
      },
    });
    await db.ledgerEntry.update({
      where: { id: entry.id },
      data: {
        kind: "transfer",
        transferGroupId: group.id,
        metadata: {
          ...(entry.metadata as object),
          settledFromKind: entry.kind,
        },
      },
    });
    await db.ledgerEntry.create({
      data: {
        userId,
        entityId: statement.account.entityId,
        accountId: statement.accountId,
        kind: "transfer",
        amount: entry.amount.negated(),
        currency: entry.currency,
        exchangeRate: entry.exchangeRate,
        amountBase: entry.amountBase.negated(),
        date: entry.date,
        effectiveDate: entry.date,
        description: entry.description,
        transferGroupId: group.id,
        importId: entry.importId,
      },
    });
    const updated = await db.cardStatement.update({
      where: { id: statementId },
      data: { paymentGroupId: group.id },
    });
    return { statement: updated, groupId: group.id };
  });
}

/** Reverse `markStatementPayment`: the checking leg becomes an expense again and the card leg is removed. */
export async function unmarkStatementPayment(
  userId: string,
  entryId: string,
  outer: DbClient,
) {
  return inTransaction(outer, async (db) => {
    const entry = await db.ledgerEntry.findFirst({
      where: { id: entryId, userId },
    });
    if (!entry)
      throw new LedgerError("Transaction not found or access denied", 404, {
        code: "entry.not_found",
      });
    if (!entry.transferGroupId)
      throw new LedgerError(
        "Transaction is not linked as a card settlement",
        422,
        { code: "statement.not_settlement" },
      );
    const statement = await db.cardStatement.findFirst({
      where: { paymentGroupId: entry.transferGroupId },
    });
    const group = await db.transferGroup.findUnique({
      where: { id: entry.transferGroupId },
    });
    if (!group || group.direction !== "card_payment")
      throw new LedgerError(
        "Transaction is not linked as a card settlement",
        422,
        { code: "statement.not_settlement" },
      );
    if (statement)
      await db.cardStatement.update({
        where: { id: statement.id },
        data: { paymentGroupId: null },
      });
    await db.ledgerEntry.deleteMany({
      where: { transferGroupId: group.id, id: { not: entry.id } },
    });
    await db.ledgerEntry.update({
      where: { id: entry.id },
      data: { kind: "expense", transferGroupId: null },
    });
    await db.transferGroup.delete({ where: { id: group.id } });
    return { statementId: statement?.id ?? null };
  });
}

/**
 * Correct a statement's own closing/due dates. Purchases count on the
 * closing date, so their effective date moves with it.
 */
export async function updateStatementDates(
  userId: string,
  statementId: string,
  dates: { closingDate?: Date; dueDate?: Date },
  outer: DbClient,
) {
  return inTransaction(outer, async (db) => {
    const statement = await db.cardStatement.findFirst({
      where: { id: statementId, account: { userId } },
    });
    if (!statement) throw new LedgerError("Statement not found or access denied", 404, { code: "statement.not_found" });
    const updated = await db.cardStatement.update({
      where: { id: statementId },
      data: {
        ...(dates.closingDate && { closingDate: dates.closingDate }),
        ...(dates.dueDate && { dueDate: dates.dueDate }),
      },
    });
    if (dates.closingDate) {
      await db.ledgerEntry.updateMany({
        where: { cardStatementId: statementId, transferGroupId: null },
        data: { effectiveDate: statementEffectiveDate(updated) },
      });
    }
    return updated;
  });
}
