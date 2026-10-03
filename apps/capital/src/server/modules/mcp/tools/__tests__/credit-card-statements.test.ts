import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import {
  importCreditCardStatement,
  markTransactionAsCardSettlement,
  unmarkTransactionAsCardSettlement,
  getCreditCardStatement,
} from "../credit-card-statements";
import { shouldCountAsExpense } from "@/lib/utils/expense-classification";

const db = prisma;
const TEST_USER_ID = "test-user-credit-card-statements-001";
const TEST_EMAIL = "mcp-cc-statements-test@example.com";

async function ensureOtherCategory(userId: string) {
  await db.category.create({
    data: {
      userId,
      name: "Other",
      type: "expense",
      isSystem: true,
      isDefault: true,
    },
  });
}

async function deleteStatementTestUsers() {
  const users = await db.user.findMany({
    where: { OR: [{ email: TEST_EMAIL }, { id: TEST_USER_ID }] },
    select: { id: true },
  });
  for (const user of users) {
    await db.personalAccount.deleteMany({ where: { userId: user.id } });
    await db.business.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}

describe("importCreditCardStatement", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;

  beforeEach(async () => {
    await deleteStatementTestUsers();
    const user = await db.user.create({
      data: {
        email: TEST_EMAIL,
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;
    await ensureOtherCategory(userId);

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

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
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

  it("keeps identical rows up to the incoming count", async () => {
    const first = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: { month: "2026-09" },
        rows: [
          { date: "2026-08-10", description: "Uber", amount: 25, category: "Transport" },
          { date: "2026-08-10", description: "Uber", amount: 25, category: "Transport" },
        ],
      },
      db
    );
    expect(first.created).toBe(2);
    expect(first.createdIds).toHaveLength(2);

    const again = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: { month: "2026-09" },
        rows: [
          { date: "2026-08-10", description: "Uber", amount: 25, category: "Transport" },
          { date: "2026-08-10", description: "Uber", amount: 25, category: "Transport" },
        ],
      },
      db
    );
    expect(again.created).toBe(0);
    expect(again.createdIds).toEqual([]);

    const third = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: { month: "2026-09" },
        rows: [
          { date: "2026-08-10", description: "Uber", amount: 25 },
          { date: "2026-08-10", description: "Uber", amount: 25 },
          { date: "2026-08-10", description: "Uber", amount: 25 },
        ],
      },
      db
    );
    expect(third.created).toBe(1);
    expect(third.createdIds).toHaveLength(1);

    const purchases = await db.billTransaction.findMany({
      where: { statementId: first.statementId },
    });
    expect(purchases).toHaveLength(3);
    expect(purchases.map((purchase) => purchase.id)).toEqual(
      expect.arrayContaining([...first.createdIds, ...third.createdIds])
    );
  });

  it("imports one copy when two concurrent calls share a payload", async () => {
    const payload = {
      creditCardId,
      statement: { month: "2026-09" },
      rows: [
        { date: "2026-08-11", description: "Coffee", amount: 12, category: "Food" },
      ],
    };
    const [a, b] = await Promise.all([
      importCreditCardStatement(userId, payload, db),
      importCreditCardStatement(userId, payload, db),
    ]);
    expect(a.created + b.created).toBe(1);
    const purchases = await db.billTransaction.findMany({
      where: { statementId: a.statementId },
    });
    expect(purchases).toHaveLength(1);
  });

  it("matches category names case-insensitively and falls back to Other", async () => {
    await db.category.create({
      data: { userId, name: "Groceries", type: "expense" },
    });
    const result = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: { month: "2026-09" },
        rows: [
          { date: "2026-08-10", description: "Market", amount: 10, category: "groceries" },
          { date: "2026-08-11", description: "Mystery", amount: 5, category: "Not A Category" },
        ],
      },
      db
    );
    const purchases = await db.billTransaction.findMany({
      where: { id: { in: result.createdIds } },
    });
    const byDescription = Object.fromEntries(purchases.map((purchase) => [purchase.description, purchase.category]));
    expect(byDescription.Market).toBe("Groceries");
    expect(byDescription.Mystery).toBe("Other");
  });
});

