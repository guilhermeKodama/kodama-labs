import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import type { ToolContext } from "../registry";
import { commitPlan } from "../write/commit-plan";
import { proposeRevertPlan } from "../write/propose-revert-plan";
import { linkBillToTransactionTool } from "../write/link-bill-to-transaction";
import { updateBillTool } from "../write/update-bill";
import { updateBillTransactions } from "../write/update-bill-transactions";
import { recordMerchantCategory } from "../write/record-merchant-category";
import { fundInvestmentAccountTool } from "../write/fund-investment-account";
import { listCreditCardBills } from "../read/list-credit-card-bills";
import { searchBillTransactions } from "../read/search-bill-transactions";
import { searchTransfers } from "../read/search-transfers";
import { listImportBatches } from "../read/list-import-batches";
import { getContextSnapshot } from "../read/get-context-snapshot";

const USER = "test-user-assistant-ledger-tools";
let f: LedgerFixture;
let ctx: ToolContext;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "test" } });
  ctx = { userId: USER, conversationId: conversation.id, db: prisma } as ToolContext;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const run = <T extends { handler: (c: ToolContext, i: never) => Promise<unknown> }>(tool: T, input: Parameters<T["handler"]>[1]) =>
  tool.handler(ctx, input as never) as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function confirmedPlan(kind: "import" | "revert", payload: unknown) {
  return prisma.importPlan.create({
    data: { conversationId: ctx.conversationId, userId: USER, kind, status: "confirmed", confirmedAt: new Date(), payload: payload as object, payloadHash: "x", summary: {} },
  });
}

describe("commit_plan and propose_revert_plan on the ledger", () => {
  it("commits an import, then proposes and commits its revert", async () => {
    const importPlan = await confirmedPlan("import", {
      entityType: "personal",
      entityId: f.pfId,
      currency: "BRL",
      transactions: [{ externalId: "fit-1", date: "2026-09-02", description: "Mercado", amount: 80, type: "expense", category: "Groceries" }],
      investmentTransfers: [{ externalId: "fit-2", date: "2026-09-03", amount: 500, direction: "investment_deposit", investmentAccountId: f.broker }],
    });
    const committed = await run(commitPlan, { planId: importPlan.id });
    expect(committed).toMatchObject({ imported: 1, investmentTransfersCreated: 1, planId: importPlan.id });
    await prisma.agentAction.create({
      data: { userId: USER, conversationId: ctx.conversationId, planId: importPlan.id, toolName: "commit_plan", input: {}, output: committed, status: "success", createdRecords: committed.createdRecords },
    });
    expect((await run(commitPlan, { planId: importPlan.id })).replayed).toBe(true);

    const batches = await run(listImportBatches, { limit: 10 });
    expect(batches.imports[0]).toMatchObject({ id: committed.statementImportId, source: "agent", personalAccountId: f.pfId, revertEligible: true });

    const proposal = await run(proposeRevertPlan, { statementImportId: committed.statementImportId });
    expect(proposal.summary.byModel).toMatchObject({ LedgerEntry: 1, TransferGroup: 1 });
    await prisma.importPlan.update({ where: { id: proposal.planId }, data: { status: "confirmed", confirmedAt: new Date() } });
    const reverted = await run(commitPlan, { planId: proposal.planId });
    expect(reverted).toMatchObject({ transactionsDeleted: 1, transfersDeleted: 1 });
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, deletedAt: null } })).toBe(0);
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: importPlan.id } })).status).toBe("reverted");
  });
});

describe("bill tools on card statements", () => {
  let statementId: string;
  let purchaseId: string;

  beforeEach(async () => {
    const r = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-10", description: "UBER *TRIP", amount: 40 }], fallback: "none" }, prisma);
    statementId = r.statementId;
    purchaseId = r.createdIds[0];
  });

  it("lists statements, recategorizes purchases (learning a rule) and searches them", async () => {
    const { bills } = await run(listCreditCardBills, {});
    expect(bills[0]).toMatchObject({ id: statementId, month: "2026-09", totalAmount: 40, transactionCount: 1, uncategorizedCount: 1, transactionId: null });

    const u = await run(updateBillTransactions, { updates: [{ billTransactionId: purchaseId, category: "Software" }, { billTransactionId: f.pfChecking, category: "Software" }] });
    expect(u).toMatchObject({ updatedCount: 1, failedCount: 1 });
    expect(await prisma.categorizationRule.count({ where: { userId: USER, categoryId: f.categories.Software, matchType: "equals" } })).toBe(1);

    const s = await run(searchBillTransactions, { billId: statementId, limit: 50 });
    expect(s.byCategory).toEqual([{ category: "Software", totalAmount: 40, count: 1 }]);
    expect(s.rows[0]).toMatchObject({ id: purchaseId, amount: 40, billId: statementId });
  });

  it("moves purchases with a corrected closing date", async () => {
    await run(updateBillTool, { billId: statementId, closingDate: "2026-09-07" });
    const p = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(p.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-07");
  });

  it("links an existing payment or books a new one for the statement total", async () => {
    const payment = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 40, date: "2026-09-12", description: "Pgto fatura" }, prisma)).entryIds[0];
    const linked = await run(linkBillToTransactionTool, { action: "link_existing", billId: statementId, transactionId: payment });
    expect(linked.bill.paymentGroupId).toBeTruthy();
    expect((await run(listCreditCardBills, { status: "paid" })).bills.map((b: { id: string }) => b.id)).toEqual([statementId]);

    const oct = await importCardStatement(USER, { accountId: f.card, month: "2026-10", rows: [{ date: "2026-09-10", description: "x", amount: 70 }] }, prisma);
    const created = await run(linkBillToTransactionTool, { action: "create_expense", billId: oct.statementId, entityType: "personal", personalAccountId: f.pfId, currency: "BRL", date: "2026-10-12" });
    expect(created.transaction.amount).toBe(70);
    const transfers = await run(searchTransfers, { limit: 50 });
    expect(transfers.rows.filter((t: { direction: string }) => t.direction === "card_payment")).toHaveLength(2);
  });
});

describe("other write tools", () => {
  it("records merchant rules and moves brokerage cash", async () => {
    const r = await run(recordMerchantCategory, { normalizedDescription: "  IFOOD *Restaurante ", category: "Groceries" });
    expect(r).toMatchObject({ normalizedDescription: "ifood *restaurante", category: "Groceries" });
    await expect(run(recordMerchantCategory, { normalizedDescription: "x", category: "Nope" })).rejects.toThrow(/not found/);

    const moved = await run(fundInvestmentAccountTool, { action: "deposit", accountId: f.broker, amount: 300, currency: "BRL", date: "2026-09-01" });
    expect(moved.transferGroupId).toBeTruthy();
    await expect(run(fundInvestmentAccountTool, { action: "withdraw", accountId: f.broker, amount: 301, currency: "BRL", date: "2026-09-02" })).rejects.toThrow(/Insufficient/);
  });

  it("builds the context snapshot from entities, cards, brokers and rules", async () => {
    const snap = await run(getContextSnapshot, {});
    expect(snap).toMatchObject({ baseCurrency: "BRL", personalAccount: { id: f.pfId }, businesses: [{ id: f.pjId }] });
    expect(snap.creditCards[0]).toMatchObject({ id: f.card, lastFourDigits: "1234", personalAccountId: f.pfId });
    expect(snap.investmentAccounts[0]).toMatchObject({ id: f.broker, name: "XP" });
  });
});
