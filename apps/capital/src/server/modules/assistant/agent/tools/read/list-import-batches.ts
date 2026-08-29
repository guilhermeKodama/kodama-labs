import { z } from "zod";
import { defineTool } from "../registry";
import { fetchImportBatchesForAgent } from "../../../data/queries/fetch-import-batches";

export const listImportBatches = defineTool({
  name: "list_import_batches",
  description:
    "List the user's recent statement imports (manual wizard and agent-driven alike), with revert eligibility. Use this to check what has already been imported, or to find the batch a revert plan should target.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const imports = await fetchImportBatchesForAgent(ctx.userId, input.limit, ctx.db);
    return {
      imports: imports.map((imp) => ({
        id: imp.id,
        bankName: imp.bankName,
        entityType: imp.entityType,
        businessId: imp.businessId,
        personalAccountId: imp.personalAccountId,
        transactionCount: imp.transactionCount,
        source: imp.source,
        revertEligible: imp.revertEligible,
        conversationId: imp.conversationId,
        importPlanId: imp.importPlanId,
        createdAt: imp.createdAt.toISOString(),
      })),
    };
  },
});
