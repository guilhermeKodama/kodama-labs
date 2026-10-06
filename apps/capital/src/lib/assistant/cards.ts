import { buildTransactionsHref } from "@/lib/ledger/view-draft";
import type { ImportPlan, PlanKind } from "@/types/assistant";

/**
 * What the plan and result cards show, as message keys and values (the
 * `assistant` namespace renders them). Pure, so the choice of lines is
 * tested apart from the components.
 */

export type PlanCountKey = "new" | "duplicates" | "review" | "reconciled" | "transfers" | "cards" | "bills" | "investments" | "recordsToDelete";
export type PlanMoneyKey = "income" | "expense" | "transfersOut" | "transfersIn" | "billsTotal";

export interface PlanSummaryView {
  counts: { key: PlanCountKey; count: number }[];
  money: { key: PlanMoneyKey; amount: number }[];
  currency: string | null;
  /** The statement's closing balance matched (import plans that carry it). */
  balanceMatches: boolean;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function planSummaryView(kind: PlanKind, summary: ImportPlan["summary"]): PlanSummaryView {
  const currency = typeof summary.currency === "string" && summary.currency ? summary.currency : null;
  if (kind === "revert") {
    return { counts: [{ key: "recordsToDelete", count: num(summary.recordsToDelete) }], money: [], currency, balanceMatches: false };
  }
  const counts: PlanSummaryView["counts"] = [{ key: "new", count: num(summary.newTransactionCount) }];
  const optional: [PlanCountKey, unknown][] = [
    ["duplicates", summary.skipDuplicateCount],
    ["review", summary.linkFuzzyCount],
    ["reconciled", num(summary.reconciliationCount) + num(summary.transferReconciliationCount)],
    ["transfers", summary.transferCount],
    ["cards", summary.creditCardCount],
    ["bills", summary.billCount],
    ["investments", summary.investmentTransactionCount],
  ];
  for (const [key, value] of optional) if (num(value) > 0) counts.push({ key, count: num(value) });
  // A bill-only plan: the bill total is what is being proposed, not an empty grid of zeros.
  const billOnly = num(summary.billCount) > 0 && num(summary.newTransactionCount) === 0 && num(summary.transferCount) === 0 && num(summary.investmentTransactionCount) === 0;
  if (billOnly) counts.shift();
  const money: PlanSummaryView["money"] = [];
  const amounts: [PlanMoneyKey, unknown, boolean][] = [
    ["income", summary.totalIncome, !billOnly],
    ["expense", summary.totalExpense, !billOnly],
    ["transfersOut", summary.transferOutflow, false],
    ["transfersIn", summary.transferInflow, false],
    ["billsTotal", summary.billTotalPreviewAmount, false],
  ];
  // Income and expense always (they are what the user checks against the statement); the rest when present.
  for (const [key, value, always] of amounts) if (always || num(value) !== 0) money.push({ key, amount: num(value) });
  return { counts, money, currency, balanceMatches: summary.ledgerBalance !== undefined && summary.ledgerBalance !== null };
}

export type ResultCountKey = "imported" | "duplicatesSkipped" | "reconciled" | "transfersCreated" | "deleted";

export interface PlanResultView {
  kind: PlanKind;
  counts: { key: ResultCountKey; count: number }[];
  /** The undo batch the import or revert recorded. */
  batchId: string | null;
  /** The Import row, to open its rows in Transações. */
  importId: string | null;
}

export function planResultView(result: Record<string, unknown>): PlanResultView {
  const batchId = typeof result.batchId === "string" && result.batchId ? result.batchId : null;
  if ("transactionsDeleted" in result) {
    return { kind: "revert", counts: [{ key: "deleted", count: num(result.transactionsDeleted) }], batchId, importId: null };
  }
  const counts: PlanResultView["counts"] = [{ key: "imported", count: num(result.imported) }];
  for (const key of ["reconciled", "duplicatesSkipped", "transfersCreated"] as const) if (num(result[key]) > 0) counts.push({ key, count: num(result[key]) });
  const importId = typeof result.statementImportId === "string" && result.statementImportId ? result.statementImportId : null;
  return { kind: "import", counts, batchId, importId };
}

/** The three answers of a duplicate pair, in the card's order. */
export const DUPLICATE_DECISIONS = ["keep_both", "merge", "skip"] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

/** Every pair answered: the card can be sent. */
export function allPairsDecided(pairIds: readonly string[], decisions: Partial<Record<string, DuplicateDecision>>): boolean {
  return pairIds.length > 0 && pairIds.every((id) => decisions[id] !== undefined);
}

/** "Ver em Transações" of an import: its rows, every date (C3: links into Transações go through buildTransactionsHref). */
export function importRowsHref(importId: string): string {
  return buildTransactionsHref({ draft: { filters: [{ field: "importId", op: "in", values: [importId] }], period: { preset: "all", offset: 0 } } });
}
