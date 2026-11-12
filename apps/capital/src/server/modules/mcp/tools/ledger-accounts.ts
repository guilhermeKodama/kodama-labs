import type { AccountType, EntityType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { round, toNumber } from "../../ledger/lib/money";
import { accountBalances, createAccount, getOwnedAccount, updateAccount } from "../../ledger/services/accounts";
import { getDefaultAccount, legacyEntityRef, resolveLegacyEntity } from "../../ledger/services/entities";
import { inTransaction, recordMutation, snapshot } from "../../ledger/services/mutations";

export interface CreateLedgerAccountParams {
  name: string;
  type: AccountType;
  entityType: EntityType;
  businessId?: string;
  personalAccountId?: string;
  currency?: string;
  /** Opening balance, stored as Account.initialBalance. */
  initialBalance?: number;
  /**
   * Day the opening balance was observed. The ledger does not store an
   * opening-balance date (the accounts screen does not either), so this is
   * not persisted. The amount counts in every balance.
   */
  date?: string;
  creditLimit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
  payFromAccountId?: string | null;
}

const OPENING_DATE_NOTE =
  "Opening balance is stored as initialBalance and counts in every balance. The ledger has no opening-balance date, so date was not stored.";

/**
 * A checking, cash, brokerage, or credit-card account on the PF entity or a
 * business. Opening balance is Account.initialBalance, the same field the
 * accounts screen writes. One undoable batch.
 */
export async function createLedgerAccount(userId: string, params: CreateLedgerAccountParams, db: DbClient) {
  const name = params.name.trim();
  if (!name) throw new Error("name is required");
  if (params.entityType === "business" && !params.businessId) throw new Error("businessId is required for a business account");
  return inTransaction(db, async (tx) => {
    const entity = await resolveLegacyEntity(userId, params, tx);
    if (entity.archivedAt) throw new Error(`The entity "${entity.name}" is archived`);
    const payFromAccountId = params.type === "credit_card" ? (params.payFromAccountId ?? (await getDefaultAccount(entity, tx)).id) : null;
    const account = await createAccount(
      userId,
      {
        entityId: entity.id,
        type: params.type,
        name,
        currency: params.currency?.toUpperCase(),
        initialBalance: params.initialBalance,
        creditLimit: params.type === "credit_card" ? params.creditLimit ?? null : null,
        closingDay: params.type === "credit_card" ? params.closingDay ?? null : null,
        dueDay: params.type === "credit_card" ? params.dueDay ?? null : null,
        payFromAccountId,
      },
      tx,
    );
    const batchId = await recordMutation(tx, userId, "create", account.name, [{ model: "Account", recordId: account.id, before: null, after: snapshot(account) }]);
    const ref = legacyEntityRef(entity);
    const balance = toNumber(account.initialBalance);
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      entityId: account.entityId,
      entityType: ref.entityType,
      businessId: ref.businessId,
      personalAccountId: ref.personalAccountId,
      isDefault: account.isDefault,
      archived: false,
      initialBalance: balance,
      balance,
      batchId,
      ...(params.date ? { note: OPENING_DATE_NOTE } : {}),
    };
  });
}

export interface ArchiveLedgerAccountParams {
  accountId: string;
  /** Archive even when the balance is not zero. The response carries a warning. */
  force?: boolean;
}

/**
 * Soft-archive. The entity's main account is refused. A non-zero balance
 * (opening balance plus live entries, the accounts-screen number) is refused
 * unless force is set. Already archived does nothing.
 */
export async function archiveLedgerAccount(userId: string, params: ArchiveLedgerAccountParams, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const account = await getOwnedAccount(userId, params.accountId, tx);
    const balance = (await accountBalances(userId, tx, [account.id])).get(account.id) ?? toNumber(account.initialBalance);
    const base = { id: account.id, name: account.name, type: account.type, currency: account.currency, balance };
    if (account.archivedAt) return { ...base, archived: true, warning: null as string | null, batchId: null as string | null };
    if (account.isDefault) throw new Error("The entity's main account cannot be archived");
    const nonzero = Math.abs(round(balance, 4)) > 0;
    if (nonzero && !params.force) {
      throw new Error(
        `Account "${account.name}" has a balance of ${round(balance, 4)} ${account.currency}. Archive is refused while the balance is not zero. Pass force: true to archive it anyway.`,
      );
    }
    const updated = await updateAccount(userId, account.id, { archived: true }, tx);
    return {
      ...base,
      archived: updated.archivedAt !== null,
      warning: nonzero ? `Archived with a non-zero balance of ${round(balance, 4)} ${account.currency}.` : null,
      batchId: updated.batchId,
    };
  });
}
