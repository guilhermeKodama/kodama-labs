import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { AllocationClass, AssetClass, FixedIncomeSubType, InvestmentHolding, InvestmentOperation, InvestmentTransactionType } from "@/generated/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { ALLOCATION_CLASSES, dominantEtfCurrency, holdingAllocationClass, toAllocationTargets, type TargetInput } from "@capital/server/modules/investments/lib/allocation-class";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances, getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { getDefaultAccount } from "@capital/server/modules/ledger/services/entities";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export interface HoldingInput {
  accountId: string;
  assetClass: AssetClass;
  /** Overrides the allocation class derived from assetClass and currency. */
  allocationClass?: AllocationClass | null;
  subType?: FixedIncomeSubType | null;
  ticker?: string | null;
  name: string;
  currency?: string;
  currentPrice?: number | null;
}

async function brokerage(userId: string, accountId: string, db: DbClient) {
  const account = await getOwnedAccount(userId, accountId, db);
  if (account.type !== "brokerage") throw new LedgerError("Holdings live on brokerage accounts", 422);
  return account;
}

export async function getOwnedHolding(userId: string, holdingId: string, db: DbClient) {
  const holding = await db.investmentHolding.findFirst({ where: { id: holdingId, account: { userId } }, include: { account: true } });
  if (!holding) throw new LedgerError("Holding not found or access denied", 404);
  return holding;
}

export async function createHolding(userId: string, input: HoldingInput, db: DbClient) {
  const account = await brokerage(userId, input.accountId, db);
  return db.investmentHolding.create({
    data: {
      accountId: account.id,
      assetClass: input.assetClass,
      allocationClass: input.allocationClass ?? null,
      subType: input.assetClass === "fixed_income" ? input.subType ?? null : null,
      ticker: input.ticker ? input.ticker.toUpperCase() : null,
      name: input.name,
      currency: input.currency ?? account.currency,
      currentPrice: input.currentPrice ?? null,
      lastPriceUpdate: input.currentPrice ? new Date() : null,
    },
  });
}

export async function updateHolding(userId: string, holdingId: string, patch: Partial<Omit<HoldingInput, "accountId">> & { isActive?: boolean }, db: DbClient) {
  await getOwnedHolding(userId, holdingId, db);
  return db.investmentHolding.update({
    where: { id: holdingId },
    data: {
      ...(patch.assetClass !== undefined && { assetClass: patch.assetClass }),
      ...(patch.allocationClass !== undefined && { allocationClass: patch.allocationClass }),
      ...(patch.subType !== undefined && { subType: patch.subType }),
      ...(patch.ticker !== undefined && { ticker: patch.ticker ? patch.ticker.toUpperCase() : null }),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.currentPrice !== undefined && { currentPrice: patch.currentPrice, lastPriceUpdate: new Date() }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
    },
  });
}

