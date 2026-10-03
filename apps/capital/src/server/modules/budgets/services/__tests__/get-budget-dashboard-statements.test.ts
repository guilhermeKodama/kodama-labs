import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { getBudgetDashboard } from "../get-budget-dashboard";

const db = prisma;
const USER_ID = "test-user-dashboard-statements-001";
const EMAIL = "dashboard-statements-test@example.com";

describe("getBudgetDashboard statement purchases", () => {
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
        name: "Dashboard Statements",
        baseCurrency: "BRL",
        timezone: "UTC",
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
    await db.budget.create({
      data: {
        entityType: "personal",
        personalAccountId,
        category: "Shopping",
        amount: 1000,
        currency: "BRL",
        period: "monthly",
        year: 2026,
        month: 10,
        effectiveFrom: new Date("2026-01-01T12:00:00.000Z"),
      },
    });
    const card = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId,
        bankName: "Nubank",
        lastFourDigits: "3333",
        creditLimit: 8000,
        closingDay: 28,
        dueDay: 5,
        currency: "BRL",
      },
    });
    const payment = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 9000,
        currency: "BRL",
        exchangeRate: 1,
        description: "November payment",
        category: "Shopping",
        date: new Date("2026-11-10T12:00:00.000Z"),
      },
    });
    await db.creditCardStatement.create({
      data: {
        creditCardId: card.id,
        month: "2026-10",
        closingDate: new Date("2026-10-28T12:00:00.000Z"),
        billPaymentTransactionId: payment.id,
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
              transactionDate: new Date("2026-10-02T12:00:00.000Z"),
              description: "Market",
              amount: 30,
              currency: "BRL",
            },
          ],
        },
      },
    });
  });

  it("counts the January installment in October base currency and not in January", async () => {
    const october = await getBudgetDashboard(
      USER_ID,
      { year: 2026, month: 10, timezone: "UTC" },
      db
    );
    const shopping = october.budgets.find((budget) => budget.category === "Shopping");
    expect(shopping?.spent).toBe(130);
    expect(october.summary.totalSpent).toBe(130);

    const january = await getBudgetDashboard(
      USER_ID,
      { year: 2026, month: 1, timezone: "UTC" },
      db
    );
    const januaryShopping = january.budgets.find((budget) => budget.category === "Shopping");
    expect(januaryShopping?.spent ?? 0).toBe(0);
    expect(january.summary.totalSpent).toBe(0);
  });
});
