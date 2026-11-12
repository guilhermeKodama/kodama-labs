import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DbClient } from "@capital/server/lib/prisma";
import { currentMutationSource } from "@capital/server/modules/ledger/services/mutations";
import { createCapitalMcpServer } from "../lib/mcp-server";

/**
 * Wiring of the MCP server: every tool validates its input with its zod
 * schema, forwards (userId, params, db) to the service function behind it in
 * the order that function expects, wraps the result as JSON text, and runs
 * under the "mcp" mutation source. The services themselves are mocked here;
 * mcp-server-db.test.ts drives the same server against the real database.
 */
const fns = vi.hoisted(() => {
  const f = () => vi.fn();
  return {
    bulkCreateTransactions: f(),
    listTransactions: f(),
    updateTransactionTool: f(),
    deleteTransactionTool: f(),
    bulkUpdateTransactions: f(),
    listCategoriesForMcp: f(),
    listAccounts: f(),
    getValidTypes: f(),
    createCategoryTool: f(),
    updateCategoryTool: f(),
    deleteCategoryTool: f(),
    mergeCategoryTool: f(),
    findOrphanTransactions: f(),
    getUserSettings: f(),
    updateUserSettings: f(),
    updateAccountSettings: f(),
    listInvestmentPositions: f(),
    adjustPosition: f(),
    addInvestmentAsset: f(),
    updateHoldingPrice: f(),
    recordInvestmentContribution: f(),
    recordInvestmentRedemption: f(),
    convertIncomeToDividend: f(),
    recordDividend: f(),
    updateDividend: f(),
    listAccountBalances: f(),
    createTransfer: f(),
    listLedgerAccounts: f(),
    listTransfers: f(),
    getFirePlan: f(),
    updateFirePhaseContribution: f(),
    attachReceipt: f(),
    listTransactionAttachments: f(),
    deleteAttachment: f(),
    listBudgets: f(),
    createBudget: f(),
    updateBudget: f(),
    deleteBudget: f(),
    getBudgetStatus: f(),
    getBudgetComposition: f(),
    importCreditCardStatement: f(),
    markTransactionAsCardSettlement: f(),
    unmarkTransactionAsCardSettlement: f(),
    getCreditCardStatement: f(),
    listCreditCardsForMcp: f(),
    createCreditCardTool: f(),
    updateCreditCardTool: f(),
    createLedgerAccount: f(),
    archiveLedgerAccount: f(),
  };
});

