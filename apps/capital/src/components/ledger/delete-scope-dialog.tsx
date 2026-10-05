"use client";

export interface DeleteScopeDialogProps {
  /** The entry to delete; the dialog is open while this is set. */
  entryId: string | null;
  /** Its description, for the title ("Excluir “Aluguel”"). */
  description?: string;
  onOpenChange: (open: boolean) => void;
  /** After the delete; `batchId` is already on the undo stack with its toast. */
  onDeleted?: (batchId: string | null) => void;
}

/**
 * Asks how much of a repeating entry to delete (mockup 5413, 480px).
 *
 * OWNER: S2. Target: GET /v2/ledger/entries/{id}/delete-options
 * (keys.deleteOptions) gives the kind (recurring, installment, linked)
 * and, per scope (one, future, all), how many rows and how much money
 * go; a Choice lists them ("Só esta", "Esta e as próximas", "Todas"), a
 * linked investment operation adds "Excluir também a operação"
 * (checked). Excluir calls POST /v2/ledger/entries/{id}/delete
 * {scope, withLinkedOperation} as one undoable batch (pushUndo with the
 * toast). Simple entries never open it: RowActions.remove deletes them.
 * Now (STUB): renders nothing.
 */
export function DeleteScopeDialog(props: DeleteScopeDialogProps) {
  void props;
  return null;
}
