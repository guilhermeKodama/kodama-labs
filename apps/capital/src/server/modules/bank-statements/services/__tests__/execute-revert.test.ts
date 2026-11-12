import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry, updateEntry } from "@capital/server/modules/ledger/services/entries";
import { snapshot } from "@capital/server/modules/ledger/services/mutations";
import { executeImport } from "../execute-import";
import { executeRevert } from "../execute-revert";

/**
 * Reverting an import in the situations the dialog tests do not reach:
 * imports from before batches recorded them, rows edited again since,
 * rows that vanished, projected installments the import replaced, cards
 * and installment plans that are still in use.
 */

const USER = "test-user-exec-revert-a";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, `${USER}-other`);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, `${USER}-other`);
});

const plan = (over: Partial<ImportPlanPayload> = {}): ImportPlanPayload => ({
  entityType: "personal",
  entityId: f.pfId,
  currency: "BRL",
  transactions: [],
  transfers: [],
  investmentTransfers: [],
  creditCards: [],
  bills: [],
  reconciliations: [],
  transferReconciliations: [],
  duplicateDecisions: [],
  investmentTransactions: [],
  ...over,
});
const run = (p: ImportPlanPayload) => executeImport(USER, p, prisma);
const revert = (importId: string, createdRecords: { model: string; id: string }[] = []) => executeRevert(USER, { statementImportId: importId, createdRecords }, prisma);
const entry = (id: string) => prisma.ledgerEntry.findUniqueOrThrow({ where: { id } });
const cardPlan = (rows: NonNullable<ImportPlanPayload["cardStatement"]>["rows"], month = "2026-09") =>
  plan({ accountId: f.card, cardStatement: { month, closingDate: `${month}-05`, dueDate: `${month}-12`, rows } });
const tv = (n: number) => ({ date: "2026-08-15", description: "TV", amount: 300, installment: { number: n, total: 3 } });

describe("executeRevert: what can be reverted", () => {
  it("answers 404 for an import that is not the user's and 409 for one already reverted", async () => {
    await expect(revert("nao-existe")).rejects.toMatchObject({ status: 404, code: "import.not_found" });
    const foreign = await prisma.import.create({ data: { userId: `${USER}-other`, transactionCount: 0 } });
    await expect(revert(foreign.id)).rejects.toMatchObject({ status: 404, code: "import.not_found" });

    const r = await run(plan({ transactions: [{ externalId: "a", date: "2026-09-02", description: "Pao", amount: 5, type: "expense" }] }));
    await revert(r.importId);
    await expect(revert(r.importId)).rejects.toMatchObject({ status: 409, code: "import.already_reverted" });
  });

  it("reverts an import from before batches recorded it, by the rows that carry its id", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 1 } });
    const created = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 12, description: "Antigo", date: "2026-09-02" }, prisma, { importId: imp.id });
    const kept = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 7, description: "Manual", date: "2026-09-03" }, prisma)).entryIds[0];

    const r = await revert(imp.id);
    expect(r).toMatchObject({ transactionsDeleted: 1, transfersDeleted: 0, changesRestored: 0, changesKept: 0, creditCardsDeleted: 0, billsDeleted: 0, investmentTransactionsDeleted: 0 });
    expect((await entry(created.entryIds[0])).deletedAt).not.toBeNull();
    expect((await entry(kept)).deletedAt).toBeNull();
    expect((await prisma.import.findUniqueOrThrow({ where: { id: imp.id } })).revertedAt).not.toBeNull();
  });
});