vi.mock("../tools/bulk-create-transactions", () => ({ bulkCreateTransactions: fns.bulkCreateTransactions }));
vi.mock("../tools/list-transactions", () => ({ listTransactions: fns.listTransactions }));
vi.mock("../tools/manage-transactions", () => ({
  updateTransactionTool: fns.updateTransactionTool,
  deleteTransactionTool: fns.deleteTransactionTool,
}));
vi.mock("../tools/bulk-update-transactions", () => ({ bulkUpdateTransactions: fns.bulkUpdateTransactions }));
vi.mock("../tools/metadata", () => ({
  listCategoriesForMcp: fns.listCategoriesForMcp,
  listAccounts: fns.listAccounts,
  getValidTypes: fns.getValidTypes,
}));
vi.mock("../tools/categories", () => ({
  createCategoryTool: fns.createCategoryTool,
  updateCategoryTool: fns.updateCategoryTool,
  deleteCategoryTool: fns.deleteCategoryTool,
  mergeCategoryTool: fns.mergeCategoryTool,
}));
vi.mock("../lib/category-validation", () => ({ findOrphanTransactions: fns.findOrphanTransactions }));
vi.mock("../tools/settings", () => ({
  getUserSettings: fns.getUserSettings,
  updateUserSettings: fns.updateUserSettings,
  updateAccountSettings: fns.updateAccountSettings,
}));
vi.mock("../tools/investments", () => ({
  listInvestmentPositions: fns.listInvestmentPositions,
  adjustPosition: fns.adjustPosition,
  addInvestmentAsset: fns.addInvestmentAsset,
  updateHoldingPrice: fns.updateHoldingPrice,
}));
vi.mock("../../investments/services/holding-cashflow", () => ({
  recordInvestmentContribution: fns.recordInvestmentContribution,
  recordInvestmentRedemption: fns.recordInvestmentRedemption,
}));
vi.mock("../../investments/services/dividends", () => ({
  convertIncomeToDividend: fns.convertIncomeToDividend,
  recordDividend: fns.recordDividend,
  updateDividend: fns.updateDividend,
}));
vi.mock("../tools/balances", () => ({ listAccountBalances: fns.listAccountBalances }));
vi.mock("../tools/ledger-accounts", () => ({ createLedgerAccount: fns.createLedgerAccount, archiveLedgerAccount: fns.archiveLedgerAccount }));
vi.mock("../tools/transfers", () => ({
  createTransfer: fns.createTransfer,
  listLedgerAccounts: fns.listLedgerAccounts,
  listTransfers: fns.listTransfers,
}));
vi.mock("../tools/fire", () => ({
  getFirePlan: fns.getFirePlan,
  updateFirePhaseContribution: fns.updateFirePhaseContribution,
}));
vi.mock("../tools/attachments", () => ({
  attachReceipt: fns.attachReceipt,
  listTransactionAttachments: fns.listTransactionAttachments,
  deleteAttachment: fns.deleteAttachment,
}));
vi.mock("../tools/budgets", () => ({
  listBudgets: fns.listBudgets,
  createBudget: fns.createBudget,
  updateBudget: fns.updateBudget,
  deleteBudget: fns.deleteBudget,
  getBudgetStatus: fns.getBudgetStatus,
  getBudgetComposition: fns.getBudgetComposition,
}));
vi.mock("../tools/credit-card-statements", () => ({
  importCreditCardStatement: fns.importCreditCardStatement,
  markTransactionAsCardSettlement: fns.markTransactionAsCardSettlement,
  unmarkTransactionAsCardSettlement: fns.unmarkTransactionAsCardSettlement,
  getCreditCardStatement: fns.getCreditCardStatement,
}));
vi.mock("../tools/credit-cards", () => ({
  listCreditCardsForMcp: fns.listCreditCardsForMcp,
  createCreditCardTool: fns.createCreditCardTool,
  updateCreditCardTool: fns.updateCreditCardTool,
}));

const USER = "test-user-mcp-wiring";
// The server only hands the client to the services, so an identity token is enough.
const db = { marker: "db" } as unknown as DbClient;

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

interface ToolCase {
  tool: string;
  fn: Mock;
  args: Record<string, unknown>;
  /** The arguments the service function must receive. */
  expected: unknown[];
  /** Reads stay available to a read-only token. */
  readOnly: boolean;
  /** What the service resolves to; the server wraps it as JSON text. */
  result?: unknown;
  /** What the client reads back when the server reshapes the result. */
  output?: unknown;
  /** The service returns synchronously (no await in the handler). */
  sync?: boolean;
}

const updatedRow = {
  id: ID,
  type: "expense",
  amount: -10,
  currency: "BRL",
  exchangeRate: 1,
  description: "Padaria",
  category: "Groceries",
  reimbursesCategory: null,
  date: "2026-09-15",
  transferGroupId: null,
  counterpartAmount: null,
  counterpartCurrency: null,
  operationId: null,
};

const purchase = {
  entityType: "personal",
  type: "expense",
  amount: 10,
  currency: "BRL",
  description: "Padaria",
  category: "Groceries",
  date: "2026-09-15",
  personalAccountId: ID,
};

