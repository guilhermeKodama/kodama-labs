import type { IncomeType } from "@/generated/prisma";
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
import { getOwnedHolding, incomeOperationType, recordOperation } from "./portfolio";

const EPS = 0.02;

export interface RecordDividendInput {
  holdingId: string;
  cashAccountId: string;
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
  /** False for fixed-income interest inside a business entity: it stays out of personal passive income. */
  passiveIncome: boolean;
  batchId: string | null;
}

/**
 * Books a provento: an income operation on the holding and one cash credit
 * on the checking or cash account, the same shape as the ledger v2 cash
 * legs (kind investment, linked by cashEntryId). Gross is `amount`, the
 * cash credited is the net, and the leg stores the rate of `date`.
 * The same holding, day, income type, cash account and net amount returns
 * the existing operation.
 */
export async function recordDividend(userId: string, input: RecordDividendInput, db: DbClient): Promise<DividendResult> {
  if (!(input.amount > 0)) throw new LedgerError("The amount must be positive", 422, { code: "rebalance.invalid_amount" });
  const withholding = input.withholdingTax ?? 0;
  if (withholding < 0 || withholding > input.amount + 1e-9) {
    throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
  }
  return inTransaction(db, async (tx) => {
    await advisoryLock(tx, `holding:${input.holdingId}`);
    const holding = await getOwnedHolding(userId, input.holdingId, tx);
    const cash = await cashAccount(userId, input.cashAccountId, tx);
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
 * A transfer is rejected. Repeating the call, or pointing at income that
 * already matches a dividend of this holding, returns that operation.
 */
export async function convertIncomeToDividend(userId: string, input: ConvertIncomeInput, db: DbClient): Promise<DividendResult> {
  const withholding = input.withholdingTax ?? 0;
  if (withholding < 0) throw new LedgerError("The tax withheld cannot exceed the gross amount", 422, { code: "operation.tax_exceeds_amount" });
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
    const cash = await getOwnedAccount(userId, entry.accountId, tx);
    const fx = await loadFx(userId, tx);
    const entity = await tx.entity.findUniqueOrThrow({ where: { id: holding.account.entityId }, select: { kind: true } });
    const passiveIncome = countsAsPassiveIncome({ entityKind: entity.kind, incomeType: input.incomeType });
    const origin = input.incomeType === "dividend" ? input.origin ?? defaultDividendOrigin(holding.assetClass, holding.currency) : null;
    const description = entry.description || dividendDescription(input.incomeType, holding);
    const netNative = toNumber(entry.amount);
    if (!(netNative > 0)) throw new LedgerError("The amount must be positive", 422, { code: "rebalance.invalid_amount" });
    const grossNative = netNative + withholding;
    const netBase = toNumber(entry.amountBase);

    const linked = await tx.investmentOperation.findFirst({ where: { cashEntryId: entry.id }, include: { cashEntry: true } });
    if (linked) {
      return resultOf(linked, true, null, fx, (linked.incomeType ?? input.incomeType) as IncomeType, linked.dividendOrigin, linked.cashEntry?.description ?? description, grossNative, withholding, entry.currency, passiveIncome);
    }

    const day = entry.date.getTime();
    const candidates = await tx.investmentOperation.findMany({
      where: { holdingId: holding.id, type: { in: ["dividend", "yield_payment"] } },
      include: { cashEntry: true },
    });
    const matched = candidates.find((op) => {
      if (Math.abs(op.date.getTime() - day) > 7 * 86_400_000) return false;
      const opNet = op.totalAmount - op.taxWithheld;
      const opBase = op.cashEntry && !op.cashEntry.deletedAt ? toNumber(op.cashEntry.amountBase) : opNet * fx.rateOn(holding.currency, op.date);
      return Math.abs(opBase - netBase) <= 0.01 || Math.abs(op.totalAmount - grossNative) <= 0.01 || Math.abs(opNet - netNative) <= 0.01;
    });
    if (matched) {
      return resultOf(matched, true, null, fx, (matched.incomeType ?? input.incomeType) as IncomeType, matched.dividendOrigin, matched.cashEntry?.description ?? description, grossNative, withholding, entry.currency, passiveIncome);
    }

    const totalAmount = round(convertOn(fx, grossNative, entry.currency, holding.currency, entry.date), 4);
    const taxWithheld = round(convertOn(fx, withholding, entry.currency, holding.currency, entry.date), 4);
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

async function cashAccount(userId: string, accountId: string, db: DbClient) {
  const account = await getOwnedAccount(userId, accountId, db);
  if (account.type !== "checking" && account.type !== "cash") {
    throw new LedgerError("Income can only be credited to a checking or cash account", 422, { code: "operation.credit_account_invalid" });
  }
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
  return account;
}

function convertOn(fx: FxContext, amount: number, from: string, to: string, date: Date): number {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  const toRate = fx.rateOn(to, date);
  if (!(toRate > 0)) return amount * fx.rateOn(from, date);
  return (amount * fx.rateOn(from, date)) / toRate;
}

function resultOf(
  operation: { id: string; holdingId: string; cashEntryId: string | null; incomeType: IncomeType | null; dividendOrigin: DividendOrigin | null; date: Date; cashEntry?: { amountBase: { toString(): string } | number; description: string; deletedAt: Date | null } | null },
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
    passiveIncome,
    batchId,
  };
}
