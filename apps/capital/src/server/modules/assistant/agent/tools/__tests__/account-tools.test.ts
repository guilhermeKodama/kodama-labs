import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { executeTool, type AnyAgentToolDef, type ToolContext } from "../registry";
import { manageCreditCard } from "../write/manage-credit-card";
import { manageInvestmentAccount } from "../write/manage-investment-account";
import { manageInvestmentHolding } from "../write/manage-investment-holding";
import { recordInvestmentTransaction } from "../write/record-investment-transaction";

const USER = "test-user-assistant-tools-accounts";
const OTHER = "test-user-assistant-tools-accounts-other";

let f: LedgerFixture;
let other: LedgerFixture;
let ctx: ToolContext;

const run = (tool: AnyAgentToolDef, input: unknown) => tool.handler(ctx, tool.inputSchema.parse(input));
const out = <T>(value: unknown) => value as T;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "account tools" } });
  const turn = await prisma.agentTurn.create({ data: { conversationId: conversation.id, model: "claude-test" } });
  ctx = { userId: USER, conversationId: conversation.id, turnId: turn.id, db: prisma };
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("manage_credit_card", () => {
  const newCard = () => ({
    action: "create",
    bankName: "Itau",
    lastFourDigits: "9876",
    creditLimit: 8000,
    closingDay: 20,
    dueDay: 27,
    currency: "BRL",
    entityType: "personal",
    personalAccountId: f.pfId,
  });

  describe("create", () => {
    it.each([
      ["bankName", "bankName is required to create a credit card"],
      ["lastFourDigits", "lastFourDigits is required to create a credit card"],
      ["creditLimit", "creditLimit is required to create a credit card"],
      ["closingDay", "closingDay is required to create a credit card"],
      ["dueDay", "dueDay is required to create a credit card"],
      ["currency", "currency must be a 3-letter ISO code"],
      ["entityType", "entityType is required to create a credit card"],
    ])("asks for %s", async (field, message) => {
      const input: Record<string, unknown> = newCard();
      delete input[field];
      await expect(run(manageCreditCard, input)).rejects.toThrow(message);
    });

    it("rejects a currency that is not a 3-letter code", async () => {
      await expect(run(manageCreditCard, { ...newCard(), currency: "REAL" })).rejects.toThrow("currency must be a 3-letter ISO code");
    });

    it("books a personal card on the user's own entity, paying from the main checking", async () => {
      const result = out<{ card: { id: string }; createdRecords: unknown }>(await run(manageCreditCard, { ...newCard(), nickname: "Itau Black" }));
      expect(result.createdRecords).toEqual([{ model: "Account", id: result.card.id }]);
      expect(result.card).toMatchObject({ bankName: "Itau", nickname: "Itau Black", lastFourDigits: "9876", creditLimit: 8000, closingDay: 20, dueDay: 27, currency: "BRL", isActive: true, entityType: "personal", personalAccountId: f.pfId, businessId: null });

      const row = await prisma.account.findUniqueOrThrow({ where: { id: result.card.id } });
      expect(row).toMatchObject({ userId: USER, entityId: f.pfId, type: "credit_card", name: "Itau Black", institution: "Itau", externalId: "9876", closingDay: 20, dueDay: 27, payFromAccountId: f.pfChecking, archivedAt: null });
      expect(Number(row.creditLimit)).toBe(8000);
    });

    it("books a business card on the business entity", async () => {
      const result = out<{ card: { id: string; ownerName: string } }>(await run(manageCreditCard, { ...newCard(), lastFourDigits: "1111", entityType: "business", businessId: f.pjId, personalAccountId: undefined }));
      expect(result.card).toMatchObject({ entityType: "business", businessId: f.pjId, personalAccountId: null, ownerName: "Kodama LTDA", nickname: null });
      expect((await prisma.account.findUniqueOrThrow({ where: { id: result.card.id } })).payFromAccountId).toBe(f.pjChecking);
    });

    it("refuses malformed digits, a missing owner reference and entities of someone else, creating nothing", async () => {
      const before = await prisma.account.count({ where: { userId: USER, type: "credit_card" } });
      await expect(run(manageCreditCard, { ...newCard(), lastFourDigits: "12a4" })).rejects.toThrow("lastFourDigits must be exactly 4 digits");
      await expect(run(manageCreditCard, { ...newCard(), personalAccountId: undefined })).rejects.toThrow("personalAccountId is required for personal cards");
      await expect(run(manageCreditCard, { ...newCard(), entityType: "business", businessId: undefined })).rejects.toThrow("businessId is required for business cards");
      await expect(run(manageCreditCard, { ...newCard(), personalAccountId: other.pfId })).rejects.toThrow(/not found/);
      expect(await prisma.account.count({ where: { userId: USER, type: "credit_card" } })).toBe(before);
    });
  });

  describe("update and set_active", () => {
    let cardId: string;

    beforeAll(async () => {
      cardId = out<{ card: { id: string } }>(await run(manageCreditCard, { ...newCard(), lastFourDigits: "2222", nickname: "Cartao editavel" })).card.id;
    });

    it("needs a card id", async () => {
      await expect(run(manageCreditCard, { action: "update", bankName: "X" })).rejects.toThrow('cardId is required for action "update"');
      await expect(run(manageCreditCard, { action: "set_active", isActive: false })).rejects.toThrow('cardId is required for action "set_active"');
    });

    it("edits the card's identity and cycle without touching limit or currency", async () => {
      const result = out<{ card: { id: string }; createdRecords: unknown }>(await run(manageCreditCard, { action: "update", cardId, bankName: "Itau Unibanco", lastFourDigits: "3333", nickname: "Principal", closingDay: 10, dueDay: 17 }));
      expect(result.createdRecords).toEqual([{ model: "Account", id: cardId }]);
      const row = await prisma.account.findUniqueOrThrow({ where: { id: cardId } });
      expect(row).toMatchObject({ institution: "Itau Unibanco", externalId: "3333", name: "Principal", closingDay: 10, dueDay: 17, currency: "BRL" });
      expect(Number(row.creditLimit)).toBe(8000);
    });

    it("changes the limit and the currency of a card that is the user's", async () => {
      await run(manageCreditCard, { action: "update", cardId, creditLimit: 12000.5, currency: "usd" });
      const row = await prisma.account.findUniqueOrThrow({ where: { id: cardId } });
      expect(Number(row.creditLimit)).toBe(12000.5);
      expect(row.currency).toBe("USD");

      await run(manageCreditCard, { action: "update", cardId, creditLimit: 9000 });
      expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: cardId } })).creditLimit)).toBe(9000);
      await run(manageCreditCard, { action: "update", cardId, currency: "BRL" });
      expect((await prisma.account.findUniqueOrThrow({ where: { id: cardId } })).currency).toBe("BRL");
    });

    it("refuses to touch a card of someone else or an account that is not a card, changing nothing", async () => {
      await expect(run(manageCreditCard, { action: "update", cardId: other.card, creditLimit: 1 })).rejects.toThrow("Credit card not found or access denied");
      await expect(run(manageCreditCard, { action: "update", cardId: other.card, bankName: "Hack" })).rejects.toThrow("Credit card not found or access denied");
      await expect(run(manageCreditCard, { action: "update", cardId: f.pfChecking, creditLimit: 1 })).rejects.toThrow("Credit card not found or access denied");
      await expect(run(manageCreditCard, { action: "set_active", cardId: other.card, isActive: false })).rejects.toThrow("Credit card not found or access denied");
      expect((await prisma.account.findUniqueOrThrow({ where: { id: other.card } })).institution).toBeNull();
      expect((await prisma.account.findUniqueOrThrow({ where: { id: other.card } })).archivedAt).toBeNull();
    });

    it("rejects a closing day the card cannot have before touching it", async () => {
      const result = await executeTool([manageCreditCard], ctx, "tool-0", "manage_credit_card", { action: "update", cardId, closingDay: 32 });
      expect(result.isError).toBe(true);
      expect(result.output).toMatchObject({ error: expect.stringContaining("Invalid input for manage_credit_card") });
      expect((await prisma.account.findUniqueOrThrow({ where: { id: cardId } })).closingDay).toBe(10);
    });

    it("deactivates and reactivates a card, keeping it", async () => {
      await expect(run(manageCreditCard, { action: "set_active", cardId })).rejects.toThrow('isActive is required for action "set_active"');

      const off = out<{ card: { isActive: boolean } }>(await run(manageCreditCard, { action: "set_active", cardId, isActive: false }));
      expect(off.card.isActive).toBe(false);
      expect((await prisma.account.findUniqueOrThrow({ where: { id: cardId } })).archivedAt).not.toBeNull();

      const on = out<{ card: { isActive: boolean } }>(await run(manageCreditCard, { action: "set_active", cardId, isActive: true }));
      expect(on.card.isActive).toBe(true);
      expect((await prisma.account.findUniqueOrThrow({ where: { id: cardId } })).archivedAt).toBeNull();
    });

    it("is audited with the created record when run through the executor", async () => {
      const result = await executeTool([manageCreditCard], ctx, "tool-1", "manage_credit_card", { action: "set_active", cardId, isActive: true });
      expect(result.isError).toBe(false);
      const audit = await prisma.agentAction.findFirstOrThrow({ where: { conversationId: ctx.conversationId, toolName: "manage_credit_card" }, orderBy: { createdAt: "desc" } });
      expect(audit).toMatchObject({ status: "success", turnId: ctx.turnId, userId: USER, input: { action: "set_active", cardId, isActive: true }, createdRecords: [{ model: "Account", id: cardId }] });
    });
  });
});

