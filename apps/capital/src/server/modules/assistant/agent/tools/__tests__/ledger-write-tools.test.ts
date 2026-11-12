import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { executeTool, type AnyAgentToolDef, type ToolContext } from "../registry";
import { updateTransactions } from "../write/update-transactions";
import { updateBillTool } from "../write/update-bill";
import { updateBillTransactions } from "../write/update-bill-transactions";
import { recordMerchantCategory } from "../write/record-merchant-category";
import { linkBillToTransactionTool } from "../write/link-bill-to-transaction";

const USER = "test-user-assistant-tools-ledgerw";
const OTHER = "test-user-assistant-tools-ledgerw-other";

let f: LedgerFixture;
let other: LedgerFixture;
let ctx: ToolContext;

const run = (tool: AnyAgentToolDef, input: unknown) => tool.handler(ctx, tool.inputSchema.parse(input));
const out = <T>(value: unknown) => value as T;
const batches = (op?: string) => prisma.mutationBatch.count({ where: { userId: USER, ...(op && { op }) } });
const ymd = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "ledger write tools" } });
  const turn = await prisma.agentTurn.create({ data: { conversationId: conversation.id, model: "claude-test" } });
  ctx = { userId: USER, conversationId: conversation.id, turnId: turn.id, db: prisma };
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("update_transactions", () => {
  let expenseId: string;
  let secondId: string;

  beforeAll(async () => {
    expenseId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 42, date: "2026-09-01", description: "Mercadinho", categoryId: f.categories.Groceries }, prisma)).entryIds[0];
    secondId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 17, date: "2026-09-02", description: "Papelaria" }, prisma)).entryIds[0];
  });

  it("recategorizes entries and flips their type, each one independently", async () => {
    const result = out<{ updatedCount: number; failedCount: number; results: Record<string, unknown>[]; createdRecords: unknown }>(
      await run(updateTransactions, {
        updates: [
          { transactionId: expenseId, category: "software" },
          { transactionId: secondId, type: "income", category: "Salary" },
        ],
      })
    );
    expect(result).toMatchObject({ updatedCount: 2, failedCount: 0 });
    expect(result.results).toEqual([
      { transactionId: expenseId, success: true, category: "Software", type: "expense" },
      { transactionId: secondId, success: true, category: "Salary", type: "income" },
    ]);
    expect(result.createdRecords).toEqual([
      { model: "LedgerEntry", id: expenseId },
      { model: "LedgerEntry", id: secondId },
    ]);

    const first = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: expenseId } });
    expect(first).toMatchObject({ categoryId: f.categories.Software, kind: "expense" });
    expect(Number(first.amount)).toBe(-42);
    const second = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: secondId } });
    expect(second).toMatchObject({ categoryId: f.categories.Salary, kind: "income" });
    expect(Number(second.amount)).toBe(17);
  });

  it("reports each failure beside the successes, and only counts the successes as created", async () => {
    const result = out<{ updatedCount: number; failedCount: number; results: { transactionId: string; success: boolean; error?: string }[]; createdRecords: unknown[] }>(
      await run(updateTransactions, {
        updates: [
          { transactionId: expenseId, category: "Groceries" },
          { transactionId: secondId },
          { transactionId: "missing-id", category: "Groceries" },
          { transactionId: other.card, category: "Groceries" },
          { transactionId: expenseId, category: "Nope" },
        ],
      })
    );
    expect(result).toMatchObject({ updatedCount: 1, failedCount: 4 });
    expect(result.results.map((r) => [r.transactionId, r.success])).toEqual([
      [expenseId, true],
      [secondId, false],
      ["missing-id", false],
      [other.card, false],
      [expenseId, false],
    ]);
    expect(result.results[1].error).toBe("neither category nor type provided");
    expect(result.results[2].error).toBe("Transaction not found or access denied");
    expect(result.results[3].error).toBe("Transaction not found or access denied");
    expect(result.results[4].error).toMatch(/Nope/);
    expect(result.createdRecords).toEqual([{ model: "LedgerEntry", id: expenseId }]);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: expenseId } })).categoryId).toBe(f.categories.Groceries);
  });

  it("changes only the type of an entry that has no category, reporting no category", async () => {
    const refund = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 9, date: "2026-09-03", description: "Reembolso" }, prisma)).entryIds[0];
    const result = out<{ updatedCount: number; results: { transactionId: string; success: boolean; category?: string; type?: string }[] }>(await run(updateTransactions, { updates: [{ transactionId: refund, type: "income" }] }));
    expect(result.updatedCount).toBe(1);
    expect(result.results).toEqual([{ transactionId: refund, success: true, category: undefined, type: "income" }]);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: refund } })).toMatchObject({ kind: "income", categoryId: null });
  });

  it("takes between 1 and 100 updates", () => {
    expect(updateTransactions.inputSchema.safeParse({ updates: [] }).success).toBe(false);
    expect(updateTransactions.inputSchema.safeParse({ updates: Array.from({ length: 101 }, (_, i) => ({ transactionId: String(i), category: "x" })) }).success).toBe(false);
  });
});

