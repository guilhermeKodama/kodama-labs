import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { accountTypeSchema } from "../../contracts";
import { createAccount, listAccounts, serializeAccount, setAccountBalance, updateAccount } from "../../services/accounts";
import { openStatements, userCalendarDay } from "../../services/statements";

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
  summary: "Accounts with balances; credit cards also carry openStatement {month, total, count, closingDate, dueDate}",
  request: { query: z.object({ type: accountTypeSchema.optional(), entityId: z.string().optional(), includeArchived: queryFlag.optional() }) },
  responses: v2Responses,
});
const createAccountRoute = createRoute({ method: "post", path: "/v2/accounts", tags, summary: "Create a checking account, card, broker or cash account", request: jsonBody(accountBody), responses: v2Responses });
const patchAccountRoute = createRoute({
  method: "patch",
  path: "/v2/accounts/{id}",
  tags,
  summary:
    "Update or archive an account. currency and entityId change only while the account has no entries (422 account.currency_locked / account.entity_locked). Returns batchId (null for a currency or entity change, which is not undoable).",
  request: { params: idParams, ...jsonBody(accountBody.omit({ type: true }).partial().extend({ archived: z.boolean().optional() })) },
  responses: v2Responses,
});
const setBalanceRoute = createRoute({
  method: "post",
  path: "/v2/accounts/{id}/set-balance",
  tags,
  summary: "Set the current balance (e.g. a broker's cash) by adjusting the initial balance; no entry is written. Undoable (batchId, null when unchanged).",
  request: { params: idParams, ...jsonBody(z.object({ balance: z.number().finite() })) },
  responses: v2Responses,
});

export const ledgerAccountRoutes = createRouter()
  .openapi(listAccountsRoute, v2Handler(listAccountsRoute, async (c, userId) => {
    const [accounts, user] = await Promise.all([listAccounts(userId, prisma, c.req.valid("query")), prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } })]);
    const cards = accounts.filter((a) => a.type === "credit_card");
    const open = await openStatements(cards, prisma, userCalendarDay(user?.timezone ?? "America/Sao_Paulo"));
    return accounts.map((a) => ({ ...serializeAccount(a), ...(a.type === "credit_card" && { openStatement: open.get(a.id) ?? null }) }));
  }))
  .openapi(createAccountRoute, v2Handler(createAccountRoute, async (c, userId) => serializeAccount(await createAccount(userId, c.req.valid("json"), prisma))))
  .openapi(patchAccountRoute, v2Handler(patchAccountRoute, async (c, userId) => {
    const account = await updateAccount(userId, c.req.valid("param").id, c.req.valid("json"), prisma);
    return { ...serializeAccount(account), batchId: account.batchId };
  }))
  .openapi(setBalanceRoute, v2Handler(setBalanceRoute, async (c, userId) => {
    const { account, batchId } = await setAccountBalance(userId, c.req.valid("param").id, c.req.valid("json").balance, prisma);
    return { ...serializeAccount(account), batchId };
  }));
