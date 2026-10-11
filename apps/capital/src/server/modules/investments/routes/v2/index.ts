import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { entityScopeQuery, entityScopeSchema, resolveScopeQuery } from "@capital/server/lib/entity-scope";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import {
  adjustPosition,
  countOperations,
  createHolding,
  deleteOperation,
  getOwnedHolding,
  getTargets,
  listHoldings,
  listOperations,
  moveBrokerageCash,
  OPERATION_INCLUDE,
  portfolioSummary,
  rebalanceSuggestion,
  recordOperation,
  serializeHolding,
  serializeOperation,
  setTargets,
  updateHolding,
  updateOperation,
} from "../../services/portfolio";
import { contributions } from "../../services/contributions";
import { updateAllPrices } from "../../services/update-prices";
import { ALLOCATION_CLASSES, ASSET_CLASSES } from "../../lib/allocation-class";

const tags = ["Investments v2"];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const assetClass = z.enum(ASSET_CLASSES);
const allocationClass = z.enum(ALLOCATION_CLASSES);
const subType = z.enum(["cdb", "rdb", "lci", "lca", "cdi", "tesouro_selic", "tesouro_ipca", "tesouro_prefixado", "debenture"]);
const OP_TYPES = ["buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal", "adjustment"] as const;
const opType = z.enum(OP_TYPES);
const incomeType = z.enum(["dividend", "jcp", "fii_income", "interest"]);

const holdingFields = {
  assetClass,
  allocationClass: allocationClass.nullish(),
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
  /** Income only: dividend | jcp | fii_income | interest. */
  incomeType: incomeType.nullish(),
  /** Income only: tax withheld at source (cash credited = totalAmount - taxWithheld). */
  taxWithheld: z.number().nonnegative().optional(),
  /** Income only: credit the cash to this checking/cash account instead of the broker (null = broker). */
  creditToAccountId: z.string().nullish(),
};

