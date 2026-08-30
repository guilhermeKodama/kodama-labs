import type { DbClient } from "@capital/server/lib/prisma";
import type { ImportPlanPayload } from "../tools/schemas/import-plan-payload";
import { fetchEntityForAgent } from "../../data/queries/fetch-entity-for-agent";
import { parseLocalDate } from "@capital/server/lib/date-utils";

/**
 * Hard invariants (throws - the tool call fails and the model must fix
 * its input) vs. soft issues (returned as warnings the UI surfaces on the
 * plan card, but the plan still saves).
 */
export async function validateImportPlanPayload(
  userId: string,
  payload: ImportPlanPayload,
  db: DbClient
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];

  const entity = await fetchEntityForAgent(userId, payload.entityType, payload.entityId, db);
  if (!entity) {
    throw new Error(`${payload.entityType} entity ${payload.entityId} not found or access denied`);
  }

  if (!payload.fileId) {
    throw new Error("fileId is required when the assistant proposes an import plan");
  }
  const file = await db.conversationFile.findFirst({
    where: { id: payload.fileId, userId },
    select: { id: true },
  });
  if (!file) {
    throw new Error(`File ${payload.fileId} not found or access denied`);
  }

  // externalIds that are about to become NEW transactions must not already
  // exist for this entity - propose_import_plan is meant to run against a
  // fresh reconcile_statement result, so a collision here means the plan
  // is stale (built from data that has since changed).
  const incomingIds = payload.transactions.map((t) => t.externalId);
  if (incomingIds.length > 0) {
    const existing = await db.transaction.findMany({
      where: {
        externalId: { in: incomingIds },
        ...(payload.entityType === "business"
          ? { businessId: payload.entityId }
          : { personalAccountId: payload.entityId }),
      },
      select: { externalId: true },
    });
    if (existing.length > 0) {
      throw new Error(
        `${existing.length} transaction(s) with these externalIds already exist for this entity - the plan is stale, re-run reconcile_statement`
      );
    }
  }

  // link_fuzzy decisions must target a real, still-unlinked transaction.
  for (const decision of payload.duplicateDecisions) {
    if (decision.resolution === "link_fuzzy") {
      if (!decision.existingTransactionId) {
        throw new Error(
          `duplicateDecisions entry for externalId ${decision.externalId} has resolution "link_fuzzy" but no existingTransactionId`
        );
      }
      const target = await db.transaction.findFirst({
        where: {
          id: decision.existingTransactionId,
          OR: [{ business: { userId } }, { personalAccount: { userId } }],
        },
        select: { externalId: true },
      });
      if (!target) {
        throw new Error(
          `link_fuzzy target transaction ${decision.existingTransactionId} not found or access denied`
        );
      }
      if (target.externalId !== null) {
        throw new Error(
          `link_fuzzy target transaction ${decision.existingTransactionId} already has an externalId - it is not an unlinked fuzzy match`
        );
      }
    }
  }

  // Transfer counterparties must belong to the user - a transfer writes
  // directly into fromBusinessId/toBusinessId (or the personal equivalent)
  // in execute-import.ts with no other ownership check downstream, so this
  // is the only gate against pointing a transfer at another tenant's
  // business/personalAccount.
  const counterpartyKeys = new Map<string, { entityType: "business" | "personal"; entityId: string }>();
  for (const tr of payload.transfers) {
    counterpartyKeys.set(`${tr.counterpartyEntityType}:${tr.counterpartyEntityId}`, {
      entityType: tr.counterpartyEntityType,
      entityId: tr.counterpartyEntityId,
    });
  }
  for (const { entityType, entityId } of counterpartyKeys.values()) {
    const counterparty = await fetchEntityForAgent(userId, entityType, entityId, db);
    if (!counterparty) {
      throw new Error(`Transfer counterparty ${entityType} ${entityId} not found or access denied`);
    }
  }

  // Investment accounts referenced must belong to the user.
  const investmentAccountIds = new Set([
    ...payload.investmentTransfers.map((t) => t.investmentAccountId),
    ...payload.investmentTransactions.map((t) => t.accountId),
  ]);
  if (investmentAccountIds.size > 0) {
    const owned = await db.investmentAccount.findMany({
      where: { id: { in: [...investmentAccountIds] }, userId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((a) => a.id));
    for (const id of investmentAccountIds) {
      if (!ownedIds.has(id)) {
        throw new Error(`Investment account ${id} not found or access denied`);
      }
    }
  }

  // Investment holdings referenced (not being newly created) must belong
  // to an account the user owns.
  const holdingIds = payload.investmentTransactions
    .map((t) => t.holdingId)
    .filter((id): id is string => !!id);
  if (holdingIds.length > 0) {
    const owned = await db.investmentHolding.findMany({
      where: { id: { in: holdingIds }, account: { userId } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((h) => h.id));
    for (const id of holdingIds) {
      if (!ownedIds.has(id)) {
        throw new Error(`Investment holding ${id} not found or access denied`);
      }
    }
  }

  for (const it of payload.investmentTransactions) {
    if (!it.holdingId && !it.newHolding) {
      throw new Error(
        `investmentTransactions entry for externalId ${it.externalId} has neither holdingId nor newHolding`
      );
    }
  }

  // Investment externalId collisions within holdings that already exist.
  const withHoldingId = payload.investmentTransactions.filter((t) => t.holdingId);
  if (withHoldingId.length > 0) {
    const existing = await db.investmentTransaction.findMany({
      where: {
        OR: withHoldingId.map((t) => ({ holdingId: t.holdingId!, externalId: t.externalId })),
      },
      select: { holdingId: true, externalId: true },
    });
    if (existing.length > 0) {
      throw new Error(
        `${existing.length} investment transaction(s) with these externalIds already exist for their holding - the plan is stale`
      );
    }
  }

  // Reconciliation targets must belong to the user.
  if (payload.reconciliations.length > 0) {
    const ids = payload.reconciliations.map((r) => r.existingTransactionId);
    const owned = await db.transaction.findMany({
      where: { id: { in: ids }, OR: [{ business: { userId } }, { personalAccount: { userId } }] },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((t) => t.id));
    for (const id of ids) {
      if (!ownedIds.has(id)) {
        throw new Error(`Reconciliation target transaction ${id} not found or access denied`);
      }
    }
  }

  // Transfer reconciliation targets must belong to the user.
  if (payload.transferReconciliations.length > 0) {
    const ids = payload.transferReconciliations.map((r) => r.existingTransferId);
    const owned = await db.transfer.findMany({
      where: {
        id: { in: ids },
        OR: [
          { fromBusiness: { userId } },
          { fromPersonalAccount: { userId } },
          { toBusiness: { userId } },
          { toPersonalAccount: { userId } },
        ],
      },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((t) => t.id));
    for (const id of ids) {
      if (!ownedIds.has(id)) {
        throw new Error(`Transfer reconciliation target ${id} not found or access denied`);
      }
    }
  }

  // Bills: exactly one of creditCardId/newCreditCard, the referenced
  // file/card must belong to the user, and warn (not throw) when a bill
  // already exists for the same card+period - processBillCsv will REPLACE
  // it at commit time, and the user needs to see that before confirming.
  for (const bill of payload.bills) {
    if (!bill.creditCardId === !bill.newCreditCard) {
      throw new Error(
        `bills entry (fileId ${bill.fileId}) must set exactly one of creditCardId or newCreditCard`
      );
    }
    const billFile = await db.conversationFile.findFirst({
      where: { id: bill.fileId, userId },
      select: { id: true },
    });
    if (!billFile) {
      throw new Error(`File ${bill.fileId} not found or access denied`);
    }
    if (bill.creditCardId) {
      const card = await db.creditCard.findFirst({
        where: {
          id: bill.creditCardId,
          OR: [{ business: { userId } }, { personalAccount: { userId } }],
        },
        select: { id: true },
      });
      if (!card) {
        throw new Error(`Credit card ${bill.creditCardId} not found or access denied`);
      }
      const existingBill = await db.creditCardBill.findFirst({
        where: { creditCardId: bill.creditCardId, closingDate: parseLocalDate(bill.closingDate) },
        select: { id: true },
      });
      if (existingBill) {
        warnings.push(
          `A bill already exists for this card on ${bill.closingDate} - confirming will replace it (manual categorizations are preserved).`
        );
      }
    }
  }

  if (
    payload.transactions.length === 0 &&
    payload.transfers.length === 0 &&
    payload.investmentTransfers.length === 0 &&
    payload.investmentTransactions.length === 0 &&
    payload.reconciliations.length === 0 &&
    payload.transferReconciliations.length === 0 &&
    payload.bills.length === 0
  ) {
    warnings.push("This plan has nothing to write - every row was a plain skip.");
  }

  return { warnings };
}
