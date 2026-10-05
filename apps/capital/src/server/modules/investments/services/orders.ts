import type { DbClient } from "@capital/server/lib/prisma";
import { round } from "@capital/server/modules/ledger/lib/money";
import { inTransaction, recordMutation, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import type { NewHoldingInput } from "./aporte";
import { createHolding, getOwnedHolding, recordOperation } from "./portfolio";

export interface OrderInput {
  /** An existing holding, or `newHolding` on `newHolding.accountId`. */
  holdingId?: string | null;
  newHolding?: (NewHoldingInput & { accountId: string }) | null;
  quantity?: number | null;
  price?: number | null;
  /** Amount bought, for assets tracked by amount (fixed income); default quantity x price. */
  amount?: number | null;
  fees?: number;
}

export interface OrdersInput {
  date: string;
  /** Pay every order from this checking account (one investment_deposit per order); else from broker cash. */
  fundFromAccountId?: string | null;
  orders: OrderInput[];
}

/**
 * Records the buys of "Gerar ordens" atomically, in one undo batch
 * (POST /v2/investments/orders): undoing it removes every operation, its
 * cash leg and funding transfer, and the holdings it created.
 */
export async function recordOrders(userId: string, input: OrdersInput, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    const operations: { operationId: string; holdingId: string; cashEntryId: string | null; fundingGroupId: string | null }[] = [];
    const labels: string[] = [];
    for (const order of input.orders) {
      const holding = order.holdingId
        ? await getOwnedHolding(userId, order.holdingId, tx)
        : await createHolding(userId, { ...order.newHolding!, accountId: order.newHolding!.accountId }, tx, { collect: records });
      const totalAmount = order.amount ?? round((order.quantity ?? 0) * (order.price ?? 0), 4);
      const r = await recordOperation(
        userId,
        {
          holdingId: holding.id,
          type: "buy",
          quantity: order.quantity ?? null,
          pricePerUnit: order.price ?? null,
          totalAmount,
          fees: order.fees ?? 0,
          date: input.date,
          fundFromAccountId: input.fundFromAccountId ?? null,
        },
        tx,
        { collect: records }
      );
      operations.push({ operationId: r.operation.id, holdingId: holding.id, cashEntryId: r.cashEntryId, fundingGroupId: r.fundingGroupId });
      labels.push(holding.ticker ?? holding.name);
    }
    const batchId = await recordMutation(tx, userId, "create", `Compra ${labels.join(", ")}`, records);
    return { batchId, operations };
  });
}
