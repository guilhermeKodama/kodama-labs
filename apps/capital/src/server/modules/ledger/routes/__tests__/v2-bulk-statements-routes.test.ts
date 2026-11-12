import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

/** The bulk delete and duplicate ops, a view export, the rule delete, and the card statements routes. */
const USER = "test-user-ledger-bulk-routes-001";
const OTHER = "test-user-ledger-bulk-routes-002";
const app = createApp();
let f: LedgerFixture;
let o: LedgerFixture;
let cookie: string;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, body: parsed as Record<string, unknown> & unknown[], text, headers: res.headers };
};

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  o = await createLedgerFixture(prisma, OTHER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const expense = async (description: string, extra: Record<string, unknown> = {}) => {
  const r = await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.pfChecking, amount: 20, date: "2026-09-10", description, ...extra });
  return (r.body as unknown as { entryIds: string[] }).entryIds[0];
};
const live = (ids: string[]) => prisma.ledgerEntry.count({ where: { id: { in: ids }, deletedAt: null } });

describe("POST /v2/ledger/bulk delete and duplicate", () => {
  it("trashes the selected rows, a transfer as one, and reports how many", async () => {
    const a = await expense("Uma");
    const b = await expense("Duas");
    const t = await call("POST", "/v2/ledger/entries", { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 5, date: "2026-09-11" });
    const legs = (t.body as unknown as { entryIds: string[] }).entryIds;
    const r = await call("POST", "/v2/ledger/bulk", { op: "delete", selection: { ids: [a, b, legs[0]] } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ affected: 4 });
    expect(await live([a, b, ...legs])).toBe(0);
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.body.batchId as string } });
    expect(batch).toMatchObject({ op: "delete", summary: "3 entries" });
    const undo = await call("POST", `/v2/mutations/${batch.id}/undo`);
    expect(undo.status).toBe(200);
    expect(await live([a, b, ...legs])).toBe(4);
  });

  it("duplicates the selection, returning the new ids", async () => {
    const a = await expense("Original");
    const r = await call("POST", "/v2/ledger/bulk", { op: "duplicate", selection: { ids: [a] } });
    expect(r.status).toBe(200);
    const copies = r.body.entryIds as string[];
    expect(copies).toHaveLength(1);
    expect(r.body.affected).toBe(1);
    expect(copies[0]).not.toBe(a);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: copies[0] } })).metadata).toMatchObject({ duplicatedFrom: a });
  });

  it("selects by query, and does nothing when the selection is empty", async () => {
    await expense("Setembro");
    const empty = await call("POST", "/v2/ledger/bulk", { op: "delete", selection: { query: { period: { from: "2019-01-01", to: "2019-01-31" } } } });
    expect(empty.body).toEqual({ batchId: null, affected: 0 });
    const emptyDry = await call("POST", "/v2/ledger/bulk", { op: "update", selection: { query: { period: { from: "2019-01-01", to: "2019-01-31" } } }, patch: { isTaxDeductible: true }, dryRun: true });
    expect(emptyDry.body).toEqual({ dryRun: true, matched: 0, changed: 0, byField: {}, rulesLearned: 0 });
    const byQuery = await call("POST", "/v2/ledger/bulk", { op: "delete", selection: { query: { period: { from: "2026-09-01", to: "2026-09-30" } } } });
    expect(byQuery.body).toMatchObject({ affected: 1 });
  });

  it("updates by ids and reports what changed and matched", async () => {
    const a = await expense("Editavel");
    const r = await call("POST", "/v2/ledger/bulk", { op: "update", selection: { ids: [a, "unknown-id"] }, patch: { isTaxDeductible: true } });
    expect(r.body).toMatchObject({ affected: 1, matched: 1, rulesLearned: 0 });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: a } })).isTaxDeductible).toBe(true);
  });

  it("422s on a selection of nothing and on a query that is not one", async () => {
    expect((await call("POST", "/v2/ledger/bulk", { op: "delete", selection: { ids: [] } })).status).toBe(422);
    expect((await call("POST", "/v2/ledger/bulk", { op: "delete", selection: { query: { period: { from: "bad", to: "worse" } } } })).status).toBe(422);
  });
});

describe("POST /v2/ledger/export from a view", () => {
  it("exports the rows a saved ledger view selects, as an attachment", async () => {
    await expense("No export", { date: "2026-09-12" });
    await expense("Fora do periodo", { date: "2026-07-12" });
    const view = await call("POST", "/v2/views", { name: "Setembro", config: { period: { from: "2026-09-01", to: "2026-09-30" } } });
    const r = await call("POST", "/v2/ledger/export", { viewId: view.body.id });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="cerne-export.csv"');
    expect(r.text).toContain("No export");
    expect(r.text).not.toContain("Fora do periodo");
    expect((await call("POST", "/v2/ledger/export", { viewId: "nope" })).body).toMatchObject({ code: "view.not_found" });
  });
});

