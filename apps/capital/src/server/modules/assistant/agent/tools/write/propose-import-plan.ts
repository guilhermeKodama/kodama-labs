import { defineTool } from "../registry";
import { ImportPlanPayloadSchema, hashPlanPayload, computePlanSummary } from "../schemas/import-plan-payload";
import { validateImportPlanPayload } from "../../services/validate-import-plan-payload";
import { insertImportPlan } from "../../../data/commands/insert-import-plan";

export const proposeImportPlan = defineTool({
  name: "propose_import_plan",
  description:
    "Validate and save a complete import plan as PROPOSED. This writes ZERO domain data - it only persists the plan so the user can review it in the UI and confirm. Proposing a new plan supersedes any prior proposed plan in this conversation. After calling this, end your turn - the next step is the user's, not yours.",
  inputSchema: ImportPlanPayloadSchema,
  access: "write_plan",
  handler: async (ctx, payload) => {
    const { warnings } = await validateImportPlanPayload(ctx.userId, payload, ctx.db);
    const summary = computePlanSummary(payload);
    const payloadHash = hashPlanPayload(payload);

    const plan = await insertImportPlan(
      ctx.userId,
      {
        conversationId: ctx.conversationId,
        kind: "import",
        entityType: payload.entityType,
        entityId: payload.entityId,
        fileId: payload.fileId,
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
