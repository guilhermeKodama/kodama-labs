import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { createCategory, deleteCategory, mergeCategories, updateCategory } from "../../categories/services/categories";

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
  isArchived?: boolean;
}

export interface DeleteCategoryParams {
  id: string;
  reassignTo?: string;
}

export interface MergeCategoriesParams {
  fromId: string;
  toId: string;
}

export async function createCategoryTool(userId: string, params: CreateCategoryParams, db: DbClient) {
  return createCategory(userId, params, db);
}

/**
 * Records point at the category id, so a rename is a single-row change.
 * System and default categories can be renamed (localization); their type
 * and systemKey cannot change.
 */
export async function updateCategoryTool(userId: string, params: UpdateCategoryParams, db: DbClient) {
  const { id, ...patch } = params;
  const { batchId: _batchId, ...category } = await updateCategory(userId, id, patch, db);
  void _batchId;
  return category;
}

export async function deleteCategoryTool(userId: string, params: DeleteCategoryParams, db: DbClient) {
  const { success, id } = await deleteCategory(userId, params.id, params.reassignTo, db);
  return { success, id };
}

export async function mergeCategoryTool(userId: string, params: MergeCategoriesParams, db: DbClient) {
  const r = await mergeCategories(userId, params.fromId, params.toId, db);
  return {
    success: r.success,
    fromCategory: r.fromCategory,
    toCategory: r.toCategory,
    transactionsMoved: r.transactionsMoved,
    recurringTransactionsMoved: r.recurringTransactionsMoved,
    budgetsMoved: r.budgetsMoved,
    // Card purchases are ledger entries now, counted in transactionsMoved.
    billTransactionsMoved: 0,
    mappingsMoved: r.rulesMoved,
  };
}
