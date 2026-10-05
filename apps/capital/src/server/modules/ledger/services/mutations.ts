import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { PrismaClient } from "@/generated/prisma";
import { LedgerError } from "../lib/errors";

export type MutationModel = "LedgerEntry" | "TransferGroup" | "CardStatement";

export interface MutationRecordInput {
  model: MutationModel;
  recordId: string;
  before: unknown | null;
  after: unknown | null;
}

/** JSON-safe snapshot (Decimal -> string, Date -> ISO). */
export function snapshot<T>(row: T | null | undefined): Prisma.InputJsonValue | null {
  if (row == null) return null;
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

/** Run `fn` atomically, reusing an outer transaction when there is one. */
export function inTransaction<T>(db: DbClient, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  if ("$transaction" in db && typeof (db as PrismaClient).$transaction === "function") {
    return (db as PrismaClient).$transaction((tx) => fn(tx), { timeout: 120_000, maxWait: 20_000 });
  }
  return fn(db);
}

export async function recordMutation(
  db: DbClient,
  userId: string,
  op: string,
  summary: string | null,
  records: MutationRecordInput[]
): Promise<string> {
  const batch = await db.mutationBatch.create({ data: { userId, op, summary } });
  if (records.length) {
    await db.mutationRecord.createMany({
      data: records.map((r) => ({
        batchId: batch.id,
        model: r.model,
        recordId: r.recordId,
        before: (r.before ?? Prisma.DbNull) as Prisma.InputJsonValue,
        after: (r.after ?? Prisma.DbNull) as Prisma.InputJsonValue,
      })),
    });
  }
  return batch.id;
}

const IMMUTABLE = new Set(["id", "userId", "createdAt", "updatedAt"]);

function restoreData(snap: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (IMMUTABLE.has(k)) continue;
    data[k] = k === "metadata" && v === null ? Prisma.DbNull : v;
  }
  return data;
}

/**
 * Reverts one batch: rows the batch created are removed, updated or
 * soft-deleted rows get their `before` snapshot back. Batches are undone
 * newest-first per row, so undoing an older batch after a newer one that
 * touched the same row is rejected.
 */
export async function undoBatch(userId: string, batchId: string, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const batch = await tx.mutationBatch.findFirst({ where: { id: batchId, userId }, include: { records: true } });
    if (!batch) throw new LedgerError("Mutation batch not found", 404, { code: "undo.not_found" });
    if (batch.undoneAt) throw new LedgerError("Batch already undone", 409, { code: "undo.already_undone" });

    const touched = batch.records.map((r) => r.recordId);
    const newer = await tx.mutationRecord.findFirst({
      where: {
        recordId: { in: touched },
        batch: { userId, createdAt: { gt: batch.createdAt }, undoneAt: null },
      },
    });
    if (newer) throw new LedgerError("A newer change touched these rows; undo it first", 409, { code: "undo.newer_change" });

    const ordered = [...batch.records].reverse();
    // Created rows: drop entries before their groups.
    for (const rec of ordered.filter((r) => r.before === null && r.model === "LedgerEntry")) {
      await tx.ledgerEntry.deleteMany({ where: { id: rec.recordId, userId } });
    }
    for (const rec of ordered.filter((r) => r.before === null && r.model === "TransferGroup")) {
      await tx.transferGroup.deleteMany({ where: { id: rec.recordId, userId } });
    }
    for (const rec of ordered.filter((r) => r.before === null && r.model === "CardStatement")) {
      await tx.cardStatement.deleteMany({ where: { id: rec.recordId, entries: { none: {} } } });
    }
    // Updated / soft-deleted rows: groups first (legs reference them).
    for (const rec of ordered.filter((r) => r.before !== null && r.model === "TransferGroup")) {
      await tx.transferGroup.updateMany({ where: { id: rec.recordId, userId }, data: restoreData(rec.before as Record<string, unknown>) });
    }
    for (const rec of ordered.filter((r) => r.before !== null && r.model === "LedgerEntry")) {
      await tx.ledgerEntry.updateMany({ where: { id: rec.recordId, userId }, data: restoreData(rec.before as Record<string, unknown>) });
    }
    for (const rec of ordered.filter((r) => r.before !== null && r.model === "CardStatement")) {
      await tx.cardStatement.updateMany({ where: { id: rec.recordId }, data: restoreData(rec.before as Record<string, unknown>) });
    }

    await tx.mutationBatch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } });
    return { batchId: batch.id, reverted: batch.records.length, op: batch.op };
  });
}

export async function listBatches(userId: string, db: DbClient, limit = 50) {
  return db.mutationBatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { _count: { select: { records: true } } },
  });
}
