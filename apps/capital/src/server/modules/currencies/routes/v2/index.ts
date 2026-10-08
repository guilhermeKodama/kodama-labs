import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { createCurrency } from "../../services/create-currency";
import { deleteCurrencyService } from "../../services/delete-currency";
import { listCurrencies } from "../../services/list-currencies";
import { updateCurrencyRateService } from "../../services/update-currency";
import { updateAllCurrencyRates } from "../../services/update-rates-from-api";
import type { FxSource } from "../../lib/fx-source";

const tags = ["Currencies v2"];
const codeParams = z.object({ code: z.string().length(3).toUpperCase() });

const listRoute = createRoute({
  method: "get",
  path: "/v2/currencies",
  tags,
  summary: "List currencies with their rates (manualRate = units per 1 base unit; basePerUnit = its inverse), source and quote time",
  responses: v2Responses,
});
const refreshRoute = createRoute({
  method: "post",
  path: "/v2/currencies/refresh",
  tags,
  summary: "Fetch the automatic rates now (PTAX on a BRL base, ECB otherwise); manual rates and users with fxAutoUpdate off are left alone",
  responses: v2Responses,
});
const upsertRoute = createRoute({
  method: "post",
  path: "/v2/currencies",
  tags,
  summary: "Add or replace a currency (manualRate = units of it per 1 base unit); the rate is manual, which the automatic refresh keeps",
  request: jsonBody(z.object({ code: z.string().length(3).toUpperCase(), name: z.string().min(1), symbol: z.string().min(1), manualRate: z.number().positive() })),
  responses: v2Responses,
});
const rateRoute = createRoute({
  method: "patch",
  path: "/v2/currencies/{code}",
  tags,
  summary: "Set a currency's rate by hand (source becomes manual; applies to new entries, stored base amounts are not rewritten)",
  request: { params: codeParams, ...jsonBody(z.object({ manualRate: z.number().positive() })) },
  responses: v2Responses,
});
const deleteRouteDef = createRoute({ method: "delete", path: "/v2/currencies/{code}", tags, summary: "Remove an unused currency", request: { params: codeParams }, responses: v2Responses });
const datedRateRoute = createRoute({
  method: "get",
  path: "/v2/currencies/{code}/rate",
  tags,
  summary: "Base-currency units of one unit of this currency on a date (prior business-day PTAX when the base is BRL; today's rate otherwise)",
  request: { params: codeParams, query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }) },
  responses: v2Responses,
});

const serialize = (c: { code: string; name: string; symbol: string; manualRate: number; source: string; rateUpdatedAt: Date | null; updatedAt: Date }) => ({
  code: c.code,
  name: c.name,
  symbol: c.symbol,
  manualRate: c.manualRate,
  /** Base currency per one unit of this one (what the UI shows as "Taxa (em BRL)"). */
  basePerUnit: c.manualRate > 0 ? 1 / c.manualRate : null,
  source: c.source as FxSource,
  /** When the rate in force was published (PTAX bulletin, ECB reference) or typed. */
  rateUpdatedAt: c.rateUpdatedAt?.toISOString() ?? null,
  updatedAt: c.updatedAt.toISOString(),
});

async function currencyList(userId: string) {
  const [user, currencies] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true, fxAutoUpdate: true } }),
    listCurrencies(userId, prisma),
  ]);
  return { baseCurrency: user?.baseCurrency, fxAutoUpdate: user?.fxAutoUpdate ?? false, currencies: currencies.map(serialize) };
}

export const v2Currencies = createRouter()
  .openapi(listRoute, v2Handler(listRoute, async (_c, userId) => currencyList(userId)))
  .openapi(refreshRoute, v2Handler(refreshRoute, async (_c, userId) => {
    const result = await updateAllCurrencyRates(prisma, { userIds: [userId] });
    return { ...(await currencyList(userId)), ratesUpdated: result.ratesUpdated, errors: result.errors };
  }))
  .openapi(upsertRoute, v2Handler(upsertRoute, async (c, userId) => serialize(await createCurrency({ userId, ...c.req.valid("json") }, prisma))))
  .openapi(rateRoute, v2Handler(rateRoute, async (c, userId) => serialize(await updateCurrencyRateService(userId, c.req.valid("param").code, c.req.valid("json").manualRate, prisma))))
  .openapi(datedRateRoute, v2Handler(datedRateRoute, async (c, userId) => {
    const { code } = c.req.valid("param");
    const { date } = c.req.valid("query");
    const fx = await loadFx(userId, prisma);
    return { code, date, rate: fx.rateOn(code, parseLocalDate(date)) };
  }))
  .openapi(deleteRouteDef, v2Handler(deleteRouteDef, async (c, userId) => {
    const { code } = c.req.valid("param");
    const [user, accounts, entries] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
      prisma.account.count({ where: { userId, currency: code, archivedAt: null } }),
      prisma.ledgerEntry.count({ where: { userId, currency: code, deletedAt: null } }),
    ]);
    if (user?.baseCurrency === code) throw new LedgerError("The base currency cannot be removed", 422, { code: "currency.base_protected" });
    if (accounts || entries) throw new LedgerError(`${code} is used by ${accounts} account(s) and ${entries} entr(ies)`, 409, { code: "currency.in_use", params: { code, accounts, entries } });
    await deleteCurrencyService(userId, code, prisma);
    return { success: true, code };
  }));
