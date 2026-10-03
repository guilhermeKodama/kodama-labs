import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Get user-level settings.
 */
export async function getUserSettings(userId: string, db: DbClient) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      baseCurrency: true,
      theme: true,
      dateFormat: true,
      numberFormat: true,
      timezone: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

/**
 * Update user-level settings.
 */
export async function updateUserSettings(
  userId: string,
  updates: {
    baseCurrency?: string;
    theme?: string;
    dateFormat?: string;
    numberFormat?: string;
    timezone?: string;
  },
  db: DbClient
) {
  return db.user.update({
    where: { id: userId },
    data: updates,
    select: {
      baseCurrency: true,
      theme: true,
      dateFormat: true,
      numberFormat: true,
      timezone: true,
    },
  });
}

/**
 * Get account (personal or business) settings.
 */
export async function getAccountSettings(
  userId: string,
  accountId: string,
  entityType: "personal" | "business",
  db: DbClient
) {
  if (entityType === "personal") {
    const account = await db.personalAccount.findFirst({
      where: {
        id: accountId,
        userId,
      },
      select: {
        id: true,
        defaultCurrency: true,
        taxRate: true,
        initialBalance: true,
      },
    });

    if (!account) {
      throw new Error("Personal account not found or access denied");
    }

    return {
      ...account,
      name: "Personal",
      entityType: "personal" as const,
    };
  } else {
    const account = await db.business.findFirst({
      where: {
        id: accountId,
        userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        defaultCurrency: true,
        color: true,
        taxRate: true,
        initialBalance: true,
      },
    });

    if (!account) {
      throw new Error("Business account not found or access denied");
    }

    return {
      ...account,
      entityType: "business" as const,
    };
  }
}

/**
 * Update account settings.
 * 
 * IMPORTANT: Changing defaultCurrency does NOT retroactively convert existing transactions.
 * - The currency field on Transaction records stores the actual currency of that transaction
 * - The defaultCurrency only affects what currency new transactions default to in the UI
 * - Historical transaction amounts remain in their original currency
 * - For display purposes, the UI may convert at the time of display using exchange rates
 */
export async function updateAccountSettings(
  userId: string,
  accountId: string,
  entityType: "personal" | "business",
  updates: {
    name?: string;
    description?: string;
    defaultCurrency?: string;
    color?: string;
    taxRate?: number;
    initialBalance?: number;
  },
  db: DbClient
) {
  if (entityType === "personal") {
    const existing = await db.personalAccount.findFirst({
      where: {
        id: accountId,
        userId,
      },
    });

    if (!existing) {
      throw new Error("Personal account not found or access denied");
    }

    const updated = await db.personalAccount.update({
      where: { id: accountId },
      data: {
        ...(updates.defaultCurrency && { defaultCurrency: updates.defaultCurrency }),
        ...(updates.taxRate !== undefined && { taxRate: updates.taxRate }),
        ...(updates.initialBalance !== undefined && { initialBalance: updates.initialBalance }),
      },
      select: {
        id: true,
        defaultCurrency: true,
        taxRate: true,
        initialBalance: true,
      },
    });

    return {
      ...updated,
      name: "Personal",
      entityType: "personal" as const,
    };
  } else {
    const existing = await db.business.findFirst({
      where: {
        id: accountId,
        userId,
      },
    });

    if (!existing) {
      throw new Error("Business account not found or access denied");
    }

    return db.business.update({
      where: { id: accountId },
      data: {
        ...(updates.name && { name: updates.name }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.defaultCurrency && { defaultCurrency: updates.defaultCurrency }),
        ...(updates.color && { color: updates.color }),
        ...(updates.taxRate !== undefined && { taxRate: updates.taxRate }),
        ...(updates.initialBalance !== undefined && { initialBalance: updates.initialBalance }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        defaultCurrency: true,
        color: true,
        taxRate: true,
        initialBalance: true,
      },
    });
  }
}