describe("update_bill", () => {
  let statementId: string;
  let purchaseId: string;

  beforeAll(async () => {
    const imported = await importCardStatement(USER, { accountId: f.card, month: "2026-09", closingDate: "2026-09-05", dueDate: "2026-09-12", fallback: "none", rows: [{ date: "2026-08-10", description: "LIVRARIA", amount: 90 }] }, prisma);
    statementId = imported.statementId;
    purchaseId = imported.createdIds[0];
  });

  const statement = () => prisma.cardStatement.findUniqueOrThrow({ where: { id: statementId } });

  it("needs at least one date, and a well-formed one", async () => {
    await expect(run(updateBillTool, { billId: statementId })).rejects.toThrow("At least one of closingDate or dueDate is required");
    expect(updateBillTool.inputSchema.safeParse({ billId: statementId, closingDate: "07/09/2026" }).success).toBe(false);
    expect(updateBillTool.inputSchema.safeParse({ billId: statementId, dueDate: "2026-9-1" }).success).toBe(false);
    expect(ymd((await statement()).closingDate)).toBe("2026-09-05");
  });

  it("moves the due date alone, leaving the closing date and the purchases where they were", async () => {
    const result = await run(updateBillTool, { billId: statementId, dueDate: "2026-09-20" });
    expect(result).toEqual({ bill: { id: statementId, month: "2026-09", closingDate: "2026-09-05", dueDate: "2026-09-20" }, createdRecords: [] });
    expect(ymd((await statement()).dueDate)).toBe("2026-09-20");
    expect(ymd((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchaseId } })).effectiveDate)).toBe("2026-09-05");
  });

  it("moves the closing date, and the purchases count on the new day", async () => {
    const result = await run(updateBillTool, { billId: statementId, closingDate: "2026-09-08" });
    expect(result).toMatchObject({ bill: { closingDate: "2026-09-08", dueDate: "2026-09-20" } });
    expect(ymd((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchaseId } })).effectiveDate)).toBe("2026-09-08");

    const both = await run(updateBillTool, { billId: statementId, closingDate: "2026-09-06", dueDate: "2026-09-13" });
    expect(both).toMatchObject({ bill: { closingDate: "2026-09-06", dueDate: "2026-09-13" } });
    expect(ymd((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchaseId } })).effectiveDate)).toBe("2026-09-06");
  });

  it("reports a missing date as null", async () => {
    await prisma.cardStatement.update({ where: { id: statementId }, data: { closingDate: null, dueDate: null } });
    const result = await run(updateBillTool, { billId: statementId, dueDate: "2026-09-14" });
    expect(result).toMatchObject({ bill: { closingDate: null, dueDate: "2026-09-14" } });
    await prisma.cardStatement.update({ where: { id: statementId }, data: { dueDate: null } });
    expect(await run(updateBillTool, { billId: statementId, closingDate: "2026-09-06" })).toMatchObject({ bill: { closingDate: "2026-09-06", dueDate: null } });
  });

  it("does not find a bill of someone else", async () => {
    const theirs = await importCardStatement(OTHER, { accountId: other.card, month: "2026-09", fallback: "none", rows: [{ date: "2026-08-10", description: "X", amount: 1 }] }, prisma);
    await expect(run(updateBillTool, { billId: theirs.statementId, dueDate: "2026-09-20" })).rejects.toThrow("Statement not found or access denied");
    await expect(run(updateBillTool, { billId: "missing-bill", dueDate: "2026-09-20" })).rejects.toThrow("Statement not found or access denied");
    expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: theirs.statementId } })).dueDate?.toISOString().slice(0, 10)).not.toBe("2026-09-20");
  });
});

