import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Account, AllocationClass, AssetClass, FixedIncomeSubType, IncomeType, InvestmentOperation, InvestmentTransactionType } from "@/generated/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { entityScopeWhere } from "@capital/server/lib/entity-scope";
import { ALLOCATION_CLASSES, dominantEtfCurrency, holdingAllocationClass, toAllocationTargets, type TargetInput } from "@capital/server/modules/investments/lib/allocation-class";
import { oversoldOperations, recalculateHolding, recalculateHoldingDetailed } from "@capital/server/modules/investments/lib/holding-position";
import { marketValue } from "@capital/server/modules/investments/lib/holding-value";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { loadFx, type FxContext } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances, getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { createEntry, softDeleteEntries } from "@capital/server/modules/ledger/services/entries";
import { getDefaultAccount } from "@capital/server/modules/ledger/services/entities";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { benchmarks12m } from "./benchmarks";
import { convertAmount, fundBroker } from "./funding";
import { portfolioHistory } from "./portfolio-history";

export { recalculateHolding, marketValue };

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
  if (account.type !== "brokerage") throw new LedgerError("Holdings live on brokerage accounts", 422, { code: "holding.requires_brokerage" });
  return account;
}

export async function getOwnedHolding(userId: string, holdingId: string, db: DbClient) {
  const holding = await db.investmentHolding.findFirst({ where: { id: holdingId, account: { userId } }, include: { account: true } });
  if (!holding) throw new LedgerError("Holding not found or access denied", 404, { code: "holding.not_found" });
  return holding;
}

/**
 * Creates a holding. With `collect` it joins the caller's undo batch (undo
 * removes it once its operations are gone); with `record` it gets a batch
 * of its own (batchId); otherwise nothing is recorded (statement imports,
 * MCP).
 */
