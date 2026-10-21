"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { PageAction, PagePrimary } from "@/components/shell/page";
import { apiGet } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useLedgerOverlays } from "./overlay-state";
import type { TrashPage } from "./trash-sheet";

/**
 * The actions of Transações' header (mockup 3099-3104, 5071-5077, 5413):
 * "Lixeira · N" (only with something in the trash; opens ?trash=1),
 * "Importar extrato" (opens ?import=1, S3's ImportDialog), and N +
 * "+ Nova transação" (opens ?create=1). The N shown here is the shell's key
 * (GlobalKeys, lib/shell/shortcuts.ts), which opens the same dialog on
 * Transações; the screen does not bind it a second time. <Page> lays them
 * out (header buttons on a desktop; ⋯ and the floating button on a phone).
 */
export function useTransactionsHeader({ selecting }: { selecting: boolean }): { secondary: PageAction[]; primary: PagePrimary } {
  const t = useTranslations("entry.header");
  const tImport = useTranslations("import");
  const overlays = useLedgerOverlays();
  const trash = useQuery({
    queryKey: keys.trash({ limit: 1 }),
    queryFn: () => apiGet<TrashPage>("/api/v2/trash", { limit: 1 }),
  });
  const inTrash = trash.data ? (trash.data.rowsCount ?? trash.data.totals.count) : 0;
  return {
    secondary: [
      ...(inTrash > 0 ? [{ label: t("trash", { count: inTrash }), onSelect: () => overlays.openTrash(), ghost: true }] : []),
      { label: tImport("action"), onSelect: () => overlays.openImport() },
    ],
    // While rows are selected the bulk bar holds the bottom of a phone's screen.
    primary: { label: t("create"), onSelect: () => overlays.openCreate(), hint: "N", hideFab: selecting },
  };
}
