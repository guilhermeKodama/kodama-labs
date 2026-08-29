import type { PrismaClient, EntityType, ImportPlanKind } from "@/generated/prisma";

interface InsertImportPlanInput {
  conversationId: string;
  kind: ImportPlanKind;
  entityType?: EntityType;
  entityId?: string;
  fileId?: string;
  payload: unknown;
  payloadHash: string;
  summary: unknown;
  warnings: string[];
}

/**
 * Persist a new plan and supersede any prior "proposed" plan in the same
 * conversation - only one active proposal makes sense in a chat at a
 * time. Committed/confirmed/rejected plans are left untouched (they are
 * history, not open proposals).
 * @param userId - REQUIRED: The authenticated user's ID
 */
export async function insertImportPlan(
  userId: string,
  input: InsertImportPlanInput,
  db: PrismaClient
) {
  return db.$transaction(async (tx) => {
    await tx.importPlan.updateMany({
      where: { conversationId: input.conversationId, userId, status: "proposed" },
      data: { status: "superseded" },
    });

    return tx.importPlan.create({
      data: {
        conversationId: input.conversationId,
        userId,
        kind: input.kind,
        status: "proposed",
        entityType: input.entityType,
        entityId: input.entityId,
        fileId: input.fileId,
        payload: input.payload as object,
        payloadHash: input.payloadHash,
        summary: input.summary as object,
        warnings: input.warnings,
      },
    });
  });
}
