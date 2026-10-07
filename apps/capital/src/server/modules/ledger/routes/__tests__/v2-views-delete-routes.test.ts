import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";

/**
 * Deleted views stay deleted: after a user deletes every view of every
 * dataset, GET /v2/views returns only "Todas" for Transações and nothing
 * for Carteira, however often it is read and also after a business entity
 * is created (the PJ views wait for the first business, see
 * default-views.ts). Covers a user seeded with a business (version 2 at
 * once) and one seeded without (version 1, then the first business).
 */
const WITH_BUSINESS = "test-user-v2-views-delete-001";
const WITHOUT_BUSINESS = "test-user-v2-views-delete-002";
const DATASETS = ["ledger", "holdings", "investment_ops"] as const;
const app = createApp();

interface ViewRow {
  id: string;
  name: string;
  dataset: string;
  isBuiltin: boolean;
  builtinKey: string | null;
  seedKey: string | null;
}

async function sessionCookie(userId: string) {
  const session = await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return `capital_session=${session.id}`;
}

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as unknown };
}

const list = async (cookie: string, dataset?: string) => {
  const r = await call(cookie, "GET", dataset ? `/v2/views?dataset=${dataset}` : "/v2/views");
  expect(r.status).toBe(200);
  return r.json as ViewRow[];
};

/** Deletes every view but Todas through the API, dataset by dataset. */
async function deleteEverything(cookie: string) {
  for (const dataset of DATASETS) {
    for (const view of (await list(cookie, dataset)).filter((v) => !v.isBuiltin)) {
      const r = await call(cookie, "DELETE", `/v2/views/${view.id}`);
      expect(r.status, `${dataset} ${view.name}`).toBe(200);
    }
  }
}

/** Reads each dataset `times` times: only Todas on Transações, nothing on Carteira. */
async function expectOnlyTodas(cookie: string, times = 3) {
  for (let i = 0; i < times; i++) {
    const ledger = await list(cookie, "ledger");
    expect(ledger.map((v) => v.builtinKey)).toEqual(["all"]);
    expect(await list(cookie, "holdings")).toEqual([]);
    expect(await list(cookie, "investment_ops")).toEqual([]);
    expect((await list(cookie)).map((v) => v.builtinKey)).toEqual(["all"]);
  }
}

let withBusiness: string;
let withoutBusiness: string;

beforeAll(async () => {
  await createLedgerFixture(prisma, WITH_BUSINESS);
  withBusiness = await sessionCookie(WITH_BUSINESS);

  await prisma.user.deleteMany({ where: { id: WITHOUT_BUSINESS } });
  await prisma.user.create({ data: { id: WITHOUT_BUSINESS, email: `${WITHOUT_BUSINESS}@example.com`, passwordHash: "x", name: "Sem PJ" } });
  await prisma.entity.create({ data: { userId: WITHOUT_BUSINESS, kind: "personal", name: "PF" } });
  // The system Impostos category: with it, the first business would also bring "Impostos PJ".
  await prisma.category.create({ data: { userId: WITHOUT_BUSINESS, name: "Impostos", type: "expense", systemKey: "taxes" } });
  withoutBusiness = await sessionCookie(WITHOUT_BUSINESS);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, WITH_BUSINESS);
  await prisma.user.deleteMany({ where: { id: WITHOUT_BUSINESS } });
});

describe("deleted views never come back", () => {
  it("a user seeded with a business keeps only Todas after deleting everything, also after a new business", async () => {
    const seeded = await Promise.all(DATASETS.map((dataset) => list(withBusiness, dataset)));
    expect(seeded[0].map((v) => v.seedKey)).toEqual(expect.arrayContaining(["pj", "subs", "ir"]));
    expect(seeded[1].length).toBeGreaterThan(0);
    expect(seeded[2].length).toBeGreaterThan(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: WITH_BUSINESS } })).viewsSeedVersion).toBe(2);

    await deleteEverything(withBusiness);
    await expectOnlyTodas(withBusiness);

    const llc = await call(withBusiness, "POST", "/v2/entities", { name: "Kodama LLC" });
    expect(llc.status).toBe(200);
    await expectOnlyTodas(withBusiness);
  });

  it("a user seeded without a business keeps only Todas after deleting everything, also after the first business", async () => {
    const seeded = await list(withoutBusiness, "ledger");
    expect(seeded.map((v) => v.seedKey)).toEqual(expect.arrayContaining(["subs", "ir"]));
    expect(seeded.find((v) => v.seedKey === "pj")).toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: WITHOUT_BUSINESS } })).viewsSeedVersion).toBe(1);

    await deleteEverything(withoutBusiness);
    await expectOnlyTodas(withoutBusiness);

    // The first business: no PJ view arrives on a strip the user cleared, and version 2 is claimed for good.
    const first = await call(withoutBusiness, "POST", "/v2/entities", { name: "Kodama LTDA" });
    expect(first.status).toBe(200);
    await expectOnlyTodas(withoutBusiness);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: WITHOUT_BUSINESS } })).viewsSeedVersion).toBe(2);

    const second = await call(withoutBusiness, "POST", "/v2/entities", { name: "Kodama LLC" });
    expect(second.status).toBe(200);
    await expectOnlyTodas(withoutBusiness);
  });

  it("a view the user creates after clearing everything is the only one besides Todas", async () => {
    const created = await call(withBusiness, "POST", "/v2/views", { dataset: "holdings", config: {} });
    expect(created.status).toBe(200);
    expect((await list(withBusiness, "holdings")).map((v) => v.id)).toEqual([(created.json as ViewRow).id]);
    expect((await list(withBusiness, "ledger")).map((v) => v.builtinKey)).toEqual(["all"]);
    expect(await list(withBusiness, "investment_ops")).toEqual([]);
  });
});