describe("markTransactionAsCardSettlement", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;
  let statementId: string;
  let transactionId: string;

  beforeEach(async () => {
    await deleteStatementTestUsers();
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
        email: TEST_EMAIL,
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;
    await ensureOtherCategory(userId);

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

    const transaction = await db.transaction.findUnique({
      where: { id: transactionId },
    });
    expect(transaction!.category).toBe("Bank Transfer");

    // Verify statement link was created
    const statement = await db.creditCardStatement.findUnique({
      where: { id: statementId },
    });
    expect(statement!.billPaymentTransactionId).toBe(transactionId);
  });

  it("unmark clears the link so the payment counts as an expense again", async () => {
    await markTransactionAsCardSettlement(userId, { transactionId, statementId }, db);
    const unmarked = await unmarkTransactionAsCardSettlement(userId, { transactionId }, db);
    expect(unmarked.success).toBe(true);

    const statement = await db.creditCardStatement.findUnique({ where: { id: statementId } });
    expect(statement!.billPaymentTransactionId).toBeNull();

    const transaction = await db.transaction.findUnique({ where: { id: transactionId } });
    expect(transaction!.category).toBe("Bank Transfer");
    expect(shouldCountAsExpense(transaction!, false)).toBe(true);
  });

  it("rejects a non-expense transaction", async () => {
    await db.transaction.update({
      where: { id: transactionId },
      data: { type: "income" },
    });
    await expect(
      markTransactionAsCardSettlement(userId, { transactionId, statementId }, db)
    ).rejects.toThrow("Only an expense transaction can be marked as a card settlement");
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

describe("expense classification integration", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;

  beforeEach(async () => {
    await deleteStatementTestUsers();
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
        email: TEST_EMAIL,
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;
    await ensureOtherCategory(userId);

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

  it("month with imported statement + linked payment: payment excluded, purchases included, total = purchases", async () => {
    // Import a statement with purchases
    const importResult = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
          closingDate: "2026-09-05",
          dueDate: "2026-09-15",
          total: 300.0,
        },
        rows: [
          { date: "2026-08-10", description: "Grocery Store", amount: 100.0, category: "Groceries" },
          { date: "2026-08-15", description: "Restaurant", amount: 200.0, category: "Restaurants & Dining" },
        ],
      },
      db
    );

    // Create a bill payment transaction
    const paymentTx = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 300.0,
        currency: "BRL",
        description: "Nubank bill payment",
        category: "Credit Card",
        date: new Date("2026-09-15T12:00:00Z"),
      },
    });

    // Link it as a settlement
    await markTransactionAsCardSettlement(
      userId,
      { transactionId: paymentTx.id, statementId: importResult.statementId },
      db
    );

    // Fetch statement to verify purchases
    const statement = await db.creditCardStatement.findUnique({
      where: { id: importResult.statementId },
      include: { purchases: true },
    });

    expect(statement!.purchases).toHaveLength(2);
    expect(statement!.billPaymentTransactionId).toBe(paymentTx.id);

    // Calculate total expenses using the same logic as get-summary.ts
    const statements = await db.creditCardStatement.findMany({
      where: {
        creditCard: {
          personalAccountId,
        },
      },
      select: { billPaymentTransactionId: true },
    });

    const settlementIds = new Set<string>();
    for (const stmt of statements) {
      if (stmt.billPaymentTransactionId) {
        settlementIds.add(stmt.billPaymentTransactionId);
      }
    }

    // Get all transactions
    const transactions = await db.transaction.findMany({
      where: { personalAccountId },
    });

    // Get statement purchases
    const purchases = await db.billTransaction.findMany({
      where: {
        statementId: importResult.statementId,
      },
    });

    // Regular expenses (excluding settlements)
    const regularExpenses = transactions
      .filter((t) => t.type === "expense" && !settlementIds.has(t.id))
      .reduce((sum, t) => sum + t.amount, 0);

    // Statement purchases
    const statementExpenses = purchases.reduce((sum, p) => sum + p.amount, 0);

    const totalExpenses = regularExpenses + statementExpenses;

    // Total should be 300 (sum of purchases), payment should be excluded
    expect(totalExpenses).toBe(300.0);
    expect(settlementIds.has(paymentTx.id)).toBe(true);
  });

  it("month with credit card payment and no statement: totals unchanged vs main", async () => {
    // Create a bill payment transaction WITHOUT linking it to a statement
    const paymentTx = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 500.0,
        currency: "BRL",
        description: "Nubank bill payment (no statement)",
        category: "Credit Card",
        date: new Date("2026-09-15T12:00:00Z"),
      },
    });

    // Fetch all statements (should be none)
    const statements = await db.creditCardStatement.findMany({
      where: {
        creditCard: {
          personalAccountId,
        },
      },
      select: { billPaymentTransactionId: true },
    });

    expect(statements).toHaveLength(0);

    // Calculate settlement IDs (should be empty)
    const settlementIds = new Set<string>();
    for (const stmt of statements) {
      if (stmt.billPaymentTransactionId) {
        settlementIds.add(stmt.billPaymentTransactionId);
      }
    }

    // Get all transactions
    const transactions = await db.transaction.findMany({
      where: { personalAccountId },
    });

    // Regular expenses (excluding settlements)
    const regularExpenses = transactions
      .filter((t) => t.type === "expense" && !settlementIds.has(t.id))
      .reduce((sum, t) => sum + t.amount, 0);

    // Total should be 500 (payment still counts as expense because it's not a settlement)
    expect(regularExpenses).toBe(500.0);
    expect(settlementIds.has(paymentTx.id)).toBe(false);
  });

  it("no double counting with legacy bills", async () => {
    // Create a legacy credit card bill
    const bill = await db.creditCardBill.create({
      data: {
        creditCardId,
        closingDate: new Date("2026-09-05"),
        dueDate: new Date("2026-09-15"),
        totalAmount: 200.0,
        status: "paid",
      },
    });

    // Add bill transactions (legacy)
    await db.billTransaction.create({
      data: {
        billId: bill.id,
        category: "Groceries",
        transactionDate: new Date("2026-08-10"),
        description: "Grocery Store",
        amount: 100.0,
        currency: "BRL",
      },
    });

    await db.billTransaction.create({
      data: {
        billId: bill.id,
        category: "Shopping",
        transactionDate: new Date("2026-08-15"),
        description: "Store",
        amount: 100.0,
        currency: "BRL",
      },
    });

    // Import a NEW statement for the same card/month (should not duplicate)
    const importResult = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          { date: "2026-08-20", description: "Restaurant", amount: 150.0, category: "Restaurants & Dining" },
        ],
      },
      db
    );

    // Get all purchases
    const allPurchases = await db.billTransaction.findMany({
      where: {
        OR: [
          { billId: bill.id },
          { statementId: importResult.statementId },
        ],
      },
    });

    // Should have 3 purchases total (2 legacy + 1 new)
    expect(allPurchases).toHaveLength(3);

    // Calculate total from legacy bills
    const legacyTotal = allPurchases
      .filter((p) => p.billId === bill.id)
      .reduce((sum, p) => sum + p.amount, 0);

    // Calculate total from statements
    const statementTotal = allPurchases
      .filter((p) => p.statementId === importResult.statementId)
      .reduce((sum, p) => sum + p.amount, 0);

    // Totals should be separate
    expect(legacyTotal).toBe(200.0);
    expect(statementTotal).toBe(150.0);
  });

  it("USD/BRL conversion of purchases", async () => {
    // Import statement with mixed currencies
    const importResult = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          { date: "2026-08-10", description: "Local Store", amount: 100.0, currency: "BRL", category: "Shopping" },
          { date: "2026-08-15", description: "International Store", amount: 50.0, currency: "USD", category: "Shopping" },
        ],
      },
      db
    );

    // Get purchases
    const purchases = await db.billTransaction.findMany({
      where: { statementId: importResult.statementId },
    });

    expect(purchases).toHaveLength(2);
    
    // Check currencies are stored correctly
    const brlPurchase = purchases.find((p) => p.description === "Local Store");
    const usdPurchase = purchases.find((p) => p.description === "International Store");

    expect(brlPurchase!.currency).toBe("BRL");
    expect(brlPurchase!.amount).toBe(100.0);
    
    expect(usdPurchase!.currency).toBe("USD");
    expect(usdPurchase!.amount).toBe(50.0);
  });

  it("aggregates USD purchase converted to BRL total", async () => {
    // Setup: User's personal account is USD, card is BRL
    // Add BRL currency with rate (1 USD = 5.0 BRL, so 1 BRL = 0.2 USD)
    await db.currency.create({
      data: {
        userId,
        code: "BRL",
        name: "Brazilian Real",
        symbol: "R$",
        manualRate: 5.0, // 1 USD = 5 BRL
        updatedAt: new Date(),
      },
    });

    // Import statement with USD purchase (card is BRL)
    const importResult = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: {
          month: "2026-09",
        },
        rows: [
          { date: "2026-08-10", description: "BRL Store", amount: 500.0, currency: "BRL", category: "Shopping" },
          { date: "2026-08-15", description: "USD Store", amount: 50.0, currency: "USD", category: "Shopping" },
        ],
      },
      db
    );

    // Fetch statement purchases with card info
    const purchases = await db.billTransaction.findMany({
      where: { statementId: importResult.statementId },
      include: {
        statement: {
          include: {
            creditCard: {
              select: {
                personalAccountId: true,
                currency: true,
              },
            },
          },
        },
      },
    });

    // Fetch currencies for conversion
    const currencies = await db.currency.findMany({ where: { userId } });

    // Aggregate purchases converted to USD (personal account base currency)
    const baseCurrency = "USD"; // Personal account default
    let total = 0;
    for (const p of purchases) {
      const purchaseCurrency = p.currency || p.statement!.creditCard.currency;
      // Convert to USD using convertToBaseCurrency logic
      let convertedAmount = p.amount;
      if (purchaseCurrency !== baseCurrency) {
        const curr = currencies.find((c) => c.code === purchaseCurrency);
        if (curr && curr.manualRate > 0) {
          convertedAmount = p.amount / curr.manualRate; // amount in BRL / 5.0 = amount in USD
        }
      }
      total += convertedAmount;
    }

    // Total should be: 500 BRL / 5.0 + 50 USD = 100 USD + 50 USD = 150 USD
    expect(Math.round(total * 100) / 100).toBe(150.0);
  });
});

