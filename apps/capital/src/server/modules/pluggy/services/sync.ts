import type { AssetClass, DividendOrigin, EntityType, FixedIncomeSubType, Prisma } from "@/generated/prisma";
import type { PassiveIncomeType } from "@/lib/invest/passive-income";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import type { DbClient } from "@capital/server/lib/prisma";
import { recalculateHolding } from "@capital/server/modules/investments/lib/holding-position";
import { convertIncomeToDividend, recordDividend } from "@capital/server/modules/investments/services/dividends";
import { createHolding, incomeOperationType, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";
import { classifyInvestment, needsReview, type Classification, type IncomeGuesser } from "../lib/classify";
import { consentState, importSince, dayOf } from "../lib/consent";
import { isPluggyConfigured } from "../lib/config";
import { safeSyncError } from "../lib/client";
import { accountLabel, last4Digits, redactForModel } from "../lib/mask";
import type { PluggyAccount, PluggyClient, PluggyInvestment, PluggyInvestmentTransaction } from "../lib/types";

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_LOCK_MS = 15 * 60 * 1000;
const QTY_EPS = 1e-4;
const AMOUNT_EPS = 0.01;

export interface SyncDeps {
  db: DbClient;
  client: PluggyClient;
  now: Date;
  guesser?: IncomeGuesser | null;
  enabled?: boolean;
}

export interface ItemSyncStats {
  created: number;
  linked: number;
  skipped: number;
  conflicts: number;
  unmapped: number;
}

export interface SyncReport {
  status: "disabled" | "idle" | "ok";
  items: { id: string; status: string; error?: string; stats?: ItemSyncStats; runId?: string }[];
}

export interface StartedSync {
  status: "disabled" | "idle" | "started";
  runs: { id: string; itemId: string; status: "running" | "skipped" }[];
}

interface ItemRow {
  id: string;
  userId: string;
  itemId: string;
  entityKind: EntityType;
  lastSuccessAt: Date | null;
  syncCutoff: Date | null;
  incomeCategoryId: string | null;
  brokerageAccountId: string | null;
}

interface BankRow {
  pluggyId: string;
  capitalAccountId: string;
  accountType: "checking" | "cash" | "credit_card" | "brokerage";
  signed: number;
  amount: number;
  date: string;
  when: Date;
  description: string;
  currency?: string;
}

interface MappedAccount {
  id: string;
  type: "checking" | "cash" | "credit_card" | "brokerage";
}

const CAIXINHA = /caixinha|aplica[cç][aã]o|resgate/i;
const FATURA = /fatura|pagamento de cart/i;

/** Sync every item, or one, and wait. Missing credentials return disabled and write nothing. */
export async function syncPluggy(userId: string, deps: SyncDeps, opts: { trigger: "cron" | "manual"; itemRowId?: string }): Promise<SyncReport> {
  const enabled = deps.enabled ?? isPluggyConfigured();
  if (!enabled) return { status: "disabled", items: [] };
  const items = await loadItems(userId, deps.db, opts.itemRowId);
  if (items.length === 0) return { status: "idle", items: [] };
  const results: SyncReport["items"] = [];
  for (const item of items) {
    const run = await openRun(item, deps, opts.trigger);
    if (run.status === "skipped") {
      results.push({ id: item.id, status: "busy", runId: run.id });
      continue;
    }
    results.push(await execute(item, deps, run.id));
  }
  return { status: "ok", items: results };
}

/**
 * Claim each item, record the run, and return its id without waiting.
 * The page polls the overview while `syncing` is set. Cron uses syncPluggy.
 */
export async function startPluggySync(userId: string, deps: SyncDeps, opts: { itemRowId?: string } = {}): Promise<StartedSync> {
  const enabled = deps.enabled ?? isPluggyConfigured();
  if (!enabled) return { status: "disabled", runs: [] };
  const items = await loadItems(userId, deps.db, opts.itemRowId);
  if (items.length === 0) return { status: "idle", runs: [] };
  const runs: StartedSync["runs"] = [];
  for (const item of items) {
    const run = await openRun(item, deps, "manual");
    runs.push({ id: run.id, itemId: item.id, status: run.status });
    if (run.status === "running") void execute(item, deps, run.id);
  }
  return { status: "started", runs };
}

async function loadItems(userId: string, db: DbClient, itemRowId?: string): Promise<ItemRow[]> {
  return db.pluggyItem.findMany({
    where: { userId, ...(itemRowId ? { id: itemRowId } : {}) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      itemId: true,
      entityKind: true,
      lastSuccessAt: true,
      syncCutoff: true,
      incomeCategoryId: true,
      brokerageAccountId: true,
    },
  });
}

async function openRun(item: ItemRow, deps: SyncDeps, trigger: "cron" | "manual"): Promise<{ id: string; status: "running" | "skipped" }> {
  const claimed = await deps.db.pluggyItem.updateMany({
    where: { id: item.id, OR: [{ syncingAt: null }, { syncingAt: { lt: new Date(deps.now.getTime() - STALE_LOCK_MS) } }] },
    data: { syncingAt: deps.now },
  });
  if (claimed.count === 0) {
    const run = await deps.db.pluggySyncRun.create({
      data: { itemRowId: item.id, trigger, status: "skipped", finishedAt: deps.now, error: "busy" },
    });
    return { id: run.id, status: "skipped" };
  }
  const run = await deps.db.pluggySyncRun.create({ data: { itemRowId: item.id, trigger, status: "running" } });
  return { id: run.id, status: "running" };
}

async function execute(item: ItemRow, deps: SyncDeps, runId: string): Promise<SyncReport["items"][number]> {
  const { db, now } = deps;
  const stats: ItemSyncStats = { created: 0, linked: 0, skipped: 0, conflicts: 0, unmapped: 0 };
  try {
    const remote = await deps.client.getItem(item.itemId);
    const consent = consentState(remote, now);
    const consentExpiresAt = remote.consentExpiresAt ? new Date(remote.consentExpiresAt) : null;
    if (consent === "expired") {
      await finish(db, item.id, runId, "expired", stats, consentExpiresAt, now, null);
      return { id: item.id, status: "expired", stats, runId };
    }
    const since = importSince(item.lastSuccessAt, item.syncCutoff, now);
    await discoverAccounts(item, await deps.client.getAccounts(item.itemId), db);
    await syncInvestments(item, deps, since, stats);
    await syncAccounts(item, deps, since, stats);
    const status = consent === "expiring" ? "expiring" : "ok";
    await finish(db, item.id, runId, status, stats, consentExpiresAt, now, null);
    return { id: item.id, status, stats, runId };
  } catch (error) {
    const message = safeSyncError(error);
    await finish(db, item.id, runId, "error", stats, null, now, message);
    return { id: item.id, status: "error", error: message, stats, runId };
  }
}

async function finish(
  db: DbClient,
  itemId: string,
  runId: string,
  status: "ok" | "expiring" | "expired" | "error",
  stats: ItemSyncStats,
  consentExpiresAt: Date | null,
  now: Date,
  error: string | null,
) {
  await db.pluggySyncRun.update({
    where: { id: runId },
    data: { status: status === "expiring" ? "ok" : status, finishedAt: now, stats: stats as unknown as Prisma.InputJsonValue, error },
  });
  await db.pluggyItem.update({
    where: { id: itemId },
    data: {
      status,
      syncingAt: null,
      lastSyncAt: now,
      lastError: error,
      ...(consentExpiresAt ? { consentExpiresAt } : {}),
      ...(status === "ok" || status === "expiring" ? { lastSuccessAt: now } : {}),
    },
  });
}

async function discoverAccounts(item: ItemRow, accounts: PluggyAccount[], db: DbClient) {
  for (const account of accounts) {
    const name = accountLabel(account.marketingName || account.name, account.number);
    const numberLast4 = last4Digits(account.number);
    const where = { itemRowId_pluggyAccountId: { itemRowId: item.id, pluggyAccountId: account.id } };
    const existing = await db.pluggyAccountLink.findUnique({ where });
    if (existing) {
      await db.pluggyAccountLink.update({
        where: { id: existing.id },
        data: { name, type: account.type, subtype: account.subtype ?? null, currency: account.currencyCode ?? null, numberLast4 },
      });
      continue;
    }
    let capitalAccountId: string | null = null;
    if (numberLast4) {
      const prior = await db.pluggyAccountLink.findFirst({
        where: { itemRowId: item.id, type: account.type, numberLast4, capitalAccountId: { not: null } },
        select: { capitalAccountId: true },
      });
      capitalAccountId = prior?.capitalAccountId ?? null;
    }
    await db.pluggyAccountLink.create({
      data: {
        itemRowId: item.id,
        pluggyAccountId: account.id,
        name,
        type: account.type,
        subtype: account.subtype ?? null,
        currency: account.currencyCode ?? null,
        numberLast4,
        capitalAccountId,
      },
    });
  }
}

async function brokerageId(item: ItemRow, db: DbClient): Promise<string | null> {
  if (item.brokerageAccountId) {
    const account = await db.account.findFirst({ where: { id: item.brokerageAccountId, userId: item.userId, archivedAt: null }, include: { entity: true } });
    if (account?.type === "brokerage" && account.entity.kind === item.entityKind) return account.id;
  }
  const link = await db.pluggyAccountLink.findFirst({
    where: { itemRowId: item.id, capitalAccount: { type: "brokerage", archivedAt: null, entity: { kind: item.entityKind } } },
    select: { capitalAccountId: true },
  });
  return link?.capitalAccountId ?? null;
}

async function creditAccountId(item: ItemRow, db: DbClient): Promise<string | null> {
  const link = await db.pluggyAccountLink.findFirst({
    where: {
      itemRowId: item.id,
      capitalAccount: { type: { in: ["checking", "cash"] }, archivedAt: null, entity: { kind: item.entityKind } },
    },
    select: { capitalAccountId: true },
  });
  return link?.capitalAccountId ?? null;
}

async function syncInvestments(item: ItemRow, deps: SyncDeps, since: string, stats: ItemSyncStats) {
  const broker = await brokerageId(item, deps.db);
  if (!broker) {
    stats.unmapped += 1;
    return;
  }
  const creditTo = await creditAccountId(item, deps.db);
  const investments = await deps.client.getInvestments(item.itemId);
  for (const investment of investments) {
    const holdingId = await ensureHolding(item, investment, broker, deps.db);
    await comparePosition(item, investment, holdingId, deps.db);
    const txs = await deps.client.getInvestmentTransactions(investment.id, since);
    const ordered = [...txs].sort((a, b) => (a.tradeDate ?? a.date).localeCompare(b.tradeDate ?? b.date));
    for (const tx of ordered) {
      await bookInvestmentTx(item, investment, holdingId, tx, creditTo, deps, stats);
    }
  }
}

async function ensureHolding(item: ItemRow, investment: PluggyInvestment, broker: string, db: DbClient): Promise<string> {
  const existing = await db.pluggyInvestmentLink.findUnique({ where: { userId_pluggyInvestmentId: { userId: item.userId, pluggyInvestmentId: investment.id } } });
  if (existing) return existing.holdingId;
  const ticker = (investment.code ?? "").trim().toUpperCase() || null;
  if (ticker) {
    const byTicker = await db.investmentHolding.findFirst({ where: { accountId: broker, ticker, isActive: true } });
    if (byTicker) {
      await db.pluggyInvestmentLink.create({ data: { userId: item.userId, pluggyInvestmentId: investment.id, holdingId: byTicker.id } });
      return byTicker.id;
    }
  }
  const assetClass = assetClassOf(investment);
  const created = await createHolding(
    item.userId,
    {
      accountId: broker,
      assetClass,
      subType: assetClass === "fixed_income" ? fixedSubtype(investment.subtype, investment.name) : null,
      ticker,
      name: (investment.name ?? ticker ?? "Investimento").slice(0, 200),
      currency: investment.currencyCode ?? undefined,
      currentPrice: investment.value ?? null,
    },
    db,
  );
  await db.pluggyInvestmentLink.create({ data: { userId: item.userId, pluggyInvestmentId: investment.id, holdingId: created.id } });
  return created.id;
}

async function comparePosition(item: ItemRow, investment: PluggyInvestment, holdingId: string, db: DbClient) {
  if (investment.quantity == null) return;
  const holding = await db.investmentHolding.findUnique({ where: { id: holdingId }, select: { currentQuantity: true, ticker: true } });
  if (!holding) return;
  if (Math.abs(holding.currentQuantity - investment.quantity) <= QTY_EPS) return;
  await openReview(db, item, "position", {
    holdingId,
    ticker: holding.ticker,
    pluggyQuantity: investment.quantity,
    capitalQuantity: holding.currentQuantity,
  });
}

async function bookInvestmentTx(
  item: ItemRow,
  investment: PluggyInvestment,
  holdingId: string,
  tx: PluggyInvestmentTransaction,
  creditTo: string | null,
  deps: SyncDeps,
  stats: ItemSyncStats,
) {
  if (await alreadyBooked(deps.db, item.userId, tx.id)) {
    stats.skipped += 1;
    return;
  }
  const date = dayOf(tx.tradeDate ?? tx.date);
  if (beforeCutoff(item.syncCutoff, date)) {
    stats.skipped += 1;
    return;
  }
  try {
    const classification = await classifyInvestment(
      {
        type: tx.type,
        amount: tx.amount,
        netAmount: tx.netAmount,
        incomeTax: tx.expenses?.incomeTax,
        description: tx.description,
        ticker: investment.code,
        assetType: investment.type,
        assetSubtype: investment.subtype,
        assetName: investment.name,
      },
      deps.guesser ?? null,
    );
    if (classification.event === "skip") {
      stats.skipped += 1;
      await remember(deps.db, item.userId, tx.id, null, null, "linked");
      return;
    }
    const opType = classification.event === "amortization"
      ? "adjustment"
      : classification.event === "income"
        ? incomeOperationType(classification.incomeType)
        : classification.event;
    const matches = await fuzzyOperations(deps.db, holdingId, opType, classification.gross, parseLocalDate(date));
    if (matches.length > 1) {
      stats.conflicts += 1;
      await openReview(deps.db, item, "conflict", {
        pluggyId: tx.id,
        holdingId,
        ticker: investment.code ?? null,
        description: clip(tx.description),
        amount: classification.gross,
        date,
        candidateIds: matches.map((row) => row.id),
        reason: "multiple_matches",
      });
      return;
    }
    if (matches.length === 1) {
      await remember(deps.db, item.userId, tx.id, null, matches[0]!.id, "linked");
      stats.linked += 1;
      return;
    }
    if (classification.event === "income" && needsReview(classification)) {
      const holding = await deps.db.investmentHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { accountId: true, currency: true } });
      stats.conflicts += 1;
      await openReview(deps.db, item, "low_confidence", {
        event: "income",
        pluggyId: tx.id,
        holdingId,
        incomeType: classification.incomeType,
        origin: classification.origin,
        gross: classification.gross,
        taxWithheld: Math.min(classification.taxWithheld, classification.gross),
        date,
        description: clip(tx.description ?? investment.name),
        currency: holding.currency,
        confidence: classification.confidence,
        ticker: investment.code ?? null,
        cashAccountId: holding.accountId,
      });
      return;
    }
    if (classification.event === "amortization") {
      await bookAmortization(item, holdingId, tx.id, classification.gross, date, investment, creditTo, deps.db);
    } else if (classification.event === "buy" || classification.event === "sell") {
      await bookTrade(item, holdingId, tx, classification.event, classification.gross, date, deps.db);
    } else if (classification.event === "income") {
      await bookIncome(item, holdingId, tx, classification, date, deps.db);
    }
    stats.created += 1;
  } catch (error) {
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.id,
      ticker: investment.code ?? null,
      description: clip(tx.description),
      amount: tx.amount,
      date,
      reason: safeSyncError(error),
    });
  }
}

