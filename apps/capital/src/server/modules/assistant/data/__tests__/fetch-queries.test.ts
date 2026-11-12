import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry, softDeleteEntries } from "@capital/server/modules/ledger/services/entries";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { fetchInvestmentHoldingsForAgent } from "../queries/fetch-investment-holdings";
import { fetchConversationDetail, fetchConversationById, fetchConversations } from "../queries/fetch-conversations";
import { fetchConversationFileById, fetchConversationFilesForAgent } from "../queries/fetch-conversation-files";
import { fetchEntityForAgent } from "../queries/fetch-entity-for-agent";
import { fetchImportBatchesForAgent } from "../queries/fetch-import-batches";
import { fetchReconciliationContext } from "../queries/fetch-reconciliation-context";
import { fetchContextSnapshot } from "../queries/fetch-context-snapshot";
import { fetchMessageHistory, fetchRunningTurn } from "../queries/fetch-message-history";
import { fetchImportPlanById } from "../queries/fetch-import-plan";

const USER = "test-user-assistant-data-fetch";
const OTHER = "test-user-assistant-data-fetch-other";
const BARE = "test-user-assistant-data-fetch-bare";

let f: LedgerFixture;
let other: LedgerFixture;

// Imports have no user relation: one without an entity survives its user's deletion.
const dropImports = () => prisma.import.deleteMany({ where: { userId: { in: [USER, OTHER, BARE] } } });

beforeAll(async () => {
  await dropImports();
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await dropImports();
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
  await deleteLedgerFixture(prisma, BARE);
});

describe("fetchInvestmentHoldingsForAgent", () => {
  let hglg: string;
  let busyBroker: string;

  beforeAll(async () => {
    // The brokerage is funded with 1000, then buys move the cash out.
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 1000, date: "2026-01-02", description: "Aporte" }, prisma);
    hglg = (await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "hglg11", name: "CSHG Logistica" }, prisma)).id;
    for (const [i, amount] of [100, 100, 100, 100, 100, 100, 33.337].entries()) {
      await recordOperation(USER, { holdingId: hglg, type: "buy", quantity: 1, pricePerUnit: amount, totalAmount: amount, date: `2026-02-0${i + 1}`, externalId: `op-${i + 1}` }, prisma);
    }
    const inactive = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "OLD3", name: "Antiga" }, prisma);
    await prisma.investmentHolding.update({ where: { id: inactive.id }, data: { isActive: false } });

    // A brokerage under the business entity, without holdings.
    const biz = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Rico", institution: "Rico Corretora", currency: "BRL", externalId: "BR-77" } });
    busyBroker = biz.id;
    const otherBroker = await createHolding(OTHER, { accountId: other.broker, assetClass: "stocks", ticker: "ITUB4", name: "Itau" }, prisma);
    expect(otherBroker.id).toBeTruthy();
  });

  it("lists the brokerages with active holdings, their last five movements newest first and the cash balance rounded to cents", async () => {
    const accounts = await fetchInvestmentHoldingsForAgent(USER, undefined, prisma);
    expect(accounts.map((a) => a.id).sort()).toEqual([f.broker, busyBroker].sort());

    const xp = accounts.find((a) => a.id === f.broker)!;
    expect(xp).toMatchObject({ name: "XP", broker: null, entityType: "personal", currency: "BRL", externalId: null });
    // 1000 deposited - 6 x 100 - 33.337, rounded.
    expect(xp.cashBalance).toBe(366.66);
    expect(xp.holdings).toHaveLength(1); // OLD3 is inactive
    const holding = xp.holdings[0];
    expect(holding).toMatchObject({ id: hglg, ticker: "HGLG11", assetClass: "fii", name: "CSHG Logistica", currentQuantity: 7 });
    expect(holding).not.toHaveProperty("operations");
    expect(holding.transactions).toHaveLength(5);
    expect(holding.transactions.map((t) => t.externalId)).toEqual(["op-7", "op-6", "op-5", "op-4", "op-3"]);
    expect(holding.transactions[0]).toMatchObject({ type: "buy", quantity: 1, totalAmount: 33.337 });

    const rico = accounts.find((a) => a.id === busyBroker)!;
    expect(rico).toMatchObject({ name: "Rico", broker: "Rico Corretora", entityType: "business", externalId: "BR-77", cashBalance: 0, holdings: [] });
  });

  it("narrows to one account", async () => {
    const only = await fetchInvestmentHoldingsForAgent(USER, busyBroker, prisma);
    expect(only.map((a) => a.id)).toEqual([busyBroker]);
  });

  it("refuses an account that does not exist or belongs to someone else", async () => {
    await expect(fetchInvestmentHoldingsForAgent(USER, other.broker, prisma)).rejects.toThrow("Investment account not found or access denied");
    await expect(fetchInvestmentHoldingsForAgent(USER, f.pfChecking, prisma)).rejects.toThrow("Investment account not found or access denied");
    await expect(fetchInvestmentHoldingsForAgent(USER, "missing-id", prisma)).rejects.toThrow("Investment account not found or access denied");
  });
});

