import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { executeImport } from "../execute-import";
import { executeRevert } from "../execute-revert";

const blobs = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  getObjectBuffer: async (url: string) => blobs.get(url) ?? null,
}));

/**
 * executeImport: the rows it books (categories, rules, restored rows,
 * opening balance), card bills and their payment, bill files and new cards
 * of the assistant's plans, investment operations and the import's view.
 */

const USER = "test-user-exec-import-rows-a";
let f: LedgerFixture;

beforeEach(async () => {
  blobs.clear();
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const plan = (over: Partial<ImportPlanPayload> = {}): ImportPlanPayload => ({
  entityType: "personal",
  entityId: f.pfId,
  currency: "BRL",
  transactions: [],
  transfers: [],
  investmentTransfers: [],
  creditCards: [],
  bills: [],
  reconciliations: [],
  transferReconciliations: [],
  duplicateDecisions: [],
  investmentTransactions: [],
  ...over,
});
const run = (p: ImportPlanPayload, options?: Parameters<typeof executeImport>[3]) => executeImport(USER, p, prisma, options);
const tx = (over: Partial<ImportPlanPayload["transactions"][number]> = {}): ImportPlanPayload["transactions"][number] => ({
  externalId: "fit-1",
  date: "2026-09-02",
  description: "Padaria",
  amount: 25,
  type: "expense",
  ...over,
});
const imported = (importId: string) => prisma.ledgerEntry.findMany({ where: { importId, deletedAt: null }, orderBy: { externalId: "asc" } });

describe("transaction categories", () => {
  it("answers 404 for a category id that is not the user's, and 422 for an archived one by id or by name, writing nothing", async () => {
    await expect(run(plan({ transactions: [tx({ categoryId: "nao-existe" })] }))).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    await expect(run(plan({ transactions: [tx({ categoryId: f.categories.Software })] }))).rejects.toMatchObject({ status: 422, code: "category.archived", params: { name: "Software" } });
    await expect(run(plan({ transactions: [tx({ category: "software" })] }))).rejects.toMatchObject({ status: 422, code: "category.archived", params: { name: "Software" } });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
  });

  it("finds a category by name preferring the row's type, falls back to the name alone, and leaves an unknown name uncategorized", async () => {
    const r = await run(
      plan({
        transactions: [
          tx({ externalId: "a", category: "salary", type: "income", description: "Salario" }),
          tx({ externalId: "b", category: "GROCERIES", description: "Mercado" }),
          // A refund booked as income under an expense category's name: the name alone still finds it.
          tx({ externalId: "c", category: "Groceries", type: "income", description: "Estorno mercado" }),
          tx({ externalId: "d", category: "inexistente", description: "Outro" }),
        ],
      })
    );
    const byFit = Object.fromEntries((await imported(r.importId)).map((e) => [e.externalId, e.categoryId]));
    expect(byFit).toEqual({ a: f.categories.Salary, b: f.categories.Groceries, c: f.categories.Groceries, d: null });
  });

  it("leaves the import pending while a row has no category, and completes it when every row has one", async () => {
    const pending = await run(plan({ transactions: [tx({ externalId: "p1" }), tx({ externalId: "p2", categoryId: f.categories.Groceries })] }));
    expect((await prisma.import.findUniqueOrThrow({ where: { id: pending.importId } })).categorizationStatus).toBe("pending");
    const done = await run(plan({ transactions: [tx({ externalId: "d1", categoryId: f.categories.Groceries })] }));
    expect((await prisma.import.findUniqueOrThrow({ where: { id: done.importId } })).categorizationStatus).toBe("completed");
  });

  it("applies a matching rule when no category is chosen or the chosen one is the rule's, and counts its hits", async () => {
    const rule = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "uber", categoryId: f.categories.Groceries } });
    const r = await run(
      plan({
        transactions: [
          tx({ externalId: "r1", description: "Uber Trip" }),
          tx({ externalId: "r2", description: "Uber Eats", categoryId: f.categories.Groceries }),
          tx({ externalId: "r3", description: "Uber Pro", categoryId: f.categories.Software }),
        ],
      })
    );
    const byFit = Object.fromEntries((await imported(r.importId)).map((e) => [e.externalId, e]));
    expect(byFit.r1).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: true, categorizedByRuleId: rule.id });
    expect(byFit.r2).toMatchObject({ categoryId: f.categories.Groceries, isAutoCategorized: true, categorizedByRuleId: rule.id });
    expect(byFit.r3).toMatchObject({ categoryId: f.categories.Software, isAutoCategorized: false, categorizedByRuleId: null });
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).hitCount).toBe(2);
  });

  it("learns a rule from a row the review marked (createRule), unless a rule already decided it, and counts the new or moved ones", async () => {
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "uber", categoryId: f.categories.Groceries } });
    const moved = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "equals", pattern: "padaria real", categoryId: f.categories.Software } });
    const r = await run(
      plan({
        transactions: [
          tx({ externalId: "l1", description: "Netflix", categoryId: f.categories.Software, createRule: true }),
          tx({ externalId: "l2", description: "Padaria Real", categoryId: f.categories.Groceries, createRule: true }),
          // The rule for "uber" decides this one, so nothing new is learned from it.
          tx({ externalId: "l3", description: "Uber X", categoryId: f.categories.Groceries, createRule: true }),
          tx({ externalId: "l4", description: "Sem regra", categoryId: f.categories.Groceries }),
        ],
      })
    );
    expect(r.rulesCreated).toBe(2);
    expect(await prisma.categorizationRule.findFirst({ where: { userId: USER, matchType: "equals", pattern: "netflix" } })).toMatchObject({ categoryId: f.categories.Software });
    expect((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: moved.id } })).categoryId).toBe(f.categories.Groceries);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "uber x" } })).toBe(0);
  });
});

