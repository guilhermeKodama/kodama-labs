import type { DbClient } from "@capital/server/lib/prisma";
import type { AssetClass, InvestmentTransactionType } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { loadFx, type FxContext } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances, getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { advisoryLock } from "@capital/server/modules/ledger/lib/advisory-lock";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { recalculateHolding, replayPosition } from "../lib/holding-position";
import { marketValue } from "../lib/holding-value";
import { convertAmount, fundBroker, withdrawFromBroker } from "./funding";
import { getOwnedHolding, recordOperation, updateHolding } from "./portfolio";

const EPS = 1e-9;
const VALUE_CLASSES = new Set<AssetClass>(["fixed_income", "savings"]);

export type CashflowMode = "by_value" | "by_units";

export interface HoldingCashflowInput {
  holdingId: string;
  cashAccountId: string;
  /** Contribution: what leaves the cash account, in that account's currency. Redemption: what leaves the holding, in the holding's currency. */
  amount: number;
  date: string;
  description?: string | null;
  /**
   * The other currency's amount. On a contribution, what the holding receives
   * when its currency differs from the cash account. On a redemption, what
   * arrives in the cash account when that currency differs from the holding.
   */
  toAmount?: number | null;
  quantity?: number | null;
  price?: number | null;
  mode?: CashflowMode | null;
}

export interface HoldingCashflowResult {
  duplicate: boolean;
  batchId: string | null;
  operationId: string;
  holdingId: string;
  transferGroupId: string | null;
  transferGroupIds: string[];
  mode: CashflowMode;
  /** Cash that moved in the holding's currency. */
  amount: number;
  quantity: number;
  averageCost: number;
  totalInvested: number;
  currentPrice: number | null;
}

type OwnedHolding = Awaited<ReturnType<typeof getOwnedHolding>>;

/**
 * by_value for fixed income, savings, and a caixinha (by name), and for a
 * one-unit position when the caller did not pass quantity or price.
 * Anything else is by_units. An explicit mode wins.
 */
export function resolveCashflowMode(
  holding: { assetClass: AssetClass; name: string; currentQuantity: number },
  input: { mode?: CashflowMode | null; quantity?: number | null; price?: number | null },
): CashflowMode {
  if (input.mode) return input.mode;
  if (VALUE_CLASSES.has(holding.assetClass) || /caixinha/i.test(holding.name)) return "by_value";
  const unitsOmitted = input.quantity == null && input.price == null;
  if (Math.abs(holding.currentQuantity - 1) <= EPS && unitsOmitted) return "by_value";
  return "by_units";
}

function assertModeArgs(mode: CashflowMode, input: HoldingCashflowInput) {
  if (mode === "by_value" && (input.quantity != null || input.price != null)) {
    throw new LedgerError("This update is by value, so quantity and price are not accepted. Pass mode by_units to trade units.", 422, { code: "holding.value_mode" });
  }
}

/** Holding-currency amount of the cashflow. Contribution `amount` is in the cash account's currency. */
function contributionHoldingAmount(input: HoldingCashflowInput, cashCurrency: string, holdingCurrency: string, fx: FxContext) {
  if (cashCurrency === holdingCurrency) {
    if (input.toAmount != null) throw new LedgerError("A same-currency transfer has one amount", 422, { code: "transfer.same_currency" });
    return input.amount;
  }
  if (input.toAmount != null && input.toAmount > 0) return input.toAmount;
  return round(convertAmount(input.amount, cashCurrency, holdingCurrency, fx), 4);
}

function redemptionHoldingAmount(input: HoldingCashflowInput, holdingCurrency: string, cashCurrency: string) {
  if (cashCurrency === holdingCurrency && input.toAmount != null) {
    throw new LedgerError("A same-currency transfer has one amount", 422, { code: "transfer.same_currency" });
  }
  return input.amount;
}

function resolveUnits(currentPrice: number | null, holdingAmount: number, quantity?: number | null, price?: number | null) {
  let q = quantity ?? null;
  let p = price ?? null;
  if (q != null && p != null) {
    if (!(p > 0) || Math.abs(q * p - holdingAmount) > 0.01) {
      throw new LedgerError("Quantity times price must match the cash amount within 0.01", 422, { code: "holding.amount_mismatch" });
    }
  } else if (q != null) {
    if (!(q > 0)) throw new LedgerError("A by-units trade needs a quantity and a price, or a current price to derive them", 422, { code: "holding.units_required" });
    p = holdingAmount / q;
  } else if (p != null) {
    if (!(p > 0)) throw new LedgerError("A by-units trade needs a quantity and a price, or a current price to derive them", 422, { code: "holding.units_required" });
    q = holdingAmount / p;
  } else if (currentPrice != null && currentPrice > 0) {
    p = currentPrice;
    q = holdingAmount / p;
  } else {
    throw new LedgerError("A by-units trade needs a quantity and a price, or a current price to derive them", 422, { code: "holding.units_required" });
  }
  return { quantity: q, price: p };
}

