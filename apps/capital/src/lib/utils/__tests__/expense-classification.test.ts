import { describe, it, expect } from "vitest";
import {
  shouldCountAsExpense,
  filterCountingExpenses,
  sumCountingExpenses,
} from "../expense-classification";

describe("shouldCountAsExpense", () => {
  it("returns false for non-expense transactions", () => {
    expect(shouldCountAsExpense({ type: "income", category: "Salary" })).toBe(false);
    expect(shouldCountAsExpense({ type: "investment", category: "Stocks" })).toBe(false);
  });

  it("returns false for credit card bill payment transactions", () => {
    expect(shouldCountAsExpense({ type: "expense", category: "Credit Card" })).toBe(false);
  });

  it("returns true for normal expense transactions", () => {
    expect(shouldCountAsExpense({ type: "expense", category: "Groceries" })).toBe(true);
    expect(shouldCountAsExpense({ type: "expense", category: "Restaurants & Dining" })).toBe(true);
    expect(shouldCountAsExpense({ type: "expense", category: "Shopping" })).toBe(true);
    expect(shouldCountAsExpense({ type: "expense", category: "Utilities" })).toBe(true);
  });
});

describe("filterCountingExpenses", () => {
  it("filters out non-counting expenses", () => {
    const transactions = [
      { type: "expense" as const, category: "Groceries", amount: 100 },
      { type: "expense" as const, category: "Credit Card", amount: 2000 },
      { type: "income" as const, category: "Salary", amount: 5000 },
      { type: "expense" as const, category: "Shopping", amount: 50 },
    ];

    const result = filterCountingExpenses(transactions);

    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("Groceries");
    expect(result[1].category).toBe("Shopping");
  });
});

describe("sumCountingExpenses", () => {
  it("sums only counting expenses", () => {
    const transactions = [
      { type: "expense" as const, category: "Groceries", amount: 100, exchangeRate: 1 },
      { type: "expense" as const, category: "Credit Card", amount: 2000, exchangeRate: 1 },
      { type: "income" as const, category: "Salary", amount: 5000, exchangeRate: 1 },
      { type: "expense" as const, category: "Shopping", amount: 50, exchangeRate: 1 },
    ];

    const result = sumCountingExpenses(transactions);

    expect(result).toBe(150); // 100 + 50, excludes Credit Card and income
  });

  it("applies exchange rates correctly", () => {
    const transactions = [
      { type: "expense" as const, category: "Groceries", amount: 100, exchangeRate: 5.5 },
      { type: "expense" as const, category: "Credit Card", amount: 1000, exchangeRate: 5.5 },
      { type: "expense" as const, category: "Shopping", amount: 50, exchangeRate: 2 },
    ];

    const result = sumCountingExpenses(transactions);

    expect(result).toBe(650); // (100 * 5.5) + (50 * 2) = 550 + 100 = 650
  });
});