export async function listHoldings(userId: string, db: DbClient, opts: { accountId?: string; entityId?: string; includeInactive?: boolean } = {}) {
  return db.investmentHolding.findMany({
    where: {
      account: { userId, ...(opts.entityId && { entityId: opts.entityId }) },
      ...(opts.accountId && { accountId: opts.accountId }),
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    include: { account: { select: { id: true, name: true, entityId: true, currency: true, institution: true } } },
    orderBy: [{ assetClass: "asc" }, { ticker: "asc" }, { name: "asc" }],
  });
}

export function marketValue(h: Pick<InvestmentHolding, "currentQuantity" | "currentPrice" | "totalInvested" | "assetClass">) {
  // Fixed income and savings are amount-based: the position is the invested amount.
  if (h.currentPrice !== null && h.currentQuantity > 0) return h.currentQuantity * h.currentPrice;
  return h.totalInvested;
}

export function serializeHolding(h: Awaited<ReturnType<typeof listHoldings>>[number]) {
  const value = marketValue(h);
  return {
    id: h.id,
    accountId: h.accountId,
    accountName: h.account.name,
    entityId: h.account.entityId,
    assetClass: h.assetClass,
    allocationClass: holdingAllocationClass(h),
    allocationClassOverride: h.allocationClass,
    subType: h.subType,
    ticker: h.ticker,
    name: h.name,
    currency: h.currency,
    currentQuantity: h.currentQuantity,
    averageCost: h.averageCost,
    totalInvested: h.totalInvested,
    currentPrice: h.currentPrice,
    lastPriceUpdate: h.lastPriceUpdate?.toISOString() ?? null,
    marketValue: round(value, 2),
    unrealizedGain: round(value - h.totalInvested, 2),
    unrealizedGainPercent: h.totalInvested > 0 ? round((value - h.totalInvested) / h.totalInvested, 4) : null,
    isActive: h.isActive,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Weighted-average position from all operations, oldest first (unchanged rules). */
export async function recalculateHolding(holdingId: string, db: DbClient) {
  const ops = await db.investmentOperation.findMany({ where: { holdingId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  let qty = 0;
  let cost = 0;
  let invested = 0;
  for (const op of ops) {
    const q = op.quantity ?? 0;
    const p = op.pricePerUnit ?? 0;
    switch (op.type) {
      case "buy":
      case "deposit":
        qty += q;
        cost += q * p || op.totalAmount;
        invested += op.totalAmount;
        break;
      case "sell":
      case "withdrawal":
        if (q > 0) {
          const prev = qty;
          qty -= q;
          cost = qty > 0 && prev > 0 ? cost * (qty / prev) : 0;
        } else {
          invested -= op.totalAmount;
          cost = Math.max(0, cost - op.totalAmount);
        }
        break;
      case "split":
        qty += q;
        break;
      case "adjustment":
        if (q > 0 && p > 0) {
          // An adjustment carrying quantity and price resets the position.
          qty = q;
          cost = q * p;
          invested = op.totalAmount;
        } else {
          invested += op.totalAmount;
          cost = Math.max(0, cost + op.totalAmount);
        }
        break;
      default:
        break;
    }
  }
  return db.investmentHolding.update({
    where: { id: holdingId },
    data: { currentQuantity: Math.max(0, qty), averageCost: qty > 0 ? cost / qty : 0, totalInvested: Math.max(0, invested) },
  });
}

/** Cash moved by an operation on the brokerage account (negative = cash leaves). */
export function cashImpact(type: InvestmentTransactionType, totalAmount: number, fees: number): number {
  switch (type) {
    case "buy":
    case "deposit":
      return -(totalAmount + fees);
    case "sell":
    case "withdrawal":
      return totalAmount - fees;
    case "dividend":
    case "yield_payment":
      return totalAmount;
    default:
      return 0;
  }
}

const OP_LABEL: Record<InvestmentTransactionType, string> = {
  buy: "Compra",
  sell: "Venda",
  dividend: "Dividendo",
  yield_payment: "Rendimento",
  split: "Desdobramento",
  deposit: "Aplicação",
  withdrawal: "Resgate",
  adjustment: "Ajuste",
};

export interface OperationInput {
  holdingId: string;
  type: InvestmentTransactionType;
  quantity?: number | null;
  pricePerUnit?: number | null;
  totalAmount: number;
  fees?: number;
  date: string;
  notes?: string | null;
  externalId?: string | null;
  /** Pay a buy from a checking account: books an investment_deposit transfer first. */
  fundFromAccountId?: string | null;
  importId?: string | null;
}

export async function recordOperation(userId: string, input: OperationInput, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    const fees = input.fees ?? 0;
    const date = parseLocalDate(input.date);
    const impact = cashImpact(input.type, input.totalAmount, fees);
    let fundingGroupId: string | null = null;

    if (input.fundFromAccountId && impact < 0) {
      const funded = await createEntry(
        userId,
        { kind: "transfer", fromAccountId: input.fundFromAccountId, toAccountId: holding.accountId, amount: -impact, date: input.date, direction: "investment_deposit" },
        tx,
        { importId: input.importId ?? null }
      );
      fundingGroupId = funded.transferGroupId;
    }

    let cashEntryId: string | null = null;
    if (impact !== 0) {
      const fx = await loadFx(userId, tx);
      const rate = fx.rateFor(holding.account.currency);
      const leg = await tx.ledgerEntry.create({
        data: {
          userId,
          entityId: holding.account.entityId,
          accountId: holding.accountId,
          kind: "investment",
          amount: round(impact, 4),
          currency: holding.account.currency,
          exchangeRate: rate,
          amountBase: round(impact * rate, 4),
          date,
          effectiveDate: date,
          description: `${OP_LABEL[input.type]} ${holding.ticker ?? holding.name}`,
          importId: input.importId ?? null,
          metadata: { holdingId: holding.id },
        },
      });
      cashEntryId = leg.id;
    }

    const op = await tx.investmentOperation.create({
      data: {
        holdingId: holding.id,
        type: input.type,
        quantity: input.quantity ?? null,
        pricePerUnit: input.pricePerUnit ?? null,
        totalAmount: input.totalAmount,
        fees,
        date,
        notes: input.notes ?? null,
        externalId: input.externalId ?? null,
        cashEntryId,
        fundingGroupId,
      },
    });
    const updated = await recalculateHolding(holding.id, tx);
    return { operation: op, holding: updated, cashEntryId, fundingGroupId };
  });
}

export async function updateOperation(userId: string, operationId: string, patch: Partial<Omit<OperationInput, "holdingId" | "fundFromAccountId">>, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const op = await tx.investmentOperation.findFirst({ where: { id: operationId, holding: { account: { userId } } }, include: { holding: { include: { account: true } } } });
    if (!op) throw notFound("Investment operation");
    const merged = {
      type: patch.type ?? op.type,
      totalAmount: patch.totalAmount ?? op.totalAmount,
      fees: patch.fees ?? op.fees,
      date: patch.date ? parseLocalDate(patch.date) : op.date,
    };
    const updated = await tx.investmentOperation.update({
      where: { id: op.id },
      data: {
        type: merged.type,
        totalAmount: merged.totalAmount,
        fees: merged.fees,
        date: merged.date,
        ...(patch.quantity !== undefined && { quantity: patch.quantity }),
        ...(patch.pricePerUnit !== undefined && { pricePerUnit: patch.pricePerUnit }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.externalId !== undefined && { externalId: patch.externalId }),
      },
    });
    const impact = cashImpact(merged.type, merged.totalAmount, merged.fees);
    if (op.cashEntryId) {
      if (impact === 0) {
        await tx.investmentOperation.update({ where: { id: op.id }, data: { cashEntryId: null } });
        await tx.ledgerEntry.delete({ where: { id: op.cashEntryId } });
      } else {
        const leg = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: op.cashEntryId } });
        await tx.ledgerEntry.update({
          where: { id: leg.id },
          data: { amount: round(impact, 4), amountBase: round(impact * toNumber(leg.exchangeRate), 4), date: merged.date, effectiveDate: merged.date },
        });
      }
    }
    await recalculateHolding(op.holdingId, tx);
    return updated;
  });
}

