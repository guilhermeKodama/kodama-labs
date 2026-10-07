/**
 * "Importar nota" (Carteira): the brokerage note goes to the assistant,
 * which reads it and answers with a plan to confirm (propose_import_plan),
 * never writing on its own. The picker takes what the assistant takes for a
 * note: PDF and the image formats Claude reads. HEIC (iPhone photos) is not
 * one of them, so `image/*` would let the user pick a file rejected later.
 */
import { ALLOWED_ASSISTANT_EXTENSIONS } from "@/lib/assistant/constants";

export const NOTE_FILE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"] as const;

/** Only extensions the assistant composer accepts (lib/assistant/constants.ts). */
export const NOTE_FILE_ACCEPT = NOTE_FILE_EXTENSIONS.filter((e) => ALLOWED_ASSISTANT_EXTENSIONS.includes(e))
  .map((e) => `.${e}`)
  .join(",");

