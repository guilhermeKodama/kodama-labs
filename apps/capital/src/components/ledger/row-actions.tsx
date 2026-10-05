"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/api/client";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useLedgerOverlays } from "./overlay-state";
import type { DisplayRow } from "./rows";

/**
 * What can be done to one transaction row, shared by the table's ⋯ menu,
 * the row shortcuts (↵ open, ⌫ delete, ⌘D duplicate, E edit) and the
 * detail sheet, so they all behave the same.
 *
 * OWNER: S2. Target: `remove` asks the scope first for recurring,
 * installment and linked rows (DeleteScopeDialog, rendered through
 * `dialogs`) and deletes simple rows at once; `edit` focuses inline
 * editing; RowActionsMenu is the ⋯ menu (Abrir, Editar, Duplicar,
 * Excluir, with their shortcuts).
 * Now: open, remove (to the trash, with Desfazer) and duplicate work;
 * dialogs is empty and the menu renders nothing.
 */
export interface RowActions {
  /** Opens the detail sheet (?entry=). */
  open: (row: DisplayRow) => void;
  /** Moves the row (both legs of a transfer) to the trash, with Desfazer. */
  remove: (row: DisplayRow) => void;
  duplicate: (row: DisplayRow) => void;
  /** Dialogs these actions open (the delete scope); render it next to whatever uses the actions. */
  dialogs: ReactNode;
}

export function useRowActions(): RowActions {
  const t = useTranslations("entry");
  const overlays = useLedgerOverlays();
  const bulk = useAppMutation({
    event: "ledger.write",
    mutationFn: ({ op, row }: { op: "delete" | "duplicate"; row: DisplayRow }) =>
      apiPost<{ batchId: string | null; affected: number }>("/api/v2/ledger/bulk", { op, selection: { ids: row.legIds } }),
    undo: (result, { op, row }) => (op === "delete" ? t("toast.trashed", { description: row.description }) : t("bulk.duplicate", { count: result.affected })),
  });
  return {
    open: (row) => overlays.openEntry(row.id),
    remove: (row) => bulk.mutate({ op: "delete", row }),
    duplicate: (row) => bulk.mutate({ op: "duplicate", row }),
    dialogs: null,
  };
}

/** The ⋯ menu at the end of a table row. STUB until S2: renders nothing. */
export function RowActionsMenu({ row }: { row: DisplayRow }) {
  void row;
  return null;
}