describe("conversation queries", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    const base = Date.now();
    for (let i = 0; i < 4; i++) {
      const c = await prisma.agentConversation.create({ data: { userId: USER, title: `Conversa ${i}`, lastMessageAt: new Date(base - i * 60_000) } });
      ids.push(c.id);
    }
    await prisma.agentConversation.update({ where: { id: ids[3] }, data: { status: "archived" } });
    await prisma.agentConversation.create({ data: { userId: OTHER, title: "Alheia" } });
  });

  it("lists active conversations of the user, most recently active first", async () => {
    const list = await fetchConversations(USER, {}, prisma);
    expect(list.map((c) => c.id)).toEqual(ids.slice(0, 3));
    expect(list[0]).toEqual({
      id: ids[0],
      title: "Conversa 0",
      status: "active",
      lastMessageAt: expect.any(Date),
      createdAt: expect.any(Date),
    });
  });

  it("pages by cursor and by limit", async () => {
    const first = await fetchConversations(USER, { limit: 2 }, prisma);
    expect(first.map((c) => c.id)).toEqual([ids[0], ids[1]]);
    const next = await fetchConversations(USER, { limit: 2, cursor: first[1].id }, prisma);
    expect(next.map((c) => c.id)).toEqual([ids[2]]);
  });

  it("caps the page size at 100", async () => {
    const huge = await fetchConversations(USER, { limit: 100_000 }, prisma);
    expect(huge).toHaveLength(3);
  });

  it("returns the full detail with messages, files, plans and turn totals, scoped to the owner", async () => {
    const id = ids[0];
    const turn = await prisma.agentTurn.create({ data: { conversationId: id, model: "claude-test", status: "completed", inputTokens: 10, outputTokens: 5, costUsd: 0.0123, completedAt: new Date() } });
    await prisma.agentMessage.create({ data: { conversationId: id, turnId: turn.id, role: "user", content: [{ type: "text", text: "oi" }], kind: "user_text", createdAt: new Date(Date.now() - 2000) } });
    await prisma.agentMessage.create({ data: { conversationId: id, turnId: turn.id, role: "assistant", content: [{ type: "text", text: "ola" }], kind: "assistant", createdAt: new Date(Date.now() - 1000) } });
    await prisma.conversationFile.create({
      data: { conversationId: id, userId: USER, fileType: "csv", blobUrl: "blob://a", pathname: "a.csv", mimeType: "text/csv", sizeBytes: 3, originalName: "a.csv" },
    });
    await prisma.importPlan.create({ data: { conversationId: id, userId: USER, payload: {}, payloadHash: "h", summary: {} } });

    const detail = await fetchConversationDetail(USER, id, prisma);
    expect(detail).not.toBeNull();
    expect(detail!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(detail!.files.map((x) => x.originalName)).toEqual(["a.csv"]);
    expect(detail!.plans).toHaveLength(1);
    expect(detail!.turns).toEqual([
      expect.objectContaining({ id: turn.id, status: "completed", model: "claude-test", inputTokens: 10, outputTokens: 5, error: null }),
    ]);
    expect(Number(detail!.turns[0].costUsd)).toBeCloseTo(0.0123, 6);

    expect(await fetchConversationDetail(OTHER, id, prisma)).toBeNull();
    expect(await fetchConversationDetail(USER, "missing", prisma)).toBeNull();
  });

  it("reads a bare conversation only for its owner", async () => {
    expect((await fetchConversationById(USER, ids[1], prisma))?.title).toBe("Conversa 1");
    expect(await fetchConversationById(OTHER, ids[1], prisma)).toBeNull();
  });
});

