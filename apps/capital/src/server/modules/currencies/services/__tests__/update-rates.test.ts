import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { updateAllCurrencyRates } from "../update-rates-from-api";

/**
 * The automatic FX refresh, with the providers mocked (no network): PTAX on
 * a BRL base, the ECB otherwise, manual rates and users with the automatic
 * update off left alone. Scoped to this file's users, since capital_dev is
 * shared with other test files.
 */
const BRL_USER = "test-user-fx-refresh-brl-001";
const USD_USER = "test-user-fx-refresh-usd-001";
const OFF_USER = "test-user-fx-refresh-off-001";
const USERS = [BRL_USER, USD_USER, OFF_USER];
const NOW = new Date("2026-10-05T14:00:00Z"); // Monday 11:00 in Brasília, before the day's PTAX close
const TYPED_AT = new Date("2026-09-15T12:00:00Z");
const FRIDAY_CLOSE = new Date("2026-10-02T16:10:17.000Z");

const PTAX_USD = {
  value: [
    { cotacaoVenda: 5.2132, dataHoraCotacao: "2026-10-01 13:03:11.35", tipoBoletim: "Fechamento" },
    { cotacaoVenda: 5.1912, dataHoraCotacao: "2026-10-02 13:10:17.34", tipoBoletim: "Intermediário" },
    { cotacaoVenda: 5.1991, dataHoraCotacao: "2026-10-02 13:10:17.44", tipoBoletim: "Fechamento" },
    { cotacaoVenda: 5.3001, dataHoraCotacao: "2026-10-05 10:05:00.00", tipoBoletim: "Abertura" },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Answers like the BCB and Frankfurter would; anything else is a test bug. */
const providers = vi.fn(async (url: string) => {
  if (url.includes("olinda.bcb.gov.br") && url.includes("@moeda='USD'")) return json(PTAX_USD);
  if (url.startsWith("https://api.frankfurter.dev/v1/latest?base=BRL&symbols=ARS")) return json({ base: "BRL", date: "2026-10-02", rates: { ARS: 280.5 } });
  if (url.startsWith("https://api.frankfurter.dev/v1/latest?base=USD&symbols=")) return json({ base: "USD", date: "2026-10-02", rates: { BRL: 5.2, EUR: 0.85 } });
  throw new Error(`unexpected request ${url}`);
});

async function createUser(id: string, baseCurrency: string, fxAutoUpdate: boolean, currencies: { code: string; manualRate: number; source: string; rateUpdatedAt?: Date }[]) {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id, baseCurrency, fxAutoUpdate } });
  await prisma.currency.createMany({ data: currencies.map((c) => ({ userId: id, name: c.code, symbol: c.code, ...c })) });
}

const rateOf = (userId: string, code: string) => prisma.currency.findUniqueOrThrow({ where: { userId_code: { userId, code } } });

beforeEach(async () => {
  providers.mockClear();
  await createUser(BRL_USER, "BRL", true, [
    { code: "BRL", manualRate: 1, source: "ptax" },
    { code: "USD", manualRate: 0.18, source: "ptax" },
    { code: "EUR", manualRate: 0.15, source: "manual", rateUpdatedAt: TYPED_AT },
    { code: "ARS", manualRate: 250, source: "ecb" },
  ]);
  await createUser(USD_USER, "USD", true, [
    { code: "USD", manualRate: 1, source: "ecb" },
    { code: "BRL", manualRate: 5, source: "ecb" },
    { code: "EUR", manualRate: 0.9, source: "ecb" },
  ]);
  await createUser(OFF_USER, "BRL", false, [{ code: "USD", manualRate: 0.1, source: "ptax" }]);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  // The refresh writes the shared PTAX day. Put the embedded close back.
  const date = new Date("2026-10-02T00:00:00.000Z");
  await prisma.currencyRateDay.upsert({
    where: { code_date: { code: "USD", date } },
    create: { code: "USD", date, brlPerUnit: 5.2238, source: "ptax" },
    update: { brlPerUnit: 5.2238, source: "ptax" },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: USERS } } });
});