async function cashAccount(userId: string, accountId: string, tx: DbClient) {
  const account = await getOwnedAccount(userId, accountId, tx);
  if (account.type !== "checking" && account.type !== "cash") {
    throw new LedgerError("The money of a contribution comes from a checking or cash account", 422, { code: "aporte.source_invalid" });
  }
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
  return account;
}

async function findDuplicate(tx: DbClient, holdingId: string, date: string, holdingAmount: number, types: InvestmentTransactionType[]) {
  const ops = await tx.investmentOperation.findMany({
    where: { holdingId, date: parseLocalDate(date), type: { in: types } },
    orderBy: { createdAt: "asc" },
  });
  return ops.find((op) => Math.abs(op.totalAmount - holdingAmount) <= 0.01) ?? null;
}

async function groupsForOperation(tx: DbClient, userId: string, operationId: string, fundingGroupId: string | null) {
  if (fundingGroupId) return [fundingGroupId];
  const legs = await tx.ledgerEntry.findMany({
    where: { userId, deletedAt: null, transferGroupId: { not: null }, metadata: { path: ["operationId"], equals: operationId } },
    select: { transferGroupId: true },
  });
  return [...new Set(legs.map((leg) => leg.transferGroupId).filter((id): id is string => !!id))];
}

function resultOf(
  duplicate: boolean,
  batchId: string | null,
  operationId: string,
  holding: { id: string; currentQuantity: number; averageCost: number; totalInvested: number; currentPrice: number | null },
  mode: CashflowMode,
  amount: number,
  transferGroupIds: string[],
): HoldingCashflowResult {
  return {
    duplicate,
    batchId,
    operationId,
    holdingId: holding.id,
    transferGroupId: transferGroupIds[0] ?? null,
    transferGroupIds,
    mode,
    amount,
    quantity: holding.currentQuantity,
    averageCost: holding.averageCost,
    totalInvested: holding.totalInvested,
    currentPrice: holding.currentPrice,
  };
}

/**
 * When the saved quantity and cost are not what the operations replay to
 * (a position typed onto the holding), anchor them with an adjustment so
 * the following quantity-0 buy replays to the same end state. A later
 * operation would be rewritten by that anchor, so that case is refused.
 */