describe("executeRevert: rows the import changed without creating", () => {
  async function importWithReconciliation() {
    const booked = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 50, description: "Padaria", date: "2026-09-03" }, prisma)).entryIds[0];
    const r = await run(plan({ reconciliations: [{ existingTransactionId: booked, externalId: "fit-1", updates: { amount: 55, description: "Padaria Real" } }] }));
    expect(r.reconciled).toBe(1);
    return { booked, r };
  }

  it("puts the earlier values back", async () => {
    const { booked, r } = await importWithReconciliation();
    expect(toNumber((await entry(booked)).amount)).toBe(-55);
    const reverted = await revert(r.importId);
    expect(reverted).toMatchObject({ changesRestored: 1, changesKept: 0 });
    expect([toNumber((await entry(booked)).amount), (await entry(booked)).description]).toEqual([-50, "Padaria"]);
  });

  it("keeps a row edited again since the import, and says so", async () => {
    const { booked, r } = await importWithReconciliation();
    await updateEntry(USER, booked, { amount: 61 }, prisma);
    const reverted = await revert(r.importId);
    expect(reverted).toMatchObject({ changesRestored: 0, changesKept: 1 });
    expect([toNumber((await entry(booked)).amount), (await entry(booked)).description]).toEqual([-61, "Padaria Real"]);
  });

  it("skips a row that no longer exists", async () => {
    const { booked, r } = await importWithReconciliation();
    await prisma.ledgerEntry.delete({ where: { id: booked } });
    expect(await revert(r.importId)).toMatchObject({ changesRestored: 0, changesKept: 0 });
  });

  it("does not count a record whose only differences are bookkeeping columns (the statement's updatedAt)", async () => {
    const withTotal = (rows: NonNullable<ImportPlanPayload["cardStatement"]>["rows"]) =>
      plan({ accountId: f.card, cardStatement: { month: "2026-09", closingDate: "2026-09-05", dueDate: "2026-09-12", total: 100, rows } });
    await run(withTotal([{ date: "2026-08-20", description: "Mercado", amount: 100 }]));
    // The same statement again: its total is written back unchanged, which only moves updatedAt.
    const again = await run(withTotal([{ date: "2026-08-20", description: "Mercado", amount: 100 }]));
    const batch = await prisma.mutationRecord.findMany({ where: { batchId: again.batchId, model: "CardStatement" } });
    expect(batch).toHaveLength(1);
    expect(await revert(again.importId)).toMatchObject({ changesRestored: 0, changesKept: 0 });
  });

  it("restores any model an import batch recorded as changed, an installment plan included", async () => {
    await run(cardPlan([tv(1)]));
    const installmentPlan = await prisma.installmentPlan.findFirstOrThrow({ where: { accountId: f.card } });
    // A batch of an earlier import that also changed this plan's description: recorded as before/after.
    const second = await run(plan());
    const after = await prisma.installmentPlan.update({ where: { id: installmentPlan.id }, data: { description: "TV da sala" } });
    await prisma.mutationRecord.create({
      data: { batchId: second.batchId, model: "InstallmentPlan", recordId: installmentPlan.id, before: snapshot(installmentPlan)!, after: snapshot(after)! },
    });
    const reverted = await revert(second.importId);
    expect(reverted.changesRestored).toBe(1);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: installmentPlan.id } })).description).toBe("TV");
  });
});

describe("executeRevert: installments", () => {
  it("brings back the projected installment the import replaced, under its id", async () => {
    await run(cardPlan([tv(1)]));
    const projected = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, installmentNumber: 2, deletedAt: null } });
    const second = await run(cardPlan([tv(2)], "2026-10"));
    expect(await prisma.ledgerEntry.count({ where: { id: projected.id } })).toBe(0);

    await revert(second.importId);
    const back = await entry(projected.id);
    expect(back).toMatchObject({ installmentNumber: 2, deletedAt: null });
    expect(back.metadata).toMatchObject({ projected: true });
    // The real second installment went to the trash.
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, installmentNumber: 2, deletedAt: null } })).toBe(1);
  });

  it("closes the plan an import started once none of its installments is left, and keeps it while another import's are", async () => {
    const first = await run(cardPlan([tv(1)]));
    const second = await run(cardPlan([tv(2)], "2026-10"));
    const installmentPlan = await prisma.installmentPlan.findFirstOrThrow({ where: { accountId: f.card } });
    const isActive = async () => (await prisma.installmentPlan.findUniqueOrThrow({ where: { id: installmentPlan.id } })).isActive;

    // The first import started the plan; the second one's installment is gone, the first one's still there.
    await revert(second.importId);
    expect(await isActive()).toBe(true);
    await revert(first.importId);
    expect(await isActive()).toBe(false);
  });

  it("keeps the plan open while a row of another import is still in it", async () => {
    const first = await run(cardPlan([tv(1)]));
    await run(cardPlan([tv(2)], "2026-10"));
    const installmentPlan = await prisma.installmentPlan.findFirstOrThrow({ where: { accountId: f.card } });
    await revert(first.importId);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: installmentPlan.id } })).isActive).toBe(true);
  });
});

describe("executeRevert: cards the import created", () => {
  const newCard = { bankName: "Itaú", lastFourDigits: "9876", closingDay: 10, dueDay: 17, currency: "BRL" };

  it("keeps a card that holds a row of something else", async () => {
    const r = await run(plan({ creditCards: [newCard] }));
    const card = await prisma.account.findFirstOrThrow({ where: { userId: USER, externalId: "9876" } });
    await createEntry(USER, { kind: "expense", accountId: card.id, amount: 20, description: "Compra", date: "2026-09-02" }, prisma);
    expect((await revert(r.importId)).creditCardsDeleted).toBe(0);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: card.id } })).archivedAt).toBeNull();
  });

  it("archives the cards named by the caller's records too (an assistant import), and ignores one already archived or not a card", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 0 } });
    const loose = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Solto", currency: "BRL", closingDay: 5, dueDay: 12 } });
    const archived = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Velho", currency: "BRL", archivedAt: new Date() } });
    const r = await revert(imp.id, [
      { model: "Account", id: loose.id },
      { model: "CreditCard", id: archived.id },
      { model: "Account", id: f.pfChecking },
    ]);
    expect(r.creditCardsDeleted).toBe(1);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: loose.id } })).archivedAt).not.toBeNull();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: f.pfChecking } })).archivedAt).toBeNull();
  });
});
