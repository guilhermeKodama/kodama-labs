import type { PrismaClient } from "@/generated/prisma";
import { SYSTEM_CATEGORY_DEFINITIONS } from "@capital/server/modules/categories/lib/system-categories";
import { hashPassword } from "./password";

interface SignupInput {
  email: string;
  password: string;
  name: string;
  baseCurrency?: string;
}

const DEFAULT_CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$", manualRate: 1 },
  { code: "EUR", name: "Euro", symbol: "€", manualRate: 0.92 },
  { code: "GBP", name: "British Pound", symbol: "£", manualRate: 0.79 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", manualRate: 4.97 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", manualRate: 149.5 },
];

async function seedDefaultCategoriesForUser(userId: string, prisma: PrismaClient) {
  await prisma.category.createMany({
    data: SYSTEM_CATEGORY_DEFINITIONS.map((cat) => ({
      userId,
      name: cat.name,
      systemKey: cat.systemKey,
      type: cat.type,
      isDefault: cat.isDefault,
      isSystem: cat.isSystem,
    })),
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