async function fuzzyOperations(db: DbClient, holdingId: string, type: "buy" | "sell" | "dividend" | "yield_payment" | "adjustment" | "split" | "deposit" | "withdrawal", gross: number, when: Date) {
  const rows = await db.investmentOperation.findMany({
    where: {
      holdingId,
      type,
      date: { gte: new Date(when.getTime() - WINDOW_MS), lte: new Date(when.getTime() + WINDOW_MS) },
    },
    select: { id: true, totalAmount: true },
  });
  return rows.filter((row) => Math.abs(Math.abs(toNumber(row.totalAmount)) - gross) <= AMOUNT_EPS);
}

async function bookIncome(
  item: ItemRow,
  holdingId: string,
  tx: PluggyInvestmentTransaction,
  classification: Extract<Classification, { event: "income" }>,
  date: string,
  db: DbClient,
) {
  const holding = await db.investmentHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { accountId: true, currency: true } });
  // Proventos land in the brokerage cash the holding belongs to (saldo em conta),
  // the same account buys and sells already move. A mapped checking account is
  // the bank feed, not where an FII rendimento is paid.
  const cashAccountId = holding.accountId;
  const description = clip(tx.description);
  await inTransaction(db, async (client) => {
    const booked = await creditDividend(item.userId, client, {
      holdingId,
      cashAccountId,
      amount: classification.gross,
      date,
      currency: holding.currency,
      incomeType: classification.incomeType,
      withholdingTax: Math.min(classification.taxWithheld, classification.gross),
      origin: classification.origin ?? undefined,
      description: description || undefined,
    });
    const current = await client.investmentOperation.findUniqueOrThrow({ where: { id: booked.operationId }, select: { externalId: true, syncLocked: true } });
    if (!current.syncLocked) {
      await client.investmentOperation.update({
        where: { id: booked.operationId },
        data: {
          classificationSource: classification.source,
          classificationConfidence: classification.confidence,
          ...(current.externalId ? {} : { externalId: tx.id }),
          ...(classification.origin ? { dividendOrigin: classification.origin } : {}),
        },
      });
      if (item.entityKind === "business" && classification.incomeType === "fixed_income_interest" && item.incomeCategoryId && booked.cashEntryId) {
        await client.ledgerEntry.update({ where: { id: booked.cashEntryId }, data: { categoryId: item.incomeCategoryId } });
      }
    }
    await client.pluggyExternalRef.create({
      data: { userId: item.userId, pluggyId: tx.id, ledgerEntryId: booked.cashEntryId, operationId: booked.operationId, matchKind: "created" },
    });
  });
}

