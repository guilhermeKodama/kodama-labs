"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Btn, Kbd } from "@/components/cap";
import { apiGet } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useShortcut } from "@/lib/shortcuts/provider";
import { useLedgerOverlays } from "./overlay-state";
import type { TrashPage } from "./trash-sheet";

/**
 * The actions in Transações' header (mockup 3099-3104, 5071-5077, 5413):
 * "Lixeira · N" (only with something in the trash; opens ?trash=1),
 * "Importar extrato" (opens ?import=1, S3's ImportDialog), and N +
 * "+ Nova transação" (opens ?create=1). N is bound here at screen scope, so
 * it works on Transações while nothing is typed and no overlay is open.
 */
export function TransactionsHeaderActions() {
  const t = useTranslations("entry.header");
  const tImport = useTranslations("import");
  const overlays = useLedgerOverlays();
  const trash = useQuery({
    queryKey: keys.trash({ limit: 1 }),
    queryFn: () => apiGet<TrashPage>("/api/v2/trash", { limit: 1 }),
  });
  const inTrash = trash.data ? (trash.data.rowsCount ?? trash.data.totals.count) : 0;
  useShortcut("n", () => overlays.openCreate());
  return (
    <>
      {inTrash > 0 ? (
        <Btn ghost onClick={() => overlays.openTrash()}>
          {t("trash", { count: inTrash })}
        </Btn>
      ) : null}
      <Btn onClick={() => overlays.openImport()}>{tImport("action")}</Btn>
      <Kbd>N</Kbd>
      <Btn primary onClick={() => overlays.openCreate()}>
        {t("create")}
      </Btn>
    </>
  );
}
