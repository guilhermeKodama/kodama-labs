import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma, type TransactionType } from "@/generated/prisma";
import { billTransactionOwnedBy } from "@capital/server/modules/credit-cards/lib/bill-transaction-ownership";
import { createCategory as createCategoryService } from "../../categories/services/create-category";
import { updateCategoryService } from "../../categories/services/update-category";
import { fetchCategoryById } from "../../categories/data/queries/fetch-categories";

export interface CreateCategoryParams {
  name: string;
  type: TransactionType;
  color?: string;
  icon?: string;
}

export interface UpdateCategoryParams {
  id: string;
  name?: string;
  type?: TransactionType;
  color?: string;
  icon?: string;
}

export interface DeleteCategoryParams {
  id: string;
  reassignTo?: string;
}

export interface MergeCategoriesParams {
  fromId: string;
  toId: string;
}

/**
 * Create a new category for the user.
 */
export async function createCategoryTool(
  userId: string,
  params: CreateCategoryParams,
  db: DbClient
) {
  return createCategoryService(
    {
      userId,
      name: params.name,
      type: params.type,
      color: params.color,
      icon: params.icon,
    },
    db
  );
}

/**
 * Update an existing category.
 * Cascades name changes to all tables that reference the category by name.
 * Type changes are only allowed when no transactions use the category.
 * 
 * IMPORTANT: System and default categories CAN be renamed (for localization).
 * The system uses skipDuplicates when seeding, so renaming won't cause duplicates.
 * SystemKey cannot be changed once set - it provides stable identification.
 */
