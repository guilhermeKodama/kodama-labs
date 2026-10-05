import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@/generated/prisma";

/** What replayPosition reads from an operation. */
export interface PositionOperation {
  id: string;
  type: InvestmentTransactionType;
  quantity: number | null;
  pricePerUnit: number | null;
  totalAmount: number;
  fees: number;
}

export interface Position {
  quantity: number;
  /** Cost basis of what is still held, fees included. */
  cost: number;
  averageCost: number;
  /** Sale results so far: proceeds net of fees minus the cost of what was sold. */
  realizedGain: number;
  /** Operations that sold more than the position held at that point (clamped to the position). */
  oversold: string[];
  /** A sale or redemption emptied the position and nothing was bought back since. */
  closed: boolean;
}

const EPS = 1e-9;

/**
 * Weighted-average position from operations ordered oldest first.
 *
 * - A buy adds its quantity and its cost: the gross amount (totalAmount, or
 *   quantity x price when the amount is missing) plus fees.
 * - A sell with a quantity keeps the average cost and takes the sold share
 *   of the cost basis out; selling more than the position is clamped and
 *   reported in `oversold`. Without a quantity (amount-based assets such as
 *   fixed income) it takes the amount out of the cost basis.
 * - A split changes the quantity only.
 * - An adjustment carrying quantity and price resets the position (to zero
 *   closes it); one with an amount only moves the cost basis.
 */
export function replayPosition(ops: readonly PositionOperation[]): Position {
  let qty = 0;
  let cost = 0;
  let realized = 0;
  let closed = false;
  const oversold: string[] = [];
  for (const op of ops) {
    const q = op.quantity ?? 0;
    const p = op.pricePerUnit ?? 0;
    const fees = op.fees ?? 0;
    switch (op.type) {
      case "buy":
      case "deposit": {
        const gross = op.totalAmount > 0 ? op.totalAmount : q * p;
        qty += q;
        cost += gross + fees;
        closed = false;
        break;
      }
      case "sell":
      case "withdrawal": {
        if (q > 0) {
          let sold = q;
          if (sold > qty + EPS) {
            oversold.push(op.id);
            sold = Math.max(0, qty);
          }
          const soldCost = qty > EPS ? cost * (sold / qty) : 0;
          const proceeds = (op.totalAmount > 0 ? op.totalAmount : q * p) * (sold / q);
          realized += proceeds - fees - soldCost;
          qty -= sold;
          cost -= soldCost;
          if (qty <= EPS) {
            qty = 0;
            cost = 0;
          }
        } else {
          const taken = Math.min(cost, op.totalAmount);
          realized += op.totalAmount - fees - taken;
          cost -= taken;
        }
        if (qty <= EPS && cost <= EPS) closed = true;
        break;
      }
      case "split":
        qty += q;
        break;
      case "adjustment":
        if (op.quantity !== null && op.pricePerUnit !== null) {
          qty = Math.max(0, q);
          cost = qty * p;
          closed = qty <= EPS;
        } else {
          cost = Math.max(0, cost + op.totalAmount);
          closed = false;
        }
        break;
      default:
        break;
    }
  }
  qty = Math.max(0, qty);
  cost = Math.max(0, cost);
  return { quantity: qty, cost, averageCost: qty > EPS ? cost / qty : 0, realizedGain: realized, oversold, closed };
}

/**
 * Recomputes a holding from all its operations and stores quantity,
 * average cost and cost basis (totalInvested). A holding a sale emptied is
 * deactivated; one that was emptied and has a position again (a buy, or an
 * undone sale) is reactivated. A holding deactivated by hand while it still
 * had a position is left inactive. Lives apart from the portfolio service so
 * the undo log (ledger/services/mutations.ts) can recalculate holdings
 * without importing the service that records into it.
 */
export async function recalculateHoldingDetailed(holdingId: string, db: DbClient) {
  const [current, ops] = await Promise.all([
    db.investmentHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { isActive: true, currentQuantity: true, totalInvested: true } }),
    db.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const position = replayPosition(ops);
  const wasEmptied = !current.isActive && current.currentQuantity <= EPS && current.totalInvested <= EPS;
  const isActive = position.closed ? false : wasEmptied && (position.quantity > EPS || position.cost > EPS) ? true : current.isActive;
  const holding = await db.investmentHolding.update({
    where: { id: holdingId },
    data: { currentQuantity: position.quantity, averageCost: position.averageCost, totalInvested: position.cost, isActive },
  });
  return { holding, position };
}

/** recalculateHoldingDetailed without the replay details. */
export async function recalculateHolding(holdingId: string, db: DbClient) {
  return (await recalculateHoldingDetailed(holdingId, db)).holding;
}

/** Ids of the holding's operations that sell more than the position held at that point. */
export async function oversoldOperations(holdingId: string, db: DbClient): Promise<Set<string>> {
  const ops = await db.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  return new Set(replayPosition(ops).oversold);
}
