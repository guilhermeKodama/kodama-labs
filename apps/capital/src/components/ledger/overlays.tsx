"use client";

import { ImportDialog } from "@/components/import/import-dialog";
import type { Names } from "@/lib/api/catalog";
import { EntryDialog } from "./entry-dialog";
import { EntrySheet } from "./entry-sheet";
import { useLedgerOverlays } from "./overlay-state";
import type { DisplayRow } from "./rows";
import { TrashSheet } from "./trash-sheet";

/**
 * FROZEN after step 0c-3: slices fill the components this mounts, never
 * this file. Transações' overlays, opened through the URL so ⌘K, links,
 * notifications and the back button reach them:
 *
 * | param        | opens                                   | owner |
 * |--------------|-----------------------------------------|-------|
 * | entry=<id>   | EntrySheet, the detail of one entry     | S2    |
 * | create=1|{…} | EntryDialog, blank or prefilled         | S2    |
 * | import=1     | ImportDialog                            | S3    |
 * | trash=1      | TrashSheet                              | S2    |
 * | display=1    | Exibição (the toolbar reads displayOpen) | S1    |
 *
 * Open and close them with useLedgerOverlays() (overlay-state.ts, also
 * exported here); links from other pages use buildTransactionsHref
 * (lib/ledger/view-draft.ts).
 */

export { useLedgerOverlays, type LedgerOverlay, type LedgerOverlayState } from "./overlay-state";

export interface LedgerOverlaysProps {
  names: Names;
  /** The rows on screen, so an open entry shows at once (the sheet fetches entries that are not on screen). */
  rows: readonly DisplayRow[];
}

/** Mounted by TransactionsScreen; renders whichever overlays the URL asks for. */
export function LedgerOverlays({ names, rows }: LedgerOverlaysProps) {
  const overlays = useLedgerOverlays();
  const { entryId, createDraft } = overlays;
  const row = entryId ? (rows.find((candidate) => candidate.id === entryId || candidate.legIds.includes(entryId)) ?? null) : null;
  return (
    <>
      {entryId ? <EntrySheet key={entryId} entryId={entryId} row={row} names={names} onClose={() => overlays.close("entry")} /> : null}
      {createDraft ? <EntryDialog key={JSON.stringify(createDraft)} names={names} draft={createDraft} onClose={() => overlays.close("create")} /> : null}
      <ImportDialog open={overlays.importOpen} onOpenChange={(open) => (open ? overlays.openImport() : overlays.close("import"))} />
      <TrashSheet open={overlays.trashOpen} onOpenChange={(open) => (open ? overlays.openTrash() : overlays.close("trash"))} names={names} />
    </>
  );
}
