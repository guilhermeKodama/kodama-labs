import type { DeleteOptions } from "@capital/server/modules/ledger/services/scope-delete";

/**
 * Deleting one row (mockup DeleteFlow 5270-5465): simple rows go at once
 * with Desfazer; a recurring occurrence, an installment or an entry linked
 * to an investment operation first asks how much goes (DeleteScopeDialog).
 */

export type DeleteScope = "one" | "future" | "all";

/** The row fields that tell whether deleting it may take more with it. */
export interface DeleteCandidate {
  kind: string;
  isRecurring?: boolean;
  recurringRuleId?: string | null;
  installmentPlanId?: string | null;
  transferDirection?: string | null;
  /** Set on display rows (ledger display mode) when an investment operation hangs on the row. */
  linkedOperationId?: string | null;
}

/**
 * Whether the delete must ask first. Only a guess from the row: the dialog
 * asks the server (delete-options) and deletes at once when it says simple.
 */
export function needsScopeQuestion(row: DeleteCandidate): boolean {
  return (
    !!row.installmentPlanId ||
    !!row.recurringRuleId ||
    !!row.isRecurring ||
    !!row.linkedOperationId ||
    row.kind === "investment" ||
    row.transferDirection === "investment_deposit" ||
    row.transferDirection === "investment_withdrawal"
  );
}

/** The scopes the dialog offers, in order. */
export function scopesOf(options: Pick<DeleteOptions, "kind" | "scopes">): DeleteScope[] {
  if (options.kind !== "recurring" && options.kind !== "installment") return ["one"];
  return (["one", "future", "all"] as const).filter((scope) => !!options.scopes[scope]);
}

/** "9 lançamentos em 2026" or "… de 2025 a 2026": the years a scope spans. */
export function yearSpan(from: string, to: string): { from: number; to: number } | null {
  if (!from || !to) return null;
  return { from: Number(from.slice(0, 4)), to: Number(to.slice(0, 4)) };
}

/** Which toast follows the delete. */
export function deletedToast(options: Pick<DeleteOptions, "kind">, scope: DeleteScope, withLinkedOperation: boolean): { key: "simple" | "linked" | "scoped"; scope: DeleteScope } {
  if (options.kind === "linked") return { key: withLinkedOperation ? "linked" : "simple", scope };
  if (options.kind === "simple") return { key: "simple", scope };
  return { key: "scoped", scope };
}
