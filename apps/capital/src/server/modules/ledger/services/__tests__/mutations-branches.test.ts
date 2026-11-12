import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry, softDeleteEntries } from "../entries";
import {
  currentMutationSource,
  inTransaction,
  lastRecordOf,
  listBatches,
  recordMutation,
  recreateRecord,
  snapshot,
  undoBatch,
  withMutationSource,
} from "../mutations";

const USER = "test-user-ledger-mutations-branches-001";
const OTHER = "test-user-ledger-mutations-branches-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const expense = (description = "Cafe") => createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-10", description }, prisma);

describe("undoBatch guards", () => {
  it("404s on a batch that is not the user's, and refuses one already undone", async () => {
    const r = await expense();
    await expect(undoBatch(OTHER, r.batchId!, prisma)).rejects.toMatchObject({ status: 404, code: "undo.not_found" });
    await expect(undoBatch(USER, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "undo.not_found" });
    const undone = await undoBatch(USER, r.batchId!, prisma);
    expect(undone).toMatchObject({ batchId: r.batchId, reverted: 1, op: "create" });
    await expect(undoBatch(USER, r.batchId!, prisma)).rejects.toMatchObject({ status: 409, code: "undo.already_undone" });
    expect(await prisma.ledgerEntry.count({ where: { id: r.entryIds[0] } })).toBe(0);
  });

  it("refuses a batch that records a model it cannot undo, naming it", async () => {
    const batch = await prisma.mutationBatch.create({ data: { userId: USER, op: "weird", records: { create: [{ model: "Gizmo", recordId: "g1" }] } } });
    await expect(undoBatch(USER, batch.id, prisma)).rejects.toMatchObject({ status: 422, code: "undo.unsupported", params: { model: "Gizmo" } });
  });
});

describe("old revert batches", () => {
  it("reopen the imports found through the trashed rows when the batch did not record the Import", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, transactionCount: 1, revertedAt: new Date("2026-09-30T10:00:00Z") } });
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-10", description: "Importada" }, prisma, { importId: imp.id, record: false });
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    const before = snapshot(entry);
    const after = snapshot({ ...entry, deletedAt: new Date("2026-09-30T10:00:00Z") });
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { deletedAt: new Date("2026-09-30T10:00:00Z") } });
    const batch = await prisma.mutationBatch.create({
      data: { userId: USER, op: "revert", records: { create: [{ model: "LedgerEntry", recordId: entry.id, before: before!, after: after! }] } },
    });

    await undoBatch(USER, batch.id, prisma);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: imp.id } })).revertedAt).toBeNull();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt).toBeNull();
  });

  it("restore revertedAt through the Import record when the batch has one, and leave other imports alone", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, transactionCount: 1, revertedAt: new Date("2026-09-30T10:00:00Z") } });
    const withImport = await prisma.mutationBatch.create({
      data: {
        userId: USER,
        op: "revert",
        records: { create: [{ model: "Import", recordId: imp.id, before: snapshot({ ...imp, revertedAt: null })!, after: snapshot(imp)! }] },
      },
    });
    await undoBatch(USER, withImport.id, prisma);
    // The Import record puts revertedAt back through its own before (null), as any other field.
    expect((await prisma.import.findUniqueOrThrow({ where: { id: imp.id } })).revertedAt).toBeNull();

    const plain = await expense("Sem importacao");
    const e = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: plain.entryIds[0] } });
    const stillReverted = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, transactionCount: 1, revertedAt: new Date("2026-09-30T10:00:00Z") } });
    const noImportRows = await prisma.mutationBatch.create({
      data: { userId: USER, op: "revert", records: { create: [{ model: "LedgerEntry", recordId: e.id, before: snapshot(e)!, after: snapshot({ ...e, notes: "x" })! }] } },
    });
    await undoBatch(USER, noImportRows.id, prisma);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: stillReverted.id } })).revertedAt).not.toBeNull();
  });
});

