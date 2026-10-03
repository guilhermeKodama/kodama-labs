import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { createCategory as createCategoryService } from "../../categories/services/create-category";
import { updateCategoryService } from "../../categories/services/update-category";
import { deleteCategoryService } from "../../categories/services/delete-category";
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
 * System categories can be edited if safe for this user.
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

  // Allow editing system categories - they're per-user, not shared
  // The category service will check for isDefault
  const updates = {
    ...(params.name && { name: params.name }),
    ...(params.color !== undefined && { color: params.color }),
    ...(params.icon !== undefined && { icon: params.icon }),
  };

  return updateCategoryService(userId, params.id, updates, db);
}

/**
 * Delete a category, optionally reassigning transactions and budgets.
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

  // Count linked transactions
  const transactionCount = await db.transaction.count({
    where: {
      category: existing.name,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
  });

  // Count linked budgets (defensive: only if Budget model exists)
  let budgetCount = 0;
  try {
    budgetCount = await db.budget.count({
      where: {
        category: existing.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    });
  } catch {
    // Budget model may not exist yet (parallel PR), skip
    console.warn("Budget model not available, skipping budget count");
  }

  if (!params.reassignTo && (transactionCount > 0 || budgetCount > 0)) {
    throw new Error(
      `Cannot delete category with ${transactionCount} transaction(s) and ${budgetCount} budget(s). ` +
      `Provide 'reassignTo' to reassign them first.`
    );
  }

  // Reassign transactions if needed
  if (params.reassignTo && transactionCount > 0) {
    const targetCategory = await fetchCategoryById(userId, params.reassignTo, db);
    if (!targetCategory) {
      throw new Error("Target category not found for reassignment");
    }

    await db.transaction.updateMany({
      where: {
        category: existing.name,
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      data: {
        category: targetCategory.name,
      },
    });
  }

  // Reassign budgets if needed (defensive)
  if (params.reassignTo && budgetCount > 0) {
    try {
      const targetCategory = await fetchCategoryById(userId, params.reassignTo, db);
      if (!targetCategory) {
        throw new Error("Target category not found for reassignment");
      }

      await db.budget.updateMany({
        where: {
          category: existing.name,
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        data: {
          category: targetCategory.name,
        },
      });
    } catch {
      // Budget model may not exist yet (parallel PR), skip
      console.warn("Budget model not available, skipping budget reassignment");
    }
  }

  // Now delete the category
  return deleteCategoryService(userId, params.id, db);
}

/**
 * Merge two categories by moving all transactions and budgets from fromId to toId,
 * then deleting fromId.
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

  if (fromCategory.type !== toCategory.type) {
    throw new Error(
      `Cannot merge categories of different types: ${fromCategory.type} -> ${toCategory.type}`
    );
  }

  // Move all transactions
  const transactionCount = await db.transaction.updateMany({
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

  // Move all budgets (defensive)
  let budgetCount = { count: 0 };
  try {
    budgetCount = await db.budget.updateMany({
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
  } catch {
    // Budget model may not exist yet (parallel PR), skip
    console.warn("Budget model not available, skipping budget merge");
  }

  // Delete the source category
  await deleteCategoryService(userId, params.fromId, db);

  return {
    success: true,
    fromCategory: fromCategory.name,
    toCategory: toCategory.name,
    transactionsMoved: transactionCount.count,
    budgetsMoved: budgetCount.count,
  };
}
