import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { buildImportPlan, canCommit, encodeUse, initialDecisions, pickUse, reviewSummary, setIncluded, type ImportAnalysis } from "@/lib/import/review";
import { analyzeImport } from "../analyze-import";
import { BANK_FITIDS, BANK_OFX, CARD_CSV, CARD_OFX } from "./fixtures/import-files";

/**
 * The import dialog's backend end to end, through the HTTP routes:
 * analyze (kind, period, account, per-row status), commit (target account,
 * learned rules, card payments, card bills as imports, the import's view)
 * and revert (with undo).
 */

const USER = "test-user-import-dialog-s3";
const app = createApp();
let f: LedgerFixture;
let cookie: string;
let bank2: string;
let transporte: string;
let uberRule: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
  bank2 = (await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Nubank PF", institution: "Nubank", currency: "BRL", externalId: "98765-4" } })).id;
  transporte = (await prisma.category.create({ data: { userId: USER, name: "Transporte", type: "expense" } })).id;
  uberRule = (await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "uber", categoryId: transporte } })).id;
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

const live = (where: object) => prisma.ledgerEntry.findMany({ where: { userId: USER, deletedAt: null, ...where } });

/** The manual entries the bank file repeats: an iFood typed by hand (fuzzy) and a bakery imported before (same FITID). */
async function seedBankDuplicates() {
  const ifood = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 86.9, description: "iFood", date: "2026-09-03" }, prisma);
  const already = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 42, description: "PADARIA", date: "2026-09-10", externalId: BANK_FITIDS.ALREADY }, prisma);
  return { ifood: ifood.entryIds[0], already: already.entryIds[0] };
}

const bankPlan = (ifoodId: string) => ({
  entityType: "personal",
  entityId: f.pfId,
  accountId: bank2,
  currency: "BRL",
  bankName: "Nubank",
  fileName: "extrato-setembro.ofx",
  ledgerBalance: 3157.8,
  transactions: [
    { externalId: BANK_FITIDS.UBER, date: "2026-09-02", description: "UBER *TRIP", amount: 23.4, type: "expense", categoryId: transporte },
    { externalId: BANK_FITIDS.PETZ, date: "2026-09-03", description: "PAG*PETZ", amount: 189.9, type: "expense", categoryId: f.categories.Groceries, createRule: true },
    { externalId: BANK_FITIDS.SALARY, date: "2026-09-05", description: "Pix recebido - ACME CONSULTORIA", amount: 5000, type: "income", categoryId: f.categories.Salary },
    { externalId: BANK_FITIDS.ALREADY, date: "2026-09-10", description: "PADARIA", amount: 42, type: "expense" },
  ],
  duplicateDecisions: [
    { externalId: BANK_FITIDS.IFOOD, resolution: "link_fuzzy", existingTransactionId: ifoodId },
    { externalId: BANK_FITIDS.ALREADY, resolution: "skip_duplicate" },
  ],
  cardPayments: [{ externalId: BANK_FITIDS.BILL, date: "2026-09-12", amount: 1500, description: "Pagamento de fatura", cardAccountId: f.card, statementMonth: "2026-09" }],
});

