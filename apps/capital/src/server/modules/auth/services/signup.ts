import type { PrismaClient } from "@/generated/prisma";
import { hashPassword } from "./password";

interface SignupInput {
  email: string;
  password: string;
  name: string;
  baseCurrency?: string;
}

const DEFAULT_INCOME_CATEGORIES = [
  { name: "Client Payment", systemKey: "client_payment" },
  { name: "Salary", systemKey: "salary" },
  { name: "Dividends", systemKey: "dividends" },
  { name: "Interest", systemKey: "interest" },
  { name: "Refund", systemKey: "refund" },
  { name: "Other Income", systemKey: "other_income" },
];

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Software & Tools", systemKey: "software_tools" },
  { name: "Hardware", systemKey: "hardware" },
  { name: "Office", systemKey: "office" },
  { name: "Travel", systemKey: "travel_default" },
  { name: "Marketing", systemKey: "marketing" },
  { name: "Legal & Accounting", systemKey: "legal_accounting" },
  { name: "Taxes", systemKey: "taxes" },
  { name: "Insurance", systemKey: "insurance" },
  { name: "Utilities", systemKey: "utilities" },
  { name: "Other Expense", systemKey: "other_expense" },
];

const DEFAULT_INVESTMENT_CATEGORIES = [
  { name: "Stocks", systemKey: "stocks" },
  { name: "Bonds", systemKey: "bonds" },
  { name: "Crypto", systemKey: "crypto" },
  { name: "Real Estate", systemKey: "real_estate" },
  { name: "Savings", systemKey: "savings" },
  { name: "Retirement", systemKey: "retirement" },
  { name: "Other Investment", systemKey: "other_investment" },
];

// System expense categories for credit cards - protected from deletion
const SYSTEM_EXPENSE_CATEGORIES = [
  { name: "Credit Card", systemKey: "credit_card" },
  { name: "Subscriptions", systemKey: "subscriptions" },
  { name: "Groceries", systemKey: "groceries" },
  { name: "Restaurants & Dining", systemKey: "restaurants_dining" },
  { name: "Transportation", systemKey: "transportation" },
  { name: "Shopping", systemKey: "shopping" },
  { name: "Entertainment", systemKey: "entertainment" },
  { name: "Health & Pharmacy", systemKey: "health_pharmacy" },
  { name: "Travel", systemKey: "travel_system" },
  { name: "Education", systemKey: "education" },
  { name: "Personal Care", systemKey: "personal_care" },
  { name: "Home", systemKey: "home" },
  { name: "Fees & Charges", systemKey: "fees_charges" },
  { name: "Other", systemKey: "other_system" },
];

const DEFAULT_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", manualRate: 1 },
  { code: "EUR", name: "Euro", symbol: "€", manualRate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", manualRate: 0.79 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", manualRate: 4.97 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", manualRate: 149.5 },
];

async function seedDefaultCategoriesForUser(userId: string, prisma: PrismaClient) {
  const categories = [
    ...DEFAULT_INCOME_CATEGORIES.map((cat) => ({
      userId,
      name: cat.name,
      systemKey: cat.systemKey,
      type: "income" as const,
      isDefault: true,
      isSystem: false,
    })),
    ...DEFAULT_EXPENSE_CATEGORIES.map((cat) => ({
      userId,
      name: cat.name,
      systemKey: cat.systemKey,
      type: "expense" as const,
      isDefault: true,
      isSystem: false,
    })),
    ...DEFAULT_INVESTMENT_CATEGORIES.map((cat) => ({
      userId,
      name: cat.name,
      systemKey: cat.systemKey,
      type: "investment" as const,
      isDefault: true,
      isSystem: false,
    })),
    ...SYSTEM_EXPENSE_CATEGORIES.map((cat) => ({
      userId,
      name: cat.name,
      systemKey: cat.systemKey,
      type: "expense" as const,
      isDefault: true,
      isSystem: true,
    })),
  ];

  await prisma.category.createMany({
    data: categories,
    skipDuplicates: true,
  });
}

async function seedDefaultCurrenciesForUser(userId: string, prisma: PrismaClient) {
  const currencies = DEFAULT_CURRENCIES.map((currency) => ({
    userId,
    ...currency,
  }));

  await prisma.currency.createMany({
    data: currencies,
    skipDuplicates: true,
  });
}

export async function signup(input: SignupInput, prisma: PrismaClient) {
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    throw new Error("User with this email already exists");
  }

  // Hash the password
  const passwordHash = await hashPassword(input.password);

  // Create user with personal account
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      baseCurrency: input.baseCurrency || "USD",
      personalAccount: {
        create: {
          defaultCurrency: input.baseCurrency || "USD",
        },
      },
    },
    include: {
      personalAccount: true,
    },
  });

  // Seed default currencies and categories for the new user
  await seedDefaultCurrenciesForUser(user.id, prisma);
  await seedDefaultCategoriesForUser(user.id, prisma);

  return user;
}
