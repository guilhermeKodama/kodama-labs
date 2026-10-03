import { describe, it, expect } from "vitest";
import {
  shouldCountAsExpense,
  buildSettlementSet,
  filterCountingExpenses,
  sumCountingExpenses,
} from "../expense-classification";

describe("shouldCountAsExpense", () => {
  it("returns false for non-expense transactions", () => {
    expect(shouldCountAsExpense({ type: "income" }, false)).toBe(false);
    expect(shouldCountAsExpense({ type: "investment" }, false)).toBe(false);
  });

  it("returns false for settlement transactions", () => {
    expect(shouldCountAsExpense({ type: "expense" }, true)).toBe(false);
  });

  it("returns true for normal expense transactions", () => {
    expect(shouldCountAsExpense({ type: "expense" }, false)).toBe(true);
  });

  it("returns true for credit card category transactions that are not settlements", () => {
    // A transaction with category "Credit Card" but not linked as a settlement should still count
    expect(shouldCountAsExpense({ type: "expense" }, false)).toBe(true);
  });
});

describe("buildSettlementSet", () => {
  it("builds a set of settlement transaction IDs", () => {
    const statements = [
      { billPaymentTransactionId: "tx1" },
      { billPaymentTransactionId: "tx2" },
      { billPaymentTransactionId: null },
      { billPaymentTransactionId: "tx3" },
    ];

    const result = buildSettlementSet(statements);

    expect(result.size).toBe(3);
    expect(result.has("tx1")).toBe(true);
    expect(result.has("tx2")).toBe(true);
    expect(result.has("tx3")).toBe(true);
  });
});

describe("filterCountingExpenses", () => {
  it("filters out settlement expenses", () => {
    const transactions = [
      { id: "1", type: "expense" as const, category: "Groceries", amount: 100 },
      { id: "2", type: "expense" as const, category: "Credit Card", amount: 2000 }, // Settlement
      { id: "3", type: "income" as const, category: "Salary", amount: 5000 },
      { id: "4", type: "expense" as const, category: "Shopping", amount: 50 },
    ];

    const settlementIds = new Set(["2"]);
    const result = filterCountingExpenses(transactions, settlementIds);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[1].id).toBe("4");
  });

  it("includes credit card category transactions that are not settlements", () => {
    const transactions = [
      { id: "1", type: "expense" as const, category: "Credit Card", amount: 100 },
      { id: "2", type: "expense" as const, category: "Groceries", amount: 50 },
    ];

    const settlementIds = new Set<string>(); // No settlements
    const result = filterCountingExpenses(transactions, settlementIds);

    expect(result).toHaveLength(2);
  });
});

describe("sumCountingExpenses", () => {
  it("sums only counting expenses (excluding settlements)", () => {
    const transactions = [
      { id: "1", type: "expense" as const, category: "Groceries", amount: 100, exchangeRate: 1 },
      { id: "2", type: "expense" as const, category: "Credit Card", amount: 2000, exchangeRate: 1 }, // Settlement
      { id: "3", type: "income" as const, category: "Salary", amount: 5000, exchangeRate: 1 },
      { id: "4", type: "expense" as const, category: "Shopping", amount: 50, exchangeRate: 1 },
    ];

    const settlementIds = new Set(["2"]);
    const result = sumCountingExpenses(transactions, settlementIds);

    expect(result).toBe(150); // 100 + 50, excludes settlement and income
  });

  it("applies exchange rates correctly", () => {
    const transactions = [
      { id: "1", type: "expense" as const, category: "Groceries", amount: 100, exchangeRate: 5.5 },
      { id: "2", type: "expense" as const, category: "Credit Card", amount: 1000, exchangeRate: 5.5 }, // Settlement
      { id: "3", type: "expense" as const, category: "Shopping", amount: 50, exchangeRate: 2 },
    ];

    const settlementIds = new Set(["2"]);
    const result = sumCountingExpenses(transactions, settlementIds);

    expect(result).toBe(650); // (100 * 5.5) + (50 * 2) = 550 + 100 = 650
  });

  it("includes credit card payments when not marked as settlements", () => {
    const transactions = [
      { id: "1", type: "expense" as const, category: "Credit Card", amount: 100, exchangeRate: 1 },
      { id: "2", type: "expense" as const, category: "Groceries", amount: 50, exchangeRate: 1 },
    ];

    const settlementIds = new Set<string>(); // No settlements
    const result = sumCountingExpenses(transactions, settlementIds);

    expect(result).toBe(150); // Both count
  });
});
