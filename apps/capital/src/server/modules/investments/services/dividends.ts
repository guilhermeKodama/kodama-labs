import type { IncomeType, InvestmentOperation, LedgerEntry } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import {
  countsAsPassiveIncome,
  defaultDividendOrigin,
  dividendDescription,
  type DividendOrigin,
  type PassiveIncomeType,
} from "@/lib/invest/passive-income";
import { advisoryLock } from "@capital/server/modules/ledger/lib/advisory-lock";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { loadFx, type FxContext } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { recalculateHoldingDetailed } from "../lib/holding-position";
import { assertIncomeAccountType, getOwnedHolding, incomeCreditAccount, incomeOperationType, isIncomeOperation, recordOperation } from "./portfolio";

const EPS = 0.02;
const DAY_MS = 86_400_000;
const MATCH_EPS = 0.01;

export interface RecordDividendInput {
  holdingId: string;
  /**
   * Checking, cash, or brokerage account that receives the net.
   * Omit to credit the brokerage the holding belongs to (its cash balance).
   */
  cashAccountId?: string;
  /** Gross amount, in `currency`. */
  amount: number;
  date: string;
  /** The holding's currency or the cash account's. */
  currency: string;
  incomeType: PassiveIncomeType;
  /** Withheld at source, in `currency`. The cash credited is amount − this. */
  withholdingTax?: number;
  /** Dividends only. Defaults from the asset class. */
  origin?: DividendOrigin;
  description?: string;
}

export interface ConvertIncomeInput {
  transactionId: string;
  holdingId: string;
  incomeType: PassiveIncomeType;
  /** Withheld at source, in the transaction's currency. The cash entry is the net and is not changed. */
  withholdingTax?: number;
  origin?: DividendOrigin;
}

export interface UpdateDividendInput {
  operationId: string;
  incomeType?: PassiveIncomeType;
  /** Withheld at source, in the holding's currency. Omit to keep the current value. 0 clears it. Cannot exceed the current gross. The cash entry is not changed. */
  withholdingTax?: number;
  /** Dividends only. Rejected when the income type is not a dividend. */
  origin?: DividendOrigin;
  /**
   * Move the cash leg to this checking, cash, or brokerage account.
   * Amounts, date, origin, income type and withholding stay as they are.
   * Omit to leave the cash where it is.
   */
  cashAccountId?: string;
}

export interface DividendResult {
  duplicate: boolean;
  operationId: string;
  cashEntryId: string | null;
  holdingId: string;
  incomeType: IncomeType;
  origin: DividendOrigin | null;
  /** Gross, in `currency`. */
  gross: number;
  withholdingTax: number;
  /** Net cash, in `currency`. */
  net: number;
  currency: string;
  /** Net in the user's base currency, at the rate stored on the cash leg. */
  amountBase: number;
  date: string;
  description: string;
  /** Account the net cash sits on. Null when the operation has no live cash leg. */
  cashAccountId: string | null;
  /** False for fixed-income interest inside a business entity: it stays out of personal passive income. */
  passiveIncome: boolean;
  batchId: string | null;
}

/**
 * Books a provento: an income operation on the holding and one cash credit,
 * the same shape as the ledger v2 cash legs (kind investment, linked by
 * cashEntryId). The credit lands on `cashAccountId` — a checking, cash, or
 * brokerage account — or, when that is omitted, on the brokerage the holding
 * belongs to. That brokerage balance is the saldo em conta: buys, sells and
 * aportes already post there, and list_account_balances sums those entries.
 * Gross is `amount`, the cash credited is the net, and the leg stores the
 * rate of `date`.
 * The same holding, day, income type, cash account and net amount returns
 * the existing operation. An unlinked income of that net on the same cash
 * account (within 3 days, category Proventos or a description that names
 * the ticker) is not credited again: the error names that transaction so
 * it can be linked with convertIncomeToDividend.
 */