const holdingsRoute = createRoute({
  method: "get",
  path: "/v2/holdings",
  tags,
  summary: "Holdings with market value; scope = all | pf | pj | <entityId>",
  request: { query: z.object({ accountId: z.string().optional(), ...entityScopeQuery, includeInactive: z.enum(["true", "false"]).optional() }) },
  responses: v2Responses,
});
const createHoldingRoute = createRoute({ method: "post", path: "/v2/holdings", tags, summary: "Create a holding on a brokerage account, in an undo batch (batchId)", request: jsonBody(z.object({ accountId: z.string(), ...holdingFields })), responses: v2Responses });
const patchHoldingRoute = createRoute({
  method: "patch",
  path: "/v2/holdings/{id}",
  tags,
  summary: "Update a holding (price, name, deactivate), in an undo batch (batchId)",
  request: { params: idParams, ...jsonBody(z.object(holdingFields).partial().extend({ isActive: z.boolean().optional() })) },
  responses: v2Responses,
});
const adjustRoute = createRoute({
  method: "post",
  path: "/v2/holdings/{id}/adjust",
  tags,
  summary: "Reset the position (quantity and average cost) with an adjustment operation. A sale is recorded as a sell, not as an adjustment",
  request: { params: idParams, ...jsonBody(z.object({ currentQuantity: z.number().nonnegative(), averageCost: z.number().nonnegative(), notes: z.string().optional() })) },
  responses: v2Responses,
});
const opsRoute = createRoute({
  method: "get",
  path: "/v2/investment-operations",
  tags,
  summary: "Investment operations, newest first; scope = all | pf | pj | <entityId>; type = comma list; limit/offset page them",
  request: {
    query: z.object({
      holdingId: z.string().optional(),
      accountId: z.string().optional(),
      ...entityScopeQuery,
      type: z
        .string()
        .regex(new RegExp(`^(${OP_TYPES.join("|")})(,(${OP_TYPES.join("|")}))*$`))
        .optional()
        .describe("Comma-separated operation types, e.g. dividend,yield_payment"),
      from: day.optional(),
      to: day.optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    }),
  },
  responses: v2Responses,
});
const createOpRoute = createRoute({
  method: "post",
  path: "/v2/investment-operations",
  tags,
  summary:
    "Record a buy/sell/income with its cash leg, in one undo batch (batchId). fundFromAccountId first moves the cash from a checking account (fundAmount = amount debited when its currency differs). A sale above the position is 422 holding.oversell.",
  request: jsonBody(z.object({ holdingId: z.string(), ...operationFields, fundFromAccountId: z.string().nullish(), fundAmount: z.number().positive().nullish() })),
  responses: v2Responses,
});
const patchOpRoute = createRoute({
  method: "patch",
  path: "/v2/investment-operations/{id}",
  tags,
  summary: "Update an operation and its cash leg, in one undo batch (batchId)",
  request: { params: idParams, ...jsonBody(z.object(operationFields).partial()) },
  responses: v2Responses,
});
const deleteOpRoute = createRoute({
  method: "delete",
  path: "/v2/investment-operations/{id}",
  tags,
  summary: "Delete an operation; its cash leg (and with withFunding=true the transfer that paid for it) goes to the trash. Undoable (batchId).",
  request: { params: idParams, query: z.object({ withFunding: queryFlag.optional() }) },
  responses: v2Responses,
});
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
      /** What arrives in the other account's currency. Omitted, the leg converts at the prior-day PTAX. */
      toAmount: z.number().positive().optional(),
    })
  ),
  responses: v2Responses,
});
const refreshPricesRoute = createRoute({ method: "post", path: "/v2/holdings/refresh-prices", tags, summary: "Fetch current market prices for the user's ticker holdings", responses: v2Responses });
const summaryRoute = createRoute({
  method: "get",
  path: "/v2/portfolio/summary",
  tags,
  summary: "Portfolio value, allocation and cash; scope = all | pf | pj | <entityId>",
  request: { query: z.object(entityScopeQuery) },
  responses: v2Responses,
});
const getTargetsRoute = createRoute({ method: "get", path: "/v2/portfolio/targets", tags, summary: "Target allocation by allocation class", responses: v2Responses });
const putTargetsRoute = createRoute({
  method: "put",
  path: "/v2/portfolio/targets",
  tags,
  summary: "Replace the target allocation (must sum to 100%); assetClass targets are mapped to allocation classes and summed",
  request: jsonBody(
    z.object({
      targets: z.array(
        z.union([
          z.object({ allocationClass, targetPercent: z.number().min(0).max(100) }),
          z.object({ assetClass, targetPercent: z.number().min(0).max(100) }),
        ])
      ),
    })
  ),
  responses: v2Responses,
});
const rebalanceRoute = createRoute({
  method: "post",
  path: "/v2/portfolio/rebalance-suggestion",
  tags,
  summary: "How to split a new contribution to approach the targets (never sells)",
  request: jsonBody(z.object({ amount: z.number().positive(), mode: z.enum(["class", "asset"]).default("class"), scope: entityScopeSchema.optional() })),
  responses: v2Responses,
});
const contributionsRoute = createRoute({
  method: "get",
  path: "/v2/contributions",
  tags,
  summary:
    "Monthly aportes into the brokers (deposits, withdrawals, buys by class, origin of each transfer) and the PF savings rate: the trailing `months` (default 12) ending in `end` (YYYY-MM, default the current month), or a calendar `year`; scope = all | pf | pj | <entityId>",
  request: {
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      months: z.coerce.number().int().min(1).max(60).optional(),
      end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
      ...entityScopeQuery,
    }),
  },
  responses: v2Responses,
});

/** One holding as GET /v2/holdings serializes it (inactive ones included). */
async function serializedHolding(userId: string, id: string) {
  const holding = await getOwnedHolding(userId, id, prisma);
  const [[h], fx] = await Promise.all([listHoldings(userId, prisma, { accountId: holding.accountId, includeInactive: true }).then((hs) => hs.filter((x) => x.id === id)), loadFx(userId, prisma)]);
  return serializeHolding(h, fx);
}

