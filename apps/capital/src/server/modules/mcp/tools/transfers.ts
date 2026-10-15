import type { DbClient } from "@capital/server/lib/prisma";
import type { TransferDirection } from "@/generated/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { st } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { advisoryLock } from "@capital/server/modules/ledger/lib/advisory-lock";
import { createEntry, inferDirection } from "@capital/server/modules/ledger/services/entries";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";

const CASH_TYPES = new Set(["checking", "cash", "brokerage"]);

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description?: string | null;
  toAmount?: number | null;
  exchangeRate?: number | null;
}

export interface TransferRow {
  id: string;
  date: string;
  direction: TransferDirection;
  description: string | null;
  fromAccountId: string;
  fromAccountName: string;
  fromEntityId: string;
  fromAmount: number;
  fromCurrency: string;
  toAccountId: string;
  toAccountName: string;
  toEntityId: string;
  toAmount: number;
  toCurrency: string;
}

async function owned(userId: string, accountId: string, tx: DbClient, missing: "transfer.from_account_not_found" | "transfer.to_account_not_found") {
  const account = await tx.account.findFirst({ where: { id: accountId, userId }, include: { entity: true } });
  if (!account) throw notFound(missing === "transfer.from_account_not_found" ? "Source account" : "Destination account", missing);
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
  if (!CASH_TYPES.has(account.type)) {
    throw new LedgerError("This transfer is only for checking, cash, and brokerage accounts", 422, { code: "transfer.account_type" });
  }
  return account;
}

function closeEnough(a: number, b: number) {
  return Math.abs(a - b) <= 0.01;
}

/**
 * One transfer between two of the user's checking, cash, or brokerage
 * accounts. Direction is inferred (checking → broker is an investment
 * deposit and counts as an aporte; it does not buy a holding). Same-currency
 * rejects toAmount and exchangeRate. A repeat of the same accounts, date,
 * amount, description, and toAmount returns the existing group.
 */
export async function createTransfer(userId: string, input: CreateTransferInput, db: DbClient) {
  return inTransaction(db, async (tx) => {
    await advisoryLock(tx, `transfer:${input.fromAccountId}`);
    if (input.fromAccountId === input.toAccountId) throw new LedgerError("A transfer needs two different accounts", 422, { code: "transfer.same_account" });
    const [from, to] = await Promise.all([
      owned(userId, input.fromAccountId, tx, "transfer.from_account_not_found"),
      owned(userId, input.toAccountId, tx, "transfer.to_account_not_found"),
    ]);
    const sameCurrency = from.currency === to.currency;
    if (sameCurrency && (input.toAmount != null || input.exchangeRate != null)) {
      throw new LedgerError("A same-currency transfer has one amount", 422, { code: "transfer.same_currency" });
    }
    const locale = await loadUserLocale(userId, tx);
    const direction = inferDirection(from, to);
    if (from.entityId !== to.entityId && (direction === "investment_deposit" || direction === "investment_withdrawal")) {
      throw new LedgerError(
        "A broker transfer across entities is a contribution or a redemption. Use record_investment_contribution or record_investment_redemption, which route the money through the broker entity's checking account.",
        422,
        { code: "transfer.cross_entity_investment" },
      );
    }
    const description = input.description?.trim()
      || st(locale, "ledger.transferDescription", { direction: st(locale, `ledger.direction.${direction}`), from: from.name, to: to.name });
    const credited = sameCurrency ? input.amount : input.toAmount ?? null;
    const day = parseLocalDate(input.date);
    const candidates = await tx.transferGroup.findMany({
      where: { userId, deletedAt: null, date: day, description },
      include: { legs: true },
    });
    const existing = candidates.find((group) => {
      const out = group.legs.find((leg) => leg.accountId === from.id && toNumber(leg.amount) < 0);
      const inn = group.legs.find((leg) => leg.accountId === to.id && toNumber(leg.amount) > 0);
      if (!out || !inn) return false;
      if (!closeEnough(Math.abs(toNumber(out.amount)), input.amount)) return false;
      if (credited != null && !closeEnough(toNumber(inn.amount), credited)) return false;
      return true;
    });
    if (existing) {
      return {
        duplicate: true,
        batchId: null as string | null,
        transferGroupId: existing.id,
        entryIds: existing.legs.map((leg) => leg.id),
        direction: existing.direction,
        description: existing.description,
      };
    }
    const created = await createEntry(
      userId,
      {
        kind: "transfer",
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: input.amount,
        date: input.date,
        description,
        direction,
        ...(!sameCurrency && input.toAmount != null && input.toAmount > 0 && { toAmount: input.toAmount }),
        ...(!sameCurrency && input.exchangeRate != null && input.exchangeRate > 0 && { exchangeRate: input.exchangeRate }),
      },
      tx,
    );
    return {
      duplicate: false,
      batchId: created.batchId,
      transferGroupId: created.transferGroupId,
      entryIds: created.entryIds,
      direction,
      description,
    };
  });
}