export async function recordDividend(userId: string, input: RecordDividendInput, db: DbClient): Promise<DividendResult> {
  if (!(input.amount > 0)) throw new LedgerError("The amount must be positive", 422, { code: "rebalance.invalid_amount" });
  const withholding = input.withholdingTax ?? 0;
  if (withholding < 0 || withholding > input.amount + 1e-9) {
    throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
  }
  assertFiiExempt(input.incomeType, withholding);
  return inTransaction(db, async (tx) => {
    await advisoryLock(tx, `holding:${input.holdingId}`);
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    const cash = await incomeCreditAccount(userId, input.cashAccountId ?? holding.accountId, tx);
    if (holding.account.entityId !== cash.entityId) {
      throw new LedgerError("The cash account and the holding have to belong to the same entity", 422, { code: "dividend.entity_mismatch" });
    }
    const currency = input.currency.toUpperCase();
    if (currency !== holding.currency.toUpperCase() && currency !== cash.currency.toUpperCase()) {
      throw new LedgerError("The amount's currency must be the holding's currency or the cash account's currency", 422, { code: "dividend.currency" });
    }
    const fx = await loadFx(userId, tx);
    const date = parseLocalDate(input.date);
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: holding.account.entityId }, select: { kind: true } });
    const passiveIncome = countsAsPassiveIncome({ entityKind: entity.kind, incomeType: input.incomeType });
    const origin = input.incomeType === "dividend" ? input.origin ?? defaultDividendOrigin(holding.assetClass, holding.currency) : null;
    const description = input.description?.trim() || dividendDescription(input.incomeType, holding);
    const net = input.amount - withholding;
    const totalAmount = round(convertOn(fx, input.amount, currency, holding.currency, date), 4);
    const taxWithheld = round(convertOn(fx, withholding, currency, holding.currency, date), 4);
    const cashAmount = round(convertOn(fx, net, currency, cash.currency, date), 4);
    const cashRate = cash.currency.toUpperCase() === fx.baseCurrency ? 1 : fx.rateOn(cash.currency, date);

    const existing = await tx.investmentOperation.findMany({
      where: { holdingId: holding.id, type: { in: ["dividend", "yield_payment"] }, incomeType: input.incomeType, date },
      include: { cashEntry: true },
    });
    const duplicate = existing.find(
      (op) => op.cashEntry && !op.cashEntry.deletedAt && op.cashEntry.accountId === cash.id && Math.abs(toNumber(op.cashEntry.amount) - cashAmount) <= EPS,
    );
    if (duplicate) {
      return resultOf(duplicate, true, null, fx, input.incomeType, origin, description, input.amount, withholding, currency, passiveIncome);
    }

    const existingIncome = await unlinkedIncome(tx, userId, { accountId: cash.id, net: cashAmount, date, ticker: holding.ticker });
    if (existingIncome) {
      throw new LedgerError(
        `Income ${existingIncome.id} already has this net amount. Use convert_income_to_dividend with that transactionId instead of crediting again`,
        422,
        { code: "dividend.unlinked_income", params: { transactionId: existingIncome.id } },
      );
    }

    const records: MutationRecordInput[] = [];
    const recorded = await recordOperation(
      userId,
      {
        holdingId: holding.id,
        type: incomeOperationType(input.incomeType),
        incomeType: input.incomeType,
        dividendOrigin: origin,
        totalAmount,
        taxWithheld,
        date: input.date,
        creditToAccountId: cash.id,
        description,
        cashCredit: { amount: cashAmount, exchangeRate: cashRate },
      },
      tx,
      { collect: records },
    );
    const batchId = await recordMutation(tx, userId, "create", description, records);
    const operation = await tx.investmentOperation.findUniqueOrThrow({ where: { id: recorded.operation.id }, include: { cashEntry: true } });
    return resultOf(operation, false, batchId, fx, input.incomeType, origin, description, input.amount, withholding, currency, passiveIncome);
  });
}

/**
 * Turns an income transaction into a dividend of `holding` without booking
 * the cash again: the existing entry becomes the operation's cash leg.
 * A transfer is rejected. Repeating the call returns that operation.
 * Income that matches a dividend of this holding (same base-currency
 * amount within 0.01, within 7 days) is attached when that operation has
 * no cash leg. When the operation already has one, the entry is extra
 * cash and the call fails instead of reporting the other leg as this one.
 */