describe("manage_investment_account", () => {
  describe("create", () => {
    it.each([
      [{ entityType: "personal", currency: "BRL", personalAccountId: "x" }, "name is required to create an investment account"],
      [{ name: "Rico", currency: "BRL", personalAccountId: "x" }, "entityType is required to create an investment account"],
      [{ name: "Rico", entityType: "personal", personalAccountId: "x" }, "currency must be a 3-letter ISO code"],
      [{ name: "Rico", entityType: "personal", currency: "BR", personalAccountId: "x" }, "currency must be a 3-letter ISO code"],
      [{ name: "Rico", entityType: "personal", currency: "BRL" }, "personalAccountId is required when entityType is personal"],
      [{ name: "Rico", entityType: "business", currency: "BRL", personalAccountId: "x" }, "businessId is required when entityType is business"],
    ])("rejects %j", async (input, message) => {
      await expect(run(manageInvestmentAccount, { action: "create", ...input })).rejects.toThrow(message);
    });

    it("opens a brokerage account on the user's entity, with or without the broker's name", async () => {
      const personal = out<{ account: { id: string }; createdRecords: unknown }>(await run(manageInvestmentAccount, { action: "create", name: "Clear", broker: "Clear Corretora", entityType: "personal", currency: "BRL", personalAccountId: f.pfId }));
      expect(personal.createdRecords).toEqual([{ model: "Account", id: personal.account.id }]);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: personal.account.id } })).toMatchObject({ userId: USER, entityId: f.pfId, type: "brokerage", name: "Clear", institution: "Clear Corretora", currency: "BRL", archivedAt: null });

      const business = out<{ account: { id: string } }>(await run(manageInvestmentAccount, { action: "create", name: "Caixa PJ", entityType: "business", currency: "USD", businessId: f.pjId }));
      expect(await prisma.account.findUniqueOrThrow({ where: { id: business.account.id } })).toMatchObject({ entityId: f.pjId, type: "brokerage", institution: null, currency: "USD" });
    });

    it("never opens an account on another user's entity or on an entity of the wrong kind", async () => {
      const before = await prisma.account.count({ where: { userId: { in: [USER, OTHER] }, type: "brokerage" } });
      await expect(run(manageInvestmentAccount, { action: "create", name: "Invasora", entityType: "personal", currency: "BRL", personalAccountId: other.pfId })).rejects.toThrow(`personal entity ${other.pfId} not found or access denied`);
      await expect(run(manageInvestmentAccount, { action: "create", name: "Errada", entityType: "business", currency: "BRL", businessId: f.pfId })).rejects.toThrow(`business entity ${f.pfId} not found or access denied`);
      expect(await prisma.account.count({ where: { userId: { in: [USER, OTHER] }, type: "brokerage" } })).toBe(before);
    });
  });

  describe("update and set_active", () => {
    it("needs an account that is a brokerage of the user's", async () => {
      await expect(run(manageInvestmentAccount, { action: "update", name: "x" })).rejects.toThrow('accountId is required for action "update"');
      await expect(run(manageInvestmentAccount, { action: "set_active", isActive: true })).rejects.toThrow('accountId is required for action "set_active"');
      await expect(run(manageInvestmentAccount, { action: "update", accountId: f.pfChecking, name: "x" })).rejects.toThrow("Investment account not found or access denied");
      await expect(run(manageInvestmentAccount, { action: "update", accountId: other.broker, name: "Roubada" })).rejects.toThrow("Investment account not found or access denied");
      await expect(run(manageInvestmentAccount, { action: "set_active", accountId: other.broker, isActive: false })).rejects.toThrow("Investment account not found or access denied");
      expect((await prisma.account.findUniqueOrThrow({ where: { id: other.broker } })).name).toBe("XP");
    });

    it("renames the account and sets its broker and currency, field by field", async () => {
      const renamed = out<{ account: { name: string }; createdRecords: unknown }>(await run(manageInvestmentAccount, { action: "update", accountId: f.broker, name: "XP Investimentos" }));
      expect(renamed.account.name).toBe("XP Investimentos");
      expect(renamed.createdRecords).toEqual([{ model: "Account", id: f.broker }]);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).toMatchObject({ name: "XP Investimentos", institution: null, currency: "BRL" });

      await run(manageInvestmentAccount, { action: "update", accountId: f.broker, broker: "XP Inc", currency: "usd" });
      expect(await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).toMatchObject({ name: "XP Investimentos", institution: "XP Inc", currency: "USD" });
    });

    it("archives and unarchives the account instead of deleting it", async () => {
      await expect(run(manageInvestmentAccount, { action: "set_active", accountId: f.broker })).rejects.toThrow('isActive is required for action "set_active"');
      await run(manageInvestmentAccount, { action: "set_active", accountId: f.broker, isActive: false });
      expect((await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).archivedAt).not.toBeNull();
      await run(manageInvestmentAccount, { action: "set_active", accountId: f.broker, isActive: true });
      expect((await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).archivedAt).toBeNull();
    });
  });
});

