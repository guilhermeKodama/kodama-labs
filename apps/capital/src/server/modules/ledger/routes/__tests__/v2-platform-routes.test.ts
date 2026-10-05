import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-v2-platform-routes-001";
const SIGNUP_EMAIL = "test-user-v2-platform-signup-001@example.com";
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
  await prisma.user.deleteMany({ where: { email: SIGNUP_EMAIL } });
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
  app.request(`/api${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const localeCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("NEXT_LOCALE="));

describe("includeArchived", () => {
  it('reads "false" as false on /v2/entities and /v2/accounts', async () => {
    const old = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Old LTDA", archivedAt: new Date() } });
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });

    const entityIds = async (query: string) => ((await (await call("GET", `/v2/entities${query}`)).json()) as { id: string }[]).map((e) => e.id);
    expect(await entityIds("?includeArchived=false")).not.toContain(old.id);
    expect(await entityIds("")).not.toContain(old.id);
    expect(await entityIds("?includeArchived=true")).toContain(old.id);

    const accountIds = async (query: string) => ((await (await call("GET", `/v2/accounts${query}`)).json()) as { id: string }[]).map((a) => a.id);
    expect(await accountIds("?includeArchived=false")).not.toContain(f.broker);
    expect(await accountIds("?includeArchived=true")).toContain(f.broker);

    const bad = await call("GET", "/v2/accounts?includeArchived=yes");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "validation" });
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: null } });
  });
});

describe("locale and preferences", () => {
  it("PATCH /v2/me saves the locale and sets the NEXT_LOCALE cookie", async () => {
    const res = await call("PATCH", "/v2/me", { locale: "en", fxAutoUpdate: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ locale: "en", fxAutoUpdate: false });
    expect(localeCookie(res)).toMatch(/^NEXT_LOCALE=en;.*Path=\//);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: USER } })).toMatchObject({ locale: "en", fxAutoUpdate: false });

    const other = await call("PATCH", "/v2/me", { timezone: "America/Sao_Paulo" });
    expect(localeCookie(other)).toBeUndefined();
    expect((await call("PATCH", "/v2/me", { locale: "fr" })).status).toBe(422);
    await call("PATCH", "/v2/me", { locale: "pt-BR" });
  });

  it("PATCH /v2/me changes the base currency over existing entries only with force", async () => {
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-08-01", description: "x" });
    expect((await call("PATCH", "/v2/me", { baseCurrency: "USD" })).status).toBe(409);
    const forced = await call("PATCH", "/v2/me", { baseCurrency: "USD", force: true });
    expect(forced.status).toBe(200);
    expect((await forced.json()).baseCurrency).toBe("USD");
    await call("PATCH", "/v2/me", { baseCurrency: "BRL", force: true });
  });

  it("signup and login set NEXT_LOCALE to the user's locale", async () => {
    await prisma.user.deleteMany({ where: { email: SIGNUP_EMAIL } });
    const signup = await call("POST", "/v2/auth/signup", { email: SIGNUP_EMAIL, password: "secret-123", name: "New", locale: "en" }, {});
    expect(signup.status).toBe(200);
    expect(localeCookie(signup)).toMatch(/^NEXT_LOCALE=en;/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: SIGNUP_EMAIL } });
    expect(user).toMatchObject({ baseCurrency: "BRL", locale: "en", theme: "light", dateFormat: "dd/MM/yyyy", numberFormat: "pt-BR" });
    const usd = await prisma.currency.findFirstOrThrow({ where: { userId: user.id, code: "USD" } });
    expect(1 / usd.manualRate).toBeCloseTo(5.41, 3);

    await prisma.user.update({ where: { id: user.id }, data: { locale: "pt-BR" } });
    const login = await call("POST", "/v2/auth/login", { email: SIGNUP_EMAIL, password: "secret-123" }, { cookie: "NEXT_LOCALE=en" });
    expect(login.status).toBe(200);
    expect(localeCookie(login)).toMatch(/^NEXT_LOCALE=pt-BR;/);
  });
});

describe("undo routes", () => {
  it("lists the undoable batches newest first and returns batch ids from investment operation writes", async () => {
    const holding = await (await call("POST", "/v2/holdings", { accountId: f.broker, assetClass: "stocks", ticker: "EGIE3", name: "Engie", currentPrice: 40 })).json();
    const created = await (await call("POST", "/v2/investment-operations", { holdingId: holding.id, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, date: "2026-09-01", fundFromAccountId: f.pfChecking })).json();
    expect(created.batchId).toEqual(expect.any(String));
    expect(created.operation.fundingGroupId).toBe(created.fundingGroupId);

    const patched = await (await call("PATCH", `/v2/investment-operations/${created.operation.id}`, { quantity: 12, totalAmount: 480 })).json();
    expect(patched).toMatchObject({ batchId: expect.any(String), operation: { id: created.operation.id, quantity: 12, ticker: "EGIE3", date: "2026-09-01" } });

    const latest = await (await call("GET", "/v2/mutations?undoable=true&limit=1")).json();
    expect(latest).toEqual([expect.objectContaining({ id: patched.batchId, op: "update", source: "user", undoable: true })]);
    const all = await (await call("GET", "/v2/mutations?undoable=false")).json();
    expect(all.find((b: { id: string }) => b.id === created.batchId)).toMatchObject({ undoable: false });

    const deleted = await call("DELETE", `/v2/investment-operations/${created.operation.id}?withFunding=true`);
    expect(deleted.status).toBe(200);
    const { batchId, fundingGroupId } = await deleted.json();
    expect(fundingGroupId).toBe(created.fundingGroupId);
    expect((await call("POST", `/v2/mutations/${batchId}/undo`, {})).status).toBe(200);
    const ops = await (await call("GET", `/v2/investment-operations?holdingId=${holding.id}`)).json();
    expect(ops.operations).toEqual([expect.objectContaining({ id: created.operation.id, quantity: 12 })]);
    expect((await call("GET", "/v2/mutations?limit=0")).status).toBe(422);
  });
});
