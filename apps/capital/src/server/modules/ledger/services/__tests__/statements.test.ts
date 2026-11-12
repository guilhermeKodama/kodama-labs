import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "../entries";
import {
  assignStatement,
  closingDateFor,
  dueDateFor,
  ensureStatement,
  markStatementPayment,
  openStatements,
  statementEffectiveDate,
  statementMonthFor,
  unmarkStatementPayment,
  updateStatementDates,
  userCalendarDay,
} from "../statements";

const USER = "test-user-ledger-statements-001";
const OTHER = "test-user-ledger-statements-002";
let f: LedgerFixture;
let other: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const day = (iso: string) => parseLocalDate(iso);
const ymd = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("statement date helpers", () => {
  it("clamps the closing day to short months and rolls purchases after it to the next month", () => {
    expect(statementMonthFor(day("2026-02-28"), 31)).toBe("2026-02");
    expect(statementMonthFor(day("2026-03-05"), 5)).toBe("2026-03");
    expect(statementMonthFor(day("2026-03-06"), 5)).toBe("2026-04");
    expect(statementMonthFor(day("2026-12-20"), 5)).toBe("2027-01");
    expect(ymd(closingDateFor("2026-02", 31))).toBe("2026-02-28");
    expect(ymd(closingDateFor("2026-09", 5))).toBe("2026-09-05");
  });

  it("puts the due date in the closing month when the due day is later, else in the following month", () => {
    expect(ymd(dueDateFor("2026-09", 5, 12))).toBe("2026-09-12");
    expect(ymd(dueDateFor("2026-09", 25, 5))).toBe("2026-10-05");
    expect(ymd(dueDateFor("2026-01", 5, 31))).toBe("2026-01-31");
    // Clamped to the month's length.
    expect(ymd(dueDateFor("2026-11", 5, 31))).toBe("2026-11-30");
  });

  it("counts a statement on its closing date, or on the 1st of its month when it has none", () => {
    expect(ymd(statementEffectiveDate({ month: "2026-09", closingDate: day("2026-09-07") }))).toBe("2026-09-07");
    expect(ymd(statementEffectiveDate({ month: "2026-09", closingDate: null }))).toBe("2026-09-01");
  });

  it("reads the calendar day in the user's timezone and falls back to UTC for an unknown zone", () => {
    const instant = new Date("2026-09-10T01:30:00Z");
    expect(ymd(userCalendarDay("America/Sao_Paulo", instant))).toBe("2026-09-09");
    expect(ymd(userCalendarDay("Asia/Tokyo", instant))).toBe("2026-09-10");
    expect(ymd(userCalendarDay("Not/AZone", instant))).toBe("2026-09-10");
    // Without `now` it answers for the real clock: a noon-UTC day.
    expect(userCalendarDay("UTC").getUTCHours()).toBe(12);
  });
});

