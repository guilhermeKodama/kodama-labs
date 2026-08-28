import { z } from "zod";
import { defineTool } from "../registry";
import { hashJson } from "../schemas/import-plan-payload";
import { insertImportPlan } from "../../../data/commands/insert-import-plan";
import type { CreatedRecordRef } from "@capital/server/modules/bank-statements/services/execute-import";

export const proposeRevertPlan = defineTool({
  name: "propose_revert_plan",
  description:
    "Build a plan that undoes a previous import batch, saved as PROPOSED - same confirm/commit gate as an import plan, nothing is deleted until the user confirms. Works best for imports this assistant created (source \"agent\"), where every created row is tracked; for a manual-wizard import (source \"manual\") only the transactions it created can be reverted - transfers or credit cards from that import are not tracked and stay untouched, which is called out as a warning.",
  inputSchema: z.object({
    statementImportId: z.string(),
    reason: z.string().optional(),
  }),
  access: "write_plan",
  handler: async (ctx, input) => {
    const statementImport = await ctx.db.statementImport.findFirst({
      where: { id: input.statementImportId, userId: ctx.userId },
    });
    if (!statementImport) {
      throw new Error("Statement import not found or access denied");
    }
    if (statementImport.revertedAt) {
      throw new Error("This import was already reverted");
    }

    const warnings: string[] = [];
    let createdRecords: CreatedRecordRef[];

    if (statementImport.source === "agent") {
      const actions = await ctx.db.agentAction.findMany({
        where: { toolName: "commit_plan", planId: statementImport.importPlanId ?? undefined },
        select: { createdRecords: true },
      });
      createdRecords = actions.flatMap(
        (a) => (a.createdRecords as unknown as CreatedRecordRef[] | null) ?? []
      );
    } else {
      const transactions = await ctx.db.transaction.findMany({
        where: { statementImportId: input.statementImportId },
        select: { id: true },
      });
      createdRecords = transactions.map((t) => ({ model: "Transaction", id: t.id }));
      warnings.push(
        "This was a manual-wizard import - only its transactions are tracked for revert. Any transfer or credit card created alongside it will not be undone."
      );
    }

    if (createdRecords.length === 0) {
      warnings.push("No tracked records were found to revert.");
    }

    const payload = { statementImportId: input.statementImportId, createdRecords };
    const payloadHash = hashJson(payload);
    const summary = {
      statementImportId: input.statementImportId,
      bankName: statementImport.bankName,
      recordsToDelete: createdRecords.length,
      byModel: createdRecords.reduce<Record<string, number>>((acc, r) => {
        acc[r.model] = (acc[r.model] ?? 0) + 1;
        return acc;
      }, {}),
      reason: input.reason,
    };

    const plan = await insertImportPlan(
      ctx.userId,
      {
        conversationId: ctx.conversationId,
        kind: "revert",
        payload,
        payloadHash,
        summary,
        warnings,
      },
      ctx.db
    );

    return { planId: plan.id, kind: plan.kind, status: plan.status, summary, payloadHash, warnings };
  },
});
