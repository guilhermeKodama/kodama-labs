import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

/** A sample of real domain errors through the v2 routes: each carries its stable code (and params). */
const USER = "test-user-v2-error-codes-001";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("v2 error codes", () => {
  it("codes session and login failures", async () => {
    expect((await call("GET", "/v2/me", undefined, {})).body).toEqual({ message: "Authentication required", code: "auth.required" });
    expect((await call("GET", "/v2/me", undefined, { cookie: "capital_session=nope" })).body).toMatchObject({ code: "auth.session_invalid" });
    const login = await call("POST", "/v2/auth/login", { email: `${USER}@example.com`, password: "wrong" }, {});
    expect(login).toEqual({ status: 401, body: { message: "Invalid email or password", code: "auth.invalid_credentials" } });
    const signup = await call("POST", "/v2/auth/signup", { email: `${USER}@example.com`, password: "secret-123", name: "Dup" }, {});
    expect(signup).toEqual({ status: 409, body: { message: "User with this email already exists", code: "auth.email_taken" } });
  });

  it("codes ledger errors, with params where the message names a value", async () => {
    expect((await call("PATCH", "/v2/ledger/entries/does-not-exist", { description: "x" })).body).toEqual({ message: "Transaction not found", code: "entry.not_found" });

    const sameAccount = await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pfChecking, amount: 10, date: "2026-09-01" });
    expect(sameAccount).toEqual({ status: 422, body: { message: "A transfer needs two different accounts", code: "transfer.same_account" } });

    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    const archived = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-01", description: "x", categoryId: f.categories.Software });
    expect(archived.status).toBe(422);
    expect(archived.body).toMatchObject({ code: "category.archived", params: { name: "Software" } });

    const query = await call("POST", "/v2/ledger/query", { aggregations: [{ fn: "sum", field: "categoryId" }] });
    expect(query.body).toMatchObject({ code: "query.aggregation_needs_numeric", params: { fn: "sum", field: "categoryId" } });

    const views = (await call("GET", "/v2/views")).body as { id: string; builtinKey: string | null }[];
    const builtin = views.find((v) => v.builtinKey === "all")!;
    expect((await call("DELETE", `/v2/views/${builtin.id}`)).body).toMatchObject({ code: "view.builtin_delete" });
  });

  it("codes undo conflicts", async () => {
    const created = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-09-02", description: "Café" });
    const { batchId } = created.body as { batchId: string };
    expect((await call("POST", `/v2/mutations/${batchId}/undo`)).status).toBe(200);
    expect(await call("POST", `/v2/mutations/${batchId}/undo`)).toEqual({ status: 409, body: { message: "Batch already undone", code: "undo.already_undone" } });
  });

  it("codes the other domains' errors", async () => {
    expect((await call("GET", "/v2/budgets/overview")).body).toMatchObject({ code: "budget.overview_period_required" });
    expect((await call("DELETE", "/v2/currencies/BRL")).body).toMatchObject({ code: "currency.base_protected" });
    expect((await call("PUT", "/v2/portfolio/targets", { targets: [{ allocationClass: "br_stocks", targetPercent: 40 }] })).body).toMatchObject({ code: "portfolio.targets_sum" });
    expect((await call("POST", "/v2/holdings", { accountId: f.pfChecking, assetClass: "etf", name: "X" })).body).toMatchObject({ code: "holding.requires_brokerage" });

    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-09-03", description: "Mercado", categoryId: f.categories.Groceries });
    const inUse = await call("DELETE", `/v2/categories/${f.categories.Groceries}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body).toMatchObject({ code: "category.in_use", params: { entries: 1, recurring: 0, budgets: 0, rules: 0 } });
  });
});
