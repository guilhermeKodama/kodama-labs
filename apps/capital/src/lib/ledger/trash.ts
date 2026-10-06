/**
 * The trash sheet lists what was deleted the way Transações shows it: a
 * transfer is one row (by its outflow leg, positive), anything else its own
 * row. GET /v2/trash answers in legs.
 */

export interface TrashLeg {
  id: string;
  date: string;
  description: string;
  amountBase: number;
  accountId: string;
  entityId: string;
  transferGroupId: string | null;
  deletedAt: string | null;
}

export interface TrashRow {
  /** The id restore takes (restoring one leg brings the whole transfer back). */
  id: string;
  date: string;
  description: string;
  /** Base currency; a transfer as its positive amount. */
  amount: number;
  transfer: boolean;
  accountId: string;
  /** The destination account of a transfer. */
  toAccountId: string | null;
  entityId: string;
  deletedAt: string | null;
}

export function trashRows(legs: readonly TrashLeg[]): TrashRow[] {
  const rows: TrashRow[] = [];
  const byGroup = new Map<string, TrashRow>();
  for (const leg of legs) {
    if (!leg.transferGroupId) {
      rows.push({ id: leg.id, date: leg.date, description: leg.description, amount: leg.amountBase, transfer: false, accountId: leg.accountId, toAccountId: null, entityId: leg.entityId, deletedAt: leg.deletedAt });
      continue;
    }
    const seen = byGroup.get(leg.transferGroupId);
    if (!seen) {
      const row: TrashRow = {
        id: leg.id,
        date: leg.date,
        description: leg.description,
        amount: Math.abs(leg.amountBase),
        transfer: true,
        accountId: leg.amountBase < 0 ? leg.accountId : "",
        toAccountId: leg.amountBase < 0 ? null : leg.accountId,
        entityId: leg.entityId,
        deletedAt: leg.deletedAt,
      };
      byGroup.set(leg.transferGroupId, row);
      rows.push(row);
      continue;
    }
    if (leg.amountBase < 0) {
      seen.accountId = leg.accountId;
      seen.entityId = leg.entityId;
    } else seen.toAccountId = leg.accountId;
    seen.amount = Math.max(seen.amount, Math.abs(leg.amountBase));
  }
  return rows;
}