export async function updateCategoryTool(
  userId: string,
  params: UpdateCategoryParams,
  db: DbClient
) {
  const existing = await fetchCategoryById(userId, params.id, db);
  if (!existing) {
    throw new Error("Category not found or access denied");
  }

  // Prevent changing systemKey (it's immutable)
  if ('systemKey' in params) {
    throw new Error("Cannot modify systemKey - it's a stable identifier");
  }

  // Check if we're trying to rename to an existing category
  if (params.name && params.name !== existing.name) {
    const targetType = params.type ?? existing.type;
    const existingWithName = await db.category.findFirst({
      where: {
        userId,
        name: params.name,
        type: targetType,
      },
    });

    if (existingWithName) {
      throw new Error(
        `A category named '${params.name}' already exists for type ${targetType}. ` +
        `Use merge_categories to merge '${existing.name}' into '${params.name}' instead.`
      );
    }
  }

  if (existing.systemKey && params.type && params.type !== existing.type) {
    throw new Error(
      `Cannot change type of system category '${existing.name}' (systemKey: ${existing.systemKey})`
    );
  }

  // Check if trying to change type
  if (params.type && params.type !== existing.type) {
    const transactionCount = await db.transaction.count({
      where: {
        category: existing.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    });

    if (transactionCount > 0) {
      throw new Error(
        `Cannot change category type when ${transactionCount} transaction(s) use it. ` +
        `Transactions must all be consistent with the new type.`
      );
    }
  }

  // If renaming, cascade the change to all tables atomically
  if (params.name && params.name !== existing.name) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (db as any).$transaction === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (db as any).$transaction(async (tx: any) => {
        // Update category row first
        const updated = await tx.category.update({
          where: { id: params.id },
          data: {
            ...(params.name && { name: params.name }),
            ...(params.type && { type: params.type }),
            ...(params.color !== undefined && { color: params.color }),
            ...(params.icon !== undefined && { icon: params.icon }),
          },
        });

        // Cascade name change to all referencing tables
        if (params.name && params.name !== existing.name) {
          await tx.transaction.updateMany({
            where: {
              category: existing.name,
              type: existing.type,
              OR: [
                { business: { userId } },
                { personalAccount: { userId } },
              ],
            },
            data: { category: params.name },
          });

          await tx.recurringTransaction.updateMany({
            where: {
              category: existing.name,
              type: existing.type,
              OR: [
                { business: { userId } },
                { personalAccount: { userId } },
              ],
            },
            data: { category: params.name },
          });

          await tx.budget.updateMany({
            where: {
              category: existing.name,
              OR: [
                { business: { userId } },
                { personalAccount: { userId } },
              ],
            },
            data: { category: params.name },
          });

          await tx.billTransaction.updateMany({
            where: {
              ...billTransactionOwnedBy(userId),
              category: existing.name,
            },
            data: { category: params.name },
          });

          await tx.merchantCategoryMapping.updateMany({
            where: {
              userId,
              category: existing.name,
            },
            data: { category: params.name },
          });
        }

        return updated;
      });
    } else {
      // Already in a transaction, execute directly
      const updated = await db.category.update({
        where: { id: params.id },
        data: {
          ...(params.name && { name: params.name }),
          ...(params.type && { type: params.type }),
          ...(params.color !== undefined && { color: params.color }),
          ...(params.icon !== undefined && { icon: params.icon }),
        },
      });

      // Cascade name change
      if (params.name && params.name !== existing.name) {
        await db.transaction.updateMany({
          where: {
            category: existing.name,
            type: existing.type,
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
          data: { category: params.name },
        });

        await db.recurringTransaction.updateMany({
          where: {
            category: existing.name,
            type: existing.type,
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
          data: { category: params.name },
        });

        await db.budget.updateMany({
          where: {
            category: existing.name,
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
          data: { category: params.name },
        });

        await db.billTransaction.updateMany({
          where: {
            ...billTransactionOwnedBy(userId),
            category: existing.name,
          },
          data: { category: params.name },
        });

        await db.merchantCategoryMapping.updateMany({
          where: {
            userId,
            category: existing.name,
          },
          data: { category: params.name },
        });
      }

      return updated;
    }
  }

  // No rename, just update other fields via service
  const updates = {
    ...(params.type && { type: params.type }),
    ...(params.color !== undefined && { color: params.color }),
    ...(params.icon !== undefined && { icon: params.icon }),
  };

  return updateCategoryService(userId, params.id, updates, db);
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Budget unique key is (account, category, effectiveFrom). Check and move inside
 * the same transaction. A unique violation is the backstop if a row appears
 * between the check and the update.
 */
async function moveBudgetsOrConflict(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  userId: string,
  fromName: string,
  toName: string,
) {
  const sourceBudgets = await tx.budget.findMany({
    where: {
      category: fromName,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: {
      businessId: true,
      personalAccountId: true,
      effectiveFrom: true,
    },
  });

  const conflicts: string[] = [];
  for (const budget of sourceBudgets) {
    const clash = await tx.budget.findFirst({
      where: {
        category: toName,
        businessId: budget.businessId,
        personalAccountId: budget.personalAccountId,
        effectiveFrom: budget.effectiveFrom,
      },
    });
    if (clash) {
      const key = `${budget.businessId || budget.personalAccountId}/effectiveFrom:${budget.effectiveFrom.toISOString().split("T")[0]}`;
      conflicts.push(key);
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Cannot reassign budgets: target category already has budgets for: ${conflicts.join(", ")}. ` +
      `Delete or merge those budgets first.`
    );
  }

  try {
    return await tx.budget.updateMany({
      where: {
        category: fromName,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      data: { category: toName },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new Error(
        `Cannot reassign budgets: target category already has a budget for the same account and effectiveFrom. ` +
        `Delete or merge those budgets first.`
      );
    }
    throw error;
  }
}

/**
 * Delete a category, optionally reassigning transactions and budgets.
 * All operations are atomic within a single transaction.
 */
export async function deleteCategoryTool(
  userId: string,
  params: DeleteCategoryParams,
  db: DbClient
) {
  const existing = await fetchCategoryById(userId, params.id, db);
  if (!existing) {
    throw new Error("Category not found or access denied");
  }

  // Same order of protection as the web app (isDefault, then isSystem), with systemKey
  // first so a keyed row reports the stable key. Renames stay allowed in update_category.
  if (existing.systemKey) {
    throw new Error(
      `Cannot delete system category '${existing.name}' (systemKey: ${existing.systemKey}). ` +
      `System categories are required by the app. Use merge_categories to consolidate.`
    );
  }

  if (existing.isDefault) {
    throw new Error("Cannot delete default categories");
  }

  if (existing.isSystem) {
    throw new Error("Cannot delete system categories");
  }

  if (params.reassignTo === params.id) {
    throw new Error("Cannot reassign a category to itself");
  }

  // Count all linked records across all tables
  const [transactionCount, recurringTxnCount, budgetCount, billTxnCount, mappingCount] = await Promise.all([
    db.transaction.count({
      where: {
        category: existing.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    }),
    db.recurringTransaction.count({
      where: {
        category: existing.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    }),
    db.budget.count({
      where: {
        category: existing.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    }),
    db.billTransaction.count({
      where: {
        ...billTransactionOwnedBy(userId),
        category: existing.name,
      },
    }),
    db.merchantCategoryMapping.count({
      where: {
        userId,
        category: existing.name,
      },
    }),
  ]);

  const totalLinked = transactionCount + recurringTxnCount + budgetCount + billTxnCount + mappingCount;

  if (!params.reassignTo && totalLinked > 0) {
    throw new Error(
      `Cannot delete category with linked records: ${transactionCount} transaction(s), ` +
      `${recurringTxnCount} recurring transaction(s), ${budgetCount} budget(s), ` +
      `${billTxnCount} bill transaction(s), ${mappingCount} mapping(s). ` +
      `Provide 'reassignTo' to reassign them first.`
    );
  }

  // Validate reassignTo before doing anything
  let targetCategory = null;
  if (params.reassignTo) {
    targetCategory = await fetchCategoryById(userId, params.reassignTo, db);
    if (!targetCategory) {
      throw new Error("Target category not found for reassignment");
    }
    if (targetCategory.type !== existing.type) {
      throw new Error(
        `Cannot reassign to category of different type: ${existing.type} -> ${targetCategory.type}`
      );
    }
  }

  // Execute all operations atomically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (db as any).$transaction === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).$transaction(async (tx: any) => {
      if (params.reassignTo && targetCategory) {
        // Reassign all records
        await tx.transaction.updateMany({
          where: {
            category: existing.name,
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
          data: { category: targetCategory.name },
        });

        await tx.recurringTransaction.updateMany({
          where: {
            category: existing.name,
            OR: [
              { business: { userId } },
              { personalAccount: { userId } },
            ],
          },
          data: { category: targetCategory.name },
        });

        await moveBudgetsOrConflict(tx, userId, existing.name, targetCategory.name);

        await tx.billTransaction.updateMany({
          where: {
            ...billTransactionOwnedBy(userId),
            category: existing.name,
          },
          data: { category: targetCategory.name },
        });

        await tx.merchantCategoryMapping.updateMany({
          where: {
            userId,
            category: existing.name,
          },
          data: { category: targetCategory.name },
        });
      }

      // Now delete the category
      await tx.category.delete({
        where: { id: params.id },
      });
    });
  } else {
    // Already in a transaction
    if (params.reassignTo && targetCategory) {
      await db.transaction.updateMany({
        where: {
          category: existing.name,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        data: { category: targetCategory.name },
      });

      await db.recurringTransaction.updateMany({
        where: {
          category: existing.name,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        data: { category: targetCategory.name },
      });

      await moveBudgetsOrConflict(db, userId, existing.name, targetCategory.name);

      await db.billTransaction.updateMany({
        where: {
          ...billTransactionOwnedBy(userId),
          category: existing.name,
        },
        data: { category: targetCategory.name },
      });

      await db.merchantCategoryMapping.updateMany({
        where: {
          userId,
          category: existing.name,
        },
        data: { category: targetCategory.name },
      });
    }

    await db.category.delete({
      where: { id: params.id },
    });
  }

  return { success: true, id: params.id };
}

/**
 * Merge two categories by moving all transactions and budgets from fromId to toId,
 * then deleting fromId. All operations are atomic.
 */
export async function mergeCategoryTool(
  userId: string,
  params: MergeCategoriesParams,
  db: DbClient
) {
  const fromCategory = await fetchCategoryById(userId, params.fromId, db);
  if (!fromCategory) {
    throw new Error("Source category not found or access denied");
  }

  const toCategory = await fetchCategoryById(userId, params.toId, db);
  if (!toCategory) {
    throw new Error("Target category not found or access denied");
  }

  if (params.fromId === params.toId) {
    throw new Error("Cannot merge a category into itself");
  }

  if (fromCategory.type !== toCategory.type) {
    throw new Error(
      `Cannot merge categories of different types: ${fromCategory.type} -> ${toCategory.type}`
    );
  }

  // FROM side matches delete: systemKey, then isDefault, then isSystem.
  // Merging into a default or system category is allowed.
  if (fromCategory.systemKey) {
    throw new Error(
      `Cannot merge from system category '${fromCategory.name}' (systemKey: ${fromCategory.systemKey}). ` +
      `System categories are required by the app and must not be deleted.`
    );
  }

  if (fromCategory.isDefault) {
    throw new Error("Cannot merge from a default category");
  }

  if (fromCategory.isSystem) {
    throw new Error("Cannot merge from a system category");
  }

  // Execute all moves atomically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (db as any).$transaction === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (db as any).$transaction(async (tx: any) => {
      // Move all transactions
      const transactionUpdate = await tx.transaction.updateMany({
        where: {
          category: fromCategory.name,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        data: {
          category: toCategory.name,
        },
      });

      // Move all recurring transactions
      const recurringTxnUpdate = await tx.recurringTransaction.updateMany({
        where: {
          category: fromCategory.name,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        data: {
          category: toCategory.name,
        },
      });

      // Move all budgets
      const budgetUpdate = await moveBudgetsOrConflict(
        tx,
        userId,
        fromCategory.name,
        toCategory.name,
      );

      // Move all bill transactions
      const billTxnUpdate = await tx.billTransaction.updateMany({
        where: {
          ...billTransactionOwnedBy(userId),
          category: fromCategory.name,
        },
        data: {
          category: toCategory.name,
        },
      });

      // Move all merchant category mappings
      const mappingUpdate = await tx.merchantCategoryMapping.updateMany({
        where: {
          userId,
          category: fromCategory.name,
        },
        data: {
          category: toCategory.name,
        },
      });

      // Delete the source category
      await tx.category.delete({
        where: { id: params.fromId },
      });

      return {
        success: true,
        fromCategory: fromCategory.name,
        toCategory: toCategory.name,
        transactionsMoved: transactionUpdate.count,
        recurringTransactionsMoved: recurringTxnUpdate.count,
        budgetsMoved: budgetUpdate.count,
        billTransactionsMoved: billTxnUpdate.count,
        mappingsMoved: mappingUpdate.count,
      };
    });
  } else {
    // Already in a transaction
    const transactionUpdate = await db.transaction.updateMany({
      where: {
        category: fromCategory.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      data: {
        category: toCategory.name,
      },
    });

    const recurringTxnUpdate = await db.recurringTransaction.updateMany({
      where: {
        category: fromCategory.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      data: {
        category: toCategory.name,
      },
    });

    const budgetUpdate = await moveBudgetsOrConflict(
      db,
      userId,
      fromCategory.name,
      toCategory.name,
    );

    const billTxnUpdate = await db.billTransaction.updateMany({
      where: {
        ...billTransactionOwnedBy(userId),
        category: fromCategory.name,
      },
      data: {
        category: toCategory.name,
      },
    });

    const mappingUpdate = await db.merchantCategoryMapping.updateMany({
      where: {
        userId,
        category: fromCategory.name,
      },
      data: {
        category: toCategory.name,
      },
    });

    await db.category.delete({
      where: { id: params.fromId },
    });

    return {
      success: true,
      fromCategory: fromCategory.name,
      toCategory: toCategory.name,
      transactionsMoved: transactionUpdate.count,
      recurringTransactionsMoved: recurringTxnUpdate.count,
      budgetsMoved: budgetUpdate.count,
      billTransactionsMoved: billTxnUpdate.count,
      mappingsMoved: mappingUpdate.count,
    };
  }
}
