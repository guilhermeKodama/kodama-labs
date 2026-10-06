import { PrismaClient, TransactionType } from "../src/generated/prisma";
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

  // The personal entity and a sample business, each with its main checking account.
  const entities = [
    { id: `pf-${demoUser.id}`, kind: "personal" as const, name: "PF", description: null, color: null },
    { id: "demo-business-1", kind: "business" as const, name: "My Freelance Business", description: "Software development consulting", color: "#3B82F6" },
  ];
  for (const e of entities) {
    const existing = await prisma.entity.findFirst({ where: { userId: demoUser.id, kind: e.kind, ...(e.kind === "business" && { id: e.id }) } });
    const entity =
      existing ??
      (await prisma.entity.create({
        data: { id: e.id, userId: demoUser.id, kind: e.kind, name: e.name, description: e.description, color: e.color, defaultCurrency: "USD" },
      }));
    const hasMain = await prisma.account.count({ where: { entityId: entity.id, isDefault: true } });
    if (!hasMain) {
      await prisma.account.create({
        data: { userId: demoUser.id, entityId: entity.id, type: "checking", name: "Conta principal", currency: "USD", isDefault: true },
      });
    }
    console.log(`Entity ready: ${entity.name}`);
  }

  // The built-in "Todas" view.
  await prisma.savedView.upsert({
    where: { userId_builtinKey: { userId: demoUser.id, builtinKey: "all" } },
    update: {},
    create: { userId: demoUser.id, dataset: "ledger", name: "Todas", position: 0, isBuiltin: true, builtinKey: "all", isFavorite: true, config: {} },
  });

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
