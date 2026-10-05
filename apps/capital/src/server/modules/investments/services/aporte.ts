import type { DbClient } from "@capital/server/lib/prisma";
import type { AllocationClass, AssetClass } from "@/generated/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round } from "@capital/server/modules/ledger/lib/money";
import { getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { inTransaction, recordMutation, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { convertAmount, fundBroker } from "./funding";
import { createHolding, getOwnedHolding, recordOperation } from "./portfolio";

export interface NewHoldingInput {
  ticker?: string | null;
  name: string;
  assetClass: AssetClass;
  currency?: string;
  allocationClass?: AllocationClass | null;
}

export interface AporteInput {
  /** Checking or cash account the money leaves (any entity). */
  fromAccountId: string;
  /** Brokerage account that receives it. */
  brokerAccountId: string;
  /** Amount debited, in the source account's currency. */
  amount: number;
  /** Amount credited to the broker, in its currency, when it differs from the source's (default: converted at today's rate). */
  toAmount?: number | null;
  date: string;
  description?: string | null;
  /** Also buy an asset with the money, at this broker. */
  buy?: {
    holdingId?: string | null;
    newHolding?: NewHoldingInput | null;
    quantity: number;
    price: number;
    fees?: number;
  } | null;
}

/**
 * Moves money into a broker, optionally buying an asset with it, in one
 * undo batch (POST /v2/investments/aporte). Within one entity it is a single
 * investment_deposit; across entities a capital injection (PF → PJ) or
 * profit distribution (PJ → PF) to the broker entity's main checking comes
 * first (see fundBroker). The buy's operation is linked to the deposit
 * (fundingGroupId), so deleting it with its funding trashes the deposit.
 */
export async function recordAporte(userId: string, input: AporteInput, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    const [from, broker] = await Promise.all([getOwnedAccount(userId, input.fromAccountId, tx), getOwnedAccount(userId, input.brokerAccountId, tx)]);
    if (broker.type !== "brokerage") throw new LedgerError("An aporte goes to a brokerage account", 422, { code: "aporte.broker_required" });
    if (from.type !== "checking" && from.type !== "cash") {
      throw new LedgerError("The money of an aporte comes from a checking or cash account", 422, { code: "aporte.source_invalid" });
    }
    const fx = await loadFx(userId, tx);
    const { depositGroupId, transferGroupIds } = await fundBroker(
      tx,
      userId,
      {
        fromAccountId: from.id,
        broker,
        brokerAmount: input.toAmount ?? convertAmount(input.amount, from.currency, broker.currency, fx),
        fundAmount: input.amount,
        date: input.date,
        description: input.description,
      },
      fx,
      records
    );

    let operationId: string | null = null;
    let holdingId: string | null = null;
    if (input.buy) {
      if (input.buy.holdingId) {
        const holding = await getOwnedHolding(userId, input.buy.holdingId, tx);
        if (holding.accountId !== broker.id) throw new LedgerError("The asset bought is not on the aporte's broker", 422, { code: "aporte.holding_mismatch" });
        holdingId = holding.id;
      } else if (input.buy.newHolding) {
        holdingId = (await createHolding(userId, { accountId: broker.id, ...input.buy.newHolding }, tx, { collect: records })).id;
      } else {
        throw new LedgerError("Holding not found or access denied", 404, { code: "holding.not_found" });
      }
      const { operation } = await recordOperation(
        userId,
        {
          holdingId,
          type: "buy",
          quantity: input.buy.quantity,
          pricePerUnit: input.buy.price,
          totalAmount: round(input.buy.quantity * input.buy.price, 4),
          fees: input.buy.fees ?? 0,
          date: input.date,
        },
        tx,
        { collect: records, fundingGroupId: depositGroupId }
      );
      operationId = operation.id;
    }

    const group = await tx.transferGroup.findUniqueOrThrow({ where: { id: depositGroupId }, select: { description: true } });
    const batchId = await recordMutation(tx, userId, "create", group.description, records);
    // operationId and holdingId only when the aporte bought something (contract C1).
    return { batchId, transferGroupIds, ...(operationId && { operationId, holdingId }) };
  });
}
