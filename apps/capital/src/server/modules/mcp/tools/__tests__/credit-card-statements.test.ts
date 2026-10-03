import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import {
  importCreditCardStatement,
  markTransactionAsCardSettlement,
  getCreditCardStatement,
} from "../credit-card-statements";

const db = prisma;
const TEST_USER_ID = "test-user-credit-card-statements-001";

describe("importCreditCardStatement", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;

  beforeEach(async () => {
    // Create test user
    const user = await db.user.create({
      data: {
        email: "test@example.com",
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;

    // Create personal account
    const personalAccount = await db.personalAccount.create({
      data: {
        userId,
        defaultCurrency: "USD",
      },
    });
    personalAccountId = personalAccount.id;

    // Create credit card
    const creditCard = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId,
        bankName: "Nubank",
        lastFourDigits: "1234",
        creditLimit: 10000,
        closingDay: 5,
        dueDay: 15,
        currency: "BRL",
      },
    });
    creditCardId = creditCard.id;
  });

  it("creates a new statement and purchases", async () => {
    const result = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
          closingDate: "2026-09-05",
          dueDate: "2026-09-15",
          total: 450.50,
        },
        rows: [
          {
            date: "2026-08-10",
            description: "Grocery Store",
            amount: 150.25,
            category: "Groceries",
          },
          {
            date: "2026-08-15",
            description: "Restaurant ABC",
            amount: 100.50,
            category: "Restaurants & Dining",
          },
          {
            date: "2026-08-20",
            description: "Online Store XYZ 1/3",
            amount: 199.75,
            category: "Shopping",
            installment: { number: 1, total: 3 },
          },
        ],
      },
      db
    );

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.statementId).toBeDefined();

    // Verify statement was created
    const statement = await db.creditCardStatement.findUnique({
      where: { id: result.statementId },
      include: { purchases: true },
    });

    expect(statement).toBeDefined();
    expect(statement!.month).toBe("2026-09");
    expect(statement!.totalAmount).toBe(450.50);
    expect(statement!.purchases).toHaveLength(3);
  });

  it("deduplicates within the same import", async () => {
    const result = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          {
            date: "2026-08-10",
            description: "Grocery Store",
            amount: 150.25,
            category: "Groceries",
          },
          {
            date: "2026-08-10",
            description: "Grocery Store", // Duplicate
            amount: 150.25,
            category: "Groceries",
          },
          {
            date: "2026-08-15",
            description: "Restaurant",
            amount: 50.00,
            category: "Restaurants & Dining",
          },
        ],
      },
      db
    );

    expect(result.created).toBe(2); // Only 2 created, 1 skipped as duplicate within batch
    expect(result.skipped).toBe(1);
  });

  it("deduplicates against existing purchases on re-import", async () => {
    // First import
    const result1 = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          {
            date: "2026-08-10",
            description: "Grocery Store",
            amount: 150.25,
            category: "Groceries",
          },
          {
            date: "2026-08-15",
            description: "Restaurant",
            amount: 50.00,
            category: "Restaurants & Dining",
          },
        ],
      },
      db
    );

    expect(result1.created).toBe(2);
    expect(result1.skipped).toBe(0);

    // Re-import with same + new rows
    const result2 = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          {
            date: "2026-08-10",
            description: "Grocery Store", // Duplicate from first import
            amount: 150.25,
            category: "Groceries",
          },
          {
            date: "2026-08-20",
            description: "New Purchase",
            amount: 75.00,
            category: "Shopping",
          },
        ],
      },
      db
    );

    expect(result2.created).toBe(1); // Only new purchase
    expect(result2.skipped).toBe(1); // Existing purchase skipped

    // Verify total purchases
    const statement = await db.creditCardStatement.findUnique({
      where: { id: result1.statementId },
      include: { purchases: true },
    });

    expect(statement!.purchases).toHaveLength(3); // 2 from first + 1 from second
  });

  it("handles installment dedupe correctly", async () => {
    const result = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          {
            date: "2026-08-10",
            description: "Store XYZ",
            amount: 100,
            category: "Shopping",
            installment: { number: 1, total: 3 },
          },
          {
            date: "2026-08-10",
            description: "Store XYZ", // Same, but different installment
            amount: 100,
            category: "Shopping",
            installment: { number: 2, total: 3 },
          },
        ],
      },
      db
    );

    // Should create both because installment numbers differ
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
  });
});

