import type { DbClient } from "@capital/server/lib/prisma";
import { legacyEntityRef } from "@capital/server/modules/ledger/services/entities";

/**
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchImportBatchesForAgent(userId: string, limit: number, db: DbClient) {
  const imports = await db.import.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { entity: { select: { id: true, kind: true } } },
  });
  return imports.map((imp) => {
    const ref = imp.entity ? legacyEntityRef(imp.entity) : { entityType: null, businessId: null, personalAccountId: null };
    return {
      id: imp.id,
      bankName: imp.bankName,
      entityType: ref.entityType,
      businessId: ref.businessId,
      personalAccountId: ref.personalAccountId,
      transactionCount: imp.transactionCount,
      source: imp.source,
      revertedAt: imp.revertedAt,
      createdAt: imp.createdAt,
      conversationId: imp.conversationId,
      importPlanId: imp.importPlanId,
      revertEligible: imp.revertedAt === null,
    };
  });
}