describe("POST /v2/imports/analyze", () => {
  it("reads a bank OFX (base64): bank, period, the account by its number, and each row's status", async () => {
    const { ifood, already } = await seedBankDuplicates();
    const { status, body: a } = await call("POST", "/v2/imports/analyze", { files: [{ name: "extrato-setembro.ofx", content: Buffer.from(BANK_OFX).toString("base64") }] });
    expect(status).toBe(200);
    expect(a).toMatchObject({
      kind: "bank_ofx",
      fileName: "extrato-setembro.ofx",
      bank: "Nubank",
      currency: "BRL",
      period: { from: "2026-09-01", to: "2026-09-15" },
      count: 6,
      externalAccountId: "98765-4",
      suggestedAccountId: bank2,
      accountMatch: "number",
      entityId: f.pfId,
      ledgerBalance: 3157.8,
      ai: { requested: false, used: false },
    });
    const row = Object.fromEntries((a.rows as { id: string }[]).map((r) => [r.id, r]));
    expect(row[BANK_FITIDS.UBER]).toMatchObject({ status: "rule", kind: "entry", description: "UBER *TRIP", amount: -23.4, suggestedCategoryId: transporte, source: "rule", ruleId: uberRule, rulePattern: "uber" });
    expect(row[BANK_FITIDS.PETZ]).toMatchObject({ status: "need", suggestedCategoryId: null, source: null });
    expect(row[BANK_FITIDS.SALARY]).toMatchObject({ status: "need", type: "income", amount: 5000 });
    expect(row[BANK_FITIDS.IFOOD]).toMatchObject({ status: "dup", reconciliation: "fuzzy_match", duplicateOf: { id: ifood, description: "iFood", date: "2026-09-03" } });
    expect(row[BANK_FITIDS.ALREADY]).toMatchObject({ status: "dup", reconciliation: "duplicate", duplicateOf: { id: already, description: "PADARIA", date: "2026-09-10" } });
    expect(row[BANK_FITIDS.BILL]).toMatchObject({ status: "rule", kind: "card_payment", source: "classification", cardPayment: { cardAccountId: f.card, statementMonth: "2026-09" } });
    expect(a.summary).toEqual({ counts: { all: 6, dup: 2, rule: 2, ai: 0, need: 2 }, income: 5000, expense: 1713.3 });
  });

  it("asks the AI (when requested) only for the rows no rule covers", async () => {
    await seedBankDuplicates();
    const seen: string[] = [];
    const a = await analyzeImport(USER, { files: [{ name: "e.ofx", content: BANK_OFX }], ai: true }, prisma, {
      categorizers: {
        statement: async (rows, _available, _type, fallback) => {
          seen.push(...rows.map((r) => r.description));
          return rows.map((r) => ({ index: r.index, category: r.description.includes("PETZ") ? "Groceries" : fallback }));
        },
      },
    });
    expect(seen.sort()).toEqual(["PAG*PETZ", "Pix recebido - ACME CONSULTORIA"]);
    const row = Object.fromEntries(a.rows.map((r) => [r.id, r]));
    expect(row[BANK_FITIDS.PETZ]).toMatchObject({ status: "ai", source: "ai", suggestedCategoryId: f.categories.Groceries });
    expect(row[BANK_FITIDS.SALARY]).toMatchObject({ status: "need", suggestedCategoryId: null });
    expect(a.ai).toEqual({ requested: true, available: true, used: true });
    expect(a.summary.counts).toMatchObject({ ai: 1, need: 1 });
  });

  it("reads a card OFX: the card by its last digits, the target statement, duplicates and the bill's payment", async () => {
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-10", description: "Uber *Trip", amount: 45.9 }] }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    const paid = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 289.2, description: "Pagamento fatura Nubank", date: "2026-09-11" }, prisma);
    const { status, body: a } = await call("POST", "/v2/imports/analyze", { files: [{ name: "nubank-fatura-2026-09.ofx", content: CARD_OFX }] });
    expect(status).toBe(200);
    expect(a).toMatchObject({
      kind: "card_ofx",
      bank: "Nubank",
      externalAccountId: "5502********1234",
      suggestedAccountId: f.card,
      accountMatch: "number",
      entityId: f.pfId,
      count: 4,
      payments: 1,
      period: { from: "2026-08-10", to: "2026-09-02" },
      card: {
        accountId: f.card,
        month: "2026-09",
        closingDate: "2026-09-05",
        dueDate: "2026-09-12",
        statementId: statement.id,
        total: 289.2,
        existingCount: 1,
        paid: false,
        payFromAccountId: f.pfChecking,
        payment: { entryId: paid.entryIds[0], date: "2026-09-11", amount: -289.2 },
      },
    });
    expect(a.rows.map((r: { id: string; status: string; amount: number }) => [r.id, r.status, r.amount])).toEqual([
      ["c0", "dup", -45.9],
      ["c1", "need", 20],
      ["c2", "need", -199],
      ["c3", "need", -64.3],
    ]);
    expect(a.rows[0].duplicateOf).toMatchObject({ description: "Uber *Trip", date: "2026-08-10" });
    expect(a.rows[2]).toMatchObject({ installment: { number: 2, total: 6 }, replacesProjected: false });
  });

  it("reads a card CSV and, with one card, suggests it", async () => {
    const { body: a } = await call("POST", "/v2/imports/analyze", { files: [{ name: "fatura.csv", content: CARD_CSV }] });
    expect(a).toMatchObject({ kind: "card_csv", bank: "Nubank", externalAccountId: null, suggestedAccountId: f.card, accountMatch: "only", count: 3, payments: 1, card: { month: "2026-09" } });
  });

  it("uses the bill prompt for a card's AI suggestions", async () => {
    const a = await analyzeImport(USER, { files: [{ name: "fatura.csv", content: CARD_CSV }], ai: true }, prisma, {
      categorizers: { bill: async (rows, _available, fallback) => rows.map((r) => ({ index: r.index, category: r.description === "Netflix.com" ? "Software" : fallback })) },
    });
    expect(a.rows.map((r) => [r.description, r.status, r.suggestedCategoryId])).toEqual([
      ["Netflix.com", "ai", f.categories.Software],
      ["Mercado Livre", "need", null],
      ["Padaria Real", "need", null],
    ]);
  });

  it("sends PDFs and images to the assistant, and refuses mixed kinds and the wrong account kind", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]).toString("base64");
    expect((await call("POST", "/v2/imports/analyze", { files: [{ name: "nota.pdf", content: pdf }] })).body).toMatchObject({ kind: "pdf", viaAssistant: true, rows: [] });
    expect(await call("POST", "/v2/imports/analyze", { files: [{ name: "a.ofx", content: BANK_OFX }, { name: "b.csv", content: CARD_CSV }] })).toMatchObject({ status: 422, body: { code: "import.mixed_files" } });
    expect(await call("POST", "/v2/imports/analyze", { files: [{ name: "b.csv", content: CARD_CSV }], accountId: bank2 })).toMatchObject({
      status: 422,
      body: { code: "import.account_kind_mismatch", params: { name: "Nubank PF" } },
    });
  });
});