describe("conversation files, message history and plans", () => {
  let conversationId: string;
  let otherConversationId: string;
  let csvId: string;

  beforeAll(async () => {
    conversationId = (await prisma.agentConversation.create({ data: { userId: USER, title: "Arquivos" } })).id;
    otherConversationId = (await prisma.agentConversation.create({ data: { userId: USER, title: "Outra" } })).id;
    const file = (name: string, createdAt: Date, conv = conversationId, userId = USER) =>
      prisma.conversationFile.create({
        data: { conversationId: conv, userId, fileType: "csv", statementKind: "card_csv", blobUrl: `blob://${name}`, pathname: name, mimeType: "text/csv", sizeBytes: 12, originalName: name, parseStatus: "parsed", parsedPayload: { kind: "card_csv", rows: [] }, createdAt },
      });
    await file("second.csv", new Date("2026-03-02T10:00:00Z"));
    csvId = (await file("first.csv", new Date("2026-03-01T10:00:00Z"))).id;
    await file("elsewhere.csv", new Date("2026-03-01T10:00:00Z"), otherConversationId);
    await file("someone-else.csv", new Date("2026-03-01T10:00:00Z"), conversationId, OTHER);
  });

  it("lists a conversation's files oldest first, without file bytes", async () => {
    const files = await fetchConversationFilesForAgent(conversationId, USER, prisma);
    expect(files.map((x) => x.originalName)).toEqual(["first.csv", "second.csv"]);
    expect(files[0]).toMatchObject({ fileType: "csv", statementKind: "card_csv", sizeBytes: 12, parseStatus: "parsed", parseError: null, parsedPayload: { kind: "card_csv", rows: [] } });
    expect(files[0]).not.toHaveProperty("blobUrl");
  });

  it("finds one file only inside its conversation and for its owner", async () => {
    expect((await fetchConversationFileById(csvId, conversationId, USER, prisma))?.originalName).toBe("first.csv");
    expect(await fetchConversationFileById(csvId, otherConversationId, USER, prisma)).toBeNull();
    expect(await fetchConversationFileById(csvId, conversationId, OTHER, prisma)).toBeNull();
  });

  it("reads the message history in order and finds a running turn", async () => {
    await prisma.agentMessage.create({ data: { conversationId, role: "assistant", content: [{ type: "text", text: "segunda" }], kind: "assistant", createdAt: new Date("2026-03-01T10:00:02Z") } });
    await prisma.agentMessage.create({ data: { conversationId, role: "user", content: [{ type: "text", text: "primeira" }], kind: "user_text", createdAt: new Date("2026-03-01T10:00:01Z") } });
    expect(await fetchMessageHistory(conversationId, prisma)).toEqual([
      { role: "user", content: [{ type: "text", text: "primeira" }] },
      { role: "assistant", content: [{ type: "text", text: "segunda" }] },
    ]);
    expect(await fetchMessageHistory(otherConversationId, prisma)).toEqual([]);

    expect(await fetchRunningTurn(conversationId, prisma)).toBeNull();
    await prisma.agentTurn.create({ data: { conversationId, model: "m", status: "completed" } });
    expect(await fetchRunningTurn(conversationId, prisma)).toBeNull();
    const running = await prisma.agentTurn.create({ data: { conversationId, model: "m", status: "running" } });
    expect(await fetchRunningTurn(conversationId, prisma)).toEqual({ id: running.id });
  });

  it("fetches an import plan only for its owner", async () => {
    const plan = await prisma.importPlan.create({ data: { conversationId, userId: USER, payload: {}, payloadHash: "h", summary: {} } });
    expect((await fetchImportPlanById(USER, plan.id, prisma))?.id).toBe(plan.id);
    expect(await fetchImportPlanById(OTHER, plan.id, prisma)).toBeNull();
    expect(await fetchImportPlanById(USER, "missing", prisma)).toBeNull();
  });
});

describe("fetchEntityForAgent", () => {
  it("returns the entity with its main account and opening balance", async () => {
    await prisma.account.update({ where: { id: f.pjChecking }, data: { initialBalance: 250.5 } });
    expect(await fetchEntityForAgent(USER, "business", f.pjId, prisma)).toEqual({
      id: f.pjId,
      name: "Kodama LTDA",
      defaultCurrency: "BRL",
      initialBalance: 250.5,
      accountId: f.pjChecking,
    });
  });

  it("is null for a wrong kind, someone else's entity or an unknown id", async () => {
    expect(await fetchEntityForAgent(USER, "personal", f.pjId, prisma)).toBeNull();
    expect(await fetchEntityForAgent(USER, "business", other.pjId, prisma)).toBeNull();
    expect(await fetchEntityForAgent(USER, "business", "missing", prisma)).toBeNull();
  });

  it("reports a zero balance and no account for an entity without a main account", async () => {
    const bare = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Sem conta", defaultCurrency: "USD" } });
    try {
      expect(await fetchEntityForAgent(USER, "business", bare.id, prisma)).toEqual({ id: bare.id, name: "Sem conta", defaultCurrency: "USD", initialBalance: 0, accountId: null });
    } finally {
      await prisma.entity.delete({ where: { id: bare.id } });
    }
  });
});

