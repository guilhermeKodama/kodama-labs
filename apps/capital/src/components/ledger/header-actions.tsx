"use client";

import { useTranslations } from "next-intl";
import { Btn } from "@/components/shell/chrome";
import { useRouter } from "@/i18n/navigation";
import { useLedgerOverlays } from "./overlay-state";

/**
 * The actions in Transações' header (mockup 3099-3104): "Importar
 * extrato" and "+ Nova transação".
 *
 * OWNER: S2 (S3 points the import button at openImport() once its dialog
 * exists). Target: "Lixeira · N" (ghost, only with something in the trash,
 * opens ?trash=1) before the two buttons.
 * Now: "+ Nova transação" opens ?create=1; "Importar extrato" still goes
 * to Ajustes › Importações, where importing lives until S3.
 */
export function TransactionsHeaderActions() {
  const t = useTranslations("entry.header");
  const tImport = useTranslations("import");
  const overlays = useLedgerOverlays();
  const router = useRouter();
  return (
    <>
      <Btn onClick={() => router.push("/settings?page=imports")}>{tImport("action")}</Btn>
      <Btn primary onClick={() => overlays.openCreate()}>
        {t("create")}
      </Btn>
    </>
  );
}
