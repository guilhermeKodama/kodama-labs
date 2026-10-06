import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { updatePreferences } from "../services/me";

/** PATCH /v2/me: formats in the stored vocabulary, theme, locale cookie, and what base and FX changes do to the currencies. */
const USER = "test-user-s6-preferences-001";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

async function seedCurrencies() {
  await prisma.currency.deleteMany({ where: { userId: USER } });
  await prisma.currency.createMany({
    data: [
      { userId: USER, code: "BRL", name: "Real", symbol: "R$", manualRate: 1, source: "ptax" },
      { userId: USER, code: "USD", name: "Dólar", symbol: "US$", manualRate: 0.2, source: "ptax" },
      { userId: USER, code: "EUR", name: "Euro", symbol: "€", manualRate: 0.16, source: "manual" },
      { userId: USER, code: "ARS", name: "Peso", symbol: "$", manualRate: 250, source: "ecb" },
    ],
  });
}

const currencies = async () =>
  Object.fromEntries((await prisma.currency.findMany({ where: { userId: USER } })).map((c) => [c.code, { rate: c.manualRate, source: c.source }]));

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await seedCurrencies();
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const patchMe = async (body: unknown) => {
  const res = await app.request("/api/v2/me", { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { res, status: res.status, body: await res.json() };
};

describe("PATCH /v2/me formats and theme", () => {
  it("stores the normalized vocabulary and accepts the older number spellings", async () => {
    const saved = await patchMe({ numberFormat: "en-US", dateFormat: "yyyy-MM-dd", theme: "dark" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ numberFormat: "en-US", dateFormat: "yyyy-MM-dd", theme: "dark" });
    expect((await patchMe({ numberFormat: "1.234,56" })).body.numberFormat).toBe("pt-BR");
    expect((await patchMe({ numberFormat: "1,234.56" })).body.numberFormat).toBe("en-US");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: USER } })).toMatchObject({ numberFormat: "en-US", dateFormat: "yyyy-MM-dd", theme: "dark" });
  });

  it("rejects values outside the vocabulary with field issues", async () => {
    for (const body of [{ numberFormat: "de-DE" }, { dateFormat: "dd.MM.yyyy" }, { theme: "sepia" }, { baseCurrency: "R$1" }]) {
      const { status, body: err } = await patchMe(body);
      expect(status).toBe(422);
      expect(err).toMatchObject({ code: "validation", issues: [expect.objectContaining({ path: Object.keys(body)[0] })] });
    }
  });

  it("codes an invalid value written through the service (the MCP settings tool sends free text)", async () => {
    await expect(updatePreferences(USER, { numberFormat: "de-DE" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "user.invalid_preference",
      params: { field: "numberFormat", value: "de-DE" },
    });
    await expect(updatePreferences(USER, { theme: "auto" }, prisma)).rejects.toMatchObject({ code: "user.invalid_preference", params: { field: "theme", value: "auto" } });
  });

  it("sets NEXT_LOCALE only when the locale is sent", async () => {
    const withLocale = await patchMe({ locale: "en" });
    expect(withLocale.res.headers.getSetCookie().some((c) => c.startsWith("NEXT_LOCALE=en;"))).toBe(true);
    const without = await patchMe({ name: "Gui" });
    expect(without.res.headers.getSetCookie().some((c) => c.startsWith("NEXT_LOCALE="))).toBe(false);
  });
});

describe("PATCH /v2/me base currency", () => {
  it("re-expresses every rate against the new base and relabels the automatic ones", async () => {
    const { status, body } = await patchMe({ baseCurrency: "usd" });
    expect(status).toBe(200);
    expect(body.baseCurrency).toBe("USD");
    const rows = await currencies();
    expect(rows.USD).toEqual({ rate: 1, source: "ptax" }); // the base row's own label does not matter
    expect(rows.BRL.rate).toBeCloseTo(5, 12); // 1 USD = 5 BRL
    expect(rows.BRL.source).toBe("ecb"); // PTAX only quotes against BRL
    expect(rows.EUR).toEqual({ rate: expect.closeTo(0.8, 12), source: "manual" });
    expect(rows.ARS.rate).toBeCloseTo(1250, 9);

    // And back: the rates return to what they were, PTAX again where it quotes.
    await patchMe({ baseCurrency: "BRL" });
    const back = await currencies();
    expect(back.BRL).toMatchObject({ rate: 1 });
    expect(back.USD.rate).toBeCloseTo(0.2, 12);
    expect(back.USD.source).toBe("ptax");
    expect(back.EUR).toEqual({ rate: expect.closeTo(0.16, 12), source: "manual" });
    expect(back.ARS).toEqual({ rate: expect.closeTo(250, 9), source: "ecb" });
  });

  it("adds a base the user has no row for and leaves the other rates alone", async () => {
    await patchMe({ baseCurrency: "CHF" });
    const rows = await currencies();
    expect(rows.CHF).toMatchObject({ rate: 1 });
    expect(rows.USD.rate).toBe(0.2);
    expect(await prisma.currency.findUniqueOrThrow({ where: { userId_code: { userId: USER, code: "CHF" } } })).toMatchObject({ name: "Franco suíço" });
  });

  it("is refused with a coded 409 once entries exist, unless forced", async () => {
    const entry = await app.request("/api/v2/ledger/entries", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-01", description: "x" }),
    });
    expect(entry.status).toBe(200);
    const refused = await patchMe({ baseCurrency: "USD" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "user.base_currency_locked", params: { count: 1 } });
    expect((await currencies()).USD.rate).toBe(0.2);

    const forced = await patchMe({ baseCurrency: "USD", force: true });
    expect(forced.status).toBe(200);
    expect((await currencies()).BRL.rate).toBeCloseTo(5, 12);
  });
});

describe("PATCH /v2/me fxAutoUpdate", () => {
  it("labels every rate manual when turned off and hands them back to PTAX / ECB when turned on", async () => {
    expect((await patchMe({ fxAutoUpdate: false })).body.fxAutoUpdate).toBe(false);
    const off = await currencies();
    expect([off.USD.source, off.EUR.source, off.ARS.source]).toEqual(["manual", "manual", "manual"]);
    expect(off.USD.rate).toBe(0.2);

    expect((await patchMe({ fxAutoUpdate: true })).body.fxAutoUpdate).toBe(true);
    const on = await currencies();
    expect([on.USD.source, on.EUR.source, on.ARS.source]).toEqual(["ptax", "ptax", "ecb"]);
    expect(on.BRL.source).toBe("ptax"); // the base row is left as it is
  });

  it("keeps the labels when the flag is sent unchanged", async () => {
    await patchMe({ fxAutoUpdate: true });
    expect((await currencies()).EUR.source).toBe("manual");
  });
});
