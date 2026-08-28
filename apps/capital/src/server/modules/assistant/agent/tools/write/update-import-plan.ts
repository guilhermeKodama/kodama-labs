import { z } from "zod";
import { defineTool } from "../registry";
import { ImportPlanPayloadSchema, hashPlanPayload, computePlanSummary } from "../schemas/import-plan-payload";
import { validateImportPlanPayload } from "../../services/validate-import-plan-payload";
import { updateImportPlanPayload } from "../../../data/commands/update-import-plan";

export const updateImportPlan = defineTool({
  name: "update_import_plan",
  description:
    "Amend a plan that is still PROPOSED - for example after the user answered a question about a duplicate. Pass the full corrected payload (not a partial patch). Fails if the plan has already been confirmed, committed, rejected or superseded.",
  inputSchema: z.object({
    planId: z.string(),
    payload: ImportPlanPayloadSchema,
  }),
  access: "write_plan",
  handler: async (ctx, input) => {
    const { warnings } = await validateImportPlanPayload(ctx.userId, input.payload, ctx.db);
    const summary = computePlanSummary(input.payload);
    const payloadHash = hashPlanPayload(input.payload);

    const plan = await updateImportPlanPayload(
      ctx.userId,
      input.planId,
      { payload: input.payload, payloadHash, summary, warnings },
      ctx.db
    );

    return { planId: plan.id, kind: plan.kind, status: plan.status, summary, payloadHash, warnings };
  },
});