async function creditDividend(
  userId: string,
  db: DbClient,
  input: {
    holdingId: string;
    cashAccountId: string;
    amount: number;
    date: string;
    currency: string;
    incomeType: PassiveIncomeType;
    withholdingTax: number;
    origin?: DividendOrigin;
    description?: string;
  },
) {
  try {
    return await recordDividend(userId, input, db);
  } catch (error) {
    if (!(error instanceof LedgerError) || error.code !== "dividend.unlinked_income") throw error;
    const transactionId = error.params?.transactionId;
    if (typeof transactionId !== "string") throw error;
    return convertIncomeToDividend(
      userId,
      { transactionId, holdingId: input.holdingId, incomeType: input.incomeType, withholdingTax: input.withholdingTax, origin: input.origin },
      db,
    );
  }
}

async function bookTrade(item: ItemRow, holdingId: string, tx: PluggyInvestmentTransaction, type: "buy" | "sell", gross: number, date: string, db: DbClient) {
  await inTransaction(db, async (client) => {
    const booked = await recordOperation(
      item.userId,
      {
        holdingId,
        type,
        quantity: tx.quantity ?? null,
        pricePerUnit: tx.value ?? null,
        totalAmount: gross,
        fees: tx.expenses?.brokerageFee ?? 0,
        date,
        externalId: tx.id,
        notes: clip(tx.description) || null,
      },
      client,
    );
    await client.pluggyExternalRef.create({
      data: { userId: item.userId, pluggyId: tx.id, operationId: booked.operation.id, matchKind: "created" },
    });
  });
}

