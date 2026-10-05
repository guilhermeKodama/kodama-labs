import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import {
  adjustPosition,
  contributions,
  createHolding,
  deleteOperation,
  getOwnedHolding,
  getTargets,
  listHoldings,
  listOperations,
  moveBrokerageCash,
  portfolioSummary,
  rebalanceSuggestion,
  recordOperation,
  serializeHolding,
  serializeOperation,
  setTargets,
  updateHolding,
  updateOperation,
} from "../../services/portfolio";

const tags = ["Investments v2"];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const assetClass = z.enum(["stocks", "fii", "etf", "bdr", "fixed_income", "crypto", "savings", "international_stocks", "international_etf"]);
const subType = z.enum(["cdb", "rdb", "lci", "lca", "cdi", "tesouro_selic", "tesouro_ipca", "tesouro_prefixado", "debenture"]);
const opType = z.enum(["buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal", "adjustment"]);

const holdingFields = {
  assetClass,
  subType: subType.nullish(),
  ticker: z.string().nullish(),
  name: z.string().min(1),
  currency: z.string().length(3).optional(),
  currentPrice: z.number().nonnegative().nullish(),
};
const operationFields = {
  type: opType,
  quantity: z.number().nullish(),
  pricePerUnit: z.number().nonnegative().nullish(),
  totalAmount: z.number().nonnegative(),
  fees: z.number().nonnegative().optional(),
  date: day,
  notes: z.string().nullish(),
  externalId: z.string().nullish(),
};

const holdingsRoute = createRoute({
  method: "get",
  path: "/v2/holdings",
  tags,
  summary: "Holdings with market value",
  request: { query: z.object({ accountId: z.string().optional(), entityId: z.string().optional(), includeInactive: z.enum(["true", "false"]).optional() }) },
  responses: v2Responses,
});
const createHoldingRoute = createRoute({ method: "post", path: "/v2/holdings", tags, summary: "Create a holding on a brokerage account", request: jsonBody(z.object({ accountId: z.string(), ...holdingFields })), responses: v2Responses });
const patchHoldingRoute = createRoute({
  method: "patch",
  path: "/v2/holdings/{id}",
  tags,
  summary: "Update a holding (price, name, deactivate)",
  request: { params: idParams, ...jsonBody(z.object(holdingFields).partial().extend({ isActive: z.boolean().optional() })) },
  responses: v2Responses,
});
const adjustRoute = createRoute({
  method: "post",
  path: "/v2/holdings/{id}/adjust",
  tags,
  summary: "Reset the position (quantity and average cost) with an adjustment operation",
  request: { params: idParams, ...jsonBody(z.object({ currentQuantity: z.number().nonnegative(), averageCost: z.number().nonnegative(), notes: z.string().optional() })) },
  responses: v2Responses,
});
const opsRoute = createRoute({
  method: "get",
  path: "/v2/investment-operations",
  tags,
  summary: "Investment operations",
  request: { query: z.object({ holdingId: z.string().optional(), accountId: z.string().optional(), from: day.optional(), to: day.optional() }) },
  responses: v2Responses,
});
const createOpRoute = createRoute({
  method: "post",
  path: "/v2/investment-operations",
  tags,
  summary: "Record a buy/sell/income with its cash leg; fundFromAccountId first moves the cash from a checking account",
  request: jsonBody(z.object({ holdingId: z.string(), ...operationFields, fundFromAccountId: z.string().nullish() })),
  responses: v2Responses,
});
const patchOpRoute = createRoute({ method: "patch", path: "/v2/investment-operations/{id}", tags, summary: "Update an operation", request: { params: idParams, ...jsonBody(z.object(operationFields).partial()) }, responses: v2Responses });
const deleteOpRoute = createRoute({ method: "delete", path: "/v2/investment-operations/{id}", tags, summary: "Delete an operation and its cash leg", request: { params: idParams }, responses: v2Responses });
const cashRoute = createRoute({
  method: "post",
  path: "/v2/brokerage-cash",
  tags,
  summary: "Deposit to or withdraw from a brokerage account (an investment transfer)",
  request: jsonBody(
    z.object({
      accountId: z.string(),
      direction: z.enum(["deposit", "withdraw"]),
      amount: z.number().positive(),
      date: day,
      counterpartAccountId: z.string().optional(),
      description: z.string().optional(),
      currency: z.string().length(3).optional(),
      exchangeRate: z.number().positive().optional(),
    })
  ),
  responses: v2Responses,
});
const summaryRoute = createRoute({ method: "get", path: "/v2/portfolio/summary", tags, summary: "Portfolio value, allocation and cash", request: { query: z.object({ entityId: z.string().optional() }) }, responses: v2Responses });
const getTargetsRoute = createRoute({ method: "get", path: "/v2/portfolio/targets", tags, summary: "Target allocation by asset class", responses: v2Responses });
const putTargetsRoute = createRoute({
  method: "put",
  path: "/v2/portfolio/targets",
  tags,
  summary: "Replace the target allocation (must sum to 100%)",
  request: jsonBody(z.object({ targets: z.array(z.object({ assetClass, targetPercent: z.number().min(0).max(100) })) })),
  responses: v2Responses,
});
const rebalanceRoute = createRoute({
  method: "post",
  path: "/v2/portfolio/rebalance-suggestion",
  tags,
  summary: "How to split a new contribution to approach the targets (never sells)",
  request: jsonBody(z.object({ amount: z.number().positive(), mode: z.enum(["class", "asset"]).default("class") })),
  responses: v2Responses,
});
const contributionsRoute = createRoute({
  method: "get",
  path: "/v2/contributions",
  tags,
  summary: "Monthly contributions for a year",
  request: { query: z.object({ year: z.coerce.number().int().min(2000).max(2100), entityId: z.string().optional() }) },
  responses: v2Responses,
});

