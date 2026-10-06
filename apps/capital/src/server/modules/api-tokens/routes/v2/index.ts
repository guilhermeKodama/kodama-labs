import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { createApiToken, listApiTokens, revokeApiToken, updateApiToken } from "../../services/tokens";

const tags = ["API tokens v2"];

const listRoute = createRoute({
  method: "get",
  path: "/v2/api-tokens",
  tags,
  summary: "Active API tokens (masked), newest first, each with the MCP clients seen on it",
  responses: v2Responses,
});
const createTokenRoute = createRoute({
  method: "post",
  path: "/v2/api-tokens",
  tags,
  summary: "Create a token (cap_live_…). The plaintext `token` is in this response only; readOnly limits MCP clients to the read tools",
  request: jsonBody(z.object({ name: z.string().max(80).nullish(), readOnly: z.boolean().optional() }).strict()),
  responses: v2Responses,
});
const patchRoute = createRoute({
  method: "patch",
  path: "/v2/api-tokens/{id}",
  tags,
  summary: "Rename a token or switch it between read-only and read + write (applies from the next MCP request)",
  request: { params: idParams, ...jsonBody(z.object({ name: z.string().max(80).optional(), readOnly: z.boolean().optional() }).strict()) },
  responses: v2Responses,
});
const revokeRoute = createRoute({
  method: "delete",
  path: "/v2/api-tokens/{id}",
  tags,
  summary: "Revoke a token; MCP requests with it get 401 from now on",
  request: { params: idParams },
  responses: v2Responses,
});

/** Personal API tokens for MCP clients (/v2/api-tokens). */
export const v2ApiTokens = createRouter()
  .openapi(listRoute, v2Handler(listRoute, async (_c, userId) => ({ tokens: await listApiTokens(userId, prisma) })))
  .openapi(createTokenRoute, v2Handler(createTokenRoute, (c, userId) => createApiToken(userId, c.req.valid("json"), prisma)))
  .openapi(patchRoute, v2Handler(patchRoute, (c, userId) => updateApiToken(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(revokeRoute, v2Handler(revokeRoute, (c, userId) => revokeApiToken(userId, c.req.valid("param").id, prisma)));