describe("fetchImportBatchesForAgent", () => {
  it("lists the newest batches first in the legacy entity shape, flagging reverted ones as not revertible", async () => {
    const conv = await prisma.agentConversation.create({ data: { userId: USER, title: "Imports" } });
    await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Nubank", transactionCount: 3, createdAt: new Date("2026-04-01T10:00:00Z") } });
    await prisma.import.create({ data: { userId: USER, entityId: f.pjId, bankName: "Itau", transactionCount: 5, source: "agent", conversationId: conv.id, createdAt: new Date("2026-04-02T10:00:00Z") } });
    await prisma.import.create({ data: { userId: USER, bankName: "Sem entidade", transactionCount: 1, revertedAt: new Date("2026-04-04T10:00:00Z"), createdAt: new Date("2026-04-03T10:00:00Z") } });
    await prisma.import.create({ data: { userId: OTHER, entityId: other.pfId, bankName: "Alheio", transactionCount: 9, createdAt: new Date("2026-04-05T10:00:00Z") } });

    const batches = await fetchImportBatchesForAgent(USER, 10, prisma);
    expect(batches.map((b) => b.bankName)).toEqual(["Sem entidade", "Itau", "Nubank"]);
    expect(batches[0]).toMatchObject({ entityType: null, businessId: null, personalAccountId: null, revertEligible: false, revertedAt: new Date("2026-04-04T10:00:00Z") });
    expect(batches[1]).toMatchObject({ entityType: "business", businessId: f.pjId, personalAccountId: null, source: "agent", conversationId: conv.id, transactionCount: 5, revertEligible: true });
    expect(batches[2]).toMatchObject({ entityType: "personal", businessId: null, personalAccountId: f.pfId, source: "manual", conversationId: null, importPlanId: null });

    expect(await fetchImportBatchesForAgent(USER, 1, prisma)).toHaveLength(1);
  });
});

describe("fetchReconciliationContext", () => {
  it("collects bank entries, active businesses, active brokerages and imported transfer ids for the user only", async () => {
    const cash = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Carteira", currency: "BRL" } });
    const make = async (input: Parameters<typeof createEntry>[1]) => (await createEntry(USER, input, prisma)).entryIds[0];
    const bankExpense = await make({ kind: "expense", accountId: f.pfChecking, amount: 50, date: "2026-05-02", description: "Padaria", externalId: "fit-1" });
    const bankIncome = await make({ kind: "income", accountId: f.pjChecking, amount: 900, date: "2026-05-03", description: "Cliente" });
    const cashExpense = await make({ kind: "expense", accountId: cash.id, amount: 10, date: "2026-05-04", description: "Troco" });
    const trashed = await make({ kind: "expense", accountId: f.pfChecking, amount: 7, date: "2026-05-05", description: "Apagada" });
    await softDeleteEntries(USER, [trashed], prisma);
    await make({ kind: "expense", accountId: f.card, amount: 80, date: "2026-05-06", description: "Compra no cartao" });
    await prisma.ledgerEntry.update({ where: { id: bankExpense }, data: { amount: -50.126 } });
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 25, date: "2026-05-07", description: "Entre contas" }, prisma);
    await prisma.transferGroup.update({ where: { id: transfer.transferGroupId! }, data: { externalId: "fit-transfer" } });
    const trashedTransfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 26, date: "2026-05-08", description: "Desfeita" }, prisma);
    await prisma.transferGroup.update({ where: { id: trashedTransfer.transferGroupId! }, data: { externalId: "fit-trashed", deletedAt: new Date() } });
    await prisma.transferGroup.create({ data: { userId: USER, direction: "between_accounts", date: new Date(), description: "Sem id" } });
    const archived = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Arquivada", defaultCurrency: "BRL", archivedAt: new Date() } });
    await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Corretora antiga", currency: "BRL", archivedAt: new Date() } });
    await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 2, date: "2026-05-09", description: "Alheia" }, prisma);

    const ctx = await fetchReconciliationContext(USER, prisma);
    expect(ctx.existingTransactions.map((t) => t.id).sort()).toEqual([bankExpense, bankIncome, cashExpense].sort());
    const expense = ctx.existingTransactions.find((t) => t.id === bankExpense)!;
    expect(expense).toEqual({ id: bankExpense, externalId: "fit-1", amount: 50.126, date: new Date("2026-05-02T12:00:00.000Z"), description: "Padaria", type: "expense" });
    expect(ctx.existingTransactions.find((t) => t.id === bankIncome)).toMatchObject({ amount: 900, type: "income", externalId: null });

    expect(ctx.entities).toEqual([{ id: f.pjId, name: "Kodama LTDA", entityType: "business" }]);
    expect(ctx.entities.map((e) => e.id)).not.toContain(archived.id);
    // XP and Rico (created above); the archived brokerage stays out.
    expect(ctx.investmentAccounts.map((a) => a.name).sort()).toEqual(["Rico", "XP"]);
    expect([...ctx.knownTransferFitIds]).toEqual(["fit-transfer"]);
  });
});

