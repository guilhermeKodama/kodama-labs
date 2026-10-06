import type { DbClient } from "@capital/server/lib/prisma";
import type { Budget, Category } from "@/generated/prisma";
import { createBudget as createBudgetService, deactivateBudget, listBudgets as listBudgetsService, updateBudget as updateBudgetService } from "../../budgets/services/budget-crud";
import { monthOverview } from "../../budgets/services/budget-overview";
import { getPersonalEntity } from "../../ledger/services/entities";
import { toNumber } from "../../ledger/lib/money";
import { categoryResolver } from "../lib/ledger-adapter";

export interface ListBudgetsParams {
  accountId?: string;
  category?: string;
  effectiveDate?: string; // YYYY-MM-DD or YYYY-MM
}

export interface CreateBudgetParams {
  accountId: string;
  category: string;
  amount: number;
  currency: string;
  effectiveFrom: string; // YYYY-MM-DD
}

export interface UpdateBudgetParams {
  budgetId: string;
  amount?: number;
  currency?: string;
  effectiveFrom?: string; // YYYY-MM-DD
  isActive?: boolean;
}

export interface DeleteBudgetParams {
  budgetId: string;
}

export interface GetBudgetStatusParams {
  month: string; // YYYY-MM
  accountId?: string;
}

/** accountId is the personal entity (the MCP's "personal account"); defaults to it. */
async function resolveEntity(userId: string, accountId: string | undefined, db: DbClient) {
  if (!accountId) return getPersonalEntity(userId, db);
  const entity = await db.entity.findFirst({ where: { id: accountId, userId } });
  if (!entity) throw new Error("Account not found or access denied");
  return entity;
}

function toMcpBudget(b: Budget & { category: Category }) {
  return {
    id: b.id,
    category: b.category.name,
    amount: toNumber(b.amount),
    currency: b.currency,
    effectiveFrom: b.effectiveFrom.toISOString().split("T")[0],
    period: b.period,
    year: b.year,
    month: b.month,
    isActive: b.isActive,
  };
}

export async function listBudgets(userId: string, params: ListBudgetsParams, db: DbClient) {
  const entity = await resolveEntity(userId, params.accountId, db);
  const categoryId = params.category ? (await db.category.findFirst({ where: { userId, name: params.category } }))?.id : undefined;
  if (params.category && !categoryId) return [];
  const budgets = await listBudgetsService(userId, db, { entityId: entity.id, categoryId, effectiveAt: params.effectiveDate });
  return budgets.map(toMcpBudget);
}

/** A matching inactive budget is reactivated instead of rejected. */
export async function createBudget(userId: string, params: CreateBudgetParams, db: DbClient) {
  const entity = await resolveEntity(userId, params.accountId, db);
  const category = (await categoryResolver(userId, db)).resolve(params.category, "expense");
  const budget = await createBudgetService(userId, { entityId: entity.id, categoryId: category.id, amount: params.amount, currency: params.currency, effectiveFrom: params.effectiveFrom }, db);
  const { isActive: _isActive, ...rest } = toMcpBudget(budget);
  void _isActive;
  return rest;
}

export async function updateBudget(userId: string, params: UpdateBudgetParams, db: DbClient) {
  const { budgetId, ...patch } = params;
  const owned = await db.budget.findFirst({ where: { id: budgetId, userId } });
  if (!owned) throw new Error("Budget not found or access denied");
  // The MCP contract edits the version in place (every month it covers); the app's applyFrom versioning is not used here.
  return toMcpBudget(await updateBudgetService(userId, budgetId, patch, db, { mode: "in_place" }));
}

export async function deleteBudget(userId: string, params: DeleteBudgetParams, db: DbClient) {
  const owned = await db.budget.findFirst({ where: { id: params.budgetId, userId } });
  if (!owned) throw new Error("Budget not found or access denied");
  await deactivateBudget(userId, params.budgetId, db);
  return { success: true, budgetId: params.budgetId };
}

/**
 * Budgeted vs actual for a month, from the same overview the app uses:
 * expenses only (no transfers or card bill payments), card purchases on
 * their statement's closing date, in the base currency.
 */
export async function getBudgetStatus(userId: string, params: GetBudgetStatusParams, db: DbClient) {
  const [year, monthNum] = params.month.split("-").map(Number);
  if (!year || !monthNum || monthNum < 1 || monthNum > 12) throw new Error("Invalid month format. Expected YYYY-MM");
  const entity = await resolveEntity(userId, params.accountId, db);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { baseCurrency: true } });
  const overview = await monthOverview(userId, year, monthNum, db, { entityIds: [entity.id] });
  const categories = overview.budgets
    .map((b) => ({
      category: b.category,
      budgeted: b.amount,
      actual: b.committed,
      remaining: Math.round((b.amount - b.committed) * 100) / 100,
      percentUsed: b.amount > 0 ? Math.round((b.committed / b.amount) * 10000) / 100 : 0,
      isOverBudget: b.committed > b.amount,
    }))
    .sort((a, b) => b.percentUsed - a.percentUsed);
  const totalBudgeted = categories.reduce((s, c) => s + c.budgeted, 0);
  const totalActual = categories.reduce((s, c) => s + c.actual, 0);
  return {
    month: params.month,
    accountId: entity.id,
    accountCurrency: entity.defaultCurrency,
    budgetCurrency: user.baseCurrency,
    summary: {
      totalBudgeted: Math.round(totalBudgeted * 100) / 100,
      totalActual: Math.round(totalActual * 100) / 100,
      totalRemaining: Math.round((totalBudgeted - totalActual) * 100) / 100,
    },
    categories,
  };
}
