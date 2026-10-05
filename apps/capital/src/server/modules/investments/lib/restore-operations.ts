import type { DbClient } from "@capital/server/lib/prisma";
import type { LedgerEntry } from "@/generated/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { lastRecordOf, recreateRecord, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { recalculateHolding } from "./holding-position";

/**
 * Brings back the operations of investment cash legs restored from the
 * trash. deleteOperation removes the operation and trashes its leg; a leg
 * restored on its own would move broker cash with no operation behind it,
 * so the operation is re-created from the snapshot its delete recorded and
 * the holding recalculated. Re-created operations are appended to `records`
 * (undoing the restore removes them again). A leg trashed by an edit that
 * made its operation stop moving cash is refused: the operation is still
 * there and would not count it. A leg whose operation still owns it, or
 * that no recorded change explains, comes back alone.
 */
export async function restoreLegOperations(tx: DbClient, userId: string, legs: LedgerEntry[], records: MutationRecordInput[]) {
  const cashLegs = legs.filter((l) => l.kind === "investment");
  if (!cashLegs.length) return 0;
  const owned = await tx.investmentOperation.findMany({ where: { cashEntryId: { in: cashLegs.map((l) => l.id) } }, select: { cashEntryId: true } });
  const linked = new Set(owned.map((o) => o.cashEntryId));

  const holdings = new Set<string>();
  let restored = 0;
  for (const leg of cashLegs.filter((l) => !linked.has(l.id))) {
    const last = await lastRecordOf(tx, userId, "InvestmentOperation", "cashEntryId", leg.id);
    if (!last) continue;
    const exists = !!(await tx.investmentOperation.count({ where: { id: last.recordId } }));
    if (last.after !== null) {
      if (exists && last.after.cashEntryId !== leg.id) {
        throw new LedgerError(`"${leg.description}" is the cash of an investment operation that was edited since to move no cash; edit the operation instead`, 409, {
          code: "trash.operation_edited",
          params: { description: leg.description },
        });
      }
      continue;
    }
    const snap = last.before;
    const holdingId = snap.holdingId as string;
    if (!(await tx.investmentHolding.count({ where: { id: holdingId, account: { userId } } }))) continue;
    if (exists) continue;
    // The same broker note imported again after the revert: its operation already counts this cash.
    if (snap.externalId && (await tx.investmentOperation.count({ where: { holdingId, externalId: snap.externalId as string } }))) {
      throw new LedgerError(`"${leg.description}" is the cash of an investment operation that was recorded again; restoring it would count it twice`, 409, {
        code: "trash.operation_recorded_again",
        params: { description: leg.description },
      });
    }
    // The funding transfer may have been purged from the trash, or claimed since.
    const fundingGroupId = snap.fundingGroupId as string | null;
    const fundingFree =
      !!fundingGroupId &&
      !!(await tx.transferGroup.count({ where: { id: fundingGroupId, userId } })) &&
      !(await tx.investmentOperation.count({ where: { fundingGroupId } }));

    await recreateRecord(tx, userId, "InvestmentOperation", last.recordId, { ...snap, fundingGroupId: fundingFree ? fundingGroupId : null });
    const op = await tx.investmentOperation.findUniqueOrThrow({ where: { id: last.recordId } });
    records.push({ model: "InvestmentOperation", recordId: op.id, before: null, after: snapshot(op) });
    holdings.add(holdingId);
    restored++;
  }
  for (const id of holdings) await recalculateHolding(id, tx);
  return restored;
}
