import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Account, AccountType } from "@/generated/prisma";
import { LedgerError, notFound } from "../lib/errors";
import { round, toNumber } from "../lib/money";
import { getOwnedEntity } from "./entities";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "./mutations";

export interface AccountInput {
  entityId: string;
  type: AccountType;
  name: string;
  institution?: string | null;
  currency?: string;
  externalId?: string | null;
  initialBalance?: number;
  color?: string | null;
  creditLimit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
  payFromAccountId?: string | null;
}

export async function getOwnedAccount(userId: string, accountId: string, db: DbClient): Promise<Account> {
  const account = await db.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound("Account", "account.not_found");
  return account;
}

function validateCard(input: Partial<AccountInput>, type: AccountType) {
  if (type !== "credit_card") return;
  const day = (d: number | null | undefined, label: string) => {
    if (d == null || !Number.isInteger(d) || d < 1 || d > 31) throw new LedgerError(`${label} must be a day between 1 and 31`, 422, { code: "account.invalid_day", params: { field: label } });
  };
  day(input.closingDay, "closingDay");
  day(input.dueDay, "dueDay");
  if (input.creditLimit == null || input.creditLimit <= 0) throw new LedgerError("creditLimit must be positive", 422, { code: "account.invalid_credit_limit" });
}

export async function createAccount(userId: string, input: AccountInput, db: DbClient): Promise<Account> {
  const entity = await getOwnedEntity(userId, input.entityId, db);
  validateCard(input, input.type);
  if (input.payFromAccountId) await getOwnedAccount(userId, input.payFromAccountId, db);
  return db.account.create({
    data: {
      userId,
      entityId: entity.id,
      type: input.type,
      name: input.name,
      institution: input.institution ?? null,
      currency: input.currency ?? entity.defaultCurrency,
      externalId: input.externalId ?? null,
      initialBalance: input.initialBalance ?? 0,
      color: input.color ?? null,
      creditLimit: input.type === "credit_card" ? input.creditLimit ?? null : null,
      closingDay: input.type === "credit_card" ? input.closingDay ?? null : null,
      dueDay: input.type === "credit_card" ? input.dueDay ?? null : null,
      payFromAccountId: input.payFromAccountId ?? null,
    },
  });
}

export type AccountPatch = Partial<Omit<AccountInput, "type">> & {
  archived?: boolean;
  /** What the account holds now (a broker's cash): moves initialBalance by the difference, in the same batch as the rest. */
  balance?: number;
};

/**
 * Edit an account. Stored entries keep the account's currency and entity,
 * so both are locked once it has entries (trash included, since a restore
 * brings them back): a currency change is 422 account.currency_locked, a
 * move to another entity 422 account.entity_locked (recurring rules carry
 * the entity too). An entity's main account never moves. Recorded as one
 * undoable batch, except a currency or entity change: undoing one after
 * entries were added would leave them in another currency or entity.
 */
export async function updateAccount(
  userId: string,
  accountId: string,
  patch: AccountPatch,
  outer: DbClient,
  opts: { record?: boolean; collect?: MutationRecordInput[] } = {}
): Promise<Account & { batchId: string | null }> {
  return inTransaction(outer, async (db) => {
    const account = await getOwnedAccount(userId, accountId, db);
    if (account.type === "credit_card") {
      validateCard(
        {
          closingDay: patch.closingDay ?? account.closingDay,
          dueDay: patch.dueDay ?? account.dueDay,
          creditLimit: patch.creditLimit ?? toNumber(account.creditLimit),
        },
        "credit_card"
      );
    }
    if (patch.payFromAccountId) await getOwnedAccount(userId, patch.payFromAccountId, db);
    const currency = patch.currency?.toUpperCase();
    const currencyChanges = currency !== undefined && currency !== account.currency;
    const entityChanges = patch.entityId !== undefined && patch.entityId !== account.entityId;
    if (currencyChanges || entityChanges) {
      const entries = await db.ledgerEntry.count({ where: { accountId } });
      if (currencyChanges && entries > 0) {
        throw new LedgerError(`The account's currency cannot change: ${entries} transaction(s) are in ${account.currency}`, 422, {
          code: "account.currency_locked",
          params: { count: entries, currency: account.currency },
        });
      }
      if (entityChanges) {
        const target = await getOwnedEntity(userId, patch.entityId!, db);
        if (target.archivedAt) throw new LedgerError(`The entity ${target.name} is archived`, 422, { code: "entity.archived", params: { name: target.name } });
        if (account.isDefault) throw new LedgerError("An entity's main account cannot move to another entity", 422, { code: "account.default_entity_locked" });
        const recurring = await db.recurringRule.count({ where: { accountId } });
        if (entries > 0 || recurring > 0) {
          throw new LedgerError(`The account cannot move to another entity: it has ${entries} transaction(s) and ${recurring} recurring rule(s)`, 422, {
            code: "account.entity_locked",
            params: { entries, recurring },
          });
        }
      }
    }
    let initialBalance = patch.initialBalance;
    if (patch.balance !== undefined) {
      const current = (await accountBalances(userId, db, [accountId])).get(accountId) ?? toNumber(account.initialBalance);
      initialBalance = round(toNumber(account.initialBalance) + round(patch.balance - current, 4), 4);
    }
    const updated = await db.account.update({
      where: { id: accountId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.institution !== undefined && { institution: patch.institution }),
        ...(currency !== undefined && { currency }),
        ...(patch.entityId !== undefined && { entityId: patch.entityId }),
        ...(patch.externalId !== undefined && { externalId: patch.externalId }),
        ...(initialBalance !== undefined && { initialBalance }),
        ...(patch.color !== undefined && { color: patch.color }),
        ...(patch.creditLimit !== undefined && { creditLimit: patch.creditLimit }),
        ...(patch.closingDay !== undefined && { closingDay: patch.closingDay }),
        ...(patch.dueDay !== undefined && { dueDay: patch.dueDay }),
        ...(patch.payFromAccountId !== undefined && { payFromAccountId: patch.payFromAccountId }),
        ...(patch.archived !== undefined && { archivedAt: patch.archived ? (account.archivedAt ?? new Date()) : null }),
      },
    });
    const records: MutationRecordInput[] = [{ model: "Account", recordId: accountId, before: snapshot(account), after: snapshot(updated) }];
    // A currency or entity change is not undoable (see above).
    const undoable = !currencyChanges && !entityChanges;
    if (undoable && opts.collect) opts.collect.push(...records);
    const batchId = undoable && !opts.collect && opts.record !== false ? await recordMutation(db, userId, "update", updated.name, records) : null;
    return { ...updated, batchId };
  });
}

