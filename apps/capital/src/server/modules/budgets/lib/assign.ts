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

/**
 * Typical value of a spend series, for the rest-of-month tail and for
 * future months in the year view.
 *
 * No samples is 0, and the caller treats that as "no history". One sample
 * is that sample: a single month is not an outlier. Two samples take the
 * smaller one. That deliberately biases low when both months are legitimate
 * and merely different — 6,000 and 8,000 project 6,000, not their mean of
 * 7,000 — because the ordinary median of two values is the mean, so one
 * huge month would still contribute half, and two months cannot tell a
 * trend from a one-off. Under-projecting is the safer forecast there.
 * Three or more use the ordinary median (an even count averages the two
 * central values), so a single outlier drops out of the center.
 */
export function typical(values: readonly number[]): number {
  if (values.length === 0) return 0;
  if (values.length < 3) return Math.min(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  const lo = sorted[mid - 1] ?? hi;
  return sorted.length % 2 === 1 ? hi : (lo + hi) / 2;
}

/**
 * What is still to come after today for one series.
 *
 * `tails[i]` and `totals[i]` are the same historical month (spend after
 * today, and the whole month). `spentToDate` is this month so far.
 *
 *   recognized   = min(max(0, spentToDate), earlyCeiling)
 *   earlyCeiling = max over months of (total - tail)
 *   stillToCome  = min(typical(tails), max(0, typical(totals) - recognized))
 *
 * Rent of 15,000 paid on the 20th in four months (tail 15,000) and on the
 * 3rd in two (tail 0): the typical tail and the typical month are both
 * 15,000, and the early ceiling is 15,000. Already paid on the 3rd, so
 * recognized is 15,000 and still to come is 0 — the month stays 15,000,
 * not 30,000. Spend past the early ceiling does not consume the tail: a
 * card series whose history is 100 by today and 900 after still projects
 * that 900 when 400 has already been spent this month.
 */
export function stillToCome(totals: readonly number[], tails: readonly number[], spentToDate: number): number {
  if (totals.length === 0) return 0;
  let earlyCeiling = -Infinity;
  for (let i = 0; i < totals.length; i++) {
    const early = (totals[i] ?? 0) - (tails[i] ?? 0);
    if (early > earlyCeiling) earlyCeiling = early;
  }
  const recognized = Math.min(Math.max(0, spentToDate), earlyCeiling);
  return Math.min(typical(tails), Math.max(0, typical(totals) - recognized));
}

/** The rounded amount an insight suggests for a budget: the average spend, up to the next 50. */
export const suggestedBudget = (avg: number) => Math.ceil(avg / 50) * 50;
