import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { analyzeImport } from "../analyze-import";
import { BANK_FITIDS, BANK_OFX, CARD_CSV } from "./fixtures/import-files";

const claude = vi.hoisted(() => ({
  categorizeBillTransactions: vi.fn(),
  categorizeStatementTransactions: vi.fn(),
}));
vi.mock("@capital/server/lib/claude", () => claude);

/**
 * With no categorizers injected, the analysis uses the Claude helpers, and
 * only when an Anthropic key is configured. They are stubbed here: no call
 * leaves the machine.
 */

const USER = "test-user-analyze-import-ai";
let f: LedgerFixture;

beforeEach(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-real");
  claude.categorizeBillTransactions.mockReset();
  claude.categorizeStatementTransactions.mockReset();
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await deleteLedgerFixture(prisma, USER);
});

describe("analyzeImport with the default categorizers", () => {
  it("calls the statement helper for a bank file, once per direction, with the user's category labels", async () => {
    claude.categorizeStatementTransactions.mockImplementation(async (rows: { index: number }[], _categories: string[], type: string) =>
      rows.map((r) => ({ index: r.index, category: type === "income" ? "Salary" : "Groceries" }))
    );
    const a = await analyzeImport(USER, { files: [{ name: "e.ofx", content: BANK_OFX }], ai: true }, prisma);

    expect(claude.categorizeBillTransactions).not.toHaveBeenCalled();
    expect(claude.categorizeStatementTransactions.mock.calls.map((c) => c[2]).sort()).toEqual(["expense", "income"]);
    const labels = claude.categorizeStatementTransactions.mock.calls[0][4] as Record<string, string>;
    expect(Object.keys(labels).sort()).toEqual(["credit_card", "other_income", "other_system"]);
    const row = Object.fromEntries(a.rows.map((r) => [r.id, r]));
    expect(row[BANK_FITIDS.PETZ]).toMatchObject({ status: "ai", suggestedCategoryId: f.categories.Groceries });
    expect(row[BANK_FITIDS.SALARY]).toMatchObject({ status: "ai", suggestedCategoryId: f.categories.Salary });
    expect(a.ai).toEqual({ requested: true, available: true, used: true });
  });

  it("calls the bill helper for a card bill, once, with the bill prompt's labels", async () => {
    claude.categorizeBillTransactions.mockImplementation(async (rows: { index: number }[]) => rows.map((r) => ({ index: r.index, category: "Software" })));
    const a = await analyzeImport(USER, { files: [{ name: "fatura.csv", content: CARD_CSV }], ai: true }, prisma);

    expect(claude.categorizeStatementTransactions).not.toHaveBeenCalled();
    expect(claude.categorizeBillTransactions).toHaveBeenCalledTimes(1);
    const [rows, categories, fallback, labels] = claude.categorizeBillTransactions.mock.calls[0];
    expect(rows).toHaveLength(3);
    expect(categories).toEqual(expect.arrayContaining(["Groceries", "Software", fallback]));
    expect(Object.keys(labels)).toEqual(expect.arrayContaining(["subscriptions", "groceries", "other_system"]));
    expect(a.rows.every((r) => r.status === "ai" && r.suggestedCategoryId === f.categories.Software)).toBe(true);
  });

  it("does not call them for a file that did not ask", async () => {
    await analyzeImport(USER, { files: [{ name: "fatura.csv", content: CARD_CSV }] }, prisma);
    expect(claude.categorizeBillTransactions).not.toHaveBeenCalled();
    expect(claude.categorizeStatementTransactions).not.toHaveBeenCalled();
  });
});