export async function createHolding(userId: string, input: HoldingInput, db: DbClient, opts: { collect?: MutationRecordInput[]; record?: boolean } = {}) {
  const run = async (tx: DbClient) => {
    const account = await brokerage(userId, input.accountId, tx);
    const holding = await tx.investmentHolding.create({
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
    const records = opts.collect ?? [];
    records.push({ model: "InvestmentHolding", recordId: holding.id, before: null, after: snapshot(holding) });
    const batchId = opts.record && !opts.collect ? await recordMutation(tx, userId, "create", holding.ticker ?? holding.name, records) : null;
    return Object.assign(holding, { batchId });
  };
  return opts.record && !opts.collect ? inTransaction(db, run) : run(db);
}

/** Updates a holding (name, price, class, deactivation) in an undo batch of its own unless `collect` or `record: false`; returns it with the batchId. */
export async function updateHolding(
  userId: string,
  holdingId: string,
  patch: Partial<Omit<HoldingInput, "accountId">> & { isActive?: boolean },
  db: DbClient,
  opts: OperationWriteOptions = {}
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.investmentHolding.findFirst({ where: { id: holdingId, account: { userId } } });
    if (!before) throw new LedgerError("Holding not found or access denied", 404, { code: "holding.not_found" });
    const updated = await tx.investmentHolding.update({
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
    const records = opts.collect ?? [];
    records.push({ model: "InvestmentHolding", recordId: holdingId, before: snapshot(before), after: snapshot(updated) });
    const batchId = opts.record === false || opts.collect ? null : await recordMutation(tx, userId, "update", updated.ticker ?? updated.name, records);
    return Object.assign(updated, { batchId });
  });
}

/** Entities a portfolio read covers (resolveEntityScope); null or absent = all. */
export interface PortfolioScope {
  entityIds?: string[] | null;
}

export async function listHoldings(userId: string, db: DbClient, opts: PortfolioScope & { accountId?: string; includeInactive?: boolean } = {}) {
  return db.investmentHolding.findMany({
    where: {
      account: { userId, ...entityScopeWhere(opts.entityIds ?? null) },
      ...(opts.accountId && { accountId: opts.accountId }),
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    include: { account: { select: { id: true, name: true, entityId: true, currency: true, institution: true } } },
    orderBy: [{ assetClass: "asc" }, { ticker: "asc" }, { name: "asc" }],
  });
}

/** A holding for the API, with value and cost basis also in the base currency (fxRate = base units per unit of its currency). */
export function serializeHolding(h: Awaited<ReturnType<typeof listHoldings>>[number], fx: FxContext) {
  const value = marketValue(h);
  const fxRate = fx.rateFor(h.currency);
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
    fxRate,
    marketValueBase: round(value * fxRate, 2),
    investedBase: round(h.totalInvested * fxRate, 2),
    unrealizedGainBase: round((value - h.totalInvested) * fxRate, 2),
    isActive: h.isActive,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

const INCOME_OPERATION_TYPES = ["dividend", "yield_payment"] as const satisfies readonly InvestmentTransactionType[];

/** Dividends and yields: the operations that can carry an income type, tax withheld and a credit account. */
export function isIncomeOperation(type: InvestmentTransactionType): boolean {
  return (INCOME_OPERATION_TYPES as readonly string[]).includes(type);
}

/** The operation type an income type is recorded as (interest is a yield, the rest dividends). */
export function incomeOperationType(incomeType: IncomeType): InvestmentTransactionType {
  return incomeType === "interest" ? "yield_payment" : "dividend";
}

/**
 * Cash moved by an operation, in the holding's currency (negative = cash
 * leaves). Buys cost the amount plus fees, sales bring the amount minus
 * fees, income brings the gross amount minus the tax withheld at source.
 */
export function cashImpact(type: InvestmentTransactionType, totalAmount: number, fees: number, taxWithheld = 0): number {
  switch (type) {
    case "buy":
    case "deposit":
      return -(totalAmount + fees);
    case "sell":
    case "withdrawal":
      return totalAmount - fees;
    case "dividend":
    case "yield_payment":
      return totalAmount - taxWithheld;
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

const INCOME_LABEL: Record<IncomeType, string> = {
  dividend: "Dividendo",
  jcp: "JCP",
  fii_income: "Rendimento FII",
  interest: "Juros",
};

const opLabel = (type: InvestmentTransactionType, holding: { ticker: string | null; name: string }, incomeType?: IncomeType | null) =>
  `${incomeType && isIncomeOperation(type) ? INCOME_LABEL[incomeType] : OP_LABEL[type]} ${holding.ticker ?? holding.name}`;

export interface OperationInput {
  holdingId: string;
  type: InvestmentTransactionType;
  quantity?: number | null;
  pricePerUnit?: number | null;
  /** Gross amount in the holding's currency (fees and tax withheld apart). */
  totalAmount: number;
  fees?: number;
  date: string;
  notes?: string | null;
  externalId?: string | null;
  /** Income only: dividend, JCP, FII income or interest. */
  incomeType?: IncomeType | null;
  /** Income only: tax withheld at source; the cash credited is totalAmount - taxWithheld. */
  taxWithheld?: number;
  /** Income only: credit the cash to this checking or cash account (an entry in Transações) instead of the broker. */
  creditToAccountId?: string | null;
  /** Pay a buy from a checking account: books an investment_deposit transfer first (across entities, through the broker entity's main checking; see fundBroker). */
  fundFromAccountId?: string | null;
  /** With fundFromAccountId in another currency: the amount debited from it (default: converted at today's rate). */
  fundAmount?: number | null;
  importId?: string | null;
}

export interface OperationWriteOptions {
  /** Record an undo batch (default true). */
  record?: boolean;
  /** Mutation records are appended here instead of a new batch when given. */
  collect?: MutationRecordInput[];
}

type HoldingWithAccount = Awaited<ReturnType<typeof getOwnedHolding>>;

/** The checking or cash account an income operation is credited to. */
async function creditAccount(userId: string, accountId: string, db: DbClient) {
  const account = await getOwnedAccount(userId, accountId, db);
  if (account.type !== "checking" && account.type !== "cash") {
    throw new LedgerError("Income can only be credited to a checking or cash account", 422, { code: "operation.credit_account_invalid" });
  }
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
  return account;
}

/** Income type, tax withheld and credit account are for income operations only, and the tax cannot exceed the gross amount. */
function assertIncomeFields(type: InvestmentTransactionType, fields: { incomeType?: IncomeType | null; taxWithheld?: number; creditToAccountId?: string | null; totalAmount: number }) {
  if (!isIncomeOperation(type) && (fields.incomeType || (fields.taxWithheld ?? 0) > 0 || fields.creditToAccountId)) {
    throw new LedgerError("Only income operations can have an income type, tax withheld or a credit account", 422, { code: "operation.income_only" });
  }
  if ((fields.taxWithheld ?? 0) > fields.totalAmount + 1e-9) {
    throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
  }
}

/** A write may not make an operation sell more than the position held at that point. */
function assertNoNewOversell(before: Set<string>, after: readonly string[]) {
  if (after.some((id) => !before.has(id))) throw new LedgerError("The sale is larger than the position", 422, { code: "holding.oversell" });
}

/** The operation's cash leg on `account` (the broker, or the bank an income is credited to), converted at today's rate. */
async function createCashLeg(
  tx: DbClient,
  userId: string,
  holding: HoldingWithAccount,
  account: Account,
  label: string,
  impact: number,
  date: Date,
  importId: string | null,
  fx: FxContext,
  records: MutationRecordInput[]
) {
  const rate = fx.rateFor(account.currency);
  const amount = round(convertAmount(impact, holding.currency, account.currency, fx), 4);
  const leg = await tx.ledgerEntry.create({
    data: {
      userId,
      entityId: account.entityId,
      accountId: account.id,
      kind: "investment",
      amount,
      currency: account.currency,
      exchangeRate: rate,
      amountBase: round(amount * rate, 4),
      date,
      effectiveDate: date,
      description: label,
      importId,
      metadata: { holdingId: holding.id },
    },
  });
  records.push({ model: "LedgerEntry", recordId: leg.id, before: null, after: snapshot(leg) });
  return leg;
}

/** Sends an operation's cash leg to the trash (undo and the trash both bring it back). */
async function trashCashLeg(tx: DbClient, userId: string, entryId: string, records: MutationRecordInput[]) {
  const leg = await tx.ledgerEntry.findFirst({ where: { id: entryId, userId, deletedAt: null } });
  if (!leg) return;
  const trashed = await tx.ledgerEntry.update({ where: { id: leg.id }, data: { deletedAt: new Date() } });
  records.push({ model: "LedgerEntry", recordId: leg.id, before: snapshot(leg), after: snapshot(trashed) });
}

export interface RecordOperationOptions extends OperationWriteOptions {
  /** An investment_deposit the caller already booked for this buy (POST /v2/investments/aporte). */
  fundingGroupId?: string | null;
}

/**
 * Records the operation with its cash leg (and funding transfer), all in one
 * undo batch. A sale above the position held at its date is refused (422
 * holding.oversell), except for statement imports (importId), whose history
 * may start after the buys.
 */
export async function recordOperation(userId: string, input: OperationInput, db: DbClient, opts: RecordOperationOptions = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = opts.collect ?? [];
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    const fees = input.fees ?? 0;
    const taxWithheld = input.taxWithheld ?? 0;
    assertIncomeFields(input.type, { ...input, taxWithheld });
    const incomeType = isIncomeOperation(input.type) ? input.incomeType ?? null : null;
    const fx = await loadFx(userId, tx);
    const date = parseLocalDate(input.date);
    const impact = cashImpact(input.type, input.totalAmount, fees, taxWithheld);
    const legAccount = input.creditToAccountId ? await creditAccount(userId, input.creditToAccountId, tx) : holding.account;
    const label = opLabel(input.type, holding, incomeType);
    const oversoldBefore = input.importId ? null : await oversoldOperations(holding.id, tx);

    let fundingGroupId: string | null = opts.fundingGroupId ?? null;
    if (input.fundFromAccountId && impact < 0) {
      const funded = await fundBroker(
        tx,
        userId,
        {
          fromAccountId: input.fundFromAccountId,
          broker: holding.account,
          brokerAmount: -convertAmount(impact, holding.currency, holding.account.currency, fx),
          fundAmount: input.fundAmount,
          date: input.date,
          importId: input.importId,
        },
        fx,
        records
      );
      fundingGroupId = funded.depositGroupId;
    }

    const cashEntryId = impact !== 0 ? (await createCashLeg(tx, userId, holding, legAccount, label, impact, date, input.importId ?? null, fx, records)).id : null;

    const op = await tx.investmentOperation.create({
      data: {
        holdingId: holding.id,
        type: input.type,
        quantity: input.quantity ?? null,
        pricePerUnit: input.pricePerUnit ?? null,
        totalAmount: input.totalAmount,
        fees,
        incomeType,
        taxWithheld,
        date,
        notes: input.notes ?? null,
        externalId: input.externalId ?? null,
        cashEntryId,
        fundingGroupId,
      },
    });
    records.push({ model: "InvestmentOperation", recordId: op.id, before: null, after: snapshot(op) });
    const { holding: updated, position } = await recalculateHoldingDetailed(holding.id, tx);
    if (oversoldBefore) assertNoNewOversell(oversoldBefore, position.oversold);
    const batchId = opts.record === false || opts.collect ? null : await recordMutation(tx, userId, "create", label, records);
    return { operation: op, holding: updated, cashEntryId, fundingGroupId, batchId };
  });
}

export type OperationPatch = Partial<Omit<OperationInput, "holdingId" | "fundFromAccountId" | "fundAmount" | "importId">>;

/**
 * Updates an operation and keeps its cash leg in step: moved (to another
 * amount, date, or account for an income credited elsewhere), created, or
 * trashed when it no longer moves cash. An edit that makes a sale exceed
 * the position is refused (422 holding.oversell).
 */
export async function updateOperation(userId: string, operationId: string, patch: OperationPatch, db: DbClient, opts: OperationWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = opts.collect ?? [];
    const before = await tx.investmentOperation.findFirst({ where: { id: operationId, holding: { account: { userId } } } });
    if (!before) throw notFound("Investment operation", "operation.not_found");
    const holding = await getOwnedHolding(userId, before.holdingId, tx);
    const type = patch.type ?? before.type;
    const income = isIncomeOperation(type);
    const totalAmount = patch.totalAmount ?? before.totalAmount;
    // Leaving income drops the income fields; sending them for a non-income type is an error.
    assertIncomeFields(type, { incomeType: patch.incomeType, taxWithheld: patch.taxWithheld, creditToAccountId: patch.creditToAccountId, totalAmount });
    const merged = {
      type,
      totalAmount,
      fees: patch.fees ?? before.fees,
      incomeType: income ? (patch.incomeType !== undefined ? patch.incomeType : before.incomeType) : null,
      taxWithheld: income ? patch.taxWithheld ?? before.taxWithheld : 0,
      date: patch.date ? parseLocalDate(patch.date) : before.date,
    };
    assertIncomeFields(type, { taxWithheld: merged.taxWithheld, totalAmount });
    const fx = await loadFx(userId, tx);
    const impact = cashImpact(merged.type, merged.totalAmount, merged.fees, merged.taxWithheld);
    const label = opLabel(merged.type, holding, merged.incomeType);
    const oversoldBefore = await oversoldOperations(holding.id, tx);

    const leg = before.cashEntryId ? await tx.ledgerEntry.findUnique({ where: { id: before.cashEntryId } }) : null;
    // Where the cash lands: the account asked for, else where it is now; non-income always on the broker.
    const target = !income
      ? holding.account
      : patch.creditToAccountId !== undefined
        ? patch.creditToAccountId
          ? await creditAccount(userId, patch.creditToAccountId, tx)
          : holding.account
        : leg && leg.accountId !== holding.accountId
          ? await getOwnedAccount(userId, leg.accountId, tx)
          : holding.account;

    let cashEntryId = before.cashEntryId;
    if (cashEntryId && impact === 0) {
      await trashCashLeg(tx, userId, cashEntryId, records);
      cashEntryId = null;
    } else if (leg) {
      const moving = target.id !== leg.accountId;
      const currency = moving ? target.currency : leg.currency;
      const rate = moving ? fx.rateFor(target.currency) : toNumber(leg.exchangeRate);
      const amount = round(convertAmount(impact, holding.currency, currency, fx), 4);
      const moved = await tx.ledgerEntry.update({
        where: { id: leg.id },
        data: {
          amount,
          amountBase: round(amount * rate, 4),
          date: merged.date,
          effectiveDate: merged.date,
          description: label,
          ...(moving && { accountId: target.id, entityId: target.entityId, currency, exchangeRate: rate }),
        },
      });
      records.push({ model: "LedgerEntry", recordId: leg.id, before: snapshot(leg), after: snapshot(moved) });
    } else if (impact !== 0 && cashImpact(before.type, before.totalAmount, before.fees, before.taxWithheld) === 0) {
      // Only an operation that starts moving cash gets a leg; one recorded without a leg stays without.
      cashEntryId = (await createCashLeg(tx, userId, holding, target, label, impact, merged.date, null, fx, records)).id;
    }

    const updated = await tx.investmentOperation.update({
      where: { id: before.id },
      data: {
        type: merged.type,
        totalAmount: merged.totalAmount,
        fees: merged.fees,
        incomeType: merged.incomeType,
        taxWithheld: merged.taxWithheld,
        date: merged.date,
        cashEntryId,
        ...(patch.quantity !== undefined && { quantity: patch.quantity }),
        ...(patch.pricePerUnit !== undefined && { pricePerUnit: patch.pricePerUnit }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.externalId !== undefined && { externalId: patch.externalId }),
      },
    });
    records.push({ model: "InvestmentOperation", recordId: before.id, before: snapshot(before), after: snapshot(updated) });
    const { position } = await recalculateHoldingDetailed(before.holdingId, tx);
    assertNoNewOversell(oversoldBefore, position.oversold);
    const batchId = opts.record === false || opts.collect ? null : await recordMutation(tx, userId, "update", label, records);
    return { operation: updated, batchId };
  });
}

export interface DeleteOperationOptions extends OperationWriteOptions {
  /** Also send the investment_deposit transfer that paid for the operation to the trash. */
  withFunding?: boolean;
}

/**
 * Deletes an operation in one undo batch: the row is removed (undo
 * re-creates it from its snapshot), its cash leg goes to the trash, and so
 * does its funding transfer with `withFunding`. The holding is recalculated.
 */
export async function deleteOperation(userId: string, operationId: string, db: DbClient, opts: DeleteOperationOptions = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = opts.collect ?? [];
    const op = await tx.investmentOperation.findFirst({ where: { id: operationId, holding: { account: { userId } } } });
    if (!op) throw notFound("Investment operation", "operation.not_found");
    const holding = await tx.investmentHolding.findUniqueOrThrow({ where: { id: op.holdingId }, select: { ticker: true, name: true } });

    await tx.investmentOperation.delete({ where: { id: op.id } });
    records.push({ model: "InvestmentOperation", recordId: op.id, before: snapshot(op), after: null });
    if (op.cashEntryId) await trashCashLeg(tx, userId, op.cashEntryId, records);

    let fundingGroupId: string | null = null;
    if (opts.withFunding && op.fundingGroupId) {
      const leg = await tx.ledgerEntry.findFirst({ where: { transferGroupId: op.fundingGroupId, userId, deletedAt: null }, select: { id: true } });
      if (leg) {
        await softDeleteEntries(userId, [leg.id], tx, { collect: records });
        fundingGroupId = op.fundingGroupId;
      }
    }

    await recalculateHolding(op.holdingId, tx);
    const batchId = opts.record === false || opts.collect ? null : await recordMutation(tx, userId, "delete", opLabel(op.type, holding, op.incomeType), records);
    return { deleted: op.id, batchId, cashEntryId: op.cashEntryId, fundingGroupId };
  });
}