describe("fetchContextSnapshot", () => {
  it("orients the agent: currencies, archived cards, imports without entity and learned rules", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 5.25 } });
    await prisma.account.update({ where: { id: f.card }, data: { archivedAt: new Date(), institution: "Nubank S.A." } });
    await prisma.categorizationRule.create({ data: { userId: USER, pattern: "ifood", matchType: "contains", categoryId: f.categories.Groceries } });
    await prisma.import.create({ data: { userId: USER, bankName: "Ghost", transactionCount: 2, createdAt: new Date("2030-01-01T00:00:00Z") } });

    const snap = await fetchContextSnapshot(USER, prisma);
    expect(snap).toMatchObject({ baseCurrency: "BRL", personalAccount: { id: f.pfId, defaultCurrency: "BRL" }, businesses: [{ id: f.pjId, name: "Kodama LTDA", defaultCurrency: "BRL" }] });
    expect(snap.currencies).toEqual([{ code: "USD", manualRate: 5.25 }]);
    expect(snap.creditCards).toEqual([
      expect.objectContaining({ id: f.card, bankName: "Nubank S.A.", lastFourDigits: "1234", entityType: "personal", personalAccountId: f.pfId, businessId: null, closingDay: 5, dueDay: 12, isActive: false }),
    ]);
    // _count includes the inactive holding.
    expect(snap.investmentAccounts.find((a) => a.id === f.broker)).toMatchObject({ isActive: true, _count: { holdings: 2 }, broker: null, currency: "BRL", entityType: "personal" });
    expect(snap.investmentAccounts.find((a) => a.name === "Rico")).toMatchObject({ broker: "Rico Corretora", entityType: "business", businessId: f.pjId, _count: { holdings: 0 } });
    expect(snap.categories.map((c) => c.name)).toEqual(expect.arrayContaining(["Groceries", "Salary", "Software"]));
    expect(snap.categorizationRules).toEqual([{ pattern: "ifood", matchType: "contains", category: "Groceries" }]);
    expect(snap.recentImports[0]).toMatchObject({ bankName: "Ghost", entityType: null, transactionCount: 2, source: "manual" });
  });

  it("has no personal account for a user who only has a business", async () => {
    await prisma.user.deleteMany({ where: { id: BARE } });
    await prisma.user.create({ data: { id: BARE, email: `${BARE}@example.com`, passwordHash: "x", name: BARE, baseCurrency: "USD" } });
    const biz = await prisma.entity.create({ data: { userId: BARE, kind: "business", name: "Solo", defaultCurrency: "USD" } });
    const snap = await fetchContextSnapshot(BARE, prisma);
    expect(snap.personalAccount).toBeNull();
    expect(snap.baseCurrency).toBe("USD");
    expect(snap.businesses).toEqual([{ id: biz.id, name: "Solo", defaultCurrency: "USD" }]);
    expect(snap).toMatchObject({ creditCards: [], investmentAccounts: [], recentImports: [], categorizationRules: [] });
  });

  it("throws for a user that does not exist", async () => {
    await expect(fetchContextSnapshot("test-user-assistant-data-fetch-missing", prisma)).rejects.toThrow();
  });
});
