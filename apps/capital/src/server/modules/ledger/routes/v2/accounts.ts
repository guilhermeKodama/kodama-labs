import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { accountTypeSchema } from "../../contracts";
import { createAccount, listAccounts, serializeAccount, updateAccount } from "../../services/accounts";

const tags = ["Ledger v2"];

const accountBody = z.object({
  entityId: z.string(),
  type: accountTypeSchema,
  name: z.string().min(1),
  institution: z.string().nullish(),
  currency: z.string().length(3).optional(),
  externalId: z.string().nullish(),
  initialBalance: z.number().optional(),
  color: z.string().nullish(),
  creditLimit: z.number().positive().nullish(),
  closingDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
  payFromAccountId: z.string().nullish(),
});
const listAccountsRoute = createRoute({
  method: "get",
  path: "/v2/accounts",
  tags,
  summary: "Accounts with balances",
  request: { query: z.object({ type: accountTypeSchema.optional(), entityId: z.string().optional(), includeArchived: z.coerce.boolean().optional() }) },
  responses: v2Responses,
});
const createAccountRoute = createRoute({ method: "post", path: "/v2/accounts", tags, summary: "Create a checking account, card, broker or cash account", request: jsonBody(accountBody), responses: v2Responses });
const patchAccountRoute = createRoute({
  method: "patch",
  path: "/v2/accounts/{id}",
  tags,
  summary: "Update or archive an account",
  request: { params: idParams, ...jsonBody(accountBody.omit({ entityId: true, type: true }).partial().extend({ archived: z.boolean().optional() })) },
  responses: v2Responses,
});

export const ledgerAccountRoutes = createRouter()
  .openapi(listAccountsRoute, v2Handler(listAccountsRoute, async (c, userId) => (await listAccounts(userId, prisma, c.req.valid("query"))).map(serializeAccount)))
  .openapi(createAccountRoute, v2Handler(createAccountRoute, async (c, userId) => serializeAccount(await createAccount(userId, c.req.valid("json"), prisma))))
  .openapi(patchAccountRoute, v2Handler(patchAccountRoute, async (c, userId) => serializeAccount(await updateAccount(userId, c.req.valid("param").id, c.req.valid("json"), prisma))));