describe("POST /v2/imports (bank statement)", () => {
  it("books into the chosen account, learns rules, pays the card bill, creates the import's view; revert and undo", async () => {
    const { ifood } = await seedBankDuplicates();
    const commit = await call("POST", "/v2/imports", bankPlan(ifood));
    expect(commit.status).toBe(200);
    const r = commit.body;
    expect(r).toMatchObject({ imported: 4, skipped: 1, rulesCreated: 1, cardPaymentsCreated: 1, rowsImported: 4, fuzzyDuplicatesLinked: 1, accountId: bank2, accountName: "Nubank PF", viewName: "Importação · extrato-setembro" });
    expect(r.importId).toBe(r.statementImportId);

    const rows = await live({ importId: r.importId });
    expect(rows.map((e) => e.accountId).sort()).toEqual([bank2, bank2, bank2, bank2, f.card].sort());
    const uber = rows.find((e) => e.externalId === BANK_FITIDS.UBER)!;
    expect(uber).toMatchObject({ categoryId: transporte, isAutoCategorized: true, categorizedByRuleId: uberRule });
    expect(rows.find((e) => e.externalId === BANK_FITIDS.PETZ)).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: false, categorizedByRuleId: null });
    expect(await prisma.categorizationRule.findFirst({ where: { userId: USER, matchType: "equals", pattern: "pag*petz" } })).toMatchObject({ categoryId: f.categories.Groceries });

    const payment = await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER, externalId: BANK_FITIDS.BILL }, include: { legs: true } });
    expect(payment.direction).toBe("card_payment");
    expect(payment.legs.map((l) => [l.accountId, toNumber(l.amount)]).sort()).toEqual([[bank2, -1500], [f.card, 1500]].sort());
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    expect(statement.paymentGroupId).toBe(payment.id);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ifood } })).externalId).toBe(BANK_FITIDS.IFOOD);
    // Opening balance: the statement's 3157.80 closing balance minus the 3286.70 the import booked.
    expect(toNumber((await prisma.account.findUniqueOrThrow({ where: { id: bank2 } })).initialBalance)).toBe(-128.9);
    const accounts = (await call("GET", "/v2/accounts")).body as { id: string; balance: number }[];
    expect(accounts.find((a) => a.id === bank2)?.balance).toBe(3157.8);

    const view = await prisma.savedView.findUniqueOrThrow({ where: { id: r.viewId } });
    expect(view).toMatchObject({ name: "Importação · extrato-setembro", dataset: "ledger", isFavorite: false });
    expect(view.config).toMatchObject({ period: { preset: "all", offset: 0 }, filters: [{ field: "importId", op: "in", values: [r.importId] }] });
    expect(await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.batchId } })).toMatchObject({ op: "import", source: "import" });
    const history = await call("GET", "/v2/imports");
    expect(history.body.imports[0]).toMatchObject({ id: r.importId, kind: "bank", account: { id: bank2, name: "Nubank PF", type: "checking" }, transactionCount: 4 });

    const reverted = await call("POST", `/v2/imports/${r.importId}/revert`);
    expect(reverted.status).toBe(200);
    expect(reverted.body).toMatchObject({ transactionsDeleted: 3, transfersDeleted: 1, changesRestored: 2, changesKept: 0 });
    expect(await live({ importId: r.importId })).toHaveLength(0);
    expect(await live({ transferGroupId: payment.id })).toHaveLength(0);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBeNull();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ifood } })).externalId).toBeNull();
    expect(toNumber((await prisma.account.findUniqueOrThrow({ where: { id: bank2 } })).initialBalance)).toBe(0);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "pag*petz" } })).toBe(1);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).revertedAt).not.toBeNull();
    expect((await call("GET", "/v2/imports")).body.imports[0].revertedAt).not.toBeNull();

    expect((await call("POST", `/v2/mutations/${reverted.body.batchId}/undo`)).status).toBe(200);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).revertedAt).toBeNull();
    expect(await live({ importId: r.importId })).toHaveLength(5);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBe(payment.id);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ifood } })).externalId).toBe(BANK_FITIDS.IFOOD);
    expect(toNumber((await prisma.account.findUniqueOrThrow({ where: { id: bank2 } })).initialBalance)).toBe(-128.9);
  });

  it("imports the same file again after a revert, bringing the trashed rows back", async () => {
    const { ifood } = await seedBankDuplicates();
    const first = (await call("POST", "/v2/imports", bankPlan(ifood))).body;
    await call("POST", `/v2/imports/${first.importId}/revert`);
    const uber = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, externalId: BANK_FITIDS.UBER } });

    const again = await call("POST", "/v2/imports", bankPlan(ifood));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ imported: 4, cardPaymentsCreated: 1 });
    const rows = await live({ importId: again.body.importId });
    expect(rows.find((e) => e.externalId === BANK_FITIDS.UBER)).toMatchObject({ id: uber.id, categoryId: transporte, categorizedByRuleId: uberRule });
    expect(rows.map((e) => e.externalId)).toContain(`${BANK_FITIDS.BILL}~dup1`);
    expect(await live({ externalId: BANK_FITIDS.UBER })).toHaveLength(1);
  });

  it("imports an exact duplicate anyway under a suffixed external id", async () => {
    await seedBankDuplicates();
    const r = await call("POST", "/v2/imports", {
      entityType: "personal",
      entityId: f.pfId,
      currency: "BRL",
      transactions: [{ externalId: BANK_FITIDS.ALREADY, date: "2026-09-10", description: "PADARIA", amount: 42, type: "expense" }],
      duplicateDecisions: [{ externalId: BANK_FITIDS.ALREADY, resolution: "import_anyway" }],
    });
    expect(r.body).toMatchObject({ imported: 1, skipped: 0, accountId: f.pfChecking, accountName: "Conta principal" });
    expect((await live({ importId: r.body.importId })).map((e) => e.externalId)).toEqual([`${BANK_FITIDS.ALREADY}~dup1`]);
  });

  it("refuses an account of another entity", async () => {
    const r = await call("POST", "/v2/imports", { entityType: "business", entityId: f.pjId, accountId: bank2, currency: "BRL", transactions: [] });
    expect(r).toMatchObject({ status: 422, body: { code: "import.account_entity_mismatch", params: { name: "Nubank PF" } } });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
  });
});