describe("ensureStatement and assignStatement", () => {
  it("refuses accounts that are not credit cards", async () => {
    const checking = await prisma.account.findUniqueOrThrow({ where: { id: f.pfChecking } });
    await expect(ensureStatement(checking, "2026-09", prisma)).rejects.toMatchObject({ status: 422, code: "account.not_credit_card" });
    expect(await prisma.cardStatement.count({ where: { accountId: f.pfChecking } })).toBe(0);
  });

  it("creates the month once with the card's closing and due dates, and returns it untouched afterwards", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    const first = await ensureStatement(card, "2026-09", prisma);
    expect(ymd(first.closingDate)).toBe("2026-09-05");
    expect(ymd(first.dueDate)).toBe("2026-09-12");
    expect(first.totalAmount).toBeNull();
    const again = await ensureStatement(card, "2026-09", prisma);
    expect(again.id).toBe(first.id);
    expect(await prisma.cardStatement.count({ where: { accountId: f.card } })).toBe(1);
  });

  it("leaves the due date empty when the card has no due day, and uses closing day 1 when it has no closing day", async () => {
    const noDue = { ...(await prisma.account.findUniqueOrThrow({ where: { id: f.card } })), dueDay: null, closingDay: null };
    const statement = await ensureStatement(noDue, "2026-10", prisma);
    expect(statement.dueDate).toBeNull();
    expect(ymd(statement.closingDate)).toBe("2026-10-01");
  });

  it("applies the overrides on create and on update, but only the ones given", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    const created = await ensureStatement(card, "2026-09", prisma, { closingDate: day("2026-09-08"), dueDate: day("2026-09-15"), totalAmount: 321.5 });
    expect(ymd(created.closingDate)).toBe("2026-09-08");
    expect(ymd(created.dueDate)).toBe("2026-09-15");
    expect(Number(created.totalAmount)).toBe(321.5);

    const updated = await ensureStatement(card, "2026-09", prisma, { totalAmount: 400 });
    expect(updated.id).toBe(created.id);
    expect(Number(updated.totalAmount)).toBe(400);
    expect(ymd(updated.closingDate)).toBe("2026-09-08");

    const cleared = await ensureStatement(card, "2026-09", prisma, { closingDate: null, dueDate: null, totalAmount: null });
    expect(cleared.closingDate).toBeNull();
    expect(cleared.dueDate).toBeNull();
    expect(cleared.totalAmount).toBeNull();
  });

  it("assigns with closing day 1 when the card has no closing day", async () => {
    const card = { ...(await prisma.account.findUniqueOrThrow({ where: { id: f.card } })), closingDay: null };
    const r = await assignStatement(card, day("2026-09-10"), prisma);
    expect(r.statement.month).toBe("2026-10");
    expect(ymd(r.effectiveDate)).toBe("2026-10-01");
  });

  it("assigns a purchase to the statement of its month, or to the explicit month when given", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    const auto = await assignStatement(card, day("2026-09-06"), prisma);
    expect(auto.statement.month).toBe("2026-10");
    expect(ymd(auto.effectiveDate)).toBe("2026-10-05");
    const explicit = await assignStatement(card, day("2026-09-06"), prisma, "2026-12");
    expect(explicit.statement.month).toBe("2026-12");
    expect(ymd(explicit.effectiveDate)).toBe("2026-12-05");
  });
});

describe("openStatements", () => {
  it("answers an empty map for no cards", async () => {
    expect((await openStatements([], prisma, day("2026-09-10"))).size).toBe(0);
  });

  it("moves to the next month once an imported statement's own closing date has passed", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    // The bank's bill closed on the 3rd, earlier than the card's closing day 5.
    await ensureStatement(card, "2026-09", prisma, { closingDate: day("2026-09-03"), dueDate: day("2026-09-10") });
    const next = await ensureStatement(card, "2026-10", prisma, { closingDate: day("2026-10-02"), dueDate: day("2026-10-09") });
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 70, date: "2026-09-04", description: "Posto", }, prisma, { statementMonth: "2026-10" });

    const open = (await openStatements([card], prisma, day("2026-09-04"))).get(f.card)!;
    expect(open).toMatchObject({ statementId: next.id, month: "2026-10", total: 70, count: 1, closingDate: "2026-10-02", dueDate: "2026-10-09" });
  });

  it("falls back to the card's due day when an existing statement has no due date", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    await ensureStatement(card, "2026-10", prisma);
    const row = await ensureStatement(card, "2026-10", prisma, { dueDate: null });
    expect(row.dueDate).toBeNull();
    const open = (await openStatements([card], prisma, day("2026-09-10"))).get(f.card)!;
    expect(open).toMatchObject({ statementId: row.id, month: "2026-10", dueDate: "2026-10-12" });
    const noDue = (await openStatements([{ id: card.id, closingDay: 5, dueDay: null }], prisma, day("2026-09-10"))).get(f.card)!;
    expect(noDue.dueDate).toBeNull();
  });

  it("derives the dates from the card for a month with no row, and leaves the due date null for a card without due day", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    const noDue = { id: card.id, closingDay: null, dueDay: null };
    const open = (await openStatements([noDue], prisma, day("2026-09-10"))).get(f.card)!;
    expect(open).toEqual({ statementId: null, month: "2026-10", total: 0, count: 0, closingDate: "2026-10-01", dueDate: null });
  });
});

