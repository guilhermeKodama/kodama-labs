import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

/**
 * Integration fixes over the v2 routes: saved views and entities in the
 * undo log, the category type check on PATCH and bulk, and the
 * entityKind filter of the query DSL.
 */
const USER = "test-user-f1-undo-registry-001";
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
const undo = (batchId: string) => call("POST", `/v2/mutations/${batchId}/undo`);

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("saved views in the undo log", () => {
  it("records create, rename, favorite, duplicate and delete; a deleted view comes back under the same id", async () => {
    const created = await call("POST", "/v2/views", { name: "Mercado", config: { filters: [{ field: "flowKind", op: "in", values: ["out"] }] } });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: created.body.batchId } })).toMatchObject({ op: "view.create", source: "user" });

    // Auto-saved config edits are not recorded.
    const edited = await call("PATCH", `/v2/views/${id}`, { config: { layout: "pivot", groupBy: [{ field: "categoryId" }] } });
    expect(edited.body).toMatchObject({ batchId: null, config: { layout: "pivot" } });

    // A rename typed in a row is one batch; undoing it puts the old name back and keeps the config.
    const r1 = await call("PATCH", `/v2/views/${id}`, { name: "Merc" });
    const r2 = await call("PATCH", `/v2/views/${id}`, { name: "Mercado do mês" });
    expect(r1.body.batchId).toEqual(expect.any(String));
    expect(r2.body.batchId).toBe(r1.body.batchId);
    expect((await undo(r2.body.batchId)).status).toBe(200);
    expect(await prisma.savedView.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Mercado", config: expect.objectContaining({ layout: "pivot" }) });

    const fav = await call("PATCH", `/v2/views/${id}`, { isFavorite: false });
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: fav.body.batchId } })).toMatchObject({ op: "view.update" });
    expect((await undo(fav.body.batchId)).status).toBe(200);
    expect((await prisma.savedView.findUniqueOrThrow({ where: { id } })).isFavorite).toBe(true);

    const copy = await call("POST", `/v2/views/${id}/duplicate`, {});
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: copy.body.batchId } })).toMatchObject({ op: "view.duplicate" });
    expect((await undo(copy.body.batchId)).status).toBe(200);
    expect(await prisma.savedView.count({ where: { id: copy.body.id } })).toBe(0);

    const before = await prisma.savedView.findUniqueOrThrow({ where: { id } });
    const removed = await call("DELETE", `/v2/views/${id}`);
    expect(removed.body).toMatchObject({ ok: true, batchId: expect.any(String) });
    expect(await prisma.savedView.count({ where: { id } })).toBe(0);
    expect((await undo(removed.body.batchId)).status).toBe(200);
    const back = await prisma.savedView.findUniqueOrThrow({ where: { id } });
    expect(back).toMatchObject({ userId: USER, name: before.name, position: before.position, isFavorite: before.isFavorite, createdAt: before.createdAt, config: before.config });

    expect((await undo(created.body.batchId)).status).toBe(200);
    expect(await prisma.savedView.count({ where: { id } })).toBe(0);
  });

  it("restores a deleted seeded view with its seed key, so ?view=seed:<key> resolves to it again", async () => {
    const views = (await call("GET", "/v2/views?dataset=ledger")).body as { id: string; seedKey: string | null }[];
    const ir = views.find((v) => v.seedKey === "ir")!;
    const removed = await call("DELETE", `/v2/views/${ir.id}`);
    expect((await undo(removed.body.batchId)).status).toBe(200);
    expect(await prisma.savedView.findUniqueOrThrow({ where: { id: ir.id } })).toMatchObject({ seedKey: "ir" });
  });
});

describe("entities in the undo log", () => {
  it("POST returns batchId; undo removes the business and its main account", async () => {
    const r = await call("POST", "/v2/entities", { name: "Kodama LLC", defaultCurrency: "USD", initialBalance: 100 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Kodama LLC", kind: "business", batchId: expect.any(String) });
    const account = await prisma.account.findFirstOrThrow({ where: { entityId: r.body.id } });
    expect(toNumber(account.initialBalance)).toBe(100);
    expect((await undo(r.body.batchId)).status).toBe(200);
    expect(await prisma.entity.count({ where: { id: r.body.id } })).toBe(0);
    expect(await prisma.account.count({ where: { id: account.id } })).toBe(0);
  });

  it("keeps a created business while something uses it", async () => {
    const r = await call("POST", "/v2/entities", { name: "Kodama LLC" });
    const account = await prisma.account.findFirstOrThrow({ where: { entityId: r.body.id } });
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: account.id, amount: 10, description: "Taxa", date: "2026-09-02" });
    expect((await undo(r.body.batchId)).status).toBe(200);
    expect(await prisma.entity.count({ where: { id: r.body.id } })).toBe(1);
  });

  it("PATCH (edit, opening balance, archive) is one batch and undo puts everything back", async () => {
    const edit = await call("PATCH", `/v2/entities/${f.pjId}`, { name: "Kodama SA", initialBalance: 250 });
    expect(edit.body).toMatchObject({ name: "Kodama SA", batchId: expect.any(String) });
    expect((await undo(edit.body.batchId)).status).toBe(200);
    expect((await prisma.entity.findUniqueOrThrow({ where: { id: f.pjId } })).name).toBe("Kodama LTDA");
    expect(toNumber((await prisma.account.findUniqueOrThrow({ where: { id: f.pjChecking } })).initialBalance)).toBe(0);

    const archived = await call("PATCH", `/v2/entities/${f.pjId}`, { archived: true, color: "blue" });
    expect(archived.body).toMatchObject({ archivedAt: expect.any(String), color: "blue", batchId: expect.any(String) });
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: archived.body.batchId }, include: { records: true } });
    expect(batch.op).toBe("entity.archive");
    expect((await undo(archived.body.batchId)).status).toBe(200);
    expect(await prisma.entity.findUniqueOrThrow({ where: { id: f.pjId } })).toMatchObject({ archivedAt: null, color: null });
  });
});