export const v2Investments = createRouter()
  .openapi(holdingsRoute, v2Handler(holdingsRoute, async (c, userId) => {
    const q = c.req.valid("query");
    const entityIds = await resolveScopeQuery(userId, q, prisma);
    // The Carteira lists the portfolio population (PORTFOLIO_HOLDINGS in portfolio-history.ts); includeInactive lists everything.
    const all = q.includeInactive === "true";
    const [holdings, fx] = await Promise.all([listHoldings(userId, prisma, { accountId: q.accountId, entityIds, includeInactive: all, includeArchivedAccounts: all }), loadFx(userId, prisma)]);
    return { holdings: holdings.map((h) => serializeHolding(h, fx)) };
  }))
  .openapi(createHoldingRoute, v2Handler(createHoldingRoute, async (c, userId) => {
    const created = await createHolding(userId, c.req.valid("json"), prisma, { record: true });
    return { ...(await serializedHolding(userId, created.id)), batchId: created.batchId };
  }))
  .openapi(patchHoldingRoute, v2Handler(patchHoldingRoute, async (c, userId) => {
    const { id } = c.req.valid("param");
    const { batchId } = await updateHolding(userId, id, c.req.valid("json"), prisma);
    return { ...(await serializedHolding(userId, id)), batchId };
  }))
  .openapi(adjustRoute, v2Handler(adjustRoute, async (c, userId) => adjustPosition(userId, { holdingId: c.req.valid("param").id, ...c.req.valid("json") }, prisma)))
  .openapi(opsRoute, v2Handler(opsRoute, async (c, userId) => {
    const q = c.req.valid("query");
    const filters = {
      holdingId: q.holdingId,
      accountId: q.accountId,
      entityIds: await resolveScopeQuery(userId, q, prisma),
      types: q.type ? (q.type.split(",") as (typeof OP_TYPES)[number][]) : undefined,
      from: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
      to: q.to ? new Date(`${q.to}T23:59:59Z`) : undefined,
    };
    const ops = await listOperations(userId, prisma, { ...filters, limit: q.limit, offset: q.offset });
    if (q.limit === undefined) return { operations: ops.map(serializeOperation), total: ops.length, nextOffset: null };
    const total = await countOperations(userId, prisma, filters);
    const end = (q.offset ?? 0) + ops.length;
    return { operations: ops.map(serializeOperation), total, nextOffset: end < total ? end : null };
  }))
  .openapi(createOpRoute, v2Handler(createOpRoute, async (c, userId) => {
    const result = await recordOperation(userId, c.req.valid("json"), prisma);
    const operation = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.operation.id }, include: OPERATION_INCLUDE });
    return { ...result, operation: serializeOperation(operation) };
  }))
  .openapi(patchOpRoute, v2Handler(patchOpRoute, async (c, userId) => {
    const { id } = c.req.valid("param");
    const { batchId } = await updateOperation(userId, id, c.req.valid("json"), prisma);
    const operation = await prisma.investmentOperation.findUniqueOrThrow({ where: { id }, include: OPERATION_INCLUDE });
    return { operation: serializeOperation(operation), batchId };
  }))
  .openapi(deleteOpRoute, v2Handler(deleteOpRoute, async (c, userId) => deleteOperation(userId, c.req.valid("param").id, prisma, { withFunding: c.req.valid("query").withFunding })))
  .openapi(cashRoute, v2Handler(cashRoute, async (c, userId) => moveBrokerageCash(userId, c.req.valid("json"), prisma)))
  .openapi(refreshPricesRoute, v2Handler(refreshPricesRoute, async (_c, userId) => updateAllPrices(prisma, { userId })))
  .openapi(summaryRoute, v2Handler(summaryRoute, async (c, userId) => portfolioSummary(userId, prisma, { entityIds: await resolveScopeQuery(userId, c.req.valid("query"), prisma) })))
  .openapi(getTargetsRoute, v2Handler(getTargetsRoute, async (_c, userId) => ({ targets: await getTargets(userId, prisma) })))
  .openapi(putTargetsRoute, v2Handler(putTargetsRoute, async (c, userId) => ({ targets: await setTargets(userId, c.req.valid("json").targets, prisma) })))
  .openapi(rebalanceRoute, v2Handler(rebalanceRoute, async (c, userId) => {
    const { amount, mode, scope } = c.req.valid("json");
    return rebalanceSuggestion(userId, amount, mode, prisma, { entityIds: await resolveScopeQuery(userId, { scope }, prisma) });
  }))
  .openapi(contributionsRoute, v2Handler(contributionsRoute, async (c, userId) => {
    const q = c.req.valid("query");
    return contributions(userId, prisma, { year: q.year, months: q.months, end: q.end, entityIds: await resolveScopeQuery(userId, q, prisma) });
  }));
