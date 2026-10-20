import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding, recordOperation } from "../../../investments/services/portfolio";
import { convertIncomeToDividend, recordDividend } from "../../../investments/services/dividends";
import { findOrphanTransactions } from "../../lib/category-validation";
import { bulkUpdateTransactions } from "../bulk-update-transactions";
import { listTransactions } from "../list-transactions";
import { updateTransactionTool } from "../manage-transactions";

const USER = "test-user-mcp-operation-id-001";
const OTHER = "test-user-mcp-operation-id-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("operationId on MCP entries", () => {
  it("is set on a cash leg and on funding legs, and null on every other entry", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    const buy = await recordOperation(
      USER,
      { holdingId: h.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-08-01", fundFromAccountId: f.pfChecking },
      prisma,
    );
    const dividend = await recordDividend(
      USER,
      { holdingId: h.id, cashAccountId: f.pfChecking, amount: 12, date: "2026-08-10", currency: "BRL", incomeType: "dividend" },
      prisma,
    );
    const incomeId = (await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 40, date: "2026-08-11", description: "PETR4 rendimento" }, prisma)).entryIds[0];
    const linked = await convertIncomeToDividend(USER, { transactionId: incomeId, holdingId: h.id, incomeType: "dividend" }, prisma);
    const salary = (await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 1000, date: "2026-08-12", description: "Salário" }, prisma)).entryIds[0];

    const listed = await listTransactions(USER, { dateFrom: "2026-08-01", dateTo: "2026-08-31" }, prisma);
    const byId = new Map(listed.transactions.map((row) => [row.id, row]));

    expect(byId.get(dividend.cashEntryId!)?.operationId).toBe(dividend.operationId);
    expect(byId.get(incomeId)?.operationId).toBe(linked.operationId);
    expect(byId.get(buy.cashEntryId!)?.operationId).toBe(buy.operation.id);
    expect(byId.get(salary)?.operationId).toBeNull();

    const funding = listed.transactions.filter((row) => row.transferGroupId === buy.fundingGroupId);
    expect(funding).toHaveLength(2);
    expect(funding.every((row) => row.operationId === buy.operation.id)).toBe(true);
    const linkedIds = new Set([dividend.cashEntryId!, incomeId, buy.cashEntryId!]);
    expect(
      listed.transactions
        .filter((row) => row.transferGroupId !== buy.fundingGroupId && !linkedIds.has(row.id))
        .every((row) => row.operationId === null),
    ).toBe(true);

    expect((await listTransactions(OTHER, { dateFrom: "2026-08-01", dateTo: "2026-08-31" }, prisma)).transactions).toEqual([]);

    const investments = await listTransactions(USER, { dateFrom: "2026-08-01", dateTo: "2026-08-31", type: "investment" }, prisma);
    expect(investments.transactions.map((row) => row.id).sort()).toEqual([buy.cashEntryId!, dividend.cashEntryId!].sort());
    expect(investments.transactions.every((row) => row.operationId)).toBe(true);

    expect(await updateTransactionTool(USER, { id: salary, description: "Salário de agosto" }, prisma)).toMatchObject({
      id: salary,
      operationId: null,
    });
    expect(await updateTransactionTool(USER, { id: dividend.cashEntryId!, description: "Dividendo PETR4" }, prisma)).toMatchObject({
      operationId: dividend.operationId,
    });

    const orphans = await findOrphanTransactions(USER, prisma);
    expect(orphans.transactions.find((row) => row.id === salary)?.operationId).toBeNull();
    expect(orphans.transactions.find((row) => row.id === incomeId)?.operationId).toBe(linked.operationId);

    const preview = await bulkUpdateTransactions(USER, [{ id: dividend.cashEntryId!, description: "Dividendo PETR4" }], true, prisma);
    expect(preview.updated[0]?.operationId).toBe(dividend.operationId);
    const written = await bulkUpdateTransactions(USER, [{ id: salary, description: "Salário" }], false, prisma);
    expect(written.updated[0]?.operationId).toBeNull();
  });
});
