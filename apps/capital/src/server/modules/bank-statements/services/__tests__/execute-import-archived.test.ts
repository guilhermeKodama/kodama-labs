import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { executeImport } from "../execute-import";

const USER = "test-user-import-archived";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const plan = (transactions: ImportPlanPayload["transactions"]): ImportPlanPayload => ({
  entityType: "personal",
  entityId: f.pfId,
  currency: "BRL",
  transactions,
  transfers: [],
  investmentTransfers: [],
  creditCards: [],
  bills: [],
  reconciliations: [],
  transferReconciliations: [],
  duplicateDecisions: [],
  investmentTransactions: [],
});

describe("executeImport archived category", () => {
  it("rejects an explicit archived category (a 422 client error) and imports a row with no category", async () => {
    await prisma.category.update({ where: { id: f.categories.Groceries }, data: { isArchived: true } });
    const message = "Category 'Groceries' is archived and cannot be assigned. Unarchive it or choose a visible category. Row: market";
    const failure = await executeImport(USER, plan([{ externalId: "ext-archived", date: "2026-10-12", description: "market", amount: 10, type: "expense", category: "Groceries" }]), prisma).catch((e) => e);
    expect(failure).toBeInstanceOf(LedgerError);
    expect(failure.message).toBe(message);
    expect((failure as LedgerError).status).toBe(422);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.import.count({ where: { userId: USER } })).toBe(0);

    const imported = await executeImport(USER, plan([{ externalId: "ext-open", date: "2026-10-13", description: "pix", amount: 20, type: "expense" }]), prisma);
    expect(imported.imported).toBe(1);
    const row = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, externalId: "ext-open" } });
    expect(row.categoryId).toBeNull();
    expect(row.accountId).toBe(f.pfChecking);
  });
});
