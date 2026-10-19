import type { AssetClass, EntityType, FixedIncomeSubType, Prisma } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import type { DbClient } from "@capital/server/lib/prisma";
import { recalculateHolding } from "@capital/server/modules/investments/lib/holding-position";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { classifyInvestment, needsReview, type Classification, type IncomeGuesser } from "../lib/classify";
import { consentState, dayOf, sinceDate } from "../lib/consent";
import { isPluggyConfigured } from "../lib/config";
import { safeSyncError } from "../lib/client";
import { accountLabel } from "../lib/mask";
import type { PluggyAccount, PluggyClient, PluggyInvestment, PluggyInvestmentTransaction, PluggyTransaction } from "../lib/types";

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_LOCK_MS = 15 * 60 * 1000;
const QTY_EPS = 1e-4;

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
  items: { id: string; status: string; error?: string; stats?: ItemSyncStats }[];
}

interface ItemRow {
  id: string;
  userId: string;
  itemId: string;
  entityKind: EntityType;
  lastSuccessAt: Date | null;
  incomeCategoryId: string | null;
  brokerageAccountId: string | null;
}

/** Sync every item, or one. Missing credentials return disabled and write nothing. */
export async function syncPluggy(userId: string, deps: SyncDeps, opts: { trigger: "cron" | "manual"; itemRowId?: string } ): Promise<SyncReport> {
  const enabled = deps.enabled ?? isPluggyConfigured();
  if (!enabled) return { status: "disabled", items: [] };
  const items = await deps.db.pluggyItem.findMany({
    where: { userId, ...(opts.itemRowId ? { id: opts.itemRowId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (items.length === 0) return { status: "idle", items: [] };
  const results: SyncReport["items"] = [];
  for (const item of items) {
    results.push(await syncOne(item, deps, opts.trigger));
  }
  return { status: "ok", items: results };
}

async function syncOne(item: ItemRow, deps: SyncDeps, trigger: "cron" | "manual"): Promise<SyncReport["items"][number]> {
  const { db, now } = deps;
  const claimed = await db.pluggyItem.updateMany({
    where: { id: item.id, OR: [{ syncingAt: null }, { syncingAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }] },
    data: { syncingAt: now },
  });
  if (claimed.count === 0) return { id: item.id, status: "busy" };
  const run = await db.pluggySyncRun.create({ data: { itemRowId: item.id, trigger, status: "running" } });
  const stats: ItemSyncStats = { created: 0, linked: 0, skipped: 0, conflicts: 0, unmapped: 0 };
  try {
    const remote = await deps.client.getItem(item.itemId);
    const consent = consentState(remote, now);
    const consentExpiresAt = remote.consentExpiresAt ? new Date(remote.consentExpiresAt) : null;
    if (consent === "expired") {
      await finish(db, item.id, run.id, "expired", stats, consentExpiresAt, now, null);
      return { id: item.id, status: "expired", stats };
    }
    const since = sinceDate(item.lastSuccessAt, now);
    await discoverAccounts(item, await deps.client.getAccounts(item.itemId), db);
    await syncInvestments(item, deps, since, stats);
    await syncAccounts(item, deps, since, stats);
    const status = consent === "expiring" ? "expiring" : "ok";
    await finish(db, item.id, run.id, status, stats, consentExpiresAt, now, null);
    return { id: item.id, status, stats };
  } catch (error) {
    const message = safeSyncError(error);
    await finish(db, item.id, run.id, "error", stats, null, now, message);
    return { id: item.id, status: "error", error: message, stats };
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
    await db.pluggyAccountLink.upsert({
      where: { itemRowId_pluggyAccountId: { itemRowId: item.id, pluggyAccountId: account.id } },
      create: {
        itemRowId: item.id,
        pluggyAccountId: account.id,
        name,
        type: account.type,
        subtype: account.subtype ?? null,
        currency: account.currencyCode ?? null,
      },
      update: { name, type: account.type, subtype: account.subtype ?? null, currency: account.currencyCode ?? null },
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
  const date = dayOf(tx.tradeDate ?? tx.date);
  try {
    if (classification.event === "amortization") {
      await bookAmortization(item, holdingId, tx.id, classification.gross, date, investment, creditTo, deps.db);
    } else if (classification.event === "buy" || classification.event === "sell") {
      await recordOperation(
        item.userId,
        {
          holdingId,
          type: classification.event,
          quantity: tx.quantity ?? null,
          pricePerUnit: tx.value ?? null,
          totalAmount: classification.gross,
          fees: tx.expenses?.brokerageFee ?? 0,
          date,
          externalId: tx.id,
          notes: tx.description ?? null,
        },
        deps.db,
      );
    } else if (classification.event === "income") {
      const booked = await recordOperation(
        item.userId,
        {
          holdingId,
          type: classification.incomeType === "interest" ? "yield_payment" : "dividend",
          incomeType: classification.incomeType,
          totalAmount: classification.gross,
          taxWithheld: Math.min(classification.taxWithheld, classification.gross),
          quantity: tx.quantity ?? null,
          date,
          externalId: tx.id,
          notes: tx.description ?? null,
          creditToAccountId: creditTo,
        },
        deps.db,
      );
      await deps.db.investmentOperation.update({
        where: { id: booked.operation.id },
        data: {
          dividendOrigin: classification.origin,
          classificationSource: classification.source,
          classificationConfidence: classification.confidence,
        },
      });
      if (item.entityKind === "business" && classification.incomeType === "interest" && item.incomeCategoryId && booked.cashEntryId) {
        await deps.db.ledgerEntry.update({ where: { id: booked.cashEntryId }, data: { categoryId: item.incomeCategoryId } });
      }
      if (needsReview(classification)) {
        await openReview(deps.db, item, "low_confidence", {
          pluggyId: tx.id,
          operationId: booked.operation.id,
          ticker: investment.code ?? null,
          description: tx.description ?? investment.name ?? "",
          incomeType: classification.incomeType,
          origin: classification.origin,
          confidence: classification.confidence,
        });
      }
    }
    const operation = classification.event === "buy" || classification.event === "sell" || classification.event === "income"
      ? await deps.db.investmentOperation.findFirst({ where: { holdingId, externalId: tx.id }, select: { id: true } })
      : await deps.db.investmentOperation.findFirst({ where: { holdingId, externalId: tx.id }, select: { id: true } });
    await remember(deps.db, item.userId, tx.id, null, operation?.id ?? null, "created");
    stats.created += 1;
  } catch (error) {
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.id,
      ticker: investment.code ?? null,
      description: tx.description ?? "",
      amount: tx.amount,
      date,
      reason: safeSyncError(error),
    });
  }
}

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
  // recordOperation rejects a negative totalAmount (the income-tax check
  // compares tax against it). An amount-only adjustment is how replayPosition
  // reduces cost basis, so the row is written here and the position recomputed.
  await inTransaction(db, async (tx) => {
    await tx.investmentOperation.create({
      data: {
        holdingId,
        type: "adjustment",
        totalAmount: -gross,
        date: parseLocalDate(date),
        externalId: pluggyId,
        notes: `Amortização ${holding.ticker ?? holding.name}`,
      },
    });
    await recalculateHolding(holdingId, tx);
    await createEntry(
      item.userId,
      {
        kind: "income",
        accountId: creditTo ?? holding.accountId,
        amount: -gross,
        date,
        description: `Amortização ${holding.ticker ?? investment.name ?? ""}`.trim(),
      },
      tx,
      { kind: "investment", skipRules: true, metadata: { source: "pluggy", event: "amortization" } },
    );
  });
}

async function syncAccounts(item: ItemRow, deps: SyncDeps, since: string, stats: ItemSyncStats) {
  const links = await deps.db.pluggyAccountLink.findMany({
    where: { itemRowId: item.id },
    include: { capitalAccount: { include: { entity: true } } },
  });
  for (const link of links) {
    if (link.type === "INVESTMENT") continue;
    const account = link.capitalAccount;
    if (!account || account.archivedAt || account.entity.kind !== item.entityKind) {
      stats.unmapped += 1;
      continue;
    }
    if (account.type !== "checking" && account.type !== "cash" && account.type !== "credit_card") continue;
    const txs = await deps.client.getTransactions(link.pluggyAccountId, since);
    for (const tx of txs) await bookBankTx(item, account.id, tx, deps, stats);
  }
}

async function bookBankTx(item: ItemRow, accountId: string, tx: PluggyTransaction, deps: SyncDeps, stats: ItemSyncStats) {
  if (await alreadyBooked(deps.db, item.userId, tx.id)) {
    stats.skipped += 1;
    return;
  }
  const signed = tx.type === "CREDIT" ? Math.abs(tx.amount) : -Math.abs(tx.amount);
  const when = parseLocalDate(dayOf(tx.date));
  const candidates = await fuzzyCandidates(deps.db, item.userId, accountId, signed, when);
  if (candidates.length > 1) {
    stats.conflicts += 1;
    await openReview(deps.db, item, "conflict", {
      pluggyId: tx.id,
      description: tx.description ?? "",
      amount: signed,
      date: dayOf(tx.date),
      candidateIds: candidates.map((row) => row.id),
      reason: "multiple_matches",
    });
    return;
  }
  if (candidates.length === 1) {
    await remember(deps.db, item.userId, tx.id, candidates[0]!.id, null, "linked");
    stats.linked += 1;
    return;
  }
  const kind = tx.type === "CREDIT" ? "income" : "expense";
  const booked = await createEntry(
    item.userId,
    {
      kind,
      accountId,
      amount: Math.abs(tx.amount),
      date: dayOf(tx.date),
      description: (tx.description ?? "Lançamento").slice(0, 500),
      currency: tx.currencyCode ?? undefined,
    },
    deps.db,
    { metadata: { source: "pluggy" } },
  );
  await remember(deps.db, item.userId, tx.id, booked.entryIds[0] ?? null, null, "created");
  stats.created += 1;
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
  const linked = new Set(
    (await db.pluggyExternalRef.findMany({ where: { userId, ledgerEntryId: { in: rows.map((row) => row.id) } }, select: { ledgerEntryId: true } })).map((row) => row.ledgerEntryId),
  );
  return rows.filter((row) => !linked.has(row.id) && Math.abs(toNumber(row.amount) - signed) < 0.011);
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

export type { Classification };