export const v2Investments = createRouter()
  .openapi(holdingsRoute, v2Handler(holdingsRoute, async (c, userId) => {
    const q = c.req.valid("query");
    const holdings = await listHoldings(userId, prisma, { accountId: q.accountId, entityId: q.entityId, includeInactive: q.includeInactive === "true" });
    return { holdings: holdings.map(serializeHolding) };
  }))
  .openapi(createHoldingRoute, v2Handler(createHoldingRoute, async (c, userId) => {
    const created = await createHolding(userId, c.req.valid("json"), prisma);
    const [holding] = await listHoldings(userId, prisma, { accountId: created.accountId, includeInactive: true }).then((hs) => hs.filter((h) => h.id === created.id));
    return serializeHolding(holding);
  }))
  .openapi(patchHoldingRoute, v2Handler(patchHoldingRoute, async (c, userId) => {
    const { id } = c.req.valid("param");
    await updateHolding(userId, id, c.req.valid("json"), prisma);
    const holding = await getOwnedHolding(userId, id, prisma);
    const [h] = (await listHoldings(userId, prisma, { accountId: holding.accountId, includeInactive: true })).filter((x) => x.id === id);
    return serializeHolding(h);
  }))
  .openapi(adjustRoute, v2Handler(adjustRoute, async (c, userId) => adjustPosition(userId, { holdingId: c.req.valid("param").id, ...c.req.valid("json") }, prisma)))
  .openapi(opsRoute, v2Handler(opsRoute, async (c, userId) => {
    const q = c.req.valid("query");
    const ops = await listOperations(userId, prisma, {
      holdingId: q.holdingId,
      accountId: q.accountId,
      from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
      to: q.to ? new Date(`${q.to}T23:59:59Z`) : undefined,
    });
    return { operations: ops.map(serializeOperation) };
  }))
  .openapi(createOpRoute, v2Handler(createOpRoute, async (c, userId) => {
    const result = await recordOperation(userId, c.req.valid("json"), prisma);
    return { ...result, operation: serializeOperation(result.operation) };
  }))
  .openapi(patchOpRoute, v2Handler(patchOpRoute, async (c, userId) => updateOperation(userId, c.req.valid("param").id, c.req.valid("json"), prisma)))
  .openapi(deleteOpRoute, v2Handler(deleteOpRoute, async (c, userId) => deleteOperation(userId, c.req.valid("param").id, prisma)))
  .openapi(cashRoute, v2Handler(cashRoute, async (c, userId) => moveBrokerageCash(userId, c.req.valid("json"), prisma)))
  .openapi(summaryRoute, v2Handler(summaryRoute, async (c, userId) => portfolioSummary(userId, prisma, c.req.valid("query"))))
  .openapi(getTargetsRoute, v2Handler(getTargetsRoute, async (_c, userId) => ({ targets: await getTargets(userId, prisma) })))
  .openapi(putTargetsRoute, v2Handler(putTargetsRoute, async (c, userId) => ({ targets: await setTargets(userId, c.req.valid("json").targets, prisma) })))
  .openapi(rebalanceRoute, v2Handler(rebalanceRoute, async (c, userId) => {
    const { amount, mode } = c.req.valid("json");
    return rebalanceSuggestion(userId, amount, mode, prisma);
  }))
  .openapi(contributionsRoute, v2Handler(contributionsRoute, async (c, userId) => {
    const { year, entityId } = c.req.valid("query");
    return contributions(userId, year, prisma, { entityId });
  }));
