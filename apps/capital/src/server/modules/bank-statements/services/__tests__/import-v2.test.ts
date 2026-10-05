import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { executeImport } from "../execute-import";
import { executeRevert } from "../execute-revert";

const USER = "test-user-import-v2-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const live = (where: object) =>
  prisma.ledgerEntry.findMany({ where: { userId: USER, deletedAt: null, ...where }, orderBy: [{ date: "asc" }, { installmentNumber: "asc" }] });

describe("importCardStatement", () => {
  const rows = [
    { date: "2026-08-10", description: "Mercado", amount: 120 },
    { date: "2026-08-10", description: "Mercado", amount: 120 },
    { date: "2026-08-20", description: "Estorno loja", amount: -30 },
  ];

  it("books charges as card outflows on the statement and treats rows as a multiset", async () => {
    const first = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows }, prisma);
    expect(first).toMatchObject({ created: 3, skipped: 0 });
    const entries = await live({ accountId: f.card });
    expect(entries.map((e) => toNumber(e.amount)).sort()).toEqual([-120, -120, 30].sort());
    expect(new Set(entries.map((e) => e.cardStatementId))).toEqual(new Set([first.statementId]));
    expect(entries.every((e) => e.effectiveDate.toISOString().startsWith("2026-09-05"))).toBe(true);

    const again = await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [...rows, rows[0]] }, prisma);
    expect(again).toMatchObject({ created: 1, skipped: 3 });
  });

  it("categorizes by id, by name, and leaves the rest for the cron", async () => {
    await importCardStatement(
      USER,
      {
        accountId: f.card,
        month: "2026-09",
        rows: [
          { date: "2026-08-11", description: "A", amount: 10, categoryId: f.categories.Software },
          { date: "2026-08-11", description: "B", amount: 10, category: "groceries" },
          { date: "2026-08-11", description: "C", amount: 10 },
        ],
        fallback: "none",
      },
      prisma
    );
    const byDesc = Object.fromEntries((await live({ accountId: f.card })).map((e) => [e.description, e.categoryId]));
    expect(byDesc).toEqual({ A: f.categories.Software, B: f.categories.Groceries, C: null });
  });

  it("links installments to a plan, books the rest as committed, and replaces them when they arrive", async () => {
    await importCardStatement(
      USER,
      { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-15", description: "Notebook", amount: 1000, installment: { number: 1, total: 3 } }] },
      prisma
    );
    const plan = await prisma.installmentPlan.findFirstOrThrow({ where: { accountId: f.card } });
    expect(plan.totalInstallments).toBe(3);
    let entries = await live({ installmentPlanId: plan.id });
    expect(entries.map((e) => e.installmentNumber)).toEqual([1, 2, 3]);
    const projected = entries.filter((e) => (e.metadata as { projected?: boolean } | null)?.projected);
    expect(projected.map((e) => e.installmentNumber)).toEqual([2, 3]);
    const statements = await prisma.cardStatement.findMany({ where: { accountId: f.card }, orderBy: { month: "asc" } });
    expect(statements.map((s) => s.month)).toEqual(["2026-09", "2026-10", "2026-11"]);

    await importCardStatement(
      USER,
      { accountId: f.card, month: "2026-10", rows: [{ date: "2026-08-15", description: "Notebook", amount: 1000, installment: { number: 2, total: 3 } }] },
      prisma
    );
    entries = await live({ installmentPlanId: plan.id });
    expect(entries).toHaveLength(3);
    const second = entries.find((e) => e.installmentNumber === 2)!;
    expect((second.metadata as { projected?: boolean } | null)?.projected).toBeUndefined();
    expect(await prisma.installmentPlan.count({ where: { accountId: f.card } })).toBe(1);
  });

  it("rejects archived categories and non-card accounts", async () => {
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    await expect(
      importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-11", description: "X", amount: 1, categoryId: f.categories.Software }] }, prisma)
    ).rejects.toThrow(/archived/);
    await expect(importCardStatement(USER, { accountId: f.pfChecking, month: "2026-09", rows }, prisma)).rejects.toThrow(/not a credit card/);
  });
});

