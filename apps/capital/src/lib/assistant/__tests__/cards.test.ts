import { describe, expect, it } from "vitest";
import { allPairsDecided, planResultView, planSummaryView } from "../cards";
import { KNOWN_TOOLS, toolLabelKey } from "../tools";

describe("planSummaryView", () => {
  it("shows new rows, the counts that are not zero and the totals", () => {
    const view = planSummaryView("import", {
      newTransactionCount: 12,
      skipDuplicateCount: 3,
      linkFuzzyCount: 0,
      reconciliationCount: 1,
      transferReconciliationCount: 1,
      transferCount: 2,
      transferOutflow: 500,
      transferInflow: 0,
      totalIncome: 100,
      totalExpense: 1234.56,
      currency: "BRL",
      ledgerBalance: 999,
    });
    expect(view.counts).toEqual([
      { key: "new", count: 12 },
      { key: "duplicates", count: 3 },
      { key: "reconciled", count: 2 },
      { key: "transfers", count: 2 },
    ]);
    expect(view.money).toEqual([
      { key: "income", amount: 100 },
      { key: "expense", amount: 1234.56 },
      { key: "transfersOut", amount: 500 },
    ]);
    expect(view.currency).toBe("BRL");
    expect(view.balanceMatches).toBe(true);
  });

  it("leads a bill-only plan with the bill", () => {
    const view = planSummaryView("import", { newTransactionCount: 0, billCount: 1, billTotalPreviewAmount: 2500, totalIncome: 0, totalExpense: 0 });
    expect(view.counts).toEqual([{ key: "bills", count: 1 }]);
    expect(view.money).toEqual([{ key: "billsTotal", amount: 2500 }]);
    expect(view.balanceMatches).toBe(false);
  });

  it("a revert plan counts what it removes", () => {
    expect(planSummaryView("revert", { recordsToDelete: 7 }).counts).toEqual([{ key: "recordsToDelete", count: 7 }]);
  });

  it("survives a missing summary", () => {
    expect(planSummaryView("import", {}).counts).toEqual([{ key: "new", count: 0 }]);
  });
});

describe("planResultView", () => {
  it("an import: counts, batch and import id", () => {
    expect(planResultView({ imported: 10, duplicatesSkipped: 2, reconciled: 0, transfersCreated: 1, statementImportId: "imp1", batchId: "b1" })).toEqual({
      kind: "import",
      counts: [
        { key: "imported", count: 10 },
        { key: "duplicatesSkipped", count: 2 },
        { key: "transfersCreated", count: 1 },
      ],
      batchId: "b1",
      importId: "imp1",
    });
  });

  it("a revert", () => {
    expect(planResultView({ transactionsDeleted: 4, batchId: null })).toEqual({ kind: "revert", counts: [{ key: "deleted", count: 4 }], batchId: null, importId: null });
  });
});

describe("allPairsDecided", () => {
  it("needs an answer for every pair", () => {
    expect(allPairsDecided(["a", "b"], { a: "merge" })).toBe(false);
    expect(allPairsDecided(["a", "b"], { a: "merge", b: "skip" })).toBe(true);
    expect(allPairsDecided([], {})).toBe(false);
  });
});

describe("toolLabelKey", () => {
  it("knows the agent's tools and leaves new ones to the server label", () => {
    expect(toolLabelKey("search_transactions")).toBe("search_transactions");
    expect(toolLabelKey("web_search")).toBe("web_search");
    expect(toolLabelKey("brand_new_tool")).toBeNull();
    expect(new Set(KNOWN_TOOLS).size).toBe(KNOWN_TOOLS.length);
  });
});

describe("importRowsHref", () => {
  it("opens Transações filtered by the import, every date", async () => {
    const { importRowsHref } = await import("../cards");
    const { decodeViewDraft } = await import("@/lib/ledger/view-draft");
    const href = importRowsHref("imp_1");
    const draft = decodeViewDraft(new URL(href, "http://local").searchParams.get("draft"));
    expect(href.startsWith("/transactions?")).toBe(true);
    expect(draft).toMatchObject({ filters: [{ field: "importId", op: "in", values: ["imp_1"] }], period: { preset: "all", offset: 0 } });
  });
});

describe("isWriteTool", () => {
  it("knows the tools that change data", async () => {
    const { isWriteTool } = await import("../tools");
    expect(isWriteTool("commit_plan")).toBe(true);
    expect(isWriteTool("update_transactions")).toBe(true);
    expect(isWriteTool("search_transactions")).toBe(false);
    expect(isWriteTool("propose_import_plan")).toBe(false);
  });
});