/** What serializeOperation reads from the holding and the cash leg. */
export const OPERATION_INCLUDE = {
  holding: {
    select: { ticker: true, name: true, assetClass: true, allocationClass: true, currency: true, accountId: true, account: { select: { entityId: true, name: true } } },
  },
  cashEntry: { select: { accountId: true } },
} as const satisfies Prisma.InvestmentOperationInclude;

export interface OperationFilters extends PortfolioScope {
  holdingId?: string;
  accountId?: string;
  types?: InvestmentTransactionType[];
  from?: Date;
  to?: Date;
}

function operationsWhere(userId: string, opts: OperationFilters): Prisma.InvestmentOperationWhereInput {
  return {
    holding: { account: { userId, ...entityScopeWhere(opts.entityIds ?? null) }, ...(opts.accountId && { accountId: opts.accountId }) },
    ...(opts.holdingId && { holdingId: opts.holdingId }),
    ...(opts.types?.length && { type: { in: opts.types } }),
    ...((opts.from || opts.to) && { date: { ...(opts.from && { gte: opts.from }), ...(opts.to && { lte: opts.to }) } }),
  };
}

/** Operations newest first; `limit`/`offset` page them (no limit = all). */
export async function listOperations(userId: string, db: DbClient, opts: OperationFilters & { limit?: number; offset?: number } = {}) {
  return db.investmentOperation.findMany({
    where: operationsWhere(userId, opts),
    include: OPERATION_INCLUDE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    ...(opts.limit !== undefined && { take: opts.limit }),
    ...(opts.offset && { skip: opts.offset }),
  });
}

