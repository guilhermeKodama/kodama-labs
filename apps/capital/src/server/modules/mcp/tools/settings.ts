import type { DbClient } from "@capital/server/lib/prisma";
import { updatePreferences } from "../../users/services/me";
import { getDefaultAccount, getOwnedEntity, updateEntity } from "../../ledger/services/entities";
import { toNumber } from "../../ledger/lib/money";

const SETTINGS_SELECT = { baseCurrency: true, theme: true, dateFormat: true, numberFormat: true, timezone: true } as const;

/** User-level settings. */
export async function getUserSettings(userId: string, db: DbClient) {
  const user = await db.user.findUnique({ where: { id: userId }, select: SETTINGS_SELECT });
  if (!user) throw new Error("User not found");
  return user;
}

/** Update user-level settings; a base currency change on a non-empty ledger needs force. */
export async function updateUserSettings(
  userId: string,
  updates: { baseCurrency?: string; theme?: string; dateFormat?: string; numberFormat?: string; timezone?: string; force?: boolean },
  db: DbClient
) {
  const { force, ...patch } = updates;
  await updatePreferences(userId, patch, db, { force });
  return getUserSettings(userId, db);
}

async function entitySettings(userId: string, entityId: string, entityType: "personal" | "business", db: DbClient) {
  const entity = await db.entity.findFirst({ where: { id: entityId, userId, kind: entityType } });
  if (!entity) throw new Error(entityType === "personal" ? "Personal account not found or access denied" : "Business account not found or access denied");
  const main = await getDefaultAccount(entity, db);
  const base = { id: entity.id, defaultCurrency: entity.defaultCurrency, taxRate: entity.taxRate, initialBalance: toNumber(main.initialBalance) };
  return entityType === "personal"
    ? { ...base, name: "Personal", entityType: "personal" as const }
    : { ...base, name: entity.name, description: entity.description, color: entity.color, entityType: "business" as const };
}

export async function getAccountSettings(userId: string, accountId: string, entityType: "personal" | "business", db: DbClient) {
  return entitySettings(userId, accountId, entityType, db);
}

/**
 * Update an entity (personal or business). defaultCurrency is only the
 * default for new entries; every stored entry keeps its own currency and
 * base amount. On an entity with entries the change needs force: true.
 * initialBalance is the opening balance of the entity's main account.
 */
export async function updateAccountSettings(
  userId: string,
  accountId: string,
  entityType: "personal" | "business",
  updates: { name?: string; description?: string; defaultCurrency?: string; color?: string; taxRate?: number; initialBalance?: number; force?: boolean },
  db: DbClient
) {
  const existing = await entitySettings(userId, accountId, entityType, db);
  if (updates.defaultCurrency && updates.defaultCurrency !== existing.defaultCurrency) {
    const count = await db.ledgerEntry.count({ where: { userId, entityId: accountId, deletedAt: null } });
    if (count > 0 && !updates.force) {
      throw new Error(
        `Account has ${count} transaction(s). Changing defaultCurrency is safe (existing transactions keep their currency and exchangeRate), ` +
          `but requires force:true to confirm you understand this. The new currency will only affect new transactions.`
      );
    }
  }
  await getOwnedEntity(userId, accountId, db);
  await updateEntity(
    userId,
    accountId,
    {
      ...(entityType === "business" && updates.name && { name: updates.name }),
      ...(entityType === "business" && updates.description !== undefined && { description: updates.description }),
      ...(entityType === "business" && updates.color && { color: updates.color }),
      ...(updates.defaultCurrency && { defaultCurrency: updates.defaultCurrency }),
      ...(updates.taxRate !== undefined && { taxRate: updates.taxRate }),
      ...(updates.initialBalance !== undefined && { initialBalance: updates.initialBalance }),
    },
    db
  );
  return entitySettings(userId, accountId, entityType, db);
}
