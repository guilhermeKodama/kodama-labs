import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

/** GET /v2/categories?withCounts=true: entries and budgets per category, for the Categorias list ("Usada em N transações e 1 orçamento"). */
const USER = "test-user-s6-category-counts-001";
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

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;

  const groceries = f.categories.Groceries;
  const expense = (date: string) => call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 50, date, description: "Mercado", categoryId: groceries });
  await expense("2026-09-01");
  await expense("2026-09-08");
  const trashed = await expense("2026-09-15");
  expect((await call("DELETE", `/v2/ledger/entries/${trashed.body.entryIds[0]}`)).status).toBe(200);

  const budget = (data: { entityId?: string | null; period: "monthly" | "yearly"; effectiveFrom: string; isActive?: boolean; isTombstone?: boolean }) =>
    prisma.budget.create({
      data: {
        userId: USER,
        categoryId: groceries,
        amount: 800,
        currency: "BRL",
        year: 2026,
        month: data.period === "monthly" ? Number(data.effectiveFrom.slice(5, 7)) : null,
        entityId: data.entityId ?? null,
        period: data.period,
        effectiveFrom: new Date(`${data.effectiveFrom}T12:00:00Z`),
        isActive: data.isActive ?? true,
        isTombstone: data.isTombstone ?? false,
      },
    });
  // One monthly PF chain with two versions and a tombstone: one budget.
  await budget({ entityId: f.pfId, period: "monthly", effectiveFrom: "2026-01-01" });
  await budget({ entityId: f.pfId, period: "monthly", effectiveFrom: "2026-06-01" });
  await budget({ entityId: f.pfId, period: "monthly", effectiveFrom: "2026-11-01", isTombstone: true });
  // A yearly budget for every entity: a second one.
  await budget({ entityId: null, period: "yearly", effectiveFrom: "2026-01-01" });
  // A deleted chain does not count.
  await budget({ entityId: f.pjId, period: "monthly", effectiveFrom: "2026-01-01", isActive: false });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("GET /v2/categories?withCounts=true", () => {
  it("counts live entries and budget chains per category", async () => {
    const { status, body } = await call("GET", "/v2/categories?withCounts=true");
    expect(status).toBe(200);
    const byName = Object.fromEntries(body.categories.map((c: { name: string }) => [c.name, c]));
    expect(byName.Groceries.counts).toEqual({ entries: 2, budgets: 2 });
    expect(byName.Software.counts).toEqual({ entries: 0, budgets: 0 });
    expect(byName.Salary.counts).toEqual({ entries: 0, budgets: 0 });
  });

  it("leaves the counts out unless asked, and keeps the other filters", async () => {
    const plain = await call("GET", "/v2/categories?includeArchived=false");
    expect(plain.body.categories.every((c: object) => !("counts" in c))).toBe(true);
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    const archived = await call("GET", "/v2/categories?includeArchived=true&withCounts=true&type=expense");
    expect(archived.body.categories.map((c: { name: string }) => c.name).sort()).toEqual(["Groceries", "Software"]);
    expect((await call("GET", "/v2/categories?withCounts=yes")).status).toBe(422);
  });
});
