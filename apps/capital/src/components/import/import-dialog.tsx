"use client";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Account to import into when the file does not say (e.g. opened from an account). */
  defaultAccountId?: string;
}

/**
 * "Importar extrato", opened by ?import=1 over Transações.
 *
 * OWNER: S3. Target (mockup 5771-5817): a 720px cap Dialog in three steps.
 * Arquivo: dropzone (OFX, CSV; a PDF or image goes to the assistant
 * through openAssistant({ files })), POST /v2/imports/analyze shows bank,
 * period, count and the detected "Importar na conta". Revisar: one row
 * per transaction with Regra aplicada / Sugestão da IA / Sem categoria /
 * Duplicada pills, category comboboxes and "criar regra". Confirmar: KPIs,
 * then the commit as one batch ("imports.write"), ending with "Abrir a
 * view da importação" and "Desfazer importação".
 * Now (STUB): renders nothing; the header button still goes to Ajustes ›
 * Importações (header-actions.tsx).
 */
export function ImportDialog(props: ImportDialogProps) {
  void props;
  return null;
}