async function anchorStoredPosition(tx: DbClient, holding: OwnedHolding, date: string, records: MutationRecordInput[]) {
  const ops = await tx.investmentOperation.findMany({
    where: { holdingId: holding.id },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const replayed = replayPosition(ops);
  const qtyOk = Math.abs(replayed.quantity - holding.currentQuantity) <= 1e-6;
  const costOk = Math.abs(replayed.cost - holding.totalInvested) <= 0.01;
  if (qtyOk && costOk) return null;
  const day = parseLocalDate(date);
  if (ops.some((op) => op.date > day)) {
    throw new LedgerError(
      "This holding's saved quantity and cost do not match its operations, and a later operation exists",
      422,
      { code: "holding.replay_mismatch" },
    );
  }
  const priced = holding.currentQuantity > EPS;
  const delta = round(holding.totalInvested - replayed.cost, 4);
  // createdAt is the replay tiebreak. Default now() is the transaction clock, the same
  // instant as the buy or sell recorded next, so the anchor is pinned 1ms after every
  // operation already stored and the cashflow operation is moved after it.
  const latest = ops.reduce((max, op) => Math.max(max, op.createdAt.getTime()), 0);
  const op = await tx.investmentOperation.create({
    data: {
      holdingId: holding.id,
      type: "adjustment",
      quantity: priced ? holding.currentQuantity : null,
      pricePerUnit: priced ? holding.totalInvested / holding.currentQuantity : null,
      totalAmount: priced ? holding.totalInvested : delta,
      fees: 0,
      date: day,
      notes: "Anchor stored position before by-value cashflow",
      adjustmentMode: priced ? "absolute" : null,
      createdAt: new Date(latest + 1),
    },
  });
  records.push({ model: "InvestmentOperation", recordId: op.id, before: null, after: snapshot(op) });
  return op;
}

/** The cashflow operation has to replay after its anchor. Both default to the transaction clock. */
async function orderCashflowAfterAnchor(tx: DbClient, holdingId: string, anchorCreatedAt: Date, operationId: string, records: MutationRecordInput[]) {
  const operation = await tx.investmentOperation.findUniqueOrThrow({ where: { id: operationId } });
  if (operation.createdAt > anchorCreatedAt) return;
  const bumped = await tx.investmentOperation.update({
    where: { id: operationId },
    data: { createdAt: new Date(anchorCreatedAt.getTime() + 1) },
  });
  const recorded = records.find((record) => record.model === "InvestmentOperation" && record.recordId === operationId);
  if (recorded) recorded.after = snapshot(bumped);
  await recalculateHolding(holdingId, tx);
}

async function applyValuePrice(userId: string, holding: OwnedHolding, holdingAmount: number, sign: 1 | -1, tx: DbClient, records: MutationRecordInput[]) {
  if (!(holding.currentQuantity > EPS)) return holding.currentPrice;
  const perUnit = holdingAmount / holding.currentQuantity;
  const next = holding.currentPrice != null ? holding.currentPrice + sign * perUnit : (marketValue(holding) + sign * holdingAmount) / holding.currentQuantity;
  const updated = await updateHolding(userId, holding.id, { currentPrice: round(Math.max(0, next), 8) }, tx, { collect: records });
  return updated.currentPrice;
}

/**
 * Cash into a holding the way the UI books an aporte plus a buy, in one
 * undo batch. by_value keeps the quantity, adds the amount to the cost
 * basis, and raises the position value by the same amount. by_units buys
 * that many units. The deposit is the aporte; the buy's cash leg spends it,
 * so broker cash nets to zero and Aportes counts the transfer once.
 */
export async function recordInvestmentContribution(userId: string, input: HoldingCashflowInput, db: DbClient): Promise<HoldingCashflowResult> {
  return inTransaction(db, async (tx) => {
    await advisoryLock(tx, `holding:${input.holdingId}`);
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    const cash = await cashAccount(userId, input.cashAccountId, tx);
    const mode = resolveCashflowMode(holding, input);
    assertModeArgs(mode, input);
    const fx = await loadFx(userId, tx);
    const holdingAmount = contributionHoldingAmount(input, cash.currency, holding.currency, fx);
    if (!(holdingAmount > 0)) throw new LedgerError("The amount must be positive", 422, { code: "rebalance.invalid_amount" });
    const existing = await findDuplicate(tx, holding.id, input.date, holdingAmount, ["buy", "deposit"]);
    if (existing) {
      const ids = await groupsForOperation(tx, userId, existing.id, existing.fundingGroupId);
      const current = await tx.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
      return resultOf(true, null, existing.id, current, mode, holdingAmount, ids);
    }

    const records: MutationRecordInput[] = [];
    const anchor = mode === "by_value" ? await anchorStoredPosition(tx, holding, input.date, records) : null;
    const broker = holding.account;
    const brokerAmount = round(Math.abs(convertAmount(holdingAmount, holding.currency, broker.currency, fx)), 4);
    const funded = await fundBroker(
      tx,
      userId,
      {
        fromAccountId: cash.id,
        broker,
        brokerAmount,
        fundAmount: cash.currency === broker.currency ? undefined : input.amount,
        date: input.date,
        description: input.description,
      },
      fx,
      records,
    );
    const units = mode === "by_units" ? resolveUnits(holding.currentPrice, holdingAmount, input.quantity, input.price) : { quantity: 0, price: null as number | null };
    const recorded = await recordOperation(
      userId,
      {
        holdingId: holding.id,
        type: "buy",
        quantity: units.quantity,
        pricePerUnit: units.price,
        totalAmount: holdingAmount,
        date: input.date,
        notes: mode === "by_value" ? "by_value" : null,
      },
      tx,
      { collect: records, fundingGroupId: funded.depositGroupId },
    );
    if (anchor) await orderCashflowAfterAnchor(tx, holding.id, anchor.createdAt, recorded.operation.id, records);
    if (mode === "by_value") await applyValuePrice(userId, holding, holdingAmount, 1, tx, records);
    const group = await tx.transferGroup.findUniqueOrThrow({ where: { id: funded.depositGroupId }, select: { description: true } });
    const batchId = await recordMutation(tx, userId, "create", group.description, records);
    const current = await tx.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    return resultOf(false, batchId, recorded.operation.id, current, mode, holdingAmount, funded.transferGroupIds);
  });
}

/**
 * Sell and send the proceeds to a cash account, in one undo batch.
 * by_value keeps the quantity, lowers the position value by the amount, and
 * removes cost in proportion to that value (realized gain is the amount
 * minus the cost removed). A redemption larger than the current value is
 * refused. Paying out the whole value (within 0.01) sells the quantity and
 * can close the position. The withdrawal legs carry the sell's id in metadata.
 */
export async function recordInvestmentRedemption(userId: string, input: HoldingCashflowInput, db: DbClient): Promise<HoldingCashflowResult> {
  return inTransaction(db, async (tx) => {
    await advisoryLock(tx, `holding:${input.holdingId}`);
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    const cash = await cashAccount(userId, input.cashAccountId, tx);
    const mode = resolveCashflowMode(holding, input);
    assertModeArgs(mode, input);
    const fx = await loadFx(userId, tx);
    const holdingAmount = redemptionHoldingAmount(input, holding.currency, cash.currency);
    if (!(holdingAmount > 0)) throw new LedgerError("The amount must be positive", 422, { code: "rebalance.invalid_amount" });
    const value = marketValue(holding);
    if (mode === "by_value" && holdingAmount > value + 0.01) {
      throw new LedgerError(`The redemption ${holdingAmount} is larger than the position value ${value}`, 422, {
        code: "holding.above_value",
        params: { amount: round(holdingAmount, 2), value: round(value, 2) },
      });
    }
    const existing = await findDuplicate(tx, holding.id, input.date, holdingAmount, ["sell", "withdrawal"]);
    if (existing) {
      const ids = await groupsForOperation(tx, userId, existing.id, existing.fundingGroupId);
      const current = await tx.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
      return resultOf(true, null, existing.id, current, mode, holdingAmount, ids);
    }

    const records: MutationRecordInput[] = [];
    const anchor = mode === "by_value" ? await anchorStoredPosition(tx, holding, input.date, records) : null;
    const full = mode === "by_value" && value > 0 && holdingAmount >= value - 0.01;
    const units = mode === "by_units" ? resolveUnits(holding.currentPrice, holdingAmount, input.quantity, input.price) : null;
    const unitPosition = holding.currentQuantity > EPS;
    // A partial by-value sell is quantity 0 with pricePerUnit = the cost removed,
    // which replayPosition keeps as the same quantity. Paying out the whole value
    // sells the units, so the position can close. Amount-based (no units) stays
    // on the quantity-null path.
    const costRemoved = value > EPS ? round(holding.totalInvested * (holdingAmount / value), 8) : 0;
    const sellQuantity = mode === "by_units" ? units!.quantity : full && unitPosition ? holding.currentQuantity : unitPosition ? 0 : null;
    const sellPrice = mode === "by_units" ? units!.price : !unitPosition || full ? null : costRemoved;
    const recorded = await recordOperation(
      userId,
      {
        holdingId: holding.id,
        type: "sell",
        quantity: sellQuantity,
        pricePerUnit: sellPrice,
        totalAmount: holdingAmount,
        date: input.date,
        notes: mode === "by_value" ? "by_value" : null,
      },
      tx,
      { collect: records },
    );
    if (anchor) await orderCashflowAfterAnchor(tx, holding.id, anchor.createdAt, recorded.operation.id, records);

    const cashLeg = recorded.cashEntryId ? await tx.ledgerEntry.findUnique({ where: { id: recorded.cashEntryId } }) : null;
    const brokerProceeds = cashLeg ? toNumber(cashLeg.amount) : round(Math.abs(convertAmount(holdingAmount, holding.currency, holding.account.currency, fx)), 4);
    const balances = await accountBalances(userId, tx, [holding.accountId]);
    if ((balances.get(holding.accountId) ?? 0) + 1e-9 < brokerProceeds) {
      throw new LedgerError("Insufficient cash balance in investment account", 422, { code: "brokerage.insufficient_cash" });
    }
    const metadata = { operationId: recorded.operation.id };
    const arrival = cash.currency === holding.account.currency
      ? null
      : input.toAmount != null && input.toAmount > 0
        ? input.toAmount
        : round(convertAmount(holdingAmount, holding.currency, cash.currency, fx), 4);
    let transferGroupIds: string[];
    if (cash.entityId !== holding.account.entityId) {
      const moved = await withdrawFromBroker(
        tx,
        userId,
        {
          broker: holding.account,
          to: cash,
          amount: brokerProceeds,
          receivedAmount: arrival,
          date: input.date,
          description: input.description,
          metadata,
        },
        fx,
        records,
      );
      transferGroupIds = moved.transferGroupIds;
    } else {
      const withdrawn = await createEntry(
        userId,
        {
          kind: "transfer",
          fromAccountId: holding.accountId,
          toAccountId: cash.id,
          amount: brokerProceeds,
          date: input.date,
          direction: "investment_withdrawal",
          ...(input.description && { description: input.description }),
          ...(arrival != null && { toAmount: arrival }),
        },
        tx,
        { collect: records, metadata },
      );
      transferGroupIds = withdrawn.transferGroupId ? [withdrawn.transferGroupId] : [];
    }
    if (mode === "by_value" && !full) await applyValuePrice(userId, holding, holdingAmount, -1, tx, records);
    const label = input.description?.trim() || `Resgate ${holding.ticker ?? holding.name}`;
    const batchId = await recordMutation(tx, userId, "create", label, records);
    const current = await tx.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    return resultOf(false, batchId, recorded.operation.id, current, mode, holdingAmount, transferGroupIds);
  });
}
