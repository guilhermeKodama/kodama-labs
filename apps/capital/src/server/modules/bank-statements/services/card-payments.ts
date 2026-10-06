import type { Account, CardStatement, LedgerEntry } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { ensureRecordedStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { closingDateFor, dueDateFor, markStatementPayment } from "@capital/server/modules/ledger/services/statements";
import { bookableExternalId } from "./external-ids";

/**
 * Card bill payments in imports: a bank statement's "Pagamento de fatura"
 * row is the payment of one card statement, booked as a card_payment
 * transfer (it is not an expense), and a card bill import can link the
 * bank entry that already paid it.
 */

const DAY = 24 * 60 * 60 * 1000;

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Statement month a payment made on `date` settles: the one whose due date
 * is nearest (a payment a few days early or late still settles it). Without
 * a due day, the latest statement closed by then.
 */
export function paymentStatementMonth(card: Pick<Account, "closingDay" | "dueDay">, date: Date): string {
  const closingDay = card.closingDay ?? 1;
  const months = [-2, -1, 0, 1].map((by) => shiftMonth(monthOf(date), by));
  if (!card.dueDay) {
    const closed = months.filter((m) => closingDateFor(m, closingDay).getTime() <= date.getTime() + DAY / 2);
    return closed[closed.length - 1] ?? months[0];
  }
  let best = months[0];
  let bestDistance = Infinity;
  for (const m of months) {
    const distance = Math.abs(dueDateFor(m, closingDay, card.dueDay).getTime() - date.getTime());
    if (distance < bestDistance) {
      best = m;
      bestDistance = distance;
    }
  }
  return best;
}

/** Replace the `after` of a row the batch created (it changed again later in the same batch). */
export function patchCreatedRecord(records: MutationRecordInput[], model: MutationRecordInput["model"], recordId: string, after: unknown) {
  const record = records.find((r) => r.model === model && r.recordId === recordId && r.before === null);
  if (record) record.after = snapshot(after);
  else records.push({ model, recordId, before: null, after: snapshot(after) });
}

/**
 * markStatementPayment, recorded: the entry becomes the bank leg of a
 * card_payment transfer settling `statement`. `createdInBatch` says the
 * entry was created by the same batch (its record is updated in place).
 */
export async function linkStatementPayment(
  userId: string,
  entryId: string,
  statement: CardStatement,
  tx: DbClient,
  records: MutationRecordInput[],
  opts: { createdInBatch?: boolean; externalId?: string | null } = {}
): Promise<{ groupId: string }> {
  const entryBefore = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
  const statementBefore = await tx.cardStatement.findUniqueOrThrow({ where: { id: statement.id } });
  const { groupId } = await markStatementPayment(userId, entryId, statement.id, tx);
  const group = opts.externalId
    ? await tx.transferGroup.update({ where: { id: groupId }, data: { externalId: opts.externalId } })
    : await tx.transferGroup.findUniqueOrThrow({ where: { id: groupId } });
  const [entryAfter, cardLeg, statementAfter] = await Promise.all([
    tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } }),
    tx.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: groupId, id: { not: entryId } } }),
    tx.cardStatement.findUniqueOrThrow({ where: { id: statement.id } }),
  ]);
  if (opts.createdInBatch) patchCreatedRecord(records, "LedgerEntry", entryId, entryAfter);
  else records.push({ model: "LedgerEntry", recordId: entryId, before: snapshot(entryBefore), after: snapshot(entryAfter) });
  records.push({ model: "TransferGroup", recordId: group.id, before: null, after: snapshot(group) });
  records.push({ model: "LedgerEntry", recordId: cardLeg.id, before: null, after: snapshot(cardLeg) });
  records.push({ model: "CardStatement", recordId: statement.id, before: snapshot(statementBefore), after: snapshot(statementAfter) });
  return { groupId };
}

export interface CardPaymentInput {
  externalId: string;
  date: string;
  amount: number;
  description?: string;
  currency: string;
  /** Statement month (YYYY-MM) it settles; by default the one due nearest the payment date. */
  statementMonth?: string;
}

/**
 * Books a bank row that paid a card bill: a card_payment transfer from the
 * bank account to the card, settling the statement it pays when that one
 * has no payment yet (a second payment of a paid statement is booked
 * without the link).
 */
export async function bookCardPayment(
  userId: string,
  from: Account,
  card: Account,
  input: CardPaymentInput,
  tx: DbClient,
  opts: { importId: string; collect: MutationRecordInput[]; defaultDescription: string }
): Promise<{ groupId: string; statementId: string | null }> {
  const records = opts.collect;
  const date = new Date(`${input.date}T12:00:00Z`);
  const month = input.statementMonth ?? paymentStatementMonth(card, date);
  const statement = await ensureRecordedStatement(card, month, tx, {}, records);
  const description = input.description ?? opts.defaultDescription;
  if (!statement.paymentGroupId) {
    const created = await createEntry(
      userId,
      { kind: "expense", accountId: from.id, amount: input.amount, currency: input.currency, description, date: input.date, categoryId: null, externalId: await bookableExternalId(from.id, input.externalId, tx) },
      tx,
      { importId: opts.importId, collect: records, skipRules: true }
    );
    const { groupId } = await linkStatementPayment(userId, created.entryIds[0], statement, tx, records, { createdInBatch: true, externalId: input.externalId });
    return { groupId, statementId: statement.id };
  }
  const created = await createEntry(
    userId,
    { kind: "transfer", fromAccountId: from.id, toAccountId: card.id, amount: input.amount, currency: input.currency, description, date: input.date, direction: "card_payment" },
    tx,
    { importId: opts.importId, collect: records }
  );
  const group = await tx.transferGroup.update({ where: { id: created.transferGroupId! }, data: { externalId: input.externalId } });
  patchCreatedRecord(records, "TransferGroup", group.id, group);
  const linked = await tx.cardStatement.findFirst({ where: { paymentGroupId: group.id }, select: { id: true } });
  return { groupId: group.id, statementId: linked?.id ?? null };
}

/**
 * The bank expense that most likely paid a card statement: on the account
 * that pays the card (any bank account of its entity when none is set),
 * within ten days before to a week after the due date, for the bill's
 * exact total. Null when the statement is already settled.
 */
export async function findStatementPaymentEntry(
  userId: string,
  card: Account,
  statement: Pick<CardStatement, "dueDate" | "paymentGroupId">,
  total: number,
  db: DbClient
): Promise<LedgerEntry | null> {
  if (statement.paymentGroupId || !statement.dueDate || !(total > 0)) return null;
  const accountIds = card.payFromAccountId
    ? [card.payFromAccountId]
    : (await db.account.findMany({ where: { userId, entityId: card.entityId, type: { in: ["checking", "cash"] } }, select: { id: true } })).map((a) => a.id);
  if (!accountIds.length) return null;
  const due = statement.dueDate.getTime();
  const candidates = await db.ledgerEntry.findMany({
    where: {
      userId,
      accountId: { in: accountIds },
      deletedAt: null,
      transferGroupId: null,
      kind: "expense",
      date: { gte: new Date(due - 10 * DAY), lte: new Date(due + 7 * DAY) },
    },
  });
  const matches = candidates.filter((e) => Math.abs(Math.abs(Number(e.amount)) - total) < 0.005);
  matches.sort((a, b) => Math.abs(a.date.getTime() - due) - Math.abs(b.date.getTime() - due));
  return matches[0] ?? null;
}
