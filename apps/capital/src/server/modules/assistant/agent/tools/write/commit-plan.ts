import { z } from "zod";
import { defineTool } from "../registry";
import { ImportPlanPayloadSchema } from "../schemas/import-plan-payload";
import { PLAN_CONFIRMATION_WINDOW_MS } from "../../../constants";
import { fetchImportPlanById } from "../../../data/queries/fetch-import-plan";
import { updateImportPlanStatus } from "../../../data/commands/update-import-plan";
import { executeImport } from "@capital/server/modules/bank-statements/services/execute-import";
import {
  executeRevert,
  type RevertPlanPayload,
} from "@capital/server/modules/bank-statements/services/execute-revert";

export const commitPlan = defineTool({
  name: "commit_plan",
  description:
    "Execute a plan that the user has already confirmed in the UI. This is the ONLY tool that writes domain data (transactions, transfers, investment records). It refuses to run unless the plan's status is \"confirmed\" - which only the authenticated confirm endpoint can set, never this conversation. Calling it on a plan that is still \"proposed\" is expected to fail; that is not a bug to work around, it means the user has not confirmed yet.",
  inputSchema: z.object({ planId: z.string() }),
  access: "write_domain",
  requiresConfirmedPlan: true,
  handler: async (ctx, input) => {
    const plan = await fetchImportPlanById(ctx.userId, input.planId, ctx.db);
    if (!plan) {
      throw new Error("Plan not found or access denied");
    }

    if (plan.status === "committed") {
      const priorAction = await ctx.db.agentAction.findFirst({
        where: { planId: plan.id, toolName: "commit_plan", status: "success" },
        orderBy: { createdAt: "desc" },
      });
      if (priorAction?.output) {
        return { ...(priorAction.output as object), planId: plan.id, replayed: true };
      }
      throw new Error(
        "Plan is already committed but no prior result was found to replay - check list_import_batches instead of re-committing"
      );
    }

    if (plan.status !== "confirmed") {
      throw new Error(
        `Plan is "${plan.status}" - commit_plan requires status "confirmed", which only the user's confirmation click can set`
      );
    }

    if (plan.confirmedAt && Date.now() - plan.confirmedAt.getTime() > PLAN_CONFIRMATION_WINDOW_MS) {
      throw new Error("The confirmation has expired - ask the user to confirm the plan again");
    }

    if (plan.kind === "import") {
      const payload = ImportPlanPayloadSchema.parse(plan.payload);
      const result = await executeImport(ctx.userId, payload, ctx.db, {
        source: "agent",
        conversationId: ctx.conversationId,
        importPlanId: plan.id,
      });
      await updateImportPlanStatus(
        ctx.userId,
        plan.id,
        "committed",
        { committedAt: new Date() },
        ctx.db
      );
      return { ...result, planId: plan.id };
    }

    // kind === "revert"
    const payload = plan.payload as unknown as RevertPlanPayload;
    const result = await executeRevert(ctx.userId, payload, ctx.db);
    await updateImportPlanStatus(ctx.userId, plan.id, "committed", { committedAt: new Date() }, ctx.db);

    const revertedImport = await ctx.db.statementImport.findUnique({
      where: { id: payload.statementImportId },
      select: { importPlanId: true },
    });
    if (revertedImport?.importPlanId) {
      await updateImportPlanStatus(ctx.userId, revertedImport.importPlanId, "reverted", {}, ctx.db);
    }

    return { ...result, createdRecords: [], planId: plan.id };
  },
});
