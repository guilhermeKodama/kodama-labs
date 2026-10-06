import type { DbClient } from "@capital/server/lib/prisma";
import type { InvestmentTransactionType } from "@/generated/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";

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

/** What a holding stores that recalculation reads back. */
export interface StoredPosition {
  isActive: boolean;
  currentQuantity: number;
  totalInvested: number;
}

/**
 * Whether a holding stays active after a replay: a position a sale emptied
 * goes inactive, and so does one that had a position and has none left
 * (its buys were deleted or undone, e.g. the buy of an aporte that also
 * created the holding), so no R$ 0 row stays in Carteira or in the
 * rebalance; one that was emptied and has a position again comes back;
 * otherwise the stored flag stays (a holding deactivated by hand while it
 * still had a position is left inactive, and one that never had a position
 * stays as it is).
 */
export function nextIsActive(current: StoredPosition, position: Position): boolean {
  if (position.closed) return false;
  const hadPosition = current.currentQuantity > EPS || current.totalInvested > EPS;
  const hasPosition = position.quantity > EPS || position.cost > EPS;
  if (hadPosition && !hasPosition) return false;
  const wasEmptied = !current.isActive && !hadPosition;
  return wasEmptied && hasPosition ? true : current.isActive;
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
export async function recalculateHoldingDetailed(holdingId: string, db: DbClient, undone?: readonly UndoneRecord[]) {
  const [current, ops] = await Promise.all([
    db.investmentHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { isActive: true, currentQuantity: true, totalInvested: true, ticker: true, name: true } }),
    db.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const position = replayPosition(ops);
  if (undone) assertUndoKeepsPosition({ holdingId, label: current.ticker || current.name, ops, position, undone });
  const isActive = nextIsActive(current, position);
  const holding = await db.investmentHolding.update({
    where: { id: holdingId },
    data: { currentQuantity: position.quantity, averageCost: position.averageCost, totalInvested: position.cost, isActive },
  });
  return { holding, position };
}

/**
 * recalculateHoldingDetailed without the replay details. The undo log's
 * post-undo hook (recalculateTouchedHoldings in ledger/services/mutations.ts)
 * passes the InvestmentOperation records of the batch it just undid as
 * `undone`, which refuses an undo that leaves a sale larger than the
 * position (see assertUndoKeepsPosition).
 */
export async function recalculateHolding(holdingId: string, db: DbClient, undone?: readonly UndoneRecord[]) {
  return (await recalculateHoldingDetailed(holdingId, db, undone)).holding;
}

/** What the undo guard reads from a mutation record (a MutationRecord row). */
export interface UndoneRecord {
  model: string;
  recordId: string;
  before: unknown;
  after: unknown;
}

/** A snapshot of an InvestmentOperation (JSON: dates as strings) back as what replayPosition reads, with its order keys. */
function snapshotOperation(snap: unknown): (PositionOperation & { holdingId: string; date: Date; createdAt: Date }) | null {
  if (!snap || typeof snap !== "object") return null;
  const o = snap as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.holdingId !== "string" || typeof o.type !== "string") return null;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: o.id,
    holdingId: o.holdingId,
    type: o.type as InvestmentTransactionType,
    quantity: num(o.quantity),
    pricePerUnit: num(o.pricePerUnit),
    totalAmount: num(o.totalAmount) ?? 0,
    fees: num(o.fees) ?? 0,
    date: new Date(String(o.date)),
    createdAt: new Date(String(o.createdAt ?? o.date)),
  };
}

/**
 * The holding's operations as they were before an undo, rebuilt from the
 * ones left after it and the batch's records: an operation the batch
 * created (undo removed it) or updated (undo wrote its old values back) is
 * taken as the batch left it; one the batch deleted (undo re-created it)
 * was not there.
 */
