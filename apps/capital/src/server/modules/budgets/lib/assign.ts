/**
 * Which budget a piece of spend counts against. Spend is grouped by
 * (entity, category); it goes to that entity's own budget for the category
 * and, when there is none, to the category's budget for every entity
 * (entityId null). So a PJ "Software" budget and an all-entities "Software"
 * budget never count the same expense twice.
 */

export interface BudgetSlot {
  entityId: string | null;
  categoryId: string;
}

/** The budget of `budgets` (one period, already scoped) that spend of (entityId, categoryId) counts against. */
export function budgetFor<B extends BudgetSlot>(budgets: readonly B[], entityId: string, categoryId: string | null): B | undefined {
  if (!categoryId) return undefined;
  return budgets.find((b) => b.categoryId === categoryId && b.entityId === entityId) ?? budgets.find((b) => b.categoryId === categoryId && b.entityId === null);
}

/**
 * For a budget for every entity: the entities whose own budget for the same
 * category takes their spend instead (empty for an entity's own budget).
 * A drill to the budget's expenses leaves these entities out.
 */
export function excludedEntities(budgets: readonly BudgetSlot[], budget: BudgetSlot): string[] {
  if (budget.entityId) return [];
  return [...new Set(budgets.filter((b) => b.categoryId === budget.categoryId && b.entityId !== null).map((b) => b.entityId as string))];
}

/** Key of a matrix row or spend slot: entity (or "*" for every entity) and category. */
export const slotKey = (entityId: string | null, categoryId: string | null) => `${entityId ?? "*"}|${categoryId ?? "-"}`;

/** Mean of a list (0 when empty). */
export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** The rounded amount an insight suggests for a budget: the average spend, up to the next 50. */
export const suggestedBudget = (avg: number) => Math.ceil(avg / 50) * 50;
