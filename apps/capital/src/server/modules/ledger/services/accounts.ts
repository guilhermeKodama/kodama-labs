import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Account, AccountType } from "@/generated/prisma";
import { LedgerError, notFound } from "../lib/errors";
import { toNumber } from "../lib/money";
import { getOwnedEntity } from "./entities";

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
  if (!account) throw notFound("Account");
  return account;
}

function validateCard(input: Partial<AccountInput>, type: AccountType) {
  if (type !== "credit_card") return;
  const day = (d: number | null | undefined, label: string) => {
    if (d == null || !Number.isInteger(d) || d < 1 || d > 31) throw new LedgerError(`${label} must be a day between 1 and 31`, 422);
  };
  day(input.closingDay, "closingDay");
  day(input.dueDay, "dueDay");
  if (input.creditLimit == null || input.creditLimit <= 0) throw new LedgerError("creditLimit must be positive", 422);
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

export async function updateAccount(userId: string, accountId: string, patch: Partial<Omit<AccountInput, "entityId" | "type">> & { archived?: boolean }, db: DbClient) {
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
  return db.account.update({
    where: { id: accountId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.institution !== undefined && { institution: patch.institution }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.externalId !== undefined && { externalId: patch.externalId }),
      ...(patch.initialBalance !== undefined && { initialBalance: patch.initialBalance }),
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.creditLimit !== undefined && { creditLimit: patch.creditLimit }),
      ...(patch.closingDay !== undefined && { closingDay: patch.closingDay }),
      ...(patch.dueDay !== undefined && { dueDay: patch.dueDay }),
      ...(patch.payFromAccountId !== undefined && { payFromAccountId: patch.payFromAccountId }),
      ...(patch.archived !== undefined && { archivedAt: patch.archived ? new Date() : null }),
    },
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