export async function convertIncomeToDividend(userId: string, input: ConvertIncomeInput, db: DbClient): Promise<DividendResult> {
  const withholding = input.withholdingTax ?? 0;
  if (withholding < 0) throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
  assertFiiExempt(input.incomeType, withholding);
  return inTransaction(db, async (tx) => {
    await advisoryLock(tx, `entry:${input.transactionId}`);
    const entry = await tx.ledgerEntry.findFirst({ where: { id: input.transactionId, userId, deletedAt: null } });
    if (!entry) throw notFound("Transaction", "entry.not_found");
    if (entry.kind === "transfer" || entry.transferGroupId) {
      throw new LedgerError("A transfer is not income and cannot become a dividend", 422, { code: "dividend.not_income" });
    }
    if (entry.kind !== "income") {
      throw new LedgerError("Only an income transaction can become a dividend", 422, { code: "dividend.not_income" });
    }
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    // Entry lock first, then the holding, the same key recordDividend takes. updateDividend takes its operation lock, then this one.
    await advisoryLock(tx, `holding:${holding.id}`);
    const destination = await getOwnedAccount(userId, entry.accountId, tx);
    // The income is already booked. Linking it accepts the same destinations
    // as a new credit, including the brokerage's cash, and still refuses a card.
    // An archived account keeps the entry it already holds.
    assertIncomeAccountType(destination);
    const fx = await loadFx(userId, tx);
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: holding.account.entityId }, select: { kind: true } });
    const passiveIncome = countsAsPassiveIncome({ entityKind: entity.kind, incomeType: input.incomeType });
    const origin = input.incomeType === "dividend" ? input.origin ?? defaultDividendOrigin(holding.assetClass, holding.currency) : null;
    const description = entry.description || dividendDescription(input.incomeType, holding);
    const netNative = toNumber(entry.amount);
    if (!(netNative > 0)) throw new LedgerError("The amount must be positive", 422, { code: "rebalance.invalid_amount" });
    // The booked entry is the net. Gross is that net plus the tax withheld at source, so the tax cannot exceed the gross.
    const grossNative = netNative + withholding;
    if (withholding > grossNative + 1e-9) {
      throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
    }
    const netBase = toNumber(entry.amountBase);
    const entryRate = entry.currency.toUpperCase() === fx.baseCurrency ? 1 : fx.rateOn(entry.currency, entry.date);
    const grossBase = netBase + withholding * entryRate;

    const linked = await tx.investmentOperation.findFirst({ where: { cashEntryId: entry.id }, include: { cashEntry: true } });
    if (linked) {
      return resultOf(linked, true, null, fx, (linked.incomeType ?? input.incomeType) as IncomeType, linked.dividendOrigin, linked.cashEntry?.description ?? description, grossNative, withholding, entry.currency, passiveIncome);
    }

    const day = entry.date.getTime();
    const candidates = await tx.investmentOperation.findMany({
      where: { holdingId: holding.id, type: { in: ["dividend", "yield_payment"] } },
      include: { cashEntry: true },
    });
    const matched = candidates
      .filter((op) => Math.abs(op.date.getTime() - day) <= 7 * DAY_MS && sameBaseAmount(op, holding.currency, fx, netBase, grossBase))
      .sort((a, b) => Math.abs(a.date.getTime() - day) - Math.abs(b.date.getTime() - day))[0];
    if (matched) {
      if (liveCash(matched.cashEntry)) {
        throw new LedgerError(
          `This income matches dividend ${matched.id}, which already has a cash leg. Entry ${entry.id} is extra cash and was not linked`,
          422,
          { code: "dividend.extra_cash", params: { operationId: matched.id, transactionId: entry.id } },
        );
      }
      return attachLegacyLeg(tx, userId, matched, entry, holding, input, fx, origin, description, grossNative, withholding, passiveIncome);
    }

    const totalAmount = round(convertOn(fx, grossNative, entry.currency, holding.currency, entry.date), 4);
    const taxWithheld = round(convertOn(fx, withholding, entry.currency, holding.currency, entry.date), 4);
    if (taxWithheld > totalAmount + 1e-9) {
      throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
    }
    const records: MutationRecordInput[] = [];
    const op = await tx.investmentOperation.create({
      data: {
        holdingId: holding.id,
        type: incomeOperationType(input.incomeType),
        totalAmount,
        taxWithheld,
        incomeType: input.incomeType,
        dividendOrigin: origin,
        date: entry.date,
        cashEntryId: entry.id,
      },
    });
    records.push({ model: "InvestmentOperation", recordId: op.id, before: null, after: snapshot(op) });
    const metadata = { ...(entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {}), holdingId: holding.id, investmentOperationId: op.id };
    const updated = await tx.ledgerEntry.update({ where: { id: entry.id }, data: { metadata } });
    records.push({ model: "LedgerEntry", recordId: entry.id, before: snapshot(entry), after: snapshot(updated) });
    await recalculateHoldingDetailed(holding.id, tx);
    const batchId = await recordMutation(tx, userId, "create", description, records);
    const operation = await tx.investmentOperation.findUniqueOrThrow({ where: { id: op.id }, include: { cashEntry: true } });
    return resultOf(operation, false, batchId, fx, input.incomeType, origin, description, grossNative, withholding, entry.currency, passiveIncome);
  });
}

