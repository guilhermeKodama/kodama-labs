import { PrismaClient, TransactionType } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

// Demo user password (for development only)
const DEMO_PASSWORD = "demo123456";

const DEFAULT_INCOME_CATEGORIES = [
  "Client Payment",
  "Salary",
  "Dividends",
  "Interest",
  "Refund",
  "Other Income",
];

const DEFAULT_EXPENSE_CATEGORIES = [
  "Software & Tools",
  "Hardware",
  "Office",
  "Travel",
  "Marketing",
  "Legal & Accounting",
  "Taxes",
  "Insurance",
  "Utilities",
  "Other Expense",
];

const DEFAULT_INVESTMENT_CATEGORIES = [
  "Stocks",
  "Bonds",
  "Crypto",
  "Real Estate",
  "Savings",
  "Retirement",
  "Other Investment",
];

const DEFAULT_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", manualRate: 1 },
  { code: "EUR", name: "Euro", symbol: "€", manualRate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", manualRate: 0.79 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", manualRate: 4.97 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", manualRate: 149.5 },
];

async function seedDefaultCategoriesForUser(userId: string) {
  const categories = [
    ...DEFAULT_INCOME_CATEGORIES.map((name) => ({
      userId,
      name,
      type: TransactionType.income,
      isDefault: true,
    })),
    ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
      userId,
      name,
      type: TransactionType.expense,
      isDefault: true,
    })),
    ...DEFAULT_INVESTMENT_CATEGORIES.map((name) => ({
      userId,
      name,
      type: TransactionType.investment,
      isDefault: true,
    })),
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: {
        userId_name_type: {
          userId: category.userId,
          name: category.name,
          type: category.type,
        },
      },
      update: {},
      create: category,
    });
  }

  console.log(`Seeded ${categories.length} categories for user ${userId}`);
}

async function seedDefaultCurrenciesForUser(userId: string) {
  for (const currency of DEFAULT_CURRENCIES) {
    await prisma.currency.upsert({
      where: {
        userId_code: {
          userId,
          code: currency.code,
        },
      },
      update: {},
      create: {
        userId,
        ...currency,
      },
    });
  }

  console.log(
    `Seeded ${DEFAULT_CURRENCIES.length} currencies for user ${userId}`
  );
}

async function main() {
  console.log("Starting seed...");

  // Hash the demo password
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // Create a demo user if none exists
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@capital.app" },
    update: {},
    create: {
      email: "demo@capital.app",
      passwordHash,
      name: "Demo User",
      baseCurrency: "USD",
    },
  });

  console.log(`Demo user credentials: demo@capital.app / ${DEMO_PASSWORD}`);

  console.log(`Demo user: ${demoUser.id}`);

  // Seed default categories and currencies for the demo user
  await seedDefaultCategoriesForUser(demoUser.id);
  await seedDefaultCurrenciesForUser(demoUser.id);

  // Create a personal account for the demo user
  await prisma.personalAccount.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      defaultCurrency: "USD",
    },
  });

  console.log("Created personal account for demo user");

  // Create a sample business
  const business = await prisma.business.upsert({
    where: {
      id: "demo-business-1",
    },
    update: {},
    create: {
      id: "demo-business-1",
      userId: demoUser.id,
      name: "My Freelance Business",
      description: "Software development consulting",
      defaultCurrency: "USD",
      color: "#3B82F6",
    },
  });

  console.log(`Created sample business: ${business.name}`);

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