describe("category type on PATCH and bulk", () => {
  it("rejects an income category on an expense (and back) with category.type_mismatch", async () => {
    const e = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 80, description: "Padaria", date: "2026-09-03" });
    const id = e.body.entryIds[0] as string;
    const r = await call("PATCH", `/v2/ledger/entries/${id}`, { categoryId: f.categories.Salary });
    expect(r).toMatchObject({ status: 422, body: { code: "category.type_mismatch", params: { from: "income", to: "expense" } } });
    expect((await call("PATCH", `/v2/ledger/entries/${id}`, { categoryId: f.categories.Groceries })).status).toBe(200);
    // Turning it into an income with an income category is fine; with the expense one it is not.
    expect((await call("PATCH", `/v2/ledger/entries/${id}`, { kind: "income", categoryId: f.categories.Groceries })).body.code).toBe("category.type_mismatch");
    expect((await call("PATCH", `/v2/ledger/entries/${id}`, { kind: "income", categoryId: f.categories.Salary })).status).toBe(200);
  });

  it("still edits a row that already has a category of the other type (a rule's or an import's), as long as the category is left alone", async () => {
    const e = await call("POST", "/v2/ledger/entries", { kind: "income", accountId: f.pfChecking, amount: 30, description: "Estorno mercado", date: "2026-09-06" });
    const id = e.body.entryIds[0] as string;
    // An income refund booked under the expense category by a rule or an import.
    await prisma.ledgerEntry.update({ where: { id }, data: { categoryId: f.categories.Groceries } });
    expect((await call("PATCH", `/v2/ledger/entries/${id}`, { description: "Estorno do mercado" })).status).toBe(200);
    expect((await call("PATCH", `/v2/ledger/entries/${id}`, { description: "Estorno", categoryId: f.categories.Groceries })).status).toBe(200);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).categoryId).toBe(f.categories.Groceries);
    // Bulk leaves it alone too when it already has the category.
    expect(await call("POST", "/v2/ledger/bulk", { op: "update", selection: { ids: [id] }, patch: { categoryId: f.categories.Groceries }, dryRun: true })).toMatchObject({ status: 200 });
  });

  it("rejects the whole bulk change (and its dry run) when a selected entry has the other type; transfers are left out", async () => {
    const expense = (await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 80, description: "Padaria", date: "2026-09-03" })).body.entryIds[0];
    const income = (await call("POST", "/v2/ledger/entries", { kind: "income", accountId: f.pfChecking, amount: 900, description: "Freela", date: "2026-09-04" })).body.entryIds[0];
    const transfer = (await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 50, date: "2026-09-05" })).body.entryIds as string[];

    const mixed = { op: "update", selection: { ids: [expense, income] }, patch: { categoryId: f.categories.Groceries } };
    expect(await call("POST", "/v2/ledger/bulk", { ...mixed, dryRun: true })).toMatchObject({ status: 422, body: { code: "category.type_mismatch" } });
    expect(await call("POST", "/v2/ledger/bulk", mixed)).toMatchObject({ status: 422, body: { code: "category.type_mismatch", params: { from: "expense", to: "income" } } });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: expense } })).categoryId).toBeNull();

    const ok = await call("POST", "/v2/ledger/bulk", { op: "update", selection: { ids: [expense, ...transfer] }, patch: { categoryId: f.categories.Groceries } });
    expect(ok).toMatchObject({ status: 200, body: { affected: 1 } });
    expect((await prisma.ledgerEntry.findMany({ where: { id: { in: transfer } } })).every((l) => l.categoryId === null)).toBe(true);
  });
});

describe("entityKind filter", () => {
  it("selects the business rows in display and legs mode, businesses added later included", async () => {
    await call("POST", "/v2/ledger/entries", { kind: "income", accountId: f.pjChecking, amount: 5000, description: "Invoice", date: "2026-09-02" });
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 80, description: "Padaria", date: "2026-09-03" });
    await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 1000, date: "2026-09-04" });
    const llc = await call("POST", "/v2/entities", { name: "Kodama LLC" });
    const llcAccount = await prisma.account.findFirstOrThrow({ where: { entityId: llc.body.id } });
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: llcAccount.id, amount: 30, description: "Domain", date: "2026-09-05" });

    const query = (semantics: "display" | "legs", values: string[]) =>
      call("POST", "/v2/ledger/query", { semantics, period: { from: "2026-09-01", to: "2026-09-30" }, filters: [{ field: "entityKind", op: "in", values }] });
    const display = await query("display", ["business"]);
    expect(display.status).toBe(200);
    // The PJ side of the PF transfer counts as an outflow of the businesses.
    expect(display.body.summary).toEqual({ income: 5000, expense: 1030, investment: 0, net: 3970, count: 3 });
    const legs = await query("legs", ["business"]);
    expect((legs.body.rows as { description: string }[]).map((r) => r.description).sort()).toEqual(["Domain", "Invoice", expect.any(String)].sort());
    expect((await query("legs", ["personal"])).body.totals.count).toBe(2);

    const grouped = await call("POST", "/v2/ledger/query", { semantics: "display", period: { from: "2026-09-01", to: "2026-09-30" }, groupBy: [{ field: "entityKind" }] });
    // The neutral PJ → PF transfer is one row, under its outflow side.
    expect(Object.fromEntries((grouped.body.groups as { key: string; count: number }[]).map((g) => [g.key, g.count]))).toEqual({ business: 3, personal: 1 });
  });
});
