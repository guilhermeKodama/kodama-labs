import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { deleteCurrencyService } from "../../services/delete-currency";
import { rebaseCurrencies, relabelCurrencySources } from "../../services/fx-preferences";
import { updateCurrencyRateService } from "../../services/update-currency";

/**
 * /v2/currencies: listing with the inverse rate, adding and re-rating by
 * hand, the dated rate, the guarded delete and the user's own refresh (the
 * providers stubbed: nothing leaves the machine).
 */

const USER = "test-user-currencies-v2-a";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const rowOf = (code: string) => prisma.currency.findUnique({ where: { userId_code: { userId: USER, code } } });

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("listing and adding currencies", () => {
  it("lists the currencies with the base, the inverse rate and when the rate was set", async () => {
    const r = await call("GET", "/v2/currencies");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ baseCurrency: "BRL", fxAutoUpdate: true });
    expect(r.body.currencies).toHaveLength(1);
    expect(r.body.currencies[0]).toMatchObject({ code: "USD", name: "US Dollar", symbol: "$", manualRate: 0.2, basePerUnit: 5, source: "manual", rateUpdatedAt: null });
  });

  it("gives no inverse for a rate of zero", async () => {
    await prisma.currency.update({ where: { userId_code: { userId: USER, code: "USD" } }, data: { manualRate: 0 } });
    expect((await call("GET", "/v2/currencies")).body.currencies[0]).toMatchObject({ manualRate: 0, basePerUnit: null });
  });

  it("adds a currency by hand and replaces the name, symbol and rate of one it has", async () => {
    const added = await call("POST", "/v2/currencies", { code: "eur", name: "Euro", symbol: "€", manualRate: 0.16 });
    expect(added).toMatchObject({ status: 200, body: { code: "EUR", name: "Euro", symbol: "€", manualRate: 0.16, source: "manual" } });
    expect(added.body.rateUpdatedAt).toEqual(expect.any(String));
    const replaced = await call("POST", "/v2/currencies", { code: "USD", name: "Dólar", symbol: "US$", manualRate: 0.25 });
    expect(replaced.body).toMatchObject({ code: "USD", name: "Dólar", manualRate: 0.25, basePerUnit: 4 });
    expect(await prisma.currency.count({ where: { userId: USER } })).toBe(2);
  });

  it("refuses a rate that is not positive", async () => {
    expect((await call("POST", "/v2/currencies", { code: "EUR", name: "Euro", symbol: "€", manualRate: 0 })).status).toBe(422);
    expect((await call("PATCH", "/v2/currencies/USD", { manualRate: -1 })).status).toBe(422);
  });
});

describe("re-rating a currency by hand", () => {
  it("sets the rate and labels it manual, so the automatic refresh keeps it", async () => {
    await prisma.currency.update({ where: { userId_code: { userId: USER, code: "USD" } }, data: { source: "ptax" } });
    const r = await call("PATCH", "/v2/currencies/usd", { manualRate: 0.25 });
    expect(r).toMatchObject({ status: 200, body: { code: "USD", manualRate: 0.25, basePerUnit: 4, source: "manual" } });
    expect(await rowOf("USD")).toMatchObject({ manualRate: 0.25, source: "manual" });
  });

  it("answers 404 for a currency the user does not have (route and service)", async () => {
    expect(await call("PATCH", "/v2/currencies/GBP", { manualRate: 0.2 })).toMatchObject({ status: 404, body: { code: "currency.not_found" } });
    await expect(updateCurrencyRateService(USER, "GBP", 0.2, prisma)).rejects.toMatchObject({ status: 404, code: "currency.not_found" });
    await expect(updateCurrencyRateService(`${USER}-nobody`, "USD", 0.2, prisma)).rejects.toMatchObject({ code: "currency.not_found" });
  });
});

