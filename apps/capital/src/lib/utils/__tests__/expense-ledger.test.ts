import { describe, it, expect } from "vitest";
import type { Currency, Transaction } from "@/types";
import { calculateEntitySummary } from "../calculations";
import {
  buildExpenseLedger,
  statementPurchaseEffectiveDate,
  sumLedgerExpensesByCategory,
} from "../expense-ledger";

const PERSONAL_ID = "personal-1";

const currencies: Currency[] = [
  {
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    manualRate: 0.2,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
];

function tx(overrides: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    entityId: PERSONAL_ID,
    entityType: "personal",
    type: "expense",
    amount: 100,
    currency: "BRL",
    exchangeRate: 1,
    description: "",
    category: "General",
    date: new Date("2026-10-10T12:00:00.000Z"),
    createdAt: new Date("2026-10-10T12:00:00.000Z"),
    updatedAt: new Date("2026-10-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("buildExpenseLedger", () => {
  const regular = tx({
    id: "regular",
    amount: 40,
    category: "Food",
    description: "Groceries",
    date: new Date("2026-10-10T12:00:00.000Z"),
  });
  const payment = tx({
    id: "payment",
    amount: 500,
    category: "Credit Card",
    description: "Card payment",
    date: new Date("2026-11-15T12:00:00.000Z"),
    isCardSettlement: true,
  });

  const ledger = buildExpenseLedger(
    [regular, payment],
    [
      {
        id: "stmt-1",
        month: "2026-10",
        closingDate: "2026-10-28T12:00:00.000Z",
        billPaymentTransactionId: "payment",
        creditCard: { entityId: PERSONAL_ID, entityType: "personal", currency: "BRL" },
        purchases: [
          {
            id: "brl-purchase",
            amount: 80,
            currency: "BRL",
            category: "Shopping",
            description: "Market",
            transactionDate: "2026-10-12T12:00:00.000Z",
          },
          {
            id: "usd-purchase",
            amount: 20,
            currency: "USD",
            category: "Shopping",
            description: "Subscription",
            transactionDate: "2026-10-18T12:00:00.000Z",
          },
        ],
      },
    ],
    "BRL",
    currencies
  );

  it("drops a payment dated the next month and converts a USD purchase into base currency", () => {
    expect(ledger.find((row) => row.id === "payment")).toBeUndefined();
    expect(ledger.find((row) => row.id === "regular")).toBeDefined();

    const usd = ledger.find((row) => row.id === "cc-stmt-usd-purchase");
    expect(usd?.source).toBe("card_statement");
    expect(usd?.currency).toBe("USD");
    expect(usd?.amount).toBe(20);
    expect(usd && usd.amount * usd.exchangeRate).toBe(100);

    const october = sumLedgerExpensesByCategory(ledger, 2026, 10, PERSONAL_ID);
    expect(october.Food).toBe(40);
    expect(october.Shopping).toBe(180);

    const november = sumLedgerExpensesByCategory(ledger, 2026, 11, PERSONAL_ID);
    expect(november.Shopping ?? 0).toBe(0);
    expect(Object.values(november).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it("uses the ledger for expense cards and leaves balance on raw cash", () => {
    const cash = calculateEntitySummary(
      PERSONAL_ID,
      "personal",
      "Personal",
      [regular, payment],
      [],
      "BRL"
    );
    const cards = calculateEntitySummary(
      PERSONAL_ID,
      "personal",
      "Personal",
      [regular, payment],
      [],
      "BRL",
      0,
      ledger
    );

    expect(cards.totalExpenses).toBe(40 + 80 + 100);
    expect(cash.totalExpenses).toBe(40 + 500);
    expect(cards.balance).toBe(cash.balance);
    expect(cards.netWorth).toBe(cash.netWorth);
    expect(cards.balance).toBe(-540);
  });
});

describe("statement month dating", () => {
  it("counts installment 3/10 in the statement month, not the purchase month", () => {
    const effective = statementPurchaseEffectiveDate({
      month: "2026-10",
      closingDate: "2026-10-28",
    });
    expect(effective.getFullYear()).toBe(2026);
    expect(effective.getMonth() + 1).toBe(10);

    const ledger = buildExpenseLedger(
      [],
      [
        {
          id: "stmt-oct",
          month: "2026-10",
          closingDate: "2026-10-28",
          billPaymentTransactionId: null,
          creditCard: { entityId: PERSONAL_ID, entityType: "personal", currency: "BRL" },
          purchases: [
            {
              id: "parc",
              amount: 50,
              currency: "BRL",
              category: "Shopping",
              description: "PARC 3/10",
              transactionDate: "2026-01-15",
            },
          ],
        },
      ],
      "BRL",
      []
    );

    const october = sumLedgerExpensesByCategory(ledger, 2026, 10, PERSONAL_ID);
    const january = sumLedgerExpensesByCategory(ledger, 2026, 1, PERSONAL_ID);
    expect(october.Shopping).toBe(50);
    expect(january.Shopping ?? 0).toBe(0);
  });
});
