import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const USER = "test-user-s2-entry-crud-routes-001";
let f: LedgerFixture;
let cookie: string;
const app = createApp();

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});
afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("entry CRUD routes", () => {
  it("deletes an installment with a scope after reading its options, and undoes it", async () => {
    const created = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.card, amount: 900, installments: 3, description: "Cadeira", date: "2026-09-04" });
    expect(created.status).toBe(200);
    const second = created.json.entries.find((e: Json) => e.installmentNumber === 2);

    const options = await call("GET", `/v2/ledger/entries/${second.id}/delete-options`);
    expect(options.status).toBe(200);
    expect(options.json).toMatchObject({ kind: "installment", occurrence: { n: 2, total: 3 }, scopes: { future: { count: 2, sum: -600 }, all: { count: 3 } } });

    const del = await call("POST", `/v2/ledger/entries/${second.id}/delete`, { scope: "future" });
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ deleted: 2, installmentPlanClosed: true, batchId: expect.any(String) });
    expect(await prisma.ledgerEntry.count({ where: { id: { in: created.json.entryIds }, deletedAt: null } })).toBe(1);

    const latest = await call("GET", "/v2/mutations?undoable=true&limit=1");
    expect(latest.json[0].id).toBe(del.json.batchId);
    expect((await call("POST", `/v2/mutations/${del.json.batchId}/undo`)).status).toBe(200);
    expect(await prisma.ledgerEntry.count({ where: { id: { in: created.json.entryIds }, deletedAt: null } })).toBe(3);
  });

  it("refuses a wider scope on a simple entry with a coded 422", async () => {
    const created = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 12, description: "Café", date: "2026-09-10" });
    const id = created.json.entryIds[0];
    const bad = await call("POST", `/v2/ledger/entries/${id}/delete`, { scope: "all" });
    expect(bad.status).toBe(422);
    expect(bad.json).toMatchObject({ code: "entry.scope_unavailable" });
    expect((await call("POST", `/v2/ledger/entries/${id}/delete`, { scope: "nope" })).json.code).toBe("validation");
    const ok = await call("POST", `/v2/ledger/entries/${id}/delete`, {});
    expect(ok.json).toMatchObject({ kind: "simple", deleted: 1 });
  });

  it("patches kind and transfer endpoints, and reports both in the history", async () => {
    const created = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 300, description: "Pix", date: "2026-09-12" });
    const id = created.json.entryIds[0];
    const patched = await call("PATCH", `/v2/ledger/entries/${id}`, { kind: "income" });
    expect(patched.status).toBe(200);
    expect(patched.json.entry).toMatchObject({ kind: "income", amount: 300 });
    expect((await call("PATCH", `/v2/ledger/entries/${id}`, { reimbursement: true })).json.code).toBe("entry.not_transfer");

    const history = await call("GET", `/v2/ledger/entries/${id}/history`);
    expect(history.status).toBe(200);
    expect(history.json.events.map((e: Json) => e.type)).toEqual(["created", "updated"]);
    expect(history.json.events[1]).toMatchObject({ source: "user", changes: [{ field: "kind", before: "expense", after: "income" }] });

    const t = await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 1000, date: "2026-09-20" });
    const leg = t.json.entries[0];
    const moved = await call("PATCH", `/v2/ledger/entries/${leg.id}`, { fromAccountId: f.pjChecking, toAccountId: f.pfChecking });
    expect(moved.status).toBe(200);
    expect(moved.json.entry.transferDirection).toBe("profit_distribution");
  });

  it("dry-runs a bulk edit over a query selection", async () => {
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 40, description: "Uber", date: "2026-07-03" });
    await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 500, date: "2026-07-04" });
    const before = await prisma.mutationBatch.count({ where: { userId: USER } });
    const dry = await call("POST", "/v2/ledger/bulk", {
      op: "update",
      dryRun: true,
      selection: { query: { period: { from: "2026-07-01", to: "2026-07-31" } } },
      patch: { entityId: f.pjId },
    });
    expect(dry.status).toBe(200);
    expect(dry.json).toEqual({ dryRun: true, matched: 2, changed: 1, byField: { entityId: { changed: 1, unchanged: 1 } }, rulesLearned: 0 });
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(before);
  });

  it("tests rules for an entity and suggests categories", async () => {
    const rule = await call("POST", "/v2/rules", { matchType: "contains", pattern: "aws", categoryId: f.categories.Software, entityId: f.pjId });
    expect(rule.status).toBe(200);
    expect((await call("POST", "/v2/rules/test", { description: "AWS EMEA", entityId: f.pfId })).json).toMatchObject({ rule: null, hitCount: 0 });
    expect((await call("POST", "/v2/rules/test", { description: "AWS EMEA", entityId: f.pjId })).json).toMatchObject({ rule: { pattern: "aws" }, category: { id: f.categories.Software } });

    const suggestion = await call("POST", "/v2/rules/suggest", { description: "AWS EMEA", entityId: f.pjId });
    expect(suggestion.status).toBe(200);
    expect(suggestion.json).toMatchObject({ source: "rule", categoryId: f.categories.Software, rule: { pattern: "aws", hitCount: 0 } });
    expect((await call("POST", "/v2/rules/suggest", { description: "Nada parecido" })).json).toMatchObject({ source: null, categoryId: null });
  });
});