describe("executeImport / executeRevert", () => {
  const plan = (overrides: Partial<ImportPlanPayload> = {}): ImportPlanPayload =>
    ({
      entityType: "personal",
      entityId: f.pfId,
      bankName: "Nubank",
      fileName: "extrato.ofx",
      currency: "BRL",
      transactions: [
        { externalId: "fit-1", date: "2026-09-02", description: "Salário", amount: 5000, type: "income", category: "Salary" },
        { externalId: "fit-2", date: "2026-09-03", description: "Padaria", amount: 25, type: "expense" },
      ],
      transfers: [
        { externalId: "fit-3", date: "2026-09-04", description: "Pró-labore", amount: 3000, flow: "inflow", direction: "profit_distribution", counterpartyEntityType: "business", counterpartyEntityId: f.pjId },
      ],
      investmentTransfers: [{ externalId: "fit-4", date: "2026-09-05", description: "Aplicação XP", amount: 1000, direction: "investment_deposit", investmentAccountId: f.broker }],
      creditCards: [],
      bills: [],
      reconciliations: [],
      transferReconciliations: [],
      duplicateDecisions: [],
      investmentTransactions: [],
      ...overrides,
    }) as ImportPlanPayload;

  it("writes entries, two-leg transfers and investment transfers tagged with the import", async () => {
    const result = await executeImport(USER, plan(), prisma);
    expect(result).toMatchObject({ imported: 2, transfersCreated: 1, investmentTransfersCreated: 1, duplicatesSkipped: 0 });
    const tagged = await live({ importId: result.statementImportId });
    expect(tagged).toHaveLength(6);
    const salary = tagged.find((e) => e.externalId === "fit-1")!;
    expect(salary.categoryId).toBe(f.categories.Salary);
    const proLabore = await prisma.transferGroup.findFirstOrThrow({ where: { externalId: "fit-3" }, include: { legs: true } });
    expect(proLabore.direction).toBe("profit_distribution");
    expect(proLabore.legs.map((l) => [l.accountId, toNumber(l.amount)]).sort()).toEqual([[f.pfChecking, 3000], [f.pjChecking, -3000]].sort());
    expect(result.createdRecords.filter((r) => r.model === "LedgerEntry")).toHaveLength(2);
    expect(result.createdRecords.filter((r) => r.model === "TransferGroup")).toHaveLength(2);
  });

  it("skips rows already imported (by external id) on a second run", async () => {
    await executeImport(USER, plan(), prisma);
    const second = await executeImport(USER, plan(), prisma);
    expect(second).toMatchObject({ imported: 0, duplicatesSkipped: 2, transfersCreated: 0, investmentTransfersCreated: 0 });
  });

  it("rejects a transfer whose direction contradicts the statement flow", async () => {
    const bad = plan({
      transfers: [{ externalId: "fit-9", date: "2026-09-04", description: "X", amount: 10, flow: "outflow", direction: "profit_distribution", counterpartyEntityType: "business", counterpartyEntityId: f.pjId }],
    } as Partial<ImportPlanPayload>);
    await expect(executeImport(USER, bad, prisma)).rejects.toThrow(/inconsistent/);
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);
  });

  it("revert trashes everything the import created in one undoable batch", async () => {
    const result = await executeImport(USER, plan(), prisma);
    const reverted = await executeRevert(USER, { statementImportId: result.statementImportId, createdRecords: result.createdRecords }, prisma);
    expect(reverted).toMatchObject({ transactionsDeleted: 2, transfersDeleted: 2 });
    expect(await live({})).toHaveLength(0);
    expect((await prisma.import.findUniqueOrThrow({ where: { id: result.statementImportId } })).revertedAt).not.toBeNull();
    await expect(executeRevert(USER, { statementImportId: result.statementImportId, createdRecords: [] }, prisma)).rejects.toThrow(/already reverted/);

    await undoBatch(USER, reverted.batchId!, prisma);
    expect(await live({})).toHaveLength(6);
  });
});
