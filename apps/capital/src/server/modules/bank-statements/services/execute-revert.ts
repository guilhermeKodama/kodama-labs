import type { PrismaClient } from "@/generated/prisma";
import { recalculateHolding } from "@capital/server/modules/investments/services/portfolio";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
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
  batchId: string | null;
}

/**
 * Undo an import. Every ledger row the import created carries its id, so
 * they all go to the trash in one undoable batch (restorable from the
 * trash). Investment operations it created are removed and their holdings
 * recalculated; holdings themselves are kept (the user may have added data
 * since). Cards it created are archived when nothing else uses them.
 * The Import row stays as history, stamped with revertedAt.
 */
export async function executeRevert(userId: string, payload: RevertPlanPayload, db: PrismaClient): Promise<ExecuteRevertResult> {
  return inTransaction(db, async (tx) => {
    const imp = await tx.import.findFirst({ where: { id: payload.statementImportId, userId } });
    if (!imp) throw new LedgerError("Statement import not found or access denied", 404);
    if (imp.revertedAt) throw new LedgerError("This import was already reverted", 409);
    const ids = (...models: string[]) => payload.createdRecords.filter((r) => models.includes(r.model)).map((r) => r.id);

    const opIds = ids("InvestmentOperation", "InvestmentTransaction");
    const ops = await tx.investmentOperation.findMany({
      where: { holding: { account: { userId } }, OR: [{ id: { in: opIds } }, { cashEntry: { importId: imp.id } }] },
    });
    for (const op of ops) {
      await tx.investmentOperation.delete({ where: { id: op.id } });
      if (op.cashEntryId) await tx.ledgerEntry.deleteMany({ where: { id: op.cashEntryId } });
    }
    for (const holdingId of new Set(ops.map((o) => o.holdingId))) await recalculateHolding(holdingId, tx);

    const now = new Date();
    const records: MutationRecordInput[] = [];
    const entries = await tx.ledgerEntry.findMany({ where: { userId, importId: imp.id, deletedAt: null } });
    const groupIds = [...new Set(entries.map((e) => e.transferGroupId).filter((g): g is string => !!g))];
    const legs = groupIds.length ? await tx.ledgerEntry.findMany({ where: { transferGroupId: { in: groupIds }, deletedAt: null, importId: { not: imp.id } } }) : [];
    const groups = groupIds.length ? await tx.transferGroup.findMany({ where: { id: { in: groupIds } } }) : [];
    const all = [...entries, ...legs];
    await tx.ledgerEntry.updateMany({ where: { id: { in: all.map((e) => e.id) } }, data: { deletedAt: now } });
    await tx.transferGroup.updateMany({ where: { id: { in: groupIds } }, data: { deletedAt: now } });
    for (const g of groups) records.push({ model: "TransferGroup", recordId: g.id, before: snapshot(g), after: snapshot({ ...g, deletedAt: now }) });
    for (const e of all) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, deletedAt: now }) });
    const batchId = records.length ? await recordMutation(tx, userId, "revert", `Import ${imp.fileName ?? imp.id}`, records) : null;

    // Archived rather than deleted: deleting would cascade into the trashed
    // entries and make the batch above impossible to undo.
    let creditCardsDeleted = 0;
    for (const accountId of ids("Account", "CreditCard")) {
      const live = await tx.ledgerEntry.count({ where: { accountId, deletedAt: null } });
      if (live) continue;
      const { count } = await tx.account.updateMany({ where: { id: accountId, userId, type: "credit_card", archivedAt: null }, data: { archivedAt: now } });
      creditCardsDeleted += count;
    }

    await tx.import.update({ where: { id: imp.id }, data: { revertedAt: now } });
    return {
      transactionsDeleted: entries.filter((e) => !e.transferGroupId && !e.cardStatementId).length,
      transfersDeleted: groupIds.length,
      creditCardsDeleted,
      billsDeleted: new Set(entries.filter((e) => e.cardStatementId).map((e) => e.cardStatementId)).size,
      investmentTransactionsDeleted: ops.length,
      batchId,
    };
  });
}