describe("duplicates and rows of earlier imports", () => {
  it("answers 404 when a fuzzy link points at an entry that is not the user's, and ignores a fuzzy decision with no entry", async () => {
    await expect(run(plan({ transactions: [tx()], duplicateDecisions: [{ externalId: "fit-1", resolution: "link_fuzzy", existingTransactionId: "nao-existe" }] }))).rejects.toMatchObject({
      status: 404,
      code: "entry.not_found",
    });
    const r = await run(plan({ transactions: [tx()], duplicateDecisions: [{ externalId: "fit-1", resolution: "link_fuzzy" }] }));
    expect(r).toMatchObject({ imported: 1, fuzzyDuplicatesLinked: 0, duplicatesSkipped: 0 });
  });

  it("counts a row the review skipped and one the safety net found already booked as skipped duplicates", async () => {
    await run(plan({ transactions: [tx({ externalId: "booked" })] }));
    const r = await run(
      plan({
        // "review-skip" is a duplicate the review left out of the rows; "booked" was imported meanwhile (the plan is minutes old).
        transactions: [tx({ externalId: "booked" }), tx({ externalId: "new", description: "Novo" })],
        duplicateDecisions: [{ externalId: "review-skip", resolution: "skip_duplicate" }],
      })
    );
    expect(r).toMatchObject({ imported: 1, duplicatesSkipped: 2, skipped: 2 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, externalId: "booked", deletedAt: null } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, externalId: "new", deletedAt: null } })).toBe(1);
  });

  it("books under a ~dup id a row whose FITID is held by a trashed leg of a transfer, instead of reviving the leg", async () => {
    const first = await run(plan({ cardPayments: [{ externalId: "pay-1", date: "2026-09-11", amount: 100, cardAccountId: f.card }] }));
    await executeRevert(USER, { statementImportId: first.importId, createdRecords: [] }, prisma);
    const again = await run(plan({ transactions: [tx({ externalId: "pay-1", description: "Pagamento", amount: 100 })] }));
    expect(again.imported).toBe(1);
    const row = (await imported(again.importId))[0];
    expect(row.externalId).toBe("pay-1~dup1");
    expect(row.transferGroupId).toBeNull();
  });
});

describe("the account's opening balance", () => {
  const balance = async () => toNumber((await prisma.account.findUniqueOrThrow({ where: { id: f.pfChecking } })).initialBalance);

  it("is set once, from the statement's closing balance and the rows up to its last date", async () => {
    await run(plan({ ledgerBalance: 1000, transactions: [tx({ externalId: "o1", amount: 300, date: "2026-09-10" }), tx({ externalId: "o2", description: "Salario", type: "income", amount: 100, date: "2026-09-05" })] }));
    // held = -300 + 100 = -200 → opening = 1000 - (-200)
    expect(await balance()).toBe(1200);
    // A second import into the same account does not move it.
    await run(plan({ ledgerBalance: 5000, transactions: [tx({ externalId: "o3", description: "Outro", amount: 10 })] }));
    expect(await balance()).toBe(1200);
  });

  it("is the whole closing balance when the statement has no rows, and is not set for a card", async () => {
    await run(plan({ ledgerBalance: 750 }));
    expect(await balance()).toBe(750);
    await run(plan({ accountId: f.card, ledgerBalance: 99, cardStatement: { month: "2026-09", rows: [] } }));
    expect(toNumber((await prisma.account.findUniqueOrThrow({ where: { id: f.card } })).initialBalance)).toBe(0);
    expect((await prisma.import.findFirstOrThrow({ where: { accountId: f.card } })).ledgerBalance).toBeNull();
  });
});

