import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { entityScopeQuery, resolveScopeQuery } from "@capital/server/lib/entity-scope";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, queryFlag, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { ALLOCATION_CLASSES, ASSET_CLASSES } from "../../lib/allocation-class";
import { recordAporte } from "../../services/aporte";
import { quotesFor, searchAssetsFor } from "../../services/market";
import { recordOrders } from "../../services/orders";
import { portfolioHistory } from "../../services/portfolio-history";

/**
 * The new investment endpoints: POST /v2/investments/aporte, POST
 * /v2/investments/orders, GET /v2/quotes, GET /v2/assets/search and GET
 * /v2/portfolio/history. Mounted in src/server/routes.ts.
 */

const tags = ["Investments v2"];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const newHolding = z.object({
  ticker: z.string().trim().min(1).max(20).nullish(),
  name: z.string().trim().min(1).max(200),
  assetClass: z.enum(ASSET_CLASSES),
  currency: z.string().length(3).optional(),
  allocationClass: z.enum(ALLOCATION_CLASSES).nullish(),
});

const aporteRoute = createRoute({
  method: "post",
  path: "/v2/investments/aporte",
  tags,
  summary:
    "Move money into a broker (an investment_deposit; across entities first a capital injection or profit distribution to the broker entity's main checking), optionally buying an asset with it, in one undo batch",
  request: jsonBody(
    z
      .object({
        fromAccountId: z.string().min(1),
        brokerAccountId: z.string().min(1),
        /** In the source account's currency. */
        amount: z.number().positive(),
        /** In the broker's currency, when it differs from the source's. */
        toAmount: z.number().positive().nullish(),
        date: day,
        description: z.string().trim().min(1).max(500).nullish(),
        buy: z
          .object({
            holdingId: z.string().min(1).nullish(),
            newHolding: newHolding.nullish(),
            quantity: z.number().positive(),
            price: z.number().nonnegative(),
            fees: z.number().nonnegative().optional(),
          })
          .refine((b) => !!b.holdingId !== !!b.newHolding, { message: "Give either holdingId or newHolding", path: ["holdingId"] })
          .nullish(),
      })
  ),
  responses: v2Responses,
});

const ordersRoute = createRoute({
  method: "post",
  path: "/v2/investments/orders",
  tags,
  summary: "Record several buys atomically (\"Gerar ordens\"), optionally each paid from a checking account, in one undo batch",
  request: jsonBody(
    z.object({
      date: day,
      fundFromAccountId: z.string().min(1).nullish(),
      orders: z
        .array(
          z
            .object({
              holdingId: z.string().min(1).nullish(),
              newHolding: newHolding.extend({ accountId: z.string().min(1) }).nullish(),
              quantity: z.number().positive().nullish(),
              price: z.number().nonnegative().nullish(),
              /** For assets tracked by amount (fixed income); default quantity x price. */
              amount: z.number().positive().nullish(),
              fees: z.number().nonnegative().optional(),
            })
            .refine((o) => !!o.holdingId !== !!o.newHolding, { message: "Give either holdingId or newHolding", path: ["holdingId"] })
            .refine((o) => !!o.amount || (!!o.quantity && o.price != null), { message: "Give quantity and price, or amount", path: ["amount"] })
        )
        .min(1)
        .max(50),
    })
  ),
  responses: v2Responses,
});

const quotesRoute = createRoute({
  method: "get",
  path: "/v2/quotes",
  tags,
  summary: "Current market quotes (brapi, Yahoo Finance, CoinGecko) for up to 20 comma-separated tickers",
  request: {
    query: z.object({
      tickers: z
        .string()
        .min(1)
        .refine((s) => s.split(",").filter((t) => t.trim()).length <= 20, "At most 20 tickers"),
    }),
  },
  responses: v2Responses,
});

const searchRoute = createRoute({
  method: "get",
  path: "/v2/assets/search",
  tags,
  summary: "Assets matching a ticker or name: the user's holdings first, then market results (remote=false skips the network)",
  request: {
    query: z.object({
      q: z.string().trim().min(1).max(60),
      limit: z.coerce.number().int().min(1).max(20).optional(),
      remote: queryFlag.optional(),
    }),
  },
  responses: v2Responses,
});

const historyRoute = createRoute({
  method: "get",
  path: "/v2/portfolio/history",
  tags,
  summary:
    "Month-end portfolio of the last `months` months (the current one live): netWorth (holdings + broker cash), contributed (\"Total aportado\"), netFlow, byClass, estimated (holdings at cost: no snapshot), Modified Dietz return per month and chained; scope = all | pf | pj | <entityId>",
  request: { query: z.object({ months: z.coerce.number().int().min(1).max(120).optional(), ...entityScopeQuery }) },
  responses: v2Responses,
});

export const v2InvestmentsExtra = createRouter()
  .openapi(aporteRoute, v2Handler(aporteRoute, async (c, userId) => recordAporte(userId, c.req.valid("json"), prisma)))
  .openapi(ordersRoute, v2Handler(ordersRoute, async (c, userId) => recordOrders(userId, c.req.valid("json"), prisma)))
  .openapi(quotesRoute, v2Handler(quotesRoute, async (c, userId) => quotesFor(userId, c.req.valid("query").tickers.split(","), prisma)))
  .openapi(searchRoute, v2Handler(searchRoute, async (c, userId) => {
    const q = c.req.valid("query");
    return searchAssetsFor(userId, q.q, prisma, { limit: q.limit, remote: q.remote });
  }))
  .openapi(historyRoute, v2Handler(historyRoute, async (c, userId) => {
    const q = c.req.valid("query");
    return portfolioHistory(userId, prisma, { months: q.months, entityIds: await resolveScopeQuery(userId, q, prisma) });
  }));
