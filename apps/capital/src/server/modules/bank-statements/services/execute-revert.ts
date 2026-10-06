import { Prisma, type MutationRecord, type PrismaClient } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { deleteOperation } from "@capital/server/modules/investments/services/portfolio";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { inTransaction, recordMutation, recreateRecord, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { deleteView } from "@capital/server/modules/ledger/services/views";
import type { CreatedRecordRef } from "./execute-import";

export interface RevertPlanPayload {
  statementImportId: string;
  createdRecords: CreatedRecordRef[];
}

export interface ExecuteRevertResult {
  transactionsDeleted: number;
  transfersDeleted: number;
  creditCardsDeleted: number;
  billsDeleted: number;
  investmentTransactionsDeleted: number;
  /** Rows the import had changed without creating them (reconciled, linked, settled) put back as they were. */
  changesRestored: number;
  /** Of those, rows edited again since the import: left as they are now. */
  changesKept: number;
  batchId: string | null;
}

/** Models whose changes by an import a revert puts back. Rules it learned stay: they record the user's own choices. */
type RestorableModel = "LedgerEntry" | "TransferGroup" | "CardStatement" | "Account" | "InstallmentPlan";

interface RowDelegate {
  findUnique(args: { where: { id: string } }): Promise<object | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<object>;
}

const DELEGATES: Record<RestorableModel, (tx: DbClient) => RowDelegate> = {
  LedgerEntry: (tx) => tx.ledgerEntry as unknown as RowDelegate,
  TransferGroup: (tx) => tx.transferGroup as unknown as RowDelegate,
  CardStatement: (tx) => tx.cardStatement as unknown as RowDelegate,
  Account: (tx) => tx.account as unknown as RowDelegate,
  InstallmentPlan: (tx) => tx.installmentPlan as unknown as RowDelegate,
};
const isRestorable = (model: string): model is RestorableModel => model in DELEGATES;

/** Nullable Json columns: a null in a snapshot is written back as DbNull. */
const JSON_COLUMNS = new Set(["metadata"]);
const IMMUTABLE = new Set(["id", "userId", "createdAt", "updatedAt"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Records of the undo batch the import was written in (the one that created its Import row); [] for older imports. */
async function importBatchRecords(userId: string, importId: string, tx: DbClient): Promise<MutationRecord[]> {
  const marker = await tx.mutationRecord.findFirst({
    where: { model: "Import", recordId: importId, batch: { userId, op: "import" } },
    orderBy: { batch: { createdAt: "asc" } },
    select: { batchId: true },
  });
  return marker ? tx.mutationRecord.findMany({ where: { batchId: marker.batchId } }) : [];
}

/**
 * The "Importação · <arquivo>" views of an import that still exist: the
 * ones its batch created, or, for imports from before the view was
 * recorded there, the unseeded non-favorite views whose only filter is
 * this import (what createImportView writes).
 */
async function importViewIds(userId: string, importId: string, batch: MutationRecord[], tx: DbClient): Promise<string[]> {
  const recorded = batch.filter((r) => r.model === "SavedView" && r.before === null).map((r) => r.recordId);
  const where = recorded.length
    ? { userId, id: { in: recorded } }
    : {
        userId,
        isBuiltin: false,
        isFavorite: false,
        seedKey: null,
        config: { path: ["filters"], equals: [{ field: "importId", op: "in", values: [importId] }] },
      };
  const views = await tx.savedView.findMany({ where, select: { id: true } });
  return views.map((v) => v.id);
}

/**
 * Undo an import. Every ledger row it created goes to the trash in one
 * undoable batch: the rows carrying its id, plus any its batch created
 * without it (the card leg of a bill payment it linked). Rows it changed
 * without creating them (reconciled entries, fuzzy duplicates it linked, a
 * bank expense it turned into a bill payment, a statement it settled or
 * re-dated, the account's opening balance) get their earlier values back,
 * unless they were edited again since. Installments it replaced come back
 * as projected. Investment operations it created are removed (their cash
 * legs trashed) and their holdings recalculated; holdings themselves are
 * kept. Cards it created are archived when nothing else uses them, and
 * installment plans it started are closed once empty. Rules it learned
 * stay. The import's "Importação · <arquivo>" view is deleted (it would
 * only list trashed rows). The Import row stays as history, stamped with
 * revertedAt; undoing the batch restores all of it, the view under its id.
 */
export async function executeRevert(userId: string, payload: RevertPlanPayload, db: PrismaClient): Promise<ExecuteRevertResult> {
  return inTransaction(db, async (tx) => {
    const imp = await tx.import.findFirst({ where: { id: payload.statementImportId, userId } });
    if (!imp) throw new LedgerError("Statement import not found or access denied", 404, { code: "import.not_found" });
    if (imp.revertedAt) throw new LedgerError("This import was already reverted", 409, { code: "import.already_reverted" });

    const batch = await importBatchRecords(userId, imp.id, tx);
    const created = new Set(batch.filter((r) => r.before === null).map((r) => `${r.model}:${r.recordId}`));
    const createdIds = (model: string) => batch.filter((r) => r.model === model && r.before === null).map((r) => r.recordId);
    const ids = (...models: string[]) => [...new Set([...payload.createdRecords.filter((r) => models.includes(r.model)).map((r) => r.id), ...models.flatMap(createdIds)])];

    const now = new Date();
    const records: MutationRecordInput[] = [];
    const opIds = ids("InvestmentOperation", "InvestmentTransaction");
    const ops = await tx.investmentOperation.findMany({
      where: { holding: { account: { userId } }, OR: [{ id: { in: opIds } }, { cashEntry: { importId: imp.id } }] },
    });
    // Each operation is snapshotted and its cash leg trashed, so undoing the batch brings both back.
    for (const op of ops) await deleteOperation(userId, op.id, tx, { collect: records });

    // Changes to rows the import did not create, newest first, while untouched since. Done before
    // the trash sweep, so an expense it had turned into a payment leg is an expense again by then.
    let changesRestored = 0;
    let changesKept = 0;
    const changes = batch.filter((r) => r.before !== null && r.after !== null && isRestorable(r.model) && !created.has(`${r.model}:${r.recordId}`));
    for (const rec of changes.reverse()) {
      const delegate = DELEGATES[rec.model as RestorableModel](tx);
      const row = await delegate.findUnique({ where: { id: rec.recordId } });
      if (!row) continue;
      const current = snapshot(row) as Record<string, unknown>;
      const before = rec.before as Record<string, unknown>;
      const after = rec.after as Record<string, unknown>;
      const changed = Object.keys(before).filter((k) => !IMMUTABLE.has(k) && !same(before[k], after[k]));
      if (!changed.length) continue;
      if (changed.some((k) => !same(current[k], after[k]))) {
        changesKept++;
        continue;
      }
      const data = Object.fromEntries(changed.map((k) => [k, before[k] === null && JSON_COLUMNS.has(k) ? Prisma.DbNull : before[k]]));
      const restored = await delegate.update({ where: { id: rec.recordId }, data });
      records.push({ model: rec.model as RestorableModel, recordId: rec.recordId, before: current, after: snapshot(restored) });
      changesRestored++;
    }

    const createdEntryIds = createdIds("LedgerEntry");
    const entries = await tx.ledgerEntry.findMany({ where: { userId, deletedAt: null, OR: [{ importId: imp.id }, { id: { in: createdEntryIds } }] } });
    const groupIds = [...new Set([...entries.map((e) => e.transferGroupId).filter((g): g is string => !!g), ...createdIds("TransferGroup")])];
    const legs = groupIds.length ? await tx.ledgerEntry.findMany({ where: { transferGroupId: { in: groupIds }, deletedAt: null, id: { notIn: entries.map((e) => e.id) } } }) : [];
    const groups = groupIds.length ? await tx.transferGroup.findMany({ where: { id: { in: groupIds }, userId, deletedAt: null } }) : [];
    const all = [...entries, ...legs];
    await tx.ledgerEntry.updateMany({ where: { id: { in: all.map((e) => e.id) } }, data: { deletedAt: now } });
    await tx.transferGroup.updateMany({ where: { id: { in: groups.map((g) => g.id) } }, data: { deletedAt: now } });
    for (const g of groups) records.push({ model: "TransferGroup", recordId: g.id, before: snapshot(g), after: snapshot({ ...g, deletedAt: now }) });
    for (const e of all) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, deletedAt: now }) });
    // A statement settled by a payment that just went to the trash is open again.
    const settled = groups.length ? await tx.cardStatement.findMany({ where: { paymentGroupId: { in: groups.map((g) => g.id) } } }) : [];
    for (const statement of settled) {
      const reopened = await tx.cardStatement.update({ where: { id: statement.id }, data: { paymentGroupId: null } });
      records.push({ model: "CardStatement", recordId: statement.id, before: snapshot(statement), after: snapshot(reopened) });
    }

    // Rows the import deleted outright (the projected installments its real ones replaced) come back.
    for (const rec of batch) {
      if (rec.model !== "LedgerEntry" || rec.before === null || rec.after !== null) continue;
      if (await tx.ledgerEntry.count({ where: { id: rec.recordId } })) continue;
      await recreateRecord(tx, userId, "LedgerEntry", rec.recordId, rec.before as Record<string, unknown>);
      const back = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: rec.recordId } });
      records.push({ model: "LedgerEntry", recordId: back.id, before: null, after: snapshot(back) });
    }

    // Archived rather than deleted: deleting would cascade into the trashed
    // entries and make the batch below impossible to undo. The archive is
    // part of the batch, so undoing it brings the card back too.
    let creditCardsDeleted = 0;
    for (const accountId of ids("Account", "CreditCard")) {
      const card = await tx.account.findFirst({ where: { id: accountId, userId, type: "credit_card", archivedAt: null } });
      if (!card || (await tx.ledgerEntry.count({ where: { accountId, deletedAt: null } }))) continue;
      const archived = await tx.account.update({ where: { id: card.id }, data: { archivedAt: now } });
      records.push({ model: "Account", recordId: card.id, before: snapshot(card), after: snapshot(archived) });
      creditCardsDeleted++;
    }

    // Installment plans the import started stop expecting parcels once none is left.
    for (const planId of ids("InstallmentPlan")) {
      const plan = await tx.installmentPlan.findFirst({ where: { id: planId, userId, isActive: true } });
      if (!plan || (await tx.ledgerEntry.count({ where: { installmentPlanId: planId, deletedAt: null } }))) continue;
      const closed = await tx.installmentPlan.update({ where: { id: plan.id }, data: { isActive: false } });
      records.push({ model: "InstallmentPlan", recordId: plan.id, before: snapshot(plan), after: snapshot(closed) });
    }

    // The import's own view goes with it; undoing the revert re-creates it under the same id.
    for (const viewId of await importViewIds(userId, imp.id, batch, tx)) await deleteView(userId, viewId, tx, { collect: records });

    // The Import row is part of the batch: undoing it clears revertedAt again.
    const reverted = await tx.import.update({ where: { id: imp.id }, data: { revertedAt: now } });
    records.push({ model: "Import", recordId: imp.id, before: snapshot(imp), after: snapshot(reverted) });
    const batchId = await recordMutation(tx, userId, "revert", `Import ${imp.fileName ?? imp.id}`, records);
    return {
      transactionsDeleted: entries.filter((e) => !e.transferGroupId && !e.cardStatementId).length,
      transfersDeleted: groups.length,
      creditCardsDeleted,
      billsDeleted: new Set(entries.filter((e) => e.cardStatementId).map((e) => e.cardStatementId)).size,
      investmentTransactionsDeleted: ops.length,
      changesRestored,
      changesKept,
      batchId,
    };
  });
}
