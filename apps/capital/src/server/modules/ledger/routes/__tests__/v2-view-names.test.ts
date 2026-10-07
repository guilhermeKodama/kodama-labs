import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { nextNewViewName } from "@capital/server/modules/ledger/services/views";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";

/** POST /v2/views without a name: "Nova view", "Nova view 2", … per dataset, in the user's locale, off the undo log. */
const USER = "test-user-fu-a-view-names-001";
const app = createApp();
let cookie: string;

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("new view names", () => {
  it("numbers past the highest number in use", () => {
    expect(nextNewViewName("Nova view", [])).toBe("Nova view");
    expect(nextNewViewName("Nova view", ["Todas", "Nova view"])).toBe("Nova view 2");
    expect(nextNewViewName("Nova view", ["Nova view", "Nova view 3", "Nova view (cópia)", "Nova views 9"])).toBe("Nova view 4");
    expect(nextNewViewName("Nova view", ["Nova view 2"])).toBe("Nova view 3");
  });

  it("names unnamed views per dataset and leaves their creation out of the undo log", async () => {
    const first = await call("POST", "/v2/views", { dataset: "ledger", config: {} });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ name: "Nova view", isFavorite: true, batchId: null });
    const second = await call("POST", "/v2/views", { dataset: "ledger", config: {} });
    expect(second.body.name).toBe("Nova view 2");

    // Another dataset starts its own count.
    const holdings = await call("POST", "/v2/views", { dataset: "holdings", config: { groupBy: "none" } });
    expect(holdings.body.name).toBe("Nova view");

    // A deleted one frees nothing below the highest; a named view is still recorded.
    await call("DELETE", `/v2/views/${first.body.id as string}`);
    expect((await call("POST", "/v2/views", { config: {} })).body.name).toBe("Nova view 3");
    const named = await call("POST", "/v2/views", { name: "Mercado", config: {} });
    expect(named.body.batchId).toEqual(expect.any(String));

    // ⌘Z's fallback (the newest undoable batch) is never a view's creation.
    const batches = await prisma.mutationBatch.findMany({ where: { userId: USER, op: "view.create" } });
    expect(batches.map((b) => b.summary)).toEqual(["Mercado"]);
  });

  it("uses the user's locale", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    try {
      const created = await call("POST", "/v2/views", { dataset: "investment_ops", config: { layout: "table" } });
      expect(created.body.name).toBe("New view");
    } finally {
      await prisma.user.update({ where: { id: USER }, data: { locale: "pt-BR" } });
    }
  });
});
