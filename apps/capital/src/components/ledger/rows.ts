import type { LedgerDisplayRow, LedgerRow } from "@capital/server/modules/ledger/contracts";
import { selectionStats as statsOf } from "@/lib/ledger/selection";

/**
 * A row as Transações shows it: a display row from POST /v2/ledger/query
 * with semantics "display" (one row per entry, one per transfer; the
 * server merges the legs, counts and signs them). `toAccountId` is kept
 * for older readers: the destination of a neutral transfer, which the
 * server sends as counterpartAccountId.
 */
export type DisplayRow = LedgerDisplayRow & {
  /** @deprecated read counterpartAccountId. */
  toAccountId?: string | null;
};

const FLOW_OF_KIND: Record<LedgerRow["kind"], LedgerDisplayRow["flowKind"]> = { income: "in", expense: "out", transfer: "transfer", investment: "invest" };

/**
 * One entry fetched on its own (GET /v2/ledger/entries/{id}, legs) as a
 * display row of just that leg. Nothing is merged here any more: rows on
 * screen come merged from the server.
 */
export function toDisplayRow(row: LedgerRow): DisplayRow {
  const invest = row.transferDirection === "investment_deposit" || row.transferDirection === "investment_withdrawal";
  return {
    ...row,
    legIds: [row.id],
    flowKind: invest ? "invest" : FLOW_OF_KIND[row.kind],
    counts: true,
    displayAmount: row.amountBase,
    neutral: false,
    counterpartEntityId: null,
    installmentTotal: null,
    linkedOperationId: null,
    operationType: null,
    attachmentCount: 0,
    toAccountId: null,
  };
}

/** @deprecated rows come merged from the server; kept for readers of single entries. */
export function toDisplayRows(rows: LedgerRow[], mode?: "group" | "legs"): DisplayRow[] {
  void mode;
  return rows.map(toDisplayRow);
}

/** Σ, média, mín, máx of picked rows (the bulk bar), over counted rows. */
export function selectionStats(rows: readonly DisplayRow[]) {
  return statsOf(rows);
}
