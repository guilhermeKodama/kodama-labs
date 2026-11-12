import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { BANK_OFX, CARD_CSV } from "../../services/__tests__/fixtures/import-files";

/**
 * /v2/imports: the history list, the revert (which also puts back the
 * cards an assistant import created) and the import route's validation.
 */

const USER = "test-user-imports-routes-a";
const app = createApp();
let f: LedgerFixture;
let cookie: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, `${USER}-other`);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, `${USER}-other`);
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

describe("GET /v2/imports", () => {
  it("is empty for a user with no import", async () => {
    expect((await call("GET", "/v2/imports")).body).toEqual({ imports: [] });
  });

  it("lists the user's imports newest first, as bank or card, with counts, and an import whose account is gone as a bank one", async () => {
    const older = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.card, bankName: "Nubank", fileName: "fatura.csv", transactionCount: 3, createdAt: new Date("2026-09-01T10:00:00Z") } });
    const newer = await prisma.import.create({
      data: { userId: USER, entityId: f.pjId, accountId: f.pjChecking, fileName: "extrato.ofx", transactionCount: 2, source: "agent", revertedAt: new Date("2026-09-05T10:00:00Z"), createdAt: new Date("2026-09-04T10:00:00Z") },
    });
    const orphan = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: null, transactionCount: 0, createdAt: new Date("2026-09-06T10:00:00Z") } });
    await prisma.import.create({ data: { userId: `${USER}-other`, transactionCount: 9 } });
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 5, description: "Uber", date: "2026-08-10" }, prisma, { importId: older.id });

    const { imports } = (await call("GET", "/v2/imports")).body as { imports: Record<string, unknown>[] };
    expect(imports.map((i) => i.id)).toEqual([orphan.id, newer.id, older.id]);
    expect(imports[0]).toMatchObject({ kind: "bank", account: null, accountId: null, entity: { id: f.pfId, kind: "personal" }, revertedAt: null, source: "manual" });
    expect(imports[1]).toMatchObject({ kind: "bank", account: { id: f.pjChecking, type: "checking" }, entity: { id: f.pjId, kind: "business" }, source: "agent", revertedAt: "2026-09-05T10:00:00.000Z", bankName: null });
    expect(imports[2]).toMatchObject({ kind: "card", account: { id: f.card, type: "credit_card" }, bankName: "Nubank", fileName: "fatura.csv", transactionCount: 3, entries: 1, transfers: 0 });
  });
});

describe("POST /v2/imports/{id}/revert", () => {
  it("answers 404 for an import that is not the user's", async () => {
    const theirs = await prisma.import.create({ data: { userId: `${USER}-other`, transactionCount: 0 } });
    expect(await call("POST", "/v2/imports/nao-existe/revert")).toMatchObject({ status: 404, body: { code: "import.not_found" } });
    expect(await call("POST", `/v2/imports/${theirs.id}/revert`)).toMatchObject({ status: 404, body: { code: "import.not_found" } });
  });

  it("uses the records of the assistant's successful commit of that import to archive the cards it created", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 0 } });
    const card = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Itaú ****9876", currency: "BRL", closingDay: 10, dueDay: 17 } });
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "Importar" } });
    const action = (status: string, createdRecords: unknown, toolName = "commit_plan") =>
      prisma.agentAction.create({ data: { userId: USER, conversationId: conversation.id, toolName, input: {}, status, createdRecords: createdRecords as never } });
    // Neither a failed commit nor another tool's record counts.
    await action("error", [{ model: "Import", id: imp.id }, { model: "Account", id: card.id }]);
    await action("success", [{ model: "Import", id: imp.id }, { model: "Account", id: card.id }], "update_bill");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: card.id } })).archivedAt).toBeNull();
    await action("success", [{ model: "Import", id: imp.id }, { model: "Account", id: card.id }]);

    const r = await call("POST", `/v2/imports/${imp.id}/revert`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ creditCardsDeleted: 1 });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: card.id } })).archivedAt).not.toBeNull();
  });

  it("reverts an import with no assistant record, without archiving anything", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 0 } });
    expect((await call("POST", `/v2/imports/${imp.id}/revert`)).body).toMatchObject({ creditCardsDeleted: 0, transactionsDeleted: 0 });
    // A record that is not a list is ignored too.
    const again = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, transactionCount: 0 } });
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "x" } });
    await prisma.agentAction.create({ data: { userId: USER, conversationId: conversation.id, toolName: "commit_plan", input: {}, status: "success", createdRecords: { model: "Import", id: again.id } } });
    expect((await call("POST", `/v2/imports/${again.id}/revert`)).status).toBe(200);
  });
});