describe("getCreditCardStatement", () => {
  let userId: string;
  let personalAccountId: string;
  let creditCardId: string;
  let statementId: string;

  beforeEach(async () => {
    await deleteStatementTestUsers();
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
        email: TEST_EMAIL,
        passwordHash: "hash",
        name: "Test User",
      },
    });
    userId = user.id;
    await ensureOtherCategory(userId);

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

  it("reconciles mixed currencies in the user base and keeps the purchase date", async () => {
    await db.user.update({
      where: { id: userId },
      data: { baseCurrency: "USD" },
    });
    await db.currency.create({
      data: {
        userId,
        code: "BRL",
        name: "Brazilian Real",
        symbol: "R$",
        manualRate: 5,
      },
    });

    const imported = await importCreditCardStatement(
      userId,
      {
        creditCardId,
        statement: { month: "2026-10", closingDate: "2026-10-28" },
        rows: [
          {
            date: "2026-01-15",
            description: "PARC 3/10",
            amount: 500,
            currency: "BRL",
            installment: { number: 3, total: 10 },
          },
        ],
      },
      db
    );
    const payment = await db.transaction.create({
      data: {
        entityType: "personal",
        personalAccountId,
        type: "expense",
        amount: 100,
        currency: "USD",
        exchangeRate: 1,
        description: "Card payment",
        category: "Bank Transfer",
        date: new Date("2026-11-05T12:00:00.000Z"),
      },
    });
    await markTransactionAsCardSettlement(
      userId,
      { transactionId: payment.id, statementId: imported.statementId },
      db
    );

    const result = await getCreditCardStatement(userId, { statementId: imported.statementId }, db);
    expect(result.purchases[0].date.startsWith("2026-01-15")).toBe(true);
    expect(result.reconciliation.currency).toBe("USD");
    expect(result.reconciliation.purchasesTotal).toBe(100);
    expect(result.reconciliation.paymentAmount).toBe(100);
    expect(result.reconciliation.isReconciled).toBe(true);
  });
});