const INCOME_OPERATION_TYPES = ["dividend", "yield_payment"] as const;

/**
 * `id` is an operation id when this user owns that operation, otherwise the
 * cash entry id of one of their dividends or yields. An entry that exists
 * but is not that cash leg is a distinct error from a missing id.
 */
async function resolveDividendOperation(tx: DbClient, userId: string, id: string): Promise<{ operationId: string; via: "operation" | "entry" }> {
  const owned = await tx.investmentOperation.findFirst({
    where: { id, holding: { account: { userId } } },
    select: { id: true },
  });
  if (owned) return { operationId: owned.id, via: "operation" };

  const entry = await tx.ledgerEntry.findFirst({ where: { id, userId }, select: { id: true } });
  if (!entry) throw notFound("Investment operation", "operation.not_found");

  const linked = await tx.investmentOperation.findFirst({
    where: { cashEntryId: entry.id, holding: { account: { userId } }, type: { in: [...INCOME_OPERATION_TYPES] } },
    select: { id: true },
  });
  if (!linked) {
    throw new LedgerError(`Entry ${entry.id} is not linked to a dividend`, 422, {
      code: "dividend.entry_not_dividend",
      params: { transactionId: entry.id },
    });
  }
  return { operationId: linked.id, via: "entry" };
}

/**
 * Sets origin, income type and withholding on an income operation
 * (dividend or yield, including a cash leg booked as kind investment).
 * `operationId` may be that operation or its cash entry: an owned operation
 * is used first, otherwise the entry must be the cash leg of a dividend or
 * yield. Without `cashAccountId` the cash entry is not rewritten and no
 * entry is created: the net (gross − tax) stays the net already booked, so
 * a higher withholding raises the gross by the same amount. With
 * `cashAccountId` the cash leg moves to that checking, cash, or brokerage
 * account. Amounts, date, origin, income type and withholding are kept
 * unless those fields are also sent. The same values write nothing.
 * A buy, sale, transfer or expense is rejected. A closed holding is updated
 * the same way as an open one.
 *
 * `syncLocked` stops the next Pluggy sync from rewriting classification.
 * It does not freeze the cash account, so a move is allowed on a locked
 * operation and the move itself sets the lock. A credit card, another
 * user's account, an archived account, a different entity, or a provento
 * with no cash leg is rejected.
 */
