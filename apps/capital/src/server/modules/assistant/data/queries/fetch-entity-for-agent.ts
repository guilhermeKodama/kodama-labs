import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

/**
 * Verify an entity belongs to the user and return what tools need: name,
 * currency and the main account's opening balance (for balance checks).
 * Returns null when the entity doesn't exist, isn't the user's, or is not
 * of `entityType`.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchEntityForAgent(userId: string, entityType: EntityType, entityId: string, db: DbClient) {
  const entity = await db.entity.findFirst({
    where: { id: entityId, userId, kind: entityType },
    include: { accounts: { where: { isDefault: true }, select: { id: true, initialBalance: true } } },
  });
  if (!entity) return null;
  const main = entity.accounts[0];
  return {
    id: entity.id,
    name: entity.name,
    defaultCurrency: entity.defaultCurrency,
    initialBalance: main ? Number(main.initialBalance) : 0,
    accountId: main?.id ?? null,
  };
}