/**
 * Set what the account holds now (a broker's "Caixa disponível", a bank
 * balance) by moving its initial balance by the difference, so no entry is
 * written and the history stays as it is. One undoable batch; none when the
 * balance already matches.
 */
export async function setAccountBalance(userId: string, accountId: string, balance: number, outer: DbClient) {
  return inTransaction(outer, async (db) => {
    const account = await getOwnedAccount(userId, accountId, db);
    const current = (await accountBalances(userId, db, [accountId])).get(accountId) ?? toNumber(account.initialBalance);
    const delta = round(balance - current, 4);
    if (delta === 0) return { account: { ...account, balance: current }, batchId: null };
    const updated = await db.account.update({ where: { id: accountId }, data: { initialBalance: { increment: delta } } });
    const batchId = await recordMutation(db, userId, "update", updated.name, [{ model: "Account", recordId: accountId, before: snapshot(account), after: snapshot(updated) }]);
    return { account: { ...updated, balance: round(current + delta, 4) }, batchId };
  });
}

/** Balance in the account's currency: initial balance + every live entry. */
export async function accountBalances(userId: string, db: DbClient, accountIds?: string[]): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ id: string; balance: Prisma.Decimal }[]>`
    SELECT a.id, a."initialBalance" + coalesce(sum(le.amount) FILTER (WHERE le."deletedAt" IS NULL), 0) AS balance
    FROM accounts a
    LEFT JOIN ledger_entries le ON le."accountId" = a.id
    WHERE a."userId" = ${userId}
      ${accountIds?.length ? Prisma.sql`AND a.id IN (${Prisma.join(accountIds)})` : Prisma.empty}
    GROUP BY a.id`;
  return new Map(rows.map((r) => [r.id, toNumber(r.balance)]));
}

export async function listAccounts(
  userId: string,
  db: DbClient,
  opts: { type?: AccountType; entityId?: string; includeArchived?: boolean } = {}
) {
  const accounts = await db.account.findMany({
    where: {
      userId,
      ...(opts.type && { type: opts.type }),
      ...(opts.entityId && { entityId: opts.entityId }),
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ entityId: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
  const balances = await accountBalances(userId, db, accounts.map((a) => a.id));
  return accounts.map((a) => ({ ...a, balance: balances.get(a.id) ?? toNumber(a.initialBalance) }));
}

export function serializeAccount(a: Account & { balance?: number }) {
  return {
    id: a.id,
    entityId: a.entityId,
    type: a.type,
    name: a.name,
    institution: a.institution,
    currency: a.currency,
    externalId: a.externalId,
    initialBalance: toNumber(a.initialBalance),
    balance: a.balance ?? null,
    isDefault: a.isDefault,
    color: a.color,
    creditLimit: a.creditLimit == null ? null : toNumber(a.creditLimit),
    closingDay: a.closingDay,
    dueDay: a.dueDay,
    payFromAccountId: a.payFromAccountId,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}
