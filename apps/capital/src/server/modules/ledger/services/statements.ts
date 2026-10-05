import type { DbClient } from "@capital/server/lib/prisma";
import type { Account, CardStatement } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
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
      throw new LedgerError("Transaction not found or access denied", 404);
    if (!statement)
      throw new LedgerError("Statement not found or access denied", 404);
    if (
      statement.paymentGroupId &&
      statement.paymentGroupId !== entry.transferGroupId
    ) {
      throw new LedgerError(
        "Statement already has a different bill payment transaction linked",
        409,
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
        );
      if (other) return { statement: other, groupId: entry.transferGroupId };
      throw new LedgerError(
        "Transaction is a transfer and cannot be a card settlement",
        422,
      );
    }
    if (entry.kind !== "expense")
      throw new LedgerError(
        "Only an expense transaction can be marked as a card settlement",
        422,
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
      throw new LedgerError("Transaction not found or access denied", 404);
    if (!entry.transferGroupId)
      throw new LedgerError(
        "Transaction is not linked as a card settlement",
        422,
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
    if (!statement) throw new LedgerError("Statement not found or access denied", 404);
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
