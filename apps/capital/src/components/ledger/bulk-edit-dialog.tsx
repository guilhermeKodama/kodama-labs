"use client";

import type { Names } from "@/lib/api/catalog";
import type { BulkSelection } from "./bulk-bar";

export interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rows to change: picked ids (transfer legs included) or the whole view's query. */
  selection: BulkSelection;
  /** How many rows the selection has, for the title. */
  count: number;
  names: Names;
  /** After the change was applied (the bar clears the selection). */
  onApplied?: () => void;
}

/**
 * "Editar N lançamentos" from the bulk bar.
 *
 * OWNER: S2. Target: fields left blank keep their value (categoria,
 * entidade, conta, data, dedutível no IR, notas); each change shows
 * before → after from a dry run (POST /v2/ledger/bulk {op:"update",
 * patch, selection, dryRun:true} → {matched, changed, byField}), then
 * Aplicar sends it for real as one undoable batch (useAppMutation
 * "ledger.write" with the undo toast). "Criar regra" for a category
 * change.
 * Now (STUB): renders nothing.
 */
export function BulkEditDialog(props: BulkEditDialogProps) {
  void props;
  return null;
}
