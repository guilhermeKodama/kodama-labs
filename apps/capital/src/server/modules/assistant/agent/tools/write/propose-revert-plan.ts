import { z } from "zod";
import { defineTool } from "../registry";
import { hashJson } from "../schemas/import-plan-payload";
import { insertImportPlan } from "../../../data/commands/insert-import-plan";
import type { CreatedRecordRef } from "@capital/server/modules/bank-statements/services/execute-import";

export const proposeRevertPlan = defineTool({
  name: "propose_revert_plan",
  description:
    "Build a plan that undoes a previous import batch, saved as PROPOSED - same confirm/commit gate as an import plan, nothing changes until the user confirms. Every entry and transfer an import wrote carries its id, so the revert sends all of them to the trash (restorable). For imports this assistant created (source \"agent\") the credit cards it created are archived too; a manual import does not track created cards, which is called out as a warning.",
  inputSchema: z.object({
    statementImportId: z.string(),
    reason: z.string().optional(),
  }),
  access: "write_plan",
  handler: async (ctx, input) => {
    const statementImport = await ctx.db.import.findFirst({
      where: { id: input.statementImportId, userId: ctx.userId },
    });
    if (!statementImport) {
      throw new Error("Statement import not found or access denied");
    }
    if (statementImport.revertedAt) {
      throw new Error("This import was already reverted");
    }

    const warnings: string[] = [];
    const tracked: CreatedRecordRef[] =
      statementImport.source === "agent" && statementImport.importPlanId
        ? (
            await ctx.db.agentAction.findMany({
              where: { toolName: "commit_plan", planId: statementImport.importPlanId },
              select: { createdRecords: true },
            })
          ).flatMap((a) => (a.createdRecords as unknown as CreatedRecordRef[] | null) ?? [])
        : [];
    const [entries, groups] = await Promise.all([
      ctx.db.ledgerEntry.findMany({ where: { importId: statementImport.id, deletedAt: null, transferGroupId: null }, select: { id: true } }),
      ctx.db.transferGroup.findMany({ where: { importId: statementImport.id, deletedAt: null }, select: { id: true } }),
    ]);
    const createdRecords: CreatedRecordRef[] = [
      ...entries.map((e) => ({ model: "LedgerEntry", id: e.id })),
      ...groups.map((g) => ({ model: "TransferGroup", id: g.id })),
      ...tracked.filter((r) => !["LedgerEntry", "TransferGroup"].includes(r.model)),
    ];
    if (statementImport.source !== "agent") {
      warnings.push("This was a manual import - credit cards created alongside it are not tracked and will stay.");
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
