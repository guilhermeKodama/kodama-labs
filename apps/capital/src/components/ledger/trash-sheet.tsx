"use client";

import type { Names } from "@/lib/api/catalog";

export interface TrashSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  names: Names;
}

/**
 * "Lixeira", opened by ?trash=1 from the "Lixeira · N" header button.
 *
 * OWNER: S2. Target: a 440px cap Sheet listing deleted entries
 * (keys.trash, GET /v2/ledger/trash) with date, description and amount,
 * "Restaurar" per row (undoable) and the note that entries leave the
 * trash after 30 days. Replaces Ajustes › Lixeira.
 * Now (STUB): renders nothing; the trash is still in Ajustes.
 */
export function TrashSheet(props: TrashSheetProps) {
  void props;
  return null;
}