describe("markStatementPayment", () => {
  const settle = async () => {
    const purchase = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 300, date: "2026-09-03", description: "Mercado" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    const payment = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, date: "2026-09-12", description: "Pagamento fatura" }, prisma);
    return { purchase, statement, entryId: payment.entryIds[0] };
  };

  it("turns the expense into the checking leg of a card_payment and books the matching card leg", async () => {
    const { statement, entryId } = await settle();
    const r = await markStatementPayment(USER, entryId, statement.id, prisma);
    expect(r.statement.paymentGroupId).toBe(r.groupId);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.groupId }, include: { legs: true } });
    expect(group.direction).toBe("card_payment");
    expect(group.description).toBe("Pagamento fatura");
    expect(group.legs).toHaveLength(2);
    const checking = group.legs.find((l) => l.accountId === f.pfChecking)!;
    const cardLeg = group.legs.find((l) => l.accountId === f.card)!;
    expect(checking.kind).toBe("transfer");
    expect(checking.metadata).toMatchObject({ settledFromKind: "expense" });
    expect(Number(checking.amount)).toBe(-300);
    expect(Number(cardLeg.amount)).toBe(300);
    expect(Number(cardLeg.amountBase)).toBe(300);
  });

  it("404s on an entry or statement that is not the user's, or an entry in the trash", async () => {
    const { statement, entryId } = await settle();
    await expect(markStatementPayment(OTHER, entryId, statement.id, prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    await expect(markStatementPayment(USER, "no-such-entry", statement.id, prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    const foreign = await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 1, date: "2026-09-12", description: "x" }, prisma);
    await expect(markStatementPayment(OTHER, foreign.entryIds[0], statement.id, prisma)).rejects.toMatchObject({ status: 404, code: "statement.not_found" });
    await prisma.ledgerEntry.update({ where: { id: entryId }, data: { deletedAt: new Date() } });
    await expect(markStatementPayment(USER, entryId, statement.id, prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
  });

  it("refuses a statement already paid by a different transaction", async () => {
    const { statement, entryId } = await settle();
    await markStatementPayment(USER, entryId, statement.id, prisma);
    const second = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, date: "2026-09-13", description: "Outro pagamento" }, prisma);
    await expect(markStatementPayment(USER, second.entryIds[0], statement.id, prisma)).rejects.toMatchObject({ status: 409, code: "statement.payment_conflict" });
  });

  it("is idempotent for the same payment and refuses one already linked to another statement", async () => {
    const { statement, entryId } = await settle();
    const first = await markStatementPayment(USER, entryId, statement.id, prisma);
    const again = await markStatementPayment(USER, entryId, statement.id, prisma);
    expect(again.groupId).toBe(first.groupId);
    expect(await prisma.transferGroup.count({ where: { userId: USER, direction: "card_payment" } })).toBe(1);

    const card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    const october = await ensureStatement(card, "2026-10", prisma);
    await expect(markStatementPayment(USER, entryId, october.id, prisma)).rejects.toMatchObject({ status: 409, code: "statement.entry_linked_elsewhere" });
  });

  it("refuses a plain transfer and anything that is not an expense", async () => {
    const { statement } = await settle();
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-09-12" }, prisma);
    await expect(markStatementPayment(USER, transfer.entryIds[0], statement.id, prisma)).rejects.toMatchObject({ status: 422, code: "statement.transfer_not_settlement" });
    const income = await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 10, date: "2026-09-12", description: "Estorno" }, prisma);
    await expect(markStatementPayment(USER, income.entryIds[0], statement.id, prisma)).rejects.toMatchObject({ status: 422, code: "statement.settlement_requires_expense" });
  });
});

