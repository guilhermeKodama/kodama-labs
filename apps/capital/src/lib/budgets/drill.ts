import type { LedgerFilter, Period } from "@capital/server/modules/ledger/contracts";
import type { ViewDraft } from "@/lib/ledger/view-draft";

/**
 * Drills from a budget number to Transações. A budget counts expenses
 * outside transfers (kind expense, no transfer group) in the month of their
 * effective date: card purchases in the statement's closing month. The drill
 * selects exactly those rows, so the table's total matches the number clicked.
 *
 * Gasto is spent to date. The period still covers the whole month (a card
 * purchase closes later), and a `spentToDate` filter keeps a card row once
 * its purchase date has arrived and every other expense once its effective
 * date has — the same cutoff as the overview (ledger/lib/spend-as-of.ts).
 *
 * Spend goes to an entity's own budget for the category, else to the
 * category's budget for every entity: a drill from a budget for every
 * entity leaves out the entities listed in its row's excludeEntityIds.
 */

export interface BudgetDrillRow {
  /** The budget's entity, or null for a budget for every entity. */
  entityId: string | null;
  categoryId: string | null;
  /** For a budget for every entity: entities whose own budget takes their spend. */
  excludeEntityIds?: readonly string[];
}

/** Value no entity id has: an "in" filter needs at least one value, and this one matches nothing. */
const NO_ENTITY = "__none__";

/** The expense rows a budget's spend is made of: filters for a ledger query on effectiveDate. */
export function budgetDrillFilters(row: BudgetDrillRow, scopeEntityIds: readonly string[] | null): LedgerFilter[] {
  const filters: LedgerFilter[] = [
    { field: "kind", op: "in", values: ["expense"] },
    // transfer_groups.direction is set on every transfer leg, so this leaves transfers (reimbursements included) out.
    { field: "transferDirection", op: "isNull" },
    row.categoryId ? { field: "categoryId", op: "in", values: [row.categoryId] } : { field: "categoryId", op: "isNull" },
  ];
  if (row.entityId) {
    filters.push({ field: "entityId", op: "in", values: [row.entityId] });
    return filters;
  }
  const excluded = new Set(row.excludeEntityIds ?? []);
  if (scopeEntityIds) {
    const entities = scopeEntityIds.filter((id) => !excluded.has(id));
    filters.push({ field: "entityId", op: "in", values: entities.length ? entities : [NO_ENTITY] });
  } else if (excluded.size) {
    filters.push({ field: "entityId", op: "nin", values: [...excluded] });
  }
  return filters;
}

/**
 * The expense rows behind several budget rows at once (a KPI, a Total
 * row): kind expense outside transfers, the budgeted categories, and the
 * entities those budgets cover. Ledger filters are AND-only, so the drill
 * is exact when every category covers the same entities (all of them in
 * the scope when a category has a budget for every entity, else the
 * entities with their own budget); otherwise it takes the union of the
 * covered entities, which can add another entity's spend in a category
 * that only has a budget for some entities. Null when there are no rows.
 */
export function budgetsDrillFilters(rows: readonly BudgetDrillRow[], scopeEntityIds: readonly string[] | null): LedgerFilter[] | null {
  if (!rows.length) return null;
  const covered = new Map<string | null, Set<string> | "all">();
  for (const row of rows) {
    const current = covered.get(row.categoryId);
    if (current === "all") continue;
    if (!row.entityId) covered.set(row.categoryId, "all");
    else covered.set(row.categoryId, new Set([...(current ?? []), row.entityId]));
  }
  const categoryIds = [...covered.keys()].filter((id): id is string => id !== null);
  const filters: LedgerFilter[] = [
    { field: "kind", op: "in", values: ["expense"] },
    { field: "transferDirection", op: "isNull" },
    categoryIds.length ? { field: "categoryId", op: "in", values: categoryIds } : { field: "categoryId", op: "isNull" },
  ];
  const sets = [...covered.values()];
  if (sets.includes("all")) {
    if (scopeEntityIds) filters.push({ field: "entityId", op: "in", values: scopeEntityIds.length ? [...scopeEntityIds] : [NO_ENTITY] });
    return filters;
  }
  const entities = new Set(sets.flatMap((set) => [...(set as Set<string>)]));
  filters.push({ field: "entityId", op: "in", values: [...entities] });
  return filters;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A month (1-12) as a custom period. `throughDay` ends it early: the
 * current month's "Gasto" counts spend to date through that day, while the
 * whole month is its committed spend. budgetDrill widens an early end back
 * to the last day and adds the spentToDate filter.
 */
export function monthPeriod(year: number, month: number, throughDay?: number): Extract<Period, { from: string }> {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = throughDay ? Math.min(Math.max(throughDay, 1), last) : last;
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(end)}` };
}

/**
 * A range that ends before the last day of its end month is "through that
 * day". The effective-date window still covers the rest of that month (card
 * purchases close later) and the spentToDate filter applies the cutoff.
 * A range that already ends on the last day is the committed spend.
 */
function spentWindow(period: Extract<Period, { from: string }>): { period: Extract<Period, { from: string }>; cutoff: LedgerFilter | null } {
  const [y, m, day] = period.to.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (day >= last) return { period, cutoff: null };
  return {
    period: { from: period.from, to: `${y}-${pad(m)}-${pad(last)}` },
    cutoff: { field: "spentToDate", op: "asOf", asOf: period.to },
  };
}

/** Months `fromMonth`..`toMonth` (1-12) of a year as a custom period. */
export function monthsPeriod(year: number, fromMonth: number, toMonth: number): Extract<Period, { from: string }> {
  return { from: monthPeriod(year, fromMonth).from, to: monthPeriod(year, toMonth).to };
}

export interface BudgetDrill {
  filters: LedgerFilter[];
  dateField: "effectiveDate";
  period: Extract<Period, { from: string }>;
}

/** The draft of a drill from a budget row over a period (a month, or the months of a year so far). */
export function budgetDrill(row: BudgetDrillRow, scopeEntityIds: readonly string[] | null, period: Extract<Period, { from: string }>): BudgetDrill {
  const window = spentWindow(period);
  const filters = budgetDrillFilters(row, scopeEntityIds);
  if (window.cutoff) filters.push(window.cutoff);
  return { filters, dateField: "effectiveDate", period: window.period };
}

/** The draft of a drill from several budget rows (a KPI, a Total row) over a period; null when there are no rows. */
export function budgetsDrill(rows: readonly BudgetDrillRow[], scopeEntityIds: readonly string[] | null, period: Extract<Period, { from: string }>): BudgetDrill | null {
  const filters = budgetsDrillFilters(rows, scopeEntityIds);
  if (!filters) return null;
  const window = spentWindow(period);
  if (window.cutoff) filters.push(window.cutoff);
  return { filters, dateField: "effectiveDate", period: window.period };
}

/**
 * The entries a conta fixa (recurring rule) has booked, every date: the
 * draft of "Ver lançamentos" in its editor. It filters on the categorical
 * field recurringRuleId of contract C3 (S1's query engine).
 */
export function ruleEntriesDraft(rule: { id: string; description: string }): ViewDraft {
  // Cast until S1's CategoricalField (contract C3) lists recurringRuleId in this branch; redundant after the merge.
  const filter = { field: "recurringRuleId", op: "in", values: [rule.id] } as unknown as LedgerFilter;
  return { label: rule.description, filters: [filter], period: { preset: "all", offset: 0 } };
}