export async function updateDividend(userId: string, input: UpdateDividendInput, db: DbClient): Promise<DividendResult> {
  return inTransaction(db, async (tx) => {
    const resolved = await resolveDividendOperation(tx, userId, input.operationId);
    // Same operation key whether the caller passed the operation or its cash entry,
    // then the holding key recordDividend takes up front and convert takes after its entry lock.
    await advisoryLock(tx, `dividend-update:${resolved.operationId}`);
    const located = await tx.investmentOperation.findFirst({
      where: { id: resolved.operationId, holding: { account: { userId } } },
      select: { holdingId: true },
    });
    if (!located) throw notFound("Investment operation", "operation.not_found");
    await advisoryLock(tx, `holding:${located.holdingId}`);
    const before = await tx.investmentOperation.findFirst({
      where: { id: resolved.operationId, holding: { account: { userId } } },
    });
    if (!before) throw notFound("Investment operation", "operation.not_found");
    if (resolved.via === "entry" && (before.cashEntryId !== input.operationId || !isIncomeOperation(before.type))) {
      throw new LedgerError(`Entry ${input.operationId} is not linked to a dividend`, 422, {
        code: "dividend.entry_not_dividend",
        params: { transactionId: input.operationId },
      });
    }
    if (!isIncomeOperation(before.type)) {
      throw new LedgerError(
        "Only an income operation (a dividend or a yield) can have its origin, income type or withholding changed",
        422,
        { code: "dividend.not_income_operation" },
      );
    }

    const holding = await getOwnedHolding(userId, before.holdingId, tx);
    const incomeType: IncomeType | null = input.incomeType !== undefined ? input.incomeType : before.incomeType;
    // A legacy dividend on an FII often has no income type stored. The exemption still applies.
    const exemptionType = incomeType ?? (holding.assetClass === "fii" ? "fii_income" : null);
    if (input.withholdingTax !== undefined && (!(input.withholdingTax >= 0) || input.withholdingTax > before.totalAmount + 1e-9)) {
      throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
    }
    const withholding = input.withholdingTax !== undefined ? input.withholdingTax : before.taxWithheld;
    if (exemptionType === "fii_income") assertFiiExempt("fii_income", withholding);

    const taxUnchanged = Math.abs(withholding - before.taxWithheld) <= 1e-9;
    const nextTax = taxUnchanged ? before.taxWithheld : round(withholding, 4);
    const net = round(before.totalAmount - before.taxWithheld, 4);
    const nextTotal = taxUnchanged ? before.totalAmount : round(net + nextTax, 4);
    if (nextTax < 0 || nextTax > nextTotal + 1e-9) {
      throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
    }

    const originApplies = incomeType === "dividend" || (incomeType == null && before.type === "dividend");
    if (input.origin !== undefined && !originApplies) {
      throw new LedgerError("origin applies only when the income type is a dividend", 422, { code: "dividend.origin_not_dividend" });
    }
    let origin: DividendOrigin | null = null;
    if (originApplies) {
      if (input.origin !== undefined) origin = input.origin;
      else if (input.incomeType === "dividend" && before.incomeType !== "dividend") origin = before.dividendOrigin ?? defaultDividendOrigin(holding.assetClass, holding.currency);
      else origin = before.dividendOrigin;
    }
    const nextType = incomeType ? incomeOperationType(incomeType) : before.type;
    const unchanged =
      nextType === before.type &&
      incomeType === before.incomeType &&
      origin === (before.dividendOrigin ?? null) &&
      nextTax === before.taxWithheld &&
      nextTotal === before.totalAmount;

    const cashEntry = before.cashEntryId ? await tx.ledgerEntry.findUnique({ where: { id: before.cashEntryId } }) : null;
    const [fx, entity] = await Promise.all([
      loadFx(userId, tx),
      tx.entity.findUniqueOrThrow({ where: { id: holding.account.entityId }, select: { kind: true } }),
    ]);
    const passiveIncome = countsAsPassiveIncome({ entityKind: entity.kind, incomeType });
    const description = cashEntry && !cashEntry.deletedAt ? cashEntry.description : dividendDescription(incomeType ?? "dividend", holding);
    const reportedType = (incomeType ?? "dividend") as IncomeType;

    const records: MutationRecordInput[] = [];
    let nextCash = cashEntry;
    let movedAccount = false;
    if (input.cashAccountId !== undefined) {
      const target = await incomeCreditAccount(userId, input.cashAccountId, tx);
      if (target.entityId !== holding.account.entityId) {
        throw new LedgerError("The cash account and the holding have to belong to the same entity", 422, { code: "dividend.entity_mismatch" });
      }
      const live = liveCash(cashEntry);
      if (!live) throw new LedgerError("This provento has no cash leg to move", 422, { code: "dividend.no_cash_leg" });
      if (target.id !== live.accountId) {
        movedAccount = true;
        nextCash = await tx.ledgerEntry.update({ where: { id: live.id }, data: cashLegMove(live, target, fx) });
        records.push({ model: "LedgerEntry", recordId: live.id, before: snapshot(live), after: snapshot(nextCash) });
      }
    }

    if (unchanged && !movedAccount) {
      return resultOf({ ...before, cashEntry }, true, null, fx, reportedType, origin, description, before.totalAmount, before.taxWithheld, holding.currency, passiveIncome);
    }

    const updated = await tx.investmentOperation.update({
      where: { id: before.id },
      data: {
        type: nextType,
        incomeType,
        dividendOrigin: origin,
        taxWithheld: nextTax,
        totalAmount: nextTotal,
        // The move is a person's edit of the cash leg. The lock keeps the next
        // Pluggy sync from writing over it. Classification-only edits stay unlocked.
        ...(movedAccount ? { syncLocked: true } : {}),
      },
    });
    records.push({ model: "InvestmentOperation", recordId: before.id, before: snapshot(before), after: snapshot(updated) });
    const batchId = await recordMutation(tx, userId, "update", description, records);
    return resultOf({ ...updated, cashEntry: nextCash }, false, batchId, fx, reportedType, updated.dividendOrigin, description, updated.totalAmount, updated.taxWithheld, holding.currency, passiveIncome);
  });
}