describe("POST /v2/imports/analyze and POST /v2/imports validation", () => {
  it("refuses a request with no file, with more than ten, or with an empty one", async () => {
    expect((await call("POST", "/v2/imports/analyze", { files: [] })).status).toBe(422);
    expect((await call("POST", "/v2/imports/analyze", { files: Array.from({ length: 11 }, () => ({ content: CARD_CSV })) })).status).toBe(422);
    expect((await call("POST", "/v2/imports/analyze", { files: [{ content: "" }] })).status).toBe(422);
  });

  it("answers a file that is no statement with import.invalid_file (400), and analyzes a text-encoded one", async () => {
    expect(await call("POST", "/v2/imports/analyze", { files: [{ name: "notas.txt", content: "just notes" }] })).toMatchObject({ status: 400, body: { code: "import.invalid_file" } });
    const r = await call("POST", "/v2/imports/analyze", { files: [{ name: "e.ofx", content: BANK_OFX, encoding: "text" }], accountId: null });
    expect(r).toMatchObject({ status: 200, body: { kind: "bank_ofx", bank: "Nubank", count: 6 } });
  });

  it("refuses an import plan with no entity or a currency that is no ISO code", async () => {
    expect((await call("POST", "/v2/imports", { entityType: "personal", currency: "BRL" })).status).toBe(422);
    expect((await call("POST", "/v2/imports", { entityType: "personal", entityId: f.pfId, currency: "REAL" })).status).toBe(422);
  });
});

describe("POST /v2/accounts/{id}/statements/import-rows", () => {
  const rows = [
    { date: "2026-08-10", description: "Uber", amount: 45.9 },
    { date: "2026-08-20", description: "Estorno", amount: -20 },
  ];

  it("books the rows on the month's statement with no category guessed, and booking them again changes nothing", async () => {
    const first = await call("POST", `/v2/accounts/${f.card}/statements/import-rows`, { month: "2026-09", rows });
    expect(first).toMatchObject({ status: 200, body: { created: 2, skipped: 0 } });
    const entries = await prisma.ledgerEntry.findMany({ where: { userId: USER, accountId: f.card, cardStatementId: first.body.statementId }, orderBy: { description: "asc" } });
    expect(entries.map((e) => [e.description, Number(e.amount), e.categoryId])).toEqual([
      ["Estorno", 20, null],
      ["Uber", -45.9, null],
    ]);
    expect((await call("POST", `/v2/accounts/${f.card}/statements/import-rows`, { month: "2026-09", rows })).body).toMatchObject({ created: 0, skipped: 2 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, accountId: f.card } })).toBe(2);
  });

  it("answers 404 for a card of someone else, 422 for an account that is no card and for rows the schema refuses", async () => {
    const other = await prisma.account.findFirstOrThrow({ where: { userId: `${USER}-other`, type: "credit_card" } });
    expect(await call("POST", `/v2/accounts/${other.id}/statements/import-rows`, { month: "2026-09", rows })).toMatchObject({ status: 404, body: { code: "account.not_found" } });
    expect(await call("POST", `/v2/accounts/${f.pfChecking}/statements/import-rows`, { month: "2026-09", rows })).toMatchObject({ status: 422, body: { code: "account.not_credit_card" } });
    expect((await call("POST", `/v2/accounts/${f.card}/statements/import-rows`, { month: "2026-09", rows: [] })).status).toBe(422);
    expect((await call("POST", `/v2/accounts/${f.card}/statements/import-rows`, { month: "setembro", rows })).status).toBe(422);
    expect((await call("POST", `/v2/accounts/${f.card}/statements/import-rows`, { month: "2026-09", rows: [{ date: "10/08/2026", description: "Uber", amount: 1 }] })).status).toBe(422);
  });
});

describe("POST /v2/accounts/{id}/statements/import-file", () => {
  it("answers 404 for a card of someone else and refuses a body without dates or content", async () => {
    const other = await prisma.account.findFirstOrThrow({ where: { userId: `${USER}-other`, type: "credit_card" } });
    const body = { closingDate: "2026-09-05", dueDate: "2026-09-12", content: CARD_CSV };
    expect(await call("POST", `/v2/accounts/${other.id}/statements/import-file`, body)).toMatchObject({ status: 404, body: { code: "account.not_found" } });
    expect((await call("POST", `/v2/accounts/${f.card}/statements/import-file`, { ...body, content: "" })).status).toBe(422);
    expect((await call("POST", `/v2/accounts/${f.card}/statements/import-file`, { ...body, closingDate: "05/09/2026" })).status).toBe(422);
  });
});
