import type { LedgerFilter, Period } from "@capital/server/modules/ledger/contracts";

/**
 * Drills from a budget number to Transações. A budget counts expenses
 * outside transfers (kind expense, no transfer group) on their effective
 * date: card purchases on their statement's closing date. The drill selects
 * exactly those rows, so the table's total matches the number clicked.
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

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A month (1-12) as a custom period. `throughDay` ends it early: the
 * current month's "Gasto" counts what is dated up to today (the overview's
 * period.daysElapsed), while the whole month is its committed spend.
 */
export function monthPeriod(year: number, month: number, throughDay?: number): Extract<Period, { from: string }> {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = throughDay ? Math.min(Math.max(throughDay, 1), last) : last;
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(end)}` };
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
  return { filters: budgetDrillFilters(row, scopeEntityIds), dateField: "effectiveDate", period };
}