describe("manage_investment_holding", () => {
  let accountId: string;
  let holdingId: string;

  beforeAll(async () => {
    accountId = (await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Corretora de teste", currency: "BRL" } })).id;
  });

  const create = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ action: "create", accountId, assetClass: "fii", ticker: "mxrf11", name: "Maxi Renda", currency: "BRL", ...extra });

  describe("create", () => {
    it.each([
      ["accountId", "accountId is required to create a holding"],
      ["assetClass", "assetClass is required to create a holding"],
      ["name", "name is required to create a holding"],
      ["currency", "currency must be a 3-letter ISO code"],
    ])("asks for %s", async (field, message) => {
      const input = create();
      delete input[field];
      await expect(run(manageInvestmentHolding, input)).rejects.toThrow(message);
    });

    it("rejects a currency that is not a 3-letter code", async () => {
      await expect(run(manageInvestmentHolding, create({ currency: "BR" }))).rejects.toThrow("currency must be a 3-letter ISO code");
    });

    it("creates a position with an upper-cased ticker and no quantity or cost of its own", async () => {
      const result = out<{ holding: { id: string }; createdRecords: unknown }>(await run(manageInvestmentHolding, create()));
      holdingId = result.holding.id;
      expect(result.createdRecords).toEqual([{ model: "InvestmentHolding", id: holdingId }]);
      expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).toMatchObject({ accountId, assetClass: "fii", ticker: "MXRF11", name: "Maxi Renda", currency: "BRL", currentQuantity: 0, averageCost: 0, totalInvested: 0, isActive: true, subType: null });
    });

    it("keeps the sub-type only for fixed income", async () => {
      const cdb = out<{ holding: { id: string } }>(await run(manageInvestmentHolding, create({ assetClass: "fixed_income", subType: "cdb", ticker: undefined, name: "CDB 120% CDI" })));
      expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: cdb.holding.id } })).toMatchObject({ subType: "cdb", ticker: null });
      const stock = out<{ holding: { id: string } }>(await run(manageInvestmentHolding, create({ assetClass: "stocks", subType: "cdb", ticker: "vale3", name: "Vale" })));
      expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: stock.holding.id } })).subType).toBeNull();
    });

    it("refuses an account that is not a brokerage or not the user's", async () => {
      await expect(run(manageInvestmentHolding, create({ accountId: f.pfChecking }))).rejects.toThrow("Holdings live on brokerage accounts");
      await expect(run(manageInvestmentHolding, create({ accountId: other.broker }))).rejects.toThrow(/not found/);
      expect(await prisma.investmentHolding.count({ where: { accountId: other.broker } })).toBe(0);
    });
  });

  describe("update and set_active", () => {
    it("needs a holding id", async () => {
      await expect(run(manageInvestmentHolding, { action: "update", name: "x" })).rejects.toThrow('holdingId is required for action "update"');
      await expect(run(manageInvestmentHolding, { action: "set_active", isActive: false })).rejects.toThrow('holdingId is required for action "set_active"');
    });

    it("corrects name, ticker, class, sub-type and currency", async () => {
      const result = out<{ holding: { id: string }; createdRecords: unknown }>(await run(manageInvestmentHolding, { action: "update", holdingId, name: "Maxi Renda FII", ticker: "mxrf12", assetClass: "etf" }));
      expect(result.createdRecords).toEqual([{ model: "InvestmentHolding", id: holdingId }]);
      expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).toMatchObject({ name: "Maxi Renda FII", ticker: "MXRF12", assetClass: "etf", currency: "BRL" });

      await run(manageInvestmentHolding, { action: "update", holdingId, subType: "lci", currency: "USD" });
      expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).toMatchObject({ name: "Maxi Renda FII", subType: "lci", currency: "USD" });
    });

    it("deactivates and reactivates a position", async () => {
      await expect(run(manageInvestmentHolding, { action: "set_active", holdingId })).rejects.toThrow('isActive is required for action "set_active"');
      await run(manageInvestmentHolding, { action: "set_active", holdingId, isActive: false });
      expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).isActive).toBe(false);
      await run(manageInvestmentHolding, { action: "set_active", holdingId, isActive: true });
      expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).isActive).toBe(true);
    });

    it("never edits a position of someone else", async () => {
      const theirs = await createHolding(OTHER, { accountId: other.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itau" }, prisma);
      await expect(run(manageInvestmentHolding, { action: "update", holdingId: theirs.id, name: "Roubado" })).rejects.toThrow("Holding not found or access denied");
      await expect(run(manageInvestmentHolding, { action: "set_active", holdingId: theirs.id, isActive: false })).rejects.toThrow("Holding not found or access denied");
      expect(await prisma.investmentHolding.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ name: "Itau", isActive: true });
    });
  });
});

