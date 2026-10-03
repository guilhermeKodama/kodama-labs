import { Prisma, type TransactionType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";

export interface SystemCategoryDefinition {
  systemKey: string;
  name: string;
  type: TransactionType;
  isDefault: boolean;
  isSystem: boolean;
}

/**
 * One catalog for signup seeding, ensure-on-import, and systemKey lookup.
 * Keys match the backfill in 20261003113000_add_category_system_key.
 * `travel_system` is not a row: it is an alias of `travel_default` (same English
 * name "Travel", and the unique key is userId+name+type).
 */
export const SYSTEM_CATEGORY_DEFINITIONS: readonly SystemCategoryDefinition[] = [
  { systemKey: "client_payment", name: "Client Payment", type: "income", isDefault: true, isSystem: false },
  { systemKey: "salary", name: "Salary", type: "income", isDefault: true, isSystem: false },
  { systemKey: "dividends", name: "Dividends", type: "income", isDefault: true, isSystem: false },
  { systemKey: "interest", name: "Interest", type: "income", isDefault: true, isSystem: false },
  { systemKey: "refund", name: "Refund", type: "income", isDefault: true, isSystem: false },
  { systemKey: "other_income", name: "Other Income", type: "income", isDefault: true, isSystem: false },

  { systemKey: "software_tools", name: "Software & Tools", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "hardware", name: "Hardware", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "office", name: "Office", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "travel_default", name: "Travel", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "marketing", name: "Marketing", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "legal_accounting", name: "Legal & Accounting", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "taxes", name: "Taxes", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "insurance", name: "Insurance", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "utilities", name: "Utilities", type: "expense", isDefault: true, isSystem: false },
  { systemKey: "other_expense", name: "Other Expense", type: "expense", isDefault: true, isSystem: false },

  { systemKey: "stocks", name: "Stocks", type: "investment", isDefault: true, isSystem: false },
  { systemKey: "bonds", name: "Bonds", type: "investment", isDefault: true, isSystem: false },
  { systemKey: "crypto", name: "Crypto", type: "investment", isDefault: true, isSystem: false },
  { systemKey: "real_estate", name: "Real Estate", type: "investment", isDefault: true, isSystem: false },
  { systemKey: "savings", name: "Savings", type: "investment", isDefault: true, isSystem: false },
  { systemKey: "retirement", name: "Retirement", type: "investment", isDefault: true, isSystem: false },
  { systemKey: "other_investment", name: "Other Investment", type: "investment", isDefault: true, isSystem: false },

  { systemKey: "credit_card", name: "Credit Card", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "subscriptions", name: "Subscriptions", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "groceries", name: "Groceries", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "restaurants_dining", name: "Restaurants & Dining", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "transportation", name: "Transportation", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "shopping", name: "Shopping", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "entertainment", name: "Entertainment", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "health_pharmacy", name: "Health & Pharmacy", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "education", name: "Education", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "personal_care", name: "Personal Care", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "home", name: "Home", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "fees_charges", name: "Fees & Charges", type: "expense", isDefault: true, isSystem: true },
  { systemKey: "other_system", name: "Other", type: "expense", isDefault: true, isSystem: true },
];

/** Request keys that resolve to another catalog row. ensureSystemCategories skips these. */
export const SYSTEM_KEY_ALIASES: Readonly<Record<string, string>> = {
  travel_system: "travel_default",
};

export function resolveSystemKey(key: string): string {
  return SYSTEM_KEY_ALIASES[key] ?? key;
}

function definitionFor(key: string): SystemCategoryDefinition {
  const resolved = resolveSystemKey(key);
  const def = SYSTEM_CATEGORY_DEFINITIONS.find((d) => d.systemKey === resolved);
  if (!def) {
    throw new Error(`Unknown system category key: ${key}`);
  }
  return def;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findBySystemKey(userId: string, systemKey: string, db: DbClient) {
  return db.category.findUnique({
    where: { userId_systemKey: { userId, systemKey } },
  });
}

/**
 * Resolve the user's category for a stable key, including aliases.
 * `travel_system` returns the `travel_default` row and never inserts a second Travel.
 *
 * 1. Row with the canonical systemKey (then the legacy alias key, if any).
 * 2. isDefault or isSystem row of the right type whose name matches the legacy
 *    English name, case-insensitive, and whose systemKey is null. Sets systemKey.
 * 3. Otherwise create the catalog row.
 * 4. On a (userId, name, type) unique conflict, return that existing row.
 *    Write systemKey only when it is null AND the row is isDefault or isSystem.
 *    Never overwrite a key that already belongs to the row.
 */
export async function getSystemCategory(userId: string, key: string, db: DbClient) {
  const resolvedKey = resolveSystemKey(key);
  const def = definitionFor(key);

  const byCanonical = await findBySystemKey(userId, resolvedKey, db);
  if (byCanonical) return byCanonical;

  if (key !== resolvedKey) {
    const byAlias = await findBySystemKey(userId, key, db);
    if (byAlias) return byAlias;
  }

  const flagged = await db.category.findMany({
    where: {
      userId,
      type: def.type,
      systemKey: null,
      OR: [{ isDefault: true }, { isSystem: true }],
    },
  });
  const legacy = flagged.find((c) => c.name.toLowerCase() === def.name.toLowerCase());
  if (legacy) {
    return db.category.update({
      where: { id: legacy.id },
      data: { systemKey: resolvedKey },
    });
  }

  try {
    return await db.category.create({
      data: {
        userId,
        name: def.name,
        type: def.type,
        systemKey: resolvedKey,
        isDefault: def.isDefault,
        isSystem: def.isSystem,
      },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;

    const raced = await findBySystemKey(userId, resolvedKey, db);
    if (raced) return raced;

    const existing = await db.category.findFirst({
      where: {
        userId,
        type: def.type,
        name: { equals: def.name, mode: "insensitive" },
      },
    });
    if (!existing) throw error;

    if (existing.systemKey == null && (existing.isDefault || existing.isSystem)) {
      return db.category.update({
        where: { id: existing.id },
        data: { systemKey: resolvedKey },
      });
    }

    return existing;
  }
}

/** Ensure every catalog key exists. Alias keys (travel_system) are not created. */
export async function ensureSystemCategories(userId: string, db: DbClient) {
  for (const def of SYSTEM_CATEGORY_DEFINITIONS) {
    await getSystemCategory(userId, def.systemKey, db);
  }
}

export async function getSystemCategoryNames(
  userId: string,
  keys: readonly string[],
  db: DbClient
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const key of keys) {
    const category = await getSystemCategory(userId, key, db);
    names[key] = category.name;
  }
  return names;
}