export function countOperations(userId: string, db: DbClient, opts: OperationFilters = {}) {
  return db.investmentOperation.count({ where: operationsWhere(userId, opts) });
}

type SerializableOperation = InvestmentOperation & {
  holding?: {
    ticker: string | null;
    name: string;
    assetClass: AssetClass;
    allocationClass?: AllocationClass | null;
    currency?: string;
    accountId: string;
    account?: { entityId: string; name: string };
  };
  cashEntry?: { accountId: string } | null;
};

export function serializeOperation(op: SerializableOperation) {
  const accountId = op.holding?.accountId ?? null;
  const cashAccountId = op.cashEntry?.accountId ?? null;
  return {
    id: op.id,
    holdingId: op.holdingId,
    ticker: op.holding?.ticker ?? null,
    name: op.holding?.name ?? null,
    assetClass: op.holding?.assetClass ?? null,
    allocationClass: op.holding ? holdingAllocationClass(op.holding) : null,
    accountId,
    accountName: op.holding?.account?.name ?? null,
    entityId: op.holding?.account?.entityId ?? null,
    currency: op.holding?.currency ?? null,
    type: op.type,
    incomeType: op.incomeType,
    quantity: op.quantity,
    pricePerUnit: op.pricePerUnit,
    totalAmount: op.totalAmount,
    fees: op.fees,
    taxWithheld: op.taxWithheld,
    /** Cash the operation moved, in the holding's currency (negative = out). */
    cashAmount: round(cashImpact(op.type, op.totalAmount, op.fees, op.taxWithheld), 4),
    date: formatDateOnly(op.date),
    notes: op.notes,
    externalId: op.externalId,
    cashEntryId: op.cashEntryId,
    /** The checking or cash account an income was credited to; null when the cash is on the broker. */
    creditToAccountId: cashAccountId && accountId && cashAccountId !== accountId ? cashAccountId : null,
    fundingGroupId: op.fundingGroupId,
  };
}