describe("the rate on a date", () => {
  it("is 1 for the base currency and the user's rate for another when no earlier close is stored", async () => {
    expect((await call("GET", "/v2/currencies/BRL/rate?date=2000-01-03")).body).toEqual({ code: "BRL", date: "2000-01-03", rate: 1 });
    expect((await call("GET", "/v2/currencies/usd/rate?date=2000-01-03")).body).toEqual({ code: "USD", date: "2000-01-03", rate: 5 });
  });

  it("answers 404 for a currency with no rate, and 422 for a date that is no date", async () => {
    expect(await call("GET", "/v2/currencies/GBP/rate?date=2000-01-03")).toMatchObject({ status: 404, body: { code: "currency.not_found" } });
    expect((await call("GET", "/v2/currencies/USD/rate?date=ontem")).status).toBe(422);
  });
});

describe("deleting a currency", () => {
  it("removes an unused currency", async () => {
    const r = await call("DELETE", "/v2/currencies/USD");
    expect(r).toMatchObject({ status: 200, body: { success: true, code: "USD" } });
    expect(await rowOf("USD")).toBeNull();
  });

  it("refuses the base currency (422), and one an account or an entry uses (409, with the counts)", async () => {
    expect(await call("DELETE", "/v2/currencies/BRL")).toMatchObject({ status: 422, body: { code: "currency.base_protected" } });

    const usdAccount = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Conta USD", currency: "USD" } });
    expect(await call("DELETE", "/v2/currencies/USD")).toMatchObject({ status: 409, body: { code: "currency.in_use", params: { code: "USD", accounts: 1, entries: 0 } } });
    await createEntry(USER, { kind: "expense", accountId: usdAccount.id, amount: 5, description: "Coffee", date: "2026-09-02" }, prisma);
    expect(await call("DELETE", "/v2/currencies/USD")).toMatchObject({ status: 409, body: { params: { accounts: 1, entries: 1 } } });
    expect(await rowOf("USD")).not.toBeNull();
  });

  it("does not count an archived account or a trashed entry as use", async () => {
    const usdAccount = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Conta USD", currency: "USD" } });
    const entry = (await createEntry(USER, { kind: "expense", accountId: usdAccount.id, amount: 5, description: "Coffee", date: "2026-09-02" }, prisma)).entryIds[0];
    await prisma.ledgerEntry.update({ where: { id: entry }, data: { deletedAt: new Date() } });
    await prisma.account.update({ where: { id: usdAccount.id }, data: { archivedAt: new Date() } });
    expect((await call("DELETE", "/v2/currencies/USD")).status).toBe(200);
  });

  it("answers 404 for a currency the user does not have (route and service)", async () => {
    expect(await call("DELETE", "/v2/currencies/GBP")).toMatchObject({ status: 404, body: { code: "currency.not_found" } });
    await expect(deleteCurrencyService(USER, "GBP", prisma)).rejects.toMatchObject({ status: 404, code: "currency.not_found" });
    await expect(deleteCurrencyService(USER, "USD", prisma)).resolves.toMatchObject({ code: "USD" });
    expect(await rowOf("USD")).toBeNull();
  });
});

