import { AsyncLocalStorage } from "node:async_hooks";
import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { MutationRecord, PrismaClient } from "@/generated/prisma";
import { recalculateHolding } from "@capital/server/modules/investments/lib/holding-position";
import { LedgerError } from "../lib/errors";

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

/** The four delegate calls undo needs, typed loosely so one registry covers every model. */
interface RecordDelegate {
  count(args: { where: object }): Promise<number>;
  create(args: { data: object }): Promise<unknown>;
  updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  deleteMany(args: { where: object }): Promise<{ count: number }>;
}

type DelegateName =
  | "ledgerEntry"
  | "transferGroup"
  | "cardStatement"
  | "installmentPlan"
  | "recurringRule"
  | "investmentOperation"
  | "categorizationRule"
  | "budget"
  | "import";

interface ModelSpec {
  delegate: DelegateName;
  /** Where clause for the row with this id when the user owns it. */
  owned: (id: string, userId: string) => object;
  /** The table has a userId column; re-created rows get the batch's user. */
  userScoped: boolean;
  /** Extra condition before a row the batch created is removed. */
  removable?: object;
  /** Nullable Json columns: a null in a snapshot is written back as DbNull. */
  json?: readonly string[];
  /** Runs once after a batch is undone, with this model's records. */
  afterUndo?: (tx: DbClient, records: MutationRecord[]) => Promise<void>;
}

const byUser = (id: string, userId: string) => ({ id, userId });

/** Holdings whose operations the batch touched get their position recomputed from the operations left. */
async function recalculateTouchedHoldings(tx: DbClient, records: MutationRecord[]) {
  const holdingIds = new Set<string>();
  for (const r of records) {
    for (const snap of [r.before, r.after]) {
      const holdingId = (snap as { holdingId?: unknown } | null)?.holdingId;
      if (typeof holdingId === "string") holdingIds.add(holdingId);
    }
  }
  for (const id of holdingIds) {
    if (await tx.investmentHolding.count({ where: { id } })) await recalculateHolding(id, tx);
  }
}

/**
 * Every model a batch can record. Writers snapshot plain rows (no
 * relations) of these models; undo removes the rows a batch created,
 * restores the `before` of rows it changed, and re-creates with the same id
 * the rows it deleted outright.
 */
const MODELS = {
  LedgerEntry: { delegate: "ledgerEntry", owned: byUser, userScoped: true, json: ["metadata"] },
  TransferGroup: { delegate: "transferGroup", owned: byUser, userScoped: true },
  // Statements are shared by every purchase of the month: one the batch created stays while entries still use it.
  CardStatement: { delegate: "cardStatement", owned: (id, userId) => ({ id, account: { userId } }), userScoped: false, removable: { entries: { none: {} } } },
  InstallmentPlan: { delegate: "installmentPlan", owned: byUser, userScoped: true },
  RecurringRule: { delegate: "recurringRule", owned: byUser, userScoped: true, json: ["reminders"] },
  InvestmentOperation: {
    delegate: "investmentOperation",
    owned: (id, userId) => ({ id, holding: { account: { userId } } }),
    userScoped: false,
    afterUndo: recalculateTouchedHoldings,
  },
  CategorizationRule: { delegate: "categorizationRule", owned: byUser, userScoped: true },
  Budget: { delegate: "budget", owned: byUser, userScoped: true },
  Import: { delegate: "import", owned: byUser, userScoped: true },
} satisfies Record<string, ModelSpec>;

export type MutationModel = keyof typeof MODELS;
export const MUTATION_MODELS = Object.keys(MODELS) as MutationModel[];

/**
 * Parents first: restored and re-created rows must find the rows they point
 * to (an entry its group, statement and plan; an operation its cash leg and
 * funding transfer). Rows a batch created are removed in the reverse order,
 * children first.
 */
export const RESTORE_ORDER: readonly MutationModel[] = [
  "Import",
  "Budget",
  "CategorizationRule",
  "RecurringRule",
  "InstallmentPlan",
  "TransferGroup",
  "CardStatement",
  "LedgerEntry",
  "InvestmentOperation",
];
export const REMOVE_ORDER: readonly MutationModel[] = [...RESTORE_ORDER].reverse();