describe("unmarkStatementPayment", () => {
  it("turns the checking leg back into an expense, drops the card leg and frees the statement", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 90, date: "2026-09-03", description: "Mercado" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    const payment = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 90, date: "2026-09-12", description: "Fatura" }, prisma);
    const entryId = payment.entryIds[0];
    const { groupId } = await markStatementPayment(USER, entryId, statement.id, prisma);

    const r = await unmarkStatementPayment(USER, entryId, prisma);
    expect(r.statementId).toBe(statement.id);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry).toMatchObject({ kind: "expense", transferGroupId: null });
    expect(await prisma.transferGroup.count({ where: { id: groupId } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { accountId: f.card, kind: "transfer" } })).toBe(0);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBeNull();
  });

  it("answers a null statement id when the group was not linked to any statement", async () => {
    const created = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.card, amount: 40, date: "2026-09-12" }, prisma);
    expect(await prisma.cardStatement.count({ where: { paymentGroupId: created.transferGroupId } })).toBe(0);
    const r = await unmarkStatementPayment(USER, created.entryIds[0], prisma);
    expect(r.statementId).toBeNull();
  });

  it("404s on a missing entry and 422s on an entry or transfer that is not a card settlement", async () => {
    await expect(unmarkStatementPayment(USER, "missing", prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    const expense = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-09-12", description: "Cafe" }, prisma);
    await expect(unmarkStatementPayment(USER, expense.entryIds[0], prisma)).rejects.toMatchObject({ status: 422, code: "statement.not_settlement" });
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 5, date: "2026-09-12" }, prisma);
    await expect(unmarkStatementPayment(USER, transfer.entryIds[0], prisma)).rejects.toMatchObject({ status: 422, code: "statement.not_settlement" });
    expect(await prisma.transferGroup.count({ where: { id: transfer.transferGroupId! } })).toBe(1);
  });
});

describe("updateStatementDates", () => {
  it("moves the closing date and the effective date of the purchases on it, and not those of settled transfers", async () => {
    const purchase = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 60, date: "2026-09-03", description: "Livro" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    const updated = await updateStatementDates(USER, statement.id, { closingDate: day("2026-09-09"), dueDate: day("2026-09-20") }, prisma);
    expect(ymd(updated.closingDate)).toBe("2026-09-09");
    expect(ymd(updated.dueDate)).toBe("2026-09-20");
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchase.entryIds[0] } });
    expect(ymd(entry.effectiveDate)).toBe("2026-09-09");
    expect(ymd(entry.date)).toBe("2026-09-03");
  });

  it("changing only the due date leaves the purchases' effective date alone", async () => {
    const purchase = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 60, date: "2026-09-03", description: "Livro" }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    const updated = await updateStatementDates(USER, statement.id, { dueDate: day("2026-09-25") }, prisma);
    expect(ymd(updated.dueDate)).toBe("2026-09-25");
    expect(ymd(updated.closingDate)).toBe("2026-09-05");
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchase.entryIds[0] } });
    expect(ymd(entry.effectiveDate)).toBe("2026-09-05");
  });

  it("404s for a statement of another user", async () => {
    const card = await prisma.account.findUniqueOrThrow({ where: { id: other.card } });
    const foreign = await ensureStatement(card, "2026-09", prisma);
    await expect(updateStatementDates(USER, foreign.id, { dueDate: day("2026-09-25") }, prisma)).rejects.toMatchObject({ status: 404, code: "statement.not_found" });
    expect(ymd((await prisma.cardStatement.findUniqueOrThrow({ where: { id: foreign.id } })).dueDate)).toBe("2026-09-12");
  });
});