const cases: ToolCase[] = [
  {
    tool: "bulk_create_transactions",
    fn: fns.bulkCreateTransactions,
    args: { transactions: [purchase] },
    expected: [USER, [purchase], false, db],
    readOnly: false,
  },
  {
    tool: "list_transactions",
    fn: fns.listTransactions,
    args: { dateFrom: "2026-09-01", dateTo: "2026-09-30T23:59:59Z", type: "income", category: "Salary" },
    expected: [USER, { dateFrom: "2026-09-01", dateTo: "2026-09-30T23:59:59Z", type: "income", category: "Salary" }, db],
    readOnly: true,
  },
  {
    tool: "update_transaction",
    fn: fns.updateTransactionTool,
    args: { id: ID, amount: 5, reimbursesCategory: null },
    expected: [USER, { id: ID, amount: 5, reimbursesCategory: null }, db],
    readOnly: false,
    result: updatedRow,
    output: updatedRow,
  },
  {
    tool: "delete_transaction",
    fn: fns.deleteTransactionTool,
    args: { id: ID },
    expected: [USER, ID, db],
    readOnly: false,
    output: { success: true, id: ID },
  },
  {
    tool: "list_categories",
    fn: fns.listCategoriesForMcp,
    args: { type: "expense", includeArchived: true },
    expected: [USER, "expense", db, true],
    readOnly: true,
  },
  // includeArchived is always passed on: the service decides nothing from its absence.
  { tool: "list_accounts", fn: fns.listAccounts, args: {}, expected: [USER, db, { includeArchived: false }], readOnly: true },
  { tool: "create_account", fn: fns.createLedgerAccount, args: { name: "Inter PJ", type: "checking", entityType: "business", businessId: ID }, expected: [USER, { name: "Inter PJ", type: "checking", entityType: "business", businessId: ID }, db], readOnly: false },
  { tool: "archive_account", fn: fns.archiveLedgerAccount, args: { accountId: ID, force: true }, expected: [USER, { accountId: ID, force: true }, db], readOnly: false },
  { tool: "get_valid_types", fn: fns.getValidTypes, args: {}, expected: [], readOnly: true, sync: true },
  {
    tool: "list_investment_positions",
    fn: fns.listInvestmentPositions,
    args: { ticker: "PMLL11", includeClosed: true },
    expected: [USER, db, { ticker: "PMLL11", includeClosed: true }],
    readOnly: true,
  },
  {
    tool: "adjust_position",
    fn: fns.adjustPosition,
    args: { holdingId: ID, currentQuantity: 174, averageCost: 9.5, notes: "broker" },
    expected: [USER, { holdingId: ID, currentQuantity: 174, averageCost: 9.5, notes: "broker" }, db],
    readOnly: false,
  },
  {
    tool: "add_investment_asset",
    fn: fns.addInvestmentAsset,
    args: { accountId: ID, ticker: "PVBI11", name: "VBI Prime", assetClass: "fii" },
    expected: [USER, { accountId: ID, ticker: "PVBI11", name: "VBI Prime", assetClass: "fii" }, db],
    readOnly: false,
  },
  { tool: "get_fire_plan", fn: fns.getFirePlan, args: {}, expected: [USER, db], readOnly: true },
  {
    tool: "update_fire_phase_contribution",
    fn: fns.updateFirePhaseContribution,
    args: { monthlyContribution: 1500, phaseIndex: 1 },
    expected: [USER, { monthlyContribution: 1500, phaseIndex: 1 }, db],
    readOnly: false,
  },
  {
    tool: "attach_receipt",
    fn: fns.attachReceipt,
    args: { transactionId: ID, filename: "nota.pdf", mimeType: "application/pdf", contentBase64: "AAAA" },
    expected: [USER, { transactionId: ID, filename: "nota.pdf", mimeType: "application/pdf", contentBase64: "AAAA" }, db],
    readOnly: false,
  },
  {
    tool: "list_attachments",
    fn: fns.listTransactionAttachments,
    args: { transactionId: ID },
    expected: [USER, { transactionId: ID }, db],
    readOnly: true,
  },
  {
    tool: "delete_attachment",
    fn: fns.deleteAttachment,
    args: { attachmentId: ID },
    expected: [USER, { attachmentId: ID }, db],
    readOnly: false,
  },
  {
    tool: "create_category",
    fn: fns.createCategoryTool,
    args: { name: "Pets", type: "expense", color: "#fff" },
    expected: [USER, { name: "Pets", type: "expense", color: "#fff" }, db],
    readOnly: false,
  },
  {
    tool: "update_category",
    fn: fns.updateCategoryTool,
    args: { id: ID, isArchived: true },
    expected: [USER, { id: ID, isArchived: true }, db],
    readOnly: false,
  },
  {
    tool: "delete_category",
    fn: fns.deleteCategoryTool,
    args: { id: ID, reassignTo: ID2 },
    expected: [USER, { id: ID, reassignTo: ID2 }, db],
    readOnly: false,
  },
  {
    tool: "merge_categories",
    fn: fns.mergeCategoryTool,
    args: { fromId: ID, toId: ID2 },
    expected: [USER, { fromId: ID, toId: ID2 }, db],
    readOnly: false,
  },
  { tool: "find_orphan_transactions", fn: fns.findOrphanTransactions, args: {}, expected: [USER, db], readOnly: true },
  {
    tool: "bulk_update_transactions",
    fn: fns.bulkUpdateTransactions,
    args: { updates: [{ id: ID, category: "Groceries" }], dryRun: true },
    expected: [USER, [{ id: ID, category: "Groceries" }], true, db],
    readOnly: false,
  },
  { tool: "get_settings", fn: fns.getUserSettings, args: {}, expected: [USER, db], readOnly: true },
  {
    tool: "update_settings",
    fn: fns.updateUserSettings,
    args: { theme: "dark", force: true },
    expected: [USER, { theme: "dark", force: true }, db],
    readOnly: false,
  },
  {
    tool: "update_account",
    fn: fns.updateAccountSettings,
    args: { accountId: ID, entityType: "business", name: "Kodama", taxRate: 0.1, force: true },
    // accountId and entityType are positional; the rest is the update.
    expected: [USER, ID, "business", { name: "Kodama", taxRate: 0.1, force: true }, db],
    readOnly: false,
  },
  {
    tool: "list_budgets",
    fn: fns.listBudgets,
    args: { accountId: ID, effectiveDate: "2026-09" },
    expected: [USER, { accountId: ID, effectiveDate: "2026-09" }, db],
    readOnly: true,
  },
  {
    tool: "create_budget",
    fn: fns.createBudget,
    args: { accountId: ID, category: "Shopping", amount: 100, currency: "BRL", effectiveFrom: "2026-10-01", kind: "fixo" },
    expected: [USER, { accountId: ID, category: "Shopping", amount: 100, currency: "BRL", effectiveFrom: "2026-10-01", kind: "fixo" }, db],
    readOnly: false,
  },
  {
    tool: "update_budget",
    fn: fns.updateBudget,
    args: { budgetId: ID, amount: 50, applyFrom: "2026-11" },
    expected: [USER, { budgetId: ID, amount: 50, applyFrom: "2026-11" }, db],
    readOnly: false,
  },
  {
    tool: "delete_budget",
    fn: fns.deleteBudget,
    args: { budgetId: ID },
    expected: [USER, { budgetId: ID }, db],
    readOnly: false,
  },
  {
    tool: "get_budget_status",
    fn: fns.getBudgetStatus,
    args: { month: "2026-09", accountId: ID },
    expected: [USER, { month: "2026-09", accountId: ID }, db],
    readOnly: true,
  },
  {
    tool: "get_budget_composition",
    fn: fns.getBudgetComposition,
    args: { from: "2026-01", to: "2026-03", limit: 5 },
    expected: [USER, { from: "2026-01", to: "2026-03", limit: 5 }, db],
    readOnly: true,
  },
  {
    tool: "import_credit_card_statement",
    fn: fns.importCreditCardStatement,
    args: {
      creditCardId: ID,
      statement: { month: "2026-08", closingDate: "2026-08-05" },
      rows: [{ date: "2026-08-01", description: "Mercado", amount: 42.5, installment: { number: 1, total: 3 } }],
    },
    expected: [
      USER,
      {
        creditCardId: ID,
        statement: { month: "2026-08", closingDate: "2026-08-05" },
        rows: [{ date: "2026-08-01", description: "Mercado", amount: 42.5, installment: { number: 1, total: 3 } }],
      },
      db,
    ],
    readOnly: false,
  },
  {
    tool: "mark_transaction_as_card_settlement",
    fn: fns.markTransactionAsCardSettlement,
    args: { transactionId: ID, statementId: ID2 },
    expected: [USER, { transactionId: ID, statementId: ID2 }, db],
    readOnly: false,
  },
  {
    tool: "unmark_transaction_as_card_settlement",
    fn: fns.unmarkTransactionAsCardSettlement,
    args: { transactionId: ID },
    expected: [USER, { transactionId: ID }, db],
    readOnly: false,
  },
  {
    tool: "get_credit_card_statement",
    fn: fns.getCreditCardStatement,
    args: { creditCardId: ID, month: "2026-08" },
    expected: [USER, { creditCardId: ID, month: "2026-08" }, db],
    readOnly: true,
  },
  {
    tool: "list_credit_cards",
    fn: fns.listCreditCardsForMcp,
    args: { lastFourDigits: "3308", entityType: "personal" },
    expected: [USER, { lastFourDigits: "3308", entityType: "personal" }, db],
    readOnly: true,
  },
  {
    tool: "create_credit_card",
    fn: fns.createCreditCardTool,
    args: {
      entityType: "personal",
      bankName: "Nubank",
      lastFourDigits: "3308",
      creditLimit: 8000,
      closingDay: 3,
      dueDay: 10,
      currency: "BRL",
      personalAccountId: ID,
    },
    expected: [
      USER,
      {
        entityType: "personal",
        bankName: "Nubank",
        lastFourDigits: "3308",
        creditLimit: 8000,
        closingDay: 3,
        dueDay: 10,
        currency: "BRL",
        personalAccountId: ID,
      },
      db,
    ],
    readOnly: false,
  },
  {
    tool: "update_credit_card",
    fn: fns.updateCreditCardTool,
    args: { id: ID, closingDay: 7, isActive: false },
    expected: [USER, { id: ID, closingDay: 7, isActive: false }, db],
    readOnly: false,
  },
  {
    tool: "list_account_balances",
    fn: fns.listAccountBalances,
    args: { asOf: "2026-09-01" },
    expected: [USER, { asOf: "2026-09-01" }, db],
    readOnly: true,
  },
  {
    tool: "list_ledger_accounts",
    fn: fns.listLedgerAccounts,
    args: { type: "brokerage" },
    expected: [USER, { type: "brokerage" }, db],
    readOnly: true,
  },
  {
    tool: "create_transfer",
    fn: fns.createTransfer,
    args: { fromAccountId: ID, toAccountId: ID2, amount: 100, date: "2026-09-01", exchangeRate: 5.2 },
    expected: [USER, { fromAccountId: ID, toAccountId: ID2, amount: 100, date: "2026-09-01", exchangeRate: 5.2 }, db],
    readOnly: false,
  },
  {
    tool: "list_transfers",
    fn: fns.listTransfers,
    args: { direction: "between_accounts", limit: 10, offset: 0 },
    expected: [USER, { direction: "between_accounts", limit: 10, offset: 0 }, db],
    readOnly: true,
  },
  {
    tool: "record_investment_contribution",
    fn: fns.recordInvestmentContribution,
    args: { holdingId: ID, cashAccountId: ID2, amount: 1000, date: "2026-09-01", mode: "by_value" },
    expected: [USER, { holdingId: ID, cashAccountId: ID2, amount: 1000, date: "2026-09-01", mode: "by_value" }, db],
    readOnly: false,
  },
  {
    tool: "record_investment_redemption",
    fn: fns.recordInvestmentRedemption,
    args: { holdingId: ID, cashAccountId: ID2, amount: 500, date: "2026-09-02", mode: "by_units", quantity: 5, price: 100 },
    expected: [
      USER,
      { holdingId: ID, cashAccountId: ID2, amount: 500, date: "2026-09-02", mode: "by_units", quantity: 5, price: 100 },
      db,
    ],
    readOnly: false,
  },
  {
    tool: "record_dividend",
    fn: fns.recordDividend,
    args: { holdingId: ID, incomeType: "jcp", amount: 20, date: "2026-09-03", currency: "BRL", withholdingTax: 3 },
    expected: [USER, { holdingId: ID, incomeType: "jcp", amount: 20, date: "2026-09-03", currency: "BRL", withholdingTax: 3 }, db],
    readOnly: false,
  },
  {
    tool: "convert_income_to_dividend",
    fn: fns.convertIncomeToDividend,
    args: { transactionId: ID, holdingId: ID2, incomeType: "fii_income" },
    expected: [USER, { transactionId: ID, holdingId: ID2, incomeType: "fii_income" }, db],
    readOnly: false,
  },
  {
    tool: "update_dividend",
    fn: fns.updateDividend,
    args: { operationId: ID, incomeType: "dividend", origin: "BR", cashAccountId: ID3 },
    expected: [USER, { operationId: ID, incomeType: "dividend", origin: "BR", cashAccountId: ID3 }, db],
    readOnly: false,
  },
  {
    tool: "update_holding_price",
    fn: fns.updateHoldingPrice,
    args: { holdingId: ID, totalValue: 49943.76, date: "2026-09-01" },
    expected: [USER, { holdingId: ID, totalValue: 49943.76, date: "2026-09-01" }, db],
    readOnly: false,
  },
];

