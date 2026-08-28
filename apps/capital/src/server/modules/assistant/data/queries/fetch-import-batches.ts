import type { DbClient } from "@capital/server/lib/prisma";

/**
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function fetchImportBatchesForAgent(
  userId: string,
  limit: number,
  db: DbClient
) {
  const imports = await db.statementImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      bankName: true,
      entityType: true,
      businessId: true,
      personalAccountId: true,
      transactionCount: true,
      source: true,
      revertedAt: true,
      createdAt: true,
      conversationId: true,
      importPlanId: true,
    },
  });

  return imports.map((imp) => ({
    ...imp,
    revertEligible: imp.revertedAt === null,
  }));
}