export function operationsBeforeUndo<T extends PositionOperation & { date: Date; createdAt: Date }>(
  holdingId: string,
  after: readonly T[],
  undone: readonly UndoneRecord[]
): PositionOperation[] {
  const ops = undone.filter((r) => r.model === "InvestmentOperation");
  const touched = new Set(ops.map((r) => r.recordId));
  const list: (PositionOperation & { date: Date; createdAt: Date })[] = after.filter((op) => !touched.has(op.id));
  for (const r of ops) {
    if (r.after === null) continue;
    const op = snapshotOperation(r.after);
    if (op && op.holdingId === holdingId) list.push(op);
  }
  return list.sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Refuses (409 holding.undo_oversell) an undo that leaves one of the
 * holding's sales larger than the position held at that point, e.g. undoing
 * an older aporte + buy after a later sale of that asset. Sales that were
 * already above the position before the undo (statement imports whose
 * history starts after the buys) do not count. Runs inside the undo's
 * transaction, before it commits, so a refused undo changes nothing.
 */
export function assertUndoKeepsPosition(input: {
  holdingId: string;
  label: string;
  ops: readonly (PositionOperation & { date: Date; createdAt: Date })[];
  position: Position;
  undone: readonly UndoneRecord[];
}) {
  if (!input.position.oversold.length) return;
  const before = new Set(replayPosition(operationsBeforeUndo(input.holdingId, input.ops, input.undone)).oversold);
  if (input.position.oversold.some((id) => !before.has(id))) {
    throw new LedgerError(`Undoing this would leave a sale of ${input.label} larger than the position; undo or delete that sale first`, 409, {
      code: "holding.undo_oversell",
      params: { holding: input.label },
    });
  }
}

/** Ids of the holding's operations that sell more than the position held at that point. */
export async function oversoldOperations(holdingId: string, db: DbClient): Promise<Set<string>> {
  const ops = await db.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  return new Set(replayPosition(ops).oversold);
}

export interface HoldingRecalculation {
  id: string;
  userId: string;
  label: string;
  before: StoredPosition;
  after: StoredPosition;
}

const MONEY_EPS = 0.005;

function differs(a: StoredPosition, b: StoredPosition) {
  return a.isActive !== b.isActive || Math.abs(a.currentQuantity - b.currentQuantity) > 1e-6 || Math.abs(a.totalInvested - b.totalInvested) > MONEY_EPS;
}

/**
 * Brings every stored holding (of one user, or all) in line with
 * replayPosition: holdings written before the cost-basis rules (fees in
 * cost, proportional sells, deactivation on a full sale) keep their old
 * totalInvested and isActive until an operation touches them. Holdings with
 * no operations are skipped: their position was entered directly (an MCP or
 * legacy import) and a replay would zero it. Idempotent; `dryRun` only
 * reports what would change. Not recorded for undo (a maintenance pass).
 */
export async function recalculateAllHoldings(db: DbClient, opts: { userId?: string; dryRun?: boolean } = {}) {
  const holdings = await db.investmentHolding.findMany({
    where: opts.userId ? { account: { userId: opts.userId } } : {},
    select: {
      id: true,
      ticker: true,
      name: true,
      isActive: true,
      currentQuantity: true,
      totalInvested: true,
      account: { select: { userId: true } },
      operations: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
    },
    orderBy: { createdAt: "asc" },
  });
  const changed: HoldingRecalculation[] = [];
  let skipped = 0;
  for (const h of holdings) {
    if (!h.operations.length) {
      skipped++;
      continue;
    }
    const position = replayPosition(h.operations);
    const before: StoredPosition = { isActive: h.isActive, currentQuantity: h.currentQuantity, totalInvested: h.totalInvested };
    const after: StoredPosition = { isActive: nextIsActive(before, position), currentQuantity: position.quantity, totalInvested: position.cost };
    if (!differs(before, after)) continue;
    if (!opts.dryRun) await recalculateHolding(h.id, db);
    changed.push({ id: h.id, userId: h.account.userId, label: h.ticker || h.name, before, after });
  }
  return { checked: holdings.length, skipped, changed };
}