const sourcesSeen: Array<string | undefined> = [];

beforeEach(() => {
  sourcesSeen.length = 0;
  for (const fn of Object.values(fns)) {
    fn.mockReset();
    fn.mockImplementation(async () => ({ ok: true }));
  }
  fns.getValidTypes.mockReset();
  fns.getValidTypes.mockReturnValue({ types: [] });
});

async function connect(opts: { readOnly?: boolean } = {}) {
  const server = createCapitalMcpServer(USER, db, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wiring-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

describe("MCP server tool wiring", () => {
  it("registers exactly the 49 documented tools", async () => {
    const { client, close } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    await close();
    expect(cases).toHaveLength(49);
    expect(names).toEqual(cases.map((c) => c.tool).sort());
  });

  it.each(cases)("$tool validates its input, calls the service and returns its result as JSON text", async ({ tool, fn, args, expected, result: serviceResult, output, sync }) => {
    const payload = serviceResult ?? { marker: tool, nested: { rows: [1, 2] } };
    const impl = () => {
      sourcesSeen.push(currentMutationSource());
      return payload;
    };
    fn.mockImplementation(sync ? impl : async () => impl());
    const { client, close } = await connect();
    const result = await call(client, tool, args);
    await close();

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual(output ?? payload);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(...expected);
    // Undo batches written by a tool are attributed to the MCP client.
    expect(sourcesSeen).toEqual(["mcp"]);
  });

  it("read-only tokens only see the read tools, and cannot call a write tool", async () => {
    const { client, close } = await connect({ readOnly: true });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    const writeTool = cases.find((c) => !c.readOnly)!;
    const blocked = await call(client, writeTool.tool, writeTool.args).catch((e: Error) => e);
    const readTool = cases.find((c) => c.tool === "list_accounts")!;
    const allowed = await call(client, readTool.tool, readTool.args);
    await close();

    expect(names).toEqual(cases.filter((c) => c.readOnly).map((c) => c.tool).sort());
    expect(names).toHaveLength(17);
    // The SDK answers an unregistered tool with an error, never by running it.
    const blockedMessage = blocked instanceof Error ? blocked.message : blocked.content[0].text;
    expect(blockedMessage).toMatch(/not found/i);
    expect(writeTool.fn).not.toHaveBeenCalled();
    expect(allowed.isError).toBeFalsy();
    expect(readTool.fn).toHaveBeenCalledWith(USER, db, { includeArchived: false });
  });

  it("a token with full access sees the write tools too", async () => {
    const { client, close } = await connect({ readOnly: false });
    const names = (await client.listTools()).tools.map((t) => t.name);
    await close();
    expect(names).toContain("delete_transaction");
    expect(names).toContain("update_dividend");
  });

  it("applies the schema defaults before calling the service", async () => {
    const { client, close } = await connect();
    await call(client, "bulk_create_transactions", { transactions: [] });
    await call(client, "bulk_update_transactions", { updates: [] });
    await call(client, "list_categories", {});
    await close();

    expect(fns.bulkCreateTransactions).toHaveBeenCalledWith(USER, [], false, db);
    expect(fns.bulkUpdateTransactions).toHaveBeenCalledWith(USER, [], false, db);
    // includeArchived is optional on the wire and false for the service.
    expect(fns.listCategoriesForMcp).toHaveBeenCalledWith(USER, undefined, db, false);
  });

  it("delete_transaction answers { success, id } and update_transaction only the documented fields", async () => {
    fns.updateTransactionTool.mockResolvedValue({
      id: ID,
      type: "expense",
      amount: -10,
      currency: "BRL",
      exchangeRate: 1,
      description: "Padaria",
      category: "Groceries",
      reimbursesCategory: null,
      date: "2026-09-15",
      transferGroupId: null,
      counterpartAmount: null,
      counterpartCurrency: null,
      operationId: null,
      accountId: ID,
      accountName: "Inter PJ",
      amountBase: 99,
    });
    const { client, close } = await connect();
    const deleted = await call(client, "delete_transaction", { id: ID });
    const updated = await call(client, "update_transaction", { id: ID, amount: 10 });
    await close();

    expect(JSON.parse(deleted.content[0].text)).toEqual({ success: true, id: ID });
    expect(JSON.parse(updated.content[0].text)).toEqual({
      id: ID,
      type: "expense",
      amount: -10,
      currency: "BRL",
      exchangeRate: 1,
      description: "Padaria",
      category: "Groceries",
      reimbursesCategory: null,
      date: "2026-09-15",
      transferGroupId: null,
      counterpartAmount: null,
      counterpartCurrency: null,
      accountId: ID,
      accountName: "Inter PJ",
      operationId: null,
    });
  });

  it("list_accounts passes includeArchived on to the service", async () => {
    fns.listAccounts.mockResolvedValue({ businesses: [], personalAccount: null });
    const { client, close } = await connect();
    await call(client, "list_accounts", { includeArchived: true });
    await close();
    expect(fns.listAccounts).toHaveBeenCalledWith(USER, db, { includeArchived: true });
  });

  it("get_valid_types returns the service payload without arguments", async () => {
    fns.getValidTypes.mockReturnValue({ types: ["income", "expense", "investment"] });
    const { client, close } = await connect();
    const result = await call(client, "get_valid_types", {});
    await close();
    expect(JSON.parse(result.content[0].text)).toEqual({ types: ["income", "expense", "investment"] });
  });

  it("record_dividend upper-cases the currency before booking", async () => {
    const { client, close } = await connect();
    await call(client, "record_dividend", { holdingId: ID, incomeType: "dividend", amount: 5, date: "2026-09-03", currency: "usd" });
    await close();
    expect(fns.recordDividend).toHaveBeenCalledWith(
      USER,
      { holdingId: ID, incomeType: "dividend", amount: 5, date: "2026-09-03", currency: "USD" },
      db,
    );
  });

  it("returns a service failure as an error result carrying its message", async () => {
    fns.deleteTransactionTool.mockRejectedValue(new Error("Transaction not found"));
    const { client, close } = await connect();
    const result = await call(client, "delete_transaction", { id: ID });
    await close();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Transaction not found");
  });

  describe("input validation", () => {
    it("accepts a plain date and an ISO datetime, rejects any other date shape", async () => {
      const { client, close } = await connect();
      const plain = await call(client, "list_transactions", { dateFrom: "2026-09-01" });
      const iso = await call(client, "list_transactions", { dateFrom: "2026-09-01T10:30:00.123Z" });
      const bad = await call(client, "list_transactions", { dateFrom: "01/09/2026" });
      const badTime = await call(client, "list_transactions", { dateTo: "2026-09-01T10:30" });
      await close();

      expect(plain.isError).toBeFalsy();
      expect(iso.isError).toBeFalsy();
      expect(fns.listTransactions).toHaveBeenCalledTimes(2);
      expect(bad.isError).toBe(true);
      expect(bad.content[0].text).toContain("Date must be in YYYY-MM-DD or ISO datetime format");
      expect(badTime.isError).toBe(true);
    });

    it("rejects malformed ids, enums and ranges without reaching the service", async () => {
      const { client, close } = await connect();
      const results = await Promise.all([
        call(client, "delete_transaction", { id: "not-a-uuid" }),
        call(client, "create_category", { name: "X", type: "transfer" }),
        call(client, "get_budget_composition", { from: "2026-01", to: "2026-03", limit: 21 }),
        call(client, "create_budget", { accountId: ID, category: "X", amount: 1, currency: "BRL", effectiveFrom: "2026-10" }),
        call(client, "create_credit_card", { entityType: "personal", bankName: "N", lastFourDigits: "33", creditLimit: 1, closingDay: 1, dueDay: 1, currency: "BRL" }),
        call(client, "attach_receipt", { transactionId: ID, filename: "a.exe", mimeType: "application/x-msdownload", contentBase64: "AAAA" }),
      ]);
      await close();

      for (const r of results) expect(r.isError).toBe(true);
      expect(fns.deleteTransactionTool).not.toHaveBeenCalled();
      expect(fns.createCategoryTool).not.toHaveBeenCalled();
      expect(fns.getBudgetComposition).not.toHaveBeenCalled();
      expect(fns.createBudget).not.toHaveBeenCalled();
      expect(fns.createCreditCardTool).not.toHaveBeenCalled();
      expect(fns.attachReceipt).not.toHaveBeenCalled();
    });

    it("forwards a null budget kind and a null reimbursesCategory untouched", async () => {
      const { client, close } = await connect();
      await call(client, "create_budget", { accountId: ID, category: "X", amount: 0, currency: "BRL", effectiveFrom: "2026-10-01", kind: null });
      await call(client, "update_budget", { budgetId: ID, kind: null });
      await call(client, "bulk_update_transactions", { updates: [{ id: ID, reimbursesCategory: null }] });
      await close();

      expect(fns.createBudget).toHaveBeenCalledWith(
        USER,
        { accountId: ID, category: "X", amount: 0, currency: "BRL", effectiveFrom: "2026-10-01", kind: null },
        db,
      );
      expect(fns.updateBudget).toHaveBeenCalledWith(USER, { budgetId: ID, kind: null }, db);
      expect(fns.bulkUpdateTransactions).toHaveBeenCalledWith(USER, [{ id: ID, reimbursesCategory: null }], false, db);
    });
  });
});