/**
 * Amortization returns principal. It is not income.
 * Cost basis falls because replayPosition does cost = max(0, cost + totalAmount)
 * and totalAmount is −gross. The cash leg is a positive investment-kind entry,
 * so it never enters Renda Passiva (that chart requires kind income and a
 * provento category, and yield or dividend operations). recordOperation cannot
 * take a negative totalAmount: its tax check treats 0 as greater than a
 * negative gross. The steps below write the adjustment, recalculate the
 * holding, credit the cash as investment, and remember the Pluggy id.
 */
async function bookAmortization(
  item: ItemRow,
  holdingId: string,
  pluggyId: string,
  gross: number,
  date: string,
  investment: PluggyInvestment,
  creditTo: string | null,
  db: DbClient,
) {
  const holding = await db.investmentHolding.findUniqueOrThrow({ where: { id: holdingId }, select: { accountId: true, ticker: true, name: true } });
  const label = clip(`Amortização ${holding.ticker ?? investment.name ?? ""}`) || "Amortização";
  await inTransaction(db, async (tx) => {
    const operation = await tx.investmentOperation.create({
      data: {
        holdingId,
        type: "adjustment",
        totalAmount: -gross,
        date: parseLocalDate(date),
        externalId: pluggyId,
        notes: label,
      },
    });
    await recalculateHolding(holdingId, tx);
    const cash = await createEntry(
      item.userId,
      {
        kind: "income",
        accountId: creditTo ?? holding.accountId,
        amount: -gross,
        date,
        description: label,
      },
      tx,
      { kind: "investment", skipRules: true, metadata: { source: "pluggy", event: "amortization" } },
    );
    await tx.pluggyExternalRef.create({
      data: { userId: item.userId, pluggyId, ledgerEntryId: cash.entryIds[0] ?? null, operationId: operation.id, matchKind: "created" },
    });
  });
}