describe("update_bill_transactions", () => {
  let purchaseId: string;
  let secondPurchaseId: string;
  let checkingId: string;

  beforeAll(async () => {
    const imported = await importCardStatement(
      USER,
      { accountId: f.card, month: "2026-10", fallback: "none", rows: [{ date: "2026-09-10", description: "  PADARIA CENTRAL ", amount: 25 }, { date: "2026-09-11", description: "FARMACIA", amount: 60 }] },
      prisma
    );
    [purchaseId, secondPurchaseId] = imported.createdIds;
    checkingId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-09-12", description: "Debito" }, prisma)).entryIds[0];
  });

  it("recategorizes purchases and learns an exact rule from each description", async () => {
    const result = out<{ updatedCount: number; failedCount: number; results: unknown[]; createdRecords: unknown }>(
      await run(updateBillTransactions, { updates: [{ billTransactionId: purchaseId, category: "groceries" }, { billTransactionId: secondPurchaseId, category: "Software" }] })
    );
    expect(result).toMatchObject({ updatedCount: 2, failedCount: 0 });
    expect(result.results).toEqual([
      { billTransactionId: purchaseId, success: true, category: "Groceries" },
      { billTransactionId: secondPurchaseId, success: true, category: "Software" },
    ]);
    expect(result.createdRecords).toEqual([
      { model: "LedgerEntry", id: purchaseId },
      { model: "LedgerEntry", id: secondPurchaseId },
    ]);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchaseId } })).categoryId).toBe(f.categories.Groceries);

    const rules = await prisma.categorizationRule.findMany({ where: { userId: USER, pattern: { in: ["padaria central", "farmacia"] } }, orderBy: { pattern: "asc" } });
    expect(rules.map((r) => [r.pattern, r.matchType, r.source, r.categoryId])).toEqual([
      ["farmacia", "equals", "manual", f.categories.Software],
      ["padaria central", "equals", "manual", f.categories.Groceries],
    ]);
  });

  it("books the recategorization and its rule as one undo batch", async () => {
    const before = await batches("update");
    await run(updateBillTransactions, { updates: [{ billTransactionId: secondPurchaseId, category: "Groceries" }] });
    expect(await batches("update")).toBe(before + 1);
    const batch = await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, op: "update", summary: "FARMACIA" }, orderBy: { createdAt: "desc" }, include: { records: true } });
    expect(batch.records.map((r) => r.model).sort()).toEqual(["CategorizationRule", "LedgerEntry"]);

    // Saying the same category again is accepted and leaves the purchase and the single rule as they were.
    const result = out<{ updatedCount: number }>(await run(updateBillTransactions, { updates: [{ billTransactionId: secondPurchaseId, category: "Groceries" }] }));
    expect(result.updatedCount).toBe(1);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: secondPurchaseId } })).categoryId).toBe(f.categories.Groceries);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "farmacia" } })).toBe(1);
  });

  it("fails per item for what is not a live card purchase of the user or has an unknown category", async () => {
    const result = out<{ updatedCount: number; failedCount: number; results: { billTransactionId: string; success: boolean; error?: string }[] }>(
      await run(updateBillTransactions, {
        updates: [
          { billTransactionId: checkingId, category: "Software" },
          { billTransactionId: "missing", category: "Software" },
          { billTransactionId: purchaseId, category: "Nope" },
          { billTransactionId: purchaseId, category: "Software" },
        ],
      })
    );
    expect(result).toMatchObject({ updatedCount: 1, failedCount: 3 });
    expect(result.results[0]).toEqual({ billTransactionId: checkingId, success: false, error: "Bill transaction not found or access denied" });
    expect(result.results[1].error).toBe("Bill transaction not found or access denied");
    expect(result.results[2].error).toMatch(/Nope/);
    expect(result.results[3].success).toBe(true);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: checkingId } })).categoryId).toBeNull();
  });

  it("takes between 1 and 100 updates with a category each", () => {
    expect(updateBillTransactions.inputSchema.safeParse({ updates: [] }).success).toBe(false);
    expect(updateBillTransactions.inputSchema.safeParse({ updates: [{ billTransactionId: "x", category: "" }] }).success).toBe(false);
  });
});