describe("DELETE /v2/rules/{id}", () => {
  it("deletes the user's rule, reports the batch, and 404s on a rule that is gone or someone else's", async () => {
    const rule = await call("POST", "/v2/rules", { matchType: "contains", pattern: "uber", categoryId: f.categories.Groceries });
    const id = rule.body.id as string;
    const otherRule = await prisma.categorizationRule.create({ data: { userId: OTHER, matchType: "contains", pattern: "x", categoryId: o.categories.Groceries } });
    expect((await call("DELETE", `/v2/rules/${otherRule.id}`)).body).toMatchObject({ code: "rule.not_found" });
    const r = await call("DELETE", `/v2/rules/${id}`);
    expect(r.body).toMatchObject({ ok: true, batchId: expect.any(String) });
    expect(await prisma.categorizationRule.count({ where: { id } })).toBe(0);
    expect((await call("DELETE", `/v2/rules/${id}`)).status).toBe(404);
    expect((await call("GET", "/v2/rules")).body).toEqual([]);
  });
});

describe("card statements routes", () => {
  it("lists the card's statements newest first with the purchases on each", async () => {
    await expense("Mercado", { accountId: f.card, date: "2026-08-03", amount: 100 });
    await expense("Posto", { accountId: f.card, date: "2026-09-03", amount: 40 });
    await expense("Estorno", { accountId: f.card, date: "2026-09-04", amount: -10 });
    await call("POST", "/v2/ledger/entries", { kind: "expense", accountId: f.card, amount: 30, date: "2026-09-04", description: "Apagada" }).then(async (r) => {
      await call("DELETE", `/v2/ledger/entries/${(r.body as unknown as { entryIds: string[] }).entryIds[0]}`);
    });
    const r = await call("GET", `/v2/accounts/${f.card}/statements`);
    expect(r.status).toBe(200);
    const rows = r.body as unknown as { month: string; purchasesTotal: number; purchaseCount: number; declaredTotal: number | null; paymentGroupId: string | null; closingDate: string; dueDate: string }[];
    expect(rows.map((s) => s.month)).toEqual(["2026-09", "2026-08"]);
    expect(rows[0]).toMatchObject({ purchasesTotal: 30, purchaseCount: 2, declaredTotal: null, paymentGroupId: null });
    expect(rows[0].closingDate).toContain("2026-09-05");
    expect(rows[1]).toMatchObject({ purchasesTotal: 100, purchaseCount: 1 });
  });

  it("shows the declared total and an empty month as zero", async () => {
    await expense("Mercado", { accountId: f.card, date: "2026-08-03", amount: 100 });
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    await prisma.cardStatement.create({ data: { accountId: f.card, month: "2026-12", totalAmount: 777.7 } });
    await prisma.ledgerEntry.updateMany({ where: { cardStatementId: statement.id }, data: { deletedAt: new Date() } });
    const rows = (await call("GET", `/v2/accounts/${f.card}/statements`)).body as unknown as { month: string; declaredTotal: number | null; purchasesTotal: number; purchaseCount: number }[];
    const december = rows.find((s) => s.month === "2026-12")!;
    expect(december).toMatchObject({ declaredTotal: 777.7, purchaseCount: 0 });
    expect(Math.abs(december.purchasesTotal)).toBe(0);
    expect(rows.map((s) => s.month)).toEqual(["2026-12", "2026-08"]);
    // Purchases in the trash do not count towards their statement.
    expect(rows.find((s) => s.month === "2026-08")).toMatchObject({ purchaseCount: 0 });
    expect(Math.abs(rows.find((s) => s.month === "2026-08")!.purchasesTotal)).toBe(0);
  });

  it("404s for an account that is not the user's", async () => {
    expect((await call("GET", `/v2/accounts/${o.card}/statements`)).body).toMatchObject({ code: "account.not_found" });
    expect((await call("GET", "/v2/accounts/nope/statements")).status).toBe(404);
  });

  it("marks an expense as a statement's payment and undoes the link", async () => {
    await expense("Compra", { accountId: f.card, date: "2026-09-03", amount: 90 });
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card } });
    const payment = await expense("Pagamento", { date: "2026-09-12", amount: 90 });

    const marked = await call("POST", `/v2/card-statements/${statement.id}/payment`, { entryId: payment });
    expect(marked.status).toBe(200);
    const groupId = (marked.body as unknown as { groupId: string }).groupId;
    expect((await call("GET", `/v2/accounts/${f.card}/statements`)).body[0]).toMatchObject({ paymentGroupId: groupId });
    expect((await call("POST", `/v2/card-statements/${statement.id}/payment`, { entryId: "nope" })).body).toMatchObject({ code: "entry.not_found" });
    expect((await call("POST", `/v2/card-statements/${statement.id}/payment`, {})).status).toBe(422);

    const unmarked = await call("DELETE", `/v2/card-statements/payment/${payment}`);
    expect(unmarked.body).toMatchObject({ statementId: statement.id });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: payment } })).kind).toBe("expense");
    expect((await call("DELETE", `/v2/card-statements/payment/${payment}`)).body).toMatchObject({ code: "statement.not_settlement" });
  });
});