async function syncAccounts(item: ItemRow, deps: SyncDeps, since: string, stats: ItemSyncStats) {
  const links = await deps.db.pluggyAccountLink.findMany({
    where: { itemRowId: item.id },
    include: { capitalAccount: { include: { entity: true } } },
  });
  const mapped = new Map<string, MappedAccount>();
  const rows: BankRow[] = [];
  for (const link of links) {
    if (link.type === "INVESTMENT") continue;
    const account = link.capitalAccount;
    if (!account || account.archivedAt || account.entity.kind !== item.entityKind) {
      stats.unmapped += 1;
      continue;
    }
    if (account.type !== "checking" && account.type !== "cash" && account.type !== "credit_card" && account.type !== "brokerage") continue;
    mapped.set(account.id, { id: account.id, type: account.type });
    const txs = await deps.client.getTransactions(link.pluggyAccountId, since);
    for (const tx of txs) {
      if (await alreadyBooked(deps.db, item.userId, tx.id)) {
        stats.skipped += 1;
        continue;
      }
      if (isPending(tx.status)) {
        stats.skipped += 1;
        continue;
      }
      const date = dayOf(tx.date);
      if (beforeCutoff(item.syncCutoff, date)) {
        stats.skipped += 1;
        continue;
      }
      const direction = tx.type.toUpperCase();
      const amount = Math.abs(tx.amount);
      rows.push({
        pluggyId: tx.id,
        capitalAccountId: account.id,
        accountType: account.type,
        signed: direction === "CREDIT" ? amount : -amount,
        amount,
        date,
        when: parseLocalDate(date),
        description: tx.description ?? "",
        currency: tx.currencyCode ?? undefined,
      });
    }
  }
  const broker = await brokerageId(item, deps.db);
  if (broker && !mapped.has(broker)) mapped.set(broker, { id: broker, type: "brokerage" });
  const otherMapped = await userMappedAccounts(item.userId, deps.db);
  for (const account of otherMapped) mapped.set(account.id, account);
  const used = new Set<string>();
  for (const tx of rows) {
    if (used.has(tx.pluggyId)) continue;
    try {
      const paired = await bookBankTx(item, tx, rows, used, [...mapped.values()], deps, stats);
      used.add(tx.pluggyId);
      if (paired) used.add(paired);
    } catch (error) {
      used.add(tx.pluggyId);
      stats.conflicts += 1;
      await openReview(deps.db, item, "conflict", {
        pluggyId: tx.pluggyId,
        description: clip(tx.description),
        amount: tx.signed,
        date: tx.date,
        reason: safeSyncError(error),
      });
    }
  }
}

async function userMappedAccounts(userId: string, db: DbClient): Promise<MappedAccount[]> {
  const links = await db.pluggyAccountLink.findMany({
    where: { capitalAccountId: { not: null }, item: { userId } },
    include: { capitalAccount: true },
  });
  const accounts: MappedAccount[] = [];
  for (const link of links) {
    const account = link.capitalAccount;
    if (!account || account.archivedAt) continue;
    if (account.type !== "checking" && account.type !== "cash" && account.type !== "credit_card" && account.type !== "brokerage") continue;
    accounts.push({ id: account.id, type: account.type });
  }
  return accounts;
}

async function bookBankTx(
  item: ItemRow,
  tx: BankRow,
  rows: BankRow[],
  used: Set<string>,
  mapped: MappedAccount[],
  deps: SyncDeps,
  stats: ItemSyncStats,
): Promise<string | null> {
  const opposites = rows.filter((other) => !used.has(other.pluggyId) && other.pluggyId !== tx.pluggyId && isOpposite(tx, other));
  const ledger = await oppositeLedger(deps.db, item.userId, tx, mapped);
  if (opposites.length === 1 && ledger.length === 0) {
    const other = opposites[0]!;
    const back = rows.filter((row) => row.pluggyId !== other.pluggyId && !used.has(row.pluggyId) && isOpposite(other, row));
    if (back.length === 1) {
      await bookTransfer(item, tx.signed < 0 ? tx : other, tx.signed < 0 ? other : tx, deps);
      stats.created += 1;
      return other.pluggyId;
    }
    for (const row of [other, ...back]) used.add(row.pluggyId);
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.pluggyId,
      description: clip(tx.description),
      amount: tx.signed,
      date: tx.date,
      candidateIds: [other.pluggyId, ...back.map((row) => row.pluggyId)],
      reason: "ambiguous",
    });
    return null;
  }
  if (opposites.length === 0 && ledger.length === 1 && ledger[0]!.transferGroupId) {
    const sameLeg = await deps.db.ledgerEntry.findFirst({
      where: { userId: item.userId, transferGroupId: ledger[0]!.transferGroupId, accountId: tx.capitalAccountId, deletedAt: null },
      select: { id: true },
    });
    await remember(deps.db, item.userId, tx.pluggyId, sameLeg?.id ?? ledger[0]!.id, null, "linked");
    stats.linked += 1;
    return null;
  }
  if (opposites.length + ledger.length > 0) {
    for (const row of opposites) used.add(row.pluggyId);
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.pluggyId,
      description: clip(tx.description),
      amount: tx.signed,
      date: tx.date,
      candidateIds: [...opposites.map((row) => row.pluggyId), ...ledger.map((row) => row.id)],
      reason: "ambiguous",
    });
    return null;
  }
  const described = await describedTransfer(item, tx, mapped, deps, stats);
  if (described !== "continue") return described;
  if (tx.accountType === "credit_card" && tx.signed > 0) {
    await cardCredit(item, tx, deps, stats);
    return null;
  }
  await bookOrLinkSameAccount(item, tx, deps, stats);
  return null;
}