export interface ListTransfersInput {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  direction?: TransferDirection;
  entityId?: string;
  /** Defaults to 100. Values above 500 are capped. */
  limit?: number;
  offset?: number;
}

/** One row per live transfer group, both legs collapsed. accountId and entityId both apply. */
export async function listTransfers(userId: string, params: ListTransfersInput, db: DbClient): Promise<{ transfers: TransferRow[]; limit: number; offset: number }> {
  const limit = Math.min(500, Math.max(1, Math.trunc(params.limit ?? 100)));
  const offset = Math.max(0, Math.trunc(params.offset ?? 0));
  const legFilters = [
    ...(params.accountId ? [{ legs: { some: { accountId: params.accountId, deletedAt: null } } }] : []),
    ...(params.entityId ? [{ legs: { some: { entityId: params.entityId, deletedAt: null } } }] : []),
  ];
  const groups = await db.transferGroup.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(params.direction && { direction: params.direction }),
      ...((params.dateFrom || params.dateTo) && {
        date: {
          ...(params.dateFrom && { gte: parseLocalDate(params.dateFrom) }),
          ...(params.dateTo && { lte: parseLocalDate(params.dateTo) }),
        },
      }),
      ...(legFilters.length && { AND: legFilters }),
    },
    include: { legs: { where: { deletedAt: null }, include: { account: { select: { id: true, name: true, entityId: true } } } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
    skip: offset,
  });
  const transfers: TransferRow[] = [];
  for (const group of groups) {
    const from = group.legs.find((leg) => toNumber(leg.amount) < 0);
    const to = group.legs.find((leg) => leg.id !== from?.id);
    if (!from || !to) continue;
    transfers.push({
      id: group.id,
      date: formatDateOnly(group.date),
      direction: group.direction,
      description: group.description,
      fromAccountId: from.accountId,
      fromAccountName: from.account.name,
      fromEntityId: from.entityId,
      fromAmount: Math.abs(toNumber(from.amount)),
      fromCurrency: from.currency,
      toAccountId: to.accountId,
      toAccountName: to.account.name,
      toEntityId: to.entityId,
      toAmount: Math.abs(toNumber(to.amount)),
      toCurrency: to.currency,
    });
  }
  return { transfers, limit, offset };
}

/** Checking, cash, and brokerage accounts. These ids are not the entity ids from list_accounts. */
export async function listLedgerAccounts(userId: string, params: { type?: "checking" | "cash" | "brokerage" }, db: DbClient) {
  const accounts = await db.account.findMany({
    where: {
      userId,
      archivedAt: null,
      type: params.type ?? { in: ["checking", "cash", "brokerage"] },
    },
    include: { entity: { select: { id: true, name: true, kind: true } } },
    orderBy: [{ entityId: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      entityId: account.entityId,
      entityName: account.entity.name,
      entityKind: account.entity.kind,
      isDefault: account.isDefault,
    })),
  };
}