describe("POST /v2/imports (card bill)", () => {
  const cardPlan = () => ({
    entityType: "personal",
    entityId: f.pfId,
    accountId: f.card,
    currency: "BRL",
    bankName: "Nubank",
    fileName: "nubank-fatura-2026-09.ofx",
    cardStatement: {
      month: "2026-09",
      closingDate: "2026-09-05",
      dueDate: "2026-09-12",
      total: 289.2,
      linkPayment: true,
      rows: [
        { date: "2026-08-20", description: "Estorno Amazon", amount: -20 },
        { date: "2026-07-12", description: "Loja Eletronicos", amount: 199, installment: { number: 2, total: 6 }, categoryId: f.categories.Software },
        { date: "2026-09-02", description: "DROGASIL 1234", amount: 64.3, categoryId: f.categories.Groceries, createRule: true },
      ],
    },
  });

  it("is a real import: Import row, tagged rows, learned rule, linked bill payment, view; revert and undo", async () => {
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-10", description: "Uber *Trip", amount: 45.9 }] }, prisma);
    const statement = await prisma.cardStatement.findFirstOrThrow({ where: { accountId: f.card, month: "2026-09" } });
    const paid = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 289.2, description: "Pagamento fatura Nubank", date: "2026-09-11" }, prisma)).entryIds[0];
    const amazonRule = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "amazon", categoryId: f.categories.Groceries } });

    const commit = await call("POST", "/v2/imports", cardPlan());
    expect(commit.status).toBe(200);
    const r = commit.body;
    expect(r).toMatchObject({ imported: 3, cardRowsCreated: 3, cardRowsSkipped: 0, rulesCreated: 1, paymentLinked: true, cardStatementId: statement.id, accountId: f.card, accountName: "Nubank" });
    expect(await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).toMatchObject({ accountId: f.card, fileName: "nubank-fatura-2026-09.ofx", source: "manual", transactionCount: 3 });
    // The installment's later parcels are booked as projected rows, tagged with the import too.
    const tagged = await live({ importId: r.importId });
    expect(tagged.filter((e) => e.cardStatementId === statement.id)).toHaveLength(3);
    expect(tagged).toHaveLength(7);
    expect(await prisma.categorizationRule.findFirst({ where: { userId: USER, pattern: "drogasil 1234" } })).toMatchObject({ categoryId: f.categories.Groceries });
    expect(tagged.find((e) => e.description === "Estorno Amazon")).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: true, categorizedByRuleId: amazonRule.id });
    expect(tagged.find((e) => e.description === "DROGASIL 1234")).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: false, categorizedByRuleId: null });
    const payment = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid } });
    expect(payment).toMatchObject({ kind: "transfer" });
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBe(payment.transferGroupId);
    expect((await call("GET", "/v2/imports")).body.imports[0]).toMatchObject({ id: r.importId, kind: "card", account: { id: f.card, type: "credit_card" } });
    expect((await prisma.savedView.findUniqueOrThrow({ where: { id: r.viewId } })).name).toBe("Importação · nubank-fatura-2026-09");

    const reverted = await call("POST", `/v2/imports/${r.importId}/revert`);
    expect(reverted.status).toBe(200);
    expect(await live({ importId: r.importId })).toHaveLength(0);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid } })).toMatchObject({ kind: "expense", transferGroupId: null, deletedAt: null });
    const reopened = await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } });
    expect(reopened.paymentGroupId).toBeNull();
    expect(reopened.totalAmount).toBeNull();
    expect(await prisma.installmentPlan.findFirstOrThrow({ where: { accountId: f.card } })).toMatchObject({ isActive: false });
    expect(await live({ accountId: f.card, description: "Uber *Trip" })).toHaveLength(1);

    expect((await call("POST", `/v2/mutations/${reverted.body.batchId}/undo`)).status).toBe(200);
    expect(await live({ importId: r.importId })).toHaveLength(7);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid } })).kind).toBe("transfer");
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statement.id } })).paymentGroupId).toBe(payment.transferGroupId);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).revertedAt).toBeNull();
  });

  it("skips rows already on the statement unless imported anyway", async () => {
    const plan = cardPlan();
    plan.cardStatement.linkPayment = false;
    expect((await call("POST", "/v2/imports", plan)).body).toMatchObject({ cardRowsCreated: 3, skipped: 0 });
    expect((await call("POST", "/v2/imports", plan)).body).toMatchObject({ cardRowsCreated: 0, cardRowsSkipped: 3, skipped: 3 });
    const anyway = { ...plan, cardStatement: { ...plan.cardStatement, rows: [{ ...plan.cardStatement.rows[2], allowDuplicate: true }] } };
    expect((await call("POST", "/v2/imports", anyway)).body).toMatchObject({ cardRowsCreated: 1, cardRowsSkipped: 0 });
    expect(await live({ accountId: f.card, description: "DROGASIL 1234" })).toHaveLength(2);
  });

  it("books a card bill file from the card's own route as an import", async () => {
    const r = await call("POST", `/v2/accounts/${f.card}/statements/import-file`, { closingDate: "2026-09-05", dueDate: "2026-09-12", content: CARD_CSV, fileName: "fatura.csv" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 3, skipped: 0, month: "2026-09", transactionCount: 3 });
    expect(await prisma.import.findUniqueOrThrow({ where: { id: r.body.importId } })).toMatchObject({ accountId: f.card, fileName: "fatura.csv" });
    expect(await live({ importId: r.body.importId })).toHaveLength(3);
    expect((await call("POST", `/v2/imports/${r.body.importId}/revert`)).status).toBe(200);
    expect(await live({ accountId: f.card })).toHaveLength(0);
  });
});