function isOpposite(tx: BankRow, other: BankRow): boolean {
  if (other.pluggyId === tx.pluggyId || other.capitalAccountId === tx.capitalAccountId) return false;
  if (Math.sign(other.signed) === Math.sign(tx.signed) || other.signed === 0 || tx.signed === 0) return false;
  if (Math.abs(other.amount - tx.amount) > AMOUNT_EPS) return false;
  return Math.abs(other.when.getTime() - tx.when.getTime()) <= WINDOW_MS;
}

async function oppositeLedger(db: DbClient, userId: string, tx: BankRow, mapped: MappedAccount[]) {
  const accountIds = mapped.map((account) => account.id).filter((id) => id !== tx.capitalAccountId);
  if (accountIds.length === 0) return [];
  const rows = await db.ledgerEntry.findMany({
    where: {
      userId,
      accountId: { in: accountIds },
      deletedAt: null,
      date: { gte: new Date(tx.when.getTime() - WINDOW_MS), lte: new Date(tx.when.getTime() + WINDOW_MS) },
    },
    select: { id: true, amount: true, transferGroupId: true },
  });
  return rows.filter((row) => {
    const amount = toNumber(row.amount);
    if (amount === 0 || Math.sign(amount) !== -Math.sign(tx.signed)) return false;
    return Math.abs(Math.abs(amount) - tx.amount) <= AMOUNT_EPS;
  });
}

/** A caixinha move, or a card-bill payment, becomes a transfer when exactly one counterparty is mapped. */
async function describedTransfer(item: ItemRow, tx: BankRow, mapped: MappedAccount[], deps: SyncDeps, stats: ItemSyncStats): Promise<string | null | "continue"> {
  const caixinha = CAIXINHA.test(tx.description);
  const fatura = tx.signed < 0 && (tx.accountType === "checking" || tx.accountType === "cash") && FATURA.test(tx.description);
  if (!caixinha && !fatura) return "continue";
  const target = counterparty(tx, mapped, caixinha);
  if (!target) {
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.pluggyId,
      description: clip(tx.description),
      amount: tx.signed,
      date: tx.date,
      reason: "ambiguous",
    });
    return null;
  }
  const other: BankRow = {
    ...tx,
    pluggyId: `${tx.pluggyId}:counterparty`,
    capitalAccountId: target.id,
    accountType: target.type,
    signed: -tx.signed,
  };
  await bookTransfer(item, tx.signed < 0 ? tx : other, tx.signed < 0 ? other : tx, deps, tx.pluggyId);
  stats.created += 1;
  return null;
}

function counterparty(tx: BankRow, mapped: MappedAccount[], caixinha: boolean): MappedAccount | null {
  if (caixinha && (tx.accountType === "checking" || tx.accountType === "cash")) {
    const brokers = uniqueType(mapped, "brokerage");
    return brokers.length === 1 ? brokers[0]! : null;
  }
  if (caixinha && tx.accountType === "brokerage") {
    const cash = mapped.filter((account) => account.type === "checking" || account.type === "cash");
    const ids = [...new Set(cash.map((account) => account.id))];
    if (ids.length !== 1) return null;
    return cash.find((account) => account.id === ids[0]) ?? null;
  }
  if (!caixinha && tx.signed < 0 && (tx.accountType === "checking" || tx.accountType === "cash")) {
    const cards = uniqueType(mapped, "credit_card");
    return cards.length === 1 ? cards[0]! : null;
  }
  return null;
}

function uniqueType(mapped: MappedAccount[], type: MappedAccount["type"]): MappedAccount[] {
  const rows = mapped.filter((account) => account.type === type);
  return [...new Map(rows.map((account) => [account.id, account])).values()];
}

async function cardCredit(item: ItemRow, tx: BankRow, deps: SyncDeps, stats: ItemSyncStats) {
  const candidates = await fuzzyCandidates(deps.db, item.userId, tx.capitalAccountId, tx.signed, tx.when);
  if (candidates.length === 1) {
    await remember(deps.db, item.userId, tx.pluggyId, candidates[0]!.id, null, "linked");
    stats.linked += 1;
    return;
  }
  stats.conflicts += 1;
  await openReview(deps.db, item, "conflict", {
    pluggyId: tx.pluggyId,
    description: clip(tx.description),
    amount: tx.signed,
    date: tx.date,
    ...(candidates.length > 1 ? { candidateIds: candidates.map((row) => row.id), reason: "multiple_matches" } : { reason: "card_credit" }),
  });
}

