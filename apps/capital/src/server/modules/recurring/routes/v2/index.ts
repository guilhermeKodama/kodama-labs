import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { remindersConfigSchema } from "@/lib/validations/reminders";
import { TRANSFER_DIRECTIONS } from "@capital/server/modules/ledger/contracts";
import {
  createRecurringRule,
  deleteRecurringRule,
  listRecurringRules,
  markRulePaid,
  serializeRule,
  skipRuleOccurrence,
  updateRecurringRule,
} from "../../services/recurring-rules";

const tags = ["Recurring v2"];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ruleFields = {
  kind: z.enum(["income", "expense", "transfer", "investment"]),
  accountId: z.string(),
  toAccountId: z.string().nullish(),
  transferDirection: z.enum(TRANSFER_DIRECTIONS).nullish(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  // null = convert each occurrence at the rate in force when it is booked.
  exchangeRate: z.number().positive().nullish(),
  description: z.string().min(1),
  categoryId: z.string().nullish(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  startDate: day,
  endDate: day.nullish(),
  autoGenerate: z.boolean().optional(),
  reminders: remindersConfigSchema.nullish(),
};

const listRoute = createRoute({
  method: "get",
  path: "/v2/recurring",
  tags,
  summary: "Recurring rules (income, expenses and transfers) with their next occurrence",
  request: { query: z.object({ entityId: z.string().optional(), includeInactive: z.enum(["true", "false"]).optional() }) },
  responses: v2Responses,
});
const createRuleRoute = createRoute({ method: "post", path: "/v2/recurring", tags, summary: "Create a recurring rule", request: jsonBody(z.object(ruleFields)), responses: v2Responses });
const patchRoute = createRoute({
  method: "patch",
  path: "/v2/recurring/{id}",
  tags,
  summary: "Update a recurring rule",
  request: { params: idParams, ...jsonBody(z.object(ruleFields).partial().extend({ isActive: z.boolean().optional(), nextDueDate: day.optional() })) },
  responses: v2Responses,
});
const deleteRouteDef = createRoute({ method: "delete", path: "/v2/recurring/{id}", tags, summary: "Delete a recurring rule (booked entries stay). Undoable (batchId).", request: { params: idParams }, responses: v2Responses });
const payRoute = createRoute({
  method: "post",
  path: "/v2/recurring/{id}/pay",
  tags,
  summary: "Book the next occurrence (optionally on another date/amount) and advance",
  request: { params: idParams, ...jsonBody(z.object({ date: day.optional(), amount: z.number().positive().optional() })) },
  responses: v2Responses,
});
const skipRoute = createRoute({ method: "post", path: "/v2/recurring/{id}/skip", tags, summary: "Skip the next occurrence", request: { params: idParams }, responses: v2Responses });

export const v2Recurring = createRouter()
  .openapi(listRoute, v2Handler(listRoute, async (c, userId) => {
    const q = c.req.valid("query");
    const rules = await listRecurringRules(userId, prisma, { entityId: q.entityId, includeInactive: q.includeInactive === "true" });
    return { rules: rules.map(serializeRule) };
  }))
  .openapi(createRuleRoute, v2Handler(createRuleRoute, async (c, userId) => {
    const rule = await createRecurringRule(userId, c.req.valid("json"), prisma);
    return { ...serializeRule(rule), batchId: rule.batchId };
  }))
  .openapi(patchRoute, v2Handler(patchRoute, async (c, userId) => {
    const rule = await updateRecurringRule(userId, c.req.valid("param").id, c.req.valid("json"), prisma);
    return { ...serializeRule(rule), batchId: rule.batchId };
  }))
  .openapi(deleteRouteDef, v2Handler(deleteRouteDef, async (c, userId) => {
    const { batchId } = await deleteRecurringRule(userId, c.req.valid("param").id, prisma);
    return { success: true, batchId };
  }))
  .openapi(payRoute, v2Handler(payRoute, async (c, userId) => {
    const result = await markRulePaid(userId, c.req.valid("param").id, prisma, c.req.valid("json"));
    return { ...result, rule: serializeRule(result.rule) };
  }))
  .openapi(skipRoute, v2Handler(skipRoute, async (c, userId) => {
    const rule = await skipRuleOccurrence(userId, c.req.valid("param").id, prisma);
    return { ...serializeRule(rule), batchId: rule.batchId };
  }));
