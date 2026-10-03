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
    force?: boolean;
  },
  db: DbClient
) {
  if (updates.baseCurrency) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { baseCurrency: true },
    });
    if (!user) {
      throw new Error("User not found");
    }

    if (updates.baseCurrency !== user.baseCurrency) {
      const transactionCount = await db.transaction.count({
        where: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      });

      if (transactionCount > 0 && !updates.force) {
        throw new Error(
          `User has ${transactionCount} transaction(s). Transaction.exchangeRate is relative to baseCurrency, ` +
          `so changing baseCurrency makes historical totals wrong. Pass force: true to change it anyway.`
        );
      }
    }
  }

  const { force: _force, ...data } = updates;
  void _force;

  return db.user.update({
    where: { id: userId },
    data,
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
 * IMPORTANT about defaultCurrency changes:
 * 
 * The exchangeRate field on transactions represents "1 transaction.currency = exchangeRate user.baseCurrency".
 * When displaying amounts, the system multiplies amount * exchangeRate to convert to baseCurrency for totals.
 * 
 * PersonalAccount.defaultCurrency and Business.defaultCurrency are used for:
 * - Default currency in UI forms when creating new transactions
 * - Currency display in entity summary reports (see get-summary.ts:104, 162)
 * 
 * WHAT HAPPENS if you change defaultCurrency on an account with existing transactions:
 * - Existing transactions keep their original currency and exchangeRate fields unchanged
 * - Those exchangeRates still convert to the user's baseCurrency (which may differ from account's defaultCurrency)
 * - Display totals remain correct because they sum amount*exchangeRate regardless of defaultCurrency
 * - New transactions will default to the new currency in forms
 * 
 * SAFE TO CHANGE: Yes, if you understand that the defaultCurrency is just a UI default for new transactions,
 * not a conversion base for existing data. All conversions go through baseCurrency.
 * 
 * To prevent accidental changes, this function requires force:true when changing currency on
 * an account that has existing transactions.
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
    force?: boolean;
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

    // Check if trying to change currency on account with transactions
    if (updates.defaultCurrency && updates.defaultCurrency !== existing.defaultCurrency) {
      const transactionCount = await db.transaction.count({
        where: { personalAccountId: accountId },
      });

      if (transactionCount > 0 && !updates.force) {
        throw new Error(
          `Account has ${transactionCount} transaction(s). Changing defaultCurrency is safe (existing ` +
          `transactions keep their currency and exchangeRate), but requires force:true to confirm you ` +
          `understand this. The new currency will only affect new transactions.`
        );
      }
    }

    const { force: _force1, ...updateData } = updates;
    void _force1; // Used for validation above

    const updated = await db.personalAccount.update({
      where: { id: accountId },
      data: {
        ...(updateData.defaultCurrency && { defaultCurrency: updateData.defaultCurrency }),
        ...(updateData.taxRate !== undefined && { taxRate: updateData.taxRate }),
        ...(updateData.initialBalance !== undefined && { initialBalance: updateData.initialBalance }),
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

    // Check if trying to change currency on account with transactions
    if (updates.defaultCurrency && updates.defaultCurrency !== existing.defaultCurrency) {
      const transactionCount = await db.transaction.count({
        where: { businessId: accountId },
      });

      if (transactionCount > 0 && !updates.force) {
        throw new Error(
          `Account has ${transactionCount} transaction(s). Changing defaultCurrency is safe (existing ` +
          `transactions keep their currency and exchangeRate), but requires force:true to confirm you ` +
          `understand this. The new currency will only affect new transactions.`
        );
      }
    }

    const { force: _force2, ...updateData } = updates;
    void _force2; // Used for validation above

    return db.business.update({
      where: { id: accountId },
      data: {
        ...(updateData.name && { name: updateData.name }),
        ...(updateData.description !== undefined && { description: updateData.description }),
        ...(updateData.defaultCurrency && { defaultCurrency: updateData.defaultCurrency }),
        ...(updateData.color && { color: updateData.color }),
        ...(updateData.taxRate !== undefined && { taxRate: updateData.taxRate }),
        ...(updateData.initialBalance !== undefined && { initialBalance: updateData.initialBalance }),
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