async function bookOrLinkSameAccount(item: ItemRow, tx: BankRow, deps: SyncDeps, stats: ItemSyncStats) {
  const candidates = await fuzzyCandidates(deps.db, item.userId, tx.capitalAccountId, tx.signed, tx.when);
  if (candidates.length > 1) {
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.pluggyId,
      description: clip(tx.description),
      amount: tx.signed,
      date: tx.date,
      candidateIds: candidates.map((row) => row.id),
      reason: "multiple_matches",
    });
    return;
  }
  if (candidates.length === 1) {
    await remember(deps.db, item.userId, tx.pluggyId, candidates[0]!.id, null, "linked");
    stats.linked += 1;
    return;
  }
  const kind = tx.signed > 0 ? "income" : "expense";
    await inTransaction(deps.db, async (client) => {
    const created = await createEntry(
      item.userId,
      {
        kind,
        accountId: tx.capitalAccountId,
        amount: tx.amount,
        date: tx.date,
        description: clip(tx.description) || "Lançamento",
        currency: tx.currency,
      },
      client,
      { metadata: { source: "pluggy" } },
    );
    await client.pluggyExternalRef.create({
      data: { userId: item.userId, pluggyId: tx.pluggyId, ledgerEntryId: created.entryIds[0] ?? null, matchKind: "created" },
    });
  });
  stats.created += 1;
}

async function bookTransfer(item: ItemRow, from: BankRow, to: BankRow, deps: SyncDeps, onlyPluggyId?: string) {
  const description = clip(from.description || to.description) || "Transferência";
  await inTransaction(deps.db, async (client) => {
    const booked = await createEntry(
      item.userId,
      {
        kind: "transfer",
        fromAccountId: from.capitalAccountId,
        toAccountId: to.capitalAccountId,
        amount: from.amount,
        date: from.date,
        description,
        currency: from.currency ?? to.currency,
      },
      client,
      { metadata: { source: "pluggy" } },
    );
    const refs = onlyPluggyId
      ? [{ pluggyId: onlyPluggyId, ledgerEntryId: (from.pluggyId === onlyPluggyId ? booked.entryIds[0] : booked.entryIds[1]) ?? null }]
      : [
          { pluggyId: from.pluggyId, ledgerEntryId: booked.entryIds[0] ?? null },
          { pluggyId: to.pluggyId, ledgerEntryId: booked.entryIds[1] ?? null },
        ];
    for (const ref of refs) {
      await client.pluggyExternalRef.create({
        data: { userId: item.userId, pluggyId: ref.pluggyId, ledgerEntryId: ref.ledgerEntryId ?? null, matchKind: "created" },
      });
    }
  });
}

async function fuzzyCandidates(db: DbClient, userId: string, accountId: string, signed: number, when: Date) {
  const rows = await db.ledgerEntry.findMany({
    where: {
      userId,
      accountId,
      deletedAt: null,
      date: { gte: new Date(when.getTime() - WINDOW_MS), lte: new Date(when.getTime() + WINDOW_MS) },
    },
    select: { id: true, amount: true },
  });
  return rows.filter((row) => Math.abs(toNumber(row.amount) - signed) <= AMOUNT_EPS);
}

async function alreadyBooked(db: DbClient, userId: string, pluggyId: string): Promise<boolean> {
  const ref = await db.pluggyExternalRef.findUnique({ where: { userId_pluggyId: { userId, pluggyId } } });
  return Boolean(ref);
}

async function remember(db: DbClient, userId: string, pluggyId: string, ledgerEntryId: string | null, operationId: string | null, matchKind: "created" | "linked") {
  await db.pluggyExternalRef.create({ data: { userId, pluggyId, ledgerEntryId, operationId, matchKind } });
}

async function openReview(db: DbClient, item: ItemRow, kind: string, draft: Prisma.InputJsonObject) {
  const pluggyId = typeof draft.pluggyId === "string" ? draft.pluggyId : null;
  if (pluggyId) {
    const open = await db.pluggyReview.findFirst({ where: { userId: item.userId, status: "open", kind, draft: { path: ["pluggyId"], equals: pluggyId } } });
    if (open) return;
  }
  await db.pluggyReview.create({ data: { userId: item.userId, itemRowId: item.id, kind, draft } });
}

function beforeCutoff(cutoff: Date | null, day: string): boolean {
  if (!cutoff) return false;
  return day < formatDateOnly(cutoff);
}

function isPending(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "PENDING";
}

function clip(value: string | null | undefined): string {
  return redactForModel(value ?? "").slice(0, 500);
}

function assetClassOf(investment: PluggyInvestment): AssetClass {
  const ticker = (investment.code ?? "").toUpperCase();
  const subtype = (investment.subtype ?? "").toUpperCase();
  const type = (investment.type ?? "").toUpperCase();
  if (/3[2-5]$/.test(ticker) || subtype === "BDR") return "bdr";
  if (subtype === "REAL_ESTATE_FUND") return "fii";
  if (type === "ETF" || subtype === "ETF") return "etf";
  if (type === "FIXED_INCOME") return "fixed_income";
  return "stocks";
}

