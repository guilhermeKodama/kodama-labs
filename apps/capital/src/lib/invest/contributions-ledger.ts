/**
 * Aportes › "Todos os aportes": every aporte and resgate, paged, over POST
 * /v2/ledger/query in display mode (one row per transfer), filtered to the
 * investment transfers (transferDirection investment_deposit /
 * investment_withdrawal), with the chips Conta, Corretora, Entidade,
 * Período and Tipo, the search, and the CSV export of the same selection.
 *
 * Ledger filters select legs: an account filter keeps the leg on that
 * account. Conta (the bank side) and Corretora (the broker side) are two
 * different legs of the same transfer, so with both set the query keeps the
 * broker legs and the bank side is matched here, on the counterpart of each
 * row (`clientFilter`).
 */
import type { LedgerDisplayRow, LedgerFilter, LedgerQueryInput, LedgerSelectionQuery, Period } from "@capital/server/modules/ledger/contracts";

export const CONTRIBUTION_DIRECTIONS = ["investment_deposit", "investment_withdrawal"] as const;
export type ContributionDirection = (typeof CONTRIBUTION_DIRECTIONS)[number];

export const CONTRIBUTION_PERIODS = ["all", "this_month", "last_month", "last_3m", "ytd", "last_12m"] as const;
export type ContributionPeriod = (typeof CONTRIBUTION_PERIODS)[number];

/** Rows per page ("Carregar mais"). */
export const CONTRIBUTIONS_PAGE = 50;

export interface ContributionFilters {
  /** Conta: the account the money came from (aporte) or went to (resgate). */
  accountIds: string[];
  /** Corretora. */
  brokerIds: string[];
  entityIds: string[];
  period: ContributionPeriod;
  /** Tipo: Aporte, Resgate (empty = both). */
  directions: ContributionDirection[];
  search: string;
}

export const EMPTY_CONTRIBUTION_FILTERS: ContributionFilters = { accountIds: [], brokerIds: [], entityIds: [], period: "all", directions: [], search: "" };

export interface ContributionsQuery {
  /** The selection (also the export's). */
  selection: Pick<LedgerSelectionQuery, "period" | "filters"> & { search?: string };
  /** The page query, without the cursor. */
  body: LedgerQueryInput & { semantics: "display" };
  /** Applied to the rows the server returns (Conta together with Corretora), or null. */
  clientFilter: ((row: Pick<LedgerDisplayRow, "accountId" | "counterpartAccountId" | "accountType">) => boolean) | null;
}

export function contributionsQuery(f: ContributionFilters): ContributionsQuery {
  const filters: LedgerFilter[] = [{ field: "transferDirection", op: "in", values: f.directions.length ? [...f.directions] : [...CONTRIBUTION_DIRECTIONS] }];
  if (f.entityIds.length) filters.push({ field: "entityId", op: "in", values: [...f.entityIds] });
  let clientFilter: ContributionsQuery["clientFilter"] = null;
  if (f.brokerIds.length) {
    filters.push({ field: "accountId", op: "in", values: [...f.brokerIds] });
    if (f.accountIds.length) {
      const wanted = new Set(f.accountIds);
      clientFilter = (row) => {
        const other = otherAccountOf(row);
        return other !== null && wanted.has(other);
      };
    }
  } else if (f.accountIds.length) {
    filters.push({ field: "accountId", op: "in", values: [...f.accountIds] });
  }
  const period: Period = { preset: f.period, offset: 0 };
  const search = f.search.trim() || undefined;
  const selection = { period, filters, ...(search && { search }) };
  return {
    selection,
    body: {
      ...selection,
      semantics: "display",
      sort: [{ field: "date", dir: "desc" }],
      aggregations: [{ fn: "count", field: "amountBase" }],
      page: { limit: CONTRIBUTIONS_PAGE },
    },
    clientFilter,
  };
}

type RowAccounts = Pick<LedgerDisplayRow, "accountId" | "counterpartAccountId" | "accountType">;

/** The broker of an aporte row: the row's account when it is the brokerage leg, else the other leg's. */
export function brokerAccountOf(row: RowAccounts): string | null {
  return row.accountType === "brokerage" ? row.accountId : row.counterpartAccountId;
}

/** The bank side of an aporte row. */
export function otherAccountOf(row: RowAccounts): string | null {
  return row.accountType === "brokerage" ? row.counterpartAccountId : row.accountId;
}

export interface ContributionRow {
  id: string;
  date: string;
  direction: ContributionDirection;
  description: string;
  brokerAccountId: string | null;
  otherAccountId: string | null;
  entityId: string;
  /** Base currency: + into the broker (aporte), − out of it (resgate), whichever leg the row stands for. */
  amount: number;
  row: LedgerDisplayRow;
}

export function contributionRow(row: LedgerDisplayRow): ContributionRow {
  const direction: ContributionDirection = row.transferDirection === "investment_withdrawal" ? "investment_withdrawal" : "investment_deposit";
  const abs = Math.abs(row.amountBase);
  return {
    id: row.id,
    date: row.date.slice(0, 10),
    direction,
    description: row.description,
    brokerAccountId: brokerAccountOf(row),
    otherAccountId: otherAccountOf(row),
    entityId: row.entityId,
    amount: direction === "investment_deposit" ? abs : -abs,
    row,
  };
}

/** Σ of the rows on screen: aportes, resgates and the net (aportes − resgates). */
export function contributionTotals(rows: readonly Pick<ContributionRow, "amount">[]): { deposits: number; withdrawals: number; net: number } {
  const deposits = rows.reduce((s, r) => s + Math.max(0, r.amount), 0);
  const withdrawals = rows.reduce((s, r) => s + Math.max(0, -r.amount), 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { deposits: round(deposits), withdrawals: round(withdrawals), net: round(deposits - withdrawals) };
}
