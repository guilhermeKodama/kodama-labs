/**
 * "Editar N transações" (mockup BulkEditDialog 4467-4522, patchFor
 * 4526-4533): fields and new values, the before/after of each row, and the
 * bulk patch. The server (entries.ts bulkPatchFor) leaves transfer legs'
 * account and entity alone, and transfers carry no category; the preview
 * shows them "sem mudança" the same way.
 */

export type BulkEditField = "categoryId" | "entityId" | "accountId" | "isTaxDeductible";

export const BULK_EDIT_FIELDS: readonly BulkEditField[] = ["categoryId", "entityId", "accountId", "isTaxDeductible"];

export interface BulkEditChange {
  field: BulkEditField;
  /** An id, or "yes" / "no" for isTaxDeductible; "" until chosen. */
  value: string;
}

/** The row fields the preview reads. */
export interface BulkEditRow {
  id: string;
  kind: string;
  description: string;
  categoryId: string | null;
  entityId: string;
  accountId: string;
  isTaxDeductible: boolean;
  transferGroupId: string | null;
  /** Neutral display row (a transfer shown once). */
  neutral?: boolean;
}

/** The current value of `field` on a row, in the change's vocabulary. */
export function currentValue(row: BulkEditRow, field: BulkEditField): string {
  switch (field) {
    case "categoryId":
      return row.categoryId ?? "";
    case "entityId":
      return row.entityId;
    case "accountId":
      return row.accountId;
    case "isTaxDeductible":
      return row.isTaxDeductible ? "yes" : "no";
  }
}

/** Whether the server applies `field` to this row (transfers keep accounts, entities and no category). */
export function applies(row: BulkEditRow, field: BulkEditField): boolean {
  const transfer = !!row.transferGroupId || !!row.neutral;
  if (field === "categoryId") return row.kind !== "transfer" && !row.neutral;
  if (field === "accountId" || field === "entityId") return !transfer && row.kind !== "investment";
  return true;
}

/** Does the change move this row? */
export function changes(row: BulkEditRow, change: BulkEditChange): boolean {
  return change.value !== "" && applies(row, change.field) && currentValue(row, change.field) !== change.value;
}

/** The ready changes (a value picked), the last pick winning when a field repeats. */
export function readyChanges(list: readonly BulkEditChange[]): BulkEditChange[] {
  const byField = new Map<BulkEditField, BulkEditChange>();
  for (const change of list) if (change.value !== "") byField.set(change.field, change);
  return [...byField.values()];
}

/** POST /v2/ledger/bulk patch for the changes. Account wins over entity (the account fixes the entity). */
export function bulkPatch(list: readonly BulkEditChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const change of readyChanges(list)) {
    if (change.field === "isTaxDeductible") patch.isTaxDeductible = change.value === "yes";
    else patch[change.field] = change.value;
  }
  if (patch.accountId) delete patch.entityId;
  return patch;
}

/** Rows the changes move, as the preview counts them (the dry run gives the exact number for the whole selection). */
export function changedRows(rows: readonly BulkEditRow[], list: readonly BulkEditChange[]): number {
  const ready = readyChanges(list);
  return rows.filter((row) => ready.some((change) => changes(row, change))).length;
}

/** The next field for "+ Outro campo": the first one not in use yet. */
export function nextField(list: readonly BulkEditChange[]): BulkEditField | null {
  return BULK_EDIT_FIELDS.find((field) => !list.some((change) => change.field === field)) ?? null;
}
