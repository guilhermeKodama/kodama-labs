import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-v2-domain-routes-001";
const SIGNUP_EMAIL = "test-user-v2-signup-001@example.com";
const SIGNUP_EN_EMAIL = "test-user-v2-signup-en-001@example.com";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await prisma.user.deleteMany({ where: { email: { in: [SIGNUP_EMAIL, SIGNUP_EN_EMAIL] } } });
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
  app.request(`/api${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("v2 domain routes", () => {
  it("signs up a user with the PF entity, its account, system categories and the built-in view", async () => {
    await prisma.user.deleteMany({ where: { email: SIGNUP_EMAIL } });
    const res = await call("POST", "/v2/auth/signup", { email: SIGNUP_EMAIL, password: "secret-123", name: "New" }, {});
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/capital_session=/);
    const me = await (await call("GET", "/v2/me", undefined, { cookie: setCookie.split(";")[0] })).json();
    expect(me.entities).toEqual([expect.objectContaining({ kind: "personal" })]);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SIGNUP_EMAIL } });
    expect(user).toMatchObject({ baseCurrency: "BRL", locale: "pt-BR", theme: "light", dateFormat: "dd/MM/yyyy", numberFormat: "pt-BR" });
    expect(await prisma.account.count({ where: { userId: user.id, isDefault: true } })).toBe(1);
    expect(await prisma.category.count({ where: { userId: user.id, systemKey: "other_system" } })).toBe(1);
    expect(await prisma.savedView.count({ where: { userId: user.id, builtinKey: "all" } })).toBe(1);
    expect(me.locale).toBe("pt-BR");
    expect(await prisma.category.findFirst({ where: { userId: user.id, systemKey: "other_system" }, select: { name: true } })).toEqual({ name: "Outros" });
    const currencies = await prisma.currency.findMany({ where: { userId: user.id }, orderBy: { code: "asc" } });
    expect(currencies.map((c) => [c.code, c.name])).toEqual([["BRL", "Real brasileiro"], ["EUR", "Euro"], ["USD", "Dólar americano"]]);
    // manualRate is units per one BRL, so 1 / rate is the BRL price of one unit.
    expect(1 / currencies.find((c) => c.code === "USD")!.manualRate).toBeCloseTo(5.41, 3);
  });

  it("signs up in the request's locale: the body's, else the UI cookie, else Accept-Language", async () => {
    const signupWith = async (body: Record<string, unknown>, headers: Record<string, string>) => {
      await prisma.user.deleteMany({ where: { email: SIGNUP_EN_EMAIL } });
      const res = await call("POST", "/v2/auth/signup", { email: SIGNUP_EN_EMAIL, password: "secret-123", name: "New", ...body }, headers);
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string; locale: string };
    };

    const en = await signupWith({}, { "accept-language": "en-US,en;q=0.9,pt;q=0.8" });
    expect(en.locale).toBe("en");
    expect(await prisma.category.findFirst({ where: { userId: en.id, systemKey: "other_system" }, select: { name: true } })).toEqual({ name: "Other" });
    expect(await prisma.savedView.findFirst({ where: { userId: en.id, builtinKey: "all" }, select: { name: true } })).toEqual({ name: "All" });
    expect(await prisma.currency.findFirst({ where: { userId: en.id, code: "USD" }, select: { name: true, symbol: true } })).toEqual({ name: "US Dollar", symbol: "$" });

    expect((await signupWith({}, { "accept-language": "en-US", cookie: "NEXT_LOCALE=pt-BR" })).locale).toBe("pt-BR");
    expect((await signupWith({ locale: "en" }, { "accept-language": "pt-BR", cookie: "NEXT_LOCALE=pt-BR" })).locale).toBe("en");
    expect((await signupWith({}, { "accept-language": "de-DE" })).locale).toBe("pt-BR");
    expect((await call("POST", "/v2/auth/signup", { email: SIGNUP_EN_EMAIL, password: "secret-123", name: "New", locale: "fr" }, {})).status).toBe(422);
  });

  it("requires a session outside /v2/auth", async () => {
    expect((await call("GET", "/v2/me", undefined, {})).status).toBe(401);
    expect((await call("POST", "/v2/auth/login", { email: "nobody@example.com", password: "x" }, {})).status).toBe(401);
  });

  it("refuses to change the base currency once there are entries", async () => {
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-08-01", description: "x" });
    const res = await call("PATCH", "/v2/me", { baseCurrency: "USD" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "user.base_currency_locked", params: { count: 1 } });
    expect((await call("PATCH", "/v2/me", { timezone: "Europe/Lisbon" })).status).toBe(200);
  });

  it("serves budgets, overview, categories, recurring, investments and imports", async () => {
    const budget = await call("POST", "/v2/budgets", { categoryId: f.categories.Groceries, amount: 500, effectiveFrom: "2026-08" });
    expect(budget.status).toBe(200);
    const overview = await (await call("GET", "/v2/budgets/overview?month=2026-08")).json();
    expect(overview.budgets).toHaveLength(1);
    expect((await call("GET", "/v2/budgets/overview")).status).toBe(400);
    const year = await (await call("GET", "/v2/budgets/overview?year=2026")).json();
    expect(year.monthBudgets[7]).toBe(500);

    const cats = await (await call("GET", "/v2/categories?type=expense")).json();
    expect(cats.categories.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["Groceries", "Software"]));
    expect((await call("DELETE", `/v2/categories/${f.categories.Groceries}`)).status).toBe(409);

    const rule = await call("POST", "/v2/recurring", { kind: "expense", accountId: f.pfChecking, amount: 30, description: "Netflix", frequency: "monthly", startDate: "2026-09-01" });
    expect(rule.status).toBe(200);
    const { id: ruleId } = await rule.json();
    expect((await call("POST", `/v2/recurring/${ruleId}/pay`, {})).status).toBe(200);

    const holding = await call("POST", "/v2/holdings", { accountId: f.broker, assetClass: "etf", ticker: "BOVA11", name: "BOVA11", currentPrice: 100 });
    expect(holding.status).toBe(200);
    const { id: holdingId } = await holding.json();
    const op = await call("POST", "/v2/investment-operations", { holdingId, type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000, date: "2026-08-05", fundFromAccountId: f.pfChecking });
    expect(op.status).toBe(200);
    const summary = await (await call("GET", "/v2/portfolio/summary")).json();
    expect(summary.marketValue).toBe(1000);
    expect(summary.allocation).toEqual([expect.objectContaining({ allocationClass: "br_stocks", marketValue: 1000 })]);
    const targets = await call("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "br_stocks", targetPercent: 60 }, { assetClass: "savings", targetPercent: 40 }] });
    expect((await targets.json()).targets.map((t: { allocationClass: string; targetPercent: number }) => [t.allocationClass, t.targetPercent])).toEqual([
      ["fixed_income", 0.4],
      ["br_stocks", 0.6],
    ]);
    const badTargets = await call("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "stocks", targetPercent: 100 }] });
    expect(badTargets.status).toBe(422);
    expect(await badTargets.json()).toMatchObject({ code: "validation", issues: expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(/^targets\.0/) })]) });
    expect((await call("POST", "/v2/holdings", { accountId: f.pfChecking, assetClass: "etf", name: "X" })).status).toBe(422);

    const imports = await (await call("GET", "/v2/imports")).json();
    expect(imports.imports).toEqual([]);
    const rows = await call("POST", `/v2/accounts/${f.card}/statements/import-rows`, { month: "2026-09", rows: [{ date: "2026-08-10", description: "Uber", amount: 25 }] });
    expect(await rows.json()).toMatchObject({ created: 1, skipped: 0 });

    const currencies = await (await call("GET", "/v2/currencies")).json();
    expect(currencies.baseCurrency).toBe("BRL");
    expect((await call("DELETE", "/v2/currencies/BRL")).status).toBe(422);
  });
});