describe("markTransactionAsCardSettlement", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;
  let statementId: string;
  let transactionId: string;

  beforeEach(async () => {
    // Clean up
    await db.creditCardStatement.deleteMany({
      where: { creditCard: { OR: [{ business: { userId: TEST_USER_ID } }, { personalAccount: { userId: TEST_USER_ID } }] } },
    });
    await db.creditCard.deleteMany({
      where: { OR: [{ business: { userId: TEST_USER_ID } }, { personalAccount: { userId: TEST_USER_ID } }] },
    });
    await db.transaction.deleteMany({
      where: { OR: [{ business: { userId: TEST_USER_ID } }, { personalAccount: { userId: TEST_USER_ID } }] },
    });
    await db.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });

    // Create test user
    const user = await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "test@example.com",
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;

    // Create personal account
    const personalAccount = await db.personalAccount.create({
      data: {
        userId,
        defaultCurrency: "USD",
      },
    });
    personalAccountId = personalAccount.id;

    // Create credit card
    const creditCard = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId,
        bankName: "Nubank",
        lastFourDigits: "1234",
        creditLimit: 10000,
        closingDay: 5,
        dueDay: 15,
        currency: "BRL",
      },
    });
    creditCardId = creditCard.id;

    // Create statement
    const statement = await db.creditCardStatement.create({
      data: {
        creditCardId,
        month: "2026-09",
        totalAmount: 500,
      },
    });
    statementId = statement.id;

    // Create a transaction (bill payment)
    const transaction = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 500,
        currency: "BRL",
        description: "Nubank bill payment",
        category: "Bank Transfer", // Will be changed to "Credit Card"
        date: new Date("2026-09-15"),
      },
    });
    transactionId = transaction.id;
  });

  it("marks a transaction as card settlement", async () => {
    const result = await markTransactionAsCardSettlement(
      userId,
      { transactionId, statementId },
      db
    );

    expect(result.success).toBe(true);

    // Verify transaction category was updated
    const transaction = await db.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(transaction!.category).toBe("Credit Card");

    // Verify statement link was created
    const statement = await db.creditCardStatement.findUnique({
      where: { id: statementId },
    });
    expect(statement!.billPaymentTransactionId).toBe(transactionId);
  });

  it("prevents linking different transaction to statement that already has one", async () => {
    // Link first transaction
    await markTransactionAsCardSettlement(
      userId,
      { transactionId, statementId },
      db
    );

    // Create another transaction
    const transaction2 = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 500,
        currency: "BRL",
        description: "Another payment",
        category: "Bank Transfer",
        date: new Date("2026-09-16"),
      },
    });

    // Try to link second transaction
    await expect(
      markTransactionAsCardSettlement(
        userId,
        { transactionId: transaction2.id, statementId },
        db
      )
    ).rejects.toThrow("Statement already has a different bill payment transaction linked");
  });
});

describe("getCreditCardStatement", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;
  let statementId: string;

  beforeEach(async () => {
    // Clean up
    await db.creditCardStatement.deleteMany({
      where: { creditCard: { OR: [{ business: { userId: TEST_USER_ID } }, { personalAccount: { userId: TEST_USER_ID } }] } },
    });
    await db.creditCard.deleteMany({
      where: { OR: [{ business: { userId: TEST_USER_ID } }, { personalAccount: { userId: TEST_USER_ID } }] },
    });
    await db.transaction.deleteMany({
      where: { OR: [{ business: { userId: TEST_USER_ID } }, { personalAccount: { userId: TEST_USER_ID } }] },
    });
    await db.personalAccount.deleteMany({ where: { userId: TEST_USER_ID } });
    await db.user.deleteMany({ where: { id: TEST_USER_ID } });

    // Create test user
    const user = await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "test@example.com",
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;

    // Create personal account
    const personalAccount = await db.personalAccount.create({
      data: {
        userId,
        defaultCurrency: "USD",
      },
    });
    personalAccountId = personalAccount.id;

    // Create credit card
    const creditCard = await db.creditCard.create({
      data: {
        entityType: "personal",
        personalAccountId,
        bankName: "Nubank",
        lastFourDigits: "1234",
        creditLimit: 10000,
        closingDay: 5,
        dueDay: 15,
        currency: "BRL",
      },
    });
    creditCardId = creditCard.id;

    // Import a statement
    const result = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
          closingDate: "2026-09-05",
          dueDate: "2026-09-15",
          total: 250.75,
        },
        rows: [
          { date: "2026-08-10", description: "Purchase 1", amount: 100.25, category: "Groceries" },
          { date: "2026-08-15", description: "Purchase 2", amount: 150.50, category: "Shopping" },
        ],
      },
      db
    );
    statementId = result.statementId;
  });

  it("retrieves statement by ID with purchases and reconciliation", async () => {
    const result = await getCreditCardStatement(
      userId,
      { statementId },
      db
    );

    expect(result.statement.id).toBe(statementId);
    expect(result.statement.month).toBe("2026-09");
    expect(result.statement.totalAmount).toBe(250.75);
    expect(result.purchases).toHaveLength(2);
    expect(result.reconciliation.purchasesTotal).toBe(250.75);
    expect(result.reconciliation.paymentAmount).toBeNull();
    expect(result.reconciliation.isReconciled).toBe(false);
  });

  it("retrieves statement by creditCardId and month", async () => {
    const result = await getCreditCardStatement(
      userId,
      { creditCardId, month: "2026-09" },
      db
    );

    expect(result.statement.id).toBe(statementId);
    expect(result.statement.month).toBe("2026-09");
    expect(result.purchases).toHaveLength(2);
  });

  it("includes bill payment and reconciliation when payment is linked", async () => {
    // Create and link a payment transaction
    const transaction = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 250.75,
        currency: "BRL",
        description: "Nubank payment",
        category: "Credit Card",
        date: new Date("2026-09-15"),
      },
    });

    await markTransactionAsCardSettlement(
      userId,
      { transactionId: transaction.id, statementId },
      db
    );

    const result = await getCreditCardStatement(
      userId,
      { statementId },
      db
    );

    expect(result.billPayment).toBeDefined();
    expect(result.billPayment!.amount).toBe(250.75);
    expect(result.reconciliation.paymentAmount).toBe(250.75);
    expect(result.reconciliation.difference).toBe(0);
    expect(result.reconciliation.isReconciled).toBe(true);
  });
});