describe("recreateRecord and lastRecordOf", () => {
  it("re-creates a row deleted outright under its id, owned by the user", async () => {
    const cat = await prisma.category.create({ data: { userId: USER, name: "Temp", type: "expense" } });
    const snap = snapshot(cat) as Record<string, unknown>;
    await prisma.category.delete({ where: { id: cat.id } });
    await recreateRecord(prisma, USER, "Category", cat.id, snap);
    expect(await prisma.category.findUniqueOrThrow({ where: { id: cat.id } })).toMatchObject({ name: "Temp", userId: USER });
  });

  it("finds the newest live record that held a value in a field before its batch, and nothing for an unknown value", async () => {
    const holdingLike = "op-123";
    const older = await recordMutation(prisma, USER, "update", null, [{ model: "LedgerEntry", recordId: "r-old", before: { cashEntryId: holdingLike, n: 1 }, after: { cashEntryId: null, n: 2 } }]);
    const newer = await recordMutation(prisma, USER, "update", null, [{ model: "LedgerEntry", recordId: "r-new", before: { cashEntryId: holdingLike, n: 3 }, after: null }]);
    const found = await lastRecordOf(prisma, USER, "LedgerEntry", "cashEntryId", holdingLike);
    expect(found).toEqual({ recordId: "r-new", before: { cashEntryId: holdingLike, n: 3 }, after: null });
    await prisma.mutationBatch.update({ where: { id: newer }, data: { undoneAt: new Date() } });
    expect((await lastRecordOf(prisma, USER, "LedgerEntry", "cashEntryId", holdingLike))?.recordId).toBe("r-old");
    expect(older).not.toBe(newer);
    expect(await lastRecordOf(prisma, USER, "LedgerEntry", "cashEntryId", "unknown")).toBeNull();
    expect(await lastRecordOf(prisma, OTHER, "LedgerEntry", "cashEntryId", holdingLike)).toBeNull();
  });
});

describe("recordMutation, sources and transactions", () => {
  it("records a batch without records, with the source in context, or the one it is given", async () => {
    const empty = await recordMutation(prisma, USER, "noop", "nada", []);
    expect(await prisma.mutationRecord.count({ where: { batchId: empty } })).toBe(0);
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: empty } })).toMatchObject({ source: "user", op: "noop", summary: "nada" });

    expect(currentMutationSource()).toBeUndefined();
    const viaContext = await withMutationSource("mcp", () => {
      expect(currentMutationSource()).toBe("mcp");
      return recordMutation(prisma, USER, "tool", null, []);
    });
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: viaContext } })).source).toBe("mcp");
    const explicit = await withMutationSource("mcp", () => recordMutation(prisma, USER, "cron", null, [], { source: "system" }));
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: explicit } })).source).toBe("system");
  });

  it("stores null snapshots as database nulls and a plain row as its JSON", async () => {
    const id = await recordMutation(prisma, USER, "mix", null, [
      { model: "LedgerEntry", recordId: "created", before: null, after: { a: 1 } },
      { model: "LedgerEntry", recordId: "deleted", before: { a: 1 }, after: null },
    ]);
    const rows = await prisma.mutationRecord.findMany({ where: { batchId: id } });
    expect(rows.find((r) => r.recordId === "created")).toMatchObject({ before: null, after: { a: 1 } });
    expect(rows.find((r) => r.recordId === "deleted")).toMatchObject({ before: { a: 1 }, after: null });
    expect(snapshot(null)).toBeNull();
    expect(snapshot(undefined)).toBeNull();
    expect(snapshot({ d: new Date("2026-01-01T00:00:00Z") })).toEqual({ d: "2026-01-01T00:00:00.000Z" });
  });

  it("runs the function directly on a client that cannot open a transaction", async () => {
    const stub = { marker: true } as unknown as DbClient;
    await expect(inTransaction(stub, async (tx) => (tx as unknown as { marker: boolean }).marker)).resolves.toBe(true);
    await expect(inTransaction(prisma, async (tx) => tx !== prisma)).resolves.toBe(true);
  });
});

describe("listBatches", () => {
  it("limits the list, newest first, and counts each batch's records", async () => {
    const a = await expense("A");
    const b = await expense("B");
    await softDeleteEntries(USER, b.entryIds, prisma);
    const all = await listBatches(USER, prisma);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0].op).toBe("delete");
    expect(all[0].createdAt.getTime()).toBeGreaterThanOrEqual(all[1].createdAt.getTime());
    expect(all.find((x) => x.id === a.batchId)).toMatchObject({ op: "create", records: 1, undoable: true });
    expect(all.find((x) => x.id === b.batchId)).toMatchObject({ undoable: false });
    expect(await listBatches(USER, prisma, { limit: 1 })).toHaveLength(1);
    expect(await listBatches(OTHER, prisma)).toEqual([]);
  });

  it("leaves system batches and ones a newer change blocks out of the undoable list", async () => {
    const a = await expense("A");
    const sys = await recordMutation(prisma, USER, "cron", null, [], { source: "system" });
    const undoable = (await listBatches(USER, prisma, { undoable: true })).map((x) => x.id);
    expect(undoable).toContain(a.batchId);
    expect(undoable).not.toContain(sys);
    await undoBatch(USER, a.batchId!, prisma);
    expect((await listBatches(USER, prisma, { undoable: true })).map((x) => x.id)).not.toContain(a.batchId);
  });
});