describe("record_merchant_category", () => {
  it("learns an AI rule from the normalized description and records it as an assistant batch", async () => {
    const before = await batches("create");
    const result = await executeTool([recordMerchantCategory], ctx, "tool-rule", "record_merchant_category", { normalizedDescription: "  RAPPI *Restaurante ", category: "groceries" });
    expect(result.isError).toBe(false);
    expect(result.output).toMatchObject({ normalizedDescription: "rappi *restaurante", category: "Groceries", createdRecords: [{ model: "CategorizationRule", id: expect.any(String) }] });

    const rule = await prisma.categorizationRule.findFirstOrThrow({ where: { userId: USER, pattern: "rappi *restaurante" } });
    expect(rule).toMatchObject({ matchType: "equals", source: "ai", categoryId: f.categories.Groceries });
    expect(await batches("create")).toBe(before + 1);
    expect(await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, op: "create", summary: "rappi *restaurante" } })).toMatchObject({ source: "assistant" });
    expect(await prisma.agentAction.count({ where: { conversationId: ctx.conversationId, toolName: "record_merchant_category", status: "success" } })).toBe(1);
  });

  it("moves an existing rule to another category as an update, and leaves an unchanged one alone", async () => {
    await run(recordMerchantCategory, { normalizedDescription: "Uber Trip", category: "Software" });
    const created = await prisma.categorizationRule.findFirstOrThrow({ where: { userId: USER, pattern: "uber trip" } });
    const updates = await batches("update");

    const moved = await run(recordMerchantCategory, { normalizedDescription: "UBER TRIP", category: "Groceries" });
    expect(moved.createdRecords).toEqual([{ model: "CategorizationRule", id: created.id }]);
    expect(await prisma.categorizationRule.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ categoryId: f.categories.Groceries, source: "ai" });
    expect(await batches("update")).toBe(updates + 1);
    const batch = await prisma.mutationBatch.findFirstOrThrow({ where: { userId: USER, op: "update", summary: "uber trip" }, include: { records: true } });
    expect(batch.records).toHaveLength(1);
    expect(batch.records[0]).toMatchObject({ model: "CategorizationRule", recordId: created.id, before: expect.objectContaining({ categoryId: f.categories.Software }), after: expect.objectContaining({ categoryId: f.categories.Groceries }) });

    const again = await run(recordMerchantCategory, { normalizedDescription: "uber trip", category: "Groceries" });
    expect(again.createdRecords).toEqual([{ model: "CategorizationRule", id: created.id }]);
    expect(await batches("update")).toBe(updates + 1);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, pattern: "uber trip" } })).toBe(1);
  });

  it("refuses a description that is blank once normalized, and an unknown category, creating nothing", async () => {
    const rules = await prisma.categorizationRule.count({ where: { userId: USER } });
    await expect(run(recordMerchantCategory, { normalizedDescription: "   ", category: "Groceries" })).rejects.toThrow("The description is empty after normalization");
    await expect(run(recordMerchantCategory, { normalizedDescription: "loja", category: "Nope" })).rejects.toThrow(/Nope/);
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(rules);
  });
});