describe("record_investment_transaction", () => {
  let holdingId: string;
  let accountId: string;

  beforeAll(async () => {
    accountId = (await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Mesa", currency: "BRL" } })).id;
    holdingId = (await createHolding(USER, { accountId, assetClass: "stocks", ticker: "WEGE3", name: "WEG" }, prisma)).id;
  });

  const buy = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ action: "create", holdingId, type: "buy", quantity: 10, pricePerUnit: 40, totalAmount: 400, fees: 1.5, date: "2026-08-03", notes: "primeira compra", ...extra });
  const cashOf = async (id: string) => (await prisma.ledgerEntry.findUniqueOrThrow({ where: { id } }));
  const position = () => prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } });

  it.each([
    ["holdingId", "holdingId is required to record a transaction"],
    ["type", "type is required to record a transaction"],
    ["totalAmount", "totalAmount is required to record a transaction"],
    ["date", "date is required to record a transaction"],
  ])("asks for %s", async (field, message) => {
    const input = buy();
    delete input[field];
    await expect(run(recordInvestmentTransaction, input)).rejects.toThrow(message);
  });

  it("records a buy with its cash leg and recalculates the position", async () => {
    const result = out<{ transaction: { id: string; type: string; cashEntryId: string; date: string; cashAmount: number }; createdRecords: unknown }>(await run(recordInvestmentTransaction, buy()));
    expect(result.createdRecords).toEqual([{ model: "InvestmentOperation", id: result.transaction.id }]);
    expect(result.transaction).toMatchObject({ type: "buy", holdingId, quantity: 10, pricePerUnit: 40, totalAmount: 400, fees: 1.5, date: "2026-08-03", notes: "primeira compra", cashAmount: -401.5 });

    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: result.transaction.id } });
    expect(op).toMatchObject({ holdingId, type: "buy", quantity: 10, totalAmount: 400, fees: 1.5 });
    expect(Number((await cashOf(op.cashEntryId!)).amount)).toBe(-401.5);
    expect(await position()).toMatchObject({ currentQuantity: 10 });
  });

  it("corrects an operation: only the fields sent change, the cash leg follows", async () => {
    const created = out<{ transaction: { id: string } }>(await run(recordInvestmentTransaction, buy({ date: "2026-08-04", quantity: 5, pricePerUnit: 10, totalAmount: 50, fees: 0, notes: undefined })));
    const id = created.transaction.id;

    const noDate = out<{ transaction: { date: string; totalAmount: number; quantity: number }; createdRecords: unknown }>(await run(recordInvestmentTransaction, { action: "update", transactionId: id, totalAmount: 60, pricePerUnit: 12, notes: "ajustada" }));
    expect(noDate.createdRecords).toEqual([{ model: "InvestmentOperation", id }]);
    expect(noDate.transaction).toMatchObject({ date: "2026-08-04", totalAmount: 60, quantity: 5, pricePerUnit: 12, notes: "ajustada" });
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id } });
    expect(Number((await cashOf(op.cashEntryId!)).amount)).toBe(-60);

    const moved = out<{ transaction: { date: string; type: string } }>(await run(recordInvestmentTransaction, { action: "update", transactionId: id, date: "2026-08-10", type: "sell", quantity: 2, totalAmount: 30, fees: 0.5 }));
    expect(moved.transaction).toMatchObject({ date: "2026-08-10", type: "sell", quantity: 2, totalAmount: 30, fees: 0.5 });
    const sold = await prisma.investmentOperation.findUniqueOrThrow({ where: { id } });
    expect(Number((await cashOf(sold.cashEntryId!)).amount)).toBe(29.5);
  });

  it("removes an operation together with its cash leg and recalculates the position", async () => {
    const created = out<{ transaction: { id: string } }>(await run(recordInvestmentTransaction, buy({ date: "2026-08-20", quantity: 3, pricePerUnit: 100, totalAmount: 300, fees: 0 })));
    const id = created.transaction.id;
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id } });
    const quantityWith = (await position()).currentQuantity;

    const result = await run(recordInvestmentTransaction, { action: "delete", transactionId: id });
    expect(result).toEqual({ deleted: true, createdRecords: [{ model: "InvestmentOperation", id }] });
    expect(await prisma.investmentOperation.findUnique({ where: { id } })).toBeNull();
    expect((await cashOf(op.cashEntryId!)).deletedAt).not.toBeNull();
    expect((await position()).currentQuantity).toBe(quantityWith - 3);
  });

  it("needs a transaction id to correct or remove, and only touches the user's own operations", async () => {
    await expect(run(recordInvestmentTransaction, { action: "update", totalAmount: 1 })).rejects.toThrow('transactionId is required for action "update"');
    await expect(run(recordInvestmentTransaction, { action: "delete" })).rejects.toThrow('transactionId is required for action "delete"');

    const theirHolding = await createHolding(OTHER, { accountId: other.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itau" }, prisma);
    const theirs = await recordOperation(OTHER, { holdingId: theirHolding.id, type: "buy", quantity: 1, pricePerUnit: 30, totalAmount: 30, date: "2026-08-01" }, prisma);
    await expect(run(recordInvestmentTransaction, { action: "update", transactionId: theirs.operation.id, totalAmount: 1 })).rejects.toThrow(/not found/);
    await expect(run(recordInvestmentTransaction, { action: "delete", transactionId: theirs.operation.id })).rejects.toThrow(/not found/);
    await expect(run(recordInvestmentTransaction, buy({ holdingId: theirHolding.id }))).rejects.toThrow(/not found/);
    expect(await prisma.investmentOperation.count({ where: { holdingId: theirHolding.id } })).toBe(1);
  });

  it("refuses to sell more than the position holds", async () => {
    const before = await prisma.investmentOperation.count({ where: { holdingId } });
    await expect(run(recordInvestmentTransaction, buy({ type: "sell", quantity: 1000, pricePerUnit: 1, totalAmount: 1000, fees: 0 }))).rejects.toThrow("The sale is larger than the position");
    expect(await prisma.investmentOperation.count({ where: { holdingId } })).toBe(before);
  });
});
