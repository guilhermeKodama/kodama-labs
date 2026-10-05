import type { TransactionType } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { st, type Locale } from "@capital/server/i18n";
import type { SystemCategoryNameKey } from "@capital/server/i18n/categories";
import { loadUserLocale } from "@capital/server/i18n/user-locale";

export interface SystemCategoryDefinition {
  systemKey: string;
  name: string;
  type: TransactionType;
  isDefault: boolean;
  isSystem: boolean;
}

/**
 * One catalog for signup seeding, ensure-on-import, and systemKey lookup.
 * `name` is the legacy English name that pre-key rows are matched by; a new
 * row is named in its owner's locale (systemCategoryName).
 * Keys match the backfill in 20261003113000_add_category_system_key.
 * `travel_system` and `travel_default` are one Travel row: the migration can
 * key an existing isSystem Travel as `travel_system`, and the catalog seeds
 * `travel_default`. The unique key is userId+name+type, so a second Travel
 * cannot be inserted.
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

/**
 * Request keys that share a catalog row. ensureSystemCategories iterates
 * definitions only, so it never inserts `travel_system`.
 */
export const SYSTEM_KEY_ALIASES: Readonly<Record<string, string>> = {
  travel_system: "travel_default",
};

/** Migration key and catalog key for the single Travel category. */
const TRAVEL_KEY_GROUP = ["travel_default", "travel_system"] as const;

export function resolveSystemKey(key: string): string {
  return SYSTEM_KEY_ALIASES[key] ?? key;
}

/** The catalog row for a key or alias, or undefined for a key the catalog does not know. */
export function findSystemCategoryDefinition(key: string): SystemCategoryDefinition | undefined {
  const resolved = resolveSystemKey(key);
  return SYSTEM_CATEGORY_DEFINITIONS.find((d) => d.systemKey === resolved);
}

function definitionFor(key: string): SystemCategoryDefinition {
  const def = findSystemCategoryDefinition(key);
  if (!def) {
    throw new Error(`Unknown system category key: ${key}`);
  }
  return def;
}

/** A catalog category's name in `locale` (categories.system.<key>); in English it is the catalog's own name. */
export function systemCategoryName(key: string, locale: Locale): string {
  return st(locale, `categories.system.${definitionFor(key).systemKey as SystemCategoryNameKey}`);
}

/** Both Travel keys match either row. Every other key matches only itself. */
function lookupKeys(key: string): readonly string[] {
  const resolved = resolveSystemKey(key);
  if (resolved === "travel_default") return TRAVEL_KEY_GROUP;
  return [resolved];
}

async function findByLookupKeys(userId: string, keys: readonly string[], db: DbClient) {
  const rows = await db.category.findMany({
    where: { userId, systemKey: { in: [...keys] } },
  });
  if (rows.length === 0) return null;
  return rows.find((row) => row.systemKey === keys[0]) ?? rows[0];
}

/**
 * Resolve the user's category for a stable key, including the Travel pair.
 * `travel_system` and `travel_default` return the same row and never insert
 * a second Travel. A legacy `travel_system` key is left as-is.
 *
 * Safe inside an interactive transaction: the insert is ON CONFLICT DO NOTHING
 * (`createMany` + `skipDuplicates`), because a unique violation aborts the
 * surrounding Postgres transaction.
 *
 * 1. Row whose systemKey is in the key's equivalence group.
 * 2. isDefault or isSystem row of the right type whose name matches the legacy
 *    English name, case-insensitive, and whose systemKey is null. Sets the
 *    canonical systemKey.
 * 3. Insert the catalog row, named in the user's locale (`locale`, else
 *    User.locale), skipping a (userId, name, type) or systemKey conflict.
 * 4. Re-read by systemKey, then by (userId, name, type). Write systemKey only
 *    when it is null AND the row is isDefault or isSystem. Never steal a key.
 */
export async function getSystemCategory(userId: string, key: string, db: DbClient, locale?: Locale) {
  const resolvedKey = resolveSystemKey(key);
  const keys = lookupKeys(key);
  const def = definitionFor(key);

  const byKey = await findByLookupKeys(userId, keys, db);
  if (byKey) return byKey;

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

  const name = systemCategoryName(resolvedKey, locale ?? (await loadUserLocale(userId, db)));
  await db.category.createMany({
    data: [
      {
        userId,
        name,
        type: def.type,
        systemKey: resolvedKey,
        isDefault: def.isDefault,
        isSystem: def.isSystem,
      },
    ],
    skipDuplicates: true,
  });

  const raced = await findByLookupKeys(userId, keys, db);
  if (raced) return raced;

  const existing = await db.category.findFirst({
    where: {
      userId,
      type: def.type,
      name: { equals: name, mode: "insensitive" },
    },
  });
  if (!existing) {
    throw new Error(`Failed to resolve system category '${key}'`);
  }

  if (existing.systemKey == null && (existing.isDefault || existing.isSystem)) {
    return db.category.update({
      where: { id: existing.id },
      data: { systemKey: resolvedKey },
    });
  }

  return existing;
}

/** Ensure every catalog key exists, named in the user's locale. Alias keys (travel_system) are not created. */
export async function ensureSystemCategories(userId: string, db: DbClient) {
  const locale = await loadUserLocale(userId, db);
  for (const def of SYSTEM_CATEGORY_DEFINITIONS) {
    await getSystemCategory(userId, def.systemKey, db, locale);
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