export async function deleteOperation(userId: string, operationId: string, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const op = await tx.investmentOperation.findFirst({ where: { id: operationId, holding: { account: { userId } } } });
    if (!op) throw notFound("Investment operation");
    await tx.investmentOperation.delete({ where: { id: op.id } });
    if (op.cashEntryId) await tx.ledgerEntry.deleteMany({ where: { id: op.cashEntryId } });
    await recalculateHolding(op.holdingId, tx);
    return { deleted: op.id };
  });
}

export async function listOperations(userId: string, db: DbClient, opts: { holdingId?: string; accountId?: string; from?: Date; to?: Date } = {}) {
  return db.investmentOperation.findMany({
    where: {
      holding: { account: { userId }, ...(opts.accountId && { accountId: opts.accountId }) },
      ...(opts.holdingId && { holdingId: opts.holdingId }),
      ...((opts.from || opts.to) && { date: { ...(opts.from && { gte: opts.from }), ...(opts.to && { lte: opts.to }) } }),
    },
    include: { holding: { select: { ticker: true, name: true, assetClass: true, allocationClass: true, currency: true, accountId: true } } },
    orderBy: { date: "desc" },
  });
}

export function serializeOperation(
  op: InvestmentOperation & { holding?: { ticker: string | null; name: string; assetClass: AssetClass; allocationClass?: AllocationClass | null; currency?: string; accountId: string } }
) {
  return {
    id: op.id,
    holdingId: op.holdingId,
    ticker: op.holding?.ticker ?? null,
    name: op.holding?.name ?? null,
    assetClass: op.holding?.assetClass ?? null,
    allocationClass: op.holding ? holdingAllocationClass(op.holding) : null,
    type: op.type,
    quantity: op.quantity,
    pricePerUnit: op.pricePerUnit,
    totalAmount: op.totalAmount,
    fees: op.fees,
    date: formatDateOnly(op.date),
    notes: op.notes,
    externalId: op.externalId,
    cashEntryId: op.cashEntryId,
  };
}

