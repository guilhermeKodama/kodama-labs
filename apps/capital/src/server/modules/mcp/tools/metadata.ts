import type { DbClient } from "@capital/server/lib/prisma";
import { listCategories } from "../../categories/services/list-categories";
import type { TransactionType } from "@/generated/prisma";

/**
 * List all categories for the user, optionally filtered by transaction type.
 */
export async function listCategoriesForMcp(
  userId: string,
  type: TransactionType | undefined,
  db: DbClient
) {
  const categories = await listCategories(userId, type, db);

  return {
    categories: categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      color: cat.color,
      icon: cat.icon,
      isDefault: cat.isDefault,
      isSystem: cat.isSystem,
    })),
  };
}

/**
 * List accounts (businesses and personal account) for the user.
 */
export async function listAccounts(userId: string, db: DbClient) {
  // Fetch all businesses
  const businesses = await db.business.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      description: true,
      defaultCurrency: true,
      color: true,
    },
  });

  // Fetch personal account
  const personalAccount = await db.personalAccount.findUnique({
    where: { userId },
    select: {
      id: true,
      defaultCurrency: true,
    },
  });

  return {
    businesses: businesses.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      defaultCurrency: b.defaultCurrency,
      color: b.color,
      entityType: "business" as const,
    })),
    personalAccount: personalAccount
      ? {
          id: personalAccount.id,
          name: "Personal",
          defaultCurrency: personalAccount.defaultCurrency,
          entityType: "personal" as const,
        }
      : null,
  };
}

/**
 * Get valid transaction types.
 */
export function getValidTypes() {
  return {
    types: ["income", "expense", "investment"],
  };
}
