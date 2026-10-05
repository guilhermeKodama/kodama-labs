import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-ledger-routes-001";
let f: LedgerFixture;
let cookie: string;
const app = createApp();

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV and other text bodies */
  }
  return { status: res.status, json: json as Record<string, unknown> & unknown[], text };
}

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});
afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("v2 ledger routes", () => {
  it("rejects requests without a session", async () => {
    const res = await app.request("/api/v2/views");
    expect(res.status).toBe(401);
  });

  it("creates, queries, bulk-edits, undoes, exports and trashes entries", async () => {
    const created = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 42, description: "Padaria", date: "2026-09-03" });
    expect(created.status).toBe(200);
    const entryId = (created.json as unknown as { entryIds: string[] }).entryIds[0];

    const q = await call("POST", "/v2/ledger/query", { period: { from: "2026-09-01", to: "2026-09-30" }, groupBy: [{ field: "accountId" }] });
    expect(q.status).toBe(200);
    expect((q.json as unknown as { totals: { count: number } }).totals.count).toBe(1);

    const bulk = await call("POST", "/v2/ledger/bulk", {
      op: "update",
      selection: { query: { period: { from: "2026-09-01", to: "2026-09-30" } } },
      patch: { categoryId: f.categories.Groceries },
    });
    expect(bulk.status).toBe(200);
    const batchId = (bulk.json as unknown as { batchId: string }).batchId;
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })).categoryId).toBe(f.categories.Groceries);

    const undo = await call("POST", `/v2/mutations/${batchId}/undo`);
    expect(undo.status).toBe(200);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })).categoryId).toBeNull();

    const csv = await call("POST", "/v2/ledger/export", { query: { period: { from: "2026-09-01", to: "2026-09-30" } } });
    expect(csv.status).toBe(200);
    expect(csv.text.split("\n")[1]).toContain("Padaria");

    const del = await call("DELETE", `/v2/ledger/entries/${entryId}`);
    expect(del.status).toBe(200);
    const trash = await call("GET", "/v2/trash");
    expect((trash.json as unknown as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual([entryId]);
    await call("POST", "/v2/trash/restore", { ids: [entryId] });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: entryId } })).deletedAt).toBeNull();
  });

  it("validates bodies and maps domain errors", async () => {
    const bad = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: "x", description: "", date: "nope" });
    expect(bad.status).toBe(422);
    const missing = await call("PATCH", "/v2/ledger/entries/does-not-exist", { description: "x" });
    expect(missing.status).toBe(404);
  });

  it("lists entities, accounts with balances and views", async () => {
    const entities = await call("GET", "/v2/entities");
    expect((entities.json as unknown as { kind: string }[]).map((e) => e.kind).sort()).toEqual(["business", "personal"]);
    const accounts = await call("GET", "/v2/accounts?type=credit_card");
    expect((accounts.json as unknown as { closingDay: number }[])[0].closingDay).toBe(5);
    const views = await call("GET", "/v2/views");
    expect((views.json as unknown as { builtinKey: string }[])[0].builtinKey).toBe("all");
  });
});