/** Set a position to the broker's numbers, recording an adjustment operation (MCP adjust_position). */
export async function adjustPosition(userId: string, input: { holdingId: string; currentQuantity: number; averageCost: number; notes?: string }, db: DbClient) {
  return inTransaction(db, async (tx) => {
    await getOwnedHolding(userId, input.holdingId, tx);
    const totalInvested = input.currentQuantity * input.averageCost;
    await tx.investmentOperation.create({
      data: {
        holdingId: input.holdingId,
        type: "adjustment",
        quantity: input.currentQuantity,
        pricePerUnit: input.averageCost,
        totalAmount: totalInvested,
        fees: 0,
        date: parseLocalDate(new Date().toISOString().slice(0, 10)),
        notes: input.notes ?? "Manual adjustment",
      },
    });
    const holding = await tx.investmentHolding.update({
      where: { id: input.holdingId },
      data: { currentQuantity: input.currentQuantity, averageCost: input.averageCost, totalInvested },
    });
    return holding;
  });
}

/** Deposit to / withdraw from a broker as an investment transfer from/to the entity's default checking. */
export async function moveBrokerageCash(
  userId: string,
  input: { accountId: string; amount: number; date: string; direction: "deposit" | "withdraw"; currency?: string; exchangeRate?: number; description?: string; counterpartAccountId?: string },
  db: DbClient
) {
  return inTransaction(db, async (tx) => {
    const broker = await brokerage(userId, input.accountId, tx);
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: broker.entityId } });
    const checking = input.counterpartAccountId ? await getOwnedAccount(userId, input.counterpartAccountId, tx) : await getDefaultAccount(entity, tx);
    if (input.direction === "withdraw") {
      const balances = await accountBalances(userId, tx, [broker.id]);
      if ((balances.get(broker.id) ?? 0) + 1e-9 < input.amount) throw new LedgerError("Insufficient cash balance in investment account", 422);
    }
    const from = input.direction === "deposit" ? checking.id : broker.id;
    const to = input.direction === "deposit" ? broker.id : checking.id;
    return createEntry(
      userId,
      {
        kind: "transfer",
        fromAccountId: from,
        toAccountId: to,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        date: input.date,
        description: input.description,
        direction: input.direction === "deposit" ? "investment_deposit" : "investment_withdrawal",
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Portfolio views
// ---------------------------------------------------------------------------

export async function portfolioSummary(userId: string, db: DbClient, opts: { entityId?: string } = {}) {
  const fx = await loadFx(userId, db);
  const holdings = await listHoldings(userId, db, { entityId: opts.entityId });
  const brokers = await db.account.findMany({ where: { userId, type: "brokerage", archivedAt: null, ...(opts.entityId && { entityId: opts.entityId }) } });
  const balances = await accountBalances(userId, db, brokers.map((b) => b.id));

  const byClass = new Map<AllocationClass, { marketValue: number; invested: number; count: number }>();
  let marketTotal = 0;
  let investedTotal = 0;
  for (const h of holdings) {
    const rate = fx.rateFor(h.currency);
    const value = marketValue(h) * rate;
    const invested = h.totalInvested * rate;
    marketTotal += value;
    investedTotal += invested;
    const cls = holdingAllocationClass(h);
    const c = byClass.get(cls) ?? { marketValue: 0, invested: 0, count: 0 };
    byClass.set(cls, c);
    c.marketValue += value;
    c.invested += invested;
    c.count++;
  }
  const cash = brokers.map((b) => ({ accountId: b.id, name: b.name, currency: b.currency, cash: round(balances.get(b.id) ?? 0, 2), cashBase: round((balances.get(b.id) ?? 0) * fx.rateFor(b.currency), 2) }));
  const cashTotal = cash.reduce((s, c) => s + c.cashBase, 0);
  const targets = await db.portfolioTarget.findMany({ where: { userId } });
  const yearAgo = new Date(Date.now() - 365 * 86400_000);
  const income = await db.investmentOperation.findMany({
    where: { holding: { account: { userId, ...(opts.entityId && { entityId: opts.entityId }) } }, type: { in: ["dividend", "yield_payment"] }, date: { gte: yearAgo } },
    include: { holding: { select: { currency: true } } },
  });
  const net = marketTotal + cashTotal;
  return {
    baseCurrency: fx.baseCurrency,
    marketValue: round(marketTotal, 2),
    invested: round(investedTotal, 2),
    unrealizedGain: round(marketTotal - investedTotal, 2),
    cash: round(cashTotal, 2),
    netWorth: round(net, 2),
    income12m: round(income.reduce((s, op) => s + op.totalAmount * fx.rateFor(op.holding.currency), 0), 2),
    holdingsCount: holdings.length,
    accountsCount: brokers.length,
    allocation: [...byClass]
      .map(([allocationClass, v]) => ({
        allocationClass,
        marketValue: round(v.marketValue, 2),
        invested: round(v.invested, 2),
        count: v.count,
        share: net > 0 ? round(v.marketValue / net, 4) : 0,
        target: targets.find((t) => t.allocationClass === allocationClass)?.targetPercent ?? null,
      }))
      .sort((a, b) => b.marketValue - a.marketValue),
    brokers: cash,
  };
}

export async function getTargets(userId: string, db: DbClient) {
  const rows = await db.portfolioTarget.findMany({ where: { userId } });
  return rows.sort((a, b) => ALLOCATION_CLASSES.indexOf(a.allocationClass) - ALLOCATION_CLASSES.indexOf(b.allocationClass));
}

/** Replaces the targets. Asset-class targets are mapped to allocation classes and summed. */
export async function setTargets(userId: string, input: TargetInput[], db: DbClient) {
  const etfCurrency = input.some((t) => "assetClass" in t && t.assetClass === "etf")
    ? dominantEtfCurrency(await db.investmentHolding.findMany({ where: { account: { userId }, assetClass: "etf" }, select: { assetClass: true, currency: true, totalInvested: true } }))
    : null;
  const targets = toAllocationTargets(input, etfCurrency);
  const total = targets.reduce((s, t) => s + t.targetPercent, 0);
  if (Math.abs(total - 1) > 0.0001 && Math.abs(total - 100) > 0.01) throw new LedgerError("Targets must add up to 100%", 422);
  const scale = total > 1.5 ? 100 : 1;
  return inTransaction(db, async (tx) => {
    await tx.portfolioTarget.deleteMany({ where: { userId } });
    await tx.portfolioTarget.createMany({ data: targets.map((t) => ({ userId, allocationClass: t.allocationClass, targetPercent: t.targetPercent / scale })) });
    return getTargets(userId, tx);
  });
}

/**
 * Where to put new money: brings the classes furthest below target closer,
 * never suggests selling. In "asset" mode each class amount is split over
 * its holdings in proportion to their current value.
 */
export async function rebalanceSuggestion(userId: string, amount: number, mode: "class" | "asset", db: DbClient) {
  if (!(amount > 0)) throw new LedgerError("Amount must be positive", 422);
  const summary = await portfolioSummary(userId, db);
  const targets = await getTargets(userId, db);
  if (!targets.length) throw new LedgerError("Set allocation targets first", 422);
  const total = summary.marketValue;
  const after = total + amount;
  const current = new Map(summary.allocation.map((a) => [a.allocationClass, a.marketValue]));
  const needs = targets.map((t) => ({ allocationClass: t.allocationClass, target: t.targetPercent, value: current.get(t.allocationClass) ?? 0 }))
    .map((t) => ({ ...t, need: Math.max(0, t.target * after - t.value) }));
  const needSum = needs.reduce((s, n) => s + n.need, 0);
  const classes = needs.map((n) => {
    const put = needSum > amount ? (n.need / needSum) * amount : n.need + (amount - needSum) * n.target;
    return { allocationClass: n.allocationClass, currentShare: total > 0 ? round(n.value / total, 4) : 0, target: n.target, amount: round(put, 2), afterShare: round((n.value + put) / after, 4) };
  });
  if (mode === "class") return { amount, classes };
  const holdings = await listHoldings(userId, db);
  const fx = await loadFx(userId, db);
  const assets = classes.flatMap((c) => {
    const inClass = holdings.filter((h) => holdingAllocationClass(h) === c.allocationClass);
    const sum = inClass.reduce((s, h) => s + marketValue(h) * fx.rateFor(h.currency), 0);
    return inClass.map((h) => {
      const put = sum > 0 ? (marketValue(h) * fx.rateFor(h.currency) * c.amount) / sum : c.amount / inClass.length;
      const priceBase = h.currentPrice ? h.currentPrice * fx.rateFor(h.currency) : null;
      return {
        holdingId: h.id,
        ticker: h.ticker,
        name: h.name,
        assetClass: h.assetClass,
        allocationClass: c.allocationClass,
        amount: round(put, 2),
        approxQuantity: priceBase ? round(put / priceBase, 6) : null,
      };
    });
  });
  return { amount, classes, assets: assets.filter((a) => a.amount > 0) };
}

/**
 * Monthly net contributions (deposits minus withdrawals into brokers) and
 * buys in the base currency, by asset class (current screens) and by
 * allocation class (the six classes of the new screens).
 */
export async function contributions(userId: string, year: number, db: DbClient, opts: { entityId?: string } = {}) {
  const fx = await loadFx(userId, db);
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const flows = await db.$queryRaw<{ m: number; deposits: Prisma.Decimal; withdrawals: Prisma.Decimal; n: number }[]>`
    SELECT extract(month FROM le.date)::int AS m,
           coalesce(sum(le."amountBase") FILTER (WHERE tg.direction = 'investment_deposit'), 0) AS deposits,
           coalesce(-sum(le."amountBase") FILTER (WHERE tg.direction = 'investment_withdrawal'), 0) AS withdrawals,
           count(*)::int AS n
    FROM ledger_entries le
    JOIN accounts a ON a.id = le."accountId" AND a.type = 'brokerage'
    JOIN transfer_groups tg ON tg.id = le."transferGroupId"
    WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND le.date BETWEEN ${from} AND ${to}
      ${opts.entityId ? Prisma.sql`AND le."entityId" = ${opts.entityId}` : Prisma.empty}
    GROUP BY 1`;
  // totalAmount is in the holding's currency, so buys are grouped by it too.
  const buys = await db.$queryRaw<{ m: number; asset_class: AssetClass; allocation_class: AllocationClass | null; currency: string; total: number }[]>`
    SELECT extract(month FROM o.date)::int AS m, h."assetClass"::text AS asset_class, h."allocationClass"::text AS allocation_class,
           h.currency, sum(o."totalAmount") AS total
    FROM investment_operations o
    JOIN investment_holdings h ON h.id = o."holdingId"
    JOIN accounts a ON a.id = h."accountId"
    WHERE a."userId" = ${userId} AND o.type IN ('buy', 'deposit') AND o.date BETWEEN ${from} AND ${to}
      ${opts.entityId ? Prisma.sql`AND a."entityId" = ${opts.entityId}` : Prisma.empty}
    GROUP BY 1, 2, 3, 4`;
  const months = Array.from({ length: 12 }, (_, i) => {
    const f = flows.find((x) => x.m === i + 1);
    const deposits = toNumber(f?.deposits ?? 0);
    const withdrawals = toNumber(f?.withdrawals ?? 0);
    const byAssetClass: Partial<Record<AssetClass, number>> = {};
    const byAllocationClass: Partial<Record<AllocationClass, number>> = {};
    for (const b of buys) {
      if (b.m !== i + 1) continue;
      const base = Number(b.total) * fx.rateFor(b.currency);
      const cls = holdingAllocationClass({ assetClass: b.asset_class, currency: b.currency, allocationClass: b.allocation_class });
      byAssetClass[b.asset_class] = (byAssetClass[b.asset_class] ?? 0) + base;
      byAllocationClass[cls] = (byAllocationClass[cls] ?? 0) + base;
    }
    return {
      month: i + 1,
      deposits: round(deposits, 2),
      withdrawals: round(withdrawals, 2),
      net: round(deposits - withdrawals, 2),
      byAssetClass: roundValues(byAssetClass),
      byAllocationClass: roundValues(byAllocationClass),
    };
  });
  const net = months.reduce((s, m) => s + m.net, 0);
  return { year, months, totalNet: round(net, 2), averageMonthly: round(net / 12, 2) };
}

function roundValues<K extends string>(sums: Partial<Record<K, number>>): Partial<Record<K, number>> {
  return Object.fromEntries(Object.entries<number | undefined>(sums).map(([k, v]) => [k, round(v ?? 0, 2)])) as Partial<Record<K, number>>;
}
