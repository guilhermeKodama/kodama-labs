import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-budgets-routes-branches-001";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Mercado", type: "expense" }, { name: "Lazer", type: "expense" }, { name: "Salario", type: "income" }] });
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await prisma.budget.deleteMany({ where: { userId: USER } });
  await prisma.ledgerEntry.deleteMany({ where: { userId: USER } });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const create = (extra: Record<string, unknown> = {}) =>
  call("POST", "/v2/budgets", { entityId: f.pfId, categoryId: f.categories.Mercado, amount: 500, effectiveFrom: "2026-01", ...extra });

describe("POST and PATCH /v2/budgets", () => {
  it("trims notes, and stores an empty note as null", async () => {
    const spaced = await create({ notes: "  feira  " });
    expect(spaced.body).toMatchObject({ notes: "feira", kind: null });
    const blank = await create({ categoryId: f.categories.Lazer, notes: "   " });
    expect(blank.body.notes).toBeNull();
    const patched = await call("PATCH", `/v2/budgets/${spaced.body.id}`, { notes: "" });
    expect(patched.body.notes).toBeNull();
    const untouched = await call("PATCH", `/v2/budgets/${spaced.body.id}`, { amount: 510 });
    expect(untouched.body).toMatchObject({ amount: 510, notes: null });
  });

  it("refuses a zero or negative amount and unknown fields on a patch", async () => {
    expect((await create({ amount: 0 })).status).toBe(422);
    const b = await create();
    expect((await call("PATCH", `/v2/budgets/${b.body.id}`, { amount: -1 })).status).toBe(422);
    expect((await call("PATCH", `/v2/budgets/${b.body.id}`, { surprise: true })).status).toBe(422);
  });

  it("will not take applyFrom together with the period, the start month or isActive", async () => {
    const b = await create();
    for (const key of ["period", "effectiveFrom", "isActive"] as const) {
      const value = key === "period" ? "yearly" : key === "effectiveFrom" ? "2026-02" : false;
      const r = await call("PATCH", `/v2/budgets/${b.body.id}`, { applyFrom: "2026-05", [key]: value });
      expect(r.status).toBe(422);
    }
    const ok = await call("PATCH", `/v2/budgets/${b.body.id}`, { amount: 5, applyFrom: "2026-05" });
    expect(ok.status).toBe(200);
    expect(ok.body.effectiveFrom).toBe("2026-05-01");
  });

  it("404s on a budget that is not there", async () => {
    expect((await call("PATCH", "/v2/budgets/nope", { amount: 5 })).body).toMatchObject({ code: "budget.not_found" });
    expect((await call("DELETE", "/v2/budgets/nope")).status).toBe(404);
  });
});

describe("DELETE /v2/budgets/{id}", () => {
  it("deactivates just that version when neither from nor all is given, undoably", async () => {
    const b = await create();
    const r = await call("DELETE", `/v2/budgets/${b.body.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: b.body.id, isActive: false, batchId: expect.any(String) });
    expect((await call("GET", "/v2/budgets")).body.budgets).toEqual([]);
    expect((await call("POST", `/v2/mutations/${r.body.batchId}/undo`)).status).toBe(200);
    expect((await call("GET", "/v2/budgets")).body.budgets).toHaveLength(1);
  });

  it("reads all as a true/false flag", async () => {
    const b = await create();
    await call("PATCH", `/v2/budgets/${b.body.id}`, { amount: 600, applyFrom: "2026-06" });
    const notAll = await call("DELETE", `/v2/budgets/${b.body.id}?all=false`);
    expect(notAll.body.isActive).toBe(false);
    expect((await call("GET", "/v2/budgets")).body.budgets).toHaveLength(1);
    expect((await call("DELETE", `/v2/budgets/${b.body.id}?all=yes`)).status).toBe(422);
    expect((await call("DELETE", `/v2/budgets/${b.body.id}?from=2026-6`)).status).toBe(422);
  });
});

describe("GET /v2/budgets", () => {
  it("filters by entity and category, and shows what was in force at a date", async () => {
    const pf = await create();
    await create({ categoryId: f.categories.Lazer, entityId: f.pjId, effectiveFrom: "2026-06" });
    await call("PATCH", `/v2/budgets/${pf.body.id}`, { amount: 700, applyFrom: "2026-09" });
    const idsOf = (r: { body: { budgets: { id: string }[] } }) => r.body.budgets.map((b) => b.id);
    expect((await call("GET", `/v2/budgets?entityId=${f.pjId}`)).body.budgets.map((b: { category: string }) => b.category)).toEqual(["Lazer"]);
    expect((await call("GET", `/v2/budgets?categoryId=${f.categories.Mercado}`)).body.budgets).toHaveLength(2);
    const august = await call("GET", "/v2/budgets?effectiveAt=2026-08");
    expect(august.body.budgets.map((b: { category: string; amount: number }) => [b.category, b.amount]).sort()).toEqual([["Lazer", 500], ["Mercado", 500]]);
    const october = await call("GET", "/v2/budgets?effectiveAt=2026-10-12&categoryId=" + f.categories.Mercado);
    expect(october.body.budgets).toHaveLength(1);
    expect(october.body.budgets[0].amount).toBe(700);
    expect(idsOf(august)).not.toContain(october.body.budgets[0].id);
    expect((await call("GET", "/v2/budgets?effectiveAt=09-2026")).status).toBe(422);
  });
});

describe("GET /v2/budgets/overview and composition", () => {
  it("asks for a month or a year", async () => {
    const r = await call("GET", "/v2/budgets/overview");
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "budget.overview_period_required" });
    expect((await call("GET", "/v2/budgets/overview?month=2026-9")).status).toBe(422);
    expect((await call("GET", "/v2/budgets/overview?year=26")).status).toBe(422);
  });

  it("serves a year on its own, scoped by entity id or the older entityId filter, and 404s on a stranger", async () => {
    await create();
    await create({ categoryId: f.categories.Lazer, entityId: f.pjId });
    const byScope = await call("GET", `/v2/budgets/overview?year=2026&scope=${f.pjId}`);
    expect(byScope.body.categories.map((r: { category: string }) => r.category)).toEqual(["Lazer"]);
    const byOlderFilter = await call("GET", `/v2/budgets/overview?month=2026-09&entityId=${f.pfId}`);
    expect(byOlderFilter.body.budgets.map((r: { category: string }) => r.category)).toEqual(["Mercado"]);
    expect(byOlderFilter.body.scope).toEqual({ entityIds: [f.pfId] });
    const stranger = await call("GET", "/v2/budgets/overview?year=2026&scope=someone-elses");
    expect(stranger.body).toMatchObject({ code: "entity.not_found" });
  });

  it("serves the composition of a range, with a limit, and refuses a bad range", async () => {
    await create({ kind: "fixo" });
    await create({ categoryId: f.categories.Lazer });
    const r = await call("GET", "/v2/budgets/composition?from=2026-08&to=2026-09&limit=1&scope=pf");
    expect(r.status).toBe(200);
    expect(r.body.months).toHaveLength(2);
    expect(r.body.months[1].fixo.budgeted).toBe(500);
    expect(r.body.months[1].variavel.budgeted).toBe(500);
    expect(r.body.months[1].topVariable).toHaveLength(1);
    expect((await call("GET", "/v2/budgets/composition?from=2026-09&to=2026-08")).body).toMatchObject({ code: "budget.composition_range" });
    expect((await call("GET", "/v2/budgets/composition?from=2026-08&to=2026-09&limit=0")).status).toBe(422);
    expect((await call("GET", "/v2/budgets/composition?from=2026-08")).status).toBe(422);
  });
});
