import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createCurrency } from "../../services/create-currency";
import { deleteCurrencyService } from "../../services/delete-currency";
import { listCurrencies } from "../../services/list-currencies";
import { updateCurrencyRateService } from "../../services/update-currency";

const tags = ["Currencies v2"];
const codeParams = z.object({ code: z.string().length(3).toUpperCase() });

const listRoute = createRoute({ method: "get", path: "/v2/currencies", tags, summary: "List currencies and their manual rates", responses: v2Responses });
const upsertRoute = createRoute({
  method: "post",
  path: "/v2/currencies",
  tags,
  summary: "Add or replace a currency (manualRate = units of it per 1 base unit)",
  request: jsonBody(z.object({ code: z.string().length(3).toUpperCase(), name: z.string().min(1), symbol: z.string().min(1), manualRate: z.number().positive() })),
  responses: v2Responses,
});
const rateRoute = createRoute({
  method: "patch",
  path: "/v2/currencies/{code}",
  tags,
  summary: "Update a currency's rate (applies to new entries; stored base amounts are not rewritten)",
  request: { params: codeParams, ...jsonBody(z.object({ manualRate: z.number().positive() })) },
  responses: v2Responses,
});
const deleteRouteDef = createRoute({ method: "delete", path: "/v2/currencies/{code}", tags, summary: "Remove an unused currency", request: { params: codeParams }, responses: v2Responses });

const serialize = (c: { code: string; name: string; symbol: string; manualRate: number; updatedAt: Date }) => ({
  code: c.code,
  name: c.name,
  symbol: c.symbol,
  manualRate: c.manualRate,
  updatedAt: c.updatedAt.toISOString(),
});

export const v2Currencies = createRouter()
  .openapi(listRoute, v2Handler(listRoute, async (_c, userId) => {
    const [user, currencies] = await Promise.all([prisma.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }), listCurrencies(userId, prisma)]);
    return { baseCurrency: user?.baseCurrency, currencies: currencies.map(serialize) };
  }))
  .openapi(upsertRoute, v2Handler(upsertRoute, async (c, userId) => serialize(await createCurrency({ userId, ...c.req.valid("json") }, prisma))))
  .openapi(rateRoute, v2Handler(rateRoute, async (c, userId) => serialize(await updateCurrencyRateService(userId, c.req.valid("param").code, c.req.valid("json").manualRate, prisma))))
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
