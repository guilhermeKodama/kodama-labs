import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-categories-routes-001";
const OTHER = "test-user-categories-routes-002";
const app = createApp();
let f: LedgerFixture;
let o: LedgerFixture;
let cookie: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      { name: "Mercado", type: "expense" },
      { name: "Feira", type: "expense" },
      { name: "Salario", type: "income" },
    ],
  });
  o = await createLedgerFixture(prisma, OTHER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const spend = (categoryId: string | null, description: string, date = "2026-09-10") =>
  call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 12, date, description, categoryId });

describe("GET /v2/categories", () => {
  it("lists the user's categories by type and name, without counts unless asked", async () => {
    const r = await call("GET", "/v2/categories");
    expect(r.status).toBe(200);
    expect(r.body.categories.map((c: { name: string }) => c.name)).toEqual(["Salario", "Feira", "Mercado"]);
    expect(r.body.categories[0]).toEqual({ id: f.categories.Salario, name: "Salario", type: "income", color: null, icon: null, systemKey: null, isDefault: false, isSystem: false, isArchived: false });
    expect(r.body.categories[0]).not.toHaveProperty("counts");
  });

  it("filters by type and archived state, and attaches counts with zeros for unused categories", async () => {
    await spend(f.categories.Mercado, "Compra");
    await call("PATCH", `/v2/categories/${f.categories.Feira}`, { isArchived: true });
    const expenses = await call("GET", "/v2/categories?type=expense&withCounts=true");
    expect(expenses.body.categories.map((c: { name: string; counts: unknown }) => [c.name, c.counts])).toEqual([["Mercado", { entries: 1, budgets: 0 }]]);
    const withArchived = await call("GET", "/v2/categories?type=expense&includeArchived=true&withCounts=true");
    expect(withArchived.body.categories.map((c: { name: string; counts: unknown }) => [c.name, c.counts])).toEqual([
      ["Feira", { entries: 0, budgets: 0 }],
      ["Mercado", { entries: 1, budgets: 0 }],
    ]);
    expect((await call("GET", "/v2/categories?type=bogus")).status).toBe(422);
  });
});

describe("POST, PATCH and usage", () => {
  it("creates a category and answers 409 for a name that is taken, 422 for an empty one", async () => {
    const made = await call("POST", "/v2/categories", { name: "Pets", type: "expense", color: "#445566", icon: "paw" });
    expect(made.body).toMatchObject({ name: "Pets", type: "expense", color: "#445566", icon: "paw" });
    const taken = await call("POST", "/v2/categories", { name: "Pets", type: "expense" });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "category.name_taken", params: { name: "Pets", type: "expense" } });
    expect((await call("POST", "/v2/categories", { name: "", type: "expense" })).status).toBe(422);
    expect((await call("POST", "/v2/categories", { name: "x".repeat(81), type: "expense" })).status).toBe(422);
  });

  it("renames with a batch id, refuses unknown fields and a system key, and 404s for a stranger's category", async () => {
    const r = await call("PATCH", `/v2/categories/${f.categories.Mercado}`, { name: "Supermercado", color: null });
    expect(r.body).toMatchObject({ name: "Supermercado", batchId: expect.any(String) });
    expect((await call("PATCH", `/v2/categories/${f.categories.Mercado}`, { systemKey: "x" })).status).toBe(422);
    expect((await call("PATCH", `/v2/categories/${o.categories.Groceries}`, { name: "X" })).body).toMatchObject({ code: "category.not_found" });
    expect((await call("PATCH", `/v2/categories/${f.categories.Mercado}`, { name: "Feira" })).status).toBe(409);
  });

  it("reports what uses a category, and 404s for one that is not the user's", async () => {
    await spend(f.categories.Mercado, "Compra");
    await call("POST", "/v2/budgets", { categoryId: f.categories.Mercado, amount: 100, effectiveFrom: "2026-01" });
    expect((await call("GET", `/v2/categories/${f.categories.Mercado}/usage`)).body).toEqual({ entries: 1, recurring: 0, budgets: 1, rules: 0, total: 2 });
    expect((await call("GET", `/v2/categories/${o.categories.Groceries}/usage`)).body).toMatchObject({ code: "category.not_found" });
  });
});

describe("DELETE and merge", () => {
  it("deletes an unused category, refuses one in use, and reassigns when told where", async () => {
    await spend(f.categories.Mercado, "Compra");
    const refused = await call("DELETE", `/v2/categories/${f.categories.Mercado}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "category.in_use", params: { entries: 1 } });
    const moved = await call("DELETE", `/v2/categories/${f.categories.Mercado}?reassignTo=${f.categories.Feira}`);
    expect(moved.body).toMatchObject({ success: true, id: f.categories.Mercado, batchId: expect.any(String) });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: f.categories.Feira } })).toBe(1);
    expect((await call("DELETE", `/v2/categories/${f.categories.Feira}?reassignTo=${f.categories.Salario}`)).body).toMatchObject({ code: "category.type_mismatch" });
    expect((await call("DELETE", `/v2/categories/${f.categories.Salario}`)).status).toBe(200);
    expect((await call("POST", `/v2/mutations/${moved.body.batchId}/undo`)).status).toBe(200);
    expect(await prisma.category.count({ where: { id: f.categories.Mercado } })).toBe(1);
  });

  it("merges one category into another and reports the counts", async () => {
    await spend(f.categories.Mercado, "Compra");
    await spend(f.categories.Mercado, "Outra", "2026-09-11");
    const r = await call("POST", "/v2/categories/merge", { fromId: f.categories.Mercado, toId: f.categories.Feira });
    expect(r.body).toMatchObject({ success: true, fromCategory: "Mercado", toCategory: "Feira", transactionsMoved: 2, budgetsMoved: 0, rulesMoved: 0 });
    expect((await call("POST", "/v2/categories/merge", { fromId: f.categories.Feira, toId: f.categories.Feira })).body).toMatchObject({ code: "category.merge_self" });
    expect((await call("POST", "/v2/categories/merge", { fromId: f.categories.Feira })).status).toBe(422);
  });
});

describe("GET /v2/categories/uncategorized", () => {
  it("lists entries with no category or an archived one, with their entity and category", async () => {
    await spend(null, "Sem categoria", "2026-09-12");
    await spend(f.categories.Mercado, "Categorizada", "2026-09-13");
    await spend(f.categories.Feira, "Arquivada", "2026-09-11");
    await call("PATCH", `/v2/categories/${f.categories.Feira}`, { isArchived: true });
    const r = await call("GET", "/v2/categories/uncategorized");
    expect(r.body.total).toBe(2);
    expect(r.body.entries).toEqual([
      { id: expect.any(String), date: "2026-09-12", description: "Sem categoria", amount: -12, currency: "BRL", kind: "expense", entity: { name: "PF", kind: "personal" }, category: null },
      { id: expect.any(String), date: "2026-09-11", description: "Arquivada", amount: -12, currency: "BRL", kind: "expense", entity: { name: "PF", kind: "personal" }, category: { name: "Feira", isArchived: true } },
    ]);
    expect((await call("GET", `/v2/categories/uncategorized?entityId=${f.pjId}`)).body).toEqual({ total: 0, entries: [] });
    expect((await call("GET", "/v2/categories/uncategorized?limit=1")).body.entries).toHaveLength(1);
    expect((await call("GET", "/v2/categories/uncategorized?limit=0")).status).toBe(422);
  });
});
