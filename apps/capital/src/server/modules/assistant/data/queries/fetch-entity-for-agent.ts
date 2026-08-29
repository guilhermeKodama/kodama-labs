import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

/**
 * Verify a business/personalAccount belongs to the user and return the
 * fields tools commonly need (name, initial balance for balance-discrepancy
 * checks). Returns null when the entity doesn't exist or isn't the user's.
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchEntityForAgent(
  userId: string,
  entityType: EntityType,
  entityId: string,
  db: DbClient
) {
  if (entityType === "business") {
    return db.business.findFirst({
      where: { id: entityId, userId },
      select: { id: true, name: true, initialBalance: true, defaultCurrency: true },
    });
  }
  return db.personalAccount.findFirst({
    where: { id: entityId, userId },
    select: { id: true, initialBalance: true, defaultCurrency: true },
  });
}
