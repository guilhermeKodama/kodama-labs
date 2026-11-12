import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { getMe, serializeUser, updatePreferences } from "../services/me";

/** The user's profile and preferences through the service the routes and the MCP settings tool share. */
const USER = "test-user-me-service-a";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const userRow = () => prisma.user.findUniqueOrThrow({ where: { id: USER } });

describe("getMe", () => {
  it("answers the user, the personal entity and every entity the UI scopes by", async () => {
    const me = await getMe(USER, prisma);
    expect(me).toMatchObject({ id: USER, email: `${USER}@example.com`, baseCurrency: "BRL", personalEntityId: f.pfId, textSize: "md" });
    expect(me.entities.map((e) => [e.id, e.kind, e.name, e.defaultCurrency]).sort()).toEqual(
      [
        [f.pfId, "personal", "PF", "BRL"],
        [f.pjId, "business", "Kodama LTDA", "BRL"],
      ].sort()
    );
    expect(me.createdAt).toBe((await userRow()).createdAt.toISOString());
  });

  it("answers 404 for a user that does not exist", async () => {
    await expect(getMe("nobody", prisma)).rejects.toMatchObject({ status: 404, code: "user.not_found" });
  });

  it("shows the medium text size for a stored size outside the vocabulary", async () => {
    await prisma.user.update({ where: { id: USER }, data: { textSize: "xxl" } });
    expect(serializeUser(await userRow()).textSize).toBe("md");
    await prisma.user.update({ where: { id: USER }, data: { textSize: "lg" } });
    expect(serializeUser(await userRow()).textSize).toBe("lg");
  });
});

describe("updatePreferences", () => {
  it("answers 404 for a user that does not exist", async () => {
    await expect(updatePreferences("nobody", { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "user.not_found" });
  });

  it("stores the name, locale, time zone and text size it is given and leaves the rest as it was", async () => {
    const before = await userRow();
    const saved = await updatePreferences(USER, { name: "Ana", locale: "en", timezone: "America/New_York", textSize: "lg" }, prisma);
    expect(saved).toMatchObject({ name: "Ana", locale: "en", timezone: "America/New_York", textSize: "lg", theme: before.theme, dateFormat: before.dateFormat, numberFormat: before.numberFormat, baseCurrency: "BRL" });
    expect(await userRow()).toMatchObject({ name: "Ana", locale: "en", timezone: "America/New_York", textSize: "lg", theme: before.theme });
  });

  it("refuses a time zone it does not know (422 user.invalid_timezone), changing nothing", async () => {
    await expect(updatePreferences(USER, { name: "Ana", timezone: "Mars/Olympus" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "user.invalid_timezone",
      params: { timezone: "Mars/Olympus" },
    });
    expect((await userRow()).name).toBe(f.userId);
  });

  it("codes each invalid format as user.invalid_preference with the field and the value", async () => {
    const bad = (patch: Parameters<typeof updatePreferences>[1], field: string, value: string) =>
      expect(updatePreferences(USER, patch, prisma)).rejects.toMatchObject({ status: 422, code: "user.invalid_preference", params: { field, value } });
    await bad({ theme: "sepia" }, "theme", "sepia");
    await bad({ textSize: "huge" }, "textSize", "huge");
    await bad({ dateFormat: "dd.MM.yyyy" }, "dateFormat", "dd.MM.yyyy");
    await bad({ numberFormat: "de-DE" }, "numberFormat", "de-DE");
  });

  it("changes the base currency freely while the ledger is empty, in upper case, and re-expresses the rates", async () => {
    await prisma.currency.createMany({
      data: [
        { userId: USER, code: "BRL", name: "Real", symbol: "R$", manualRate: 1, source: "manual" },
        { userId: USER, code: "USD", name: "Dólar", symbol: "US$", manualRate: 0.2, source: "manual" },
      ],
    });
    const saved = await updatePreferences(USER, { baseCurrency: "usd" }, prisma);
    expect(saved.baseCurrency).toBe("USD");
    const rates = Object.fromEntries((await prisma.currency.findMany({ where: { userId: USER } })).map((c) => [c.code, c.manualRate]));
    expect(rates).toEqual({ USD: 1, BRL: 5 });
  });

  it("keeps the base once the ledger has entries (409, with the count), unless forced; setting the same base is no change", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "Pao", date: "2026-09-02" }, prisma);
    await expect(updatePreferences(USER, { baseCurrency: "USD" }, prisma)).rejects.toMatchObject({ status: 409, code: "user.base_currency_locked", params: { count: 1 } });
    expect((await userRow()).baseCurrency).toBe("BRL");
    expect((await updatePreferences(USER, { baseCurrency: "brl", name: "Mesmo" }, prisma)).baseCurrency).toBe("BRL");
    expect((await updatePreferences(USER, { baseCurrency: "EUR" }, prisma, { force: true })).baseCurrency).toBe("EUR");
  });

  it("relabels the currencies when the automatic update is switched, and not when the flag is unchanged", async () => {
    await prisma.currency.createMany({ data: [{ userId: USER, code: "USD", name: "Dólar", symbol: "US$", manualRate: 0.2, source: "manual" }] });
    await prisma.user.update({ where: { id: USER }, data: { fxAutoUpdate: false } });
    await updatePreferences(USER, { fxAutoUpdate: false }, prisma);
    expect((await prisma.currency.findUniqueOrThrow({ where: { userId_code: { userId: USER, code: "USD" } } })).source).toBe("manual");
    expect((await updatePreferences(USER, { fxAutoUpdate: true }, prisma)).fxAutoUpdate).toBe(true);
    expect((await prisma.currency.findUniqueOrThrow({ where: { userId_code: { userId: USER, code: "USD" } } })).source).toBe("ptax");
  });
});