describe("updateAllCurrencyRates", () => {
  it("writes PTAX on a BRL base and the ECB otherwise, skipping manual rates and users with the update off", async () => {
    const closeDay = new Date("2026-10-02T00:00:00.000Z");
    const aberturaDay = new Date("2026-10-05T00:00:00.000Z");
    const seeded = await prisma.currencyRateDay.findUnique({ where: { code_date: { code: "USD", date: closeDay } } });
    const seededAbertura = await prisma.currencyRateDay.findUnique({ where: { code_date: { code: "USD", date: aberturaDay } } });
    const result = await updateAllCurrencyRates(prisma, { now: NOW, fetch: providers, userIds: USERS });
    expect(result).toEqual({ usersProcessed: 2, ratesUpdated: 4, ratesUnchanged: 0, manualSkipped: 1, errors: 0 });

    // A Float column round-trips to within an ulp.
    const usd = await rateOf(BRL_USER, "USD");
    expect(usd).toMatchObject({ source: "ptax", rateUpdatedAt: FRIDAY_CLOSE });
    expect(usd.manualRate).toBeCloseTo(1 / 5.1991, 12);
    const close = await prisma.currencyRateDay.findUniqueOrThrow({ where: { code_date: { code: "USD", date: closeDay } } });
    expect(Number(close.brlPerUnit)).toBeCloseTo(5.1991, 4);
    // The Monday Abertura (5.3001) is not a Fechamento, so that day is left as it was.
    const abertura = await prisma.currencyRateDay.findUnique({ where: { code_date: { code: "USD", date: aberturaDay } } });
    expect(abertura?.brlPerUnit?.toString() ?? null).toBe(seededAbertura?.brlPerUnit?.toString() ?? null);
    expect(Number(abertura?.brlPerUnit ?? 0)).not.toBeCloseTo(5.3001, 4);
    if (seeded) await prisma.currencyRateDay.update({ where: { code_date: { code: "USD", date: closeDay } }, data: { brlPerUnit: seeded.brlPerUnit, source: seeded.source } });
    else await prisma.currencyRateDay.delete({ where: { code_date: { code: "USD", date: closeDay } } });
    expect(await rateOf(BRL_USER, "ARS")).toMatchObject({ manualRate: 280.5, source: "ecb", rateUpdatedAt: new Date("2026-10-02T14:00:00Z") });
    expect(await rateOf(BRL_USER, "EUR")).toMatchObject({ manualRate: 0.15, source: "manual", rateUpdatedAt: TYPED_AT });
    expect(await rateOf(BRL_USER, "BRL")).toMatchObject({ manualRate: 1 });
    expect(await rateOf(USD_USER, "BRL")).toMatchObject({ manualRate: 5.2, source: "ecb" });
    expect(await rateOf(USD_USER, "EUR")).toMatchObject({ manualRate: 0.85, source: "ecb" });
    expect(await rateOf(OFF_USER, "USD")).toMatchObject({ manualRate: 0.1, source: "ptax", rateUpdatedAt: null });

    // The manual EUR is never even asked for.
    const urls = providers.mock.calls.map((call) => call[0]);
    expect(urls.filter((u) => u.includes("olinda"))).toHaveLength(1);
    expect(urls.some((u) => u.includes("@moeda='EUR'"))).toBe(false);
  });

  it("is a no-op until a new quote is published", async () => {
    await updateAllCurrencyRates(prisma, { now: NOW, fetch: providers, userIds: USERS });
    const before = await rateOf(BRL_USER, "USD");
    const again = await updateAllCurrencyRates(prisma, { now: new Date(NOW.getTime() + 3600_000), fetch: providers, userIds: USERS });
    expect(again).toMatchObject({ ratesUpdated: 0, ratesUnchanged: 4 });
    expect((await rateOf(BRL_USER, "USD")).updatedAt).toEqual(before.updatedAt);
  });

  it("keeps the old rates when a provider fails", async () => {
    const closeDay = new Date("2026-01-02T00:00:00.000Z");
    const before = await prisma.currencyRateDay.findUnique({ where: { code_date: { code: "USD", date: closeDay } } });
    const failing = vi.fn(async (url: string) => (url.includes("olinda") ? json({ message: "down" }, 503) : providers(url)));
    const result = await updateAllCurrencyRates(prisma, { now: NOW, fetch: failing, userIds: USERS });
    expect(result).toMatchObject({ errors: 1, ratesUpdated: 3 });
    expect(await rateOf(BRL_USER, "USD")).toMatchObject({ manualRate: 0.18, rateUpdatedAt: null });
    const after = await prisma.currencyRateDay.findUnique({ where: { code_date: { code: "USD", date: closeDay } } });
    expect(after?.brlPerUnit?.toString() ?? null).toBe(before?.brlPerUnit?.toString() ?? null);
  });

  it("relabels an automatic rate whose source no longer fits the base", async () => {
    // EUR on a BRL base is quoted by PTAX; a stale "ecb" label (from an old base) is fixed by the refresh.
    await prisma.currency.update({ where: { userId_code: { userId: BRL_USER, code: "USD" } }, data: { source: "ecb" } });
    await updateAllCurrencyRates(prisma, { now: NOW, fetch: providers, userIds: [BRL_USER] });
    const usd = await rateOf(BRL_USER, "USD");
    expect(usd.source).toBe("ptax");
    expect(usd.manualRate).toBeCloseTo(1 / 5.1991, 12);
  });
});

describe("currency routes", () => {
  const app = createApp();
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  beforeEach(async () => {
    const session = await prisma.session.create({ data: { userId: BRL_USER, expiresAt: new Date(Date.now() + 3600_000) } });
    cookie = `capital_session=${session.id}`;
  });

  it("lists rates with their source, quote time and the base-per-unit rate the UI shows", async () => {
    const { status, body } = await call("GET", "/v2/currencies");
    expect(status).toBe(200);
    expect(body).toMatchObject({ baseCurrency: "BRL", fxAutoUpdate: true });
    const eur = body.currencies.find((c: { code: string }) => c.code === "EUR");
    expect(eur).toMatchObject({ manualRate: 0.15, source: "manual", rateUpdatedAt: TYPED_AT.toISOString() });
    expect(eur.basePerUnit).toBeCloseTo(1 / 0.15, 10);
  });

  it("labels a typed rate manual, and the refresh keeps it", async () => {
    vi.stubGlobal("fetch", providers);
    const before = Date.now();
    const patched = await call("PATCH", "/v2/currencies/usd", { manualRate: 0.19 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ code: "USD", manualRate: 0.19, source: "manual" });
    expect(new Date(patched.body.rateUpdatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const refreshed = await call("POST", "/v2/currencies/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ ratesUpdated: 1, errors: 0 }); // ARS only
    const byCode = Object.fromEntries(refreshed.body.currencies.map((c: { code: string }) => [c.code, c]));
    expect(byCode.USD).toMatchObject({ manualRate: 0.19, source: "manual" });
    expect(byCode.ARS).toMatchObject({ manualRate: 280.5, source: "ecb" });
    expect(providers.mock.calls.every((c) => !c[0].includes("olinda"))).toBe(true);
  });

  it("adds a currency with a typed rate as manual", async () => {
    const created = await call("POST", "/v2/currencies", { code: "gbp", name: "Libra", symbol: "£", manualRate: 0.14 });
    expect(created.body).toMatchObject({ code: "GBP", source: "manual", rateUpdatedAt: expect.any(String) });
  });
});