describe("card statement in a plan", () => {
  const cardPlan = (rows: NonNullable<ImportPlanPayload["cardStatement"]>["rows"], extra: Partial<NonNullable<ImportPlanPayload["cardStatement"]>> = {}) =>
    plan({ accountId: f.card, cardStatement: { month: "2026-09", closingDate: "2026-09-05", dueDate: "2026-09-12", rows, ...extra } });
  const row = (over: Partial<NonNullable<ImportPlanPayload["cardStatement"]>["rows"][number]> = {}) => ({ date: "2026-08-20", description: "Mercado", amount: 60, ...over });

  it("links the bank expense that paid the bill, summing the rows when the plan states no total", async () => {
    const paid = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, description: "Pagamento fatura", date: "2026-09-11" }, prisma)).entryIds[0];
    const r = await run(cardPlan([row(), row({ description: "Padaria", amount: 40 })], { linkPayment: true }));
    expect(r).toMatchObject({ cardRowsCreated: 2, paymentLinked: true });
    const statement = await prisma.cardStatement.findUniqueOrThrow({ where: { id: r.cardStatementId! } });
    expect(statement.totalAmount).toBeNull();
    expect(statement.paymentGroupId).toBe((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid } })).transferGroupId);
  });

  it("does not link anything when no expense matches the bill", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 99, description: "Outra coisa", date: "2026-09-11" }, prisma);
    const r = await run(cardPlan([row()], { linkPayment: true, total: 60 }));
    expect(r.paymentLinked).toBe(false);
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: r.cardStatementId! } })).paymentGroupId).toBeNull();
  });

  it("learns the rules the review marked, except when a rule already gives that category", async () => {
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "drogasil", categoryId: f.categories.Groceries } });
    const r = await run(
      cardPlan([
        row({ description: "DROGASIL 1234", categoryId: f.categories.Groceries, createRule: true }),
        row({ description: "Farmacia Sao Joao", amount: 30, categoryId: f.categories.Groceries, createRule: true }),
        row({ description: "Livraria", amount: 20, createRule: true }),
      ])
    );
    expect(r.rulesCreated).toBe(1);
    expect(await prisma.categorizationRule.findFirst({ where: { userId: USER, pattern: "farmacia sao joao" } })).toMatchObject({ categoryId: f.categories.Groceries });
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "drogasil 1234" } })).toBe(0);
  });

  it("keeps the import pending while a card row has no category, and completes it once every card row has one", async () => {
    const r = await run(cardPlan([row()]));
    expect((await prisma.import.findUniqueOrThrow({ where: { id: r.importId } })).categorizationStatus).toBe("pending");
    const done = await run(cardPlan([row({ description: "Outro", amount: 11, categoryId: f.categories.Groceries })]));
    expect((await prisma.import.findUniqueOrThrow({ where: { id: done.importId } })).categorizationStatus).toBe("completed");
  });

  it("updates the entries the bill changed (moving the date, linking the FITID) and trashes the ones that left it", async () => {
    await run(cardPlan([row({ description: "Restaurante", amount: 87.9, externalId: "open-1" }), row({ description: "Cinema", amount: 40 })]));
    const [restaurant, cinema] = await Promise.all(["Restaurante", "Cinema"].map((description) => prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, description } })));
    const r = await run(
      plan({
        accountId: f.card,
        reconciliations: [{ existingTransactionId: restaurant.id, externalId: "closed-1", linkExternalId: true, updates: { amount: 88.5, date: "2026-08-21", description: "Restaurante Sabor" } }],
        cardStatement: { month: "2026-09", closingDate: "2026-09-05", dueDate: "2026-09-12", rows: [], removeEntryIds: [cinema.id], matchedEntryIds: [restaurant.id] },
      })
    );
    expect(r).toMatchObject({ reconciled: 1, cardRowsRemoved: 1, cardRowsCreated: 0 });
    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: restaurant.id } });
    expect([toNumber(after.amount), after.description, after.externalId, after.date.toISOString().slice(0, 10)]).toEqual([-88.5, "Restaurante Sabor", "closed-1", "2026-08-21"]);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: cinema.id } })).deletedAt).not.toBeNull();
  });
});

