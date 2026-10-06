"use client";

import { useCallback, useMemo } from "react";
import { parseAsString, useQueryStates } from "nuqs";
import { decodeCreateParam, encodeCreateParam, type QuickAddDraft } from "@/lib/ledger/quick-add";

/**
 * FROZEN with overlays.tsx: the URL params of Transações' overlays and the
 * hook that opens and closes them (see the table in overlays.tsx). Kept
 * apart so the overlays themselves can use it without an import cycle.
 */

const PARAMS = {
  entry: parseAsString,
  create: parseAsString,
  import: parseAsString,
  trash: parseAsString,
  display: parseAsString,
};

export type LedgerOverlay = keyof typeof PARAMS;

export interface LedgerOverlayState {
  /** The entry whose detail sheet is open. */
  entryId: string | null;
  /** The create dialog's draft while it is open ({} for a blank form). */
  createDraft: QuickAddDraft | null;
  importOpen: boolean;
  trashOpen: boolean;
  displayOpen: boolean;
  openEntry: (id: string) => void;
  openCreate: (draft?: QuickAddDraft) => void;
  openImport: () => void;
  openTrash: () => void;
  setDisplayOpen: (open: boolean) => void;
  /** Closes one overlay (removes its param). */
  close: (overlay: LedgerOverlay) => void;
}

export function useLedgerOverlays(): LedgerOverlayState {
  const [params, setParams] = useQueryStates(PARAMS);
  const close = useCallback((overlay: LedgerOverlay) => void setParams({ [overlay]: null }), [setParams]);
  return useMemo(
    () => ({
      entryId: params.entry || null,
      createDraft: decodeCreateParam(params.create),
      importOpen: params.import !== null,
      trashOpen: params.trash !== null,
      displayOpen: params.display !== null,
      openEntry: (id) => void setParams({ entry: id }),
      openCreate: (draft) => void setParams({ create: encodeCreateParam(draft) }),
      openImport: () => void setParams({ import: "1" }),
      openTrash: () => void setParams({ trash: "1" }),
      setDisplayOpen: (open) => void setParams({ display: open ? "1" : null }),
      close,
    }),
    [params, setParams, close],
  );
}
