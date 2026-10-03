import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { listTransactions } from "../list-transactions";

const db = prisma;
const USER_ID = "test-user-list-tx-statements-001";
const EMAIL = "list-tx-statements-test@example.com";

describe("listTransactions statement purchases", () => {
  let personalAccountId: string;

  beforeEach(async () => {
    const existing = await db.user.findMany({
      where: { OR: [{ id: USER_ID }, { email: EMAIL }] },
      select: { id: true },
    });
    for (const user of existing) {
      await db.personalAccount.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }

    await db.user.create({
      data: {
        id: USER_ID,
        email: EMAIL,
        passwordHash: "hash",
        name: "List Transactions",
        baseCurrency: "BRL",
      },
    });
    const account = await db.personalAccount.create({
      data: { userId: USER_ID, defaultCurrency: "USD" },
    });
    personalAccountId = account.id;
    await db.currency.create({
      data: {
        userId: USER_ID,
        code: "USD",
        name: "US Dollar",
        symbol: "$",
        manualRate: 0.2,
      },
    });
    await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 1000,
        currency: "USD",
        exchangeRate: 5.5,
        description: "Stored rate expense",
        category: "Shopping",
        date: new Date("2026-10-15T12:00:00.000Z"),
      },
    });
    const card = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId,
        bankName: "Nubank",
        lastFourDigits: "4444",
        creditLimit: 8000,
        closingDay: 28,
        dueDay: 5,
        currency: "BRL",
      },
    });
    await db.creditCardStatement.create({
      data: {
        creditCardId: card.id,
        month: "2026-10",
        closingDate: new Date("2026-10-28T12:00:00.000Z"),
        purchases: {
          create: [
            {
              category: "Shopping",
              transactionDate: new Date("2026-01-15T12:00:00.000Z"),
              description: "PARC 3/10",
              amount: 20,
              currency: "USD",
              installmentNumber: 3,
              totalInstallments: 10,
            },
            {
              category: "Shopping",
              transactionDate: new Date("2026-10-03T12:00:00.000Z"),
              description: "Market",
              amount: 80,
              currency: "BRL",
            },
          ],
        },
      },
    });
  });

  it("summarizes October in base currency, including a January-dated installment", async () => {
    const october = await listTransactions(
      USER_ID,
      { dateFrom: "2026-10-01", dateTo: "2026-10-31", type: "expense" },
      db
    );
    const shopping = october.summaries.find((row) => row.category === "Shopping");
    expect(shopping?.currency).toBe("BRL");
    expect(shopping?.total).toBe(5500 + 100 + 80);
    expect(october.transactions[0].amount).toBe(1000);
    expect(october.transactions[0].currency).toBe("USD");

    const january = await listTransactions(
      USER_ID,
      { dateFrom: "2026-01-01", dateTo: "2026-01-31", type: "expense" },
      db
    );
    expect(january.summaries.find((row) => row.category === "Shopping")).toBeUndefined();
  });
});
