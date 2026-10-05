import type { PrismaClient } from "@/generated/prisma";
import { deleteOperation } from "@capital/server/modules/investments/services/portfolio";
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
 * trash). Investment operations it created are removed (their cash legs
 * trashed) and their holdings recalculated; holdings themselves are kept
 * (the user may have added data since). Cards it created are archived when
 * nothing else uses them. The Import row stays as history, stamped with
 * revertedAt; undoing the batch restores all of it except the card archive.
 */
export async function executeRevert(userId: string, payload: RevertPlanPayload, db: PrismaClient): Promise<ExecuteRevertResult> {
  return inTransaction(db, async (tx) => {
    const imp = await tx.import.findFirst({ where: { id: payload.statementImportId, userId } });
    if (!imp) throw new LedgerError("Statement import not found or access denied", 404, { code: "import.not_found" });
    if (imp.revertedAt) throw new LedgerError("This import was already reverted", 409, { code: "import.already_reverted" });
    const ids = (...models: string[]) => payload.createdRecords.filter((r) => models.includes(r.model)).map((r) => r.id);

    const now = new Date();
    const records: MutationRecordInput[] = [];
    const opIds = ids("InvestmentOperation", "InvestmentTransaction");
    const ops = await tx.investmentOperation.findMany({
      where: { holding: { account: { userId } }, OR: [{ id: { in: opIds } }, { cashEntry: { importId: imp.id } }] },
    });
    // Each operation is snapshotted and its cash leg trashed, so undoing the batch brings both back.
    for (const op of ops) await deleteOperation(userId, op.id, tx, { collect: records });

    const entries = await tx.ledgerEntry.findMany({ where: { userId, importId: imp.id, deletedAt: null } });
    const groupIds = [...new Set(entries.map((e) => e.transferGroupId).filter((g): g is string => !!g))];
    const legs = groupIds.length ? await tx.ledgerEntry.findMany({ where: { transferGroupId: { in: groupIds }, deletedAt: null, importId: { not: imp.id } } }) : [];
    const groups = groupIds.length ? await tx.transferGroup.findMany({ where: { id: { in: groupIds } } }) : [];
    const all = [...entries, ...legs];
    await tx.ledgerEntry.updateMany({ where: { id: { in: all.map((e) => e.id) } }, data: { deletedAt: now } });
    await tx.transferGroup.updateMany({ where: { id: { in: groupIds } }, data: { deletedAt: now } });
    for (const g of groups) records.push({ model: "TransferGroup", recordId: g.id, before: snapshot(g), after: snapshot({ ...g, deletedAt: now }) });
    for (const e of all) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, deletedAt: now }) });

    // Archived rather than deleted: deleting would cascade into the trashed
    // entries and make the batch below impossible to undo.
    let creditCardsDeleted = 0;
    for (const accountId of ids("Account", "CreditCard")) {
      const live = await tx.ledgerEntry.count({ where: { accountId, deletedAt: null } });
      if (live) continue;
      const { count } = await tx.account.updateMany({ where: { id: accountId, userId, type: "credit_card", archivedAt: null }, data: { archivedAt: now } });
      creditCardsDeleted += count;
    }

    // The Import row is part of the batch: undoing it clears revertedAt again.
    const reverted = await tx.import.update({ where: { id: imp.id }, data: { revertedAt: now } });
    records.push({ model: "Import", recordId: imp.id, before: snapshot(imp), after: snapshot(reverted) });
    const batchId = await recordMutation(tx, userId, "revert", `Import ${imp.fileName ?? imp.id}`, records);
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