function assertFiiExempt(incomeType: PassiveIncomeType, withholding: number) {
  if (incomeType === "fii_income" && withholding > 0) {
    throw new LedgerError("FII income is tax-exempt, so withholdingTax has to be zero", 422, { code: "dividend.fii_withholding" });
  }
}

type CashLeg = Pick<LedgerEntry, "amountBase" | "deletedAt">;

function liveCash<T extends { deletedAt: Date | null }>(entry: T | null | undefined): T | null {
  return entry && !entry.deletedAt ? entry : null;
}

/** Net and gross compared in the base currency. A holding-currency total is never compared with an entry-currency amount. */
function sameBaseAmount(
  op: { totalAmount: number; taxWithheld: number; date: Date; cashEntry: CashLeg | null },
  holdingCurrency: string,
  fx: FxContext,
  netBase: number,
  grossBase: number,
) {
  const opNet = op.totalAmount - op.taxWithheld;
  const holdingRate = fx.rateOn(holdingCurrency, op.date);
  const leg = liveCash(op.cashEntry);
  const opNetBase = leg ? toNumber(leg.amountBase) : opNet * holdingRate;
  const opGrossBase = Math.abs(opNet) > 1e-9 ? opNetBase * (op.totalAmount / opNet) : op.totalAmount * holdingRate;
  return Math.abs(opNetBase - netBase) <= MATCH_EPS || Math.abs(opGrossBase - grossBase) <= MATCH_EPS;
}

async function unlinkedIncome(
  tx: DbClient,
  userId: string,
  input: { accountId: string; net: number; date: Date; ticker: string | null },
) {
  const rows = await tx.ledgerEntry.findMany({
    where: {
      userId,
      accountId: input.accountId,
      deletedAt: null,
      kind: "income",
      transferGroupId: null,
      amount: { gt: 0 },
      date: { gte: new Date(input.date.getTime() - 3 * DAY_MS), lte: new Date(input.date.getTime() + 3 * DAY_MS) },
    },
    include: { category: { select: { name: true, systemKey: true } } },
  });
  const ticker = input.ticker?.trim().toLowerCase() ?? "";
  for (const row of rows) {
    if (Math.abs(row.date.getTime() - input.date.getTime()) > 3 * DAY_MS) continue;
    if (Math.abs(toNumber(row.amount) - input.net) > EPS) continue;
    const category = row.category?.name.trim().toLowerCase();
    const proventos = category === "proventos" || row.category?.systemKey === "dividends";
    const described = ticker.length >= 2 && row.description.toLowerCase().includes(ticker);
    if (!proventos && !described) continue;
    const taken = await tx.investmentOperation.findFirst({ where: { cashEntryId: row.id }, select: { id: true } });
    if (!taken) return row;
  }
  return null;
}

