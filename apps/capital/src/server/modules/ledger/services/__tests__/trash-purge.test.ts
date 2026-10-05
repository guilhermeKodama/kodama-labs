import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, deleteOperation, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { createEntry, purgeTrash, softDeleteEntries, trashRowCount } from "../entries";
import { listBatches, undoBatch } from "../mutations";

const USER = "test-user-s2-trash-purge-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("trash", () => {
  it("counts a deleted transfer once", async () => {
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 500, date: "2026-09-01" }, prisma);
    const expense = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 20, description: "Café", date: "2026-09-02" }, prisma);
    await softDeleteEntries(USER, [transfer.entryIds[0], expense.entryIds[0]], prisma);
    expect(await trashRowCount(USER, prisma)).toBe(2);
  });

  it("purges for good, and older batches on the purged rows stop being undoable", async () => {
    const created = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 20, description: "Café", date: "2026-09-02" }, prisma);
    const deleted = await softDeleteEntries(USER, created.entryIds, prisma);
    expect((await listBatches(USER, prisma, { undoable: true })).map((b) => b.id)).toContain(deleted.batchId);

    const purged = await purgeTrash(prisma, 0, USER);
    expect(purged).toEqual({ groups: 0, entries: 1 });
    expect(await prisma.ledgerEntry.count({ where: { id: { in: created.entryIds } } })).toBe(0);

    const batches = await prisma.mutationBatch.findMany({ where: { userId: USER, op: "purge" }, include: { records: true } });
    expect(batches).toHaveLength(1);
    expect(batches[0].source).toBe("system");
    expect(batches[0].records.map((r) => r.recordId)).toEqual(created.entryIds);

    const undoable = (await listBatches(USER, prisma, { undoable: true })).map((b) => b.id);
    expect(undoable).not.toContain(deleted.batchId);
    expect(undoable).not.toContain(created.batchId);
    await expect(undoBatch(USER, deleted.batchId!, prisma)).rejects.toMatchObject({ status: 409, code: "undo.newer_change" });
  });

  it("refuses to undo an operation delete whose cash leg was purged, instead of a broken link", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "etf", ticker: "BOVA11", name: "iShares Ibovespa" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000, date: "2026-09-16" }, prisma);
    const removed = await deleteOperation(USER, buy.operation.id, prisma);
    await purgeTrash(prisma, 0, USER);
    await expect(undoBatch(USER, removed.batchId!, prisma)).rejects.toMatchObject({ status: 409, code: "undo.newer_change" });
  });

  it("records nothing when no batch knew the purged rows", async () => {
    const entry = await prisma.ledgerEntry.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.pfChecking,
        kind: "expense",
        amount: -5,
        currency: "BRL",
        exchangeRate: 1,
        amountBase: -5,
        date: new Date("2026-09-01T12:00:00Z"),
        effectiveDate: new Date("2026-09-01T12:00:00Z"),
        description: "Sem lote",
        deletedAt: new Date("2026-09-02T12:00:00Z"),
      },
    });
    await purgeTrash(prisma, 0, USER);
    expect(await prisma.ledgerEntry.count({ where: { id: entry.id } })).toBe(0);
    expect(await prisma.mutationBatch.count({ where: { userId: USER, op: "purge" } })).toBe(0);
  });
});