describe("POST /v2/currencies/refresh", () => {
  const frankfurter = (rates: Record<string, number>) => new Response(JSON.stringify({ base: "USD", date: "2026-10-02", rates }), { status: 200, headers: { "content-type": "application/json" } });

  /** A USD-based user holding BRL from the ECB: no PTAX, so nothing outside this user's rows is written. */
  async function usdUser() {
    await prisma.user.update({ where: { id: USER }, data: { baseCurrency: "USD", fxAutoUpdate: true } });
    await prisma.currency.deleteMany({ where: { userId: USER } });
    await prisma.currency.createMany({
      data: [
        { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 1, source: "ecb" },
        { userId: USER, code: "BRL", name: "Real", symbol: "R$", manualRate: 4, source: "ecb" },
      ],
    });
  }

  it("fetches the user's automatic rates and answers with the list and the counts", async () => {
    await usdUser();
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => frankfurter({ BRL: 5.2 }));
    vi.stubGlobal("fetch", fetcher);
    const r = await call("POST", "/v2/currencies/refresh");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ baseCurrency: "USD", fxAutoUpdate: true, ratesUpdated: 1, errors: 0 });
    expect(r.body.currencies.find((c: { code: string }) => c.code === "BRL")).toMatchObject({ manualRate: 5.2, source: "ecb" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("base=USD&symbols=BRL");
    expect((await rowOf("BRL"))?.manualRate).toBe(5.2);
  });

  it("counts a provider that fails and keeps the rates it had", async () => {
    await usdUser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await call("POST", "/v2/currencies/refresh");
    quiet.mockRestore();
    expect(r.body).toMatchObject({ ratesUpdated: 0, errors: 1 });
    expect((await rowOf("BRL"))?.manualRate).toBe(4);
  });

  it("does nothing for a user with the automatic update off", async () => {
    await usdUser();
    await prisma.user.update({ where: { id: USER }, data: { fxAutoUpdate: false } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await call("POST", "/v2/currencies/refresh")).body).toMatchObject({ ratesUpdated: 0, errors: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("re-expressing the rates against another base", () => {
  const seed = async (rows: { code: string; manualRate: number; source: string }[]) => {
    await prisma.currency.deleteMany({ where: { userId: USER } });
    await prisma.currency.createMany({ data: rows.map((r) => ({ userId: USER, name: r.code, symbol: r.code, ...r })) });
  };
  const rates = async () => Object.fromEntries((await prisma.currency.findMany({ where: { userId: USER } })).map((c) => [c.code, [c.manualRate, c.source]]));

  it("does nothing when the base does not change", async () => {
    await seed([{ code: "USD", manualRate: 0.2, source: "manual" }]);
    await rebaseCurrencies(USER, "BRL", "BRL", prisma, "pt-BR");
    expect(await rates()).toEqual({ USD: [0.2, "manual"] });
  });

  it("adds the old base as a row (1/factor) when the user had none, and divides the others by the new base's rate", async () => {
    await seed([
      { code: "USD", manualRate: 0.2, source: "ptax" },
      { code: "EUR", manualRate: 0.16, source: "manual" },
    ]);
    await rebaseCurrencies(USER, "BRL", "USD", prisma, "pt-BR");
    const after = await rates();
    expect(after.USD).toEqual([1, "ptax"]);
    expect(after.EUR).toEqual([0.16 / 0.2, "manual"]);
    expect(after.BRL).toEqual([1 / 0.2, "ecb"]);
  });

  it("adds a new base the user has no row for at rate 1, and leaves the other rates as they were", async () => {
    await seed([{ code: "USD", manualRate: 0.2, source: "ptax" }]);
    await rebaseCurrencies(USER, "BRL", "EUR", prisma, "en");
    const after = await rates();
    expect(after.EUR).toEqual([1, "ecb"]);
    expect(after.USD).toEqual([0.2, "ecb"]);
    expect(await prisma.currency.findUniqueOrThrow({ where: { userId_code: { userId: USER, code: "EUR" } } })).toMatchObject({ name: "Euro", symbol: "€" });
  });

  it("relabels the sources: every currency but the base is manual when the automatic update is off, automatic when it is on", async () => {
    await seed([
      { code: "BRL", manualRate: 1, source: "manual" },
      { code: "USD", manualRate: 0.2, source: "manual" },
      { code: "ARS", manualRate: 250, source: "manual" },
    ]);
    await relabelCurrencySources(USER, "BRL", true, prisma);
    expect(await rates()).toEqual({ BRL: [1, "manual"], USD: [0.2, "ptax"], ARS: [250, "ecb"] });
    await relabelCurrencySources(USER, "BRL", false, prisma);
    expect(await rates()).toEqual({ BRL: [1, "manual"], USD: [0.2, "manual"], ARS: [250, "manual"] });
  });
});