async function attachLegacyLeg(
  tx: DbClient,
  userId: string,
  matched: InvestmentOperation,
  entry: LedgerEntry,
  holding: { id: string; currency: string },
  input: ConvertIncomeInput,
  fx: FxContext,
  origin: DividendOrigin | null,
  description: string,
  grossNative: number,
  withholding: number,
  passiveIncome: boolean,
) {
  const totalAmount = round(convertOn(fx, grossNative, entry.currency, holding.currency, entry.date), 4);
  const taxWithheld = round(convertOn(fx, withholding, entry.currency, holding.currency, entry.date), 4);
  if (taxWithheld > totalAmount + 1e-9) {
    throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
  }
  const records: MutationRecordInput[] = [];
  const before = await tx.investmentOperation.findUniqueOrThrow({ where: { id: matched.id } });
  const op = await tx.investmentOperation.update({
    where: { id: matched.id },
    data: {
      cashEntryId: entry.id,
      type: incomeOperationType(input.incomeType),
      totalAmount,
      taxWithheld,
      incomeType: input.incomeType,
      dividendOrigin: origin,
    },
  });
  records.push({ model: "InvestmentOperation", recordId: op.id, before: snapshot(before), after: snapshot(op) });
  const metadata = {
    ...(entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) ? entry.metadata : {}),
    holdingId: holding.id,
    investmentOperationId: op.id,
  };
  const updated = await tx.ledgerEntry.update({ where: { id: entry.id }, data: { metadata } });
  records.push({ model: "LedgerEntry", recordId: entry.id, before: snapshot(entry), after: snapshot(updated) });
  await recalculateHoldingDetailed(holding.id, tx);
  const batchId = await recordMutation(tx, userId, "update", description, records);
  const operation = await tx.investmentOperation.findUniqueOrThrow({ where: { id: op.id }, include: { cashEntry: true } });
  return resultOf(operation, false, batchId, fx, input.incomeType, origin, description, grossNative, withholding, entry.currency, passiveIncome);
}

/**
 * Moves a cash leg onto `target` without changing the provento's amounts.
 * Same currency: only the account changes, so both balances move by the
 * stored amount. Another currency keeps the base-currency value and
 * re-expresses the native amount at the rate of the entry's date.
 */
function cashLegMove(entry: LedgerEntry, target: { id: string; entityId: string; currency: string }, fx: FxContext) {
  const sameCurrency = target.currency.toUpperCase() === entry.currency.toUpperCase();
  if (sameCurrency) return { accountId: target.id, entityId: target.entityId };
  const amountBase = toNumber(entry.amountBase);
  const destRate = target.currency.toUpperCase() === fx.baseCurrency ? 1 : fx.rateOn(target.currency, entry.date);
  const amount = destRate > 0 ? round(amountBase / destRate, 4) : toNumber(entry.amount);
  const rate = destRate > 0 ? destRate : toNumber(entry.exchangeRate);
  return {
    accountId: target.id,
    entityId: target.entityId,
    currency: target.currency,
    exchangeRate: rate,
    amount,
    amountBase: round(amount * rate, 4),
  };
}

function convertOn(fx: FxContext, amount: number, from: string, to: string, date: Date): number {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  const toRate = fx.rateOn(to, date);
  if (!(toRate > 0)) return amount * fx.rateOn(from, date);
  return (amount * fx.rateOn(from, date)) / toRate;
}

function resultOf(
  operation: {
    id: string;
    holdingId: string;
    cashEntryId: string | null;
    incomeType: IncomeType | null;
    dividendOrigin: DividendOrigin | null;
    date: Date;
    cashEntry?: { accountId?: string; amountBase: { toString(): string } | number; description: string; deletedAt: Date | null } | null;
  },
  duplicate: boolean,
  batchId: string | null,
  fx: FxContext,
  incomeType: IncomeType,
  origin: DividendOrigin | null,
  description: string,
  gross: number,
  withholding: number,
  currency: string,
  passiveIncome: boolean,
): DividendResult {
  const leg = operation.cashEntry && !operation.cashEntry.deletedAt ? operation.cashEntry : null;
  const amountBase = leg ? toNumber(leg.amountBase as never) : round((gross - withholding) * (currency.toUpperCase() === fx.baseCurrency ? 1 : fx.rateOn(currency, operation.date)), 4);
  return {
    duplicate,
    operationId: operation.id,
    cashEntryId: operation.cashEntryId,
    holdingId: operation.holdingId,
    incomeType: operation.incomeType ?? incomeType,
    origin: operation.dividendOrigin ?? origin,
    gross: round(gross, 4),
    withholdingTax: round(withholding, 4),
    net: round(gross - withholding, 4),
    currency: currency.toUpperCase(),
    amountBase: round(amountBase, 4),
    date: formatDateOnly(operation.date),
    description: leg?.description ?? description,
    cashAccountId: leg?.accountId ?? null,
    passiveIncome,
    batchId,
  };
}