describe("credit cards and bill files of the assistant's plans", () => {
  async function billFile(content: string) {
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "Faturas" } });
    const url = `blob://bill-${blobs.size}`;
    blobs.set(url, Buffer.from(content));
    return prisma.conversationFile.create({
      data: { conversationId: conversation.id, userId: USER, fileType: "csv", statementKind: "card_csv", blobUrl: url, pathname: "fatura.csv", mimeType: "text/csv", sizeBytes: content.length, originalName: "fatura.csv" },
    });
  }
  const CSV = "date,title,amount\n2026-08-10,Mercado,120.00\n2026-08-12,Padaria,30.00\n";
  const newCard = { bankName: "Itaú", lastFourDigits: "9876", closingDay: 10, dueDay: 17, currency: "BRL" };
  const bill = (fileId: string, over: Partial<ImportPlanPayload["bills"][number]> = {}): ImportPlanPayload["bills"][number] => ({
    fileId,
    closingDate: "2026-09-05",
    dueDate: "2026-09-12",
    previewTotalAmount: 150,
    previewTransactionCount: 2,
    ...over,
  });

  it("creates the cards of the plan, paid from the imported account, and the revert archives them", async () => {
    const r = await run(plan({ creditCards: [newCard] }));
    expect(r.creditCardsCreated).toBe(1);
    const card = await prisma.account.findFirstOrThrow({ where: { userId: USER, externalId: "9876" } });
    expect(card).toMatchObject({ type: "credit_card", name: "Itaú ****9876", institution: "Itaú", closingDay: 10, dueDay: 17, payFromAccountId: f.pfChecking, entityId: f.pfId });
    expect(r.createdRecords).toEqual(expect.arrayContaining([{ model: "Account", id: card.id }]));

    const reverted = await executeRevert(USER, { statementImportId: r.importId, createdRecords: r.createdRecords }, prisma);
    expect(reverted.creditCardsDeleted).toBe(1);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: card.id } })).archivedAt).not.toBeNull();
  });

  it("pays a new card from the card account's own paying account when it is a card import, else from the entity's main account", async () => {
    await run(plan({ accountId: f.card, creditCards: [newCard], cardStatement: { month: "2026-09", rows: [] } }));
    expect((await prisma.account.findFirstOrThrow({ where: { userId: USER, externalId: "9876" } })).payFromAccountId).toBe(f.pfChecking);

    const loose = await prisma.account.update({ where: { id: f.card }, data: { payFromAccountId: null } });
    await run(plan({ accountId: loose.id, creditCards: [{ ...newCard, lastFourDigits: "5555" }], cardStatement: { month: "2026-10", rows: [] } }));
    expect((await prisma.account.findFirstOrThrow({ where: { userId: USER, externalId: "5555" } })).payFromAccountId).toBe(f.pfChecking);
  });

  it("books a bill file from the conversation onto an existing card, or onto a card the plan creates", async () => {
    const file = await billFile(CSV);
    const onExisting = await run(plan({ bills: [bill(file.id, { creditCardId: f.card })] }));
    expect(onExisting).toMatchObject({ billsCreated: 1, billTransactionsCreated: 2, creditCardsCreated: 0 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, accountId: f.card, importId: onExisting.importId } })).toBe(2);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: onExisting.importId } })).transactionCount).toBe(2);
    expect(onExisting.createdRecords.map((c) => c.model)).toEqual(expect.arrayContaining(["Import", "CardStatement"]));

    const onNew = await run(plan({ bills: [bill(file.id, { newCreditCard: newCard })] }));
    expect(onNew).toMatchObject({ billsCreated: 1, creditCardsCreated: 1 });
    const created = await prisma.account.findFirstOrThrow({ where: { userId: USER, externalId: "9876" } });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, accountId: created.id } })).toBe(2);
  });

  it("answers a bill that resolves to no card, a file that is not the user's and one whose bytes are gone", async () => {
    const file = await billFile(CSV);
    await expect(run(plan({ bills: [bill(file.id)] }))).rejects.toMatchObject({ status: 422, code: "import.bill_without_card", params: { fileId: file.id } });
    await expect(run(plan({ bills: [bill("nao-existe", { creditCardId: f.card })] }))).rejects.toMatchObject({ status: 404, code: "import.file_not_found", params: { fileId: "nao-existe" } });
    blobs.clear();
    await expect(run(plan({ bills: [bill(file.id, { creditCardId: f.card })] }))).rejects.toMatchObject({ status: 422, code: "import.file_unreadable", params: { fileId: file.id } });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: USER, externalId: "9876" } })).toBe(0);
  });
});

