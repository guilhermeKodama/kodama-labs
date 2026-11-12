import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { bookCardPayment, findStatementPaymentEntry, linkStatementPayment, patchCreatedRecord, paymentStatementMonth } from "../card-payments";

const USER = "test-user-card-payments-a";
let f: LedgerFixture;
let card: Account;
let checking: Account;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  card = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
  checking = await prisma.account.findUniqueOrThrow({ where: { id: f.pfChecking } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const at = (d: string) => new Date(`${d}T12:00:00Z`);
const newImport = () => prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, ledgerCurrency: "BRL", transactionCount: 0 } });

describe("paymentStatementMonth", () => {
  it("treats a card with no closing day as closing on the 1st", () => {
    // Without a due day: the latest statement closed by the payment date.
    expect(paymentStatementMonth({ closingDay: null, dueDay: null }, at("2026-09-20"))).toBe("2026-09");
    expect(paymentStatementMonth({ closingDay: null, dueDay: null }, at("2026-10-01"))).toBe("2026-10");
    // With a due day on the 10th (same month as the closing on the 1st).
    expect(paymentStatementMonth({ closingDay: null, dueDay: 10 }, at("2026-09-10"))).toBe("2026-09");
  });

  it("crosses the year when the payment is in January for a December statement", () => {
    expect(paymentStatementMonth({ closingDay: 20, dueDay: 5 }, at("2027-01-04"))).toBe("2026-12");
  });
});

describe("patchCreatedRecord", () => {
  const row = (extra: object) => snapshot({ id: "e1", ...extra })!;

  it("replaces the 'after' of the row the batch created", () => {
    const records: MutationRecordInput[] = [{ model: "LedgerEntry", recordId: "e1", before: null, after: row({ kind: "expense" }) }];
    patchCreatedRecord(records, "LedgerEntry", "e1", { id: "e1", kind: "transfer" });
    expect(records).toHaveLength(1);
    expect(records[0].after).toMatchObject({ kind: "transfer" });
    expect(records[0].before).toBeNull();
  });

  it("adds a created record when the batch has none for the row, or only a record of a row it changed", () => {
    const records: MutationRecordInput[] = [{ model: "LedgerEntry", recordId: "e1", before: row({ kind: "expense" }), after: row({ kind: "income" }) }];
    patchCreatedRecord(records, "LedgerEntry", "e1", { id: "e1", kind: "transfer" });
    patchCreatedRecord(records, "TransferGroup", "g1", { id: "g1" });
    expect(records.map((r) => [r.model, r.recordId, r.before === null])).toEqual([
      ["LedgerEntry", "e1", false],
      ["LedgerEntry", "e1", true],
      ["TransferGroup", "g1", true],
    ]);
  });
});

describe("bookCardPayment", () => {
  const book = (input: { externalId: string; date: string; amount: number; description?: string; statementMonth?: string }, importId: string) => {
    const collect: MutationRecordInput[] = [];
    return inTransaction(prisma, async (tx) => ({
      ...(await bookCardPayment(USER, checking, card, { currency: "BRL", ...input }, tx, { importId, collect, defaultDescription: "Pagamento de fatura" })),
      collect,
    }));
  };

  it("books the bank row as the payment of the statement due nearest, linking the statement to the transfer", async () => {
    const imp = await newImport();
    const r = await book({ externalId: "pay-1", date: "2026-09-11", amount: 289.2 }, imp.id);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    expect(r.statementId).toBe(statement.id);
    expect(statement.paymentGroupId).toBe(r.groupId);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.groupId }, include: { legs: true } });
    expect(group).toMatchObject({ direction: "card_payment", externalId: "pay-1" });
    expect(group.legs.map((l) => [l.accountId, toNumber(l.amount), l.description, l.importId]).sort()).toEqual(
      [
        [f.pfChecking, -289.2, "Pagamento de fatura", imp.id],
        [f.card, 289.2, "Pagamento de fatura", imp.id],
      ].sort()
    );
    // The batch records the statement settled, the transfer group and both legs.
    expect(r.collect.map((c) => c.model).sort()).toEqual(["CardStatement", "CardStatement", "LedgerEntry", "LedgerEntry", "TransferGroup"].sort());
  });

  it("uses the description it is given, and the statement month it is told to settle", async () => {
    const imp = await newImport();
    const r = await book({ externalId: "pay-2", date: "2026-09-11", amount: 100, description: "Fatura Nubank agosto", statementMonth: "2026-08" }, imp.id);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-08" } });
    expect(statement.paymentGroupId).toBe(r.groupId);
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: r.groupId, accountId: f.pfChecking } })).description).toBe("Fatura Nubank agosto");
  });

  it("books a second payment of a settled statement as a plain card payment transfer, without taking the link over", async () => {
    const imp = await newImport();
    const first = await book({ externalId: "pay-1", date: "2026-09-11", amount: 200 }, imp.id);
    const second = await book({ externalId: "pay-2", date: "2026-09-12", amount: 89.2 }, imp.id);
    expect(second.groupId).not.toBe(first.groupId);
    expect(second.statementId).toBeNull();
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: second.groupId }, include: { legs: true } });
    expect(group).toMatchObject({ direction: "card_payment", externalId: "pay-2" });
    expect(group.legs.map((l) => toNumber(l.amount)).sort((a, b) => a - b)).toEqual([-89.2, 89.2]);
    expect((await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } })).paymentGroupId).toBe(first.groupId);
    // Its patched created-record carries the external id the group was given.
    expect(second.collect.find((c) => c.model === "TransferGroup" && c.recordId === group.id)?.after).toMatchObject({ externalId: "pay-2" });
  });

  it("books under a ~dup external id when the bank account already holds the row's FITID, keeping the plain id on the transfer group", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "Antigo", date: "2026-09-01", externalId: "pay-1" }, prisma);
    const imp = await newImport();
    const r = await book({ externalId: "pay-1", date: "2026-09-11", amount: 289.2 }, imp.id);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.groupId } });
    expect(group.externalId).toBe("pay-1");
    const bankLeg = await prisma.ledgerEntry.findFirstOrThrow({ where: { transferGroupId: r.groupId, accountId: f.pfChecking } });
    expect(bankLeg.externalId).toBe("pay-1~dup1");
  });
});