function fixedSubtype(subtype: string | null | undefined, name: string | null | undefined): FixedIncomeSubType | null {
  const sub = (subtype ?? "").toUpperCase();
  if (sub === "CDB") return "cdb";
  if (sub === "LCI") return "lci";
  if (sub === "LCA") return "lca";
  if (sub === "DEBENTURES") return "debenture";
  if (sub === "TREASURY") {
    const label = (name ?? "").toLowerCase();
    if (label.includes("ipca")) return "tesouro_ipca";
    if (label.includes("prefix")) return "tesouro_prefixado";
    return "tesouro_selic";
  }
  return null;
}

export interface ConfirmIncomePatch {
  incomeType?: PassiveIncomeType;
  origin?: DividendOrigin | null;
}

/**
 * Books a low-confidence draft through the dividend service, then locks it.
 * Amortization, a sale or a redemption is refused.
 */
export async function bookConfirmedIncome(userId: string, draft: Prisma.JsonValue, patch: ConfirmIncomePatch, db: DbClient, itemRowId: string | null) {
  const body = asDraft(draft);
  if (body.event === "amortization" || body.event === "buy" || body.event === "sell" || body.event === "skip") {
    throw new LedgerError("Amortization, a sale or a redemption is not income", 422, { code: "pluggy.not_income" });
  }
  if (body.event !== "income" || !body.holdingId || !body.pluggyId || !body.date || body.gross == null) {
    throw new LedgerError("This review is not an income classification", 422, { code: "pluggy.not_income" });
  }
  const incomeType = patch.incomeType ?? body.incomeType;
  if (!incomeType) throw new LedgerError("Choose the income type", 422, { code: "pluggy.not_income" });
  const origin = incomeType === "dividend" ? patch.origin ?? body.origin ?? undefined : undefined;
  const item = itemRowId ? await db.pluggyItem.findFirst({ where: { id: itemRowId, userId } }) : null;
  return inTransaction(db, async (client) => {
    const holding = await client.investmentHolding.findFirstOrThrow({
      where: { id: body.holdingId, account: { userId } },
      select: { id: true, accountId: true, currency: true },
    });
    const cashAccountId = incomeType === "fixed_income_interest" ? holding.accountId : body.cashAccountId || holding.accountId;
    const booked = await creditDividend(userId, client, {
      holdingId: holding.id,
      cashAccountId,
      amount: body.gross!,
      date: body.date!,
      currency: body.currency || holding.currency,
      incomeType,
      withholdingTax: incomeType === "fii_income" ? 0 : Math.min(body.taxWithheld ?? 0, body.gross!),
      origin: origin ?? undefined,
      description: body.description || undefined,
    });
    await client.investmentOperation.update({
      where: { id: booked.operationId },
      data: {
        classificationSource: "manual",
        classificationConfidence: body.confidence ?? null,
        syncLocked: true,
        externalId: body.pluggyId,
        ...(origin ? { dividendOrigin: origin } : {}),
      },
    });
    if (item?.entityKind === "business" && incomeType === "fixed_income_interest" && item.incomeCategoryId && booked.cashEntryId) {
      await client.ledgerEntry.update({ where: { id: booked.cashEntryId }, data: { categoryId: item.incomeCategoryId } });
    }
    await client.pluggyExternalRef.create({
      data: { userId, pluggyId: body.pluggyId!, ledgerEntryId: booked.cashEntryId, operationId: booked.operationId, matchKind: "created" },
    });
    return booked;
  });
}

function asDraft(draft: Prisma.JsonValue): {
  event?: string;
  pluggyId?: string;
  holdingId?: string;
  incomeType?: PassiveIncomeType;
  origin?: DividendOrigin | null;
  gross?: number;
  taxWithheld?: number;
  date?: string;
  description?: string;
  currency?: string;
  confidence?: number;
  cashAccountId?: string | null;
} {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return {};
  const row = draft as Record<string, Prisma.JsonValue>;
  return {
    event: typeof row.event === "string" ? row.event : undefined,
    pluggyId: typeof row.pluggyId === "string" ? row.pluggyId : undefined,
    holdingId: typeof row.holdingId === "string" ? row.holdingId : undefined,
    incomeType: isIncomeType(row.incomeType) ? row.incomeType : undefined,
    origin: isOrigin(row.origin) ? row.origin : null,
    gross: typeof row.gross === "number" ? row.gross : undefined,
    taxWithheld: typeof row.taxWithheld === "number" ? row.taxWithheld : undefined,
    date: typeof row.date === "string" ? row.date : undefined,
    description: typeof row.description === "string" ? row.description : undefined,
    currency: typeof row.currency === "string" ? row.currency : undefined,
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    cashAccountId: typeof row.cashAccountId === "string" ? row.cashAccountId : null,
  };
}

function isIncomeType(value: Prisma.JsonValue | undefined): value is PassiveIncomeType {
  return value === "dividend" || value === "jcp" || value === "fii_income" || value === "fixed_income_interest";
}

function isOrigin(value: Prisma.JsonValue | undefined): value is DividendOrigin {
  return value === "BR" || value === "BDR" || value === "EXTERIOR";
}

export type { Classification };
