import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@capital/server/lib/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { updateAllCurrencyRates } from "../update-rates-from-api";

/**
 * The automatic FX refresh when providers or the database fail: the failure
 * is counted, logged and left for the next run, and the rows already
 * holding the latest quote are counted as unchanged. The providers are
 * stubbed; the PTAX day table is global, so its writes are replaced by a
 * stub too.
 */

const BRL_USER = "test-user-fx-errors-brl-001";
const USD_USER = "test-user-fx-errors-usd-001";
const NOW = new Date("2026-10-05T14:00:00Z");
const FRIDAY_CLOSE = new Date("2026-10-02T16:10:17.000Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PTAX_OK = { value: [{ cotacaoVenda: 5.2, dataHoraCotacao: "2026-10-02 13:10:17.34", tipoBoletim: "Fechamento" }] };

async function createUser(id: string, baseCurrency: string, currencies: { code: string; manualRate: number; source: string; rateUpdatedAt?: Date }[]) {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id, baseCurrency, fxAutoUpdate: true } });
  await prisma.currency.createMany({ data: currencies.map((c) => ({ userId: id, name: c.code, symbol: c.code, ...c })) });
}
const rateOf = (userId: string, code: string) => prisma.currency.findUniqueOrThrow({ where: { userId_code: { userId, code } } });

/** The database with the PTAX day table replaced: its writes never reach the shared table. */
const withDayStub = (upsert: () => Promise<unknown>) => ({ user: prisma.user, currency: prisma.currency, currencyRateDay: { upsert } }) as unknown as DbClient;

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await createUser(BRL_USER, "BRL", [
    { code: "BRL", manualRate: 1, source: "ptax" },
    { code: "USD", manualRate: 0.18, source: "ptax" },
    { code: "ARS", manualRate: 250, source: "ecb" },
  ]);
  await createUser(USD_USER, "USD", [
    { code: "USD", manualRate: 1, source: "ecb" },
    { code: "EUR", manualRate: 0.9, source: "ecb" },
  ]);
});

afterEach(() => {
  logged.mockRestore();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [BRL_USER, USD_USER] } } });
});

describe("updateAllCurrencyRates failures", () => {
  it("counts a PTAX request the BCB refuses, and one that has no closing bulletin, and keeps those rates", async () => {
    const refused = await updateAllCurrencyRates(withDayStub(async () => ({})), {
      now: NOW,
      userIds: [BRL_USER],
      fetch: async (url) => (url.includes("olinda") ? new Response("down", { status: 502 }) : json({ base: "BRL", date: "2026-10-02", rates: { ARS: 280.5 } })),
    });
    expect(refused).toMatchObject({ usersProcessed: 1, ratesRequested: 2, errors: 1, ratesUpdated: 1 });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("PTAX USD: HTTP 502"));
    expect((await rateOf(BRL_USER, "USD")).manualRate).toBe(0.18);
    expect((await rateOf(BRL_USER, "ARS")).manualRate).toBe(280.5);

    const empty = await updateAllCurrencyRates(withDayStub(async () => ({})), { now: NOW, userIds: [BRL_USER], fetch: async () => json({ value: [] }) });
    expect(empty.errors).toBeGreaterThanOrEqual(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("no closing bulletin"));
    expect((await rateOf(BRL_USER, "USD")).manualRate).toBe(0.18);
  });

  it("counts an ECB request that fails and leaves the rates of that base alone", async () => {
    const r = await updateAllCurrencyRates(withDayStub(async () => ({})), { now: NOW, userIds: [USD_USER], fetch: async () => new Response("down", { status: 500 }) });
    expect(r).toMatchObject({ usersProcessed: 1, ratesRequested: 1, errors: 1, ratesUpdated: 0 });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Frankfurter USD: HTTP 500"));
    expect((await rateOf(USD_USER, "EUR")).manualRate).toBe(0.9);
  });

  it("counts a failure to store the PTAX day, and still updates the user's rate", async () => {
    const upsert = vi.fn(async () => {
      throw new Error("day table down");
    });
    const r = await updateAllCurrencyRates(withDayStub(upsert), {
      now: NOW,
      userIds: [BRL_USER],
      fetch: async (url) => (url.includes("olinda") ? json(PTAX_OK) : json({ base: "BRL", date: "2026-10-02", rates: {} })),
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ errors: 1, ratesUpdated: 1 });
    expect(logged).toHaveBeenCalledWith("[RateUpdate] day table down");
    expect(await rateOf(BRL_USER, "USD")).toMatchObject({ manualRate: 1 / 5.2, source: "ptax", rateUpdatedAt: FRIDAY_CLOSE });
  });

  it("stores the PTAX day the closing bulletin belongs to, as BRL per unit", async () => {
    const upsert = vi.fn(async () => ({}));
    await updateAllCurrencyRates(withDayStub(upsert), { now: NOW, userIds: [BRL_USER], fetch: async (url) => (url.includes("olinda") ? json(PTAX_OK) : json({ date: "2026-10-02", rates: {} })) });
    expect(upsert).toHaveBeenCalledWith({
      where: { code_date: { code: "USD", date: new Date("2026-10-02T00:00:00.000Z") } },
      create: { code: "USD", date: new Date("2026-10-02T00:00:00.000Z"), brlPerUnit: 5.2, source: "ptax" },
      update: { brlPerUnit: 5.2, source: "ptax" },
    });
  });

  it("counts a rate already holding the latest quote as unchanged, so a second run writes nothing", async () => {
    const fetcher = async (url: string) => (url.includes("olinda") ? json(PTAX_OK) : json({ base: "BRL", date: "2026-10-02", rates: { ARS: 280.5 } }));
    const first = await updateAllCurrencyRates(withDayStub(async () => ({})), { now: NOW, userIds: [BRL_USER], fetch: fetcher });
    expect(first).toMatchObject({ ratesUpdated: 2, ratesUnchanged: 0, errors: 0 });
    const updatedAt = (await rateOf(BRL_USER, "USD")).updatedAt;
    const second = await updateAllCurrencyRates(withDayStub(async () => ({})), { now: NOW, userIds: [BRL_USER], fetch: fetcher });
    expect(second).toMatchObject({ ratesUpdated: 0, ratesUnchanged: 2, errors: 0 });
    expect((await rateOf(BRL_USER, "USD")).updatedAt).toEqual(updatedAt);
  });
});
