import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { createRule, deleteRule, RULE_MATCH_TYPES, testRules, updateRule } from "../../services/rules";

const tags = ["Ledger v2"];

const ruleBody = z.object({ matchType: z.enum(RULE_MATCH_TYPES), pattern: z.string().min(1), categoryId: z.string(), entityId: z.string().nullish() });
const listRulesRoute = createRoute({ method: "get", path: "/v2/rules", tags, summary: "Categorization rules", responses: v2Responses });
const createRuleRoute = createRoute({ method: "post", path: "/v2/rules", tags, summary: "Create a rule", request: jsonBody(ruleBody), responses: v2Responses });
const patchRuleRoute = createRoute({ method: "patch", path: "/v2/rules/{id}", tags, summary: "Update a rule", request: { params: idParams, ...jsonBody(ruleBody.partial()) }, responses: v2Responses });
const deleteRuleRoute = createRoute({ method: "delete", path: "/v2/rules/{id}", tags, summary: "Delete a rule", request: { params: idParams }, responses: v2Responses });
const testRuleRoute = createRoute({ method: "post", path: "/v2/rules/test", tags, summary: "Which rule categorizes a description", request: jsonBody(z.object({ description: z.string().min(1) })), responses: v2Responses });

export const ledgerRuleRoutes = createRouter()
  .openapi(listRulesRoute, v2Handler(listRulesRoute, (_c, userId) => prisma.categorizationRule.findMany({ where: { userId }, orderBy: [{ hitCount: "desc" }, { pattern: "asc" }], include: { category: { select: { name: true } } } })))
  .openapi(createRuleRoute, v2Handler(createRuleRoute, (c, userId) => createRule(userId, c.req.valid("json"), prisma)))
  .openapi(patchRuleRoute, v2Handler(patchRuleRoute, (c, userId) => updateRule(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(
    deleteRuleRoute,
    v2Handler(deleteRuleRoute, async (c, userId) => {
      await deleteRule(userId, c.req.valid("param").id, prisma);
      return { ok: true };
    })
  )
  .openapi(testRuleRoute, v2Handler(testRuleRoute, (c, userId) => testRules(userId, c.req.valid("json").description, prisma)));