/** Set a position to the broker's numbers, recording an adjustment operation (MCP adjust_position). */
export async function adjustPosition(userId: string, input: { holdingId: string; currentQuantity: number; averageCost: number; notes?: string }, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const owned = await getOwnedHolding(userId, input.holdingId, tx);
    const op = await tx.investmentOperation.create({
      data: {
        holdingId: input.holdingId,
        type: "adjustment",
        quantity: input.currentQuantity,
        pricePerUnit: input.averageCost,
        totalAmount: input.currentQuantity * input.averageCost,
        fees: 0,
        date: parseLocalDate(new Date().toISOString().slice(0, 10)),
        notes: input.notes ?? "Manual adjustment",
      },
    });
    // The adjustment resets the position; an adjustment to zero closes it.
    const holding = await recalculateHolding(input.holdingId, tx);
    // Undo removes the adjustment and recalculates the position from the operations left.
    const batchId = await recordMutation(tx, userId, "create", opLabel("adjustment", owned), [
      { model: "InvestmentOperation", recordId: op.id, before: null, after: snapshot(op) },
    ]);
    return { ...holding, batchId };
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
      if ((balances.get(broker.id) ?? 0) + 1e-9 < input.amount) throw new LedgerError("Insufficient cash balance in investment account", 422, { code: "brokerage.insufficient_cash" });
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

/**
 * Portfolio value in the base currency for a scope. `allocation` lists the
 * six classes in display order (fixed income, BR stocks, FIIs,
 * international, crypto, cash): every class with money in it or a target,
 * even an empty targeted one. Cash is the brokers' cash plus holdings
 * overridden to cash; shares are of netWorth (holdings + broker cash).
 */
export async function portfolioSummary(userId: string, db: DbClient, opts: PortfolioScope = {}) {
  const fx = await loadFx(userId, db);
  const scope = entityScopeWhere(opts.entityIds ?? null);
  const holdings = await listHoldings(userId, db, { entityIds: opts.entityIds });
  const brokers = await db.account.findMany({ where: { userId, type: "brokerage", archivedAt: null, ...scope }, orderBy: { createdAt: "asc" } });
  const balances = await accountBalances(userId, db, brokers.map((b) => b.id));

  const byClass = new Map<AllocationClass, { marketValue: number; invested: number; count: number }>(ALLOCATION_CLASSES.map((c) => [c, { marketValue: 0, invested: 0, count: 0 }]));
  let marketTotal = 0;
  let investedTotal = 0;
  let pricesUpdatedAt: Date | null = null;
  for (const h of holdings) {
    const rate = fx.rateFor(h.currency);
    const value = marketValue(h) * rate;
    const invested = h.totalInvested * rate;
    marketTotal += value;
    investedTotal += invested;
    const c = byClass.get(holdingAllocationClass(h))!;
    c.marketValue += value;
    c.invested += invested;
    c.count++;
    if (h.lastPriceUpdate && (!pricesUpdatedAt || h.lastPriceUpdate > pricesUpdatedAt)) pricesUpdatedAt = h.lastPriceUpdate;
  }
  const cash = brokers.map((b) => ({ accountId: b.id, name: b.name, entityId: b.entityId, currency: b.currency, cash: round(balances.get(b.id) ?? 0, 2), cashBase: round((balances.get(b.id) ?? 0) * fx.rateFor(b.currency), 2) }));
  const cashTotal = cash.reduce((s, c) => s + c.cashBase, 0);
  const cashClass = byClass.get("cash")!;
  cashClass.marketValue += cashTotal;
  cashClass.invested += cashTotal;

  const targets = await db.portfolioTarget.findMany({ where: { userId } });
  const targetOf = new Map(targets.map((t) => [t.allocationClass, t.targetPercent]));
  const yearAgo = new Date(Date.now() - 365 * 86400_000);
  const income = await db.investmentOperation.findMany({
    where: { holding: { account: { userId, ...scope } }, type: { in: ["dividend", "yield_payment"] }, date: { gte: yearAgo } },
    select: { totalAmount: true, taxWithheld: true, holding: { select: { currency: true } } },
  });
  const net = marketTotal + cashTotal;
  const [history, benchmarks] = await Promise.all([portfolioHistory(userId, db, { months: 12, entityIds: opts.entityIds ?? null }), benchmarks12m(db)]);
  const contributed = history.months.at(-1)?.contributed ?? 0;
  return {
    baseCurrency: fx.baseCurrency,
    marketValue: round(marketTotal, 2),
    /** Cost basis of the positions held. */
    invested: round(investedTotal, 2),
    unrealizedGain: round(marketTotal - investedTotal, 2),
    cash: round(cashTotal, 2),
    netWorth: round(net, 2),
    /**
     * "Total aportado": money that went into the brokers (opening balances +
     * net aportes + positions registered without cash), see
     * lib/portfolio-timeline.ts.
     */
    contributed,
    /** "Resultado": netWorth − contributed (what the money earned, realized or not). */
    result: round(net - contributed, 2),
    resultPercent: contributed > 0 ? round((net - contributed) / contributed, 4) : null,
    /**
     * "Rentab. 12m": chain-linked Modified Dietz over the last 12 months
     * (months valued at cost, before snapshots existed, are left out:
     * `months` says how many entered the chain), with the CDI and IPCA + 6%
     * of the same 12 months (fractions; null without cached data).
     */
    return12m: { ...history.return, cdi: benchmarks.cdi, ipca: benchmarks.ipca, ipcaPlus6: benchmarks.ipcaPlus6 },
    /** Income of the last 12 months, net of tax withheld. */
    income12m: round(income.reduce((s, op) => s + (op.totalAmount - op.taxWithheld) * fx.rateFor(op.holding.currency), 0), 2),
    holdingsCount: holdings.length,
    accountsCount: brokers.length,
    /** Latest price refresh among the holdings. */
    pricesUpdatedAt: pricesUpdatedAt?.toISOString() ?? null,
    allocation: ALLOCATION_CLASSES.filter((cls) => {
      const c = byClass.get(cls)!;
      return c.count > 0 || Math.abs(c.marketValue) >= 0.005 || targetOf.has(cls);
    }).map((allocationClass) => {
      const c = byClass.get(allocationClass)!;
      return {
        allocationClass,
        marketValue: round(c.marketValue, 2),
        invested: round(c.invested, 2),
        count: c.count,
        share: net > 0 ? round(c.marketValue / net, 4) : 0,
        target: targetOf.get(allocationClass) ?? null,
      };
    }),
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
  if (Math.abs(total - 1) > 0.0001 && Math.abs(total - 100) > 0.01) throw new LedgerError("Targets must add up to 100%", 422, { code: "portfolio.targets_sum" });
  const scale = total > 1.5 ? 100 : 1;
  return inTransaction(db, async (tx) => {
    await tx.portfolioTarget.deleteMany({ where: { userId } });
    await tx.portfolioTarget.createMany({ data: targets.map((t) => ({ userId, allocationClass: t.allocationClass, targetPercent: t.targetPercent / scale })) });
    return getTargets(userId, tx);
  });
}

/** One line of the "Por ativo" suggestion: a holding, a new asset for an empty targeted class, or cash to keep. */
export interface RebalanceAsset {
  kind: "holding" | "new" | "cash";
  holdingId: string | null;
  ticker: string | null;
  name: string | null;
  assetClass: AssetClass | null;
  allocationClass: AllocationClass;
  accountId: string | null;
  accountName: string | null;
  entityId: string | null;
  currency: string;
  price: number | null;
  amount: number;
  approxQuantity: number | null;
}

/**
 * Where to put new money: brings the classes furthest below target closer,
 * never suggests selling. Covers every class with a target or with money in
 * it, broker cash included (as "cash"; a negative cash balance counts as
 * zero). The amounts add up to `amount`. In "asset" mode each class amount
 * is split over its holdings in proportion to their value (with their
 * broker); a targeted class with no holdings becomes one "new" row, and
 * cash a "cash" row.
 */
export async function rebalanceSuggestion(userId: string, amount: number, mode: "class" | "asset", db: DbClient, opts: PortfolioScope = {}) {
  if (!(amount > 0)) throw new LedgerError("Amount must be positive", 422, { code: "rebalance.invalid_amount" });
  const summary = await portfolioSummary(userId, db, opts);
  const targets = await getTargets(userId, db);
  if (!targets.length) throw new LedgerError("Set allocation targets first", 422, { code: "rebalance.no_targets" });
  const targetOf = new Map(targets.map((t) => [t.allocationClass, t.targetPercent]));
  const valueOf = new Map(summary.allocation.map((a) => [a.allocationClass, Math.max(0, a.marketValue)]));
  const total = [...valueOf.values()].reduce((s, v) => s + v, 0);
  const after = total + amount;
  const needs = ALLOCATION_CLASSES.filter((cls) => (targetOf.get(cls) ?? 0) > 0 || (valueOf.get(cls) ?? 0) > 0).map((allocationClass) => {
    const target = targetOf.get(allocationClass) ?? 0;
    const value = valueOf.get(allocationClass) ?? 0;
    return { allocationClass, target, value, need: Math.max(0, target * after - value) };
  });
  const needSum = needs.reduce((s, n) => s + n.need, 0);
  // Targets add up to 1, so the puts add up to `amount`; rounding is settled on the largest.
  const puts = settleRounding(
    needs.map((n) => Math.max(0, needSum > amount ? (n.need / needSum) * amount : n.need + (amount - needSum) * n.target)),
    amount
  );
  const classes = needs.map((n, i) => ({
    allocationClass: n.allocationClass,
    value: round(n.value, 2),
    currentShare: total > 0 ? round(n.value / total, 4) : 0,
    target: n.target,
    amount: puts[i],
    afterShare: round((n.value + puts[i]) / after, 4),
  }));
  if (mode === "class") return { amount, total: round(total, 2), classes };

  const holdings = await listHoldings(userId, db, { entityIds: opts.entityIds });
  const fx = await loadFx(userId, db);
  const assets = classes
    .filter((c) => c.amount > 0)
    .flatMap((c): RebalanceAsset[] => {
      const inClass = holdings.filter((h) => holdingAllocationClass(h) === c.allocationClass);
      if (!inClass.length) {
        return [
          {
            kind: c.allocationClass === "cash" ? "cash" : "new",
            holdingId: null,
            ticker: null,
            name: null,
            assetClass: null,
            allocationClass: c.allocationClass,
            accountId: null,
            accountName: null,
            entityId: null,
            currency: fx.baseCurrency,
            price: null,
            amount: c.amount,
            approxQuantity: null,
          },
        ];
      }
      const sum = inClass.reduce((s, h) => s + marketValue(h) * fx.rateFor(h.currency), 0);
      const shares = settleRounding(
        inClass.map((h) => (sum > 0 ? (marketValue(h) * fx.rateFor(h.currency) * c.amount) / sum : c.amount / inClass.length)),
        c.amount
      );
      return inClass.map((h, i) => {
        const put = shares[i];
        const priceBase = h.currentPrice ? h.currentPrice * fx.rateFor(h.currency) : null;
        return {
          kind: "holding",
          holdingId: h.id,
          ticker: h.ticker,
          name: h.name,
          assetClass: h.assetClass,
          allocationClass: c.allocationClass,
          accountId: h.accountId,
          accountName: h.account.name,
          entityId: h.account.entityId,
          currency: h.currency,
          price: h.currentPrice,
          amount: put,
          approxQuantity: priceBase ? round(put / priceBase, 6) : null,
        };
      });
    });
  return { amount, total: round(total, 2), classes, assets: assets.filter((a) => a.amount > 0) };
}

/**
 * Rounds non-negative parts to cents so that they add up exactly to
 * `total` (rounded): the difference goes to the largest part (the first
 * one on a tie).
 */
export function settleRounding(parts: number[], total: number): number[] {
  const rounded = parts.map((p) => round(Math.max(0, p), 2));
  if (!rounded.length) return rounded;
  const diff = round(round(total, 2) - rounded.reduce((s, p) => s + p, 0), 2);
  if (diff !== 0) {
    const largest = parts.indexOf(Math.max(...parts));
    rounded[largest] = round(Math.max(0, rounded[largest] + diff), 2);
  }
  return rounded;
}

// Response types for the client (import type only).
export type SerializedHolding = ReturnType<typeof serializeHolding>;
export type SerializedOperation = ReturnType<typeof serializeOperation>;
export type PortfolioSummary = Awaited<ReturnType<typeof portfolioSummary>>;
export type PortfolioTargetRow = Awaited<ReturnType<typeof getTargets>>[number];
export type RebalanceSuggestion = Awaited<ReturnType<typeof rebalanceSuggestion>>;
