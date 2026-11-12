import type { Account, LedgerEntry } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";

type MovableEntry = Pick<LedgerEntry, "id" | "accountId" | "currency" | "transferGroupId">;

/** An account the user owns. Missing and another user's account are the same error. */
export async function ownedAccount(userId: string, accountId: string, db: DbClient): Promise<Account> {
  const account = await db.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new Error("Account not found or access denied");
  return account;
}

/**
 * The account may take a new transaction: it is on `entityId` and not archived.
 * Exists first, then the entity, then the archive, so a wrong-entity account
 * is not described as merely archived.
 */
export function assertAccountReceives(account: Account, entityId: string): void {
  if (account.entityId !== entityId) {
    throw new Error(`Account "${account.name}" belongs to a different entity than this transaction`);
  }
  if (account.archivedAt) {
    throw new Error(`Account "${account.name}" is archived and cannot receive transactions`);
  }
}

/** ownedAccount plus assertAccountReceives. */
export async function accountOnEntity(userId: string, accountId: string, entityId: string, db: DbClient): Promise<Account> {
  const account = await ownedAccount(userId, accountId, db);
  assertAccountReceives(account, entityId);
  return account;
}

/**
 * Refuse a move that would separate an investment position from its cash.
 * A provento already has a safe move (update_dividend cashAccountId). A buy,
 * sell, or the transfer that funded a position does not: the holding stays
 * on its broker. A plain investment row with no operation is not tied to one.
 * A non-transfer whose currency differs from the account is refused too:
 * the balance is the sum of the account's entry amounts, with no conversion.
 */
export async function assertMovableEntry(userId: string, entry: MovableEntry, target: Account, db: DbClient): Promise<void> {
  if (target.id === entry.accountId) return;
  const op = await db.investmentOperation.findFirst({
    where: {
      holding: { account: { userId } },
      OR: [{ cashEntryId: entry.id }, ...(entry.transferGroupId ? [{ fundingGroupId: entry.transferGroupId }] : [])],
    },
    select: { type: true, holding: { select: { ticker: true, name: true } } },
  });
  if (op) {
    const label = op.holding.ticker ?? op.holding.name;
    const hint =
      op.type === "dividend" || op.type === "yield_payment"
        ? " Use update_dividend with cashAccountId to move a provento."
        : " Edit the investment operation instead.";
    throw new Error(`Cannot move this transaction: it is tied to the investment position ${label}.${hint}`);
  }
  if (!entry.transferGroupId && target.currency.toUpperCase() !== entry.currency.toUpperCase()) {
    throw new Error(`Cannot move this transaction onto "${target.name}": the transaction is ${entry.currency} and the account is ${target.currency}.`);
  }
}