describe("linkStatementPayment", () => {
  it("turns an existing bank expense into the statement's payment and stores the group's external id", async () => {
    const paid = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 289.2, description: "Pagamento fatura", date: "2026-09-11" }, prisma)).entryIds[0];
    const statement = await prisma.cardStatement.create({ data: { accountId: f.card, month: "2026-09", closingDate: at("2026-09-05"), dueDate: at("2026-09-12") } });
    const records: MutationRecordInput[] = [];
    const { groupId } = await inTransaction(prisma, (tx) => linkStatementPayment(USER, paid, statement, tx, records, { externalId: "fit-bill" }));

    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: groupId } });
    expect(group).toMatchObject({ direction: "card_payment", externalId: "fit-bill" });
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBe(groupId);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid } })).toMatchObject({ kind: "transfer", transferGroupId: groupId });
    // The changed bank entry has its earlier values in the record (it was not created by the batch).
    const entryRecord = records.find((r) => r.model === "LedgerEntry" && r.recordId === paid)!;
    expect(entryRecord.before).toMatchObject({ kind: "expense" });
    expect(entryRecord.after).toMatchObject({ kind: "transfer" });
    expect(records.find((r) => r.model === "CardStatement")?.before).toMatchObject({ paymentGroupId: null });
  });
});

describe("findStatementPaymentEntry", () => {
  const due = at("2026-09-12");
  const expense = (amount: number, date: string, extra: Partial<Parameters<typeof createEntry>[1]> = {}) =>
    createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount, description: `Pgto ${date}`, date, ...extra } as Parameters<typeof createEntry>[1], prisma).then((r) => r.entryIds[0]);

  it("finds nothing for a settled statement, one without a due date, or a bill with no total", async () => {
    await expense(289.2, "2026-09-11");
    expect(await findStatementPaymentEntry(USER, card, { dueDate: due, paymentGroupId: "g1" }, 289.2, prisma)).toBeNull();
    expect(await findStatementPaymentEntry(USER, card, { dueDate: null, paymentGroupId: null }, 289.2, prisma)).toBeNull();
    expect(await findStatementPaymentEntry(USER, card, { dueDate: due, paymentGroupId: null }, 0, prisma)).toBeNull();
    expect(await findStatementPaymentEntry(USER, card, { dueDate: due, paymentGroupId: null }, -5, prisma)).toBeNull();
  });

  it("takes the expense of the exact total on the paying account, closest to the due date, within ten days before and a week after", async () => {
    const early = await expense(289.2, "2026-09-03");
    const near = await expense(289.2, "2026-09-13");
    await expense(289.2, "2026-08-01");
    await expense(289.2, "2026-09-25");
    await expense(300, "2026-09-12");
    await createEntry(USER, { kind: "expense", accountId: f.pjChecking, amount: 289.2, description: "Outra conta", date: "2026-09-12" }, prisma);
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 289.2, description: "Entrada", date: "2026-09-12" }, prisma);
    const found = await findStatementPaymentEntry(USER, card, { dueDate: due, paymentGroupId: null }, 289.2, prisma);
    expect(found?.id).toBe(near);
    expect(found?.id).not.toBe(early);
  });

  it("looks at every bank account of the card's entity when the card has no paying account", async () => {
    const cash = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Carteira", currency: "BRL" } });
    const paid = (await createEntry(USER, { kind: "expense", accountId: cash.id, amount: 50, description: "Dinheiro", date: "2026-09-10" }, prisma)).entryIds[0];
    const loose = await prisma.account.update({ where: { id: f.card }, data: { payFromAccountId: null } });
    expect((await findStatementPaymentEntry(USER, loose, { dueDate: due, paymentGroupId: null }, 50, prisma))?.id).toBe(paid);
  });

  it("finds nothing when the card's entity has no bank account to pay from", async () => {
    const solo = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Sem conta", defaultCurrency: "BRL" } });
    const orphanCard = await prisma.account.create({ data: { userId: USER, entityId: solo.id, type: "credit_card", name: "Cartão solto", currency: "BRL", closingDay: 5, dueDay: 12 } });
    expect(await findStatementPaymentEntry(USER, orphanCard, { dueDate: due, paymentGroupId: null }, 10, prisma)).toBeNull();
  });
});