describe("the dialog's own plan (lib/import/review) round trip", () => {
  const ctx = (accountId: string) => ({
    entity: { id: f.pfId, kind: "personal" as const },
    accountId,
    entityKinds: new Map<string, "personal" | "business">([
      [f.pfId, "personal"],
      [f.pjId, "business"],
    ]),
    currency: "BRL",
    linkPayment: true,
  });

  it("commits a reviewed bank statement as the dialog builds it", async () => {
    const { ifood } = await seedBankDuplicates();
    const a = (await call("POST", "/v2/imports/analyze", { files: [{ name: "extrato-setembro.ofx", content: BANK_OFX }] })).body as ImportAnalysis;
    const row = (id: string) => a.rows.find((r) => r.id === id)!;
    let decisions = initialDecisions(a);
    decisions = pickUse(decisions, row(BANK_FITIDS.PETZ), encodeUse({ as: "category", categoryId: f.categories.Groceries })!);
    decisions = pickUse(decisions, row(BANK_FITIDS.SALARY), encodeUse({ as: "transfer", entityId: f.pjId })!);
    const summary = reviewSummary(a.rows, decisions);
    expect(summary).toMatchObject({ included: 4, ignored: 2, ignoredDuplicates: 2, rules: 1, transfers: 2 });

    const r = await call("POST", "/v2/imports", buildImportPlan(a, decisions, ctx(a.suggestedAccountId!)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accountId: bank2, rulesCreated: 1, cardPaymentsCreated: 1, fuzzyDuplicatesLinked: 1, viewName: "Importação · extrato-setembro" });
    const rows = await live({ importId: r.body.importId });
    expect(rows.find((e) => e.externalId === BANK_FITIDS.PETZ)).toMatchObject({ accountId: bank2, categoryId: f.categories.Groceries });
    expect(rows.find((e) => e.externalId === BANK_FITIDS.UBER)).toMatchObject({ categoryId: transporte, categorizedByRuleId: uberRule });
    const salary = await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER, externalId: BANK_FITIDS.SALARY }, include: { legs: true } });
    expect(salary.direction).toBe("profit_distribution");
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: ifood } })).externalId).toBe(BANK_FITIDS.IFOOD);
    expect(await live({ externalId: BANK_FITIDS.ALREADY })).toHaveLength(1);
  });

  it("commits a reviewed card bill as the dialog builds it", async () => {
    const a = (await call("POST", "/v2/imports/analyze", { files: [{ name: "fatura.csv", content: CARD_CSV }] })).body as ImportAnalysis;
    expect(canCommit(a, a.suggestedAccountId)).toBe(true);
    let decisions = initialDecisions(a);
    decisions = pickUse(decisions, a.rows[0], encodeUse({ as: "category", categoryId: f.categories.Software })!);
    decisions = setIncluded(decisions, a.rows[2], false);

    const r = await call("POST", "/v2/imports", buildImportPlan(a, decisions, ctx(a.suggestedAccountId!)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accountId: f.card, cardRowsCreated: 2, rulesCreated: 1 });
    expect(await prisma.import.findUniqueOrThrow({ where: { id: r.body.importId } })).toMatchObject({ accountId: f.card, fileName: "fatura.csv" });
    const rows = await live({ importId: r.body.importId });
    expect(rows.map((e) => e.description).sort()).toEqual([a.rows[0].description, a.rows[1].description].sort());
    expect(rows.find((e) => e.description === a.rows[0].description)).toMatchObject({ categoryId: f.categories.Software });
  });
});
