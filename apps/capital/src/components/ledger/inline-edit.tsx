"use client";

import type { ReactNode } from "react";
import type { Names } from "@/lib/api/catalog";
import type { DisplayRow } from "./rows";

/** Table columns that can be edited in place. */
export type EditableField = "description" | "amount" | "date" | "categoryId" | "accountId" | "entityId" | "notes";

export interface EditableCellProps {
  row: DisplayRow;
  field: EditableField;
  names: Names;
  /** The cell as it reads when not editing. */
  children: ReactNode;
  /** Read-only, e.g. the account of a transfer leg. */
  disabled?: boolean;
  /** Tab / ⇧Tab / ↵ after a commit: the table moves the editor to the next cell. */
  onNavigate?: (direction: "next" | "previous" | "down") => void;
}

/**
 * One table cell that turns into an editor on click (mockup 5188: "Clique
 * numa célula para editar · Tab próxima célula · ↵ confirma · Esc cancela
 * · ⌘Z desfaz · ↗ abre o detalhe").
 *
 * OWNER: S2. Target: text, amount and date inputs, the category and
 * account comboboxes; ↵ or blur saves through PATCH /v2/ledger/entries/{id}
 * with an undo batch (useAppMutation "ledger.write"), Esc cancels, a 422
 * keeps the editor open with the field marked.
 * Now (STUB): renders the read-only cell.
 */
export function EditableCell({ children }: EditableCellProps) {
  return <>{children}</>;
}