describe("link_bill_to_transaction", () => {
  let statementId: string;

  const freshBill = async (month: string, rows: { date: string; description: string; amount: number }[], total?: number) =>
    (await importCardStatement(USER, { accountId: f.card, month, ...(total !== undefined && { total }), fallback: "none", rows }, prisma)).statementId;
  const expense = async (amount: number, date: string, accountId = f.pfChecking) => (await createEntry(USER, { kind: "expense", accountId, amount, date, description: "Pgto fatura banco" }, prisma)).entryIds[0];

  beforeAll(async () => {
    statementId = await freshBill("2027-01", [{ date: "2026-12-10", description: "LOJA", amount: 150 }]);
  });

  describe("link_existing", () => {
    it("needs the bank transaction", async () => {
      await expect(run(linkBillToTransactionTool, { action: "link_existing", billId: statementId })).rejects.toThrow('transactionId is required for action "link_existing"');
    });

    it("turns the bank expense into the bill's card payment, and refuses a second, different payment", async () => {
      const payment = await expense(150, "2027-01-12");
      const result = out<{ bill: { id: string; month: string; paymentGroupId: string }; createdRecords: unknown }>(await run(linkBillToTransactionTool, { action: "link_existing", billId: statementId, transactionId: payment }));
      expect(result.bill).toMatchObject({ id: statementId, month: "2027-01" });
      expect(result.createdRecords).toEqual([{ model: "TransferGroup", id: result.bill.paymentGroupId }]);
      const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: result.bill.paymentGroupId }, include: { legs: true } });
      expect(group.direction).toBe("card_payment");
      expect(group.legs.map((l) => l.accountId).sort()).toEqual([f.card, f.pfChecking].sort());
      expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: statementId } })).paymentGroupId).toBe(group.id);

      const another = await expense(150, "2027-01-13");
      await expect(run(linkBillToTransactionTool, { action: "link_existing", billId: statementId, transactionId: another })).rejects.toThrow("Statement already has a different bill payment transaction linked");
      expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: another } })).kind).toBe("expense");
    });

    it("does not find transactions or bills that are missing or someone else's", async () => {
      const unpaid = await freshBill("2027-02", [{ date: "2027-01-10", description: "LOJA", amount: 10 }]);
      const theirs = (await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 10, date: "2027-02-12", description: "Alheia" }, prisma)).entryIds[0];
      await expect(run(linkBillToTransactionTool, { action: "link_existing", billId: unpaid, transactionId: "missing" })).rejects.toThrow("Transaction not found or access denied");
      await expect(run(linkBillToTransactionTool, { action: "link_existing", billId: unpaid, transactionId: theirs })).rejects.toThrow("Transaction not found or access denied");
      await expect(run(linkBillToTransactionTool, { action: "link_existing", billId: "missing-bill", transactionId: await expense(10, "2027-02-12") })).rejects.toThrow("Statement not found or access denied");
    });
  });

  describe("create_expense", () => {
    const create = (billId: string, extra: Record<string, unknown> = {}) => ({ action: "create_expense", billId, entityType: "personal", personalAccountId: f.pfId, currency: "BRL", date: "2027-03-12", ...extra });

    it.each([
      ["entityType", 'entityType is required for action "create_expense"'],
      ["currency", "currency must be a 3-letter ISO code"],
      ["date", 'date is required for action "create_expense"'],
    ])("asks for %s", async (field, message) => {
      const input: Record<string, unknown> = create(statementId);
      delete input[field];
      await expect(run(linkBillToTransactionTool, input)).rejects.toThrow(message);
      await expect(run(linkBillToTransactionTool, create(statementId, { currency: "EURO" }))).rejects.toThrow("currency must be a 3-letter ISO code");
    });

    it("books the payment for the sum of the purchases from the entity's main account", async () => {
      const bill = await freshBill("2027-03", [{ date: "2027-02-10", description: "A", amount: 100.1 }, { date: "2027-02-11", description: "B", amount: 50.25 }]);
      const result = out<{ transaction: { id: string; amount: number; transferGroupId: string }; createdRecords: unknown }>(await run(linkBillToTransactionTool, create(bill)));
      expect(result.transaction.amount).toBe(150.35);
      expect(result.createdRecords).toEqual([{ model: "TransferGroup", id: result.transaction.transferGroupId }]);

      const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.transaction.id } });
      expect(leg).toMatchObject({ accountId: f.pfChecking, entityId: f.pfId, kind: "transfer", transferGroupId: result.transaction.transferGroupId, description: "Pagamento fatura 2027-03" });
      expect(Number(leg.amount)).toBe(-150.35);
      expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: bill } })).paymentGroupId).toBe(result.transaction.transferGroupId);
    });

    it("pays the statement's stated total rather than the sum of the rows it holds", async () => {
      const bill = await freshBill("2027-04", [{ date: "2027-03-10", description: "A", amount: 40 }], 123.45);
      const result = out<{ transaction: { amount: number; id: string } }>(await run(linkBillToTransactionTool, create(bill, { date: "2027-04-12" })));
      expect(result.transaction.amount).toBe(123.45);
      expect(Number((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.transaction.id } })).amount)).toBe(-123.45);
    });

    it("pays from the business account when the business is the payer", async () => {
      const bill = await freshBill("2027-05", [{ date: "2027-04-10", description: "A", amount: 80 }]);
      const result = out<{ transaction: { id: string } }>(await run(linkBillToTransactionTool, create(bill, { entityType: "business", businessId: f.pjId, personalAccountId: undefined, date: "2027-05-12" })));
      const leg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: result.transaction.id } });
      expect(leg).toMatchObject({ accountId: f.pjChecking, entityId: f.pjId });
    });

    it("pays nothing for a bill without a total, and writes nothing when it fails", async () => {
      const empty = await freshBill("2027-06", []);
      const entries = await prisma.ledgerEntry.count({ where: { userId: USER } });
      const groups = await prisma.transferGroup.count({ where: { userId: USER } });
      await expect(run(linkBillToTransactionTool, create(empty))).rejects.toThrow("The bill has no total to pay");
      await expect(run(linkBillToTransactionTool, create("missing-bill"))).rejects.toThrow("Bill not found or access denied");
      await expect(run(linkBillToTransactionTool, create(statementId, { personalAccountId: other.pfId }))).rejects.toThrow(/not found/);
      expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(entries);
      expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(groups);
    });

    it("never pays a bill of someone else", async () => {
      const theirs = (await importCardStatement(OTHER, { accountId: other.card, month: "2027-03", fallback: "none", rows: [{ date: "2027-02-10", description: "A", amount: 10 }] }, prisma)).statementId;
      await expect(run(linkBillToTransactionTool, create(theirs))).rejects.toThrow("Bill not found or access denied");
      expect((await prisma.cardStatement.findUniqueOrThrow({ where: { id: theirs } })).paymentGroupId).toBeNull();
    });
  });
});