describe("investment operations", () => {
  const op = (over: Partial<ImportPlanPayload["investmentTransactions"][number]> = {}): ImportPlanPayload["investmentTransactions"][number] => ({
    externalId: "op-1",
    accountId: f.broker,
    type: "buy",
    quantity: 10,
    pricePerUnit: 100,
    totalAmount: 1000,
    date: "2026-09-03",
    newHolding: { assetClass: "stocks", ticker: "petr4", name: "Petrobras", currency: "BRL" },
    ...over,
  });

  it("creates the holding the plan describes and records the operation, and the revert removes the operation but keeps the holding", async () => {
    const r = await run(plan({ investmentTransactions: [op()] }));
    expect(r.investmentTransactionsCreated).toBe(1);
    const holding = await prisma.investmentHolding.findFirstOrThrow({ where: { accountId: f.broker } });
    expect(holding).toMatchObject({ ticker: "PETR4", name: "Petrobras", assetClass: "stocks" });
    const operation = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: holding.id } });
    expect(operation).toMatchObject({ externalId: "op-1", type: "buy" });
    expect(r.createdRecords).toEqual(expect.arrayContaining([{ model: "InvestmentHolding", id: holding.id }, { model: "InvestmentOperation", id: operation.id }]));

    const reverted = await executeRevert(USER, { statementImportId: r.importId, createdRecords: r.createdRecords }, prisma);
    expect(reverted.investmentTransactionsDeleted).toBe(1);
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id } })).toBe(0);
    expect(await prisma.investmentHolding.count({ where: { id: holding.id } })).toBe(1);
  });

  it("records an operation on a holding that already exists", async () => {
    await run(plan({ investmentTransactions: [op()] }));
    const holding = await prisma.investmentHolding.findFirstOrThrow({ where: { accountId: f.broker } });
    const second = await run(plan({ investmentTransactions: [op({ externalId: "op-2", holdingId: holding.id, newHolding: undefined, type: "sell", quantity: 4, pricePerUnit: 110, totalAmount: 440, date: "2026-09-10" })] }));
    expect(second.investmentTransactionsCreated).toBe(1);
    expect(await prisma.investmentHolding.count({ where: { accountId: f.broker } })).toBe(1);
    expect(await prisma.investmentOperation.count({ where: { holdingId: holding.id } })).toBe(2);
  });

  it("answers 422 for an operation with neither a holding nor a description of one", async () => {
    await expect(run(plan({ investmentTransactions: [op({ newHolding: undefined })] }))).rejects.toMatchObject({ status: 422, code: "import.holding_unresolved", params: { externalId: "op-1" } });
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
  });
});

describe("the import's view", () => {
  it("is created only when asked, named after the file in the user's language, and cut to 120 characters", async () => {
    expect((await run(plan())).viewId).toBeNull();
    const pt = await run(plan({ fileName: "nubank-fatura-2026-09.ofx" }), { createView: true });
    expect(pt.viewName).toBe("Importação · nubank-fatura-2026-09");
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    const en = await run(plan({ fileName: "statement.ofx" }), { createView: true });
    expect(en.viewName).toBe("Import · statement");
    const long = await run(plan({ fileName: `${"x".repeat(200)}.ofx` }), { createView: true });
    expect(long.viewName).toHaveLength(120);
  });

  it("falls back to the bank name, then to the account name, when the file has no usable name", async () => {
    expect((await run(plan({ fileName: ".ofx", bankName: "Nubank" }), { createView: true })).viewName).toBe("Importação · Nubank");
    expect((await run(plan({}), { createView: true })).viewName).toBe("Importação · Conta principal");
  });
});