function isMutationModel(model: string): model is MutationModel {
  return Object.prototype.hasOwnProperty.call(MODELS, model);
}

function spec(model: MutationModel): ModelSpec {
  return MODELS[model];
}

function delegateOf(db: DbClient, model: MutationModel): RecordDelegate {
  return (db as unknown as Record<DelegateName, RecordDelegate>)[spec(model).delegate];
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export const MUTATION_SOURCES = ["user", "import", "assistant", "mcp", "system"] as const;
export type MutationSource = (typeof MUTATION_SOURCES)[number];

const sourceContext = new AsyncLocalStorage<MutationSource>();

/**
 * Runs `fn` with every batch it records attributed to `source` (the MCP
 * server and the assistant wrap their tool calls), unless a writer names
 * one itself.
 */
export function withMutationSource<T>(source: MutationSource, fn: () => T): T {
  return sourceContext.run(source, fn);
}

/** The source set by the innermost withMutationSource around this call, if any. */
export function currentMutationSource(): MutationSource | undefined {
  return sourceContext.getStore();
}

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

/**
 * Records one undoable batch. Per record: before = null is a row the batch
 * created, after = null a row it deleted outright, both set an update (a
 * soft delete is an update of deletedAt).
 */
export async function recordMutation(
  db: DbClient,
  userId: string,
  op: string,
  summary: string | null,
  records: MutationRecordInput[],
  opts: { source?: MutationSource } = {}
): Promise<string> {
  const source = opts.source ?? currentMutationSource() ?? "user";
  const batch = await db.mutationBatch.create({ data: { userId, op, summary, source } });
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

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const IMMUTABLE = new Set(["id", "userId", "createdAt", "updatedAt"]);

function restoreData(model: MutationModel, snap: Record<string, unknown>): Record<string, unknown> {
  const json = spec(model).json ?? [];
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (IMMUTABLE.has(k)) continue;
    data[k] = v === null && json.includes(k) ? Prisma.DbNull : v;
  }
  return data;
}

/** The row back under its old id and creation date, owned by the batch's user. */
function recreateData(model: MutationModel, id: string, userId: string, snap: Record<string, unknown>): Record<string, unknown> {
  return {
    ...restoreData(model, snap),
    id,
    ...(typeof snap.createdAt === "string" && { createdAt: snap.createdAt }),
    ...(spec(model).userScoped && { userId }),
  };
}

async function recreateRow(tx: DbClient, model: MutationModel, id: string, userId: string, before: Record<string, unknown>) {
  const delegate = delegateOf(tx, model);
  // Batches recorded before re-creation existed also used after = null for
  // an update; a row that is still there just gets its `before` back.
  if (await delegate.count({ where: { id } })) {
    await delegate.updateMany({ where: spec(model).owned(id, userId), data: restoreData(model, before) });
    return;
  }
  await delegate.create({ data: recreateData(model, id, userId, before) });
}

/**
 * Revert batches now record the Import row, so undoing one restores its
 * revertedAt like any other field. Older revert batches did not: their
 * imports are found through the trashed rows' importId.
 */
async function reopenRevertedImports(tx: DbClient, userId: string, records: MutationRecord[]) {
  const importIds = new Set<string>();
  for (const r of records) {
    const importId = (r.before as { importId?: unknown } | null)?.importId;
    if (typeof importId === "string") importIds.add(importId);
  }
  if (importIds.size) await tx.import.updateMany({ where: { id: { in: [...importIds] }, userId }, data: { revertedAt: null } });
}

/**
 * Reverts one batch: rows the batch created are removed (children first),
 * then changed or soft-deleted rows get their `before` snapshot back and
 * rows it deleted outright are re-created with their ids (parents first).
 * Holdings whose operations moved are recalculated. Batches are undone
 * newest-first per row, so undoing an older batch after a newer one that
 * touched the same row is rejected.
 */
export async function undoBatch(userId: string, batchId: string, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const batch = await tx.mutationBatch.findFirst({ where: { id: batchId, userId }, include: { records: true } });
    if (!batch) throw new LedgerError("Mutation batch not found", 404, { code: "undo.not_found" });
    if (batch.undoneAt) throw new LedgerError("Batch already undone", 409, { code: "undo.already_undone" });
    const unsupported = batch.records.find((r) => !isMutationModel(r.model));
    if (unsupported) throw new LedgerError(`Changes to ${unsupported.model} cannot be undone`, 422, { code: "undo.unsupported", params: { model: unsupported.model } });

    const touched = batch.records.map((r) => r.recordId);
    const newer = await tx.mutationRecord.findFirst({
      where: {
        recordId: { in: touched },
        batch: { userId, createdAt: { gt: batch.createdAt }, undoneAt: null },
      },
    });
    if (newer) throw new LedgerError("A newer change touched these rows; undo it first", 409, { code: "undo.newer_change" });

    const newestFirst = [...batch.records].reverse();
    const recordsOf = (model: MutationModel) => newestFirst.filter((r) => r.model === model);

    for (const model of REMOVE_ORDER) {
      for (const rec of recordsOf(model).filter((r) => r.before === null)) {
        await delegateOf(tx, model).deleteMany({ where: { ...spec(model).owned(rec.recordId, userId), ...spec(model).removable } });
      }
    }
    for (const model of RESTORE_ORDER) {
      for (const rec of recordsOf(model).filter((r) => r.before !== null)) {
        const before = rec.before as Record<string, unknown>;
        if (rec.after === null) await recreateRow(tx, model, rec.recordId, userId, before);
        else await delegateOf(tx, model).updateMany({ where: spec(model).owned(rec.recordId, userId), data: restoreData(model, before) });
      }
    }
    for (const model of RESTORE_ORDER) {
      const records = recordsOf(model);
      const hook = spec(model).afterUndo;
      if (hook && records.length) await hook(tx, records);
    }
    if (batch.op === "revert" && !batch.records.some((r) => r.model === "Import")) await reopenRevertedImports(tx, userId, batch.records);

    await tx.mutationBatch.update({ where: { id: batch.id }, data: { undoneAt: new Date() } });
    return { batchId: batch.id, reverted: batch.records.length, op: batch.op };
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface BatchListItem {
  id: string;
  op: string;
  source: string;
  summary: string | null;
  records: number;
  /** Not undone, and no later live batch touched its rows: undoBatch accepts it now. */
  undoable: boolean;
  undoneAt: Date | null;
  createdAt: Date;
}

/** Recent batches, newest first; `undoable` keeps the ones undoBatch accepts now (⌘Z takes the first). */
export async function listBatches(userId: string, db: DbClient, opts: { limit?: number; undoable?: boolean } = {}): Promise<BatchListItem[]> {
  const limit = opts.limit ?? 50;
  return db.$queryRaw<BatchListItem[]>`
    SELECT * FROM (
      SELECT b.id, b.op, b.source, b.summary, b."undoneAt", b."createdAt",
             (SELECT count(*) FROM mutation_records r WHERE r."batchId" = b.id)::int AS records,
             (b."undoneAt" IS NULL AND NOT EXISTS (
               SELECT 1 FROM mutation_records r
               JOIN mutation_records later ON later.model = r.model AND later."recordId" = r."recordId" AND later."batchId" <> r."batchId"
               JOIN mutation_batches lb ON lb.id = later."batchId"
               WHERE r."batchId" = b.id AND lb."userId" = b."userId" AND lb."createdAt" > b."createdAt" AND lb."undoneAt" IS NULL
             )) AS undoable
      FROM mutation_batches b
      WHERE b."userId" = ${userId}
    ) x
    ${opts.undoable ? Prisma.sql`WHERE x.undoable` : Prisma.empty}
    ORDER BY x."createdAt" DESC
    LIMIT ${limit}`;
}
